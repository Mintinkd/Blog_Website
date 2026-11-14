# Milkdown 7 技术验证（issue #61 / T0）

2026-11-14。结论：**通过（有条件）**，ADR 0006 由 `proposed` 改为 `accepted`，**T4（#65）解除阻塞**，但按下文「T4 落地约束」修订装配清单后才可实施。

本报告的每条数字都来自可丢弃原型的实测输出，不来自推测。原型位于 `.t0-prototype/`（未提交、验证后清理），由 esbuild 打包 + Playwright 1.64.1（系统 Edge）+ 本地静态服务驱动；静态服务下发生产收紧后的 CSP（`tightenCsp([])`，即 `script-src 'self'`，无 `'unsafe-inline'`、无 hash）。语料与回写判定都调用仓库真实的 `src/utils/markdown.ts` → `renderMarkdown`（marked + DOMPurify 白名单），不是另起的渲染器。

## 1. 环境与依赖

| 项               | 实测值                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node / npm       | v22.22.2 / 10.9.7                                                                                                                                    |
| registry         | `https://registry.npmmirror.com/`                                                                                                                    |
| 安装入口         | `@milkdown/crepe@^7` → 解析为 `7.23.0`                                                                                                               |
| `@milkdown/*` 包 | 23 个，**全部 7.23.0**，无跨版本混装                                                                                                                 |
| lockfile 变化    | 884 → 992 entries，新增 108，其中 `@milkdown/*` 25；根依赖新增 `"@milkdown/crepe": "^7.23.0"`，其余 1 个 entry 变化                                  |
| 交付 PR          | **不含** `package.json` / `package-lock.json` 变更（原型装在主仓 node_modules 做实测后已回滚，快照留存于原型目录）。T4 按上表同一组版本落地          |
| 构建             | `SITEMAP_API_BASE=http://127.0.0.1:9 npm run build` 通过；`[csp] script-src 已收紧：内联脚本 22 处 / 唯一 hash 3 个`，静态与 SSR 两份 CSP 逐字符一致 |

## 2. 原型装配

`CrepeBuilder` 按需装配 ADR 0006 的 8 项必选：`toolbar` / `list-item` / `link-tooltip` / `image-block` / `table` / `block-edit` / `placeholder` / `cursor`；不装 `code-mirror` / `latex` / `ai` / `top-bar`。Vue 3 侧用 `defineAsyncComponent` + `import()` 懒加载运行时，与 T4 规划的 `MarkdownWorkspace.vue` 同构。

另跑两组对照装配（见 §3 第 1、3 项）：

- **B**：去掉 `image-block`，其余不变；
- **C**：在 B 基础上覆盖 `uploadConfig.uploader`，用普通 `image` 节点接上传返回的相对 URL。

## 3. 11 项验证结论与数据

