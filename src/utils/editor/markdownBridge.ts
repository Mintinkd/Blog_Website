/**
 * 语义等价回写 / 回写守卫（GLOSSARY：语义等价回写、回写守卫）。
 *
 * 契约见 docs/ARTICLE_EDITOR_UPGRADE.md §5.2 与 ADR 0006：
 * - 编辑器序列化出的 Markdown 与原文不要求字节相同（T0 实测 0/15 字节相同），
 *   只比较二者经同一 `renderMarkdown` 渲染、规范化后的结果；
 * - 比较失败一律按 lossy 处理（保守，不静默改写存量正文）；
 * - 本文件是纯函数：不 import Vue / DOM / DOMPurify，渲染器由调用方注入，
 *   因此可以在 node 环境的 vitest 里用独立 stub 钉住守卫行为。
 *
 * 期望值来源：tests/editor-markdown-bridge.test.ts 的手写字面量；语料单源是
 * tests/fixtures/editor/markdown-corpus.ts（T0 / #61 入库）。
 */
export type EditorMode = "wysiwyg" | "source";

export type MarkdownRenderer = (markdown: string) => string;

export type MarkdownEquivalence = "safe" | "lossy";

export interface MarkdownClassification {
  kind: MarkdownEquivalence;
  /** 原文经渲染器消毒后的规范化结果，仅用于比较与提示。 */
  originalHtml: string;
  /** 编辑器往返序列化结果经同一渲染器消毒后的规范化结果。 */
  normalizedHtml: string;
  /** 人可读的差异摘要；safe 时为空串。不得插入 DOM（只做文本展示）。 */
  summary: string;
}

/**
 * 规范化消毒后的 HTML：
 * - void 标签 `<img ... />` / `<img ...>` 视为等价（DOMPurify 与 sanitize-html 的序列化差异）；
 * - 块级标签之间的缩进 / 换行不计（marked 对等价 Markdown 会产生不同空行）；
 * - 行尾空白与连续空行折叠；
 * - **不**折叠标签之间的单行空格、不重排属性：这类差异一律按 lossy 处理，
 *   宁可多进源码模式，也不能把真实差异判成 safe。
 */
export function normalizeRenderedHtml(html: string): string {
  return html
    .replace(/\s*\/>/g, ">")
    .replace(/>\s*\n\s*</g, "><")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 第一处差异的可读摘要；限制长度，避免把整篇正文塞进提示条。 */
export function describeHtmlDifference(
  original: string,
  normalized: string
): string {
  if (original === normalized) return "";
  let index = 0;
  const limit = Math.min(original.length, normalized.length);
  while (index < limit && original[index] === normalized[index]) index += 1;
  const from = Math.max(0, index - 32);
  const slice = (value: string) => JSON.stringify(value.slice(from, from + 80));
  return `第 ${index} 字符起不同：原文 ${slice(original)}；回写 ${slice(normalized)}`;
}

/**
 * 加载 / 模式切换 / 保存前的统一判定入口。
 * `original` 是存量 Markdown 字节，`normalized` 是编辑器「解析后立即序列化」
 * 的结果（不写回正文）。渲染器抛异常时按 lossy 处理，绝不放行。
 */
export function classifyMarkdown(
  original: string,
  normalized: string,
  render: MarkdownRenderer
): MarkdownClassification {
  let originalHtml = "";
  let normalizedHtml = "";
  try {
    originalHtml = normalizeRenderedHtml(render(original));
    normalizedHtml = normalizeRenderedHtml(render(normalized));
  } catch {
    return {
      kind: "lossy",
      originalHtml: "",
      normalizedHtml: "",
      summary: "渲染器执行失败，已按有损处理",
    };
  }
  return {
    kind: originalHtml === normalizedHtml ? "safe" : "lossy",
    originalHtml,
    normalizedHtml,
    summary: describeHtmlDifference(originalHtml, normalizedHtml),
  };
}

/**
 * 编辑器往返 + 分类的编排；往返本身失败（引擎未加载 / 解析异常）也按 lossy。
 * `roundTrip` 由 WYSIWYG 内核提供，注入以便 node 环境单测。
 */
export async function classifyRoundTrip(
  markdown: string,
  roundTrip: (markdown: string) => Promise<string>,
  render: MarkdownRenderer
): Promise<MarkdownClassification> {
  try {
    const normalized = await roundTrip(markdown);
    return classifyMarkdown(markdown, normalized, render);
  } catch {
    return {
      kind: "lossy",
      originalHtml: "",
      normalizedHtml: "",
      summary: "编辑器往返失败，已按有损处理",
    };
  }
}

/**
 * 初始 / 切换后的编辑形态：lossy 默认进源码模式；作者显式覆盖后可进 WYSIWYG，
 * 但保存前守卫仍独立执行（见 guardWysiwygSave），覆盖不等于放行保存。
 */
export function decideInitialMode(
  classification: MarkdownClassification,
  override = false
): EditorMode {
  if (classification.kind === "lossy" && !override) return "source";
  return "wysiwyg";
}

export interface SaveGuardInput {
  mode: EditorMode;
  /** 保存前对「当前正文」重新执行往返得到的分类，不复用加载时的结论。 */
  classification: MarkdownClassification;
  /** 作者是否显式覆盖过 lossy 判定。 */
  override: boolean;
}

export interface SaveGuardDecision {
  blocked: boolean;
  /** 阻止保存时给作者的提示（只做文本展示）。 */
  reason: string;
}

/**
 * 保存前二次守卫：源码模式始终可保存（保留原始字节）；WYSIWYG 模式下，
 * 只要当前正文的往返判定仍是 lossy 就阻止保存并提示，显式覆盖也不例外。
 */
export function guardWysiwygSave(input: SaveGuardInput): SaveGuardDecision {
  if (input.mode === "source") return { blocked: false, reason: "" };
  if (input.classification.kind === "safe") {
    return { blocked: false, reason: "" };
  }
  const prefix = input.override
    ? "已显式使用所见即所得，但保存前守卫仍判定有损"
    : "保存前守卫判定有损";
  return {
    blocked: true,
    reason: `${prefix}：请在源码模式保存，或修正无法无损表示的语法。${input.classification.summary}`,
  };
}
