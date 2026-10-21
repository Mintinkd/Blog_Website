# 代码审查报告 — #37 T1 文章详情 SSR：共享正文白名单与服务端渲染器（code-review 技能，基点 `3bf64be`）

- **日期**：2026-10-21
- **基点**：`3bf64be`（#37 实施前 HEAD，ADR 0004 入库之后）
- **变更提交**（1 个，实施提交）：
  - `b2dcff6` feat: 文章 SSR T1——共享正文白名单与服务端渲染器（#37）
- **复审修正提交**（1 个）：
  - `89cea96` fix: 文章 SSR T1 审查跟进——nonTextTags 与 URI 属性对齐（#37）
- **Spec 来源**：GitHub issue #37 原文（enhancement / ready-for-agent；Parent #36）
- **标准来源**：`CODING_STANDARDS.md`（契约面同步）+ `README.md` 契约面 + `AGENTS.md` + `docs/agents/testing.md` + ADR 0004；Fowler 坏味道基线
- **方法**：code-review 技能原流程 — 两轴并行子代理（Standards / Spec）；本文件归并两轴结论与处置，**不做跨轴合并或重排序**

---

## Spec

### （a）缺失 / 部分落实

1. **AC「原始 HTML 行为与现有后台预览一致」未完全落实 — 已修复 `89cea96`**
   实施只共享了标签 / 属性 / scheme 列表，没有共享「剥除标签时如何处理子树」的语义。sanitize-html 默认 `nonTextTags` 为 `script/style/textarea/option/xmp`：它会保留 `iframe`、`template`、`audio`、`video`、`title`、`svg` 的子树文本（预览会丢弃），又会丢弃 `textarea` / `option` 的文本（预览会保留）。只比对空 `<iframe>` 的既有 fixture 无法暴露该差异。
   **处置**：新增 `ARTICLE_BODY_FORBID_CONTENT_TAGS`，逐字对齐 DOMPurify 3.x 默认 `FORBID_CONTENTS`，并作为 sanitize-html 的 `nonTextTags`；`thead` 虽在列表中，但 sanitize-html 只对未放行标签应用 nonTextTags，GFM 表头不受影响。新增 iframe / template / audio / video / title / svg 丢弃子树、textarea / option 保留文本的用例。

2. **AC「与后台预览一致」在 `target` / `rel` 上仍有 scheme 校验缺口 — 已修复 `89cea96`**
   DOMPurify 会对所有不在 `URI_SAFE_ATTRIBUTES` 内的属性执行 `ALLOWED_URI_REGEXP` 校验；正文白名单里 `href` / `src` 之外的 `target` / `rel` 也在此列。sanitize-html 默认 `allowedSchemesAppliedToAttributes` 只覆盖 `href` / `src` / `cite` 等，导致 `target="javascript:alert(1)"` 在服务端保留、在预览被剥除。
   **处置**：将 `allowedSchemesAppliedToAttributes` 显式设为 `href/src/target/rel`（白名单内其余属性均属 DOMPurify 的 URI 安全属性或被 `data-*` / `aria-*` 分支短路）；新增危险值与安全值对用例。

3. **DOM clobbering 差异未记录处置 — 已记录差异，T2 复核（本票不修）**
   DOMPurify 默认 `SANITIZE_DOM` 会丢弃与 `document` / `form` 属性同名的 `id` / `name`（如 `id="body"`、`id="forms"`），sanitize-html 没有等价能力。该差异会让同一份原始 HTML 在两端得到不同结果。
   **处置**：T1 不接线页面，文章详情页仍在客户端用默认 DOMPurify 复消毒 `content_html` 后才插入，当前暴露面不扩大；服务端无 DOM，无法复刻 `value in document`，手写 denylist 只能覆盖部分属性、反而制造虚假对等，因此不在本票实现。已在 `markdownPolicy.ts` 的服务端配置旁写明，并要求 T2 移除客户端兜底前复核：保留一次 DOMPurify 复消毒，或为 `id` 增加 denylist。

