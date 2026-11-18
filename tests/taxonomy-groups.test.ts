// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  groupTagsByCategory,
  renderTagGroups,
  renderCategoryCards,
} from "../src/utils/taxonomyGroups";

/**
 * issue #81（taxonomy v2）：标签目录分组与渲染的纯函数行为基线。
 * 期望值均为手写字面量，不从被测函数反推。
 */

const cat = (id: number, name: string, slug: string) => ({ id, name, slug });

describe("groupTagsByCategory — 分组与排序（#81 §2）", () => {
  it("按分类分组；分类组按组内标签数降序；未分类固定最后", () => {
    const tags = [
      {
        name: "A1",
        slug: "a1",
        article_count: 1,
        category: cat(2, "前端", "frontend"),
      },
      {
        name: "B1",
        slug: "b1",
        article_count: 3,
        category: cat(3, "后端", "backend"),
      },
      {
        name: "A2",
        slug: "a2",
        article_count: 2,
        category: cat(2, "前端", "frontend"),
      },
      {
        name: "B2",
        slug: "b2",
        article_count: 1,
        category: cat(3, "后端", "backend"),
      },
      { name: "孤儿", slug: "orphan", article_count: 9, category: null },
    ];
    const groups = groupTagsByCategory(tags);
    // 组序：前端(2 个) → 后端(2 个，平票保持输入顺序) → 未分类
    expect(groups.map((g) => g.category?.slug ?? "uncategorized")).toEqual([
      "frontend",
      "backend",
      "uncategorized",
    ]);
    expect(groups[0].tags.map((t) => t.slug)).toEqual(["a2", "a1"]);
    expect(groups[1].tags.map((t) => t.slug)).toEqual(["b1", "b2"]);
  });

  it("组内按 article_count 降序，平票按名称（localeCompare，ASCII 名字跨 locale 确定性）", () => {
    const tags = [
      {
        name: "beta",
        slug: "b",
        article_count: 2,
        category: cat(1, "技术", "tech"),
      },
      {
        name: "alpha",
        slug: "a",
        article_count: 5,
        category: cat(1, "技术", "tech"),
      },
      {
        name: "aa",
        slug: "c",
        article_count: 2,
        category: cat(1, "技术", "tech"),
      },
    ];
    const [group] = groupTagsByCategory(tags);
    expect(group.tags.map((t) => t.slug)).toEqual(["a", "c", "b"]);
  });

  it("只有未分类标签：单组、category 为 null、排在（唯一的）最后", () => {
    const tags = [{ name: "X", slug: "x", article_count: 1, category: null }];
    const groups = groupTagsByCategory(tags);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBeNull();
    expect(groups[0].tags.map((t) => t.slug)).toEqual(["x"]);
  });

  it("空输入：返回空数组", () => {
    expect(groupTagsByCategory([])).toEqual([]);
  });
});

describe("renderTagGroups — 渲染契约（#81 §2）", () => {
  const groups = groupTagsByCategory([
    {
      name: "技术<script>",
      slug: "tech<>",
      article_count: 2,
      category: cat(1, "技术", "tech"),
    },
    { name: "生活", slug: "life", article_count: 1, category: null },
  ]);

  it("chip 是 /tags/:slug 链接，文本转义；组头分类名链接分类页；未分类组头无链接", () => {
    const html = renderTagGroups(groups, {
      uncategorized: "未分类",
      tagCount: "个标签",
    });
    // 转义：名称危险字符不原样出现；slug 经 safePathSegment 编码
    expect(html).toContain('href="/tags/tech%3C%3E"');
    expect(html).toContain("技术&lt;script&gt;");
    expect(html).not.toContain("技术<script>");
    // 分类组头是链接
    expect(html).toContain(
      '<a href="/categories/tech" class="tag-group-name">技术</a>'
    );
    // 未分类组头没有分类链接（仅文本）
    expect(html).toContain("未分类");
    expect(html).not.toContain('href="/categories/uncategorized"');
    // 选择器契约：.tag-group / .tag-item 保留（回归脚本断言）
    expect(html).toContain("tag-group");
    expect(html).toContain("tag-item");
  });

  it("空分组：返回空串", () => {
    expect(
      renderTagGroups([], { uncategorized: "未分类", tagCount: "个标签" })
    ).toBe("");
  });
});

describe("renderCategoryCards — 分类目录卡片（#81 §4）", () => {
  it("卡片是 <article>：分类名与标签 chip 各自独立 <a>（无嵌套链接）；含 article_count/tag_count 与前 3 个标签", () => {
    const categories = [
      {
        id: 1,
        name: "技术",
        slug: "tech",
        description: "技术文章",
        article_count: 5,
        tag_count: 4,
      },
      { id: 2, name: "未分类", slug: "uncategorized", article_count: 0 },
    ];
    const tags = [
      { name: "Vue", slug: "vue", article_count: 2, category_id: 1 },
      { name: "Node", slug: "node", article_count: 3, category_id: 1 },
      { name: "Go", slug: "go", article_count: 1, category_id: 1 },
      { name: "Rust", slug: "rust", article_count: 1, category_id: 1 },
    ];
    const html = renderCategoryCards(categories, tags, {
      articlesSuffix: "篇文章",
      tagCountLabel: "标签",
      uncategorized: "未分类",
    });
    // 卡片本体是 <article class="category-item">，不是 <a>（<a\s 避免误匹配 <article）
    expect(html).toContain('<article class="category-item">');
    expect(html).not.toMatch(/<a\s[^>]*class="category-item"/);
    // 分类名独立链接
    expect(html).toContain(
      '<a href="/categories/tech" class="category-name">技术</a>'
    );
    // tag_count 优先 API 字段
    expect(html).toContain("4 标签");
    // 前 3 个标签 chip（第 4 个被裁掉）
    expect(html).toContain('href="/tags/vue"');
    expect(html).toContain('href="/tags/node"');
    expect(html).toContain('href="/tags/go"');
    expect(html).not.toContain('href="/tags/rust"');
    // tag_count 缺省用分组数兜底
    expect(html).toContain("0 标签");
    // 未分类固定最后
    const techIdx = html.indexOf("技术");
    const uncIdx = html.indexOf("未分类");
    expect(techIdx).toBeLessThan(uncIdx);
  });

  it("空输入：返回空串", () => {
    expect(
      renderCategoryCards([], [], {
        articlesSuffix: "篇",
        tagCountLabel: "标签",
        uncategorized: "未分类",
      })
    ).toBe("");
  });
});
