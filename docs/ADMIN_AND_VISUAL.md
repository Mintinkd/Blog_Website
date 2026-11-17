# 后台管理与视觉增强

本文档收录后台管理功能、文章编辑器、视觉与体验增强能力。部署流程见根目录 [`README.md`](../README.md)。

## 后台管理

访问 `/admin` 进入管理后台，功能包括：

- **登录认证** — JWT Token，存储在 localStorage，登录返回用户信息和角色；口令长度上限 200（登录 / 建号 / 改密 / 重置同口径，超限 400 且不进入 KDF）；未知用户名只跑固定 1000 次迭代的假验证（不以等代价为目标；剩余账号存在性时序差是为阻断匿名 CPU 放大而接受的取舍）
- **角色权限** — admin（全部功能）和 editor（文章/分类/标签/评论/图片，受所有权限制）
- **文章管理** — 新建/编辑/删除，Markdown编辑器（所见即所得 / 源码 / 分屏 / 线上预览四档，插入链接支持普通链接 / 内嵌网页预览两种方式），Slug支持中文
  - editor 只能编辑/删除自己的文章
  - 组件化（T3 #64）：文章列表与全屏壳层在 `src/admin/articles/`，元信息 / 工作区 / 弹窗 / composables 在 `src/admin/editor/`；`App.vue` 不再包含文章编辑器主体，后台样式由 `src/admin/admin-shared.css` 单源提供
  - 面板拆分（T8 #69）：11 个后台面板移到 `src/admin/panels/`，`App.vue`（226 行）只保留登录、侧栏编排、tab 编排与跨面板状态，不再包含领域模板 / 领域请求 / 面板样式；壳层依赖由 `src/admin/composables/` 的 `provide` / `inject` 注入，`scrape` 与 `analytics` 经 `defineAsyncComponent` 懒加载不进后台首屏 chunk；`about` 保持 Markdown 编辑与预览链接，不接 WYSIWYG；设置类面板只搬 UI，不改设置规则生成链
  - 拆分度量（T8 #69）：`App.vue` 3206 → 226 行；后台首屏 chunk `App.0CFMjVT7.js` 113,837 B → `App.SP8Znihm.js` 117,975 B（壳层依赖胶水 +4,138 B；同期并行的 T6 #67 也改了后台代码，两次构建共用同一工作区，数字含其影响）；新增 `AnalyticsPanel.C5LZ1aSR.js` 12,876 B 与 `ScrapePanel.HHE3gfBI.js` 8,552 B 两个懒加载面板 chunk，抓取工具 `scrape.CBAiJISo.js` 54,639 B 保持不变
  - 取数：打开已发布文章走认证接口 `GET /articles/:id/edit`（不经公开 slug 接口、不写阅读统计）；强制接管后重新加载详情并重建未保存基线
  - 编辑锁：打开前获取、每 10 分钟心跳续期、保存前再次校验；取消 / X / Esc / 保存成功 / 放弃均释放，`beforeunload` 只提示，`pagehide`（`persisted === false`）尽力释放；冲突时禁止保存并提供复制正文 / 保留草稿 / 关闭
  - 未保存保护：脏状态下关闭 / 取消 / Esc / 刷新触发三出口（保存并关闭 / 放弃修改 / 继续编辑）；加载正文失败不进入可编辑状态，保存失败保持编辑器打开、保持锁并保留内容
  - 会话失效（`10003`）：先同步落盘本地草稿、尽力释放锁，再退出到登录页，不清除该用户草稿
  - 所见即所得（T4 #65）：Milkdown 7 内核打开时懒加载；加载 / 模式切换 / 保存前均执行回写守卫，有损时默认进源码模式，作者可显式覆盖但保存前守卫仍失败会阻止保存；打开未编辑不改写正文，源码模式未修改保存保留原始字节
  - 元信息面板（T6 #67）：标题 `maxlength=200`（与服务端 `validate` 一致）、slug「根据标题生成」后默认锁定可解锁手改、摘要字数计数、封面仅 http(s) 预览且失败占位、标签 chips + 本地筛选、字数 / 阅读时长读数复用 T1 纯函数；发布前检查标题与正文 trim 后非空，slug 冲突由服务端错误原样展示、不改写不加后缀。窄屏元信息折叠为抽屉、宽屏常显，触控目标 ≥44px，280/375px 无横向滚动、1280px 分屏并排；四个模态弹窗有 `role=dialog` / `aria-modal` / 焦点陷阱与焦点归还，保存 / 上传 / 锁丢失用 `aria-live="polite"` 播报
