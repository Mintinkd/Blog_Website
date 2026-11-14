import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/utils/markdown";
import {
  EDITOR_CORPUS_IDS,
  getCorpusCase,
  joinCorpusMarkdown,
  markdownCorpus,
  type MarkdownCorpusCategory,
} from "./fixtures/editor/markdown-corpus";

/**
 * issue #61 / T0：回写语料入库后的自检。
 *
 * 期望值独立来源：覆盖清单在下面手写字面量重列一次，不从 fixture 的
 * EDITOR_CORPUS_IDS 反推；invariants 则必须在真实 renderMarkdown 输出里
 * 逐条命中，避免语料写了一个编辑器根本渲染不出来的观察点。
 */
const EXPECTED_IDS: readonly MarkdownCorpusCategory[] = [
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
];

/** DOMPurify 与 sanitize-html 对 void 标签的序列化差异，比较前归一化。 */
function normalizeVoidTags(html: string): string {
  return html.replace(/\s*\/>/g, ">");
}

describe("文章编辑器回写语料", () => {
  it("覆盖清单逐字钉住 15 类存量语法，且无重复 / 无遗漏", () => {
    expect(EXPECTED_IDS).toEqual(EDITOR_CORPUS_IDS);
    expect(markdownCorpus.map((entry) => entry.id)).toEqual(EXPECTED_IDS);
    expect(new Set(markdownCorpus.map((entry) => entry.id)).size).toBe(
      EXPECTED_IDS.length
    );
  });

  it.each(markdownCorpus)("$id 的字段完整且观察点非空", (entry) => {
    expect(entry.markdown.trim().length).toBeGreaterThan(0);
    expect(entry.invariants.length).toBeGreaterThan(0);
    expect(entry.notes.trim().length).toBeGreaterThan(0);
    expect(entry.title.trim().length).toBeGreaterThan(0);
    for (const invariant of entry.invariants) {
      expect(typeof invariant).toBe("string");
      expect(invariant.length).toBeGreaterThan(0);
    }
  });

  it.each(markdownCorpus)("$id 的观察点确实出现在消毒后的正文里", (entry) => {
    const html = normalizeVoidTags(renderMarkdown(entry.markdown));
    for (const invariant of entry.invariants) {
      expect(html).toContain(invariant);
    }
  });

  it("按 id 取语料与拼接长文都可用", () => {
    expect(getCorpusCase("embed-link").markdown).toContain('data-embed="1"');
    expect(() =>
      getCorpusCase("not-a-category" as MarkdownCorpusCategory)
    ).toThrow(/未找到语料/);
    const joined = joinCorpusMarkdown();
    expect(joined.length).toBeGreaterThan(1000);
    expect(joined).toContain("| 列 A |");
    expect(joined).toContain("data-embed");
    // 拼接结果仍是 Markdown 源文本，不应混入渲染后的 HTML 标签。
    expect(joined).not.toContain("<table>");
  });
});
