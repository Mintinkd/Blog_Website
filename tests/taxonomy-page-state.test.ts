// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  currentArticleList,
  setTaxonomyHeading,
} from "../src/scripts/layout/taxonomy-helpers";
import { refreshDomTranslations } from "../src/utils/i18n";

/**
 * 分类 / 标签详情页在 ClientRouter 客户端导航下的状态回归。
 *
 * 两个已发生的问题：
 * - 页面脚本只执行一次，模块作用域缓存的 `#article-list` 一直指向第一次进入的
 *   页面 → 切到「新闻」分类后，面包屑 / 筛选 chip 仍是「转载」的数据；
 * - H1 的 `data-i18n-params` 存的是 URL slug，`refreshDomTranslations()`（settings
 *   初始化、语言切换）会把客户端回填的真实名称覆盖回「分类: news」。
 */

describe("分类 / 标签详情页跨页状态（ClientRouter）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("currentArticleList 每次取当前文档节点，不缓存上一个页面", () => {
    document.body.innerHTML =
      '<div id="article-list" data-category-slug="repost"></div>';
    const first = currentArticleList();
    expect(first?.dataset.categorySlug).toBe("repost");

    // 模拟 ClientRouter 换页：旧节点整体被新页面替换
    document.body.innerHTML =
      '<div id="article-list" data-category-slug="news"></div>';
    const second = currentArticleList();
    expect(second?.dataset.categorySlug).toBe("news");
    expect(second).not.toBe(first);
  });

  it("setTaxonomyHeading 回填真实名称后，refreshDomTranslations 不再用 slug 覆盖", () => {
    document.body.innerHTML =
      '<h1 id="category-title" data-i18n="page.category" data-i18n-params=\'{"name":"news"}\'>分类: news</h1>';
    const h1 = document.getElementById("category-title");
    expect(h1).not.toBeNull();

    setTaxonomyHeading(h1, "新闻");

    expect(h1?.textContent).toBe("新闻");
    expect(h1?.hasAttribute("data-i18n")).toBe(false);
    expect(h1?.hasAttribute("data-i18n-params")).toBe(false);

    // settings 初始化 / 语言切换都会调用；名称是数据，必须保持「新闻」
    refreshDomTranslations();
    expect(h1?.textContent).toBe("新闻");
  });

  it("setTaxonomyHeading 对缺失节点安全（元信息回填失败时不抛）", () => {
    expect(() => setTaxonomyHeading(null, "新闻")).not.toThrow();
  });
});
