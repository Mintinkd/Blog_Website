// @vitest-environment node
/**
 * 语义等价回写守卫（T4 #65）的行为锁。
 *
 * 装配前提来自 T0 实测报告 docs/reviews/2026-11-14-milkdown-t0-validation.md §3/§5：
 * CrepeBuilder 只装 7 项、**不装 image-block** 时 15 条语料 15/15 语义等价；
 * 默认装配下 `image` / `mixed-document` 两条因 alt 被改写成 "1.00" 而 lossy。
 * 因此这里的安全 / 有损分组按 7 项装配重新判定，而不是沿用默认装配结论。
 *
 * 渲染器用 `renderMarkdownServer`（marked + sanitize-html，node 可用），它与
 * 编辑器实际使用的 `renderMarkdown`（DOMPurify）共享 markdownPolicy 白名单，
 * 两者逐字一致由 tests/markdown-preview-parity.test.ts 钉住；真实 DOMPurify
 * 管线下的守卫用例也在该文件里补了一条。
 *
 * 期望值全部是手写字面量，不从被测函数或 fixture 反推。
 */
import { describe, expect, it } from "vitest";
import { renderMarkdownServer } from "../src/utils/markdownServer";
import {
  classifyMarkdown,
  classifyRoundTrip,
  decideInitialMode,
  describeHtmlDifference,
  guardWysiwygSave,
  normalizeRenderedHtml,
  type MarkdownClassification,
  type MarkdownRenderer,
} from "../src/utils/editor/markdownBridge";
import {
  EDITOR_CORPUS_IDS,
  markdownCorpus,
} from "./fixtures/editor/markdown-corpus";

const render: MarkdownRenderer = (markdown) => renderMarkdownServer(markdown);

/** T0 §3 第 1 项：7 项装配下 15 条语料全部 safe（手写字面量重列覆盖清单）。 */
const SAFE_CORPUS_IDS = [
  "gfm-table",
  "fenced-code",
  "blockquote",
  "nested-list",
  "image",
  "relative-url",
  "inline-raw-html",
  "block-raw-html",
  "custom-attrs",
  "embed-link",
  "media-links",
  "cjk-punctuation",
  "escaped-characters",
  "hard-breaks",
  "mixed-document",
] as const;

/** T0 §3 第 1 项：仅默认装配（含 image-block）下这两条 lossy。 */
const IMAGE_BLOCK_LOSSY_IDS = ["image", "mixed-document"] as const;

/** 语义等价但字节不同的手写样本：守卫只比渲染结果，不比 Markdown 字节。 */
const EQUIVALENT_REWRITES: readonly {
  id: string;
  original: string;
  normalized: string;
}[] = [
  {
    id: "list-marker",
    original: "- 第一项\n- 第二项",
    normalized: "* 第一项\n* 第二项",
  },
  {
    id: "table-delimiter-width",
    original: "| 列 A | 列 B |\n| :--- | ---: |\n| 中文 | 1 |",
    normalized: "| 列 A | 列 B |\n| :-- | --: |\n| 中文 | 1 |",
  },
  {
    id: "hard-break-style",
    original: "第一行  \n第二行",
    normalized: "第一行\\\n第二行",
  },
  {
    id: "trailing-newline",
    original: "![封面](/media/cover.png)",
    normalized: "![封面](/media/cover.png)\n",
  },
];

/** 有损回写的手写样本：每条都必须被守卫拦下。 */
const LOSSY_REWRITES: readonly {
  id: string;
  original: string;
  normalized: string;
}[] = [
  {
    // T0 §4：imageBlockSchema 把 alt 当宽高比，序列化成 "1.00"。
    id: "image-alt-as-ratio",
    original: "![站点封面](/media/cover.png)",
    normalized: "![1.00](/media/cover.png)",
  },
  {
    id: "embed-degraded-to-markdown-link",
    original:
      '<a href="https://example.com/embed" data-embed="1">内嵌网页预览</a>',
    normalized: "[内嵌网页预览](https://example.com/embed)",
  },
  {
    id: "custom-attrs-dropped",
    original: '<div data-extra="x" aria-label="卡片">内容</div>',
    normalized: "内容",
  },
  {
    id: "table-flattened",
    original: "| A | B |\n| --- | --- |\n| 1 | 2 |",
    normalized: "A B 1 2",
  },
];

const SAFE: MarkdownClassification = {
  kind: "safe",
  originalHtml: "<p>x</p>",
  normalizedHtml: "<p>x</p>",
  summary: "",
};
const LOSSY: MarkdownClassification = {
  kind: "lossy",
  originalHtml: "<p>x</p>",
  normalizedHtml: "<p>y</p>",
  summary: "第 3 字符起不同",
};

