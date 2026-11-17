// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  TITLE_MAX_LENGTH,
  checkPublishReady,
  filterTags,
  readingStats,
  reduceSlugLock,
  safeCoverUrl,
  splitTagsByCategory,
  type SlugLockState,
} from "../src/utils/editor/metaFields";

/**
 * issue #67（编辑器 T6）元信息面板纯函数行为基线。
 *
 * 期望值全部手写字面量，不从被测函数反推：
 * - 标题上限 200 来自 worker/src/handlers/article.ts 的 validate() maxLength；
 * - slug 生成复用 T1 的 generateSlug，其服务端对齐样例见 tests/editor-slug.test.ts；
 * - 字数 / 阅读时长复用 T1 的 countWords / readingTimeMinutes，同组样例见
 *   tests/editor-word-count.test.ts（这里再钉一次「面板读数」这一层聚合）。
 */

describe("标题上限与服务端 validate 一致", () => {
  it("maxlength 为 200", () => {
    expect(TITLE_MAX_LENGTH).toBe(200);
  });
});

describe("checkPublishReady：发布前标题与正文 trim 后非空", () => {
  const form = (title: string, content: string, status = "published") => ({
    title,
    content,
    status,
  });

  it("草稿不拦截，即使标题与正文都为空", () => {
    expect(checkPublishReady(form("", "", "draft"))).toEqual({ ok: true });
  });

  it("标题与正文齐备才可发布", () => {
    expect(checkPublishReady(form("标题", "正文"))).toEqual({ ok: true });
    expect(checkPublishReady(form("  标题  ", "  正文  "))).toEqual({
      ok: true,
    });
  });

  it("纯空白标题 / 正文被判为空，缺哪几项分别列出", () => {
    expect(checkPublishReady(form("  \n ", "正文"))).toEqual({
      ok: false,
      missing: ["title"],
    });
    expect(checkPublishReady(form("标题", "\t\n "))).toEqual({
      ok: false,
      missing: ["content"],
    });
    expect(checkPublishReady(form("", ""))).toEqual({
      ok: false,
      missing: ["title", "content"],
    });
  });

  it("不擅自追加服务端长度限制之外的校验", () => {
    expect(checkPublishReady(form("标".repeat(201), "正文"))).toEqual({
      ok: true,
    });
  });
});

describe("safeCoverUrl：只放行绝对 http(s) URL", () => {
  it("https / http 原样规范化为 href", () => {
    expect(safeCoverUrl("https://example.com/a.png")).toBe(
      "https://example.com/a.png"
    );
    expect(safeCoverUrl("http://example.com:8080/b.jpg?q=1")).toBe(
      "http://example.com:8080/b.jpg?q=1"
    );
    expect(safeCoverUrl("  https://example.com/c.webp  ")).toBe(
      "https://example.com/c.webp"
    );
  });

  it("拒绝脚本 / data / 相对路径 / 协议相对 / 非 http(s)", () => {
    const rejected = [
      "",
      "   ",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "ftp://example.com/a.png",
      "//example.com/a.png",
      "/media/2026/11/a.png",
      "media/a.png",
      "example.com/a.png",
      "https://",
      "not a url",
    ];
    for (const value of rejected) {
      expect(safeCoverUrl(value)).toBeNull();
    }
  });

  it("大写协议也被 URL 构造器规范化后放行", () => {
    expect(safeCoverUrl("HTTPS://EXAMPLE.COM/A.PNG")).toBe(
      "https://example.com/A.PNG"
    );
  });
});

describe("reduceSlugLock：生成后锁定、可解锁手改", () => {
  const fresh: SlugLockState = { slug: "", locked: false };

  it("新建文章默认留空且不锁，交由服务端生成", () => {
    expect(reduceSlugLock(fresh, { type: "reset", slug: "" })).toEqual({
      slug: "",
      locked: false,
    });
  });

  it("打开已有文章时服务端 slug 非空即锁定，避免误改线上链接", () => {
    expect(reduceSlugLock(fresh, { type: "reset", slug: "中文-标题" })).toEqual(
      { slug: "中文-标题", locked: true }
    );
  });

  it("「根据标题生成」复用 T1 规则并默认锁定（中文保留）", () => {
    expect(
      reduceSlugLock(fresh, { type: "generate", title: "中文 标题" })
    ).toEqual({ slug: "中文-标题", locked: true });
    expect(
      reduceSlugLock(fresh, { type: "generate", title: "Hello World" })
    ).toEqual({ slug: "Hello-World", locked: true });
  });

  it("标题为空时生成结果为空且不锁定，避免把作者锁死", () => {
    expect(reduceSlugLock(fresh, { type: "generate", title: "   " })).toEqual({
      slug: "",
      locked: false,
    });
  });

  it("锁定态忽略手改，解锁后才可改值", () => {
    const locked: SlugLockState = { slug: "中文-标题", locked: true };
    expect(reduceSlugLock(locked, { type: "edit", value: "my-slug" })).toEqual({
      slug: "中文-标题",
      locked: true,
    });
    const unlocked = reduceSlugLock(locked, { type: "unlock" });
    expect(unlocked).toEqual({ slug: "中文-标题", locked: false });
    expect(
      reduceSlugLock(unlocked, { type: "edit", value: "my-slug" })
    ).toEqual({ slug: "my-slug", locked: false });
  });

  it("重新锁定保持当前 slug，不改写成新值", () => {
    const unlocked: SlugLockState = { slug: "my-slug", locked: false };
    expect(reduceSlugLock(unlocked, { type: "lock" })).toEqual({
      slug: "my-slug",
      locked: true,
    });
  });
});

