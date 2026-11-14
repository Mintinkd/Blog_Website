// @vitest-environment node
import { describe, expect, it } from "vitest";
import { escapeHtml } from "../src/utils/escape";
import {
  buildImageSnippet,
  buildLinkSnippet,
  continueList,
  insertImage,
  insertLink,
  insertSnippet,
  isAllowedLinkUrl,
  mdEscapeText,
  mdEscapeUrl,
  toggleLinePrefix,
  wrapSelection,
} from "../src/utils/editor/editorCommands";

/**
 * issue #62（编辑器 T1）源码模式命令的行为基线。
 * 期望值全部为手写字面量，按 Markdown 语法人工推导；不从被测函数反推。
 * node 环境同时证明该模块不依赖 DOM / Vue 运行时。
 */

describe("Markdown 转义（迁自 App.vue，区别于 escape.ts 的 HTML 编码）", () => {
  it("mdEscapeText 只转义方括号，避免提前闭合链接文字", () => {
    expect(mdEscapeText("plain")).toBe("plain");
    expect(mdEscapeText("a[b]c")).toBe("a\\[b\\]c");
    expect(mdEscapeText("[x](y)")).toBe("\\[x\\](y)");
    expect(mdEscapeText("]]")).toBe("\\]\\]");
  });

  it("mdEscapeUrl 转义圆括号与空白，避免截断 (...) 目标", () => {
    expect(mdEscapeUrl("https://example.com/ok")).toBe(
      "https://example.com/ok"
    );
    expect(mdEscapeUrl("https://example.com/a(b)c")).toBe(
      "https://example.com/a%28b%29c"
    );
    expect(mdEscapeUrl("https://example.com/a b")).toBe(
      "https://example.com/a%20b"
    );
    expect(mdEscapeUrl("https://example.com/a\tb")).toBe(
      "https://example.com/a%20b"
    );
  });

  it("escape.ts 的 HTML 转义不能替代 Markdown 转义", () => {
    expect(escapeHtml("a[b]")).toBe("a[b]");
    expect(mdEscapeText("a[b]")).toBe("a\\[b\\]");
    expect(escapeHtml('a"b')).toBe("a&quot;b");
    expect(mdEscapeText('a"b')).toBe('a"b');
  });

  it("普通链接 URL 只允许 http(s)（ARTICLE_EDITOR_UPGRADE §5.3）", () => {
    expect(isAllowedLinkUrl("https://example.com")).toBe(true);
    expect(isAllowedLinkUrl("HTTP://EXAMPLE.COM")).toBe(true);
    expect(isAllowedLinkUrl("  https://example.com  ")).toBe(true);
    expect(isAllowedLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedLinkUrl("//evil.com")).toBe(false);
    expect(isAllowedLinkUrl("/media/x.png")).toBe(false);
    expect(isAllowedLinkUrl("")).toBe(false);
  });
});

describe("插入与包裹选区", () => {
  it("insertSnippet 替换选区，光标落在片段末尾", () => {
    expect(insertSnippet("hello world", { start: 6, end: 11 }, "MD")).toEqual({
      text: "hello MD",
      selection: { start: 8, end: 8 },
    });
  });

  it("insertSnippet 折叠光标插入，可落在片段内部", () => {
    expect(insertSnippet("ab", { start: 1, end: 1 }, "X")).toEqual({
      text: "aXb",
      selection: { start: 2, end: 2 },
    });
    expect(
      insertSnippet("ab", { start: 1, end: 1 }, "[alt](u)", {
        start: 1,
        end: 4,
      })
    ).toEqual({
      text: "a[alt](u)b",
      selection: { start: 2, end: 5 },
    });
  });

  it("越界选区被夹到文档范围，不抛错", () => {
    expect(insertSnippet("ab", { start: 99, end: -5 }, "X")).toEqual({
      text: "abX",
      selection: { start: 3, end: 3 },
    });
  });

  it("wrapSelection 有选区时包裹并重新选中原文", () => {
    expect(
      wrapSelection("hello world", { start: 6, end: 11 }, "**", "**")
    ).toEqual({
      text: "hello **world**",
      selection: { start: 8, end: 13 },
    });
    expect(wrapSelection("word", { start: 0, end: 4 }, "`", "`")).toEqual({
      text: "`word`",
      selection: { start: 1, end: 5 },
    });
  });

  it("wrapSelection 无选区时插入 placeholder 并选中它", () => {
    expect(wrapSelection("ab", { start: 1, end: 1 }, "*", "*", "斜体")).toEqual(
      {
        text: "a*斜体*b",
        selection: { start: 2, end: 4 },
      }
    );
    expect(wrapSelection("ab", { start: 1, end: 1 }, "**", "**")).toEqual({
      text: "a****b",
      selection: { start: 3, end: 3 },
    });
  });
});

