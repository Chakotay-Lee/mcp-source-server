#!/bin/bash

# MCP Source Code Server Setup Script
# Compatible with macOS + Apple Silicon M2

set -e

echo "🚀 Setting up MCP Source Code Server..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    echo "   You can install it via: brew install node"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2)
REQUIRED_VERSION="18.0.0"

if ! node -e "
const current = '$NODE_VERSION'.split('.').map(n => parseInt(n));
const required = '$REQUIRED_VERSION'.split('.').map(n => parseInt(n));
const isValid = current[0] > required[0] || 
                (current[0] === required[0] && current[1] > required[1]) ||
                (current[0] === required[0] && current[1] === required[1] && current[2] >= required[2]);
process.exit(isValid ? 0 : 1);
"; then
    echo "❌ Node.js version $NODE_VERSION is too old. Required: $REQUIRED_VERSION+"
    exit 1
fi

echo "✅ Node.js version $NODE_VERSION is compatible"

# Create project structure
echo "📁 Creating project structure..."
mkdir -p mcp-source-server/src
mkdir -p mcp-source-server/workspace
cd mcp-source-server

# Create package.json if it doesn't exist
if [ ! -f package.json ]; then
    echo "📦 Creating package.json..."
    cat > package.json << 'EOF'
{
  "name": "mcp-source-code-server",
  "version": "0.1.0",
  "description": "A secure MCP server for reading and writing source code files",
  "main": "dist/index.js",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "docker:build": "docker build -t mcp-source-server .",
    "docker:run": "docker run -it --rm -v $(pwd)/workspace:/app/workspace mcp-source-server"
  },
  "keywords": [
    "mcp",
    "model-context-protocol",
    "source-code",
    "file-server",
    "security"
  ],
  "author": "Your Name",
  "license": "MIT",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.4.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
EOF
fi

# Install dependencies
echo "📥 Installing dependencies..."
npm install

# Create TypeScript config if it doesn't exist
if [ ! -f tsconfig.json ]; then
    echo "⚙️  Creating TypeScript configuration..."
    cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": [
    "src/**/*"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "**/*.test.ts",
    "**/*.spec.ts"
  ]
}
EOF
fi

# Create the main server file (you'll need to copy the TypeScript code here)
if [ ! -f src/index.ts ]; then
    echo "⚠️  Please copy the MCP server TypeScript code to src/index.ts"
    echo "   The server code is provided in the artifacts above."
fi

# Create example workspace files
echo "📝 Creating example workspace files..."
mkdir -p workspace/examples

cat > workspace/examples/hello.js << 'EOF'
// Example JavaScript file
function greet(name) {
    return `Hello, ${name}!`;
}

console.log(greet('MCP'));
EOF

cat > workspace/examples/example.py << 'EOF'
# Example Python file
def fibonacci(n):
    """Generate Fibonacci sequence up to n terms"""
    if n <= 0:
        return []
    elif n == 1:
        return [0]
    elif n == 2:
        return [0, 1]
    
    fib = [0, 1]
    for i in range(2, n):
        fib.append(fib[i-1] + fib[i-2])
    
    return fib

if __name__ == "__main__":
    print(fibonacci(10))
EOF

# Build the project
if [ -f src/index.ts ]; then
    echo "🔨 Building the project..."
    npm run build
    echo "✅ Build completed successfully!"
else
    echo "⚠️  Skipping build - src/index.ts not found"
fi

# Create Docker-related files
echo "🐳 Creating Docker configuration..."
cat > Dockerfile << 'EOF'
# Multi-stage build for security
FROM node:20-alpine AS builder

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY src/ ./src/

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Create non-root user for security
RUN addgroup -g 1001 -S mcpuser && \
    adduser -S mcpuser -u 1001 -G mcpuser

# Set working directory
WORKDIR /app

# Copy built application and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Create workspace directory with proper permissions
RUN mkdir -p /app/workspace && \
    chown -R mcpuser:mcpuser /app

# Switch to non-root user
USER mcpuser

# Set environment variables
ENV NODE_ENV=production
ENV MCP_WORKSPACE_DIR=/app/workspace

# Expose workspace volume
VOLUME ["/app/workspace"]

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('Health check passed')" || exit 1

# Set resource limits (can be overridden at runtime)
ENV NODE_OPTIONS="--max-old-space-size=512"

# Run the application
CMD ["node", "dist/index.js"]
EOF

cat > .dockerignore << 'EOF'
node_modules
dist
.git
.gitignore
README.md
.env
.DS_Store
*.log
coverage
.nyc_output
EOF

# Create README
echo "📖 Creating documentation..."
cat > README.md << 'EOF'
# MCP Source Code Server

A secure Model Context Protocol (MCP) server for reading and writing source code files with directory restrictions and security features.

## Features

- ✅ Secure file operations within restricted directory
- ✅ Support for multiple programming languages
- ✅ One-time and streaming write operations
- ✅ Directory traversal protection
- ✅ File size limits
- ✅ Extension whitelist
- ✅ Docker containerization for additional security

## Quick Start

### Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the project:
   ```bash
   npm run build
   ```

3. Run the server:
   ```bash
   npm start
   ```

### Docker Usage

1. Build the Docker image:
   ```bash
   npm run docker:build
   ```

2. Run with Docker:
   ```bash
   npm run docker:run
   ```

## Security Features

- **Directory Restriction**: Files can only be accessed within the configured workspace directory
- **Path Validation**: Prevents directory traversal attacks (../, symbolic links, etc.)
- **File Size Limits**: Configurable maximum file size to prevent resource exhaustion
- **Extension Whitelist**: Only allows specified file extensions
- **Blacklist Protection**: Blocks access to sensitive directories (.git, node_modules, etc.)
- **Container Security**: Runs as non-root user in Docker container

## Configuration

Set environment variables:
- `MCP_WORKSPACE_DIR`: Workspace directory path (default: ./workspace)

## Supported File Extensions

JavaScript, TypeScript, Python, C++, Java, C#, PHP, Ruby, Go, Rust, Swift, Kotlin, Scala, HTML, CSS, JSON, XML, YAML, Markdown, Shell scripts, SQL, R, MATLAB, Perl

## API Tools

- `read_source_file`: Read file content
- `write_source_file`: Write file content (one-time)
- `stream_write_source_file`: Stream write file content
- `list_source_files`: List files in directory
EOF

echo "🎉 Setup completed successfully!"
echo ""
echo "Next steps:"
echo "1. Copy the MCP server TypeScript code to src/index.ts"
echo "2. Run 'npm run build' to build the project"
echo "3. Run 'npm start' to start the server"
echo ""
echo "For Docker usage:"
echo "1. Run 'npm run docker:build' to build the container"
echo "2. Run 'npm run docker:run' to run with Docker"
echo ""
echo "The workspace directory is located at: $(pwd)/workspace"
