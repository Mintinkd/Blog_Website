/**
 * 文章编辑器回写语料（issue #61 / T0）。
 *
 * 用途：T1 的「语义等价回写」守卫与 T4 的 Milkdown 工作区共用同一组输入，
 * 覆盖 ADR 0006 与 docs/ARTICLE_EDITOR_UPGRADE.md 5.2 列出的存量语法。
 *
 * 约定：
 * - `markdown` 是手写的原始字节，不从任何编辑器实现或序列化结果反推；
 * - `invariants` 是消毒后 HTML 里仍应可观察到的片段，同样手写字面量；
 *   测试用它断言「内容没被静默改写」，而不是断言序列化后的 Markdown 字节；
 * - 本文件只提供输入与观察点，不判定 safe / lossy。分类由 T1 的守卫测试
 *   独立给出期望值；T0 的实测差异表见 docs/reviews/。
 * - `id` 是稳定标识，供其它工单按名引用，不要重命名已有条目。
 */

export type MarkdownCorpusCategory =
  | "gfm-table"
  | "fenced-code"
  | "blockquote"
  | "nested-list"
  | "image"
  | "relative-url"
  | "inline-raw-html"
  | "block-raw-html"
  | "custom-attrs"
  | "embed-link"
  | "media-links"
  | "cjk-punctuation"
  | "escaped-characters"
  | "hard-breaks"
  | "mixed-document";

export interface MarkdownCorpusCase {
  /** 稳定标识，与 category 一一对应。 */
  id: MarkdownCorpusCategory;
  /** 人类可读标题，用于报告与失败信息。 */
  title: string;
  /** 原始 Markdown 字节。 */
  markdown: string;
  /** 经 renderMarkdown 消毒后仍应出现的片段（手写字面量）。 */
  invariants: string[];
  /** 该条检验的风险点。 */
  notes: string;
}

/**
 * 覆盖清单的手写字面量。新增语料时两处都要改：
 * 这里加 id，下面加案例；tests/markdown-corpus.test.ts 会以本数组为独立来源
 * 断言覆盖不退化。
 */
export const EDITOR_CORPUS_IDS = [
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
] as const satisfies readonly MarkdownCorpusCategory[];

