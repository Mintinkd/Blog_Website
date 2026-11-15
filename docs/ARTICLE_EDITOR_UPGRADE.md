# 文章编辑器升级与重构方案

> 状态：方案已定；T0 技术验证「通过（有条件）」，T1–T5 已实施，T6–T8 待办
> 修订：2026-11-14（T0 实测结论 + #65 T4 实施同步；见 §8.1 / §8.4 / §9 与 `docs/reviews/2026-11-14-milkdown-t0-validation.md`）
> 日期：2026-11-14
> 关联：`docs/adr/0006-wysiwyg-markdown-editor.md`、`docs/reviews/2026-10-23-full-codebase-review.md` L3（巨石组件）；预览白名单一致性沿用 M13 的已有修复，M2（列表取正文）不在本批次

## 1. 背景

当前文章编辑器全部位于 `src/admin/App.vue`（2026-11-14 为 5,001 行），编辑器相关 template / script / style 约 600 行，与文章列表、分类、标签、评论、媒体、友链、用户、配置、统计、抓取等 10+ 模块共处一文件。2026-10-23 全仓审查的 L3 已指出「巨石组件」问题；本次升级直接作为 L3 的文章编辑器整改批次。

现有编辑器是一个原生 `textarea`：

- 只有「编辑 / 分屏 / 预览」三档模式与一个「插入链接」按钮；没有工具栏、快捷键、图片上传插入、字数统计、自动保存或草稿恢复。
- 预览每次输入都同步执行完整的 `renderMarkdown`，没有防抖；分屏在窄屏没有降级布局；预览增强通过全局 `document.querySelector` 找节点。
- 编辑锁存在明确缺陷：底部「取消」只关闭弹层，不释放锁（右上角关闭会释放），锁会一直占到 30 分钟 TTL；关闭时也不提示未保存内容。
- `beforeunload` 无条件释放编辑锁；用户取消离开时锁已经没了，编辑器仍开着。
- 打开已发布文章编辑时，会再次请求公开的 `GET /articles/:slug` 拉正文；既重复请求，也经过阅读统计入口。
- 预览与服务端渲染的白名单一致性已有测试，但编辑器插入、锁生命周期、未保存保护、草稿恢复均无测试。
- 链接插入的 `escapeAttr` / `escapeHtmlText` / `mdEscape` 与 `src/utils/escape.ts` 重复。
- README 技术栈段落仍写「文章编辑器预览走 `marked.parse` + 默认 DOMPurify」，与当前 `renderMarkdown`（共享白名单）不一致，属于契约面漂移。

产品方向已确认：**改为所见即所得编辑**，同时完成组件化、未保存保护、编辑锁修复、工具栏与快捷键、图片上传、本地草稿恢复、预览性能与响应式、元信息面板优化。自动保存仅做浏览器本地草稿，不做服务端自动保存。

## 2. 目标

1. **所见即所得**：作者在渲染后的富文本形态中直接编辑文章，Markdown 仍是唯一存储格式与唯一正文源。
2. **安全回写**：任何所见即所得编辑都必须经过「语义等价回写」守卫；无法无损表示的存量内容自动回到源码模式，不静默改写。
3. **组件化**：把文章列表与编辑器从 `App.vue` 拆出；T8 继续拆出余下后台面板，最终 `App.vue` 只保留登录、侧栏、标签页编排与跨面板状态。编辑器内部按壳层、元信息、Markdown 工作区、链接弹窗、预览、composables 分层；纯逻辑可单测。
4. **不丢稿**：关闭 / 取消 / 刷新 / 锁冲突都有明确出口；本地草稿可恢复；保存失败不关闭编辑器。
5. **可回归**：编辑器关键路径进入 vitest + Playwright；移动端、暗色主题、焦点与对比度纳入现有观感检查。
6. **契约同步**：README、GLOSSARY、ADR、i18n、`docs/agents/testing.md` 与行为一起更新。

## 3. 非目标

- 不做服务端自动保存、版本历史、多人实时协作或 CRDT。
- 不改 `articles.content` 的存储格式，不启用 `content_html`，不做 D1 迁移。
- 不修改 `src/utils/markdown.ts` / `markdownPolicy.ts` 的消毒口径；不扩大正文白名单。
- 不把「关于页面」的 Markdown 编辑同步改成 WYSIWYG（可在后续复用同一工作区，另立工单）。
- 不做站内代码高亮、LaTeX、任务列表、下划线、文字颜色、附件等当前正文白名单不支持的能力。
- 不做媒体库选择器、封面裁剪、图片压缩或转存。
- 不做服务端乐观并发控制（版本号 / If-Match）；本轮用编辑锁 + 保存前锁校验 + 本地草稿降低风险。

## 4. 核心决策

