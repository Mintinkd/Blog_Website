// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * issue #99 / M19：富文本策略的三层边界文档化 + 一致性守卫。
 *
 * 三层策略（报告 §M19）：
 *   ① 正文白名单——rich-text-policy.json 单一源，前端 markdownPolicy + Worker 消毒器消费；
 *   ② 搜索高亮——仅 <mark>，是独立兜底层，不并入正文白名单；
 *   ③ DOM clobbering id 防护——前端 DOMPurify 渲染层专有，Worker 不复现（前台二次消毒兜底）。
 * 本测试锁定三层的声明存在且边界清晰，防止未来又出现「第四套独立清单」。
 */

describe("搜索高亮白名单边界（issue #99）", () => {
  const escapeSrc = readFileSync(
    path.join(ROOT, "src/utils/escape.ts"),
    "utf8"
  );

  it("搜索高亮白名单以具名常量声明，仅 mark，且不是正文白名单", () => {
    expect(escapeSrc).toMatch(
      /export\s+const\s+HIGHLIGHT_TAGS[^=]*=\s*\[\s*['"]mark['"]\s*\]/
    );
    const descriptor = JSON.parse(
      readFileSync(path.join(ROOT, "rich-text-policy.json"), "utf8")
    );
    // mark 不在正文白名单内——两层边界不混淆
    expect(descriptor.tags).not.toContain("mark");
  });

  it("sanitizeHighlight 消费该常量（不是散落的字面量）", () => {
    expect(escapeSrc).toMatch(/ALLOWED_TAGS:\s*\[\s*\.\.\.HIGHLIGHT_TAGS\s*\]/);
  });
});

describe("三层策略边界在文档留痕（issue #99）", () => {
  it("GLOSSARY 记录正文 / 搜索高亮 / DOM clobbering 三层边界", () => {
    const doc = readFileSync(path.join(ROOT, "GLOSSARY.md"), "utf8");
    for (const term of [
      "rich-text-policy.json",
      "搜索高亮",
      "DOM clobbering",
    ]) {
      expect(doc, `GLOSSARY 应说明 ${term}`).toContain(term);
    }
  });
});

describe("跨端 XSS 样本一致性（issue #99）", () => {
  it("rich-text-policy.json 明确禁止 XSS 相关标签与 scheme 入白名单", async () => {
    const descriptor = JSON.parse(
      readFileSync(path.join(ROOT, "rich-text-policy.json"), "utf8")
    );
    for (const tag of [
      "script",
      "iframe",
      "svg",
      "object",
      "embed",
      "form",
      "meta",
      "base",
      "frameset",
    ]) {
      expect(descriptor.tags, `正文白名单不应含 ${tag}`).not.toContain(tag);
    }
    for (const scheme of ["javascript", "vbscript", "data"]) {
      expect(descriptor.schemes, `正文 scheme 不应含 ${scheme}`).not.toContain(
        scheme
      );
    }
    // data 仅作为图片额外 scheme（前端 DOMPurify 对媒体标签的口径）
    expect(descriptor.imgExtraSchemes).toEqual(["data"]);
  });
});
