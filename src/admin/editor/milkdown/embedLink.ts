/**
 * `<a … data-embed="1">` 的专用内联节点 / NodeView（T4 #65）。
 *
 * T0 实测（docs/reviews/2026-11-14-milkdown-t0-validation.md §3 第 2 项）：
 * 默认装配只是把开 / 闭标签当成 `span[data-type="html"]` 原子片段，往返逐字
 * 保真，但 ProseMirror DOM 里没有真实 `<a>`，不可点击也不可编辑文字。这里
 * 在 mdast 层把「html 开标签 + 纯文字 + html 闭标签」三元组合并成 `embedLink`
 * 节点，编辑器内提供真实可编辑的 `<a>`，序列化时按原开标签逐字还原。
 *
 * 合并失败（嵌套 / 内含强调等复杂结构）一律回退到 Milkdown 默认的原子 html
 * 片段，保证存量正文逐字保真，绝不静默改写。
 */
import { $nodeSchema, $remark, $view } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { NodeView } from "@milkdown/kit/prose/view";
import { escapeHtml } from "../../../utils/escape";
import { getLocale } from "../../../utils/i18n";

interface MdastNode {
  type: string;
  value?: unknown;
  children?: MdastNode[];
  [key: string]: unknown;
}

interface EmbedOpen {
  /** 原始开标签，序列化时逐字还原（含 class / id / data-* 等惰性属性）。 */
  openTag: string;
  href: string;
  className: string;
  embedId: string;
}

const OPEN_TAG = /^<a\s+([^>]*?)>$/i;
const CLOSE_TAG = /^<\/a\s*>$/i;
const EMBED_FLAG = /(?:^|\s)data-embed\s*=\s*(?:"1"|'1'|1)(?:\s|$)/i;

function readAttr(attrs: string, name: string): string {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  ).exec(attrs);
  if (!match) return "";
  return match[1] ?? match[2] ?? match[3] ?? "";
}

/** 只识别「含 data-embed="1" 且未自闭合」的 `<a>` 开标签。 */
export function parseEmbedOpen(value: string): EmbedOpen | null {
  const match = OPEN_TAG.exec(value.trim());
  if (!match) return null;
  const attrs = match[1] ?? "";
  if (!EMBED_FLAG.test(attrs)) return null;
  return {
    openTag: value,
    href: readAttr(attrs, "href"),
    className: readAttr(attrs, "class"),
    embedId: readAttr(attrs, "id"),
  };
}

/**
 * 把同一父节点 children 里的 embed 三元组合成 `embedLink`；中间只允许纯文本，
 * 因为专用 NodeView 的 contentDOM 只承载可编辑文字。
 */
function mergeEmbedTriples(children: MdastNode[]): MdastNode[] {
  const out: MdastNode[] = [];
  for (let i = 0; i < children.length;) {
    const current = children[i];
    const open =
      current?.type === "html" && typeof current.value === "string"
        ? parseEmbedOpen(current.value)
        : null;
    if (!open || !current) {
      if (current) out.push(current);
      i += 1;
      continue;
    }

    let close = -1;
    for (let j = i + 1; j < children.length; j += 1) {
      const next = children[j];
      if (
        next?.type === "html" &&
        typeof next.value === "string" &&
        CLOSE_TAG.test(next.value.trim())
      ) {
        close = j;
        break;
      }
      // 遇到另一个 embed 开标签或任意 html 节点即放弃合并，避免吞掉其它结构。
      if (next?.type === "html") break;
    }

    const middle = close > i ? children.slice(i + 1, close) : [];
    if (close > i && middle.every((node) => node && node.type === "text")) {
      const text = middle.map((node) => String(node.value ?? "")).join("");
      out.push({
        type: "embedLink",
        openTag: open.openTag,
        href: open.href,
        className: open.className,
        embedId: open.embedId,
        children: [{ type: "text", value: text }],
      });
      i = close + 1;
      continue;
    }
    out.push(current);
    i += 1;
  }
  return out;
}

/** 注册在 commonmark preset 之后：只对 paragraph / 其它容器的直接 children 做合并。 */
export const embedLinkRemark = $remark(
  "embedLinkRemark",
  () => () => (tree) => {
    const visit = (node: MdastNode): void => {
      if (!Array.isArray(node.children)) return;
      node.children = mergeEmbedTriples(node.children as MdastNode[]);
      node.children.forEach(visit);
    };
    // unified 的 Root/RootContent 是具体联合类型；这里只做结构遍历，
    // 用一个宽松的只读视图，避免为 mdast 全量联合类型写一遍映射。
    visit(tree as unknown as MdastNode);
  }
);

