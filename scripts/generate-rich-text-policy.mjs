/**
 * 富文本白名单生成器（issue #92 / M6 + #99 / M19）。
 *
 * 单一事实源：仓库根 rich-text-policy.json。
 * 生成物：worker/src/generated/rich-text-policy.ts（Worker 消毒器消费）。
 * 前端 src/utils/markdownPolicy.ts 保留为 DOMPurify / 预览配置源，但由
 * tests/rich-text-policy.test.ts 交叉守卫它与本描述符的标签/属性/scheme 一致，
 * 消除「前端白名单、Worker 正则黑名单、导出常量零引用」三套并存的漂移。
 *
 * 为何 Worker 用生成物而非直接 import 前端 TS：根包与 worker 是独立 TS 包
 * （根 tsconfig exclude worker；worker rootDir=src），跨包 import 破坏门禁边界，
 * 沿用 settings-rules / cors-origins 的双端生成模式。
 *
 * 漂移守卫：CI 重跑本脚本后 git diff 必须为空（deploy.yml）。
 *
 * 零依赖：node:fs / node:url，node 22 直跑；描述符形状非法即非零退出。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const descriptorPath = fileURLToPath(
  new URL("../rich-text-policy.json", import.meta.url)
);
const output = new URL(
  "../worker/src/generated/rich-text-policy.ts",
  import.meta.url
);

function fail(message) {
  console.error("rich-text-policy.json：" + message);
  process.exit(1);
}

let d;
try {
  d = JSON.parse(readFileSync(descriptorPath, "utf8"));
} catch (e) {
  fail("无法解析 JSON：" + e.message);
}
for (const key of [
  "tags",
  "attributes",
  "attributeGlobs",
  "uriAttributes",
  "schemes",
  "imgExtraSchemes",
  "forbidContentTags",
]) {
  if (!Array.isArray(d[key]) || d[key].length === 0)
    fail(`${key} 必须是非空数组`);
  if (!d[key].every((v) => typeof v === "string" && v)) fail(`${key} 含非法项`);
}
for (const key of ["tags", "attributes", "schemes", "forbidContentTags"]) {
  if (new Set(d[key]).size !== d[key].length) fail(`${key} 存在重复项`);
}

const banner = `/**
 * 生成物 —— Worker 富文本消毒白名单（issue #92 / M6 + #99 / M19）。禁止手工编辑。
 *
 * 单一事实源：仓库根 rich-text-policy.json。
 * 本文件由 npm run gen:rich-text（scripts/generate-rich-text-policy.mjs）生成；
 * 前端 markdownPolicy.ts 与本策略的一致性由 tests/rich-text-policy.test.ts 守卫。
 * 漂移修复流程：改 rich-text-policy.json → npm run gen:rich-text → 一并提交。
 * CI 漂移断言：重新生成 → git diff 必须为空（.github/workflows/deploy.yml）。
 */

export const RICH_TEXT_TAGS: readonly string[] = Object.freeze([
${d.tags.map((v) => `  ${JSON.stringify(v)},`).join("\n")}
]);

export const RICH_TEXT_ATTRIBUTES: readonly string[] = Object.freeze([
${d.attributes.map((v) => `  ${JSON.stringify(v)},`).join("\n")}
]);

export const RICH_TEXT_ATTRIBUTE_GLOBS: readonly string[] = Object.freeze([
${d.attributeGlobs.map((v) => `  ${JSON.stringify(v)},`).join("\n")}
]);

export const RICH_TEXT_URI_ATTRIBUTES: readonly string[] = Object.freeze([
${d.uriAttributes.map((v) => `  ${JSON.stringify(v)},`).join("\n")}
]);

export const RICH_TEXT_SCHEMES: readonly string[] = Object.freeze([
${d.schemes.map((v) => `  ${JSON.stringify(v)},`).join("\n")}
]);

export const RICH_TEXT_IMG_EXTRA_SCHEMES: readonly string[] = Object.freeze([
${d.imgExtraSchemes.map((v) => `  ${JSON.stringify(v)},`).join("\n")}
]);

export const RICH_TEXT_FORBID_CONTENT_TAGS: readonly string[] = Object.freeze([
${d.forbidContentTags.map((v) => `  ${JSON.stringify(v)},`).join("\n")}
]);
`;

mkdirSync(new URL(".", output), { recursive: true });
writeFileSync(fileURLToPath(output), banner, "utf8");
console.log(
  `已生成 Worker 富文本白名单：${d.tags.length} 标签 / ${d.attributes.length} 属性 / ${d.schemes.length} scheme → worker/src/generated/rich-text-policy.ts`
);
