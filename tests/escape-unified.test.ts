// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { escapeAttr, escapeHtml } from "../src/utils/escape";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * issue #95 / M15：escape 四份收敛为单点 + 补齐单引号转义。
 *
 * 接缝：escapeHtml / escapeAttr 纯函数 + 页面模板的静态守卫（本地副本清零）。
 * 期望值全部手写字面量。
 */

describe("escapeHtml / escapeAttr 五字符口径统一（issue #95）", () => {
  it("五字符全部转义，单引号编码为数值实体", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#039;");
    expect(escapeAttr(undefined)).toBe("");
    expect(escapeHtml(null)).toBe("");
  });

  it("单引号属性包裹场景：' 被转义，属性不逃逸", () => {
    const malicious = "x' onmouseover='alert(1)";
    const rendered = `<div class='${escapeAttr(malicious)}'>safe</div>`;
    expect(rendered).toBe(
      "<div class='x&#039; onmouseover=&#039;alert(1)'>safe</div>"
    );
    expect(rendered).not.toContain("onmouseover='");
  });

  it("正常中文标签名 / 搜索词 / slug 不受影响", () => {
    expect(escapeHtml("中文标签")).toBe("中文标签");
    expect(escapeHtml("C++ 编程")).toBe("C++ 编程");
    expect(escapeHtml("hello-world_1")).toBe("hello-world_1");
  });
});

describe("页面不再重复定义 esc（issue #95 AC）", () => {
  const PAGES = [
    "src/pages/categories/index.astro",
    "src/pages/search.astro",
    "src/pages/tags/[slug].astro",
  ];

  it.each(PAGES)("%s 无本地 esc 定义，且 import 单源 escapeHtml", (rel) => {
    const src = readFileSync(path.join(ROOT, rel), "utf8");
    expect(src, `${rel} 仍定义本地 esc`).not.toMatch(
      /function\s+esc\s*\(|const\s+esc\s*=/
    );
    expect(src, `${rel} 未 import escapeHtml`).toMatch(
      /import\s*\{[^}]*\bescapeHtml\b[^}]*\}\s*from\s*['"][^'"]*utils\/escape/
    );
  });
});
