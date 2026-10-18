/**
 * 设置白名单规则生成器（issue #27 / ADR 0001）。
 *
 * 单一事实源：仓库根 settings.rules.json —— 手写规则描述符（词汇表见 GLOSSARY.md）。
 * 双端生成物：src/generated/settings-rules.ts 与 worker/src/generated/settings-rules.ts，
 * 两份内容字节一致，禁止手工编辑。改规则只改描述符，然后重跑本脚本（npm run gen:settings），
 * 描述符与生成物一并提交。CI 漂移断言（deploy.yml）：重新生成 → git diff 必须为空。
 *
 * 实现约束：零依赖（node:fs / node:url），node 22 直跑；描述符形状不合法即非零退出，
 * 让问题在 CI 漂移断言里显式红掉，而不是生成一份静默偏移的规则表。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const descriptorPath = fileURLToPath(
  new URL("../settings.rules.json", import.meta.url)
);
const outputs = [
  new URL("../src/generated/settings-rules.ts", import.meta.url),
  new URL("../worker/src/generated/settings-rules.ts", import.meta.url),
];

function fail(message) {
  console.error("settings.rules.json：" + message);
  process.exit(1);
}

const d = JSON.parse(readFileSync(descriptorPath, "utf8"));

/* ── 描述符形状校验（本地 fail-fast，与生成物消费者各有一份保障面） ── */

if (!d.patterns || typeof d.patterns !== "object") fail("缺少 patterns");
for (const [name, src] of Object.entries(d.patterns)) {
  if (typeof src !== "string" || !src) fail(`pattern ${name} 必须是非空字符串`);
}
// pattern 语义注记（可缺省）：随生成物带走，替代在代码里散落的逐条注释
const patternNotes = d.patternNotes ?? {};
for (const [name, note] of Object.entries(patternNotes)) {
  if (!(name in d.patterns)) fail(`patternNotes 提到未定义 pattern ${name}`);
  if (typeof note !== "string") fail(`patternNotes.${name} 必须是字符串`);
}
if (typeof d.copyCap !== "number" || !(d.copyCap > 0))
  fail("copyCap 必须为正数");
if (!d.enums || typeof d.enums !== "object") fail("缺少 enums");
for (const [name, values] of Object.entries(d.enums)) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((v) => typeof v !== "string")
  ) {
    fail(`enum ${name} 必须是非空字符串数组`);
  }
}
if (!d.fieldSets || typeof d.fieldSets !== "object") fail("缺少 fieldSets");
if (
  !d.sections ||
  typeof d.sections !== "object" ||
  !Object.keys(d.sections).length
)
  fail("缺少 sections");

const KNOWN_SPEC_KEYS = ["str", "num", "bool", "enum", "copy", "use"];

/** 规则 spec → 生成模块里的字面量（形状非法/引用悬空直接 fail） */
function ruleCode(spec, at) {
  const keys = Object.keys(spec);
  for (const k of keys) {
    if (!KNOWN_SPEC_KEYS.includes(k)) fail(`${at}：未知规则键 ${k}`);
  }
  // 引用其它字段集（use）由调用方展开，spec 主体只允许一个规则键
  const ruleKeys = keys.filter((k) => k !== "use");
  if (ruleKeys.length !== 1)
    fail(`${at}：必须恰好一个规则（${keys.join(", ") || "空"}）`);

  if (spec.str !== undefined) {
    const names = typeof spec.str === "string" ? [spec.str] : spec.str;
    if (!Array.isArray(names) || names.length === 0)
      fail(`${at}：str 形状非法`);
    for (const name of names) {
      if (!(name in d.patterns)) fail(`${at}：pattern ${name} 未定义`);
    }
    return `{ kind: "string", patterns: [${names
      .map((n) => JSON.stringify(n))
      .join(", ")}] }`;
  }
  if (spec.num !== undefined) {
    if (
      !Array.isArray(spec.num) ||
      spec.num.length !== 2 ||
      spec.num.some((v) => typeof v !== "number") ||
      !(spec.num[0] <= spec.num[1])
    ) {
      fail(`${at}：num 必须为 [min, max]（min ≤ max）`);
    }
    return `{ kind: "number", min: ${JSON.stringify(spec.num[0])}, max: ${JSON.stringify(spec.num[1])} }`;
  }
  if (spec.bool !== undefined) return `{ kind: "bool" }`;
  if (spec.enum !== undefined) {
    const values = d.enums[spec.enum];
    if (!values) fail(`${at}：enum ${spec.enum} 未定义`);
    return `{ kind: "enum", values: [${values
      .map((v) => JSON.stringify(v))
      .join(", ")}] }`;
  }
  return `{ kind: "copy", cap: ${JSON.stringify(d.copyCap)} }`;
}

/* ── 展开：sections（+ fieldSets 引用）→ 扁平 [path, spec]，分区顺序不变 ── */

const rules = [];
for (const [section, fields] of Object.entries(d.sections)) {
  for (const [key, spec] of Object.entries(fields)) {
    if (spec.use !== undefined) {
      const fieldSet = d.fieldSets[spec.use];
      if (!fieldSet) fail(`${section}.${key}：字段集 ${spec.use} 未定义`);
      for (const [field, sub] of Object.entries(fieldSet)) {
        rules.push([`${section}.${key}.${field}`, sub]);
      }
    } else {
      rules.push([`${section}.${key}`, spec]);
    }
  }
}

const rulesObject = {};
for (const [path, spec] of rules) {
  const at = `路径 ${path}`;
  if (path in rulesObject) fail(`${at}：重复规则`);
  rulesObject[path] = ruleCode(spec, at);
}

const patternBlock = Object.entries(d.patterns)
  .map(([name, src]) => {
    const note = patternNotes[name];
    const entry = `  ${name}: new RegExp(${JSON.stringify(src)}),`;
    return note ? `  /** ${note} */\n${entry}` : entry;
  })
  .join("\n");

const ruleBlock = Object.entries(rulesObject)
  .map(([path, code]) => `  ${JSON.stringify(path)}: ${code},`)
  .join("\n");

const content = `/**
 * 生成物 —— 双端设置白名单规则（issue #27 / ADR 0001）。禁止手工编辑。
 *
 * 单一事实源：仓库根 settings.rules.json（手写规则描述符，词汇表见 GLOSSARY.md）。
 * 本文件由 npm run gen:settings（scripts/generate-settings-rules.mjs）生成：
 * 根包 src/generated/settings-rules.ts 与 worker/src/generated/settings-rules.ts
 * 内容字节一致，两侧校验逻辑只消费本模块，不得在任何一处手抄规则值。
 * 漂移修复流程：改描述符 → npm run gen:settings → 描述符与生成物一并提交。
 * CI 漂移断言：重新生成 → git diff 必须为空（.github/workflows/deploy.yml）。
 */

export type SettingsRule =
  | { kind: "string"; patterns: readonly string[] }
  | { kind: "number"; min: number; max: number }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "bool" }
  | { kind: "copy"; cap: number };

export const PATTERNS: Readonly<Record<string, RegExp>> = {
${patternBlock}
};

/** 扁平规则表：叶级设置路径 → 规则；插入顺序 = 描述符分区顺序（写侧报错路径顺序随之） */
export const SETTINGS_RULES: Readonly<Record<string, SettingsRule>> = {
${ruleBlock}
};
`;

for (const out of outputs) {
  mkdirSync(fileURLToPath(new URL(".", out)), { recursive: true });
  writeFileSync(fileURLToPath(out), content);
}
console.log(
  `已生成 ${outputs.length} 份 settings-rules.ts（规则 ${rules.length} 条）`
);
