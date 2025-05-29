#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Transform } from "stream";

// Security configuration interface
interface SecurityConfig {
  allowedDirectory: string;
  maxFileSize: number;
  maxConcurrentOperations: number;
  allowedExtensions: string[];
  blacklistedPaths: string[];
}

// Secure file manager class
class SecureFileManager {
  private config: SecurityConfig;
  private normalizedAllowedDir: string;
  private activeOperations: number = 0;

  constructor(config: SecurityConfig) {
    this.config = config;
    this.normalizedAllowedDir = path.resolve(path.normalize(config.allowedDirectory));
  }

  /**
   * Check if file extension is allowed
   */
  private isFileExtensionAllowed(fileName: string): boolean {
    // If no extension restrictions, allow all
    if (this.config.allowedExtensions.length === 0) {
      return true;
    }
    
    const ext = path.extname(fileName).toLowerCase();
    return this.config.allowedExtensions.includes(ext);
  }

  /**
   * Check if path is blacklisted with precise pattern matching
   */
  private isPathBlacklisted(relativePath: string): boolean {
    const fileName = path.basename(relativePath);
    
    for (const blacklisted of this.config.blacklistedPaths) {
      // Special handling for .env. pattern
      if (blacklisted === '.env.') {
        // Allow .env.template and .env.example but block .env.local, .env.production etc.
        if (fileName.startsWith('.env.') && 
            !fileName.endsWith('.template') && 
            !fileName.endsWith('.example') &&
            !fileName.endsWith('.sample')) {
          return true;
        }
      } else {
        // For other patterns, use includes
        if (relativePath.includes(blacklisted)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Security check: Validate if the requested path is within allowed directory
   */
  private validatePath(filePath: string, isFileOperation: boolean = true): string {
    // Normalize the input path to prevent directory traversal
    const normalizedPath = path.normalize(filePath);
    
    // Resolve to absolute path
    const resolvedPath = path.resolve(this.normalizedAllowedDir, normalizedPath);
    
    // Check if the resolved path is within the allowed directory
    if (!resolvedPath.startsWith(this.normalizedAllowedDir + path.sep) && 
        resolvedPath !== this.normalizedAllowedDir) {
      throw new Error(`Access denied: Path '${filePath}' is outside allowed directory`);
    }

    // Check for blacklisted patterns (skip this check for empty path which means root)
    if (filePath !== "" && filePath !== ".") {
      const relativePath = path.relative(this.normalizedAllowedDir, resolvedPath);
      if (this.isPathBlacklisted(relativePath)) {
        throw new Error(`Access denied: Path contains blacklisted pattern`);
      }
    }

    // Check file extension only for file operations, not directory operations
    if (isFileOperation) {
      const fileName = path.basename(resolvedPath);
      if (!this.isFileExtensionAllowed(fileName)) {
        const ext = path.extname(fileName).toLowerCase();
        throw new Error(`Access denied: File extension '${ext || 'no extension'}' is not allowed`);
      }
    }

    return resolvedPath;
  }

  /**
   * Read file content securely
   */
  async readFile(filePath: string): Promise<string> {
    // Check concurrent operations
    if (this.activeOperations >= this.config.maxConcurrentOperations) {
      throw new Error('Too many concurrent operations. Please try again later.');
    }

    this.activeOperations++;
    
    try {
      const safePath = this.validatePath(filePath, true);
      
      // Check if file exists and is readable
      try {
        await fs.access(safePath, fs.constants.R_OK);
      } catch (accessError: any) {
        if (accessError.code === 'ENOENT') {
          throw new Error(`File '${filePath}' does not exist`);
        }
        throw accessError;
      }
      
      // Check file size
      const stats = await fs.stat(safePath);
      if (stats.size > this.config.maxFileSize) {
        throw new Error(`File size (${stats.size} bytes) exceeds maximum allowed size (${this.config.maxFileSize} bytes)`);
      }

      // Read file content
      const content = await fs.readFile(safePath, 'utf-8');
      return content;
    } catch (error) {
      if (error instanceof Error) {
        // Don't wrap already formatted error messages
        if (error.message.includes('does not exist') || 
            error.message.includes('Access denied') ||
            error.message.includes('exceeds maximum')) {
          throw error;
        }
        throw new Error(`Failed to read file '${filePath}': ${error.message}`);
      }
      throw error;
    } finally {
      this.activeOperations--;
    }
  }

  /**
   * Write file content securely with optional backup
   */
  async writeFile(filePath: string, content: string, createBackup: boolean = false): Promise<void> {
    // Check concurrent operations
    if (this.activeOperations >= this.config.maxConcurrentOperations) {
      throw new Error('Too many concurrent operations. Please try again later.');
    }

    this.activeOperations++;
    
    try {
      const safePath = this.validatePath(filePath, true);
      
      // Content size validation
      const contentSize = Buffer.byteLength(content, 'utf-8');
      if (contentSize > this.config.maxFileSize) {
        throw new Error(`Content size (${contentSize} bytes) exceeds maximum allowed size (${this.config.maxFileSize} bytes)`);
      }

      // Create backup if requested and file exists
      if (createBackup) {
        try {
          await fs.access(safePath, fs.constants.F_OK);
          await this.createBackup(safePath);
        } catch (error) {
          // File doesn't exist, no need to backup
        }
      }

      // Ensure directory exists
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      
      // Write file content
      await fs.writeFile(safePath, content, 'utf-8');
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to write file '${filePath}': ${error.message}`);
      }
      throw error;
    } finally {
      this.activeOperations--;
    }
  }

  /**
   * Partial write for LLM optimization - update specific content without rewriting entire file
   */
  async partialWriteFile(filePath: string, oldContent: string, newContent: string): Promise<void> {
    // Check concurrent operations
    if (this.activeOperations >= this.config.maxConcurrentOperations) {
      throw new Error('Too many concurrent operations. Please try again later.');
    }

    this.activeOperations++;
    
    try {
      const safePath = this.validatePath(filePath, true);
      
      // Read current file content
      const currentContent = await fs.readFile(safePath, 'utf-8');
      
      // Find the exact position of oldContent in the file
      const oldIndex = currentContent.indexOf(oldContent);
      if (oldIndex === -1) {
        throw new Error(`Original content not found in file. The content might have been modified.`);
      }
      
      // Check if there are multiple occurrences
      const secondOccurrence = currentContent.indexOf(oldContent, oldIndex + 1);
      if (secondOccurrence !== -1) {
        throw new Error(`Multiple occurrences of the target content found. Please use specific content for replacement.`);
      }
      
      // Replace the content
      const updatedContent = currentContent.substring(0, oldIndex) + 
                           newContent + 
                           currentContent.substring(oldIndex + oldContent.length);
      
      // Content size validation
      const contentSize = Buffer.byteLength(updatedContent, 'utf-8');
      if (contentSize > this.config.maxFileSize) {
        throw new Error(`Updated content size (${contentSize} bytes) exceeds maximum allowed size (${this.config.maxFileSize} bytes)`);
      }

      // Create backup before modification
      await this.createBackup(safePath);
      
      // Write updated content
      await fs.writeFile(safePath, updatedContent, 'utf-8');
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to partial write file '${filePath}': ${error.message}`);
      }
      throw error;
    } finally {
      this.activeOperations--;
    }
  }

  /**
   * Delete file securely
   */
  async deleteFile(filePath: string, createBackup: boolean = true): Promise<void> {
    // Check concurrent operations
    if (this.activeOperations >= this.config.maxConcurrentOperations) {
      throw new Error('Too many concurrent operations. Please try again later.');
    }

    this.activeOperations++;
    
    try {
      const safePath = this.validatePath(filePath, true);
      
      // Check if file exists
      try {
        await fs.access(safePath, fs.constants.F_OK);
      } catch (accessError: any) {
        if (accessError.code === 'ENOENT') {
          throw new Error(`File '${filePath}' does not exist`);
        }
        throw accessError;
      }
      
      // Create backup if requested
      if (createBackup) {
        await this.createBackup(safePath);
      }
      
      // Delete the file
      await fs.unlink(safePath);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('does not exist') || 
            error.message.includes('Access denied')) {
          throw error;
        }
        throw new Error(`Failed to delete file '${filePath}': ${error.message}`);
      }
      throw error;
    } finally {
      this.activeOperations--;
    }
  }