- **分类管理** — 增改（editor仅自己的），删除仅admin
- **标签管理** — 增（editor创建的），删除仅admin
- **评论管理** — 筛选/审核/拒绝/删除（editor仅自己文章的评论）
- **图片管理** — 上传/缩略图预览/复制链接/删除（editor仅自己上传的）
- **网页抓取**（仅admin）— 粘贴静态文章 URL，经 Worker 的 SSRF/robots 护栏取回 HTML，在管理端浏览器用 Readability（或手动 CSS selector）提取正文并转成 GFM Markdown；支持 GBK/GB2312 字符集、相对 URL 绝对化、危险 scheme 剥除、嵌入内容降级与可能坏图提示；自动映射标题/摘要/封面/已有标签并追加来源脚注；预览支持 Markdown/渲染切换；「生成草稿并编辑」打开现有文章编辑器并预填标题/slug/summary/封面/正文/分类 1/标签/draft，保存前不创建任何数据
- **关于页面** — Markdown 编辑 + 个人名片（姓名 / 职位 / 简介 / 头像 / 可增删社交链接）配置，保存后前台实时更新（仅admin）
- **友情链接** — 增删改（仅admin；URL 仅 http/https，非法存量数据在列表降级为纯文本）
- **站点配置** — 标题、副标题、描述、关键词等（仅admin）
- **外观与个性化** — 可视化配置中心（仅admin）：配色（日/夜 accent、背景、文字、边框）、布局（内容宽度/导航高度/圆角）、全站背景图、遮罩浓度、**背景雾化与亮度**、功能开关（评论/点赞/友链/搜索/RSS/暗色/双语）、文案覆盖（中/英）、动效强度与视差开关；支持导出 / 导入 / 一键恢复默认
- **账户管理** — 多用户支持（admin/editor角色），增删改，密码修改，自我降级保护（仅admin）

### 文章编辑器（T4 #65 / T5 #66 / T6 #67 / ADR 0006）

