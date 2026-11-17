# 项目概览

本文档收录项目的定位、技术栈、代码目录结构与数据库模型。部署流程见根目录 [`README.md`](../README.md)。

## 项目定位

基于 Astro + Cloudflare 技术栈的个人独立博客系统，前后端分离架构，部署在 Cloudflare Pages + Workers 上。

## 技术栈

### 前端

- **Astro v5** — SSG/SSR 混合渲染（静态页面 + SSR 动态路由）
- **Vue 3** — 岛屿架构交互组件（搜索、评论、点赞等）
- **Milkdown 7（ProseMirror + remark）/ Crepe** — 后台文章编辑器的所见即所得内核，固定 `@milkdown/*` 7.23.0 一组；`defineAsyncComponent + import()` 懒加载，只在首次打开编辑器时进入增量 chunk（实测 gzip 约 182 KiB，预算 350 KiB），不进后台首屏（issue #65 / ADR 0006）
- **Element Plus** — 后台管理UI组件库
- **marked + DOMPurify / sanitize-html** — Markdown渲染（`renderMarkdown` 与服务端正文渲染器共用一份正文白名单，分别由 DOMPurify / sanitize-html 执行；文章编辑器预览复用同一 `renderMarkdown`；marked v14 后无内置高亮，代码高亮未接线；highlight.js 依赖已于 issue #51 卸载，prose.css 的 hljs 样式为渲染侧残留）

### 后端

- **Cloudflare Workers** — 无服务器API后端
- **Cloudflare D1** — SQLite数据库（文章、分类、标签、评论等）
- **Cloudflare R2** — 对象存储（媒体文件；新上传写 R2）
- **Cloudflare KV** — 键值存储（存量媒体读取兜底 + 编辑锁 + 代理/限流缓存）
- **JWT** — 管理员/编辑者认证

### 部署

- **Cloudflare Pages** — 前端静态托管
- **GitHub Actions** — CI/CD 自动部署

## 项目结构