  /**
   * Rename or move file securely
   */
  async renameFile(oldPath: string, newPath: string, createBackup: boolean = true): Promise<void> {
    // Check concurrent operations
    if (this.activeOperations >= this.config.maxConcurrentOperations) {
      throw new Error('Too many concurrent operations. Please try again later.');
    }

    this.activeOperations++;
    
    try {
      const safeOldPath = this.validatePath(oldPath, true);
      const safeNewPath = this.validatePath(newPath, true);
      
      // Check if source file exists
      try {
        await fs.access(safeOldPath, fs.constants.F_OK);
      } catch (accessError: any) {
        if (accessError.code === 'ENOENT') {
          throw new Error(`Source file '${oldPath}' does not exist`);
        }
        throw accessError;
      }
      
      // Check if destination already exists
      try {
        await fs.access(safeNewPath, fs.constants.F_OK);
        throw new Error(`Destination '${newPath}' already exists`);
      } catch (accessError: any) {
        if (accessError.code !== 'ENOENT') {
          throw accessError;
        }
        // File doesn't exist, which is what we want
      }
      
      // Create backup if requested
      if (createBackup) {
        await this.createBackup(safeOldPath);
      }
      
      // Ensure destination directory exists
      await fs.mkdir(path.dirname(safeNewPath), { recursive: true });
      
      // Rename/move the file
      await fs.rename(safeOldPath, safeNewPath);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('does not exist') || 
            error.message.includes('already exists') ||
            error.message.includes('Access denied')) {
          throw error;
        }
        throw new Error(`Failed to rename/move file from '${oldPath}' to '${newPath}': ${error.message}`);
      }
      throw error;
    } finally {
      this.activeOperations--;
    }
  }

  /**
   * Create backup of existing file
   */
  private async createBackup(filePath: string): Promise<void> {
    const backupDir = path.join(this.normalizedAllowedDir, '.backups');
    await fs.mkdir(backupDir, { recursive: true });
    
    const fileName = path.basename(filePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `${fileName}.${timestamp}.backup`;
    const backupPath = path.join(backupDir, backupFileName);
    
    await fs.copyFile(filePath, backupPath);
  }

  /**
   * Stream write file content securely
   */
  async streamWriteFile(filePath: string, contentStream: NodeJS.ReadableStream): Promise<void> {
    // Check concurrent operations
    if (this.activeOperations >= this.config.maxConcurrentOperations) {
      throw new Error('Too many concurrent operations. Please try again later.');
    }

    this.activeOperations++;
    
    try {
      const safePath = this.validatePath(filePath, true);
      
      // Ensure directory exists
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      
      // Create write stream
      const writeStream = createWriteStream(safePath);
      let bytesWritten = 0;

      // Create transform stream for size monitoring
      const maxFileSize = this.config.maxFileSize;
      const monitorStream = new Transform({
        transform(chunk: Buffer, encoding: string, callback: (error?: Error | null, data?: any) => void) {
          bytesWritten += chunk.length;
          if (bytesWritten > maxFileSize) {
            return callback(new Error(`Stream size exceeds maximum allowed size (${maxFileSize} bytes)`));
          }
          callback(null, chunk);
        }
      });

      // Pipeline the streams
      await pipeline(contentStream, monitorStream, writeStream);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to stream write file '${filePath}': ${error.message}`);
      }
      throw error;
    } finally {
      this.activeOperations--;
    }
  }

  /**
   * List files in directory securely with metadata
   */
  async listFiles(dirPath: string = ""): Promise<Array<{name: string, size: number, modified: Date}>> {
    try {
      let safePath: string;
      
      // Handle empty, null, undefined, or current directory path specially  
      if (dirPath === undefined || dirPath === null || dirPath === "" || dirPath === ".") {
        // Directly use workspace root without validation for empty path
        safePath = this.normalizedAllowedDir;
      } else {
        // For non-empty directory paths, validate as directory operation
        safePath = this.validatePath(dirPath, false);
      }
      
      const entries = await fs.readdir(safePath, { withFileTypes: true });
      const fileInfos = [];
      
      for (const entry of entries) {
        if (entry.isFile()) {
          // Check if file extension is allowed using the same logic as other methods
          if (!this.isFileExtensionAllowed(entry.name)) {
            continue; // Skip files with disallowed extensions
          }
          
          // Also check if file is blacklisted
          if (this.isPathBlacklisted(entry.name)) {
            continue; // Skip blacklisted files
          }
          
          try {
            const filePath = path.join(safePath, entry.name);
            const stats = await fs.stat(filePath);
            fileInfos.push({
              name: entry.name,
              size: stats.size,
              modified: stats.mtime
            });
          } catch (error) {
            // Skip files that can't be accessed
            continue;
          }
        }
      }
      
      return fileInfos;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to list files in '${dirPath}': ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Search for text patterns in files (grep-like functionality) - SAFE VERSION
   */
  async searchInFiles(
    pattern: string,
    searchDir: string = "",
    options: {
      recursive?: boolean;
      ignoreCase?: boolean;
      contextLines?: number;
    } = {}
  ): Promise<Array<{
    file: string;
    matches: Array<{
      lineNumber: number;
      line: string;
      context?: {
        before: string[];
        after: string[];
      };
    }>;
  }>> {
    const {
      recursive = false, // Default to false for safety
      ignoreCase = false,
      contextLines = 0
    } = options;
    
    try {
      let searchPath: string;
      
      // Handle empty or root directory path
      if (searchDir === undefined || searchDir === null || searchDir === "" || searchDir === ".") {
        searchPath = this.normalizedAllowedDir;
      } else {
        searchPath = this.validatePath(searchDir, false);
      }
      
      const results: Array<{
        file: string;
        matches: Array<{
          lineNumber: number;
          line: string;
          context?: {
            before: string[];
            after: string[];
          };
        }>;
      }> = [];
      
      // Use safe iterative approach instead of recursion
      await this.searchInDirectorySafe(searchPath, pattern, ignoreCase, contextLines, recursive, results);
      
      return results;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to search in files: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Safe iterative directory search to prevent infinite recursion
   */
  private async searchInDirectorySafe(
    rootPath: string,
    pattern: string,
    ignoreCase: boolean,
    contextLines: number,
    recursive: boolean,
    results: Array<{
      file: string;
      matches: Array<{
        lineNumber: number;
        line: string;
        context?: {
          before: string[];
          after: string[];
        };
      }>;
    }>
  ): Promise<void> {
    // Use a queue-based approach instead of recursion
    const directoriesToProcess = [rootPath];
    const processedPaths = new Set<string>();
    const maxDirectories = 1000; // Safety limit
    let processedCount = 0;

    while (directoriesToProcess.length > 0 && processedCount < maxDirectories) {
      const currentDir = directoriesToProcess.shift()!;
      processedCount++;

      // Prevent infinite loops
      try {
        const realPath = await fs.realpath(currentDir);
        if (processedPaths.has(realPath)) {
          continue;
        }
        processedPaths.add(realPath);
      } catch (error) {
        continue; // Skip if can't get real path
      }

      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          const relativePath = path.relative(this.normalizedAllowedDir, fullPath);
          
          if (entry.isFile()) {
            // Check if file extension is allowed and not blacklisted
            if (!this.isFileExtensionAllowed(entry.name) || 
                this.isPathBlacklisted(relativePath)) {
              continue;
            }
            
            try {
              // Check file size before reading
              const stats = await fs.stat(fullPath);
              if (stats.size > this.config.maxFileSize) {
                continue; // Skip files that are too large
              }
              
              const matches = await this.searchInFile(fullPath, pattern, ignoreCase, contextLines);
              if (matches.length > 0) {
                results.push({
                  file: relativePath,
                  matches: matches
                });
              }
            } catch (error) {
              // Skip files that can't be read or processed
              continue;
            }
          } else if (entry.isDirectory() && recursive) {
            // Skip blacklisted directories and hidden directories
            if (this.isPathBlacklisted(relativePath) || 
                (entry.name.startsWith('.') && !['..', '.'].includes(entry.name))) {
              continue;
            }
            
            // Add to queue for processing
            directoriesToProcess.push(fullPath);
          }
        }
      } catch (error) {
        // Skip directories that can't be accessed
        continue;
      }
    }
  }

  /**
   * Search for pattern in a single file
   */
  private async searchInFile(
    filePath: string,
    pattern: string,
    ignoreCase: boolean,
    contextLines: number
  ): Promise<Array<{
    lineNumber: number;
    line: string;
    context?: {
      before: string[];
      after: string[];
    };
  }>> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const matches: Array<{
        lineNumber: number;
        line: string;
        context?: {
          before: string[];
          after: string[];
        };
      }> = [];
      
      // Create regex pattern for search
      const searchPattern = new RegExp(
        pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), // Escape special regex characters
        ignoreCase ? 'i' : ''
      );
      
      for (let i = 0; i < lines.length; i++) {
        if (searchPattern.test(lines[i])) {
          const match: {
            lineNumber: number;
            line: string;
            context?: {
              before: string[];
              after: string[];
            };
          } = {
            lineNumber: i + 1,
            line: lines[i]
          };
          
          // Add context if requested
          if (contextLines > 0) {
            const beforeStart = Math.max(0, i - contextLines);
            const afterEnd = Math.min(lines.length - 1, i + contextLines);
            
            match.context = {
              before: lines.slice(beforeStart, i),
              after: lines.slice(i + 1, afterEnd + 1)
            };
          }
          
          matches.push(match);
        }
      }
      
      return matches;
    } catch (error) {
      // Return empty array if file can't be read
      return [];
    }
  }

  /**
   * Get server statistics
   */
  getStats(): {activeOperations: number, allowedDirectory: string, maxFileSize: number} {
    return {
      activeOperations: this.activeOperations,
      allowedDirectory: this.normalizedAllowedDir,
      maxFileSize: this.config.maxFileSize
    };
  }
}

// MCP Server class
class SourceCodeMCPServer {
  private server: Server;
  private fileManager: SecureFileManager;

  constructor() {
    // Default security configuration
    const defaultConfig: SecurityConfig = {
      allowedDirectory: process.env.MCP_WORKSPACE_DIR || "./workspace",
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxConcurrentOperations: 10,
      allowedExtensions: [
        // Programming languages
        '.js', '.ts', '.jsx', '.tsx', '.py', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp',
        '.java', '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala',
        
        // Web technologies
        '.html', '.css', '.scss', '.less', '.json', '.xml', '.yaml', '.yml',
        
        // Documentation and text
        '.md', '.txt', '.rst', '.adoc',
        
        // Scripts and configs
        '.sh', '.bat', '.ps1', '.sql', '.r', '.matlab', '.pl',
        
        // Template and config files
        '.template', '.example', '.sample', '.config',
        
        // Special development files (no extension)
        '', // Files without extension like Dockerfile, Makefile, .gitignore, etc.
      ],
      blacklistedPaths: [
        '..',           // Prevent directory traversal
        '.git/',        // Git repository files
        'node_modules/', // Dependencies directory  
        '.env.',        // Environment files (includes .env, .env.local, .env.production, etc.)
        'secrets/',     // Secrets directory
        '.DS_Store',    // macOS system files
        'Thumbs.db'     // Windows system files
      ]
    };

    this.fileManager = new SecureFileManager(defaultConfig);
    
    this.server = new Server(
      {
        name: "source-code-file-server",
        version: "0.2.1",
        capabilities: {
          tools: {},
        }
      },
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "read_source_file",
            description: "Read content from a source code file",
            inputSchema: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Path to the source file to read (relative to workspace)",
                },
              },
              required: ["filePath"],
            },
          },
          {
            name: "write_source_file",
            description: "Write content to a source code file",
            inputSchema: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Path to the source file to write (relative to workspace)",
                },
                content: {
                  type: "string",
                  description: "Content to write to the file",
                },
                createBackup: {
                  type: "boolean",
                  description: "Whether to create a backup of existing file",
                  default: false,
                },
              },
              required: ["filePath", "content"],
            },
          },
          {
            name: "partial_write_source_file",
            description: "Efficiently update part of a file by replacing specific content (optimized for LLM usage)",
            inputSchema: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Path to the source file to update (relative to workspace)",
                },
                oldContent: {
                  type: "string",
                  description: "Exact content to be replaced (must be unique in the file)",
                },
                newContent: {
                  type: "string",
                  description: "New content to replace the old content with",
                },
              },
              required: ["filePath", "oldContent", "newContent"],
            },
          },
          {
            name: "delete_source_file",
            description: "Delete a source code file",
            inputSchema: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Path to the source file to delete (relative to workspace)",
                },
                createBackup: {
                  type: "boolean",
                  description: "Whether to create a backup before deletion",
                  default: true,
                },
              },
              required: ["filePath"],
            },
          },
          {
            name: "rename_source_file",
            description: "Rename or move a source code file to a new location",
            inputSchema: {
              type: "object",
              properties: {
                oldPath: {
                  type: "string",
                  description: "Current path of the source file (relative to workspace)",
                },
                newPath: {
                  type: "string",
                  description: "New path for the source file (relative to workspace)",
                },
                createBackup: {
                  type: "boolean",
                  description: "Whether to create a backup before renaming/moving",
                  default: true,
                },
              },
              required: ["oldPath", "newPath"],
            },
          },
          {
            name: "stream_write_source_file",
            description: "Write content to a source code file using streaming",
            inputSchema: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Path to the source file to write (relative to workspace)",
                },
                content: {
                  type: "string",
                  description: "Content to stream write to the file",
                },
              },
              required: ["filePath", "content"],
            },
          },
          {
            name: "list_source_files",
            description: "List source code files in a directory with metadata",
            inputSchema: {
              type: "object",
              properties: {
                dirPath: {
                  type: "string",
                  description: "Directory path to list files from (relative to workspace, optional)",
                  default: "",
                },
              },
            },
          },
          {
            name: "get_server_stats",
            description: "Get server statistics and status information",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "search_files",
            description: "Search for text patterns in files (grep-like functionality)",
            inputSchema: {
              type: "object",
              properties: {
                pattern: {
                  type: "string",
                  description: "Text pattern to search for",
                },
                searchDir: {
                  type: "string",
                  description: "Directory to search in (relative to workspace, default is root)",
                  default: "",
                },
                recursive: {
                  type: "boolean",
                  description: "Whether to search subdirectories recursively",
                  default: false,
                },
                ignoreCase: {
                  type: "boolean",
                  description: "Whether to ignore case when searching",
                  default: false,
                },
                contextLines: {
                  type: "number",
                  description: "Number of context lines to include before and after matches (0 means no context, only filenames)",
                  default: 0,
                },
              },
              required: ["pattern"],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "read_source_file": {
            const { filePath } = args as { filePath: string };
            if (!filePath) {
              throw new Error('filePath parameter is required');
            }
            const content = await this.fileManager.readFile(filePath);
            return {
              content: [
                {
                  type: "text",
                  text: `File: ${filePath}\n\n${content}`,
                },
              ],
            };
          }

          case "write_source_file": {
            const { filePath, content, createBackup = false } = args as { 
              filePath: string; 
              content: string; 
              createBackup?: boolean 
            };
            if (!filePath || content === undefined) {
              throw new Error('filePath and content parameters are required');
            }
            await this.fileManager.writeFile(filePath, content, createBackup);
            return {
              content: [
                {
                  type: "text",
                  text: `Successfully wrote ${Buffer.byteLength(content, 'utf-8')} bytes to ${filePath}`,
                },
              ],
            };
          }

          case "partial_write_source_file": {
            const { filePath, oldContent, newContent } = args as { 
              filePath: string; 
              oldContent: string; 
              newContent: string;
            };
            if (!filePath || oldContent === undefined || newContent === undefined) {
              throw new Error('filePath, oldContent, and newContent parameters are required');
            }
            await this.fileManager.partialWriteFile(filePath, oldContent, newContent);
            const sizeDiff = Buffer.byteLength(newContent, 'utf-8') - Buffer.byteLength(oldContent, 'utf-8');
            const sizeChange = sizeDiff >= 0 ? `+${sizeDiff}` : `${sizeDiff}`;
            return {
              content: [
                {
                  type: "text",
                  text: `Successfully updated ${filePath} (content replaced, size change: ${sizeChange} bytes)`,
                },
              ],
            };
          }

          case "delete_source_file": {
            const { filePath, createBackup = true } = args as { 
              filePath: string; 
              createBackup?: boolean 
            };
            if (!filePath) {
              throw new Error('filePath parameter is required');
            }
            await this.fileManager.deleteFile(filePath, createBackup);
            return {
              content: [
                {
                  type: "text",
                  text: `Successfully deleted ${filePath}${createBackup ? ' (backup created)' : ''}`,
                },
              ],
            };
          }

          case "rename_source_file": {
            const { oldPath, newPath, createBackup = true } = args as { 
              oldPath: string; 
              newPath: string; 
              createBackup?: boolean 
            };
            if (!oldPath || !newPath) {
              throw new Error('oldPath and newPath parameters are required');
            }
            await this.fileManager.renameFile(oldPath, newPath, createBackup);
            return {
              content: [
                {
                  type: "text",
                  text: `Successfully renamed/moved ${oldPath} to ${newPath}${createBackup ? ' (backup created)' : ''}`,
                },
              ],
            };
          }

          case "stream_write_source_file": {
            const { filePath, content } = args as { filePath: string; content: string };
            if (!filePath || content === undefined) {
              throw new Error('filePath and content parameters are required');
            }
            // Convert string to stream
            const { Readable } = await import('stream');
            const contentStream = Readable.from([content]);
            await this.fileManager.streamWriteFile(filePath, contentStream);
            return {
              content: [
                {
                  type: "text",
                  text: `Successfully stream wrote ${Buffer.byteLength(content, 'utf-8')} bytes to ${filePath}`,
                },
              ],
            };
          }

          case "list_source_files": {
            const { dirPath } = args as { dirPath?: string };
            // Handle undefined or empty dirPath
            const actualDirPath = (dirPath === undefined || dirPath === null) ? "" : dirPath;
            const fileInfos = await this.fileManager.listFiles(actualDirPath);
            
            if (fileInfos.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: `No source files found in ${actualDirPath || 'workspace'}`,
                  },
                ],
              };
            }

            const fileList = fileInfos
              .map(info => `${info.name} (${info.size} bytes, modified: ${info.modified.toISOString()})`)
              .join('\n');

            return {
              content: [
                {
                  type: "text",
                  text: `Files in ${actualDirPath || 'workspace'}:\n${fileList}`,
                },
              ],
            };
          }

          case "get_server_stats": {
            const stats = this.fileManager.getStats();
            return {
              content: [
                {
                  type: "text",
                  text: `Server Statistics:
Active Operations: ${stats.activeOperations}
Workspace Directory: ${stats.allowedDirectory}
Max File Size: ${stats.maxFileSize} bytes (${(stats.maxFileSize / 1024 / 1024).toFixed(1)} MB)
Server Version: 0.2.2
New Features: File deletion, rename/move, partial write optimization, text search (grep-like)
Extension Fix: Added .template, .example, .sample, .config support`,
                },
              ],
            };
          }

          case "search_files": {
            const { 
              pattern, 
              searchDir = "", 
              recursive = false, // Change default back to false for safety
              ignoreCase = false, 
              contextLines = 0 
            } = args as { 
              pattern: string; 
              searchDir?: string; 
              recursive?: boolean; 
              ignoreCase?: boolean; 
              contextLines?: number; 
            };
            
            if (!pattern) {
              throw new Error('pattern parameter is required');
            }
            
            const searchResults = await this.fileManager.searchInFiles(
              pattern, 
              searchDir, 
              { recursive, ignoreCase, contextLines }
            );
            
            if (searchResults.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: `No matches found for pattern "${pattern}" in ${searchDir || 'workspace'}${recursive ? ' (recursive)' : ''}`,
                  },
                ],
              };
            }
            
            // Format results for LLM-friendly analysis
            let output = `Search results for pattern "${pattern}" in ${searchDir || 'workspace'}${recursive ? ' (recursive)' : ''}:\n`;
            output += `Found ${searchResults.length} file(s) with matches\n\n`;
            
            for (const result of searchResults) {
              output += `File: ${result.file}\n`;
              
              if (contextLines === 0) {
                // Only show match count when no context is requested
                output += `  Matches: ${result.matches.length}\n`;
              } else {
                // Show detailed matches with context
                for (const match of result.matches) {
                  output += `  Line ${match.lineNumber}: ${match.line.trim()}\n`;
                  
                  if (match.context) {
                    // Show context before
                    if (match.context.before.length > 0) {
                      match.context.before.forEach((line, index) => {
                        const lineNum = match.lineNumber - match.context!.before.length + index;
                        output += `    ${lineNum}: ${line.trim()}\n`;
                      });
                    }
                    
                    // Show context after
                    if (match.context.after.length > 0) {
                      match.context.after.forEach((line, index) => {
                        const lineNum = match.lineNumber + index + 1;
                        output += `    ${lineNum}: ${line.trim()}\n`;
                      });
                    }
                  }
                }
              }
              
              output += '\n';
            }
            
            return {
              content: [
                {
                  type: "text",
                  text: output.trim(),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Enhanced Source Code MCP Server running on stdio");
  }
}

// Start the server
async function main(): Promise<void> {
  const server = new SourceCodeMCPServer();
  await server.run();
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