| #   | 验证项     | 结论                                                      | 实测数据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 回写语料   | **有条件通过**：内核装配下 15/15 语义等价；默认装配 13/15 | 默认装配：15 条语料，**0 条字节相同**（符合「语义等价回写」定义，不要求字节一致），13 条 `renderMarkdown` 归一化后 HTML 一致，2 条 lossy：`image`、`mixed-document`。对照 B（去掉 `image-block`）与 C（B + 自定义 uploader）：**15/15 全部 HTML 一致**。差异样本：GFM 表格对齐列宽被重排、`-` 列表改 `*`、硬换行两空格改 `\`、转义按 remark 规则重写——均不改变消毒后 HTML                                                                                                                                                                                                                                                                                              |
| 2   | embed 锚点 | **有缺口，需适配层**                                      | `<a href="…" data-embed="1">` 往返**逐字保真**（含 `class` / `id` / 多个锚点 / 中文文字），`renderMarkdown` 前后 HTML 完全一致。但 ProseMirror DOM 里 `a[data-embed]` 数量为 **0**：开始 / 结束标签被渲染成 `contenteditable="false"` 的 `span[data-type="html"]` 文本片段，只有中间文字可编辑。即「不退化、不丢属性」达标，**「可点击、可编辑的专用 NodeView」未达标**，T4 必须自定义内联节点                                                                                                                                                                                                                                                                         |
| 3   | 图片上传   | **粘贴通过；拖拽未复现；默认装配 alt 契约被破坏**         | 默认装配：粘贴触发 `onUpload` 1 次（file `photo.png` / `image/png` / 8B），插入 `![1.00](/media/uploaded/t0-upload.png)` —— `alt` 变成 `1.00`，**不符合**「alt 取 original_name」契约。拖拽用 Playwright `DataTransfer` handle 构造真实 `DragEvent`（`dragover` + `drop`，`files.length=1`）后 `onUpload` 调用数仍为 0、正文无图片。对照 C：粘贴调用 1 次，插入 `![photo](/media/uploaded/t0-upload.png)`（alt = 文件名去扩展名），且 15/15 语料仍等价                                                                                                                                                                                                                 |
| 4   | 包体       | **通过**                                                  | esbuild `splitting` + metafile，首屏集合 = 从 `main.ts` 沿非 `dynamic-import` 的 imports BFS；其余为「首次打开编辑器」增量。最终 bundle：**增量 gzip 226,078 B（≈220.8 KiB）= JS 226,078 + CSS 0**（CSS 998 B 与首屏同名同内容，按 sha256 视为已缓存）；首屏 27,611 B；预算 358,400 B（350 KiB），余量 132,322 B。唯一增量文件 `editor-runtime-HEAAJMAW.js`（raw 719,748 B）                                                                                                                                                                                                                                                                                           |
| 5   | CSP        | **通过（附一处静态命中说明）**                            | 严格 CSP（`script-src 'self'`，无 `unsafe-inline` / 无 `unsafe-eval`）下加载并跑完全部用例：`securitypolicyviolation` **0**、`pageerror` **0**、编辑器错误 **0**、无 CDN / 外链脚本。静态扫描命中 1 处 `Function("return this")()`：来自 lodash 的全局对象兜底探测 `freeGlobal \|\| freeSelf \|\| Function("return this")()`，浏览器里 `freeSelf` 短路，**实测未执行**（否则会抛 EvalError）；依赖升级时需重测这一条。控制台 4 条 404 全是原型静态服务没有的资源：`/favicon.ico`、语料示例图 `/media/cover.png`、`/media/my photo.jpg`、mock 上传 URL `/media/uploaded/t0-upload.png`，与 Milkdown / CSP 无关。另 `npm run build` 的 `patch-csp` 钩子正常通过（见 §1） |
| 6   | Vue 3 集成 | **通过**                                                  | `defineAsyncComponent` + `import()`，3 轮 mount/unmount：每次挂载 `.ProseMirror` 恰好 1 个、host 1 个；卸载后均为 0；`createCount` = `destroyCount`（1/1、2/2、3/3）；DOM 节点数每轮卸载都回到基线 11；无编辑器错误。以根节点数与创建/销毁计数近似检查重复实例与残留，**未做 CDP 级 event listener 计数**                                                                                                                                                                                                                                                                                                                                                              |
| 7   | 中文输入法 | **自动化近似通过，仍需人工复核**                          | `insertText` 插入「你好，这是一句中文长句测试。」无丢字；CDP `Input.imeSetComposition`（`nihao` → `你好世界`）+ `Input.insertText` 提交后得到 `你好，这是一句中文长句测试。你好世界`，无丢字、无重复。票面标注为手工项，自动化组合输入不等于真实拼音输入法，**T4/T7 需真机人工复核**                                                                                                                                                                                                                                                                                                                                                                                   |
| 8   | 移动端     | **通过**                                                  | 375px / 280px：`documentElement.scrollWidth` = `innerWidth`（375 / 280），`body.scrollWidth` 同值，无横向溢出；编辑器宽 325 / 230，浮动工具栏 `.milkdown-toolbar` 宽 325 / 230、右边界 350 / 255 均在视口内，未挤压正文                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 9   | 主题       | **通过**                                                  | `classic.css` 由现有 CSS 变量 `--crepe-color-*` 覆盖；`[data-theme]` light→dark 时 `.ProseMirror` 前景 `#1f2328` → `#e6e6e8`、背景 `#f6f8fa` → `#22252b`，computed style 实测变化                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 10  | i18n       | **未达标，需适配层**                                      | 原地改 `toolbar` 的 label 配置对象（保持引用）后：正文保留、实例未重建（`createCount` 不变），但工具栏 `aria-label` 仍是「粗体 / 斜体 / 删除线 / 行内代码 / 链接」，**文案不更新**——label 在 feature 装配时一次性构造，非响应式。对照实验：卸载并重建实例后 label 变为 `Bold EN / Italic EN / …`，说明「重建可生效」但违反票面「不重建实例」。T4 需自定义响应式文案组件或局部重建工具栏                                                                                                                                                                                                                                                                                |
| 11  | 长文性能   | **通过**                                                  | 11,164 字语料：`setMarkdown` 36.7ms、`getMarkdown` 5.9ms、追加输入 4ms、滚动首帧 2.9ms（`scrollHeight` 19,017px），无明显卡顿                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## 4. 关键发现与 ADR 冲突

按 `docs/agents/domain.md`，以下结论与现有 ADR / 方案文档冲突，显式列出而非静默覆盖：

> **_Contradicts ADR 0006 与 `docs/ARTICLE_EDITOR_UPGRADE.md` 8.1：两者都把 Crepe `image-block` 列为「必选」，但实测启用它会破坏正文契约，必须改为不装配。_**

根因在 `@milkdown/components@7.23.0` 的 `imageBlockSchema`：

- `parseMarkdown` 把 Markdown 图片的 `alt` 当宽高比解析：`let ratio = Number(node.alt || 1)`；`title` 当 caption。
- `toMarkdown` 反向写回：`alt: Number.parseFloat(ratio).toFixed(2)`。
- 于是 `![站点封面](/media/cover.png)` → `![1.00](/media/cover.png)`，中文 alt 静默丢失；`mixed-document` 同因 lossy。