/** 编辑态不允许危险 scheme 变成真链接；原 openTag 仍逐字保真，不影响回写。 */
function safeHref(href: string): string {
  return /^\s*(?:javascript|data|vbscript):/i.test(href) ? "#" : href || "#";
}

function embedTitle(): string {
  return getLocale() === "zh"
    ? "内嵌网页预览（编辑态不跳转；Ctrl/⌘ + 点击打开）"
    : "Embedded link (no navigation while editing; Ctrl/Cmd + click to open)";
}

export const embedLinkSchema = $nodeSchema("embed_link", () => ({
  inline: true,
  group: "inline",
  content: "text*",
  marks: "",
  selectable: true,
  draggable: false,
  atom: false,
  attrs: {
    openTag: { default: "", validate: "string" },
    href: { default: "", validate: "string" },
    className: { default: "", validate: "string" },
    embedId: { default: "", validate: "string" },
  },
  parseDOM: [
    {
      tag: 'a[data-embed="1"]',
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) return false;
        const open = dom.outerHTML.match(/^<a\s+[^>]*>/i)?.[0] ?? "";
        return {
          openTag:
            open ||
            `<a href="${dom.getAttribute("href") ?? ""}" data-embed="1">`,
          href: dom.getAttribute("href") ?? "",
          className: dom.getAttribute("class") ?? "",
          embedId: dom.getAttribute("id") ?? "",
        };
      },
    },
  ],
  toDOM: (node) => [
    "a",
    {
      href: safeHref(String(node.attrs.href ?? "")),
      "data-embed": "1",
      "data-editor-embed": "1",
      ...(node.attrs.className ? { class: String(node.attrs.className) } : {}),
      ...(node.attrs.embedId ? { id: String(node.attrs.embedId) } : {}),
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === "embedLink",
    runner: (state, node, type) => {
      state.openNode(type, {
        openTag: String(node.openTag ?? ""),
        href: String(node.href ?? ""),
        className: String(node.className ?? ""),
        embedId: String(node.embedId ?? ""),
      });
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "embed_link",
    runner: (state, node: ProseNode) => {
      // 保留原开标签（含 class / id / data-*），只把可编辑文字按 HTML 文本转义。
      const openTag = String(node.attrs.openTag ?? "");
      const text = escapeHtml(node.textContent ?? "");
      state.addNode("html", undefined, `${openTag}${text}</a>`);
    },
  },
}));

/** NodeView：真实 `<a>` + 可编辑 contentDOM；切换语言只改 title，不重建实例。 */
export const embedLinkView = $view(embedLinkSchema.node, () => {
  const createView = (node: ProseNode): NodeView => {
    const dom = document.createElement("a");
    dom.setAttribute("data-embed", "1");
    dom.setAttribute("data-editor-embed", "1");
    const contentDOM = document.createElement("span");
    dom.appendChild(contentDOM);

    const applyAttrs = (next: ProseNode): void => {
      dom.setAttribute("href", safeHref(String(next.attrs.href ?? "")));
      dom.setAttribute("title", embedTitle());
      if (next.attrs.className) {
        dom.setAttribute("class", String(next.attrs.className));
      } else {
        dom.removeAttribute("class");
      }
      if (next.attrs.embedId) {
        dom.setAttribute("id", String(next.attrs.embedId));
      } else {
        dom.removeAttribute("id");
      }
    };
    applyAttrs(node);

    const onClick = (event: MouseEvent): void => {
      // 编辑态点击不导航（避免误离开未保存的正文）；修饰键点击才打开新标签。
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      contentDOM.focus();
    };
    const onLocaleChanged = (): void => {
      dom.setAttribute("title", embedTitle());
    };
    dom.addEventListener("click", onClick);
    document.addEventListener("locale-changed", onLocaleChanged);

    return {
      dom,
      contentDOM,
      update(next) {
        if (next.type.name !== "embed_link") return false;
        applyAttrs(next);
        return true;
      },
      destroy() {
        dom.removeEventListener("click", onClick);
        document.removeEventListener("locale-changed", onLocaleChanged);
      },
    };
  };
  return createView;
});