describe("回写守卫 · 规范化与差异摘要", () => {
  it("void 标签、标签间缩进、行尾空白与连续空行不改变比较结果", () => {
    expect(normalizeRenderedHtml('<img src="a" />')).toBe('<img src="a">');
    expect(normalizeRenderedHtml("<div>\n   <p>x</p>   \n</div>")).toBe(
      "<div><p>x</p></div>"
    );
    // 块级标签之间的换行 / 空行整体折叠：HTML 里相邻 <p> 之间有无空行语义相同。
    expect(normalizeRenderedHtml("<p>a</p>\n\n\n\n<p>b</p>")).toBe(
      "<p>a</p><p>b</p>"
    );
  });

  it("单行空格保留：不把真实差异归一化掉", () => {
    expect(normalizeRenderedHtml("<p>a</p> <p>b</p>")).toBe(
      "<p>a</p> <p>b</p>"
    );
  });

  it("差异摘要给出首个不同位置且长度有界", () => {
    expect(describeHtmlDifference("abc", "abc")).toBe("");
    const summary = describeHtmlDifference("abcdef", "abcXYZ");
    expect(summary).toContain("第 3 字符起不同");
    expect(summary).toContain("原文");
    expect(summary).toContain("回写");
    expect(summary.length).toBeLessThan(240);
  });
});

describe("回写守卫 · T0 语料（7 项装配前提）", () => {
  it("覆盖清单与 15 条语料逐字对齐，无遗漏", () => {
    expect([...SAFE_CORPUS_IDS]).toEqual([...EDITOR_CORPUS_IDS]);
    expect(IMAGE_BLOCK_LOSSY_IDS).toEqual(["image", "mixed-document"]);
  });

  it.each(markdownCorpus)(
    "$id 原文自往返判为 safe，且观察点在真实管线里可命中",
    (entry) => {
      // sanitize-html 输出 `<br />` / `<img ... />`，语料观察点与 DOMPurify 口径
      // 写的是 `<br>` / `<img`；比较前按守卫的同一套规范化归一 void 标签。
      const html = normalizeRenderedHtml(render(entry.markdown));
      for (const invariant of entry.invariants) {
        expect(html).toContain(invariant);
      }
      expect(
        classifyMarkdown(entry.markdown, entry.markdown, render).kind
      ).toBe("safe");
    }
  );

  it.each(EQUIVALENT_REWRITES)(
    "字节不同但语义等价：$id 判为 safe",
    (sample) => {
      expect(sample.original).not.toBe(sample.normalized);
      const result = classifyMarkdown(
        sample.original,
        sample.normalized,
        render
      );
      expect(result.kind).toBe("safe");
      expect(result.summary).toBe("");
    }
  );
});

describe("回写守卫 · 有损回写一律拦下", () => {
  it.each(LOSSY_REWRITES)("$id 判为 lossy", (sample) => {
    const result = classifyMarkdown(sample.original, sample.normalized, render);
    expect(result.kind).toBe("lossy");
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("渲染器抛异常按 lossy 处理，绝不静默放行", () => {
    const broken: MarkdownRenderer = () => {
      throw new Error("renderer down");
    };
    expect(classifyMarkdown("# 标题", "# 标题", broken).kind).toBe("lossy");
  });

  it("编辑器往返失败按 lossy 处理", async () => {
    const result = await classifyRoundTrip(
      "# 标题",
      async () => {
        throw new Error("engine down");
      },
      render
    );
    expect(result.kind).toBe("lossy");
    expect(result.summary).toContain("编辑器往返失败");
  });

  it("异步往返成功时结果与同步分类一致", async () => {
    const result = await classifyRoundTrip(
      "- 第一项\n- 第二项",
      async (markdown) => markdown.replace(/^- /gm, "* "),
      render
    );
    expect(result.kind).toBe("safe");
  });
});

describe("回写守卫 · 模式判定与保存前二次守卫", () => {
  it("lossy 默认进源码模式，显式覆盖后才允许进 WYSIWYG", () => {
    expect(decideInitialMode(SAFE)).toBe("wysiwyg");
    expect(decideInitialMode(LOSSY)).toBe("source");
    expect(decideInitialMode(SAFE, true)).toBe("wysiwyg");
    expect(decideInitialMode(LOSSY, true)).toBe("wysiwyg");
  });

  it("源码模式始终放行（保留原始字节）", () => {
    expect(
      guardWysiwygSave({
        mode: "source",
        classification: LOSSY,
        override: true,
      })
    ).toEqual({
      blocked: false,
      reason: "",
    });
  });

  it("WYSIWYG 保存前重新判定 safe 才放行", () => {
    expect(
      guardWysiwygSave({
        mode: "wysiwyg",
        classification: SAFE,
        override: false,
      })
    ).toEqual({ blocked: false, reason: "" });
  });

  it("WYSIWYG 保存前 lossy 阻止保存；显式覆盖也仍被阻止并给出原因", () => {
    for (const override of [false, true]) {
      const decision = guardWysiwygSave({
        mode: "wysiwyg",
        classification: LOSSY,
        override,
      });
      expect(decision.blocked).toBe(true);
      expect(decision.reason).toContain("源码模式");
    }
    expect(
      guardWysiwygSave({
        mode: "wysiwyg",
        classification: LOSSY,
        override: true,
      }).reason
    ).toContain("显式使用所见即所得");
  });
});