- **正文契约**：`articles.content` 的 Markdown 是唯一正文源；保存只写 Markdown，绝不写 `content_html`（历史遗留列，不读不写，无 D1 迁移）。前台、后台预览、线上预览共用 `src/utils/markdown.ts` 的 `renderMarkdown`（marked + DOMPurify，白名单见 `markdownPolicy.ts`）。
- **四档形态**：所见即所得（Milkdown 7 / ProseMirror）、源码（textarea + 轻量工具栏，复用 `editorCommands.ts`）、分屏（左侧编辑 + 右侧只读预览）、线上预览弹窗。分屏 ≥1024px 并排、768–1023px 堆叠、<768px 隐藏入口；预览 150ms 防抖、只在可见时渲染，`enhanceMediaLinks` 限定各自容器。
- **装配**：`CrepeBuilder` 只装 7 项（toolbar / list-item / link-tooltip / table / block-edit / placeholder / cursor）。**不装 `image-block`**：7.23.0 的 `imageBlockSchema` 把图片 `alt` 当宽高比，会静默改写存量正文（T0 实测 15 条语料有 2 条 lossy，去掉后 15/15 语义等价）。也不装 code-mirror / latex / ai / top-bar。
- **语义等价回写守卫**：`src/utils/editor/markdownBridge.ts` 比较「原文」与「编辑器解析后立即序列化结果」经同一 `renderMarkdown` 渲染、规范化后的 HTML；不要求字节相同（T0 实测 0/15 字节相同）。加载时判定，lossy 默认进源码模式并提示；作者可显式覆盖进 WYSIWYG，但**保存前二次守卫**独立重新判定，仍失败即阻止保存（不发请求、不改状态、保持锁），绝不静默改写。判定结果接入 `useArticleEditor`，不是孤立模块。
- **内嵌链接**：`<a … data-embed="1">文字</a>` 由 `milkdown/embedLink.ts` 的专用内联节点 + NodeView 承接（编辑器内是真实可编辑 `<a>`，编辑态点击不导航），序列化按原开标签逐字还原；无法安全合并的复杂结构回退到内核原子 html 片段，保持逐字保真。
- **图片**：工具栏「插入图片」、WYSIWYG 粘贴 / 拖拽统一走 `src/utils/editor/uploadImage.ts`：图片类型与 10MB 预检 → `POST /api/v1/media/upload`（Bearer + FormData `file`）→ `{ url, original_name }` 映射为 `{ url, alt }`（alt 取 `original_name` 去扩展名）。源码模式插入 `![alt](url)` 并选中 alt，alt 走 T1 的 Markdown 转义；上传中禁用工具栏重复提交，失败保留原正文。保留内置 `upload` 插件但覆盖 `uploadConfig.uploader`，写普通 `image` 节点；不写 `blob:` / base64 图片，不新增图片代理或转存，不扩大正文白名单。
- **本地草稿**：复用 `src/utils/editor/draftStore.ts`，键为 `blog:article-draft:v1:u{userId}:a{articleId|new}`，只存白名单表单字段、`savedAt` 与基线哈希，不存 token。编辑后 1.5s 防抖写入，`pagehide` 同步落盘；打开时显示「恢复 / 丢弃」条，不自动覆盖服务端内容。保存 / 放弃 / 退出登录时清理；超过 1MB 跳过并只提示一次；超过 7 天视为过期并惰性清理。恢复后仍走正常保存 / 锁校验，并重新执行 T4 回写守卫，lossy 时进入源码模式；新建文章首次保存成功后清除 `new` 键，避免下次新建误恢复。
- **能力边界**：启用的节点 / 标记不超过 `ARTICLE_BODY_TAGS` / `ARTICLE_BODY_ATTRS`；不做 LaTeX、任务列表、下划线、文字颜色、代码高亮、iframe。
- **快捷键**（仅编辑器焦点内生效）：Ctrl/Cmd+S 保存、K 插入链接、B/I 粗体/斜体（源码模式）、Shift+P 线上预览、Shift+E 切换源码/所见即所得；Esc 在弹窗打开时由弹窗消费，否则走未保存保护。
- **i18n / 主题**：编辑器文案进 `zh.json` / `en.json`；工具栏 label 用 Vue `reactive` 配置 + `locale-changed` 事件原地更新，切换语言不重建实例、不丢正文；`classic.css` 的 `--crepe-color-*` 映射到站点设计令牌，亮暗跟随 `[data-theme]`。
- **包体 / CSP**：内核只在首次打开编辑器时加载（实测增量 gzip 约 182 KiB < 350 KiB 预算）；不使用 eval / CDN，`npm run build` 的 `patch-csp` 通过，静态与 SSR 两份 CSP 逐字符一致。
- **测试**：`tests/editor-markdown-bridge.test.ts`（语料安全 / 有损分组）、`tests/editor-guard-integration.test.ts`（加载 / 模式切换 / 保存前守卫 / 显式覆盖仍阻止）、`tests/editor-upload.test.ts`（预检 / 上传映射 / 服务端错误 / 失败保留正文）、`tests/editor-draft.test.ts`（键 / 隔离 / 7 天过期 / 1MB 配额 / 基线哈希）、`tests/article-editor-flow.test.ts`（草稿恢复 / 丢弃 / 防抖 / pagehide / 保存清理）、`tests/markdown-preview-parity.test.ts`（真实渲染管线下的守卫判定）。`scripts/verify-article-editor.mjs` 已由 T7 #68 按 `ARTICLE_EDITOR_UPGRADE.md` §10.3 重写为覆盖九条检查单的 12 个端到端场景（每个场景独立 browser context），用 `scripts/mock-admin-api.mjs` 的有状态 mock 串起后台 `PUT` 与文章 SSR `GET` 并接入 CI 部署门禁；真机中文输入法组合输入按 §10.4 仍属手工检查。
- **元信息 / 响应式 / 可访问性测试（T6 #67）**：`tests/editor-meta-fields.test.ts`（node，25 项）钉住发布前校验、封面 http(s) 白名单、slug 锁定状态机、标签筛选、字数与阅读时长同服务端样例；`tests/editor-focus-trap.test.ts`（jsdom，12 项）钉住 Tab 循环、焦点归还与幂等。`scripts/verify-visual-friendliness.mjs` 的 `EDITOR_TARGETS` 独立量测元信息面板（280/375/1280 × 亮暗的对比度 / 裁切 / 触控目标 / 焦点环 / 溢出）；`scripts/verify-editor-responsive.mjs` 浏览器回归抽屉、焦点陷阱与归还、封面失败占位、发布前校验、slug 冲突原样展示、工具栏换行与中英最长标签不裁切（已由 T7 接入 CI 门禁）。两脚本的入口选择器 / 视口矩阵 / `/api/v1/**` fixture 共用 `scripts/editor-meta-fixture.mjs`（单一事实源）；`scripts/verify-editor-responsive.mjs` 已由 T7 #68 接入 CI 门禁。

