# issue #64（编辑器 T3）组件化壳层、编辑锁修复与未保存保护 — 实施与两轴复审

- 日期：2026-11-14
- 工单：[#64](https://github.com/Mintinkd/Blog_Website/issues/64)（Part of #60；解除 #62 / #63 的阻塞后实施）
- 范围：拆出文章列表与编辑器、修复编辑锁生命周期、加入未保存保护与显式状态机；不改 Worker / D1 / 设置规则生成物，不引入 Milkdown
- 标准来源：`README.md`（主契约）、`CODING_STANDARDS.md`、`docs/agents/testing.md`、`docs/agents/issue-tracker.md`、`GLOSSARY.md`、`docs/ARTICLE_EDITOR_UPGRADE.md` §5.4–§5.6 / §7 / §10、`docs/adr/0006-wysiwyg-markdown-editor.md`、`.github/workflows/deploy.yml`

## 改动清单

| 文件                                          | 内容                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/admin/articles/ArticlesPanel.vue`        | 文章列表、作者筛选、操作列（保留 `.admin-panel` / `.data-table` / `data-label` / `.btn-primary` 契约类名）                                      |
| `src/admin/articles/ArticleEditorOverlay.vue` | 全屏壳层、头部 X、状态区（加载 / 加载失败 / 锁冲突 / 锁丢失）、底部取消与保存、弹窗编排                                                         |
| `src/admin/editor/EditorMetaFields.vue`       | 标题 / slug / 分类 / 状态 / 标签 / 摘要 / 封面；`POST /tags` 仍由宿主执行                                                                       |
| `src/admin/editor/MarkdownWorkspace.vue`      | 编辑 / 分屏 / 预览三档 + textarea；预览仍走 `renderMarkdown`，增强挂载点改为组件内 ref（不再全局 `querySelector`）                              |
| `src/admin/editor/LinkDialog.vue`             | 普通链接 / 内嵌网页预览；构造片段复用 T1 `editorCommands.buildLinkSnippet`（内含 `escape.ts` 与 Markdown 转义分工）                             |
| `src/admin/editor/UnsavedChangesDialog.vue`   | 脏状态三出口：保存并关闭 / 放弃修改 / 继续编辑                                                                                                  |
| `src/admin/editor/useEditLock.ts`             | 获取 / 10 分钟心跳 / 保存前校验 / 释放 / 强制接管 / `10003`；`createEditLock` 不依赖 Vue，fetch 与定时器可注入                                  |
| `src/admin/editor/useArticleEditor.ts`        | 显式状态机 + 副作用编排，状态转移全部委托 T1 `editorState.ts` reducer；`beforeunload` 只提示、`pagehide` 释放、Esc 分层、`10003` 落盘           |
| `src/admin/admin-shared.css`                  | 由 `App.vue` 的 `<style scoped>` **整块原样抽出**（1,600 行，零改写），改为全局单源；拆出的子组件沿用全部既有类名，样式零漂移                   |
| `src/admin/App.vue`                           | 删除编辑器主体（模板 / 脚本 / 四份重复转义函数 / `beforeunload` 无条件释放），改为挂载两个组件 + 事件转发；5,336 → 3,171 行                     |
| `src/i18n/zh.json` / `en.json`                | 各新增 12 个键（未保存确认、锁冲突 / 锁丢失、加载与保存失败），键集合一致                                                                       |
| `tests/edit-lock.test.ts`                     | 7 用例：心跳 / 释放 / 保存前校验冲突 / 心跳冲突停表 / 强制接管 / `10003` / 打开冲突不误报失锁                                                   |
| `tests/article-editor-flow.test.ts`           | 12 用例：加载失败不可编辑、重试、保存失败、`pagehide`、`beforeunload`、Esc 分层、三出口、保存前校验、接管重建基线、`10003` 落盘、新建文章不抢锁 |
| `README.md`                                   | 技术栈预览口径修正、项目结构、后台文章管理契约同步                                                                                              |
| `docs/agents/testing.md`                      | 补两个 T3 测试文件的分层说明                                                                                                                    |

## 关键设计决策

1. **`createEditLock` / `createArticleEditor` 是不依赖 Vue 的工厂**，`useEditLock` / `useArticleEditor` 只是薄包装。心跳、释放、保存前校验、加载失败、保存失败、`pagehide`、Esc 分层因此能在 node vitest 里用 mock fetch + fake timers 全链路测，符合「不能只测 reducer」；Vue 组件只消费状态与事件。
2. **样式不复制、不改写**：`App.vue` 的 scoped 样式对拆分后的子组件不再生效，故把整个 `<style scoped>` 原样移到 `src/admin/admin-shared.css`（全局，仅随后台动态 chunk 加载），再补 7 条状态机新增节点样式。CI 观感门禁 348 条断言全绿，证明 computed style 与拆分前一致。
3. **锁与草稿的副作用统一在编排器**：reducer 仍是纯函数（T1 行为锁不动），`closeDecision` 的 `releaseLock` / `clearDraft` / `keepDraft` 由编排器执行；`beforeunload` 不再无条件释放，`pagehide` 且 `persisted === false` 才尽力释放。
4. **`forceTakeover` 先 force 释放再重新 acquire**：服务端 `force` 接口只释放不授予锁，接管后重新 `GET /articles/:id/edit` 并重建 `form` / `baseline`，满足「强制接管后基线正确」。
5. **`10003` 的落盘时机**：宿主 `api()` 在检测到 `10003` 时先调 `editorCore.sessionExpired()`（同步落盘草稿 + 尽力释放锁），再清登录态；`clearUserDrafts` 只在主动退出登录时调用，会话失效不清该用户草稿。

## Standards（契约面同步 / 测试约定）

- **契约面同步**（`CODING_STANDARDS.md` 头号复发项）：README 技术栈段落里「编辑器预览走默认 DOMPurify」的失真描述修正为复用 `renderMarkdown`；项目结构补 `src/admin/articles/`、`src/admin/editor/`、`admin-shared.css`；后台管理段落补取数接口、锁心跳与未保存保护契约；`docs/agents/testing.md` 补测试导航。
- **术语**：沿用 GLOSSARY「文章编辑器」「编辑锁」「本地草稿」「源码模式」「线上预览」口径，未引入新术语。
- **行为锁期望值独立来源**：所有期望值为手写字面量（URL、method、`keepalive`、phase、字段名），不从被测实现反推；服务端用可编程 stub，不跨包 import Worker 代码。
- **接缝分层**：`useEditLock` 的 mock fetch 与 `useArticleEditor` 的编排走 node vitest；同一行为不在 Playwright 里重复测。浏览器门禁（观感 / 后台移动端 / 文章 SSR）照常跑，用于证明「现有后台功能无回归」。
- **i18n**：zh / en 各 12 个新键，位置与键集合一致（脚本逐字比对）。
- **无新增依赖 / 生成物改动**：`package.json`、`package-lock.json`、Worker、`settings.rules.json` 生成物、`public/_headers`、`deploy.yml` 均未改。

## Spec（逐条对照工单）

| 工单条目                                                                                                    | 落地与证据                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ArticlesPanel.vue` 列表 / 筛选 / 分页 / 操作列                                                             | 列表、作者筛选、操作列拆出；分页沿用现有 `page_size=100` 单次取全量，**未新增分页 UI**（母票「除已列修复外行为等价」），如实保留给后续工单                |
| `ArticleEditorOverlay.vue` 全屏壳层 / 头部 / 底部                                                           | 拆出；`.article-editor-overlay` / `.editor-toolbar` 等类名不变，CI 观感门禁可定位                                                                         |
| `useArticleEditor.ts` / `useEditLock.ts`                                                                    | 状态机 + 锁；Vue 薄包装与可测工厂并存                                                                                                                     |
| `EditorMetaFields.vue` / `MarkdownWorkspace.vue` / `LinkDialog.vue` / `UnsavedChangesDialog.vue`            | 全部拆出；本阶段仍是 textarea + 预览，未提前改预览形态；线上预览弹窗留 T4 #65                                                                             |
| 打开已发布文章改用 `GET /articles/:id/edit`，删除 `editArticle` / `forceTakeover` 重复填充                  | `loadContent()` 只调 `/articles/:id/edit`；`open` 与 `takeover` 共用同一加载路径，`loaded` 同时重建 form 与 baseline；node 测试断言路径且无公开 slug 取数 |
| 复用 `escape.ts` 的 `escapeAttr`，删除 `App.vue` 内 `escapeAttr` / `escapeHtmlText` 重复                    | 四份本地实现全部删除；`LinkDialog` 经 `buildLinkSnippet` 复用 `escapeAttr` / `escapeHtml`                                                                 |
| `mdEscapeText` / `mdEscapeUrl` 迁到 T1 `editorCommands.ts`，不得直接删除                                    | T1 #62 已迁入；本票删除 `App.vue` 旧副本，运行期由 `editorCommands` 单一提供，`tests/editor-commands.test.ts` 22 用例继续钉住                             |
| i18n 新文案写入 zh / en，键集合一致                                                                         | 12 键 × 2，逐字比对一致                                                                                                                                   |
| 取消 / X / Esc / 保存成功 / 放弃均释放；`beforeunload` 只提示；`pagehide` 且 `persisted === false` 尽力释放 | `applyCloseSideEffects` + `handleBeforeUnload` + `handlePageHide`；测试覆盖 pagehide 两种 `persisted` 与 beforeunload 不释放                              |
| 10 分钟心跳续期；保存前校验；冲突禁止保存并给出复制正文 / 保留草稿 / 关闭                                   | `createEditLock` 心跳 / `verify`；`lock-lost` 面板三出口；测试覆盖心跳边界、校验冲突、不发 PUT                                                            |
| Esc 分层                                                                                                    | 有弹窗先关弹窗；无弹窗脏状态弹未保存确认、干净直接关闭；测试覆盖                                                                                          |
| 加载失败不得进入可编辑状态，提供重试 / 关闭                                                                 | `load-error` 态不渲染表单；`updateForm` 被 reducer 拒绝；UI 提供重试 / 取消                                                                               |
| 保存失败保持编辑器打开、保持锁、保留当前内容                                                                | `save-failed` → `ready`，不清表单不释放锁，同步落盘草稿；测试断言 `lockHeld === true` 与 DELETE 为 0                                                      |
| `10003` 先同步落盘草稿、尽力释放锁，再退出登录；不静默丢正文                                                | 宿主 `api()` 先调 `sessionExpired()`；测试断言草稿含「未保存的正文」且不含 token                                                                          |
| 脏状态三出口                                                                                                | `UnsavedChangesDialog` + `save` / `discard` / `continueEditing`；测试覆盖                                                                                 |
| 现有行为等价：分类、标签、状态、封面、摘要、slug 生成                                                       | 字段与请求体（`category_id` 空串转 `null`、tags 数组）不变；新建标签仍走 `POST /tags` → `loadTags()` → 追加；抓取「生成草稿并编辑」仍预填同一组字段       |
| `useArticleEditor` reducer 单测                                                                             | 沿用 T1 `tests/editor-state.test.ts` 12 用例，本票未改 reducer                                                                                            |
| `useEditLock` fake timers + mock fetch 单测                                                                 | `tests/edit-lock.test.ts` 7 用例                                                                                                                          |
| 加载失败 / 保存失败 / `pagehide` / Esc 分层各一条测试                                                       | `tests/article-editor-flow.test.ts` 均有独立用例（共 12 条）                                                                                              |
| 手工：编辑锁 30 分钟边界、强制接管后重新加载                                                                | 未在本机执行真实 30 分钟场景，见 Out of scope                                                                                                             |

## 验收对照

- [x] `App.vue` 不再包含文章编辑器主体（模板 / 脚本 / 样式均拆出；只剩组件挂载与事件转发）
- [x] 取消 / X / Esc / 刷新 / `pagehide` 行为符合契约
- [x] 加载失败不进入可编辑状态；保存失败保持打开与锁
- [x] 保存前锁校验生效，强制接管后重新加载并重建基线
- [x] 现有后台功能无回归（三条 CI Playwright 门禁 + 观感 348 断言全绿）

## 验证

- 根包 `npm run check`：0 errors（7 hints，均为既有未使用变量）
- 根包 `npm test`：27 文件 / 298 用例通过（新增 2 文件 / 19 用例）
- Worker `npm run typecheck` / `npm test`：通过（本票未改 Worker）
- `SITEMAP_API_BASE=http://127.0.0.1:9 npm run build`：通过；CSP 收紧与静态 / SSR 两份 CSP 逐字符一致
- Playwright（系统 Edge，`PW_CHANNEL=msedge`）：
  - `verify-visual-friendliness.mjs`：4 组场景 × 348 条断言全绿
  - `verify-admin-responsive.mjs`：280 / 375 / 1280px 全绿
  - `verify-article-ssr.mjs`：服务端正文 / 无 JS / motion 失败兜底 / 404 / 502 全绿
- CI 生成物漂移断言：`npm run gen:settings` / `npm run gen:headers` 后 `git diff --exit-code` 为空
- i18n：zh / en 键集合逐字比对一致
- Prettier `--check`：本票改动文件通过

## Out of scope（如实保留）

- WYSIWYG 内核、回写守卫、工具栏 / 快捷键、线上预览弹窗（T4 #65）；本阶段 `MarkdownWorkspace` 仍是 textarea + 预览。
- 图片上传 / 粘贴 / 拖拽、本地草稿恢复条与防抖写入（T5 #66）：本票只做 `10003` / `pagehide` 的同步落盘与清理，不提供恢复 UI。
- 元信息面板优化、响应式抽屉、可访问性完整矩阵（T6 #67）。
- 编辑器 Playwright 回归脚本、CI 门禁扩展、旧模式 i18n 键清理、批次 L3 证据（T7 #68）。
- `App.vue` 余下 11 个后台面板拆分与壳层收口（T8 #69）：本票只拆文章列表与编辑器，按票面边界不要求 `App.vue` 只剩壳层。
- 手工项「编辑锁 30 分钟 TTL 边界」「真实账号强制接管后重新加载」未在本机跑真实 30 分钟 / 真实 Worker；已由 fake timers 心跳边界测试与接管重建基线的 node 全链路测试覆盖等价逻辑。
- `GLOSSARY.md` 的「编辑」分组、`docs/ARTICLE_EDITOR_UPGRADE.md`、ADR 0006、`.t0-prototype/`、`tests/fixtures/`、`tests/markdown-corpus.test.ts`、`docs/reviews/2026-11-14-milkdown-t0-validation.md` 是 #60 / T0 并行工单的在制品，**未纳入本次提交**。