```
├── .github/workflows/
│   └── deploy.yml              # CI/CD 自动部署
├── public/
│   ├── .assetsignore             # Workers+Assets 排除 _worker.js
│   ├── _headers                  # 生成物：安全响应头 + HTML 护栏 + _assets 指纹资产 immutable 长缓存（模块单源渲染，禁止手工编辑，issue #28 / #96）
│   └── bg-placeholder.svg       # 默认全站背景图
├── src/
│   ├── admin/
│   │   ├── App.vue             # 后台壳层：登录 / 标签页编排 / 跨面板状态（T8 #69，226 行）
│   │   ├── AdminSidebar.vue    # 导航定义 / admin-only 角色可见性 / 登出入口（T8 #69）
│   │   ├── admin-shared.css    # 后台共享样式单源（由 App.vue 的 <style scoped> 整块抽出，T3 #64）
│   │   ├── composables/        # 壳层依赖：会话 / 请求 / 反馈 / 共享数据 / 编辑器桥接（T8 #69）
│   │   │   ├── useSession.ts        # token / 角色 / 登录 / 登出 / 10003 失效（草稿清理分叉）
│   │   │   ├── useAdminApi.ts       # /api/v1 认证请求 + 10003 / 10004 错误码
│   │   │   ├── useFeedback.ts       # 包装现有 alert / confirm，不引入新 toast UI
│   │   │   ├── useAdminCatalog.ts   # 跨面板共享列表数据 + loadInitialData 预加载
│   │   │   ├── useAdminEditor.ts    # 编辑器装配 + overlay 事件 + 抓取草稿转文章
│   │   │   └── adminContext.ts      # 依赖聚合与 provide / inject 单一注入点
│   │   ├── panels/             # 11 个领域面板，各配一个 *.logic.ts 纯逻辑（T8 #69）
│   │   │   ├── CategoriesPanel.vue / TagsPanel.vue / CommentsPanel.vue / MediaPanel.vue
│   │   │   ├── ConfigPanel.vue / AboutPanel.vue / AppearancePanel.vue
│   │   │   ├── UsersPanel.vue / FriendLinksPanel.vue
│   │   │   └── ScrapePanel.vue / AnalyticsPanel.vue   # 壳层 defineAsyncComponent 懒加载
│   │   ├── articles/
│   │   │   ├── ArticlesPanel.vue         # 文章列表 / 筛选 / 操作列（T3 #64）
│   │   │   └── ArticleEditorOverlay.vue  # 文章编辑器全屏壳层（T3 #64）
│   │   └── editor/                       # 编辑器组件、状态机与锁（T3 #64 / T4 #65）
│   │       ├── EditorMetaFields.vue      # 标题 / slug / 分类 / 状态 / 标签 / 摘要 / 封面
│   │       ├── MarkdownWorkspace.vue     # WYSIWYG / 源码 / 分屏 / 线上预览四档 + 源码工具栏
│   │       ├── EditorPreviewDialog.vue   # 只读线上预览（同一个 renderMarkdown）
│   │       ├── LinkDialog.vue            # 普通链接 / 内嵌网页预览
│   │       ├── UnsavedChangesDialog.vue  # 保存并关闭 / 放弃修改 / 继续编辑
│   │       ├── DraftRecoveryBar.vue      # 本地草稿恢复 / 丢弃 / 过期提示
│   │       ├── useArticleEditor.ts       # 显式状态机 + 副作用编排 + 回写守卫（消费 T1 reducer）
│   │       ├── useLocalDraft.ts          # 1.5s 防抖 / pagehide 同步 / 配额提示一次
│   │       ├── useEditLock.ts            # 获取 / 10 分钟心跳 / 保存前校验 / 释放
│   │       └── milkdown/                 # T4 编辑内核（懒加载）
│   │           ├── MilkdownEditor.vue    # 异步组件壳层：打开时不回写正文，只有实际编辑才更新
│   │           ├── createEditor.ts       # CrepeBuilder 7 项装配 / uploader 覆盖 / 响应式文案
│   │           ├── embedLink.ts          # data-embed 专用内联节点 + NodeView + remark 合并
│   │           └── milkdownService.ts    # 守卫用同装配隐藏实例做 Markdown 往返
│   ├── components/
│   │   ├── article/
│   │   │   └── ArticleCard.astro
│   │   ├── common/
│   │   │   ├── Pagination.astro
│   │   │   ├── EmptyState.astro
│   │   │   └── ScrollProgress.astro  # 顶部滚动进度条
│   │   └── layout/
│   │       └── BaseLayout.astro  # 全局布局（毛玻璃导航栏 + 移动端下拉菜单）
│   ├── islands/                 # Vue交互组件（Astro岛屿架构）
│   │   ├── ThemeToggle.vue
│   │   ├── SearchBox.vue
│   │   ├── CommentSection.vue
│   │   ├── LikeButton.vue
│   │   └── FriendLinkList.vue
│   ├── pages/
│   │   ├── index.astro          # 首页
│   │   ├── articles/
│   │   │   ├── index.astro      # 文章列表
│   │   │   └── [slug].astro      # 文章详情（SSR：正文 + 每篇 SEO + 阅读量 Cookie）
│   │   ├── categories/
│   │   │   ├── index.astro      # 分类云（SSR）
│   │   │   └── [slug].astro     # 分类文章（SSR）
│   │   ├── tags/
│   │   │   ├── index.astro      # 标签云（SSR）
│   │   │   └── [slug].astro     # 标签文章（SSR）
│   │   ├── api/v1/[...path].ts      # API代理路由（SSR）
│   │   ├── rss.xml.ts               # RSS订阅源（SSR）
│   │   ├── speculation-rules.ts     # 空预取规则集端点（SSR，覆盖 Cloudflare Speed Brain）
│   │   ├── robots.txt.ts            # robots.txt 由构建期站点 origin 生成（sitemap 绝对地址跟随 SITE_URL）
│   │   ├── archives.astro       # 归档
│   │   ├── about.astro          # 关于
│   │   ├── privacy.astro        # 隐私与阅读统计披露（中英、页脚入口，#59）
│   │   ├── search.astro         # 搜索
│   │   ├── admin/index.astro    # 后台管理入口
│   │   └── 404.astro
│   ├── i18n/                     # 多语言翻译
│   │   ├── zh.json               # 中文
│   │   └── en.json               # 英文
│   ├── styles/
│   │   ├── variables.css        # 设计令牌（颜色、字体、阴影、背景、动效等）
│   │   ├── global.css           # 全局样式（含 .site-bg 固定背景层）
│   │   ├── responsive.css       # 响应式层（断点 / 流式留白 / 触控 / 移动导航）
│   │   ├── motion.css           # 动效样式（入场/磁吸/hover/强度分级/加载失败兜底）
│   │   └── prose.css            # 文章排版样式
│   ├── generated/
│   │   ├── settings-rules.ts    # 生成物：设置白名单规则（双端同构，禁止手工编辑，issue #27）
│   │   └── cors-origins.ts      # 生成物：CORS 白名单（cors.origins.json → 双端同构，issue #85）
│   ├── scripts/layout/          # 布局脚本模块（issue #103：从 BaseLayout 内联脚本拆出 11 个模块）
│   ├── middleware.ts            # SSR 安全响应头 + HTML 护栏中间件（消费两个单源，issue #28 / ADR 0002）
│   ├── utils/
│   │   ├── api.ts               # API请求工具
│   │   ├── analyticsView.ts     # 统计面板纯函数（SVG 路径 / 空态 / 比率 / 小样本 / 失败接口格式化 / Tier 0 白名单，#58）
│   │   ├── articleDate.ts       # 文章发布日期格式化（服务端首屏与客户端 locale 切换共用）
│   │   ├── articleMeta.ts       # 文章页 SEO 元信息构造（title/description/canonical/OG，纯函数）
│   │   ├── articleServer.ts     # 文章详情页服务端取数接缝（三态映射、访客 Cookie 转发、Set-Cookie 回传、私有缓存）
│   │   ├── visitorIpSigning.ts  # Pages 转发点访客 IP 签名（HMAC-SHA256，secret 取运行时 env，issue #84）
│   │   ├── taxonomyServer.ts    # 分类 / 标签页 SSR 取数接缝（三态映射，issue #97）
│   │   ├── taxonomyRender.ts    # 分类 / 标签页首屏渲染共用（列表 / 分页 / 空态，issue #97）
│   │   ├── markdown.ts          # Markdown渲染（DOMPurify 消毒，消费共享正文白名单）
│   │   ├── markdownPolicy.ts    # 文章正文标签/属性/URL scheme 白名单（DOMPurify 与 sanitize-html 共用）
│   │   ├── markdownServer.ts    # 服务端 Markdown 渲染（marked + sanitize-html，Workers 可用）
│   │   ├── escape.ts            # 转义工具（escapeHtml/escapeAttr/safePathSegment/sanitizeHighlight）
│   │   ├── theme.ts             # 主题切换
│   │   ├── categoryColors.ts    # 分类专属色映射（徽标/渐变横幅；hexToRgba/shade 等）
│   │   ├── siteConfig.ts        # 站点基础配置读取与应用
│   │   ├── siteTitleServer.ts   # 文章页 SSR 站点标题读取（公共 config，失败回退默认站名）
│   │   ├── settings.ts          # 全站可视化配置（读取/注入CSS变量/功能开关/跨标签页同步）
│   │   ├── motion.ts            # 动效初始化（reveal/磁吸/视差/滚动进度条/View Transition）
│   │   ├── i18n.ts              # 多语言工具（initLocale, setLocale, t函数）
│   │   ├── workerOrigin.ts      # Worker API origin 单一事实源（文章 SSR / RSS / API 代理共用；dev-only 文章取数覆盖）
│   │   ├── scrape.ts            # 网页抓取管线（字符集嗅探 → Readability/selector → Turndown + GFM + 元数据/来源脚注，管理端浏览器执行）
│   │   └── editor/                  # 文章编辑器纯函数基线（issue #62 / T4 #65）
│   │       ├── markdownBridge.ts    # 语义等价回写守卫 / 规范化比较 / 模式判定 / 保存前二次守卫
│   │       ├── editorCommands.ts    # 源码模式包裹选区 / 行前缀 / 列表续行 / 链接与图片插入、Markdown 转义、isEmbedSnippet 锚点判定（#74）
│   │       ├── draftStore.ts        # 本地草稿键 / 序列化 / 用户+文章隔离 / 7 天过期 / 1MB 配额（storage 可注入）
│   │       ├── uploadImage.ts       # 图片类型 / 10MB 预检、Bearer 上传、{ url, alt } 映射、失败保留正文
│   │       ├── editorState.ts       # useArticleEditor 纯 reducer：脏状态 / 关闭决策 / 保存失败 / 锁丢失
│   │       ├── slug.ts              # 标题生成 slug 与合法性（与 Worker generateSlug 对齐）
│   │       ├── wordCount.ts         # 中英文字数与阅读时长（与 Worker calculateReadingTime 对齐）
│   │       ├── focusTrap.ts         # 弹窗焦点陷阱纯 DOM 模块：Tab 循环 / 焦点归还（T6 #67）
│   │       └── metaFields.ts        # 元信息纯函数：发布前校验 / 封面 URL 白名单 / slug 锁定 / 标签筛选 / 面板读数（T6 #67）
│   └── types/
│       ├── global.d.ts          # 运行时注入全局能力的 Window 类型声明（fetchWithProxy 等）
│       └── turndown-plugin-gfm.d.ts  # turndown-plugin-gfm 的类型声明（包内无 .d.ts，#33）
├── scripts/
│   ├── security-headers.mjs      # 安全响应头单一事实源（5 头声明式常量 + 同目录 .d.mts 类型声明；middleware 直接 import，issue #28 / ADR 0002）
│   ├── cloudflare-guards.mjs     # Cloudflare 注入护栏单源（HTML no-transform / Speculation-Rules 空规则集；同目录 .d.mts）
│   ├── generate-headers.mjs      # public/_headers 生成器（prebuild 自动执行；CI 漂移断言）
│   ├── patch-csp.mjs             # 构建后 CSP 收紧（astro:build:done 自动调用；以安全头模块为源构造 + 注入内联脚本 sha256 + 残留断言；同目录 .d.mts）
│   ├── generate-settings-rules.mjs # 设置白名单规则生成器（settings.rules.json → 双端生成物）
│   ├── generate-cors-origins.mjs # CORS 白名单生成器（cors.origins.json → 双端生成物）
│   ├── generate-rich-text-policy.mjs # 富文本白名单生成器（rich-text-policy.json → worker 生成物，issue #92 / #99）
│   ├── migrate-reading-time.mjs # reading_time 加列幂等迁移（CI 自动执行，issue #90）
│   ├── repro-nav-home.mjs        # 客户端导航回归复现（Playwright 驱动，需先自行安装 playwright）
│   ├── verify-all-pages-nav.mjs  # 全站客户端导航回归验证（Playwright 驱动，同上）
│   ├── verify-article-ssr.mjs    # 文章详情 SSR 回归（CI 构建前执行；服务端正文 / 无 JS / motion 失败 / 404 / 502；自拉本地 mock）
│   ├── verify-admin-analytics.mjs # 后台「统计」面板回归（Playwright；空库 / 有数据 / 错误态三场景，#58）
│   ├── verify-privacy-page.mjs   # 隐私页回归（Playwright；页脚入口 / 中英切换 / 无 JS 文案，#59）
│   ├── visual-contrast.mjs       # 观感检查的颜色数学（零依赖；WCAG 对比度 / 半透明背景逐层合成；同目录 .d.mts）
│   ├── verify-visual-friendliness.mjs # 页面观感友好度检查（CI + 手动；13 条规则 / 亮暗主题 / 多视口 / 带源码定位的报告）
│   ├── verify-admin-responsive.mjs # 后台移动端回归（CI + 手动；T7 #68 补编辑器遮罩 / fixture）
│   ├── verify-editor-responsive.mjs # 编辑器元信息 / 响应式 / 可访问性回归（T6 #67；CI 门禁）
│   ├── verify-article-editor.mjs # 文章编辑器端到端回归（T7 #68；§10.3 九条检查单 / 12 个独立 context 场景 / 有状态 mock 双通道 / CI 门禁）
│   ├── mock-admin-api.mjs        # 有状态 admin mock 纯状态机（T7 #68；登录 / 列表 / edit 详情 / PUT / 编辑锁 / 上传 / 公开读取）
│   ├── mock-admin-api.d.mts      # 上述 mock 的类型声明
│   ├── mock-article-api.mjs      # 同一进程同时服务文章 SSR 回归（#41）与 admin 回归（#68）；/__stats / /__control / /__reset
│   ├── article-ssr-fixture.mjs   # 上述 mock 与回归脚本共享的文章 fixture
│   ├── editor-meta-fixture.mjs   # 编辑器两脚本共用的入口选择器 / 视口矩阵 / /api/v1/** fixture（T6 #67）
│   ├── site-config.mjs           # 站点 / Worker origin / sitemap 环境配置单源（默认值集中一处；同目录 .d.mts）
│   ├── render-worker-config.mjs  # CI 部署配置渲染（vars → worker/wrangler.deploy.jsonc，生成物不入库）
│   ├── gh.ps1                    # Windows gh 包装（UTF-8 输出/参数；见 docs/agents/windows-shell.md）
│   └── run-astro-check.mjs      # 前端类型门禁入口（npm run check；Node 旗标自动判定，钉版说明见头注）
├── worker/                      # Cloudflare Worker 后端
│   ├── wrangler.jsonc            # Worker配置（D1/KV/R2 绑定 + 每日 cron，本地默认生效）
│   ├── schema.sql                    # 数据库 Schema（全新库形态，可重复执行，issue #94）
│   ├── migrations/                   # wrangler d1 migrations 迁移文件（0001_baseline 等，issue #94）
│   ├── migrations-baseline.sql       # 存量/全新库标记 0001 已应用（幂等，issue #94）
│   ├── schema-tier0-incremental.sql  # 阅读统计 Tier 0 增量 DDL（已有部署升级直接 --file 执行）
│   ├── package.json             # 后端依赖与脚本（typecheck / test）
│   ├── tsconfig.json            # 后端 TS 配置（tests typecheck 走 tsconfig.test.json）
│   ├── vitest.config.mjs        # Worker 测试配置（node 环境，避免继承根级 jsdom）
│   ├── tests/                   # Worker 单元测试（vitest：代理 SSRF 解析后 IP 复核、抓取代理 robots/限流等）
│   └── src/
│       ├── generated/
│       │   └── settings-rules.ts # 生成物：设置白名单规则（与根包同构，禁止手工编辑，issue #27）
│       ├── index.ts             # Worker入口（fetch + scheduled 每日清理）
│       ├── router.ts            # 路由注册与分发
│       ├── middleware/
│       │   ├── auth.ts          # JWT认证
│       │   ├── cors.ts          # 跨域
│       │   ├── rate_limit.ts    # 限流策略（规则表 + method/路由模板分桶，issue #48；算法委托 utils/rate_limiter.ts，issue #91）
│       │   ├── rate_limiter.ts  # 统一限流算法（滑动窗口计数 + KV 幂等键，四处限流共用，issue #91）
│       │   └── security_headers.ts  # API 安全响应头（CSP default-src 'none'，渗透报告 002）
│       ├── handlers/            # API处理器
│       │   ├── article.ts
│       │   ├── category.ts
│       │   ├── tag.ts
│       │   ├── comment.ts
│       │   ├── search.ts
│       │   ├── like.ts
│       │   ├── media.ts          # 媒体上传 / 列表 / 删除 / serve（R2 优先、KV 兜底）
│       │   ├── config.ts
│       │   ├── settings.ts      # 可视化配置中心后端（site_config JSON blob）
│       │   ├── friend_link.ts
│       │   ├── img_proxy.ts     # 外链图片代理（防盗链兜底，SSRF/限流校验 + KV TTL 缓存）
│       │   ├── text_proxy.ts    # 外链文字/接口代理（CORS + text/json/xml 白名单 + KV TTL 缓存）
│       │   ├── scrape.ts        # 网页抓取代理（admin-only；SSRF/robots/2MB/10s/每管理员限流）
│       │   ├── auth_handler.ts
│       │   ├── edit_lock.ts
│       │   ├── admin.ts
│       │   └── analytics.ts         # 阅读统计后台只读接口（概览 / 分布 / 明细 / 质量 / 趋势，#55–#58）
│       ├── services/
│       │   ├── user_service.ts          # 按 username 取 id / id+display_name 单点（#101 / M21）
│       │   ├── article_service.ts       # 文章列表/详情/写入 + slugExists + loadArticleTags（#89/#101）
│       │   ├── edit_lock_service.ts     # 编辑锁（用户查询委托 user_service，#101）
│       │   ├── analytics_service.ts      # dayKey / 清理 / HMAC 密钥 / recordArticleView（#53、#55）
│       │   └── analytics_dimensions.ts   # Tier 0 维度桶映射 / upsert / 小样本保护（#56）
│       ├── models/              # 数据模型
│       └── utils/               # 工具函数（media_storage：R2/KV 媒体存储抽象）
├── astro.config.mjs
├── package.json
├── settings.rules.json          # 设置白名单规则描述符（手写单源，issue #27 / ADR 0001）
├── cors.origins.json            # CORS Origin 白名单描述符（手写单源，issue #85 / H4）
├── rich-text-policy.json        # 富文本标签/属性/scheme 白名单描述符（手写单源，issue #92 / #99）
├── wrangler.jsonc                # 根目录Workers+Assets部署配置
├── tsconfig.json
├── vitest.config.ts              # 根级 vitest（默认 jsdom）：抓取管线 / 文章服务端测试
├── tests/                        # 前端单元测试（抓取管线 fixture + 文章 SSR 取数 / SEO / 站点标题 / dev-only origin 覆盖 + 编辑器纯函数行为基线 #62 + 回写守卫与守卫编排 #65）
├── .node-version
├── .npmrc
├── AGENTS.md                    # 代理协作约定（技能 / issue tracker / CI-CD / shell 导航）
├── CODING_STANDARDS.md          # 判断类编码规则（code-review Standards 轴依据）
├── GLOSSARY.md                  # 领域术语表（domain-modeling 沉淀）
└── docs/                         # 设计与功能文档
    ├── responsive-design.md      # 响应式断点、布局策略与验证矩阵
    ├── UI_MOTION_UPGRADE.md     # UI 动效升级方案
    ├── BACKGROUND_IMAGE.md      # 全站背景图说明
    ├── SITE_SETTINGS.md         # 可视化配置中心说明
    ├── adr/                     # 架构决策记录（0001 设置白名单单源 / 0002 安全头单源 / 0003 抓取代理与浏览器端提取 / 0004 文章正文请求时 SSR）
    ├── agents/                  # 代理工作流约定（issue-tracker / triage-labels / domain / testing / windows-shell）
    ├── reviews/                 # 代码审查报告存档（YYYY-MM-DD-<topic>.md）
    └── security/
        ├── cloudflare-guards.md # Cloudflare 注入护栏（JSD CSP violation / Speed Brain 预取 503）
        └── csp-evaluation.md    # CSP 收紧评估（script-src 内联哈希 / style-src 取舍）
```

