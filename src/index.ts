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
      for (const blacklisted of this.config.blacklistedPaths) {
        if (relativePath.includes(blacklisted)) {
          throw new Error(`Access denied: Path contains blacklisted pattern '${blacklisted}'`);
        }
      }
    }

    // Check file extension only for file operations, not directory operations
    if (isFileOperation && this.config.allowedExtensions.length > 0) {
      const ext = path.extname(resolvedPath).toLowerCase();
      if (!this.config.allowedExtensions.includes(ext)) {
        throw new Error(`Access denied: File extension '${ext}' is not allowed`);
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
          // Check if file extension is allowed
          if (this.config.allowedExtensions.length > 0) {
            const ext = path.extname(entry.name).toLowerCase();
            if (!this.config.allowedExtensions.includes(ext)) {
              continue; // Skip files with disallowed extensions
            }
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
        '.js', '.ts', '.jsx', '.tsx', '.py', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp',
        '.java', '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala',
        '.html', '.css', '.scss', '.less', '.json', '.xml', '.yaml', '.yml',
        '.md', '.txt', '.sh', '.bat', '.ps1', '.sql', '.r', '.matlab', '.pl'
      ],
      blacklistedPaths: ['..', '.git', 'node_modules', '.env', 'secrets']
    };

    this.fileManager = new SecureFileManager(defaultConfig);
    
    this.server = new Server(
      {
        name: "source-code-file-server",
        version: "0.1.0",
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
Server Version: 0.1.0`,
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
    console.error("Source Code MCP Server running on stdio");
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