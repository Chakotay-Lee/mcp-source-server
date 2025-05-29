// test/mcp-server.test.ts
// Comprehensive test suite for Enhanced MCP Source Code Server

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, jest } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { tmpdir } from 'os';

// Test configuration
const TEST_WORKSPACE = path.join(tmpdir(), 'mcp-test-workspace');
const TEST_SERVER_PORT = 8999;

describe('Enhanced MCP Source Code Server', () => {
  let serverProcess: ChildProcess;
  let testClient: MCPTestClient;

  beforeAll(async () => {
    // Create test workspace
    await fs.mkdir(TEST_WORKSPACE, { recursive: true });
    
    // Start MCP server for testing
    serverProcess = spawn('node', ['dist/index.js'], {
      env: {
        ...process.env,
        MCP_WORKSPACE_DIR: TEST_WORKSPACE,
        MCP_LOG_LEVEL: 'error', // Reduce noise in tests
        NODE_ENV: 'test'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Initialize test client
    testClient = new MCPTestClient(serverProcess);
  });

  afterAll(async () => {
    // Clean up test workspace
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
    
    // Terminate server
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
  });

  beforeEach(async () => {
    // Clean workspace before each test
    const files = await fs.readdir(TEST_WORKSPACE);
    for (const file of files) {
      await fs.rm(path.join(TEST_WORKSPACE, file), { recursive: true, force: true });
    }
  });

  describe('Security Tests', () => {
    it('should prevent directory traversal attacks', async () => {
      const maliciousPaths = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\drivers\\etc\\hosts',
        '../outside-workspace.txt',
        'subdir/../../outside.txt'
      ];

      for (const maliciousPath of maliciousPaths) {
        const result = await testClient.callTool('read_source_file', {
          filePath: maliciousPath
        });
        
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Access denied');
      }
    });

    it('should enforce updated blacklist patterns', async () => {
      const blacklistedPaths = [
        '.git/config',
        'node_modules/package.json',
        '.env.local',
        '.env.production',
        'secrets/api-key.txt'
      ];

      // Create directories and files
      await fs.mkdir(path.join(TEST_WORKSPACE, '.git'), { recursive: true });
      await fs.mkdir(path.join(TEST_WORKSPACE, 'node_modules'), { recursive: true });
      await fs.mkdir(path.join(TEST_WORKSPACE, 'secrets'), { recursive: true });
      
      // Create files
      for (const blacklistedPath of blacklistedPaths) {
        const fullPath = path.join(TEST_WORKSPACE, blacklistedPath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, 'sensitive data');
      }

      for (const blacklistedPath of blacklistedPaths) {
        const result = await testClient.callTool('read_source_file', {
          filePath: blacklistedPath
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('blacklisted');
      }
    });

    it('should allow development configuration files', async () => {
      const allowedFiles = [
        '.gitignore',
        '.env.template',
        'Dockerfile',
        'Makefile',
        'package.json',
        'tsconfig.json'
      ];

      // Create allowed files
      for (const fileName of allowedFiles) {
        const filePath = path.join(TEST_WORKSPACE, fileName);
        await fs.writeFile(filePath, `# ${fileName} content`);
      }

      // Test each file individually with detailed error reporting
      const results = [];
      for (const fileName of allowedFiles) {
        const result = await testClient.callTool('read_source_file', {
          filePath: fileName
        });

        results.push({
          fileName,
          isError: result.isError,
          message: result.isError ? result.content[0].text : 'SUCCESS'
        });

        if (result.isError) {
          console.error(`❌ ${fileName}: ${result.content[0].text}`);
        }
      }

      // Print detailed results for debugging
      console.log('=== File Access Test Results ===');
      results.forEach(r => {
        console.log(`${r.isError ? '❌' : '✅'} ${r.fileName}: ${r.message}`);
      });

      // Find failed files
      const failedFiles = results.filter(r => r.isError);
      if (failedFiles.length > 0) {
        console.error(`Failed files: ${failedFiles.map(f => `${f.fileName} (${f.message})`).join(', ')}`);
      }

      // Test assertions for individual files  
      for (const fileName of allowedFiles) {
        const result = await testClient.callTool('read_source_file', {
          filePath: fileName
        });

        // More specific error message for debugging
        if (result.isError) {
          throw new Error(`File ${fileName} should be allowed but was blocked: ${result.content[0].text}`);
        }

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toContain(`# ${fileName} content`);
      }
    });

    it('should enforce file size limits', async () => {
      const largeContent = 'x'.repeat(15 * 1024 * 1024); // 15MB

      const result = await testClient.callTool('write_source_file', {
        filePath: 'large-file.js',
        content: largeContent
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('exceeds maximum allowed size');
    });
  });

  describe('Original File Operations', () => {
    it('should read existing files correctly', async () => {
      const testContent = 'console.log("Hello, World!");';
      const testFile = path.join(TEST_WORKSPACE, 'test.js');
      await fs.writeFile(testFile, testContent);

      const result = await testClient.callTool('read_source_file', {
        filePath: 'test.js'
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain(testContent);
    });

    it('should write files correctly', async () => {
      const testContent = 'def hello():\n    print("Hello, Python!")';
      
      const result = await testClient.callTool('write_source_file', {
        filePath: 'hello.py',
        content: testContent
      });

      expect(result.isError).toBe(false);
      
      // Verify file was created
      const createdContent = await fs.readFile(path.join(TEST_WORKSPACE, 'hello.py'), 'utf-8');
      expect(createdContent).toBe(testContent);
    });

    it('should list files with metadata', async () => {
      // Create test files
      await fs.writeFile(path.join(TEST_WORKSPACE, 'file1.js'), 'content1');
      await fs.writeFile(path.join(TEST_WORKSPACE, 'file2.py'), 'content2');
      await fs.writeFile(path.join(TEST_WORKSPACE, '.gitignore'), 'node_modules/');

      const result = await testClient.callTool('list_source_files', {
        dirPath: ''
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('file1.js');
      expect(output).toContain('file2.py');
      expect(output).toContain('.gitignore');
      expect(output).toContain('bytes');
      expect(output).toContain('modified');
    });
  });

  describe('Delete File Functionality', () => {
    it('should delete files successfully with backup', async () => {
      const testContent = 'console.log("test file");';
      
      // Create test file
      await testClient.callTool('write_source_file', {
        filePath: 'delete-test.js',
        content: testContent
      });

      // Delete with backup (default)
      const result = await testClient.callTool('delete_source_file', {
        filePath: 'delete-test.js'
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully deleted');
      expect(result.content[0].text).toContain('backup created');
      
      // Verify file is deleted
      const fileExists = await fs.access(path.join(TEST_WORKSPACE, 'delete-test.js'))
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(false);
      
      // Verify backup exists
      const backupDir = path.join(TEST_WORKSPACE, '.backups');
      const backupFiles = await fs.readdir(backupDir);
      const backupFile = backupFiles.find(f => f.startsWith('delete-test.js.'));
      expect(backupFile).toBeDefined();
    });

    it('should delete files without backup when requested', async () => {
      const testContent = 'console.log("no backup test");';
      
      // Create test file
      await testClient.callTool('write_source_file', {
        filePath: 'no-backup-test.js',
        content: testContent
      });

      // Delete without backup
      const result = await testClient.callTool('delete_source_file', {
        filePath: 'no-backup-test.js',
        createBackup: false
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully deleted');
      expect(result.content[0].text).not.toContain('backup created');
    });

    it('should handle deleting non-existent files', async () => {
      const result = await testClient.callTool('delete_source_file', {
        filePath: 'non-existent.js'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('does not exist');
    });
  });

  describe('Rename/Move File Functionality', () => {
    it('should rename files successfully', async () => {
      const testContent = 'console.log("rename test");';
      
      // Create test file
      await testClient.callTool('write_source_file', {
        filePath: 'old-name.js',
        content: testContent
      });

      // Rename file
      const result = await testClient.callTool('rename_source_file', {
        oldPath: 'old-name.js',
        newPath: 'new-name.js'
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully renamed/moved');
      expect(result.content[0].text).toContain('backup created');
      
      // Verify old file is gone
      const oldExists = await fs.access(path.join(TEST_WORKSPACE, 'old-name.js'))
        .then(() => true)
        .catch(() => false);
      expect(oldExists).toBe(false);
      
      // Verify new file exists with correct content
      const newContent = await fs.readFile(path.join(TEST_WORKSPACE, 'new-name.js'), 'utf-8');
      expect(newContent).toBe(testContent);
    });

    it('should move files to different directories', async () => {
      const testContent = 'console.log("move test");';
      
      // Create test file
      await testClient.callTool('write_source_file', {
        filePath: 'move-test.js',
        content: testContent
      });

      // Move to subdirectory
      const result = await testClient.callTool('rename_source_file', {
        oldPath: 'move-test.js',
        newPath: 'src/move-test.js'
      });

      expect(result.isError).toBe(false);
      
      // Verify file moved correctly
      const movedContent = await fs.readFile(path.join(TEST_WORKSPACE, 'src', 'move-test.js'), 'utf-8');
      expect(movedContent).toBe(testContent);
    });

    it('should prevent overwriting existing files', async () => {
      // Create two test files
      await testClient.callTool('write_source_file', {
        filePath: 'source.js',
        content: 'source content'
      });
      
      await testClient.callTool('write_source_file', {
        filePath: 'target.js',
        content: 'target content'
      });

      // Try to move source to existing target
      const result = await testClient.callTool('rename_source_file', {
        oldPath: 'source.js',
        newPath: 'target.js'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('already exists');
    });
  });

  describe('Partial Write Functionality (LLM Optimization)', () => {
    it('should replace specific content successfully', async () => {
      const originalContent = `function oldFunction() {
  return "old implementation";
}

const config = {
  version: "1.0.0"
};`;

      const oldFunctionCode = `function oldFunction() {
  return "old implementation";
}`;

      const newFunctionCode = `function newFunction() {
  return "new and improved implementation";
  // Added comment
}`;

      // Create test file
      await testClient.callTool('write_source_file', {
        filePath: 'partial-test.js',
        content: originalContent
      });

      // Partial update
      const result = await testClient.callTool('partial_write_source_file', {
        filePath: 'partial-test.js',
        oldContent: oldFunctionCode,
        newContent: newFunctionCode
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully updated');
      expect(result.content[0].text).toContain('size change:');
      
      // Verify content was replaced correctly
      const updatedContent = await fs.readFile(path.join(TEST_WORKSPACE, 'partial-test.js'), 'utf-8');
      expect(updatedContent).toContain('newFunction');
      expect(updatedContent).toContain('new and improved implementation');
      expect(updatedContent).toContain('config = {'); // Ensure rest of file unchanged
      expect(updatedContent).not.toContain('oldFunction');
    });

    it('should handle non-existent content gracefully', async () => {
      const originalContent = 'console.log("test");';
      
      // Create test file
      await testClient.callTool('write_source_file', {
        filePath: 'partial-fail-test.js',
        content: originalContent
      });

      // Try to replace content that doesn't exist
      const result = await testClient.callTool('partial_write_source_file', {
        filePath: 'partial-fail-test.js',
        oldContent: 'nonexistent content',
        newContent: 'replacement'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Original content not found');
    });

    it('should detect duplicate content and require specificity', async () => {
      const originalContent = `console.log("duplicate");
// Some code here
console.log("duplicate");`;

      // Create test file
      await testClient.callTool('write_source_file', {
        filePath: 'duplicate-test.js',
        content: originalContent
      });

      // Try to replace ambiguous content
      const result = await testClient.callTool('partial_write_source_file', {
        filePath: 'duplicate-test.js',
        oldContent: 'console.log("duplicate");',
        newContent: 'console.log("updated");'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Multiple occurrences');
    });

    it('should create automatic backup before partial write', async () => {
      const originalContent = 'const old = "value";';
      
      // Create test file
      await testClient.callTool('write_source_file', {
        filePath: 'backup-partial.js',
        content: originalContent
      });

      // Partial update (should automatically create backup)
      await testClient.callTool('partial_write_source_file', {
        filePath: 'backup-partial.js',
        oldContent: 'const old = "value";',
        newContent: 'const updated = "new value";'
      });

      // Verify backup was created
      const backupDir = path.join(TEST_WORKSPACE, '.backups');
      const backupFiles = await fs.readdir(backupDir);
      const backupFile = backupFiles.find(f => f.startsWith('backup-partial.js.'));
      
      expect(backupFile).toBeDefined();
      if (backupFile) {
        const backupContent = await fs.readFile(path.join(backupDir, backupFile), 'utf-8');
        expect(backupContent).toBe(originalContent);
      }
    });
  });

  describe('Server Statistics and Info', () => {
    it('should report updated server version and features', async () => {
      const result = await testClient.callTool('get_server_stats', {});
      
      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('Server Statistics');
      expect(output).toContain('Server Version: 0.2.2'); // Updated to match actual version
      expect(output).toContain('New Features: File deletion, rename/move, partial write optimization, text search (grep-like)');
      expect(output).toContain('Active Operations');
      expect(output).toContain('Workspace Directory');
      expect(output).toContain('Max File Size');
    });
  });

  describe('Performance and Concurrency', () => {
    it('should handle multiple concurrent write operations', async () => {
      const operations = [];
      
      // Create multiple concurrent write operations
      for (let i = 0; i < 3; i++) {
        operations.push(
          testClient.callTool('write_source_file', {
            filePath: `concurrent-${i}.js`,
            content: `console.log('File ${i}');`
          })
        );
      }

      const results = await Promise.all(operations);
      
      // All operations should succeed
      for (const result of results) {
        expect(result.isError).toBe(false);
      }

      // Verify all files were created
      for (let i = 0; i < 3; i++) {
        const fileExists = await fs.access(path.join(TEST_WORKSPACE, `concurrent-${i}.js`))
          .then(() => true)
          .catch(() => false);
        expect(fileExists).toBe(true);
      }
    });

    it('should handle sequential operations correctly', async () => {
      // First create a file
      const createResult = await testClient.callTool('write_source_file', {
        filePath: 'sequential-test.js',
        content: 'console.log("original");'
      });
      expect(createResult.isError).toBe(false);

      // Then rename it
      const renameResult = await testClient.callTool('rename_source_file', {
        oldPath: 'sequential-test.js',
        newPath: 'renamed-test.js'
      });
      expect(renameResult.isError).toBe(false);

      // Verify the renamed file exists
      const fileExists = await fs.access(path.join(TEST_WORKSPACE, 'renamed-test.js'))
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);
    });
  });

  describe('Integration Tests', () => {
    it('should support complete development workflow', async () => {
      // 1. Create initial file
      const initialCode = `class Calculator {
  add(a, b) {
    return a + b;
  }
}`;

      await testClient.callTool('write_source_file', {
        filePath: 'Calculator.js',
        content: initialCode
      });

      // 2. Update using partial write (add new method)
      await testClient.callTool('partial_write_source_file', {
        filePath: 'Calculator.js',
        oldContent: '  add(a, b) {\n    return a + b;\n  }',
        newContent: `  add(a, b) {
    return a + b;
  }

  multiply(a, b) {
    return a * b;
  }`
      });

      // 3. Rename to more appropriate name
      await testClient.callTool('rename_source_file', {
        oldPath: 'Calculator.js',
        newPath: 'src/Calculator.js'
      });

      // 4. Verify final state
      const finalContent = await fs.readFile(path.join(TEST_WORKSPACE, 'src', 'Calculator.js'), 'utf-8');
      expect(finalContent).toContain('multiply');
      expect(finalContent).toContain('class Calculator');

      // 5. Verify backups were created
      const backupDir = path.join(TEST_WORKSPACE, '.backups');
      const backupFiles = await fs.readdir(backupDir);
      expect(backupFiles.length).toBeGreaterThan(0);
    });
  });

  describe('Text Search Functionality (Grep-like)', () => {
    beforeEach(async () => {
      // Create test files with various content for search testing
      const files = [
        {
          path: 'src/main.js',
          content: `console.log("Hello World");
function greet(name) {
  return "Hello " + name;
}
const greeting = "Welcome to our application";
// Additional Hello for testing
const welcomeMessage = "Hello everyone!";`
        },
        {
          path: 'src/utils.js',
          content: `function calculateSum(a, b) {
  return a + b;
}
// Helper function
function formatGreeting(message) {
  return message.toUpperCase();
}`
        },
        {
          path: 'tests/main.test.js',
          content: `describe('main tests', () => {
  it('should greet properly', () => {
    expect(greet('World')).toBe('Hello World');
  });
});`
        },
        {
          path: 'README.md',
          content: `# Project Title
This project demonstrates greeting functionality.
It includes functions to greet users with Hello messages.
Hello world example is included for demonstration.`
        },
        {
          path: 'config.json',
          content: `{
  "name": "test-project",
  "version": "1.0.0",
  "greeting": "Hello"
}`
        }
      ];

      // Create directories and files
      for (const file of files) {
        const fullPath = path.join(TEST_WORKSPACE, file.path);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, file.content);
      }
    });

    it('should search for simple text patterns', async () => {
      const result = await testClient.callTool('search_files', {
        pattern: 'Hello',
        recursive: true // Explicitly enable recursive search
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('Search results for pattern "Hello"');
      expect(output).toContain('Found');
      expect(output).toContain('file(s) with matches');
      // Check for files that actually contain "Hello" based on our test data
      expect(output).toContain('src/main.js');
      expect(output).toContain('config.json');
      expect(output).toContain('README.md');
      expect(output).toContain('tests/main.test.js');
      // Should find multiple files with recursive search enabled
      expect(output.match(/Found [4-9]\d* file\(s\) with matches/)).toBeTruthy();
    });

    it('should search only in root directory by default', async () => {
      const result = await testClient.callTool('search_files', {
        pattern: 'Hello'
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('Found');
      // Should only find files in root directory by default
      expect(output).toContain('config.json');
      expect(output).toContain('README.md');
      // Should NOT find files in subdirectories when recursive is false (default)
      expect(output).not.toContain('src/main.js');
      expect(output).not.toContain('tests/main.test.js');
    });

    it('should search recursively when explicitly requested', async () => {
      const result = await testClient.callTool('search_files', {
        pattern: 'greet',
        recursive: true
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('recursive');
      expect(output).toContain('Found');
      expect(output).toContain('file(s) with matches');
      // Verify that multiple files are found (at least the ones we created)
      expect(output).toContain('src/main.js');
      expect(output).toContain('tests/main.test.js');
    });

    it('should search in specific directory only', async () => {
      const result = await testClient.callTool('search_files', {
        pattern: 'function',
        searchDir: 'src'
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('Search results for pattern "function" in src');
      expect(output).toContain('src/main.js');
      expect(output).toContain('src/utils.js');
      expect(output).not.toContain('tests/main.test.js');
    });

    it('should ignore case when requested', async () => {
      const result = await testClient.callTool('search_files', {
        pattern: 'HELLO',
        ignoreCase: true,
        recursive: true // Enable recursive search
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('Found');
      // Should find files containing "Hello" in any case (with recursive search enabled)
      expect(output).toContain('src/main.js');
      expect(output).toContain('config.json');
      expect(output).toContain('README.md');
      expect(output).toContain('tests/main.test.js');
      // Verify multiple files are found when ignoring case
      expect(output.match(/Found [4-9]\d* file\(s\) with matches/)).toBeTruthy();
    });

    it('should respect case sensitivity by default', async () => {
      const result = await testClient.callTool('search_files', {
        pattern: 'HELLO'
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('No matches found');
    });

    it('should return only filenames when contextLines is 0', async () => {
      const result = await testClient.callTool('search_files', {
        pattern: 'function',
        recursive: true, // Enable recursive search
        contextLines: 0
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('Matches:');
      expect(output).not.toContain('Line ');
    });

    it('should include context lines when requested', async () => {
      const result = await testClient.callTool('search_files', {
        pattern: 'greet',
        searchDir: 'src',
        recursive: true, // Enable recursive search
        contextLines: 2
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('Line ');
      expect(output).toContain('function greet(name)');
      // Should include context lines with line numbers
      expect(output).toMatch(/\d+:/);
    });

    it('should handle patterns with special regex characters', async () => {
      // Create a file with special characters
      await testClient.callTool('write_source_file', {
        filePath: 'special.js',
        content: 'const regex = /hello.*world/g;\nconst price = $19.99;'
      });

      const result = await testClient.callTool('search_files', {
        pattern: '$19.99'
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('Found');
      expect(output).toContain('special.js');
    });

    it('should return no matches for non-existent patterns', async () => {
      const result = await testClient.callTool('search_files', {
        pattern: 'nonexistentpattern12345'
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('No matches found');
    });

    it('should handle empty search directory gracefully', async () => {
      // Search in empty subdirectory
      await fs.mkdir(path.join(TEST_WORKSPACE, 'empty'), { recursive: true });
      
      const result = await testClient.callTool('search_files', {
        pattern: 'anything',
        searchDir: 'empty'
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('No matches found');
    });

    it('should respect security restrictions in search', async () => {
      // Try to search outside workspace
      const result = await testClient.callTool('search_files', {
        pattern: 'test',
        searchDir: '../outside'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Access denied');
    });

    it('should skip blacklisted files during search', async () => {
      // Create blacklisted files
      await fs.mkdir(path.join(TEST_WORKSPACE, '.git'), { recursive: true });
      await fs.writeFile(path.join(TEST_WORKSPACE, '.git', 'config'), 'Hello from git config');
      await fs.writeFile(path.join(TEST_WORKSPACE, '.env.local'), 'Hello from env file');

      const result = await testClient.callTool('search_files', {
        pattern: 'Hello',
        recursive: true // Enable recursive search
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).not.toContain('.git/config');
      expect(output).not.toContain('.env.local');
    });

    it('should handle large files efficiently', async () => {
      // Create a reasonably sized file (not too large to cause timeout)
      const largeContent = 'line content\n'.repeat(1000) + 'SEARCH_TARGET\n' + 'more content\n'.repeat(1000);
      
      await testClient.callTool('write_source_file', {
        filePath: 'large.txt',
        content: largeContent
      });

      const result = await testClient.callTool('search_files', {
        pattern: 'SEARCH_TARGET'
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('Found');
      expect(output).toContain('large.txt');
    });

    it('should provide LLM-friendly output format', async () => {
      const result = await testClient.callTool('search_files', {
        pattern: 'Hello',
        recursive: true, // Enable recursive search
        contextLines: 1
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      
      // Check for structured format that LLMs can easily parse
      expect(output).toMatch(/Search results for pattern/);
      expect(output).toMatch(/Found \d+ file\(s\) with matches/);
      expect(output).toMatch(/File: [^\n]+/);
      expect(output).toMatch(/Line \d+:/);
    });

    it('should handle concurrent search operations', async () => {
      const operations = [
        testClient.callTool('search_files', { pattern: 'Hello', recursive: true }),
        testClient.callTool('search_files', { pattern: 'function', recursive: true }),
        testClient.callTool('search_files', { pattern: 'greet', recursive: true })
      ];

      const results = await Promise.all(operations);
      
      // All operations should succeed
      for (const result of results) {
        expect(result.isError).toBe(false);
        expect(result.content[0].text).toContain('Search results');
      }
    });
  });
});

// Enhanced test client helper class
class MCPTestClient {
  private serverProcess: ChildProcess;
  private requestId: number = 1;

  constructor(serverProcess: ChildProcess) {
    this.serverProcess = serverProcess;
  }

  async callTool(name: string, args: any = {}): Promise<any> {
    const request = {
      jsonrpc: "2.0",
      id: this.requestId++,
      method: "tools/call",
      params: {
        name,
        arguments: args
      }
    };

    return new Promise((resolve, reject) => {
      let responseData = '';
      let responseReceived = false;

      const timeout = setTimeout(() => {
        if (!responseReceived) {
          this.serverProcess.stdout?.off('data', onData);
          reject(new Error('Request timeout'));
        }
      }, 15000); // Increased timeout

      const onData = (data: Buffer) => {
        responseData += data.toString();
        
        try {
          const lines = responseData.split('\n').filter(line => line.trim());
          for (const line of lines) {
            const response = JSON.parse(line);
            if (response.id === request.id) {
              responseReceived = true;
              clearTimeout(timeout);
              this.serverProcess.stdout?.off('data', onData);
              
              if (response.error) {
                resolve({
                  isError: true,
                  content: [{ type: 'text', text: response.error.message }]
                });
              } else {
                const result = response.result || { content: [{ type: 'text', text: 'Success' }] };
                // Ensure isError property exists
                if (result.isError === undefined) {
                  result.isError = false;
                }
                resolve(result);
              }
              return;
            }
          }
        } catch (e) {
          // Response not complete yet, continue waiting
        }
      };

      this.serverProcess.stdout?.on('data', onData);
      this.serverProcess.stdin?.write(JSON.stringify(request) + '\n');
    });
  }
}

// Enhanced Jest configuration
export const jestConfig = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testTimeout: 60000, // Increased timeout for comprehensive tests
  maxWorkers: 1 // Run tests sequentially to avoid conflicts
};
