/**
 * 源码模式（GLOSSARY：源码模式）工具栏 / 快捷键的纯插入与包裹逻辑。
 *
 * 输入一律是「Markdown 文本 + 选区」，输出「新文本 + 新选区」；不读取 DOM、
 * 不 import Vue，由 T3 的 MarkdownWorkspace.vue 把结果写回 textarea 并
 * setSelectionRange。期望值由 tests/editor-commands.test.ts 的手写字面量钉住。
 *
 * 转义口径：mdEscapeText / mdEscapeUrl 迁自 src/admin/App.vue 的既有实现，
 * 是 Markdown 语法转义；src/utils/escape.ts 的 escapeHtml / escapeAttr 是
 * HTML 输出编码，二者不可互相替代。内嵌网页预览（<a data-embed="1">）属于
 * HTML 属性 / 文本上下文，因此复用 escape.ts，不再复制第三份转义函数。
 */
import { escapeAttr, escapeHtml } from "../escape";

export interface TextSelection {
  start: number;
  end: number;
}

export interface CommandResult {
  text: string;
  selection: TextSelection;
}

export type LinkMode = "link" | "embed";

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function normalizeSelection(
  text: string,
  selection: TextSelection
): TextSelection {
  const start = clamp(selection.start, 0, text.length);
  const end = clamp(selection.end, start, text.length);
  return { start, end };
}

/** Markdown 链接文字 / 图片 alt 转义：方括号会提前闭合 [...] 结构。 */
export function mdEscapeText(text: string): string {
  return text.replace(/([[\]])/g, "\\$1");
}

/** Markdown 链接 URL 转义：圆括号与空白会截断 (...) 目标。 */
export function mdEscapeUrl(url: string): string {
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20");
}

/**
 * 普通链接 / 图片 URL 只允许 http(s)，与 docs/ARTICLE_EDITOR_UPGRADE.md §5.3
 * 「URL 仅允许 http(s)://」一致；相对 /media 地址由 T5 上传适配器另行放行。
 */
export function isAllowedLinkUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/**
 * 在选区处插入片段。selectedRange 是相对片段的偏移，用于把光标 / 选区
 * 落在片段内部（如图片 alt）；不传则光标落在片段末尾。
 */
export function insertSnippet(
  text: string,
  selection: TextSelection,
  snippet: string,
  selectedRange?: { start: number; end: number }
): CommandResult {
  const { start, end } = normalizeSelection(text, selection);
  const next = text.slice(0, start) + snippet + text.slice(end);
  if (!selectedRange) {
    const caret = start + snippet.length;
    return { text: next, selection: { start: caret, end: caret } };
  }
  const from = clamp(selectedRange.start, 0, snippet.length);
  const to = clamp(selectedRange.end, from, snippet.length);
  return {
    text: next,
    selection: { start: start + from, end: start + to },
  };
}

/** 包裹选区；无选区时插入 placeholder 并选中它，便于继续输入。 */
export function wrapSelection(
  text: string,
  selection: TextSelection,
  before: string,
  after: string,
  placeholder = ""
): CommandResult {
  const { start, end } = normalizeSelection(text, selection);
  const selected = text.slice(start, end);
  if (selected.length > 0) {
    const snippet = before + selected + after;
    return {
      text: text.slice(0, start) + snippet + text.slice(end),
      selection: {
        start: start + before.length,
        end: start + before.length + selected.length,
      },
    };
  }
  return insertSnippet(text, { start, end }, before + placeholder + after, {
    start: before.length,
    end: before.length + placeholder.length,
  });
}

/**
 * 切换行前缀（标题 / 引用 / 列表）：选区覆盖的所有行都带前缀则全部移除，
 * 否则全部加上。选区随首行与整块的位移一起平移，避免光标跳到行首。
 */