## 视觉与体验增强

> 以下能力均通过「可视化配置中心」在 `/admin` 后台实时调整，无需重新部署。详细设计见 `docs/` 目录：`BACKGROUND_IMAGE.md`、`SITE_SETTINGS.md`、`UI_MOTION_UPGRADE.md`。

### 全站背景图

全站所有页面共享一张铺满视口的固定背景层，响应式适配桌面 / 平板 / 手机及横竖屏，不变形、不遮挡文字。

- **实现**：`BaseLayout.astro` 注入 `<div class="site-bg">` 固定层（`position: fixed; inset: -10% 0; z-index: -1`）；背景图与遮罩色由 CSS 变量 `--bg-image` / `--bg-overlay` / `--bg-position` 控制（`variables.css` 中日 / 夜各一份）。
- **默认图**：`public/bg-placeholder.svg`，可在配置中心替换为自定义图片 URL。
- **文字对比度**：遮罩按主题背景色 + 配置的浓度（`bgOpacity`，默认 0.55）自动生成渐变，保证前景文字清晰；另支持**背景雾化**（`bgBlur`，0~30px，默认 6px 轻度雾化）与**背景亮度**（`bgBrightness`，0.7~1.3，默认 1），两者均可在后台「外观与个性化 → 背景」调节，让亮图/复杂图背景下的正文保持高可读性。
- **主题 / 语言切换**：通过 View Transitions（`startViewTransition`）做平滑过渡，背景层同步切换。

### 可视化配置中心

所有个性化设置（配色 / 布局 / 背景 / 功能开关 / 文案 / 动效）统一存为 `site_config` 表中的 JSON blob（key = `site_settings`），由后台「外观与个性化」面板可视化编辑，前后端实时生效。