## 数据库设计

D1 (SQLite) 共 13 张表：

| 表名                      | 说明                                                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                   | 用户账户（管理员/编辑者，PBKDF2-SHA256 加盐慢哈希，旧 SHA-256 哈希登录时透明升级，角色权限）                                                                                                 |
| `categories`              | 文章分类（含 created_by 所有权）                                                                                                                                                             |
| `tags`                    | 标签（含 created_by 所有权；`category_id` 归属分类，1:N——每个标签只属于一个分类，taxonomy v2 / ADR 0008，迁移期可空、回填后由应用层保证必填）                                                |
| `articles`                | 文章（Markdown 原文 `content` 是唯一正文源；`content_html` 为历史遗留、页面不读取；`reading_time` 落库的阅读分钟数，创建/更新时写入，列表读它不再搬正文；author_id 作者，category_id 默认1） |
| `article_tags`            | 文章-标签多对多关联                                                                                                                                                                          |
| `comments`                | 评论（含审核状态）                                                                                                                                                                           |
| `article_likes`           | 点赞记录（IP去重）                                                                                                                                                                           |
| `media_assets`            | 媒体文件元数据（`storage_type` 标识对象在 `r2` 还是存量 `kv`；含 uploaded_by 所有权）                                                                                                        |
| `friend_links`            | 友情链接                                                                                                                                                                                     |
| `site_config`             | 站点配置（KV结构，含JWT密钥、统计HMAC密钥与清理任务心跳）                                                                                                                                    |
| `analytics_article_daily` | 阅读统计日聚合（PV/UV/requests/engaged/bot_filtered，按文章+站点时区日）                                                                                                                     |
| `analytics_view_token`    | 24h 去重令牌（HMAC hex，不含 IP 明文；每日 cron 清理）                                                                                                                                       |
| `analytics_dim_daily`     | 阅读统计维度桶（只写单篇行，全站查询时 GROUP BY；保留 400 天）                                                                                                                               |

另含 FTS5 全文搜索虚拟表 `articles_fts` 及同步触发器。Tier 1 的 `analytics_consent` 本批不建。

> **taxonomy v2（issue #75 / [ADR 0008](adr/0008-tag-as-category-subsystem.md)）**：标签系统改为分类子系统——`tags.category_id` 让每个标签归属一个分类（1:N），文章分类仍由 `articles.category_id` 权威决定、标签不反向决定文章分类（首批软约束，审计到 0 冲突后另行决策硬校验）。`tags.name` / `slug` 继续全局唯一，URL 结构不变；存量回填规则为「按引用文章的分类投票、平票取小 id、无文章归未分类」。五个决策的后果、边界与回滚原则见 ADR 0008。

阅读统计三表为派生数据，不进入 `/admin/export` 备份与 `/admin/import` 恢复（短期令牌与可重算聚合不跨环境搬运）；`site_config` 的统计密钥与心跳行在导入时保留本机值。

## License

MIT
