/**
 * public/_headers 生成器（issue #28 / ADR 0002）。
 *
 * 单一事实源：scripts/security-headers.mjs（安全头模块）；本脚本只是入口，把
 * 模块整文件渲染的内容写入 public/_headers（生成物，提交进库，禁止手工编辑）。
 * prebuild 自动执行（npm run build 先跑本生成）；CI 漂移断言（deploy.yml）：
 * 重新生成后 git diff 必须为空。漂移修复流程：改模块 → 重跑生成 → 一并提交。
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderHeadersFile } from "./security-headers.mjs";

const target = fileURLToPath(new URL("../public/_headers", import.meta.url));
writeFileSync(target, renderHeadersFile());
console.log("[headers] 已生成 public/_headers（安全头模块单源渲染）");