- **后端**：`worker/src/handlers/settings.ts` —— 读取时与 `getDefaultSettings()` 深度合并（缺失字段自动补默认、未知字段被过滤，防注入）；提供公开白名单投影读取（`GET /settings/public`）+ admin 全量读取 / 写 / 导出 / 导入 / 恢复默认接口。
- **前端注入器**：`src/utils/settings.ts` 的 `applySettings()` 把配置转成可直接生效的视觉与行为：
  1. **配色 / 布局 / 背景** → 注入 CSS 变量覆盖 `variables.css` 默认值（`!important` 保证生效），按 `[data-theme="light"/"dark"]` 分写，日 / 夜切换照常生效；
  2. **功能开关** → 在 `<html>` 写 `data-feature-<name>="off"`，配合 `[data-feature]` 钩子隐藏对应模块（评论 / 点赞 / 友链 / 搜索 / RSS / 暗色 / 双语）；
  3. **文案覆盖** → 写入 i18n 覆盖层并按当前 locale 刷新 `[data-i18n]` 文本，中 / 英切换照常生效；
  4. **动效** → 写 `data-motion-intensity` 与 `data-parallax` 及 `--parallax-speed`。
- **配置项**（见 `SiteSettings` 接口）：`theme`（light/dark 各 10 项配色）、`layout`（内容宽度 / 导航高度 / 三档圆角）、`background`（图片 URL / 遮罩浓度 / 雾化 / 亮度）、`features`（7 个开关）、`copy`（中 / 英文案覆盖）、`motion`（强度 / 视差开关 / 视差速度）。
- **同步**：`initSettings()` 在页面加载时拉取并套用；保存后通过 `storage` 事件 + `settings-updated` 事件跨标签页实时刷新。
- **数据安全**：这些设置不含任何密钥，`/settings/public` 白名单投影作为公开接口供前台拉取；全量读取（`/settings`、`/settings/all`）与写 / 导出 / 导入 / 恢复均为 admin 专属。
- **合法性单源（issue #27 / ADR 0001）**：读侧回落与写侧拒绝共享同一套校验规则 —— 手写单源为仓库根 `settings.rules.json`（规则描述符），`npm run gen:settings` 从其生成 `src/generated/settings-rules.ts` 与 `worker/src/generated/settings-rules.ts` 两份字节一致的规则模块，两侧校验逻辑只消费生成物；生成物禁止手工编辑，CI 以「重新生成 → diff 必须为空」的漂移断言最早门禁守护，漂移修复流程为改描述符 → 重跑生成 → 一并提交。
- **CORS 白名单单源（issue #85 / H4）**：Worker（`worker/src/middleware/cors.ts`）与同源 API 代理（`src/utils/api-proxy.ts`）共用一份 Origin 白名单 —— 手写单源为仓库根 `cors.origins.json`，`npm run gen:cors` 生成两端 `src/generated/cors-origins.ts` / `worker/src/generated/cors-origins.ts` 字节一致的模块。代理不再无条件写 `Access-Control-Allow-Origin: *`（此前会把 Worker 已收紧的白名单重新放开），改为白名单精确回显 + `Vary: Origin`；OPTIONS 预检补安全头，代理 fetch 加 10s 超时。CI 漂移断言同设置白名单。新增 Origin 只改 `cors.origins.json` 并重跑生成。
- **富文本白名单单源（issue #92 / M6 + #99 / M19）**：Worker 消毒器（`worker/src/utils/sanitizer.ts`）与前端正文策略（`src/utils/markdownPolicy.ts`）共用一份标签 / 属性 / scheme 白名单 —— 手写单源为仓库根 `rich-text-policy.json`，`npm run gen:rich-text` 生成 `worker/src/generated/rich-text-policy.ts`；前端 markdownPolicy.ts 与描述符的一致性由 `tests/rich-text-policy.test.ts` 交叉守卫。Worker 消毒器从旧正则黑名单改为 `sanitize-html` 白名单消毒（5 类已知 XSS 绕过全部封堵，见 `worker/tests/sanitizer_whitelist.test.ts`），对外签名不变。当前单一源覆盖标签 / 属性 / scheme / 丢内容标签四维；`data-*` / `aria-*` 通配、img 额外 scheme 已纳入描述符。前端 `ARTICLE_BODY_FORBIDDEN_IDS`（DOM clobbering 防护）仍仅在前台 DOMPurify 渲染层生效——Worker 消毒后的正文交付前台会再过一次 DOMPurify，故兜底成立；将其纳入单一源是 #99 的深化项。新增标签 / 属性只改 `rich-text-policy.json` → 重跑生成 → 同步前端 markdownPolicy.ts → 一并提交；CI 漂移断言同设置白名单。**导入路径的净化范围**：`/admin/import` 只对 `content_html`（真正的 HTML 列）过白名单；`articles.content` 是 Markdown 源文、`comments.content` 是纯文本（渲染时由转义兜底），过 HTML 白名单会把 `<https://…>`、`<T>`、围栏里的 HTML 吃掉、把 `a < b` 变成实体，破坏「备份可还原」——正文 XSS 由渲染链（Worker `markdownServer` 消毒 + 前台 DOMPurify）兜底，评论写入路径仍按 #92 入库净化。