4. **一致性测试未覆盖上述默认口径差异 — 已修复 `89cea96`**
   原 parity fixture 只有一个空 `<iframe>`，textarea / option / template / target / rel 均未出现，测试无法阻止两端漂移。
   **处置**：新增 `RAW_HTML_PARITY_CASES`，逐例比较预览与服务端输出；服务端测试同时直接断言危险值被剥除、安全值与保留文本仍在，避免两边一起退化为「什么都不过滤」。

### （b）超纲 / 行为漂移

1. **`img` 放行 `data:`、`data-*` / `aria-*` 属性 — 经复验保留**
   这些不在票面白名单文字中，但都是 DOMPurify 的默认行为（`DATA_URI_TAGS` / `ALLOW_DATA_ATTR` / `ALLOW_ARIA_ATTR`）：不放行反而会让服务端比预览更严，违背「原始 HTML 行为一致」。相对预览没有扩大能力，链接上的 `data:` 仍被剥除。白名单测试已把 `data-*` / `aria-*` 与 `img: data` 手写钉住。

2. **scheme 列表包含 `ftps` / `callto` / `sms` / `cid` / `xmpp` / `matrix` — 经复验保留**
   票面要求共享现有正文 scheme 策略；这些值来自 DOMPurify 默认 `ALLOWED_URI_REGEXP`，删减会让预览输出变化。保持与既有预览一致。

### （c）实现但不够精确

1. **服务端渲染器尚未接入页面，AC 只能由测试而非端到端行为证明 — 经复验保留（工单范围）**
   本票明确「不改变页面行为」；`renderMarkdownServer` 的可用性由 node 环境测试、Astro 构建与临时 workerd 烟测证明，页面接线留给 T2。报告在验收对照中记录该边界。

---

## Standards

### （a）违反已文档化标准 — 0 条

无硬性违规。`CODING_STANDARDS.md` 的唯一规则（契约面同步）为判断题，见（b）。

### （b）已文档化标准的判断项

1. **README 把「后台预览」整体说成消费共享白名单 — 已修复 `89cea96`**
   实际消费共享白名单的是 `renderMarkdown`（抓取渲染预览、关于页、文章 Markdown 兜底），文章编辑器预览 `src/admin/App.vue:updatePreview` 仍是自己的 `marked.parse` + 默认 `DOMPurify.sanitize`。原措辞会让读者以为编辑器预览也受同一白名单约束。
   **处置**：技术栈行改为点名 `renderMarkdown` 与服务端渲染器共用白名单，并显式写明编辑器预览仍走既有路径；结构清单把 `markdown.ts` 的描述从「后台预览」改为「DOMPurify 消毒，消费共享正文白名单」。T3 审查已接受编辑器预览的这一分歧，本次只同步契约文字。

2. **文章详情页仍以默认 DOMPurify 复消毒 `content_html` — 已记录，T2 处理**
   `src/pages/articles/[slug].astro:93` 的 `DOMPurify.sanitize(article.content_html)` 没有传共享配置，允许范围比正文白名单宽；它与服务端渲染器目前尚未接线，所以本票没有行为变化。该调用同时也是 DOM clobbering 差异的现有缓解。
   **处置**：按票面「无页面改动」不改页面；在 Spec（a）3 与 `markdownPolicy.ts` 注释中记录 T2 的前置条件。

### （c）基线坏味道与判断项

1. **`canonical()` 命名掩盖了它只归一化 void 标签 — 已修复 `89cea96`**
   函数实际只把 `<img ... />` 归一为 `<img ...>`，与「canonical HTML」的暗示不符。重命名为 `normalizeVoidTags`，比较逻辑不变。