describe("切换行前缀", () => {
  it("单行加上前缀，再次调用移除，选区随位移平移", () => {
    const added = toggleLinePrefix("title", { start: 0, end: 5 }, "## ");
    expect(added).toEqual({
      text: "## title",
      selection: { start: 3, end: 8 },
    });
    expect(toggleLinePrefix(added.text, added.selection, "## ")).toEqual({
      text: "title",
      selection: { start: 0, end: 5 },
    });
  });

  it("多行选区逐行加前缀，未全部带前缀时不部分移除", () => {
    expect(toggleLinePrefix("a\nb", { start: 0, end: 3 }, "> ")).toEqual({
      text: "> a\n> b",
      selection: { start: 2, end: 7 },
    });
  });

  it("只影响选区所在行，其余行不变", () => {
    expect(toggleLinePrefix("a\nb\n", { start: 2, end: 3 }, "- ")).toEqual({
      text: "a\n- b\n",
      selection: { start: 4, end: 5 },
    });
  });
});

describe("列表续行", () => {
  it("无序列表插入同标记的新行", () => {
    expect(continueList("- first", { start: 7, end: 7 })).toEqual({
      text: "- first\n- ",
      selection: { start: 10, end: 10 },
    });
  });

  it("有序列表序号递增并保留原分隔符", () => {
    expect(continueList("1. first", { start: 8, end: 8 })).toEqual({
      text: "1. first\n2. ",
      selection: { start: 12, end: 12 },
    });
    expect(continueList("3) item", { start: 7, end: 7 })).toEqual({
      text: "3) item\n4) ",
      selection: { start: 11, end: 11 },
    });
  });

  it("缩进列表保留缩进", () => {
    expect(continueList("  - item", { start: 8, end: 8 })).toEqual({
      text: "  - item\n  - ",
      selection: { start: 13, end: 13 },
    });
  });

  it("空列表项按 Enter 退出列表，不插入新行", () => {
    expect(continueList("  - ", { start: 4, end: 4 })).toEqual({
      text: "",
      selection: { start: 0, end: 0 },
    });
  });

  it("非列表行只插入换行", () => {
    expect(continueList("plain", { start: 5, end: 5 })).toEqual({
      text: "plain\n",
      selection: { start: 6, end: 6 },
    });
    expect(continueList("abc", { start: 1, end: 1 })).toEqual({
      text: "a\nbc",
      selection: { start: 2, end: 2 },
    });
  });
});

describe("插入链接 / 图片", () => {
  it("普通链接写 Markdown 并转义文字与 URL", () => {
    expect(buildLinkSnippet("https://example.com/a(b)", "a[b]", "link")).toBe(
      "[a\\[b\\]](https://example.com/a%28b%29)"
    );
  });

  it("内嵌网页预览写 data-embed 锚点，属性与文本走 HTML 编码", () => {
    expect(
      buildLinkSnippet('https://example.com/?a=1&b="x"', "A & B", "embed")
    ).toBe(
      '<a href="https://example.com/?a=1&amp;b=&quot;x&quot;" data-embed="1">A &amp; B</a>'
    );
    expect(buildLinkSnippet("https://a.io", "<script>", "embed")).toBe(
      '<a href="https://a.io" data-embed="1">&lt;script&gt;</a>'
    );
  });

  it("insertLink 无文字时用去协议的 URL，并替换选区", () => {
    expect(
      insertLink("", { start: 0, end: 0 }, { url: "https://a.io", label: "" })
    ).toEqual({
      text: "[a.io](https://a.io)",
      selection: { start: 20, end: 20 },
    });
    expect(
      insertLink(
        "LINK",
        { start: 0, end: 4 },
        {
          url: "https://a.io",
          label: "docs",
        }
      )
    ).toEqual({
      text: "[docs](https://a.io)",
      selection: { start: 20, end: 20 },
    });
  });

  it("buildImageSnippet 转义 alt 与 URL", () => {
    expect(buildImageSnippet("/media/pic.png", "a[b]")).toBe(
      "![a\\[b\\]](/media/pic.png)"
    );
  });

  it("insertImage 默认选中 alt，指定 selectAlt=false 时光标在片段末尾", () => {
    expect(
      insertImage("", { start: 0, end: 0 }, { url: "/p", alt: "pic" })
    ).toEqual({
      text: "![pic](/p)",
      selection: { start: 2, end: 5 },
    });
    expect(
      insertImage(
        "",
        { start: 0, end: 0 },
        {
          url: "/p",
          alt: "pic",
          selectAlt: false,
        }
      )
    ).toEqual({
      text: "![pic](/p)",
      selection: { start: 10, end: 10 },
    });
  });
});