### 外链内容智能代理

当外链图片因防盗链 / 域名失效无法显示、或外链文字接口因网络 / CORS 受限无法拉取时，自动降级到本站代理，用户无感。

- **图片通道** `/api/v1/img-proxy?url=`：前端全局监听 `<img>` 加载失败（`document` 捕获阶段 error 事件）→ 自动把 `src` 切换为代理地址；代理成功显示原图，代理也失败则隐藏占位（不显示破图）。仅本站之外的图片触发，同源图片不代理。
- **文字通道** `/api/v1/text-proxy?url=`：前端提供全局 `window.fetchWithProxy(url, opts)`——直连成功原样返回；失败（网络 / CORS / 非 2xx）自动改请求代理地址。返回标准 `Response`，调用方仅作文本 / JSON 解析。悬浮一言组件已接入。
- **安全**：仅 http/https、URL 长度限制、拒绝内网 / 保留 IP / 内部域名 / `*.workers.dev`（防递归代理套娃）、请求头净化（去 Referer / Cookie）、**域名解析后 IP 复核**（DoH A/AAAA，任一结果落入受限段即拒绝；解析失败 / 超时 / 无记录 fail-closed 拒绝；每一跳重定向均复核）+ **双解析器一致性校验**（issue #109：主/备解析器答案集合必须完全一致，否则按 rebinding 拒绝并记 `[ssrf-blocked]`；Workers 无连接级 IP 绑定原语，理由与残余风险见 `adr/0007-dns-rebinding-connection-binding.md`）、仅白名单 MIME（图片通道 image/_，文字通道 text/_ + json + xml）、≤10MB、每 IP 独立限流 120 次/分、10s 超时。**SVG 纵深防御（issue #93 / M7）**：以 `image/svg+xml` 返回的响应强制 `Content-Disposition: attachment` + 沙箱 CSP（`default-src 'none'; sandbox`）+ nosniff（attachment 口径与媒体 serve 一致，沙箱 CSP 是代理通道额外的纵深防御）；`<img src>` 展示不受 attachment 影响，代理层不净化 SVG 内容（评估见 #93 关票评论）。**保持严格 TLS 证书校验**，不做全局绕过。
- **缓存自动过期删除**：代理结果写入 KV，`expirationTtl` 24h 到期自动清理，无需手动删除。
- **CORS**：文字通道响应带 `Access-Control-Allow-Origin: *` 并处理 OPTIONS 预检，前端可跨域读取。
- 代码：`worker/src/handlers/img_proxy.ts`、`worker/src/handlers/text_proxy.ts`；前端侧两个通道分别在 `src/scripts/layout/img-proxy-fallback.ts`（`<img>` 失败降级）与 `src/scripts/layout/fetch-proxy.ts`（`window.fetchWithProxy` + 域级 7 天标记），issue #103 起从 `BaseLayout.astro` 的内联脚本抽出。

### 网页抓取（admin-only）

管理端「网页抓取」标签页把静态文章 URL 变成可校对的 Markdown 草稿（issue #33 / #34 / #35 / ADR 0003）。职责切分为两段：Worker 只做「安全取回」，正文提取与格式转换在管理员浏览器执行（字符集嗅探 → Readability 或手动 selector → Turndown + GFM），原始 HTML 不进入管理页 DOM。