| 决策     | 结论                                                             | 理由                                                        |
| -------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| 编辑形态 | 所见即所得为主，源码模式为辅                                     | 作者体验优先；存量 Markdown / 原始 HTML 需要逃生口          |
| 编辑内核 | Milkdown 7（ProseMirror + remark），通过 `CrepeBuilder` 按需装配 | Markdown-first、Vue 3 原生、可定制 remark / node、MIT       |
| 正文存储 | `articles.content` Markdown 唯一正文源                           | 与现有 API、SSR、RSS、抓取、导入导出保持一致                |
| 回写策略 | 语义等价回写 + 回写守卫                                          | Markdown 序列化不保证字节一致；以「前台渲染结果一致」为验收 |
| 存量兼容 | 回写守卫失败 → 强制源码模式 + 明确提示                           | 不静默丢弃原始 HTML / 自定义属性                            |
| 自动保存 | 仅 localStorage 本地草稿                                         | 无 API / D1 改动；跨设备与冲突处理不在本轮                  |
| 编辑锁   | 获取后心跳续期；显式关闭 / 保存 / 放弃时释放                     | 修复 TTL 泄漏与长文编辑丢锁                                 |
| 数据接缝 | 新增认证接口 `GET /api/v1/articles/:id/edit`                     | 按 id 稳定取正文；不经过公开 slug 接口与阅读统计            |
| 功能边界 | 编辑器能力 ≤ `ARTICLE_BODY_TAGS` / `ARTICLE_BODY_ATTRS`          | 避免作者能编辑出前台会被剥除的内容                          |
| 交付     | 分阶段多个 PR + GitHub 子票                                      | 每批可独立验收，降低大 diff 回归成本                        |

> 编辑内核选择是「难逆转 + 有真实替代方案」的决策，已记录为 ADR 0006；在技术验证工单通过前状态为 `proposed`。

## 5. 必须守住的契约

### 5.1 正文契约

- `articles.content` 是唯一正文源；保存始终写 Markdown，绝不写预览 HTML。
- `articles.content_html` 保持历史遗留列，不读取、不写入。
- 前台渲染继续走 `src/utils/markdown.ts` 的 `renderMarkdown`（marked + DOMPurify）与服务端 `markdownServer.ts`（marked + sanitize-html），共享 `markdownPolicy.ts` 白名单。
- 编辑器「线上预览」必须调用同一个 `renderMarkdown`，不得另起 marked 配置。

### 5.2 语义等价回写

定义：编辑器序列化出的 Markdown 经 `renderMarkdown` 渲染后，与编辑前 Markdown 的渲染结果一致（规范化空白与 void 标签后比较），不要求字节相同。

守卫流程：

1. 加载文章时，把原始 Markdown 交给编辑器解析并立即序列化，得到 `normalized`。
2. 分别对 `original` 与 `normalized` 执行 `renderMarkdown`，做规范化比较。
3. 一致 → 允许所见即所得编辑。
4. 不一致 → 默认进入源码模式，顶部提示「该文章包含所见即所得无法无损表示的语法，已在源码模式打开」；作者可显式选择「仍然使用所见即所得」，但保存前再次守卫，失败则阻止保存。
5. 源码模式下未做任何修改时，保存保留原始 Markdown 字节，不做编辑器归一化。

语料至少覆盖：GFM 表格、带语言围栏代码、引用、嵌套列表、图片、相对 URL、行内/块级原始 HTML、`data-*` / `aria-*`、`<a data-embed="1">`、音频 / B 站 / YouTube 链接、中文标点、转义字符、硬换行。

### 5.3 内嵌链接契约

- 「插入链接」保留两种模式：普通 Markdown 链接与内嵌网页预览。
- 内嵌模式继续写入 `<a href="…" data-embed="1">文字</a>`，由前台 `enhanceMediaLinks` 渲染。
- WYSIWYG 中为 `data-embed="1"` 提供专用内联节点 / NodeView（可点击、可编辑文字），序列化必须还原为上述锚点；不得退化成普通链接或丢失 `data-embed`。
- 普通链接继续走 Markdown `[文字](url)`；URL 仅允许 `http(s)://`。
- 音频 / 视频 / B 站 / YouTube 的自动识别仍由前台 `enhanceMediaLinks` 完成；编辑器内以链接或预览弹窗呈现，不把 iframe 写进正文。

### 5.4 编辑锁契约

- 打开编辑前 `POST /articles/:id/edit-lock`；冲突时保留现有「被 X 编辑 / 管理员强制接管」流程。
- 打开后每 10 分钟 `POST` 同一接口续期（同一用户重取即续期）；页面隐藏不停止计时，`pagehide` 且 `persisted === false` 时尽力释放。
- 显式关闭、取消、保存成功、放弃修改都释放锁；`beforeunload` 只做未保存提示，不再无条件释放。
- 保存前再次 `POST /edit-lock` 校验持有权；冲突则禁止保存，提示锁已被接管，并提供复制正文 / 保留本地草稿。
- 加载正文失败时不得进入可编辑状态，避免空表单覆盖原文。

### 5.5 本地草稿契约

- 仅存 `localStorage`，键含版本、用户 id、文章 id（新建文章用 `new`）。
- 内容：表单字段 + `savedAt` + 基线内容哈希 / 加载时间；不存 token。
- 编辑后 1.5s 防抖写入；`pagehide` 时同步落盘。
- 打开时若存在草稿，显示「恢复 / 丢弃」条，不自动覆盖服务端内容。
- 保存成功、放弃修改、退出登录时清除对应草稿；草稿过大（> 1MB）时跳过并提示一次。
- 草稿超过 7 天未更新视为过期，读取时惰性清理；同一草稿的超限提示只显示一次。
- 草稿恢复后仍走正常保存 / 锁校验，不绕过服务端；恢复正文来自旧版本，需重新执行回写守卫，lossy 时进入源码模式。
- 新建文章首次保存成功后，草稿键从 `new` 迁移到实际文章 id（或直接清除），避免下次新建误恢复旧内容。

### 5.6 未保存保护契约

