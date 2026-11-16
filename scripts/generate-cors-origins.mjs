/**
 * CORS Origin 白名单生成器（issue #85 / H4）。
 *
 * 单一事实源：仓库根 cors.origins.json（手写 URL 列表）。
 * 双端生成物：src/generated/cors-origins.ts 与 worker/src/generated/cors-origins.ts，
 * 内容字节一致，禁止手工编辑。Worker（cors.ts）与 Pages 代理（api-proxy.ts）
 * 各自 import 对应生成物，消除「Worker 已收紧、代理仍写死 *」的双份漂移。
 *
 * 为何是「生成两份」而非两端 import 同一文件：根包与 worker 是独立 TS 包
 * （根 tsconfig exclude worker；worker rootDir=src），跨包 import 会破坏各自门禁边界。
 * 故沿用仓库既有 settings.rules.json 的双端生成模式（scripts/generate-settings-rules.mjs）。
 *
 * 漂移守卫：CI 重跑本脚本后 git diff 必须为空（deploy.yml）；
 * worker/tests/cors_origins.test.ts 另做两端字节一致 + URL 合法性机械守卫。
 *
 * 零依赖：node:fs / node:url，node 22 直跑；描述符形状非法即非零退出。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const descriptorPath = fileURLToPath(
  new URL("../cors.origins.json", import.meta.url)
);
const outputs = [
  new URL("../src/generated/cors-origins.ts", import.meta.url),
  new URL("../worker/src/generated/cors-origins.ts", import.meta.url),
];

function fail(message) {
  console.error("cors.origins.json：" + message);
  process.exit(1);
}

let descriptor;
try {
  descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
} catch (e) {
  fail("无法解析 JSON：" + e.message);
}
if (!Array.isArray(descriptor.origins) || descriptor.origins.length === 0) {
  fail("origins 必须是非空数组");
}
for (const origin of descriptor.origins) {
  if (typeof origin !== "string" || !origin) fail("存在非法的空 Origin");
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    fail(`Origin 不是合法 URL：${origin}`);
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    fail(`Origin 不得含路径/查询/片段：${origin}`);
  }
}
if (new Set(descriptor.origins).size !== descriptor.origins.length) {
  fail("origins 存在重复项");
}

const banner = `/**
 * 生成物 —— 双端 CORS Origin 白名单（issue #85 / H4）。禁止手工编辑。
 *
 * 单一事实源：仓库根 cors.origins.json。
 * 本文件由 npm run gen:cors（scripts/generate-cors-origins.mjs）生成：
 * 根包 src/generated/cors-origins.ts 与 worker/src/generated/cors-origins.ts
 * 内容字节一致，两端 CORS 逻辑只消费本模块，不得在任何一处手抄列表。
 * 漂移修复流程：改 cors.origins.json → npm run gen:cors → 一并提交；
 * CI 漂移断言：重新生成 → git diff 必须为空（.github/workflows/deploy.yml）。
 */

/** 允许跨域回显 ACAO 的 Origin 精确列表（精确匹配，无后缀通配） */
export const ALLOWED_ORIGINS: readonly string[] = Object.freeze([
${descriptor.origins.map((o) => `  ${JSON.stringify(o)},`).join("\n")}
]);

/** Origin 是否在白名单；无 Origin（同源请求）返回 false */
export function isAllowedOrigin(origin: string | null | undefined): origin is string {
  return !!origin && ALLOWED_ORIGINS.includes(origin);
}
`;

for (const output of outputs) {
  mkdirSync(new URL(".", output), { recursive: true });
  writeFileSync(fileURLToPath(output), banner, "utf8");
}

console.log(
  `已生成 CORS 白名单（${descriptor.origins.length} 项）：src/generated/cors-origins.ts + worker/src/generated/cors-origins.ts`
);