注意：此「页面抓取」与上方「外链内容智能代理」是两条独立通道——代理负责前台运行时显示外链内容，抓取只服务管理端生成草稿。

- **入口** `GET /api/v1/admin/scrape?url=`：路由层 `requireAuth + requireAdmin`（editor 403），handler 内再次校验角色；editor 在管理端也看不到该标签页。
- **流程**：URL 校验（SSRF）→ robots.txt 预检 → 抓取目标 HTML（逐跳重定向复核）→ 返回原始 HTML 字节；前端按 BOM / `Content-Type` / `<meta charset>` 解码字节，以 `X-Final-URL` 绝对化相对链接、按 `X-Robots-Status` 决定是否显示「未做 robots 检查」警告，再生成预览。原始 HTML 保留在管理页内存，供 selector 本地重提取。
- **提取与转换**：默认用 Readability；识别不出正文时回退 `<body>` 并显示 no-article 警告。手动 CSS selector 覆盖提取（多个命中按文档顺序拼接；命中表格行/单元格时保留表格与表头上下文），「重新提取」在已抓取的 HTML 上重跑、不重新请求源站；selector 语法错误 / 未命中给出明确错误并保留上一份预览。Markdown 保留标题、列表、引用、带语言标注的围栏代码、GFM 表格、图片与行内强调；正文中与标题同名的 h1 去重。懒加载图片先提升 `data-src` / `srcset` 中的真实地址；相对链接 / 图片按页面自带 `<base>` 或 final URL 解析；iframe/embed/object 在 http/https 时降级为链接，否则丢弃；`javascript:` / `data:` / `vbscript:` 地址一律剥除。
- **元数据映射**：标题按 Readability → `og:title` → `<title>`（selector 模式优先所选子树 H1）；摘要按 meta/OG description → 正文前 120 字；封面只取 `og:image`（缺失留空）；标签只匹配站点已有标签（meta keywords + 正文区域 `article` / `main` 内的 tag 链接，未匹配项丢弃、不创建新标签）；slug 留空由创建接口生成并去重；分类默认 id 1（未分类）；状态 `draft`；作者由后端按当前管理员写入。
- **来源脚注**：正文末尾自动追加 `---` + `> 原文：[标题](final URL)（抓取于 YYYY-MM-DD）`，使用最终 URL，标题中的 `[` / `]` 会转义；selector 重提取沿用首次抓取日期。
- **字符集**：按 BOM → `Content-Type` → `<meta charset>` / XML 声明解码，覆盖 GBK / GB2312；未知或不支持的字符集回退 UTF-8 并显示警告。
- **预览**：显示标题、摘要、封面缩略图（缺失 / 加载失败时显示占位）、字数、字符集与正文图片数量；缺少可用地址的图片提示可能坏图，其余外链图片提示防盗链风险；Markdown / 渲染切换复用全站 `renderMarkdown`（`marked + DOMPurify`，标签白名单），切换标签页后预览与视图模式保留；新抓取覆盖未保存预览前弹出确认，失败抓取保留旧预览并提供「重试」。
- **安全**：与图片 / 文字通道共用 SSRF 护栏（仅 http/https、拒绝内网 / 保留 IP / 内部域名 / `*.workers.dev`、解析后 IP 复核、每一跳重定向复核）、仅 `text/html` 与 `application/xhtml+xml`、≤2MB、目标 10s 超时（robots 预检另有 5s 上限）、每管理员 10 次/分限流、仅透传上游 `Content-Type`（其余上游头一律剥离）、`Cache-Control: no-store`、不缓存不写库。
- **robots.txt**：明确的 `Disallow` 命中 → 403 且不发起目标请求（响应里带命中规则）；404 / 410 / 非 2xx / 网络异常 / 超 500KB → 放行并置 `X-Robots-Status: unchecked`，UI 显示警告。
- **草稿交接**：预览区「生成草稿并编辑」复用现有文章编辑器，预填标题 / 空 slug / 摘要 / 封面 / Markdown 正文 / 分类 1 / 匹配标签 / `draft`；所有字段仍可在编辑器中修改，取消不创建任何数据；保存仍走既有 `POST /articles`，slug 生成与去重、作者赋值、校验逻辑不变。
- **范围（T3）**：元数据映射、来源脚注与预览体验已补齐；不做 `articles.source_url` 字段、抓取历史 / 查重、图片转存或自动发布。
- 代码：`worker/src/handlers/scrape.ts`、`src/utils/scrape.ts`、管理端标签页在 `src/admin/App.vue`。