export const markdownCorpus: readonly MarkdownCorpusCase[] = [
  {
    id: "gfm-table",
    title: "GFM 表格（对齐、中文表头、行内代码）",
    markdown: [
      "| 列 A | 列 B | 列 C |",
      "| :--- | :---: | ---: |",
      "| 中文 | `code` | 1 |",
      "| **粗体** | [链接](https://example.com) | 2 |",
    ].join("\n"),
    invariants: ["<table>", "<th>", "<td>", "中文", "<code>"],
    notes: "表格是 GFM 扩展节点，remark 序列化常把对齐冒号与管道符重写。",
  },
  {
    id: "fenced-code",
    title: "带语言围栏代码（尖括号、反引号、空行）",
    markdown: [
      "```ts",
      "const html = `<div>${value}</div>`;",
      "if (a < b && c > d) {",
      "  console.log('中文');",
      "}",
      "```",
      "",
      "```",
      "无语言围栏",
      "```",
    ].join("\n"),
    invariants: ["<pre>", "<code>", "const html", "中文", "无语言围栏"],
    notes: "序列化可能改变围栏长度、语言标记位置或把 ``` 改写成缩进代码块。",
  },
  {
    id: "blockquote",
    title: "引用（嵌套引用、引用内列表与代码）",
    markdown: [
      "> 一级引用",
      ">",
      "> > 二级引用",
      ">",
      "> - 引用内列表项",
      "> - 第二项",
      ">",
      "> ```js",
      "> const x = 1;",
      "> ```",
    ].join("\n"),
    invariants: ["<blockquote>", "一级引用", "二级引用", "<li>", "<pre>"],
    notes: "嵌套引用与引用内代码块的换行前缀容易在往返时丢失。",
  },
  {
    id: "nested-list",
    title: "嵌套列表（有序 / 无序混排、松散列表）",
    markdown: [
      "1. 第一项",
      "   - 子项 A",
      "   - 子项 B",
      "     1. 孙项",
      "2. 第二项",
      "",
      "- 松散列表项",
      "",
      "- 另一个松散列表项",
    ].join("\n"),
    invariants: ["<ol>", "<ul>", "<li>", "孙项", "松散列表项"],
    notes: "缩进宽度、有序列表起始编号与松散 / 紧凑判定容易漂移。",
  },
  {
    id: "image",
    title: "图片（alt、title、相对路径）",
    markdown: [
      "![站点封面](/media/cover.png)",
      "",
      '![带标题的图片](https://example.com/a.png "图片标题")',
      "",
      "![中文 alt 与空格](./media/my%20photo.jpg)",
    ].join("\n"),
    invariants: ["<img", "站点封面", "图片标题", "中文 alt 与空格"],
    notes: "图片 URL 含空格 / 百分号编码时，序列化可能改写为尖括号形式或转义。",
  },
  {
    id: "relative-url",
    title: "相对 URL、锚点与 mailto",
    markdown: [
      "[同站文章](/articles/hello)",
      "[站内锚点](#section-1)",
      "[邮件](mailto:hi@example.com)",
      "[协议相对](//example.com/path)",
      "[带括号的路径](https://example.com/a_(b))",
    ].join("\n"),
    invariants: [
      'href="/articles/hello"',
      'href="#section-1"',
      'href="mailto:hi@example.com"',
    ],
    notes: "相对路径与含括号 URL 在 remark-stringify 里可能被改写或加转义。",
  },
  {
    id: "inline-raw-html",
    title: "行内原始 HTML（span / sup / del / 行内属性）",
    markdown: [
      '普通文本 <span class="hl">高亮</span> 与 <sup>上标</sup>、<del>删除</del>。',
      "",
      '行内 <a href="https://example.com" title="标题">锚点</a> 收尾。',
    ].join("\n"),
    invariants: ["<span", "高亮", "<sup>", "<del>", 'title="标题"'],
    notes:
      "Milkdown 的 commonmark 预设若把 html 节点当纯文本，会导致尖括号被转义。",
  },
  {
    id: "block-raw-html",
    title: "块级原始 HTML（容器 + 子元素 + 被剥除的危险标签）",
    markdown: [
      '<div class="note">',
      "  <p>块内的 <strong>原始</strong> 内容</p>",
      "  <script>alert(1)</script>",
      "</div>",
      "",
      '<div class="after">后续块</div>',
    ].join("\n"),
    invariants: ["<div", 'class="note"', "<p>", "<strong>", "后续块"],
    notes:
      "检验原始 HTML 块边界、前后空行，以及消毒器剥除 script 后语义是否等价。",
  },
  {
    id: "custom-attrs",
    title: "data-* / aria-* 自定义属性",
    markdown: [
      '<div class="card" id="card-1" data-extra="x" aria-label="卡片">',
      '  <span data-kind="label" aria-hidden="true">标签</span>',
      "</div>",
      "",
      '[带 data 属性的链接](https://example.com) <a href="/x" data-track="1">跟踪链接</a>',
    ].join("\n"),
    invariants: [
      'data-extra="x"',
      'aria-label="卡片"',
      'data-track="1"',
      'aria-hidden="true"',
    ],
    notes:
      "正文白名单放行 data-* / aria-*；编辑器往返不得静默丢弃这些惰性属性。",
  },
  {
    id: "embed-link",
    title: '内嵌网页预览锚点 data-embed="1"',
    markdown: [
      "普通段落。",
      "",
      '<a href="https://example.com/embed" class="embed-link" id="embed-1" data-embed="1">内嵌网页预览</a>',
      "",
      '另一个 <a href="https://www.bilibili.com/video/BV1xx411c7mD" data-embed="1">B 站内嵌</a> 与 [普通链接](https://example.com)。',
    ].join("\n"),
    invariants: [
      'data-embed="1"',
      'href="https://example.com/embed"',
      "内嵌网页预览",
      'href="https://example.com"',
    ],
    notes:
      "专用节点 / NodeView 必须还原原锚点，不得退化成普通 Markdown 链接或丢属性。",
  },
  {
    id: "media-links",
    title: "音频 / B 站 / YouTube 链接",
    markdown: [
      "[播客音频](https://example.com/audio/ep1.mp3)",
      "[B 站视频](https://www.bilibili.com/video/BV1xx411c7mD)",
      "[YouTube 视频](https://www.youtube.com/watch?v=dQw4w9WgXcQ)",
      "[普通外链](https://example.com/page)",
    ].join("\n"),
    invariants: [
      "audio/ep1.mp3",
      "bilibili.com/video/BV1xx411c7mD",
      "youtube.com/watch?v=dQw4w9WgXcQ",
    ],
    notes:
      "自动识别由前台 enhanceMediaLinks 完成，编辑器不得把 iframe 写进正文。",
  },
  {
    id: "cjk-punctuation",
    title: "中文标点与中英混排",
    markdown: [
      "中文标点：，。！？、；：「」『』《》〈〉……——·～",
      "",
      "Mixed 中英 mixed 混排，with **粗体** 和 `inline code` 代码。",
      "",
      "全角空格　与半角空格 并列，数字 １２３ 与 123 同段。",
    ].join("\n"),
    invariants: [
      "中文标点：",
      "《》",
      "……——",
      "<strong>",
      "<code>",
      "全角空格",
    ],
    notes: "组合输入与序列化不得在中文标点处插入多余空格或吞掉全角字符。",
  },
  {
    id: "escaped-characters",
    title: "转义字符与反斜杠",
    markdown: [
      "字面量星号 \\* 与下划线 \\_ 不是强调。",
      "",
      "字面量方括号 \\[不是链接\\] 与井号 \\# 不是标题。",
      "",
      "表格里的管道符 \\| 与反斜杠 \\\\。",
      "",
      "行内 `code \\` 里的反斜杠`。",
    ].join("\n"),
    invariants: ["*", "_", "[不是链接]", "#", "|", "\\"],
    notes:
      "remark-stringify 会按自身规则重新决定何时转义，渲染结果必须仍一致。",
  },
  {
    id: "hard-breaks",
    title: "硬换行（行尾双空格 / 反斜杠）",
    markdown: [
      "第一行有两个尾随空格  ",
      "第二行紧接硬换行",
      "",
      "第三行用反斜杠硬换行\\",
      "第四行",
      "",
      "第五行只有一个换行（软换行，不应出现 br）",
      "第六行",
    ].join("\n"),
    invariants: ["<br>", "第一行有两个尾随空格", "第三行用反斜杠硬换行"],
    notes:
      "breaks:false 下只有显式硬换行产生 <br>；序列化可能统一改成反斜杠形式。",
  },
  {
    id: "mixed-document",
    title: "综合文档（多类语法相邻）",
    markdown: [
      "# 标题：中文与 English",
      "",
      "> 引用开头，后面紧跟表格与代码。",
      "",
      "| 名称 | 值 |",
      "| --- | --- |",
      "| 表格项 | `v` |",
      "",
      "```js",
      "const t = 1;",
      "```",
      "",
      "- 列表项一",
      "  - 嵌套项",
      "- 列表项二",
      "",
      "![封面](/media/cover.png)",
      "",
      '<a href="https://example.com/embed" data-embed="1">内嵌预览</a>',
      "",
      '<div data-extra="x" aria-label="raw">块级原始 HTML</div>',
      "",
      "结尾：中文标点，转义 \\* 与硬换行  ",
      "最后一行。",
    ].join("\n"),
    invariants: [
      "<h1>",
      "<blockquote>",
      "<table>",
      "<pre>",
      "<ul>",
      "<img",
      'data-embed="1"',
      'data-extra="x"',
      "<br>",
    ],
    notes: "相邻语法的空行结构最容易在往返时被重写；作为守卫的综合回归样本。",
  },
];

/** 按 id 取单条语料，供 T1 / T4 精确引用。 */
export function getCorpusCase(id: MarkdownCorpusCategory): MarkdownCorpusCase {
  const found = markdownCorpus.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`[markdown-corpus] 未找到语料：${id}`);
  }
  return found;
}

/** 把全部语料拼成一篇长文，供长文性能验证与守卫冒烟使用。 */
export function joinCorpusMarkdown(): string {
  return markdownCorpus.map((entry) => entry.markdown).join("\n\n");
}