export function toggleLinePrefix(
  text: string,
  selection: TextSelection,
  prefix: string
): CommandResult {
  const { start, end } = normalizeSelection(text, selection);
  const lineStart = text.slice(0, start).lastIndexOf("\n") + 1;
  const lineBreak = text.indexOf("\n", end);
  const lineEnd = lineBreak === -1 ? text.length : lineBreak;
  const block = text.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const allPrefixed = lines.every((line) => line.startsWith(prefix));
  const nextLines = lines.map((line) =>
    allPrefixed ? line.slice(prefix.length) : prefix + line
  );
  const nextBlock = nextLines.join("\n");
  const firstDelta = nextLines[0].length - lines[0].length;
  const blockDelta = nextBlock.length - block.length;
  const nextStart = Math.max(lineStart, start + firstDelta);
  const nextEnd = Math.max(nextStart, end + blockDelta);
  return {
    text: text.slice(0, lineStart) + nextBlock + text.slice(lineEnd),
    selection: { start: nextStart, end: nextEnd },
  };
}

/**
 * 列表续行：源码模式按 Enter 时替代浏览器默认换行。
 * 当前行为列表项且有内容 → 插入新行与下一项前缀（有序列表序号 +1）；
 * 当前行为空列表项 → 移除该行前缀退出列表；非列表行 → 只插入换行。
 */
export function continueList(
  text: string,
  selection: TextSelection
): CommandResult {
  const { start, end } = normalizeSelection(text, selection);
  const lineStart = text.slice(0, start).lastIndexOf("\n") + 1;
  const line = text.slice(lineStart, end);
  const unordered = line.match(/^(\s*)([-*+])(\s+)(.*)$/);
  const ordered = line.match(/^(\s*)(\d+)([.)])(\s+)(.*)$/);
  const item = unordered
    ? {
        indent: unordered[1],
        marker: unordered[2],
        separator: unordered[3],
        body: unordered[4],
      }
    : ordered
      ? {
          indent: ordered[1],
          // 有序列表保留原有分隔符（1. / 1) 两种写法），序号递增。
          marker: String(Number(ordered[2]) + 1) + ordered[3],
          separator: ordered[4],
          body: ordered[5],
        }
      : null;

  if (!item) return insertSnippet(text, { start, end }, "\n");

  if (item.body.trim() === "") {
    const next = text.slice(0, lineStart) + text.slice(end);
    return {
      text: next,
      selection: { start: lineStart, end: lineStart },
    };
  }

  const marker = item.marker;
  return insertSnippet(
    text,
    { start, end },
    "\n" + item.indent + marker + item.separator
  );
}

/** 构造链接片段：普通链接写 Markdown，内嵌网页预览写 <a data-embed="1">。 */
export function buildLinkSnippet(
  url: string,
  label: string,
  mode: LinkMode = "link"
): string {
  const target = url.trim();
  if (mode === "embed") {
    return `<a href="${escapeAttr(target)}" data-embed="1">${escapeHtml(label)}</a>`;
  }
  return `[${mdEscapeText(label)}](${mdEscapeUrl(target)})`;
}

/** 插入链接；未提供文字时用去掉协议的 URL 作为链接文字（与现有弹窗一致）。 */
export function insertLink(
  text: string,
  selection: TextSelection,
  options: { url: string; label: string; mode?: LinkMode }
): CommandResult {
  const label =
    options.label.trim() || options.url.trim().replace(/^https?:\/\//i, "");
  return insertSnippet(
    text,
    selection,
    buildLinkSnippet(options.url, label, options.mode)
  );
}

/** 构造图片片段；alt 与 URL 都按 Markdown 规则转义。 */
export function buildImageSnippet(url: string, alt: string): string {
  return `![${mdEscapeText(alt)}](${mdEscapeUrl(url.trim())})`;
}

/** 插入图片；默认选中 alt 文本，符合 docs/ARTICLE_EDITOR_UPGRADE.md §8.4。 */
export function insertImage(
  text: string,
  selection: TextSelection,
  options: { url: string; alt: string; selectAlt?: boolean }
): CommandResult {
  const safeAlt = mdEscapeText(options.alt);
  const snippet = buildImageSnippet(options.url, options.alt);
  return insertSnippet(
    text,
    selection,
    snippet,
    options.selectAlt === false
      ? undefined
      : { start: 2, end: 2 + safeAlt.length }
  );
}