- 脏状态 = 表单字段或正文与加载基线不同。
- 关闭（X）、取消、Esc、浏览器刷新 / 关闭标签页均触发保护。
- Esc 先关闭最上层弹窗（链接 / 预览 / 未保存确认）；没有弹窗时才触发未保存保护。
- 弹窗三出口：保存并关闭 / 放弃修改 / 继续编辑。
- 保存失败保持编辑器打开、保持锁、保留草稿；不得静默关闭。
- 会话失效（`10003`）不属于「放弃修改」：退出前同步写草稿，重新登录同一用户后可恢复；不得同时清除该用户草稿。

### 5.7 图片契约

- 编辑器内上传 / 粘贴 / 拖拽图片走现有 `POST /api/v1/media/upload`（Bearer token，FormData `file`）。
- 插入 Markdown 图片，URL 使用接口返回的相对地址；alt 默认取接口 `original_name` 的文件名（去扩展名），按 Markdown 文本规则转义，可后续编辑。
- 仅接受服务端白名单类型；客户端做 10MB 预检与明确错误提示；失败不得清空或破坏正文。
- 不把 base64 图片写入正文；不新增图片代理或转存逻辑。

### 5.8 能力边界

所见即所得启用的节点 / 标记必须落在正文白名单内：

- 允许：标题、段落、粗体、斜体、删除线、行内代码、围栏代码、引用、有序/无序列表、表格、分割线、链接、图片、原始 HTML 块。
- 不启用：LaTeX、任务列表、下划线、文字颜色 / 高亮、附件、脚注、iframe/embed/object、代码高亮（保持与前台一致）。
- 原始 HTML 作为不可编辑的原子块保留；需要修改时切源码模式。

## 6. 目标架构

```
src/admin/
├── App.vue                         # 壳层：登录、侧栏、标签页编排与跨面板状态（T8 收口）
├── AdminSidebar.vue                # 导航定义、角色可见性、登出（T8）
├── articles/                       # T3
│   ├── ArticlesPanel.vue           # 文章列表、筛选、分页、操作列
│   └── ArticleEditorOverlay.vue    # 全屏壳层：头部 / 元信息 / 工作区 / 底部操作
├── editor/                         # T3/T4
│   ├── EditorMetaFields.vue        # 标题、slug、分类、状态、标签、摘要、封面、字数
│   ├── MarkdownWorkspace.vue       # 模式切换 + WYSIWYG + 源码 + 分屏 + 线上预览
│   ├── LinkDialog.vue              # 普通链接 / 内嵌预览两种模式
│   ├── EditorPreviewDialog.vue     # 只读线上预览（同一个 renderMarkdown）
│   ├── UnsavedChangesDialog.vue    # 保存 / 放弃 / 继续
│   ├── DraftRecoveryBar.vue        # 本地草稿恢复提示
│   ├── useArticleEditor.ts         # 表单状态、模式、脏状态、保存 / 加载状态机
│   ├── useEditLock.ts              # 获取、心跳、释放、保存前校验、冲突
│   ├── useLocalDraft.ts            # 快照、恢复、清理、配额
│   └── milkdown/                   # T4：所见即所得内核（懒加载，不进首屏 chunk）
│       ├── MilkdownEditor.vue      # defineAsyncComponent 的 Vue 壳层
│       ├── createEditor.ts         # CrepeBuilder 7 项装配 / uploader / 响应式文案
│       ├── embedLink.ts            # data-embed 专用内联节点 + NodeView + remark 合并
│       └── milkdownService.ts      # 守卫用的同装配隐藏实例往返
├── panels/                         # T8：余下后台面板
│   ├── AnalyticsPanel.vue
│   ├── ScrapePanel.vue
│   ├── CategoriesPanel.vue
│   ├── TagsPanel.vue
│   ├── AboutPanel.vue
│   ├── CommentsPanel.vue
│   ├── MediaPanel.vue
│   ├── FriendLinksPanel.vue
│   ├── ConfigPanel.vue
│   ├── AppearancePanel.vue
│   └── UsersPanel.vue
└── composables/                    # T8：共享会话 / API / 提示
    ├── useSession.ts
    ├── useAdminApi.ts
    └── useFeedback.ts              # 包装现有 alert / confirm，不引入新 toast UI

src/utils/editor/
├── markdownBridge.ts               # 回写守卫、规范化比较、模式判定、保存前二次守卫（纯函数）
├── editorCommands.ts               # 源码模式工具栏 / 快捷键的纯插入与包裹逻辑
├── draftStore.ts                   # 本地草稿序列化、键、过期、配额
├── uploadImage.ts                  # 上传适配器与错误映射
├── slug.ts                         # slug 建议与合法性
└── wordCount.ts                    # 中英文字数 / 阅读时长

src/admin/editor/milkdown/
├── createEditor.ts                 # CrepeBuilder 装配、功能裁剪、主题、懒加载
├── embedLink.ts                    # data-embed 内联节点 / remark 解析与序列化
└── milkdownService.ts              # 守卫用同装配隐藏实例往返
```

依赖方向：`App.vue` → `articles/*` / `panels/*` → `editor/*` → `utils/editor/*`；共享会话 / API / 提示走 `composables/*`；`utils/editor/*` 不反向依赖 Vue 组件。Milkdown 只在 `MarkdownWorkspace.vue` 打开时动态加载，不进入后台首屏 chunk。

## 7. 交互状态机

