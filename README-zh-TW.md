# 前言
想要用AI進行Vibe Coding程式開發，是否只能依賴Cursor或Windsurf等工具，還要額外支付API費用？為什麼不能充分利用已經付費訂閱的Claude Desktop等AI助手來進行開發工作？
基於這樣的思考，我開發了這個MCP Server（或者說，我請Claude協助開發了這個工具）。
使用這個MCP Server後，AI助手能夠自動搜尋您專案中的相關檔案，進行智能分析並提供自動修正建議。雖然專案的建置（build）和執行（run）仍需要開發者親自操作，並將錯誤訊息貼回對話中，但對於已經付費訂閱AI服務的使用者而言，這能大幅節省重複的複製貼上時間，讓開發流程更加順暢。

## ✨ 功能特色

### 核心檔案操作
- **讀取檔案**：安全讀取原始碼檔案，具有大小限制
- **寫入檔案**：建立和更新檔案，可選擇備份
- **列出檔案**：瀏覽目錄內容及中繼資料
- **串流寫入**：高效處理大型檔案寫入

### 🆕 增強功能 (v0.2.1)
- **刪除檔案**：安全刪除檔案，自動備份
- **重新命名/移動檔案**：重新命名檔案或在目錄間移動
- **部分寫入**：針對 LLM 最佳化的功能，可更新檔案特定區段而無需重寫整個檔案

### 🔒 安全功能
- **目錄穿越保護**：防止存取工作區外的檔案
- **檔案副檔名白名單**：僅允許核准的檔案類型
- **路徑黑名單**：阻擋存取敏感目錄
- **大小限制**：防止過度的檔案操作
- **併發操作限制**：保護系統資源

## 🚀 快速開始

### 安裝

```bash
# 複製專案
git clone git@hgithub.com/Chakotay-Lee/mcp-source-server
cd mcp-source-server

# 安裝相依性
npm install

# 建置專案
npm run build

# 執行測試
npm test
```

### Claude Desktop 設定

將以下設定新增至您的 Claude Desktop 設定檔：

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

請將 `/path/to/your/mcp-source-server` 替換為此專案的實際路徑，並將 `/path/to/your/workspace` 替換為您想要的工作區目錄。

## 📋 可用工具

### 基本操作
- `read_source_file` - 讀取檔案內容
- `write_source_file` - 寫入內容至檔案
- `list_source_files` - 列出目錄中的檔案
- `stream_write_source_file` - 大型檔案的串流寫入

### 🆕 增強操作
- `delete_source_file` - 刪除檔案，可選擇備份
- `rename_source_file` - 重新命名或移動檔案，可備份
- `partial_write_source_file` - 更新特定檔案內容（針對 LLM 最佳化）

### 實用工具
- `get_server_stats` - 取得伺服器狀態和統計資訊

## 🔧 設定

### 環境變數
- `MCP_WORKSPACE_DIR`: 設定工作區目錄 (預設: `./workspace`)

### 安全設定
伺服器包含內建的安全設定：

#### 允許的檔案副檔名
- 程式語言: `.js`, `.ts`, `.jsx`, `.tsx`, `.py`, `.cpp`, `.c`, `.h` 等
- 網頁技術: `.html`, `.css`, `.scss`, `.json`, `.xml`, `.yaml` 等
- 文件: `.md`, `.txt`, `.rst`, `.adoc`
- 範本: `.template`, `.example`, `.sample`, `.config`
- 無副檔名: `Dockerfile`, `Makefile`, `.gitignore` 等

#### 黑名單路徑
- `..` - 防止目錄穿越
- `.git/` - Git 儲存庫檔案
- `node_modules/` - 相依性目錄
- `.env.` - 環境檔案（範本除外）
- `secrets/` - 機密目錄
- 系統檔案 (`.DS_Store`, `Thumbs.db`)

## 💡 使用範例

### 基本檔案操作

```javascript
// 讀取檔案
await callTool('read_source_file', { filePath: 'src/index.js' });

// 寫入檔案
await callTool('write_source_file', {
  filePath: 'src/new-file.js',
  content: 'console.log("Hello World");',
  createBackup: true
});

// 列出檔案
await callTool('list_source_files', { dirPath: 'src' });
```

### 🆕 增強操作

```javascript
// 刪除檔案（含備份）
await callTool('delete_source_file', {
  filePath: 'old-file.js',
  createBackup: true
});

// 重新命名/移動檔案
await callTool('rename_source_file', {
  oldPath: 'old-name.js',
  newPath: 'src/new-name.js',
  createBackup: true
});

// LLM 最佳化的部分更新
await callTool('partial_write_source_file', {
  filePath: 'utils.js',
  oldContent: 'function oldFunction() { return "old"; }',
  newContent: 'function newFunction() { return "updated"; }'
});
```

## 🛡️ 安全注意事項

### 允許的開發檔案
✅ `.gitignore`, `.env.template`, `Dockerfile`, `Makefile`, `package.json`, `tsconfig.json`

### 受保護的檔案
🔒 `.env`, `.env.local`, `.env.production`, `.git/config`, `node_modules/`, `secrets/`

## 🧪 測試

```bash
# 執行所有測試
npm test

# 執行特定測試
npm test -- --testNamePattern="should allow development configuration files"

# 執行含覆蓋率的測試
npm run test:coverage
```

## 🔄 備份系統

伺服器會在 `.backups` 目錄中自動建立帶有時間戳的備份：
- 格式: `filename.timestamp.backup`
- 位置: `workspace/.backups/`
- 建議定期清理

## 📊 效能特色

- **併發操作限制**：防止系統過載
- **檔案大小限制**：預設每檔案 10MB
- **LLM 最佳化**：部分寫入可減少小變更的檔案 I/O
- **串流處理**：高效處理大型檔案

## 🤝 貢獻

1. Fork 此儲存庫
2. 建立功能分支
3. 進行您的變更
4. 為新功能新增測試
5. 確保所有測試通過
6. 提交 pull request

## 📝 授權

[您的授權條款]

## 🆕 更新日誌

### v0.2.1
- ✨ 新增檔案刪除功能
- ✨ 新增檔案重新命名/移動功能
- ✨ 新增 LLM 最佳化的部分寫入功能
- 🔧 修正 .env.template 檔案存取
- 🔧 以精確模式匹配增強安全性
- 🧪 完整測試套件（21 個測試）

### v0.1.0
- 🎉 具備基本檔案操作的初始版本
- 🔒 安全功能和路徑驗證
- 📚 MCP 協議實作
