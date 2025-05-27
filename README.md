# MCP Source Code Server 部署與使用指南

## 🚀 快速開始

### 前置需求
- **Node.js** 18.0.0 或更高版本
- **macOS** (已針對 Apple Silicon M2 最佳化)
- **Docker** (可選，用於容器化部署)

### 1. 本地安裝

```bash
# 1. 建立專案目錄
mkdir mcp-source-server && cd mcp-source-server

# 2. 複製所有原始碼檔案到對應位置
# - src/index.ts (主要伺服器檔案)
# - package.json
# - tsconfig.json
# - .env (環境配置)

# 3. 安裝相依性
npm install

# 4. 建置專案
npm run build

# 5. 啟動伺服器
npm start
```

### 2. Docker 部署

```bash
# 建置 Docker 映像檔
npm run docker:build

# 執行容器 (掛載本地 workspace)
npm run docker:run

# 或者使用 Docker Compose (建議)
docker-compose up -d
```

## 📁 目錄結構

```
mcp-source-server/
├── src/
│   └── index.ts              # 主要伺服器檔案
├── workspace/                # 工作區目錄 (安全限制範圍)
│   ├── examples/            # 範例程式檔案
│   └── projects/            # 你的專案檔案
├── logs/                    # 日誌檔案
│   ├── mcp-server.log      # 一般日誌
│   └── audit.log           # 審計日誌
├── backups/                 # 自動備份檔案
├── config/                  # 配置檔案
│   └── security.json       # 安全配置
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
└── .env                     # 環境變數配置
```

## ⚙️ 配置說明

### 環境變數配置

創建 `.env` 檔案來自訂設定：

```bash
# 工作區設定
MCP_WORKSPACE_DIR=./workspace      # 工作區目錄路徑
MCP_MAX_FILE_SIZE=10485760        # 最大檔案大小 (10MB)
MCP_MAX_CONCURRENT_OPS=10         # 最大並行操作數

# 安全設定
MCP_RATE_LIMITING=true            # 啟用速率限制
MCP_MAX_REQUESTS_PER_MINUTE=100   # 每分鐘最大請求數
MCP_MAX_CONNECTIONS=5             # 最大並行連線數

# 日誌設定
MCP_LOGGING=true                  # 啟用日誌記錄
MCP_LOG_LEVEL=info               # 日誌等級
```

### 安全配置檔案

在 `config/security.json` 中進行詳細的安全設定：

- **允許的副檔名**：限制可存取的檔案類型
- **黑名單路徑**：禁止存取的目錄和檔案
- **速率限制**：防止濫用的保護機制
- **日誌設定**：完整的操作審計追蹤

## 🛠 API 工具說明

### 1. `read_source_file`
讀取指定的原始碼檔案

```json
{
  "name": "read_source_file",
  "arguments": {
    "filePath": "examples/hello.js"
  }
}
```

### 2. `write_source_file`
寫入內容到檔案 (支援自動備份)

```json
{
  "name": "write_source_file",
  "arguments": {
    "filePath": "projects/new-feature.js",
    "content": "console.log('Hello, World!');",
    "createBackup": true
  }
}
```

### 3. `stream_write_source_file`
使用串流方式寫入大型檔案

```json
{
  "name": "stream_write_source_file",
  "arguments": {
    "filePath": "projects/large-file.py",
    "content": "# Large Python script content..."
  }
}
```

### 4. `list_source_files`
列出目錄中的檔案 (包含詳細資訊)

```json
{
  "name": "list_source_files",
  "arguments": {
    "dirPath": "projects"
  }
}
```

### 5. `get_server_stats`
取得伺服器狀態統計

```json
{
  "name": "get_server_stats",
  "arguments": {}
}
```

## 🔒 安全特性

### 1. 路徑安全
- **目錄遍歷防護**：阻止 `../` 和符號連結攻擊
- **路徑正規化**：自動處理路徑格式
- **範圍限制**：僅允許存取指定工作區內的檔案

### 2. 檔案類型控制
- **副檔名白名單**：僅允許指定的程式語言檔案
- **黑名單保護**：自動阻擋敏感目錄和檔案
- **檔案大小限制**：防止資源耗盡攻擊

### 3. 速率限制
- **請求頻率控制**：每分鐘最大請求數限制
- **並行操作限制**：防止系統負載過高
- **連線數限制**：控制同時連線數量

### 4. 審計日誌
- **操作記錄**：完整記錄所有檔案操作
- **安全事件**：記錄安全相關事件
- **效能監控**：追蹤操作時間和系統負載

## 🐳 Docker 部署

### Docker Compose 配置

創建 `docker-compose.yml`：

```yaml
version: '3.8'
services:
  mcp-server:
    build: .
    container_name: mcp-source-server
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - MCP_WORKSPACE_DIR=/app/workspace
    volumes:
      - ./workspace:/app/workspace
      - ./logs:/app/logs
      - ./backups:/app/backups
    user: "1001:1001"
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp
    healthcheck:
      test: ["CMD", "node", "-e", "console.log('Health check')"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### 執行 Docker 容器

```bash
# 使用 Docker Compose
docker-compose up -d

# 檢查容器狀態
docker-compose ps

# 查看日誌
docker-compose logs -f

# 停止容器
docker-compose down
```

## 🔧 疑難排解

### 常見問題

1. **權限錯誤**
   ```bash
   # 確保工作區目錄有正確權限
   chmod 755 workspace/
   chown -R $(whoami) workspace/
   ```

2. **Node.js 版本問題**
   ```bash
   # 使用 nvm 管理 Node.js 版本
   nvm install 20
   nvm use 20
   ```

3. **Docker 容器權限問題**
   ```bash
   # 設定正確的使用者 ID
   export DOCKER_USER_ID=$(id -u)
   export DOCKER_GROUP_ID=$(id -g)
   ```

### 日誌檢查

```bash
# 查看一般日誌
tail -f logs/mcp-server.log

# 查看審計日誌
tail -f logs/audit.log

# 使用 jq 格式化 JSON 日誌 (如果有的話)
tail -f logs/mcp-server.log | jq .
```

## 📈 效能調優

### 系統資源最佳化

1. **記憶體使用**
   ```bash
   # 調整 Node.js 記憶體限制
   export NODE_OPTIONS="--max-old-space-size=1024"
   ```

2. **並行操作調整**
   ```bash
   # 根據系統規格調整並行操作數
   export MCP_MAX_CONCURRENT_OPS=20
   ```

3. **檔案大小限制**
   ```bash
   # 調整最大檔案大小 (50MB)
   export MCP_MAX_FILE_SIZE=52428800
   ```

## 🔄 更新與維護

### 版本更新

```bash
# 拉取最新程式碼
git pull origin main

# 重新建置
npm run build

# 重新啟動服務
npm start

# Docker 更新
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### 備份管理

```bash
# 手動備份工作區
tar -czf backup-$(date +%Y%m%d).tar.gz workspace/

# 清理舊備份 (保留最近 30 天)
find backups/ -name "*.backup" -mtime +30 -delete
```

## 📞 技術支援

如果遇到問題，請檢查：

1. **日誌檔案**：查看 `logs/` 目錄中的詳細錯誤資訊
2. **環境設定**：確認 `.env` 檔案配置正確
3. **權限設定**：確保檔案和目錄有適當權限
4. **系統資源**：檢查記憶體和磁碟空間

---

這個 MCP Server 專為 C++ 開發者設計，提供了企業級的安全性和效能，同時保持使用的簡便性。透過完整的配置選項和容器化支援，你可以根據需求靈活部署和擴展。