describe("filterTags：标签多时本地筛选", () => {
  const tags = ["TypeScript", "Vue", "中文标签", "Astro", "Cloudflare"];

  it("空查询返回全部标签的副本，不修改入参", () => {
    const result = filterTags(tags, "  ");
    expect(result).toEqual(tags);
    expect(result).not.toBe(tags);
    expect(tags).toEqual([
      "TypeScript",
      "Vue",
      "中文标签",
      "Astro",
      "Cloudflare",
    ]);
  });

  it("大小写不敏感地按子串匹配", () => {
    expect(filterTags(tags, "script")).toEqual(["TypeScript"]);
    expect(filterTags(tags, "VUE")).toEqual(["Vue"]);
    expect(filterTags(tags, "o")).toEqual(["Astro", "Cloudflare"]);
  });

  it("中文子串同样匹配，无结果返回空数组", () => {
    expect(filterTags(tags, "标签")).toEqual(["中文标签"]);
    expect(filterTags(tags, "不存在")).toEqual([]);
  });
});

describe("readingStats：面板读数与服务端 calculateReadingTime 同组样例", () => {
  // 与 tests/editor-word-count.test.ts 中从服务端逐字抄录的同一组样例，
  // 期望值手写字面量，不从 countWords / readingTimeMinutes 反推。
  const SERVER_ALIGNED_SAMPLES: [
    markdown: string,
    words: number,
    chinese: number,
    english: number,
    minutes: number,
  ][] = [
    ["", 0, 0, 0, 1],
    ["你好世界", 4, 4, 0, 1],
    ["hello world", 2, 0, 2, 1],
    ["中文 hello 世界", 5, 4, 1, 1],
    ["# 标题", 3, 2, 1, 1],
    ["，。", 1, 0, 1, 1],
  ];

  it.each(SERVER_ALIGNED_SAMPLES)(
    "%j → %i 字（中 %i / 英 %i）· %i 分钟",
    (markdown, words, chinese, english, minutes) => {
      expect(readingStats(markdown)).toEqual({
        words,
        chinese,
        english,
        minutes,
      });
    }
  );

  it("Markdown 标记按服务端既有口径计入英文词，不擅自修正", () => {
    // "**加粗**" 去掉两个中文后按空白切出 "**" 与 "**" 两个英文词。
    expect(readingStats("**加粗**")).toEqual({
      words: 4,
      chinese: 2,
      english: 2,
      minutes: 1,
    });
  });

  it("中文 301 字与 200 词边界同样向上取整", () => {
    expect(readingStats("中".repeat(301)).minutes).toBe(2);
    expect(readingStats("word ".repeat(201).trim()).minutes).toBe(2);
  });
});

// ── taxonomy v2（#80）：splitTagsByCategory ──

describe("splitTagsByCategory — 编辑器标签分类感知（#80）", () => {
  const tags = [
    { id: 1, name: "Vue", category_id: 2 },
    { id: 2, name: "Node", category_id: 3 },
    { id: 3, name: "无归属", category_id: null },
  ];

  it("未选分类（null）：不做过滤，全部按本分类渲染、无跨分类标记", () => {
    expect(splitTagsByCategory(tags, null)).toEqual({
      current: tags,
      cross: [],
    });
  });

  it("已选分类：匹配的是本分类，其余（含无归属）都是跨分类", () => {
    const { current, cross } = splitTagsByCategory(tags, 2);
    expect(current).toEqual([{ id: 1, name: "Vue", category_id: 2 }]);
    expect(cross).toEqual([
      { id: 2, name: "Node", category_id: 3 },
      { id: 3, name: "无归属", category_id: null },
    ]);
  });

  it("选中的分类没有任何标签：current 为空数组、cross 为全部", () => {
    const { current, cross } = splitTagsByCategory(tags, 999);
    expect(current).toEqual([]);
    expect(cross).toEqual(tags);
  });

  it("空输入：两组都为空数组", () => {
    expect(splitTagsByCategory([], 2)).toEqual({ current: [], cross: [] });
    expect(splitTagsByCategory([], null)).toEqual({ current: [], cross: [] });
  });
});
