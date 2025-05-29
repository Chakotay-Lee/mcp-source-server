# はじめに

AIを使ったVibe Codingでプログラム開発をしたいけれど、CursorやWindsurfなどのツールに加えて追加のAPI料金を払うしかないのでしょうか？既に月額料金を支払っているClaude Desktopなどを開発に活用できないのはなぜでしょうか？
このような考えから、私はこのMCP Serverを開発しました（正確には、Claudeに開発を手伝ってもらいました）。
このMCP Serverを使用すると、AIがプロジェクト内の関連ファイルを自動的に検索し、分析した上で自動修正を行います。ビルドや実行は依然としてユーザー自身が行い、エラーメッセージを会話に貼り付ける必要がありますが、既に月額サービスを利用しているユーザーにとって、コピー＆ペーストの時間を大幅に節約でき、開発フローがより効率的になります。

## ✨ 機能

### コアファイル操作
- **ファイル読み取り**：サイズ制限付きでソースコードファイルを安全に読み取り
- **ファイル書き込み**：オプションのバックアップ機能付きでファイルを作成・更新
- **ファイル一覧**：メタデータ付きでディレクトリ内容を閲覧
- **ストリーム書き込み**：大きなファイルの効率的な書き込み処理

### 🆕 拡張機能 (v0.2.1)
- **ファイル削除**：自動バックアップ付きで安全にファイルを削除
- **ファイル名変更/移動**：ファイル名を変更またはディレクトリ間で移動
- **部分書き込み**：LLM最適化機能で、ファイル全体を書き直すことなく特定セクションを更新

### 🔒 セキュリティ機能
- **ディレクトリトラバーサル保護**：ワークスペース外へのアクセスを防止
- **ファイル拡張子ホワイトリスト**：承認されたファイルタイプのみ許可
- **パスブラックリスト**：機密ディレクトリへのアクセスをブロック
- **サイズ制限**：過度なファイル操作を防止
- **並行操作制限**：システムリソースを保護

## 🚀 クイックスタート

### インストール

```bash
# リポジトリをクローン
git clone git@github_alexlee:Chakotay-Lee/mcp-source-server.git
cd mcp-source-server

# 依存関係をインストール
npm install

# プロジェクトをビルド
npm run build

# テストを実行
npm test
```

### Claude Desktop設定

Claude Desktopの設定ファイルに以下の設定を追加してください：

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

`/path/to/your/mcp-source-server`をこのプロジェクトの実際のパスに、`/path/to/your/workspace`を希望するワークスペースディレクトリに置き換えてください。

## 📋 利用可能なツール

### 基本操作
- `read_source_file` - ファイル内容の読み取り
- `write_source_file` - ファイルへの内容書き込み
- `list_source_files` - ディレクトリ内のファイル一覧
- `stream_write_source_file` - 大きなファイルのストリーム書き込み

### 🆕 拡張操作
- `delete_source_file` - バックアップオプション付きファイル削除
- `rename_source_file` - バックアップ付きファイル名変更または移動
- `partial_write_source_file` - 特定ファイル内容の更新（LLM最適化）

### ユーティリティ
- `get_server_stats` - サーバーステータスと統計情報の取得

## 🔧 設定

### 環境変数
- `MCP_WORKSPACE_DIR`: ワークスペースディレクトリを設定（デフォルト: `./workspace`）

### セキュリティ設定
サーバーには組み込みのセキュリティ設定が含まれています：

#### 許可されるファイル拡張子
- プログラミング言語: `.js`, `.ts`, `.jsx`, `.tsx`, `.py`, `.cpp`, `.c`, `.h`など
- Web技術: `.html`, `.css`, `.scss`, `.json`, `.xml`, `.yaml`など
- ドキュメント: `.md`, `.txt`, `.rst`, `.adoc`
- テンプレート: `.template`, `.example`, `.sample`, `.config`
- 拡張子なし: `Dockerfile`, `Makefile`, `.gitignore`など

#### ブラックリストパス
- `..` - ディレクトリトラバーサル防止
- `.git/` - Gitリポジトリファイル
- `node_modules/` - 依存関係ディレクトリ
- `.env.` - 環境ファイル（テンプレートを除く）
- `secrets/` - 機密ディレクトリ
- システムファイル（`.DS_Store`, `Thumbs.db`）

## 💡 使用例

### 基本ファイル操作

```javascript
// ファイルを読み取り
await callTool('read_source_file', { filePath: 'src/index.js' });

// ファイルを書き込み
await callTool('write_source_file', {
  filePath: 'src/new-file.js',
  content: 'console.log("Hello World");',
  createBackup: true
});

// ファイル一覧
await callTool('list_source_files', { dirPath: 'src' });
```

### 🆕 拡張操作

```javascript
// ファイルを削除（バックアップ付き）
await callTool('delete_source_file', {
  filePath: 'old-file.js',
  createBackup: true
});

// ファイル名変更/移動
await callTool('rename_source_file', {
  oldPath: 'old-name.js',
  newPath: 'src/new-name.js',
  createBackup: true
});

// LLM最適化部分更新
await callTool('partial_write_source_file', {
  filePath: 'utils.js',
  oldContent: 'function oldFunction() { return "old"; }',
  newContent: 'function newFunction() { return "updated"; }'
});
```

## 🛡️ セキュリティ注意事項

### 許可される開発ファイル
✅ `.gitignore`, `.env.template`, `Dockerfile`, `Makefile`, `package.json`, `tsconfig.json`

### 保護されるファイル
🔒 `.env`, `.env.local`, `.env.production`, `.git/config`, `node_modules/`, `secrets/`

## 🧪 テスト

```bash
# 全てのテストを実行
npm test

# 特定のテストを実行
npm test -- --testNamePattern="should allow development configuration files"

# カバレッジ付きテストを実行
npm run test:coverage
```

## 🔄 バックアップシステム

サーバーは`.backups`ディレクトリにタイムスタンプ付きバックアップを自動作成します：
- 形式: `filename.timestamp.backup`
- 場所: `workspace/.backups/`
- 定期的なクリーンアップを推奨

## 📊 パフォーマンス機能

- **並行操作制限**：システム過負荷を防止
- **ファイルサイズ制限**：デフォルト1ファイル10MB
- **LLM最適化**：部分書き込みにより小さな変更のファイルI/Oを削減
- **ストリーム処理**：大きなファイルの効率的な処理

## 🤝 貢献

1. リポジトリをフォーク
2. 機能ブランチを作成
3. 変更を実施
4. 新機能にテストを追加
5. 全てのテストが通ることを確認
6. プルリクエストを提出

## 📝 ライセンス

[あなたのライセンス]

## 🆕 変更履歴

### v0.2.1
- ✨ ファイル削除機能を追加
- ✨ ファイル名変更/移動機能を追加
- ✨ LLM最適化部分書き込み機能を追加
- 🔧 .env.templateファイルアクセスを修正
- 🔧 精密パターンマッチングでセキュリティを強化
- 🧪 包括的テストスイート（21テスト）

### v0.1.0
- 🎉 基本ファイル操作付き初期リリース
- 🔒 セキュリティ機能とパス検証
- 📚 MCPプロトコル実装
