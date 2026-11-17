// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { escapeAttr, escapeHtml } from "../src/utils/escape";

// vitest 在仓库根运行；用 cwd 而非 import.meta.url（workers-types 的 URL 与 node:fs 类型不兼容）
const ROOT = process.cwd();

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

  it("escapeAttr 与 escapeHtml 五字符口径逐字一致（属性位可互换）", () => {
    for (const sample of [`&<>"'`, "中文 ' onmouseover='x", "a&b<c>d\"e'f"]) {
      expect(escapeAttr(sample)).toBe(escapeHtml(sample));
    }
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

  it.each(PAGES)(
    "%s 无本地 esc 定义，直接使用或经 taxonomyRender 间接消费单源",
    (rel) => {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      // 覆盖 function / const / let / var + 箭头赋值；esc() 无参（键盘 Esc）不算 escape 副本
      expect(src, `${rel} 仍定义本地 esc`).not.toMatch(
        /(?:function|const|let|var)\s+esc\s*[=(]|esc\s*=\s*(?:\(|function)/
      );
      // #97 后详情页卡片渲染收敛到 taxonomyRender；taxonomy v2（#81）再收敛到
      // articleCard / taxonomyGroups 两个单源（页面按用途二选一 import）——
      // 禁止的是页面内重复定义，间接消费 escape 单源即可。
      const direct =
        /import\s*\{[^}]*\bescapeHtml\b[^}]*\}\s*from\s*['"][^'"]*utils\/escape/.test(
          src
        );
      const viaRender =
        /import\s*\{[^}]*\b(?:renderArticleCards|renderCategoryCards|renderTagGroups|renderArticleCardList)\b[^}]*\}\s*from\s*['"][^'"]*utils\/(?:taxonomyRender|taxonomyGroups|articleCard)/.test(
          src
        );
      expect(direct || viaRender, `${rel} 未使用 escape 单源`).toBe(true);
    }
  );

  it("articleCard / taxonomyGroups 单源消费 escapeHtml（#81 间接路径守卫）", () => {
    for (const rel of [
      "src/utils/articleCard.ts",
      "src/utils/taxonomyGroups.ts",
    ]) {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, `${rel} 应消费 escape 单源`).toMatch(
        /import\s*\{[^}]*\bescapeHtml\b[^}]*\}\s*from\s*['"][^'"]*escape['"]/
      );
    }
  });

  it("全仓 .astro / .vue 无本地 escape 函数副本（通用规则，不只三页面）", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return /\.(astro|vue)$/.test(entry.name) ? [full] : [];
      });
    const offenders: string[] = [];
    for (const file of walk(path.join(ROOT, "src"))) {
      const src = readFileSync(file, "utf8");
      // 只匹配带 escape 语义的本地定义（含 &amp; 或 &lt; 实体），排除键盘 Esc 等无关 esc()
      if (
        /(?:function|const|let|var)\s+\w*esc\w*\s*(?:\(|=)/i.test(src) &&
        /&(?:amp|lt|quot|#0?39);/.test(src)
      ) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("Worker 包内 escapeHtml 单点（issue #95 / M15）", () => {
  it("search.ts 不重复定义 escapeHtml，改为 import 消毒器单源", () => {
    const src = readFileSync(
      path.join(ROOT, "worker/src/handlers/search.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/function\s+escapeHtml\s*\(/);
    expect(src).toMatch(
      /import\s*\{\s*escapeHtml\s*\}\s*from\s*["'][^"']*utils\/sanitizer/
    );
  });
});
