import { defineConfig } from "vitest/config";

// Worker 测试运行在 Node 环境；独立的配置文件也避免 vitest 向上找到
// 根目录的 jsdom 配置（抓取管线测试）。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