这不是 Milkdown 内核（remark / ProseMirror / transformer）的问题：去掉该 feature 后 15/15 语义等价。因此**不否决内核**，但 ADR 0006 的装配清单必须修订；`docs/ARTICLE_EDITOR_UPGRADE.md` 8.1 的同一处清单需在 T4 前同步（本票不改该文件，已作为 deferred obligation 写入 #65）。

另两处与 ADR 0006 措辞的偏差：ADR 写「`data-embed="1"` 通过专用节点 / NodeView 往返」，实测默认装配只是原始 HTML 原子片段（保真但不可编辑），专用节点仍需 T4 实现；ADR 写「i18n 通过配置覆盖、语言切换不重建编辑器」，实测配置非响应式，需自定义适配。

## 5. T4 落地约束（可操作）

1. **不装配 `image-block`**。`CrepeBuilder` 只装 7 项：`toolbar` / `list-item` / `link-tooltip` / `table` / `block-edit` / `placeholder` / `cursor`；保留 `code-mirror` / `latex` / `ai` / `top-bar` 关闭状态（包体才有 226 KiB 余量）。
2. **覆盖 `uploadConfig.uploader`**：在 `builder.editor.config(ctx => ctx.update(uploadConfig.key, …))` 里改上传器，用 `schema.nodes.image.createAndFill({ src, alt })` 生成普通图片节点；`src` 取 `POST /api/v1/media/upload` 返回的相对地址，`alt` 取 `original_name` 去扩展名并按 Markdown 文本规则转义。对照 C 已实测该路径可行（`![photo](/media/uploaded/t0-upload.png)` + 15/15 等价）。注意原型里图片紧贴上一段文字插入，T4 需处理插入位置补段落 / 换行。
3. **拖拽上传必须用真实拖拽回归确认**：本票两次自动化模拟（手工 `DragEvent`、Playwright `DataTransfer` handle）都未触发 `onUpload`；粘贴链路可用。若真实拖拽同样失效，需在 `handleDrop` 或 `getInsertPos` 上补适配。
4. **embed 专用内联节点 / NodeView**：序列化必须还原 `<a … data-embed="1">`，且编辑器内提供可点击、可改文字的形态；默认 `span[data-type="html"]` 不满足。
5. **i18n 响应式文案**：不要依赖 Crepe feature 的 label config；用自有响应式 label（或局部重建工具栏），保证切换语言不重建编辑器实例、不丢正文。
6. **回写守卫**：15/15 等价是在「不装配 image-block」前提下成立；加载 / 模式切换 / 保存前仍必须执行 `classifyMarkdown`，`tests/fixtures/editor/markdown-corpus.ts` 是共用输入。byte 级差异是常态（0/15 字节相同），守卫只比较 `renderMarkdown` 归一化结果。
7. **依赖**：固定 `@milkdown/*` 7.23.0 一组，提交 lockfile；重测 lodash `Function("return this")()` 在严格 CSP 下的短路行为。
8. **中文输入法**：真机拼音选词、长句组合输入人工复核后关闭。

## 6. 验收对照（#61）

- [x] 11 项验证均有明确结论与数据 —— §3 逐项列出，含未达标项与自动化近似项。
- [x] 回写语料已提交到 `tests/fixtures/editor/markdown-corpus.ts` —— 15 类手写语料 + `invariants`；`tests/markdown-corpus.test.ts` 32 项自检全绿，覆盖清单由独立手写字面量钉住。
- [x] ADR 0006 状态与结论一致 —— `proposed` → `accepted`，并修订 image-block 装配决策、补充实测约束。
- [x] 明确 T4 是否解除阻塞 —— **是**，附 §5 的 8 条前置约束；缺口已按 `docs/agents/issue-tracker.md` 的 cross-ticket 约定写入 #65 body。

## 7. Out of scope / 未闭环

- 原型代码、原始 JSON 实测输出、依赖快照均**不入库**（票面允许「原型分支 / PR 可丢弃」），关键数字已固化在本报告。
- `docs/ARTICLE_EDITOR_UPGRADE.md` 8.1 的 `image-block` 必选清单未在本票修改，交由 #65 同步。该方案文档与 ADR 0006 在本票开始时都是工作区未跟踪的 #60 方案文件；**ADR 0006 随本 PR 一并入库**，方案文档仍由 #60 / #65 负责落库。
- `GLOSSARY.md` 的工作区改动属于 #60 方案，不属于本票，未纳入 PR。
- 中文输入法真机验证、拖拽真实用户操作、CDP 级事件监听器泄漏计数、CDP 级 i18n 文案运行时热更新，均留待 T4 / T7。
- 本票不改变 `ARTICLE_BODY_TAGS` / `ARTICLE_BODY_ATTRS` 白名单，不做 D1 迁移，不启用 `content_html`。