```
closed
  └─ open(article|null)
       ├─ acquiring-lock ── conflict ──> lock-conflict（接管 / 取消）
       ├─ loading-content ── error ──> load-error（重试 / 关闭）
       └─ ready（基线快照）
            ├─ edit ──> dirty
            ├─ save ──> saving ── ok ──> saved / closed
            │                 └─ error ──> ready（保留内容与锁）
            ├─ close/cancel/Esc ── clean ──> closed
            │                   └─ dirty ──> unsaved-dialog
            │                        ├─ save ──> saving
            │                        ├─ discard ──> closed（释放锁、清草稿）
            │                        └─ continue ──> ready
            └─ heartbeat conflict ──> lock-lost（禁止保存；复制正文 / 保草稿 / 关闭）
```

状态机以 `useArticleEditor` 的纯 reducer / 显式状态字段实现，便于单测；UI 只消费状态与事件。

## 8. 技术方案

### 8.1 编辑器内核

- 使用 `@milkdown/crepe/builder` 的 `CrepeBuilder`，按需装配。**T0 实测修订（#61，本节优先于原方案）：**
  - 装配 7 项：`toolbar`、`list-item`、`link-tooltip`、`table`、`block-edit`、`placeholder`、`cursor`。
  - **不装配 `image-block`**：`@milkdown/components@7.23.0` 的 `imageBlockSchema` 把 Markdown 图片的 `alt` 当宽高比（`Number(alt || 1)` → 序列化 `"1.00"`）、`title` 当 caption，默认装配下 15 条回写语料有 `image` / `mixed-document` 两条 lossy。去掉后 15/15 语义等价。
  - 同样不装配：`code-mirror`、`latex`、`ai`、`top-bar`。代码块使用 CommonMark 围栏，不做高亮，保持与前台一致。
  - 图片上传改走「保留内置 `upload` 插件但覆盖 `uploadConfig.uploader`」的路径（见 §8.4），不依赖 `image-block`。
  - 按 `docs/agents/domain.md` 显式标注冲突：_Contradicts 本方案原稿与 ADR 0006 原文的「`image-block` 必选」，实测启用会破坏正文契约，故改为不装配。_
- `data-embed="1"` 锚点、编辑器 UI 文案、主题分别由 `milkdown/embedLink.ts`（专用内联节点 + NodeView）、`reactive` 工具栏 label + `locale-changed` 事件、`classic.css` + 站点 CSS 变量承接；T0 实测默认行为不达标，不能依赖内核默认。
- 主题：`@milkdown/crepe/theme/classic.css` + 用现有 CSS 变量覆盖颜色、圆角、字体；暗色跟随 `[data-theme]`，不引入第二套主题令牌。
- i18n：编辑器 UI 文案从 `zh.json` / `en.json` 读取；Milkdown 内置文案通过配置覆盖；语言切换不重建编辑器，只更新文案与主题。
- 依赖：`package.json` 固定 `@milkdown/core` / `@milkdown/crepe` 等同主版本（7.x）并提交 lockfile；不引入 `@milkdown/plugin-*` 里未装配的插件。T0 记录实际解析到的版本。
- 懒加载：`MarkdownWorkspace.vue` 用 `defineAsyncComponent` + `import()`，Milkdown 及其 CSS 只在首次打开编辑器时加载。
- 包体预算：编辑器和依赖的 gzip 总量目标 ≤ 350KB；技术验证工单记录实测值。超预算优先去掉 `top-bar`、`block-edit`、`table` 之外的装饰能力，不牺牲回写守卫与图片上传。

### 8.2 回写守卫实现

- 纯函数 `classifyMarkdown(original, normalized)`：
  - 规范化 `renderMarkdown` 输出（空白、void 标签、属性顺序）后比较。
  - 返回 `safe | lossy` 与差异摘要（用于提示，不把原始 HTML 注入 DOM）。
- 加载时执行一次；保存前若处于 WYSIWYG 模式再执行一次（不复用加载结论）。
- 源码模式切 WYSIWYG 时执行；失败保留源码模式。作者可显式覆盖进入 WYSIWYG，但保存前守卫仍失败时必须阻止保存并提示，不能静默改写。
- 守卫不通过时，保存按钮仍可用（源码模式），但 WYSIWYG 保存被阻止。
- **T0/T4 实测口径**：语料单源为 `tests/fixtures/editor/markdown-corpus.ts`（15 类）；0/15 语料字节相同是常态，守卫只比较 `renderMarkdown` 归一化结果，不要求字节一致。15/15 语义等价只在「不装配 `image-block`」前提下成立（见 §8.1）。
- 实现为 `src/utils/editor/markdownBridge.ts` 的纯函数，判定结果接入 `useArticleEditor` 的加载 / 模式切换 / 保存编排；渲染器由宿主注入同一 `renderMarkdown`，node 环境单测用 `renderMarkdownServer` 作等价输入。

### 8.3 工具栏与快捷键

- WYSIWYG：Crepe 浮动工具栏 + 可选顶栏；按钮含标题级别、粗体、斜体、删除线、行内代码、链接、引用、列表、代码块、表格、图片、撤销 / 重做。
- 源码模式：轻量工具栏，复用 `editorCommands.ts` 的纯函数（包裹选区、切换行前缀、插入链接 / 图片、列表续行）。
- 快捷键：
  - `Mod/Ctrl + S` 保存（阻止浏览器默认）。
  - `Mod/Ctrl + K` 插入链接。
  - `Mod/Ctrl + B / I` 粗体 / 斜体（WYSIWYG 内置；源码模式由命令实现）。
  - `Mod/Ctrl + Shift + P` 打开线上预览。
  - `Mod/Ctrl + Shift + E` 切换源码 / 所见即所得。
  - `Esc` 关闭弹窗 / 触发未保存保护。
