// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderArticleCard } from "../src/utils/articleCard";

/**
 * 共享卡片渲染器的**解析后**结构守卫（回归 2026-11-21「卡片点了不跳转」）。
 *
 * 原实现是 `<a class="list-card-link">` 包住分类 badge 与标签 chip，形成嵌套
 * `<a>`：HTML 解析器遇到内层 `<a>` 会立即闭合外层，把整卡链接拆成若干个空锚点，
 * 于是标题 / 摘要 / 页脚点了都不跳转——字符串断言看不出来，只有解析后才知道。
 * 因此这里用 DOM 断言：卡片内不得出现 `a a`，文章链接只挂在标题上。
 */

const article = {
  slug: "hello-world",
  title: "你好世界",
  summary: "摘要",
  category: { id: 1, name: "技术", slug: "tech" },
  tags: [
    { name: "Vue", slug: "vue", category: { name: "前端", slug: "frontend" } },
  ],
  view_count: 12,
  published_at: "2026-06-15T08:00:00.000Z",
};

function parse(html: string): HTMLElement {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder;
}

describe("文章卡片解析后结构（整卡可点契约）", () => {
  for (const variant of ["list", "cover"] as const) {
    it(`${variant} 变体：没有嵌套 <a>，文章链接只挂在标题上`, () => {
      const holder = parse(renderArticleCard(article, { variant }));
      const card = holder.firstElementChild as HTMLElement;

      expect(card.tagName).toBe("ARTICLE");
      // 解析器不会把嵌套 <a> 拆开：出现 `a a` 就说明又写回了整卡链接
      expect(holder.querySelectorAll("a a").length).toBe(0);
      // 卡片本身（直接子节点）不是链接
      expect(card.querySelector(":scope > a")).toBeNull();

      const titleLink = card.querySelector<HTMLAnchorElement>(
        "a[href='/articles/hello-world']"
      );
      expect(titleLink).not.toBeNull();
      expect(titleLink!.parentElement!.tagName).toBe("H3");
      expect(titleLink!.textContent).toBe("你好世界");

      // badge 与 chip 仍是独立链接，没有被整卡链接吞掉
      expect(
        card.querySelector<HTMLAnchorElement>("a[href='/categories/tech']")
      ).not.toBeNull();
      expect(
        card.querySelector<HTMLAnchorElement>(
          "a[href='/categories/frontend?tag=vue']"
        )
      ).not.toBeNull();
    });
  }
});
