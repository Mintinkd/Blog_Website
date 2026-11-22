// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * issue #112 item 12：ssrLocaleIsZh / bindPagination 重复实现守卫。
 *
 * 之前 categories/[slug].astro 与 tags/[slug].astro 各有一份逐字重复，
 * 改一份不会让另一份红。现已收敛到 src/scripts/layout/taxonomy-helpers.ts。
 * 本测试锁定：两个页面文件不再定义本地 ssrLocaleIsZh / bindPagination，
 * 且共享模块导出了这两个函数。
 */

const ROOT = resolve(import.meta.dirname, "..");

describe("ssrLocaleIsZh / bindPagination 单源守卫（#112 item 12）", () => {
  const shared = readFileSync(
    resolve(ROOT, "src/scripts/layout/taxonomy-helpers.ts"),
    "utf8"
  );

  it("共享模块导出 ssrLocaleIsZh 和 bindPagination", () => {
    expect(shared).toContain("export function ssrLocaleIsZh");
    expect(shared).toContain("export function bindPagination");
  });

  const pages = [
    "src/pages/categories/[slug].astro",
    "src/pages/tags/[slug].astro",
  ];

  for (const page of pages) {
    it(`${page} 不再定义本地 ssrLocaleIsZh / bindPagination`, () => {
      const src = readFileSync(resolve(ROOT, page), "utf8");
      // 不应有 "function ssrLocaleIsZh" 或 "function bindPagination" 的本地定义
      expect(src, `${page} 不应定义本地 ssrLocaleIsZh`).not.toMatch(
        /function\s+ssrLocaleIsZh\s*\(/
      );
      expect(src, `${page} 不应定义本地 bindPagination`).not.toMatch(
        /function\s+bindPagination\s*\(/
      );
      // 应从共享模块导入
      expect(src, `${page} 应导入 taxonomy-helpers`).toContain(
        "taxonomy-helpers"
      );
    });

    it(`${page} 不在模块作用域缓存 #article-list（ClientRouter 换页会串数据）`, () => {
      const src = readFileSync(resolve(ROOT, page), "utf8");
      // 模块脚本跨导航只执行一次；顶层 const 缓存的节点属于上一个页面。
      expect(src, `${page} 应通过 currentArticleList() 按需取根节点`).toContain(
        "currentArticleList"
      );
      expect(src, `${page} 不应在顶层缓存 #article-list`).not.toMatch(
        /^ {2}const\s+\w+\s*=\s*document\.getElementById\(\s*['"]article-list['"]\s*\)/m
      );
    });
  }

  it("全仓 src/pages 下只有 taxonomy-helpers.ts 定义这两个函数", () => {
    // 扫描所有 .astro 文件，确认没有本地定义
    const { execSync } = require("node:child_process");
    const files = execSync(`find ${ROOT}/src/pages -name "*.astro" -type f`, {
      encoding: "utf8",
    })
      .trim()
      .split("\n");

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} 不应定义本地 ssrLocaleIsZh`).not.toMatch(
        /function\s+ssrLocaleIsZh\s*\(/
      );
      expect(src, `${file} 不应定义本地 bindPagination`).not.toMatch(
        /function\s+bindPagination\s*\(/
      );
    }
  });
});