- 快捷键仅在编辑器焦点内生效；链接弹窗打开时不重复触发。

### 8.4 图片上传

- `uploadImage(file)` 统一适配：校验类型 / 大小 → `POST /media/upload` → 返回 `{ url, alt }`。
- **T0/T4 修订**：不装配 `image-block`，因此没有它的 `onUpload` 可配。改为保留 Crepe 内置 `upload` 插件、覆盖 `uploadConfig.uploader`，用 `schema.nodes.image.createAndFill({ src, alt })` 写普通图片节点；`src` 取 `POST /api/v1/media/upload` 返回的相对地址，`alt` 取 `original_name` 去扩展名。默认 uploader 会写 `blob:` URL，必须覆盖。粘贴链路 T0 已实测可用；T5 骨架用合成 `DragEvent` 覆盖 uploader 调用，真实用户拖拽 T7 未自动化复现，保留为 §10.4 手工检查项（T7 回归用 `setInputFiles` 覆盖上传链路）。
- 源码模式插入 `![alt](url)`，光标落在 alt 文本内。
- 上传中显示进度 / 禁用重复提交；失败按服务端 `message` 映射为可读文案，保留原内容。

### 8.5 预览

- 「线上预览」弹窗 / 分屏右侧使用 `renderMarkdown`，输入防抖 150ms，只在可见时渲染。
- `enhanceMediaLinks` 只作用于预览容器，不再全局 `querySelector`。
- 分屏：≥1024px 左右并排；768–1023px 上下堆叠；<768px 只保留 WYSIWYG / 源码切换，分屏入口隐藏。
- 预览错误（渲染异常）显示错误条，不静默空白。

### 8.6 元信息面板

- 标题：必填、maxlength 200（与服务端一致）。
- Slug：默认留空由服务端生成；提供「根据标题生成」按钮，生成后默认锁定；用户可解锁手改。中文 slug 保持现有服务端规则。
- 摘要：字数计数；不新增服务端长度限制。
- 封面：URL 输入 + 预览 + 加载失败占位；不做媒体库选择器。
- 标签：现有 chips + 新建；标签多时提供本地筛选。
- 状态：草稿 / 已发布；发布前检查标题、正文非空。
- 字数 / 阅读时长：从 Markdown 计算，纯函数单测。

### 8.7 响应式与可访问性

- 全屏遮罩：头部 / 底部固定，正文区域滚动；移动端元信息折叠为抽屉。
- 触控目标 ≥44px；工具栏横向滚动或换行，不挤压正文。
- 弹窗 `role="dialog"` / `aria-modal="true"` / 焦点陷阱 / 关闭后焦点归还触发按钮。
- 保存状态、上传状态、锁丢失使用 `aria-live="polite"`。
- 暗色 / 亮色对比度纳入 `verify-visual-friendliness.mjs`。

## 9. 服务端改动

### 9.1 新增 `GET /api/v1/articles/:id/edit`

用途：后台编辑器按稳定 id 取完整正文，替代公开 `GET /articles/:slug`。

- 需要登录（`Authorization: Bearer`）。
- admin 可读全部；editor 仅可读自己文章。
- 返回文章详情（含 `content`、`status`、`tags`、`category`、`updated_at`）；响应类型不含 `content_html`，从类型上避免编辑器误用。
- 不进入阅读统计、不下发 `view_<id>` Cookie、不写 `requests`。
- 非法 id → 400；不存在 → 404；存在但无权限 → 403；未登录 → 401。
- 路由放在 `worker/src/router.ts` 的 `/articles` 分组内；路径 `/articles/:id/edit` 与 `/articles/:slug` 不冲突。
- README API 表同步新增一行；`docs/agents/testing.md` 增加对应测试说明。
- **状态（2026-11-14）**：#63 已实现并合入 `main`，`worker/tests/article_edit_detail.test.ts` 覆盖 401 / 403 / 400 / 404 / owner / admin 与「无统计副作用、无 `content_html`」；T3 #64 的编辑器已切换到该接口，不再走公开 slug 接口。

### 9.2 编辑锁

- 复用现有 `POST /articles/:id/edit-lock` 续期语义（同一用户重取即续期），不需要新接口。
- 客户端心跳 10 分钟；保存前再校验一次。
- 服务端仍不校验锁持有者是否可写；本轮接受该残留风险，记入 ADR / 风险清单。

### 9.3 空字符串清空（T2b #70）

- `PUT /articles/:id` 当前把空字符串当成「未提供」：`content`、`summary`、`cover_image` 传 `""` 时不会清空，删除正文 / 清空摘要 / 移除封面都会静默失败。由 #70 单独修复，改为「字段存在即写入」，请求 / 响应契约不变，并补回归测试。
- 否则 T4 清空正文、T6 清空摘要 / 封面都会被服务端悄悄忽略。
- **状态（2026-11-14）**：#70 已修复并合入 `main`（`worker/tests/article_update_clear.test.ts` 走 `handleUpdateArticle` 全链路钉住「字段存在即写入，`""` 清空正文 / 摘要 / 封面」）；T4 的「删除全部正文 → 保存」前置依赖已解除。

### 9.4 不改动

