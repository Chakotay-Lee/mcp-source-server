// test/mcp-server.test.ts
// Comprehensive test suite for MCP Source Code Server

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, jest } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { tmpdir } from 'os';

// Test configuration
const TEST_WORKSPACE = path.join(tmpdir(), 'mcp-test-workspace');
const TEST_SERVER_PORT = 8999;

describe('MCP Source Code Server', () => {
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

    it('should enforce file extension whitelist', async () => {
      // Create test file with disallowed extension
      const disallowedFile = path.join(TEST_WORKSPACE, 'secret.config');
      await fs.writeFile(disallowedFile, 'secret data');

      const result = await testClient.callTool('read_source_file', {
        filePath: 'secret.config'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not allowed');
    });

    it('should block access to blacklisted paths', async () => {
      const blacklistedPaths = [
        '.git/config',
        'node_modules/package.json',
        '.env',
        'secrets/api-key.txt'
      ];

      // Create directories
      await fs.mkdir(path.join(TEST_WORKSPACE, '.git'), { recursive: true });
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

  describe('File Operations', () => {
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

    it('should create directory structure when writing files', async () => {
      const result = await testClient.callTool('write_source_file', {
        filePath: 'src/components/Button.tsx',
        content: 'export const Button = () => <button>Click me</button>;'
      });

      expect(result.isError).toBe(false);
      
      // Verify directory structure was created
      const exists = await fs.access(path.join(TEST_WORKSPACE, 'src/components/Button.tsx'))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('should handle stream writing', async () => {
      const testContent = 'Large content for streaming test\n'.repeat(1000);
      
      const result = await testClient.callTool('stream_write_source_file', {
        filePath: 'stream-test.txt',
        content: testContent
      });

      expect(result.isError).toBe(false);
      
      // Verify content
      const writtenContent = await fs.readFile(path.join(TEST_WORKSPACE, 'stream-test.txt'), 'utf-8');
      expect(writtenContent).toBe(testContent);
    });

    it('should list files with metadata', async () => {
      // Create test files
      await fs.writeFile(path.join(TEST_WORKSPACE, 'file1.js'), 'content1');
      await fs.writeFile(path.join(TEST_WORKSPACE, 'file2.py'), 'content2');
      await fs.writeFile(path.join(TEST_WORKSPACE, 'file3.cpp'), 'content3');

      const result = await testClient.callTool('list_source_files', {
        dirPath: ''
      });
      console.log(`List files result: ${JSON.stringify(result)}`);

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('file1.js');
      expect(output).toContain('file2.py');
      expect(output).toContain('file3.cpp');
      expect(output).toContain('bytes');
      expect(output).toContain('modified');
    });
  });

  describe('Backup Functionality', () => {
    it('should create backups when overwriting files', async () => {
      const originalContent = 'Original content';
      const newContent = 'New content';
      
      // Create original file
      await testClient.callTool('write_source_file', {
        filePath: 'backup-test.js',
        content: originalContent,
        createBackup: false // Don't backup on first write
      });

      // Overwrite with backup
      const result = await testClient.callTool('write_source_file', {
        filePath: 'backup-test.js',
        content: newContent,
        createBackup: true
      });

      expect(result.isError).toBe(false);
      
      // Check that backup was created
      const backupDir = path.join(TEST_WORKSPACE, '.backups');
      const backupFiles = await fs.readdir(backupDir);
      const backupFile = backupFiles.find(f => f.startsWith('backup-test.js.'));
      
      expect(backupFile).toBeDefined();
      if (backupFile) {
        const backupContent = await fs.readFile(path.join(backupDir, backupFile), 'utf-8');
        expect(backupContent).toBe(originalContent);
      }
    });
  });

  describe('Performance Tests', () => {
    it('should handle concurrent operations', async () => {
      const operations = [];
      
      // Create 10 concurrent write operations
      for (let i = 0; i < 10; i++) {
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
      const files = await fs.readdir(TEST_WORKSPACE);
      const createdFiles = files.filter(f => f.startsWith('concurrent-'));
      expect(createdFiles).toHaveLength(10);
    });

    it('should respond to server stats request', async () => {
      const result = await testClient.callTool('get_server_stats', {});
      
      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      expect(output).toContain('Server Statistics');
      expect(output).toContain('Active Operations');
      expect(output).toContain('Workspace Directory');
      expect(output).toContain('Max File Size');
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent file reads gracefully', async () => {
      const result = await testClient.callTool('read_source_file', {
        filePath: 'non-existent.js'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('does not exist');
    });

    it('should validate tool parameters', async () => {
      const result = await testClient.callTool('read_source_file', {
        // Missing filePath parameter
      });

      expect(result.isError).toBe(true);
    });

    it('should handle invalid tool names', async () => {
      const result = await testClient.callTool('invalid_tool_name', {});
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown tool');
    });
  });
});

// Test client helper class
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

      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, 5000);

      const onData = (data: Buffer) => {
        responseData += data.toString();
        
        try {
          const response = JSON.parse(responseData);
          clearTimeout(timeout);
          this.serverProcess.stdout?.off('data', onData);
          
          if (response.error) {
            resolve({
              isError: true,
              content: [{ type: 'text', text: response.error.message }]
            });
          } else {
            const result = response.result || { content: [{ type: 'text', text: 'Success' }] };
            // 確保有 isError 屬性
            if (result.isError === undefined) {
              result.isError = false;
            }
            resolve(result);
          }
        } catch (e) {
          // Response not complete yet, wait for more data
        }
      };

      this.serverProcess.stdout?.on('data', onData);
      this.serverProcess.stdin?.write(JSON.stringify(request) + '\n');
    });
  }
}

// Jest configuration for package.json
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
  testTimeout: 30000
};