2. **`marked.setOptions` 全局副作用 — 已修复 `89cea96`**
   `markdown.ts` 在模块加载时改写 marked 全局默认值，会影响同页其他 `marked.parse` 调用方（包括编辑器预览）。改为在 `renderMarkdown` / `extractHeadings` 每次调用传入 `MARKDOWN_PARSE_OPTIONS`；因 marked 默认本就是 `gfm: true, breaks: false`，预览输出不变。

3. **策略测试从被测常量推导期望值（自证） — 已修复 `89cea96`**
   原测试只比较预览与服务端，若两边共用同一份被误改的列表仍会一起通过，违反 `docs/agents/testing.md` 的「期望值须有独立来源」约定。
   **处置**：新增 `tests/markdown-policy.test.ts`，手写字面量钉住标签、属性、scheme、`FORBID_CONTENTS` 与 URI 校验属性；另行断言两个消毒器配置确实消费同一份列表，并用独立样本验证 DOMPurify URI 正则接受白名单 scheme / 相对地址、拒绝 `javascript:` / `data:` / `vbscript:`。

---

## 运行时烟测

- **workerd**：实施轮用临时 wrangler worker 在 workerd 内调用 `renderMarkdownServer`，确认表格、围栏代码、图片保留，`<script>` 与 `javascript:` 链接被剥除；临时文件已删除。`89cea96` 未引入新的运行时依赖，sanitize-html 侧变更均为静态选项。
- **SSR 打包**：临时 Astro 页面构建确认 `sanitize-html` 被打进 SSR chunk，临时页面已删除；最终构建不含临时页面。
- **页面未改动**：`src/pages/`、`src/admin/` 在 `3bf64be..89cea96` 内无 diff。

---

## 验收对照

- [x] 共享策略模块同时被 `renderMarkdown`（DOMPurify）与 `renderMarkdownServer`（sanitize-html）消费；标签 / 属性 / scheme / URI 正则与既有配置等价，`data-*` / `aria-*` 本就是 DOMPurify 默认，预览输出不变。
- [x] 服务端渲染器在 Workers 运行时可用：Astro 构建、类型检查、worker typecheck 通过；workerd 烟测通过；`sanitize-html` 可用，未启用 `dompurify + linkedom` 回退。
- [x] 测试覆盖标题 / 列表 / 表格 / 围栏代码 / 图片 / 链接保留；script / style / iframe / object / embed / form 剥除；`on*` 剥除；`javascript:` 与 `data:text/html` 剥除。
- [x] 原始 HTML 行为与现有后台预览一致：主 fixture + 边界用例逐例比对；DOM clobbering 差异已记录并转 T2。
- [x] 现有根级与 worker 测试全绿；无页面改动。
- [x] README 技术栈与结构清单同步；新增白名单字面量测试，避免策略与测试同源漂移。

---

## 门禁重放

- root `npm test`：6 文件 / 47 用例通过（新增 `markdown-policy` 3 例、`markdown-server` 2 例、parity 边界 10 例）。
- root `npm run check`：0 errors / 0 warnings（5 hints，均为既有）。
- root `npm run build`：Astro 构建 + prebuild 生成物 + CSP 收紧通过（静态与 SSR 两份 CSP 逐字符一致）。
- worker `npm run typecheck`：`tsc --noEmit` + `tsconfig.test.json` 零错误。
- worker `npm test`：9 文件 / 82 用例通过。
- `git commit`（`b2dcff6`、`89cea96`）：仓库 pre-commit（lint-staged + worker typecheck/test）均通过，未跳过钩子。

**总结**：Spec 轴 7 条发现——3 条修复（子树丢弃口径、target/rel scheme、parity 覆盖）、1 条记录并转 T2（DOM clobbering）、3 条经复验保留（`data:` / data-* / aria-*、既有 scheme 列表、本票不接线页面）；Standards 轴 0 硬违规，5 条判断项中 4 条修复（README 措辞、`canonical` 命名、marked 全局副作用、白名单字面量测试）、1 条记录并转 T2（页面默认 DOMPurify 复消毒）。两轴对同一白名单问题的表述按轴分列，不跨轴合并。