- `PUT /articles/:id`、`POST /articles` 的请求 / 响应契约不变（空字符串语义按 9.3 修正）。
- 不新增 D1 迁移。
- 不改媒体上传接口。

## 10. 测试与门禁

### 10.1 vitest（根目录）

| 文件                                     | 覆盖                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `tests/editor-markdown-bridge.test.ts`   | 回写语料、规范化比较、lossy 判定、embed 锚点                                  |
| `tests/editor-guard-integration.test.ts` | 加载判定、模式切换、保存前守卫、显式覆盖后仍阻止保存                          |
| `tests/editor-commands.test.ts`          | 源码模式包裹 / 行前缀 / 列表续行 / 链接与图片插入 / Markdown 文本与 URL 转义  |
| `tests/editor-draft.test.ts`             | 键结构、用户隔离、7 天过期、配额、清理                                        |
| `tests/editor-state.test.ts`             | 脏状态、关闭决策、保存失败、锁丢失 reducer                                    |
| `tests/editor-slug.test.ts`              | slug 建议与服务端 `generateSlug` 同组样例、中文 / 空格 / 非法字符             |
| `tests/editor-word-count.test.ts`        | 中英文字数、阅读时长（与服务端 `calculateReadingTime` 同组样例）              |
| `tests/editor-upload.test.ts`            | 类型 / 大小预检、上传成功映射、服务端错误映射、失败不清空正文                 |
| `tests/markdown-preview-parity.test.ts`  | 保留并扩展，确保线上预览仍走同一白名单                                        |
| `tests/mock-admin-api.test.ts`           | T7 有状态 mock：PUT 与公开 GET 共用内存数据、故障注入不改状态、锁冲突码、统计 |

期望值必须独立来源：语料用手写字面量钉住，不从被测函数反推。

**T4 #65 已落地**：`tests/editor-markdown-bridge.test.ts`（34 项，node 环境用 `renderMarkdownServer` 作等价渲染器，安全 / lossy 两组按「不装配 image-block」前提重新判定）、`tests/editor-guard-integration.test.ts`（9 项，守卫接入加载 / 模式切换 / 保存前二次守卫 / 显式覆盖仍阻止保存）、`tests/markdown-preview-parity.test.ts` 扩展至 15 项（真实 `renderMarkdown` 管线下的守卫判定）。浏览器回归与 CI 门禁已由 T7 #68 落地，见 §10.3。

**T5 #66 已落地**：`tests/editor-upload.test.ts` 覆盖类型 / 10MB 预检、Bearer + FormData 请求、`original_name` → alt 映射、服务端 message / network 错误映射、失败保留原正文与选区；`tests/editor-draft.test.ts` 扩展 `loadDraftWithStatus`（none / found / expired）与基线哈希；`tests/article-editor-flow.test.ts` 增加打开只提示、恢复后重跑守卫、丢弃、1.5s 防抖 + `pagehide` 同步、保存 / 新建清理、超 1MB 只提示一次、过期提示。浏览器骨架已由 T7 #68 重写为 §10.3 的 9 条完整回归。

### 10.2 Worker vitest

| 文件                                        | 覆盖                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `worker/tests/article_edit_detail.test.ts`  | 401 / 403 / 400 非法 id / 404 / owner / admin；返回正文；响应不含 `content_html`；无统计写入；无 Set-Cookie |
| `worker/tests/edit_lock.test.ts`            | 同用户续期、他人冲突、释放、admin 强制接管（T3 依赖该契约，必须新增）                                       |
| `worker/tests/article_update_clear.test.ts` | `content` / `summary` / `cover_image` 空字符串清空；未传字段保持原值（T2b #70）                             |

### 10.3 Playwright

新增 `scripts/verify-article-editor.mjs`，复用本地 mock，不访问真实 Worker。mock 必须是有状态的本地 HTTP API：编辑器的 `PUT` 与 SSR 的 `GET` 共用同一份内存数据；只用浏览器 `page.route` 拦截无法覆盖 Astro SSR 的服务端取数。

**T7 #68 已落地**：脚本重写为 12 个独立 browser context 的场景，覆盖下面 9 条；`scripts/mock-admin-api.mjs`（纯状态机）+ `scripts/mock-article-api.mjs`（HTTP 适配，同一进程）提供有状态 API，`PUT /articles/:id` 与 SSR 的 `GET /articles/:slug` 共用内存文章数据。`POST /__control` 注入加载 / 保存 / 锁故障，`POST /__reset` 恢复初始状态，`GET /__stats` 提供请求体与计数断言；未匹配的 slug 仍交回 #41 的 SSR 三态分支。部署前由 `.github/workflows/deploy.yml` 的 Playwright 步骤调用，失败阻断部署。状态机本身由 `tests/mock-admin-api.test.ts` 单测钉住（9 项）。

运行方式（脚本自己拉起 / 关闭 mock，端口 4322；`MOCK_PORT` 可覆盖，须与 `ARTICLE_API_ORIGIN` 一致）：

```powershell
$env:ARTICLE_API_ORIGIN='http://127.0.0.1:4322'; npx astro dev --port 4321
$env:PW_CHANNEL='msedge'   # 仅用系统 Edge 时
node scripts/verify-article-editor.mjs
```

真实用户从桌面拖文件进编辑器未自动化复现（浏览器合成 `DragEvent` 由 T5 单测与骨架覆盖），保留在 §10.4 手工检查。