### UI 动效升级

基于 transform / opacity 的轻量动效体系，性能优先、尊重系统偏好，并可在配置中心按需开关。

- **基建**：`src/styles/motion.css`（入场 / 磁吸 / hover 样式 + 强度分级 / 加载失败兜底）+ `src/utils/motion.ts`（初始化逻辑）。
- **能力**：
  - **入场动画** —— 通过 `[data-reveal]` / `[data-reveal="fade-up"]` 与 `[data-reveal-stagger]` 触发，IntersectionObserver 滚动进入视口时播放，支持错峰；
  - **滚动进度条** —— `ScrollProgress.astro` 顶部细进度条；
  - **磁吸 / hover 微动效** —— `[data-hover="magnetic"]` 按钮磁吸、卡片 / 图标 hover 反馈；
  - **视差** —— 背景层极轻微视差（`data-parallax-fixed`，位移 = 滚动进度 × 视口高 × 速度系数，有界），速度可在配置中心调节（默认 0.04）；
  - **主题 / 语言过渡** —— View Transitions 平滑过渡。
- **分级与兜底**：
  - 动效强度 `motion.intensity`：`normal`（全部）/ `reduced`（仅保留轻量入场与进度条，禁用磁吸 / 视差）/ `off`（全部禁用），写入 `<html data-motion-intensity>`；
  - 视差开关 `motion.parallax`：关闭时写 `data-parallax="off"`；
  - 全局 `prefers-reduced-motion` 兜底；移动端自动跳过磁吸 / 视差；
  - motion chunk 动态 import 失败或 3s 内未完成初始化时，写入 `<html data-motion-failed>`，强制 `[data-reveal]` 可见（与禁用 JS 的 `<noscript>` 兜底互补）。
- **生命周期**：`BaseLayout.astro` 引入 Astro `ClientRouter` 并在 `astro:page-load` 后调用 `initMotion()`；动态渲染的内容触发 `motion:refresh` 事件重新绑定。
- **脚本组织（issue #103）**：`BaseLayout.astro` 里原来的 600 行内联脚本已拆成 `src/scripts/layout/` 下 11 个模块（`theme-locale` / `mobile-nav` / `dynamic-title` / `site-config` / `site-settings` / `motion-boot` / `back-to-top` / `fetch-proxy` / `hitokoto` / `img-proxy-fallback` / `favicon-light`），layout 里只剩 < 40 行的编排块（逐行 `initXxx()`）与文档头那个**必须保留**的 `is:inline` 主题初始化脚本（首屏防闪色，不能改成模块）。`bound` 幂等守卫在 `theme-locale` / `site-config` 里，防止重复初始化时事件委托叠层或重复打 `/config`。**拆分前后 SSR 产物一致性的证据**：本地构建产物归一化（抹掉 `data-v-*` / `astro-island` uid / 远端 `--bg-*` 变量）后结构零差异——这是人工核对，**未固化为 CI 断言**；仓库内可自动守的是「编排块 < 40 行 + 11 个模块都被 import 且被调用 + 无业务逻辑残留」（`tests/base-layout-modules.test.ts`）与两个有契约模块的行为（`tests/layout-modules.test.ts`），其余 9 个纯 DOM 装饰模块由 Playwright 脚本覆盖。
