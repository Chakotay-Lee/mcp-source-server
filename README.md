# Preface

Want to do Vibe Coding with AI assistance but tired of being limited to tools like Cursor or Windsurf with additional API costs? Why not leverage the AI assistants you're already paying for, like Claude Desktop, for your development workflow?
With this mindset, I developed this MCP Server (or rather, I had Claude help me develop this tool).
Once you set up this MCP Server, your AI assistant can automatically search through relevant files in your project, analyze the codebase, and provide intelligent correction suggestions. While you'll still need to handle building and running your project manually and paste error messages back into the conversation, this approach can significantly reduce repetitive copy-paste work for users who are already subscribed to AI services, making the development process much more streamlined.

## ✨ Features

### Core File Operations
- **Read Files**: Securely read source code files with size limits
- **Write Files**: Create and update files with optional backup
- **List Files**: Browse directory contents with metadata
- **Stream Writing**: Efficient handling of large file writes

### 🆕 Enhanced Operations (v0.2.1)
- **Delete Files**: Safely delete files with automatic backup
- **Rename/Move Files**: Rename files or move them between directories
- **Partial Write**: LLM-optimized feature to update specific file sections without rewriting entire files

### 🔒 Security Features
- **Directory Traversal Protection**: Prevents access outside workspace
- **File Extension Whitelist**: Only allows approved file types
- **Path Blacklisting**: Blocks access to sensitive directories
- **Size Limits**: Prevents excessive file operations
- **Concurrent Operation Limits**: Protects system resources

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone git@hgithub.com/Chakotay-Lee/mcp-source-server
cd mcp-source-server

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

### Claude Desktop Configuration

Add the following configuration to your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "source-code-server": {
      "command": "node",
      "args": ["/path/to/your/mcp-source-server/dist/index.js"],
      "env": {
        "MCP_WORKSPACE_DIR": "/path/to/your/workspace"
      }
    }
  }
}
```

Replace `/path/to/your/mcp-source-server` with the actual path to this project, and `/path/to/your/workspace` with your desired workspace directory.

## 📋 Available Tools

### Basic Operations
- `read_source_file` - Read file content
- `write_source_file` - Write content to file
- `list_source_files` - List files in directory
- `stream_write_source_file` - Stream write for large files

### 🆕 Enhanced Operations
- `delete_source_file` - Delete file with backup option
- `rename_source_file` - Rename or move file with backup
- `partial_write_source_file` - Update specific file content (LLM optimized)

### Utility
- `get_server_stats` - Get server status and statistics

## 🔧 Configuration

### Environment Variables
- `MCP_WORKSPACE_DIR`: Set the workspace directory (default: `./workspace`)

### Security Configuration
The server includes built-in security configurations:

#### Allowed File Extensions
- Programming: `.js`, `.ts`, `.jsx`, `.tsx`, `.py`, `.cpp`, `.c`, `.h`, etc.
- Web: `.html`, `.css`, `.scss`, `.json`, `.xml`, `.yaml`, etc.
- Documentation: `.md`, `.txt`, `.rst`, `.adoc`
- Templates: `.template`, `.example`, `.sample`, `.config`
- No extension: `Dockerfile`, `Makefile`, `.gitignore`, etc.

#### Blacklisted Paths
- `..` - Directory traversal prevention
- `.git/` - Git repository files
- `node_modules/` - Dependencies directory
- `.env.` - Environment files (except templates)
- `secrets/` - Secrets directory
- System files (`.DS_Store`, `Thumbs.db`)

## 💡 Usage Examples

### Basic File Operations

```javascript
// Read a file
await callTool('read_source_file', { filePath: 'src/index.js' });

// Write a file
await callTool('write_source_file', {
  filePath: 'src/new-file.js',
  content: 'console.log("Hello World");',
  createBackup: true
});

// List files
await callTool('list_source_files', { dirPath: 'src' });
```

### 🆕 Enhanced Operations

```javascript
// Delete a file (with backup)
await callTool('delete_source_file', {
  filePath: 'old-file.js',
  createBackup: true
});

// Rename/move a file
await callTool('rename_source_file', {
  oldPath: 'old-name.js',
  newPath: 'src/new-name.js',
  createBackup: true
});

// LLM-optimized partial update
await callTool('partial_write_source_file', {
  filePath: 'utils.js',
  oldContent: 'function oldFunction() { return "old"; }',
  newContent: 'function newFunction() { return "updated"; }'
});
```

## 🛡️ Security Notes

### Allowed Development Files
✅ `.gitignore`, `.env.template`, `Dockerfile`, `Makefile`, `package.json`, `tsconfig.json`

### Protected Files
🔒 `.env`, `.env.local`, `.env.production`, `.git/config`, `node_modules/`, `secrets/`

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test
npm test -- --testNamePattern="should allow development configuration files"

# Run with coverage
npm run test:coverage
```

## 🔄 Backup System

The server automatically creates backups in the `.backups` directory with timestamps:
- Format: `filename.timestamp.backup`
- Location: `workspace/.backups/`
- Automatic cleanup recommended

## 📊 Performance Features

- **Concurrent Operation Limits**: Prevents system overload
- **File Size Limits**: Default 10MB per file
- **LLM Optimization**: Partial write reduces file I/O for small changes
- **Stream Processing**: Efficient handling of large files

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## 📝 License

[Your License Here]

## 🆕 Changelog

### v0.2.1
- ✨ Added file deletion functionality
- ✨ Added file rename/move functionality  
- ✨ Added LLM-optimized partial write functionality
- 🔧 Fixed .env.template file access
- 🔧 Enhanced security with precise pattern matching
- 🧪 Comprehensive test suite (21 tests)

### v0.1.0
- 🎉 Initial release with basic file operations
- 🔒 Security features and path validation
- 📚 MCP protocol implementation