1. 安全语料（GFM 表格 / 围栏代码 / 引用 / `data-embed` / 原始 HTML）→ 断言进入 WYSIWYG；lossy 语料 → 断言进入源码模式并显示提示。
2. 在 WYSIWYG 中编辑文字、插入普通链接与内嵌链接、上传图片（`setInputFiles` + mock 上传）→ 保存 → 断言 `PUT` 请求体是 Markdown、含 `data-embed="1"`、不含预览 HTML。
3. 用保存后的 Markdown 写入有状态 mock → 访问文章 SSR 页 → 断言正文 / 表格 / 代码 / 内嵌链接仍可渲染（语义等价端到端证据）。
4. 取消 / X / Esc / 刷新触发未保存保护；放弃后锁 `DELETE` 被调用；继续编辑则编辑器保持。
5. 加载失败不进入可编辑状态；保存失败保持编辑器与锁。
6. 本地草稿：编辑 → 刷新 → 重新打开 → 恢复 / 丢弃两条路径。
7. 锁冲突 / 心跳冲突：禁止保存，提示可操作项。
8. 375px / 280px：无横向滚动，元信息抽屉、模式切换、工具栏可用；1280px 分屏并排。
9. 控制台无报错（按 URL + 错误文本精确过滤）。

扩展：

- `scripts/verify-admin-responsive.mjs`：把编辑器遮罩纳入 280 / 375px 检查；`page.route` fixture 补上 `GET /articles/:id/edit` 与编辑锁端点。
- `scripts/verify-visual-friendliness.mjs`：新增编辑器目标（工具栏、元信息、弹窗、选中态），复用现有 13 条规则，并补齐新端点 fixture。
- `.github/workflows/deploy.yml`：在现有 Playwright 步骤中调用新脚本；失败即阻断部署。

### 10.4 手工检查

- 中文输入法组合输入（拼音选词、长句）不丢字、不重复。
- 复制粘贴 Word / 网页富文本，确认只保留白名单能力。
- 长文（≥5,000 字）滚动、输入、保存性能。
- 亮 / 暗主题、系统 `prefers-reduced-motion`。
- 编辑锁 30 分钟边界：心跳续期后仍持有；强制接管后原编辑者不能保存。
- 真实用户从桌面拖图片文件进编辑器（T5 只覆盖合成 `DragEvent`，T7 未自动化复现）。

## 11. 分阶段与工单

| 工单 | 内容                                                                          | 阻塞        |
| ---- | ----------------------------------------------------------------------------- | ----------- |
| T0   | 技术验证：Milkdown 回写、embed、上传、包体、CSP、Vue / 中文输入 / i18n / 长文 | 无          |
| T1   | 编辑器纯函数与行为基线（不回写守卫、命令、草稿、slug、字数）                  | 无          |
| T2   | Worker `GET /articles/:id/edit` + 测试 + README                               | 无          |
| T2b  | Worker `PUT /articles/:id` 空字符串清空正文 / 摘要 / 封面 + 回归测试          | 无          |
| T3   | 组件化壳层：文章列表 / 编辑器拆分、锁修复、未保存保护、状态机                 | T1, T2      |
| T4   | Milkdown WYSIWYG 工作区、源码模式、回写守卫、工具栏 / 快捷键、线上预览        | T0, T2b, T3 |
| T5   | 图片上传 / 粘贴 / 拖拽 + 本地草稿恢复                                         | T4          |
| T6   | 元信息面板、响应式、可访问性                                                  | T4          |
| T7   | Playwright 回归、CI、文档 / i18n / 清理、编辑器批次 L3 证据                   | T5, T6      |
| T8   | `App.vue` 余下后台面板全量拆分，收口为壳层；全量 L3 关闭证据                  | T3          |

T0 / T1 / T2 / T2b 可并行；T4 在 T0 结论为「通过」且 T2b 合并后才进入实施。若 T0 否决 Milkdown，回到 ADR 0006 重新选择 TipTap 或 Vditor，T4 范围不变、只替换内核适配层。

