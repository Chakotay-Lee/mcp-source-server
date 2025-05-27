// test/setup.ts
import { jest } from '@jest/globals';

// 設定測試環境
beforeAll(() => {
  // 設定測試用的環境變數
  process.env.NODE_ENV = 'test';
  process.env.MCP_WORKSPACE_DIR = './test-workspace';
  process.env.MCP_LOG_LEVEL = 'error'; // 減少測試時的日誌輸出
});

afterAll(() => {
  // 清理測試環境
});

// 全域 mock 設定
jest.setTimeout(30000);