GitHub 跟踪：母票 [#60](https://github.com/Mintinkd/Blog_Website/issues/60)；子票 [#61](https://github.com/Mintinkd/Blog_Website/issues/61)（T0）、[#62](https://github.com/Mintinkd/Blog_Website/issues/62)（T1）、[#63](https://github.com/Mintinkd/Blog_Website/issues/63)（T2）、[#70](https://github.com/Mintinkd/Blog_Website/issues/70)（T2b）、[#64](https://github.com/Mintinkd/Blog_Website/issues/64)（T3）、[#65](https://github.com/Mintinkd/Blog_Website/issues/65)（T4）、[#66](https://github.com/Mintinkd/Blog_Website/issues/66)（T5）、[#67](https://github.com/Mintinkd/Blog_Website/issues/67)（T6）、[#68](https://github.com/Mintinkd/Blog_Website/issues/68)（T7）、[#69](https://github.com/Mintinkd/Blog_Website/issues/69)（T8）。

## 12. 风险与缓解

| 风险                                    | 影响                           | 缓解                                                             |
| --------------------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| Markdown 回写丢失原始 HTML / 自定义属性 | 存量文章被静默改写             | 回写守卫、语料、源码模式、保存前二次校验                         |
| 包体过大（Crepe 全量约 450KB gzip）     | 后台首屏变慢                   | CrepeBuilder 裁剪、懒加载、350KB 预算、T0 实测                   |
| 中文输入法 / ProseMirror 组合输入问题   | 作者无法正常输入               | T0 手工验证；必要时源码模式兜底                                  |
| CSP 收紧阻断编辑器                      | 生产不可用                     | 不使用 eval / CDN；构建后跑 `patch-csp` 与浏览器回归             |
| 移动端富文本编辑体验差                  | 作者手机上不可用               | 响应式回归；窄屏可切源码模式                                     |
| 编辑锁过期 / 被接管后仍保存             | 覆盖他人修改                   | 心跳、保存前校验、锁丢失禁止保存、本地草稿                       |
| localStorage 配额 / 隐私                | 草稿写不进去 / 多用户串稿      | 1MB 上限、按用户 id 隔离、退出登录清理                           |
| 粘贴富文本带入白名单外内容              | 前台渲染被剥除 / 观感不一致    | 能力边界、粘贴清洗、线上预览对照                                 |
| 草稿恢复的是旧版本正文                  | 恢复后绕过回写守卫、保存即改写 | 恢复后重新执行守卫，lossy 进源码模式；保存前仍二次校验           |
| 组件拆分引入回归                        | 其他后台标签页受影响           | T3 行为等价、先加测试、Playwright 后台回归；T8 分阶段逐面板拆分  |
| 全量拆分与编辑器改造同时改 `App.vue`    | 合并冲突、回归范围失控         | T8 在 T3 后启动；每阶段独立 PR；T7 清理 `App.vue` 前先与 T8 合流 |

## 13. 验收标准

> 下表是 Epic #60 的整体验收，逐条映射与关闭证据在 #68 / #69 关票留言。
> T7 #68 已为下列行为补上端到端证据：§10.3 场景 1（安全 / lossy 模式判定）、
> 场景 2/3（`PUT` 只含 Markdown + 保存后 SSR 语义等价）、场景 4（未保存保护与
> 锁 `DELETE`）、场景 5（加载 / 保存失败态）、场景 6（草稿恢复 / 丢弃）、
> 场景 7（锁冲突与保存前校验失锁）、场景 8（280 / 375 / 1280 响应式）、
> 场景 9（控制台无报错）；全部由 `deploy.yml` 的 Playwright 步骤阻断式执行。
> 10 分钟真实心跳与 `beforeunload` 分层仍由 `tests/edit-lock.test.ts` /
> `tests/article-editor-flow.test.ts` 的 fake timers 单测锁定，不在浏览器重复。

- [ ] 存量语料在 WYSIWYG 中打开 / 保存后，前台渲染结果语义等价；不等价时自动进入源码模式并明确提示。
- [ ] 保存请求体只含 Markdown，`content_html` 不被写入；`data-embed="1"`、表格、代码块、引用、图片均保留。
- [ ] 关闭 / 取消 / Esc / 刷新在脏状态下触发保护；放弃后锁被释放；保存失败不关闭编辑器。
- [ ] 编辑锁心跳续期；保存前校验；锁冲突时禁止保存并有可操作出口。
- [x] 图片上传 / 粘贴可用；失败不破坏正文；合成拖拽已进骨架，真实拖拽由 T7 复核。
- [x] 本地草稿可恢复 / 丢弃，保存后清理，退出登录清理。
- [ ] 375px / 280px 无横向滚动；1280px 分屏正常；亮暗主题、焦点陷阱、对比度通过现有观感规则。
- [ ] 新增 `GET /articles/:id/edit` 有 401 / 403 / 400 非法 id / 404 / owner / admin / 无统计副作用测试，响应不含 `content_html`。
- [ ] `npm test`、Worker `typecheck` / `test`、`npm run check`、Playwright 回归、观感检查全部通过。
- [ ] README、GLOSSARY、ADR 0006、`docs/agents/testing.md`、zh/en i18n 同步；编辑器批次 L3 在 #42 留证据，全量 L3 由 T8 收口。
- [ ] `App.vue` 不再包含文章编辑器主体；编辑器纯逻辑可在不挂载完整后台的情况下单测。
- [ ] T8：`App.vue` 只保留壳层 / 导航 / 会话 / 跨面板状态（目标 ≤300 行），12 个后台 tab 行为等价，`#42` L3 关闭。

## 14. 文档同步清单

- `README.md`
  - 技术栈：新增 Milkdown / ProseMirror（编辑器打开时懒加载），修正「预览走默认 DOMPurify」的旧描述，写明预览复用 `renderMarkdown`。
  - 项目结构：新增 `src/admin/articles/`、`src/admin/editor/`、`src/admin/panels/`、`src/admin/composables/`、`src/utils/editor/`。
  - 后台管理：更新文章编辑器能力（WYSIWYG / 源码 / 线上预览、图片上传、本地草稿、未保存保护、锁心跳）。
  - API：新增 `GET /articles/:id/edit`。
  - 文章编辑器新增独立小节，写清回写守卫与能力边界。
- `GLOSSARY.md`：新增「编辑」分组术语。
- `docs/adr/0006-wysiwyg-markdown-editor.md`：T0 通过后从 `proposed` 改为 `accepted`。
- `docs/agents/testing.md`：新增编辑器 Playwright 命令与测试分层说明。
- `src/i18n/zh.json` / `en.json`：各 UI 工单随实现新增文案；T7 只删除不再使用的旧模式 key，并校验 zh/en 键集合一致。
- `docs/reviews/YYYY-MM-DD-article-editor.md`：实施完成后按仓库惯例补审查报告。
