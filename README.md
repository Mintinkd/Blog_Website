# Blog Website

基于 Astro + Cloudflare 技术栈的个人独立博客系统，前后端分离架构，部署在 Cloudflare Pages + Workers 上。

## 技术栈

### 前端

- **Astro v5** — SSG/SSR 混合渲染（静态页面 + SSR 动态路由）
- **Vue 3** — 岛屿架构交互组件（搜索、评论、点赞等）
- **Element Plus** — 后台管理UI组件库
- **marked + DOMPurify** — Markdown渲染（marked v14 后无内置高亮，代码高亮未接线；highlight.js 依赖与 prose.css 的 hljs 样式暂为渲染侧残留）

### 后端

- **Cloudflare Workers** — 无服务器API后端
- **Cloudflare D1** — SQLite数据库（文章、分类、标签、评论等）
- **Cloudflare KV** — 键值存储（媒体文件 + 编辑锁）
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
│   ├── _headers                  # 生成物：安全响应头 + HTML 护栏（安全头 / 护栏模块单源渲染，禁止手工编辑，issue #28）
│   ├── bg-placeholder.svg       # 默认全站背景图
│   └── robots.txt
├── src/
│   ├── admin/
│   │   └── App.vue             # 后台管理SPA（Vue 3 + Element Plus）
│   ├── components/
│   │   ├── article/
│   │   │   └── ArticleCard.astro
│   │   ├── common/
│   │   │   ├── Pagination.astro
│   │   │   ├── EmptyState.astro
│   │   │   └── ScrollProgress.astro  # 顶部滚动进度条
│   │   └── layout/
│   │       └── BaseLayout.astro  # 全局布局（毛玻璃导航栏）
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
│   │   │   └── [slug].astro      # 文章详情（SSR）
│   │   ├── categories/
│   │   │   ├── index.astro      # 分类云（SSR）
│   │   │   └── [slug].astro     # 分类文章（SSR）
│   │   ├── tags/
│   │   │   ├── index.astro      # 标签云（SSR）
│   │   │   └── [slug].astro     # 标签文章（SSR）
│   │   ├── api/v1/[...path].ts      # API代理路由（SSR）
│   │   ├── rss.xml.ts               # RSS订阅源（SSR）
│   │   ├── speculation-rules.ts     # 空预取规则集端点（SSR，覆盖 Cloudflare Speed Brain）
│   │   ├── archives.astro       # 归档
│   │   ├── about.astro          # 关于
│   │   ├── search.astro         # 搜索
│   │   ├── admin/index.astro    # 后台管理入口
│   │   └── 404.astro
│   ├── i18n/                     # 多语言翻译
│   │   ├── zh.json               # 中文
│   │   └── en.json               # 英文
│   ├── styles/
│   │   ├── variables.css        # 设计令牌（颜色、字体、阴影、背景、动效等）
│   │   ├── global.css           # 全局样式（含 .site-bg 固定背景层）
│   │   ├── motion.css           # 动效样式（入场/磁吸/hover/强度分级兜底）
│   │   └── prose.css            # 文章排版样式
│   ├── generated/
│   │   └── settings-rules.ts    # 生成物：设置白名单规则（双端同构，禁止手工编辑，issue #27）
│   ├── middleware.ts            # SSR 安全响应头 + HTML 护栏中间件（消费两个单源，issue #28 / ADR 0002）
│   ├── utils/
│   │   ├── api.ts               # API请求工具
│   │   ├── markdown.ts          # Markdown渲染
│   │   ├── escape.ts            # 转义工具（escapeHtml/escapeAttr/safePathSegment/sanitizeHighlight）
│   │   ├── theme.ts             # 主题切换
│   │   ├── categoryColors.ts    # 分类专属色映射（徽标/渐变横幅；hexToRgba/shade 等）
│   │   ├── siteConfig.ts        # 站点基础配置读取与应用
│   │   ├── settings.ts          # 全站可视化配置（读取/注入CSS变量/功能开关/跨标签页同步）
│   │   ├── motion.ts            # 动效初始化（reveal/磁吸/视差/滚动进度条/View Transition）
│   │   ├── i18n.ts              # 多语言工具（initLocale, setLocale, t函数）
│   │   └── scrape.ts            # 网页抓取管线（字符集嗅探 → Readability/selector → Turndown + GFM，管理端浏览器执行）
│   └── types/
│       ├── global.d.ts          # 运行时注入全局能力的 Window 类型声明（fetchWithProxy 等）
│       └── turndown-plugin-gfm.d.ts  # turndown-plugin-gfm 的类型声明（包内无 .d.ts，#33）
├── scripts/
│   ├── security-headers.mjs      # 安全响应头单一事实源（5 头声明式常量 + 同目录 .d.mts 类型声明；middleware 直接 import，issue #28 / ADR 0002）
│   ├── cloudflare-guards.mjs     # Cloudflare 注入护栏单源（HTML no-transform / Speculation-Rules 空规则集；同目录 .d.mts）
│   ├── generate-headers.mjs      # public/_headers 生成器（prebuild 自动执行；CI 漂移断言）
│   ├── patch-csp.mjs             # 构建后 CSP 收紧（astro:build:done 自动调用；以安全头模块为源构造 + 注入内联脚本 sha256 + 残留断言；同目录 .d.mts）
│   ├── generate-settings-rules.mjs # 设置白名单规则生成器（settings.rules.json → 双端生成物）
│   ├── repro-nav-home.mjs        # 客户端导航回归复现（Playwright 驱动，需先自行安装 playwright）
│   ├── verify-all-pages-nav.mjs  # 全站客户端导航回归验证（Playwright 驱动，同上）
│   └── run-astro-check.mjs      # 前端类型门禁入口（npm run check；Node 旗标自动判定，钉版说明见头注）
├── worker/                      # Cloudflare Worker 后端
│   ├── wrangler.toml            # Worker配置（旧版，已弃用）
│   ├── wrangler.jsonc            # Worker配置（D1/KV绑定，实际生效）
│   ├── schema.sql               # 数据库Schema
│   ├── package.json             # 后端依赖与脚本（typecheck / test）
│   ├── tsconfig.json            # 后端 TS 配置（tests typecheck 走 tsconfig.test.json）
│   ├── vitest.config.mjs        # Worker 测试配置（node 环境，避免继承根级 jsdom）
│   ├── tests/                   # Worker 单元测试（vitest：代理 SSRF 解析后 IP 复核、抓取代理 robots/限流等）
│   └── src/
│       ├── generated/
│       │   └── settings-rules.ts # 生成物：设置白名单规则（与根包同构，禁止手工编辑，issue #27）
│       ├── index.ts             # Worker入口
│       ├── router.ts            # 路由注册与分发
│       ├── middleware/
│       │   ├── auth.ts          # JWT认证
│       │   ├── cors.ts          # 跨域
│       │   ├── rate_limit.ts    # 限流
│       │   └── security_headers.ts  # API 安全响应头（CSP default-src 'none'，渗透报告 002）
│       ├── handlers/            # API处理器
│       │   ├── article.ts
│       │   ├── category.ts
│       │   ├── tag.ts
│       │   ├── comment.ts
│       │   ├── search.ts
│       │   ├── like.ts
│       │   ├── media.ts
│       │   ├── config.ts
│       │   ├── settings.ts      # 可视化配置中心后端（site_config JSON blob）
│       │   ├── friend_link.ts
│       │   ├── img_proxy.ts     # 外链图片代理（防盗链兜底，SSRF/限流校验 + KV TTL 缓存）
│       │   ├── text_proxy.ts    # 外链文字/接口代理（CORS + text/json/xml 白名单 + KV TTL 缓存）
│       │   ├── scrape.ts        # 网页抓取代理（admin-only；SSRF/robots/2MB/10s/每管理员限流）
│       │   ├── auth_handler.ts
│       │   ├── edit_lock.ts
│       │   └── admin.ts
│       ├── services/
│       │   ├── article_service.ts
│       │   └── edit_lock_service.ts
│       ├── models/              # 数据模型
│       └── utils/               # 工具函数
├── astro.config.mjs
├── package.json
├── settings.rules.json          # 设置白名单规则描述符（手写单源，issue #27 / ADR 0001）
├── wrangler.jsonc                # 根目录Workers+Assets部署配置
├── tsconfig.json
├── vitest.config.ts              # 根级 vitest（jsdom）：抓取管线测试
├── tests/                        # 前端单元测试（抓取管线 HTML fixture）
├── .node-version
├── .npmrc
├── AGENTS.md                    # 代理协作约定（技能 / issue tracker / CI-CD 导航）
├── CODING_STANDARDS.md          # 判断类编码规则（code-review Standards 轴依据）
├── GLOSSARY.md                  # 领域术语表（domain-modeling 沉淀）
└── docs/                         # 设计与功能文档
    ├── UI_MOTION_UPGRADE.md     # UI 动效升级方案
    ├── BACKGROUND_IMAGE.md      # 全站背景图说明
    ├── SITE_SETTINGS.md         # 可视化配置中心说明
    ├── adr/                     # 架构决策记录（0001 设置白名单单源 / 0002 安全头单源 / 0003 抓取代理与浏览器端提取）
    ├── agents/                  # 代理工作流约定（issue-tracker / triage-labels / domain / testing）
    ├── reviews/                 # 代码审查报告存档（YYYY-MM-DD-<topic>.md）
    └── security/
        ├── cloudflare-guards.md # Cloudflare 注入护栏（JSD CSP violation / Speed Brain 预取 503）
        └── csp-evaluation.md    # CSP 收紧评估（script-src 内联哈希 / style-src 取舍）
```

## 数据库设计

D1 (SQLite) 共 10 张表：

| 表名            | 说明                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------- |
| `users`         | 用户账户（管理员/编辑者，PBKDF2-SHA256 加盐慢哈希，旧 SHA-256 哈希登录时透明升级，角色权限） |
| `categories`    | 文章分类（含 created_by 所有权）                                                             |
| `tags`          | 标签（含 created_by 所有权）                                                                 |
| `articles`      | 文章（含Markdown原文和HTML渲染结果，author_id作者，category_id默认1）                        |
| `article_tags`  | 文章-标签多对多关联                                                                          |
| `comments`      | 评论（含审核状态）                                                                           |
| `article_likes` | 点赞记录（IP去重）                                                                           |
| `media_assets`  | 媒体文件元数据（含 uploaded_by 所有权）                                                      |
| `friend_links`  | 友情链接                                                                                     |
| `site_config`   | 站点配置（KV结构，含JWT密钥）                                                                |

另含 FTS5 全文搜索虚拟表 `articles_fts` 及同步触发器。

## API 接口

所有接口前缀 `/api/v1`，前端通过 Astro API 路由代理到 Worker。

### 公开接口

| 方法 | 路径                                | 说明                                                                                                                                                |
| ---- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | `/health`                           | 健康检查                                                                                                                                            |
| POST | `/auth/login`                       | 登录（返回JWT token和用户信息）                                                                                                                     |
| GET  | `/articles`                         | 文章列表（支持分页、分类、标签过滤；默认仅 published，draft/all 等非 published 查询需登录）                                                         |
| GET  | `/articles/:slug`                   | 文章详情（流程内自增阅读量：Cookie 去重、24 小时 TTL）                                                                                              |
| GET  | `/categories`                       | 分类列表                                                                                                                                            |
| GET  | `/tags`                             | 标签列表                                                                                                                                            |
| GET  | `/articles/:article_id/comments`    | 文章评论                                                                                                                                            |
| POST | `/articles/:article_id/comments`    | 提交评论                                                                                                                                            |
| GET  | `/search`                           | 全文搜索                                                                                                                                            |
| POST | `/articles/:article_id/like`        | 点赞/取消                                                                                                                                           |
| GET  | `/articles/:article_id/like-status` | 点赞状态                                                                                                                                            |
| GET  | `/media/serve/*`                    | 媒体文件访问                                                                                                                                        |
| GET  | `/friend-links`                     | 友情链接                                                                                                                                            |
| GET  | `/config`                           | 公开站点配置                                                                                                                                        |
| GET  | `/settings/public`                  | 公开白名单投影（配色 / 布局 / 背景 / 功能开关 / 文案 / 动效），前台运行时套用                                                                       |
| GET  | `/img-proxy?url=`                   | 外链图片代理（前端 img 直连失败自动降级；SSRF（含解析后 IP 复核）/域名/限流校验，KV TTL 24h 缓存）                                                  |
| GET  | `/text-proxy?url=`                  | 外链文字/接口代理（前端 fetch 直连失败或 CORS 受限自动降级；与图片通道共用 SSRF（含解析后 IP 复核）/域名/限流校验，text/json/xml 白名单 + CORS 头） |

### 需认证接口（需 `Authorization: Bearer <token>` 请求头）

#### 通用接口

| 方法   | 路径                    | 说明                                                                                             |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------------ |
| POST   | `/auth/refresh`         | 刷新Token（须改密状态下仍可调用，用于令牌续期）                                                  |
| POST   | `/auth/change-password` | 修改本人口令（验证旧密 + 新密强度校验；须改密状态下与 `/auth/refresh` 同为仅有的两个豁免写接口） |
| POST   | `/articles`             | 创建文章（自动设置author_id）                                                                    |
| PUT    | `/articles/:id`         | 更新文章（editor仅自己的）                                                                       |
| DELETE | `/articles/:id`         | 删除文章（editor仅自己的）                                                                       |
| POST   | `/categories`           | 创建分类（自动设置created_by）                                                                   |
| PUT    | `/categories/:id`       | 更新分类（editor仅自己的）                                                                       |
| POST   | `/tags`                 | 创建标签（自动设置created_by）                                                                   |
| GET    | `/comments`             | 评论列表（editor仅自己文章的）                                                                   |
| PUT    | `/comments/:id/approve` | 审核通过（editor仅自己文章的）                                                                   |
| PUT    | `/comments/:id/reject`  | 审核拒绝（editor仅自己文章的）                                                                   |
| DELETE | `/comments/:id`         | 删除评论（editor仅自己文章的）                                                                   |
| POST   | `/media/upload`         | 上传媒体（自动设置uploaded_by）                                                                  |
| GET    | `/media`                | 媒体列表（editor仅自己的）                                                                       |
| DELETE | `/media/:id`            | 删除媒体（editor仅自己上传的）                                                                   |

#### 编辑锁接口

| 方法   | 路径                            | 说明                    |
| ------ | ------------------------------- | ----------------------- |
| POST   | `/articles/:id/edit-lock`       | 获取编辑锁（30分钟TTL） |
| DELETE | `/articles/:id/edit-lock`       | 释放编辑锁              |
| GET    | `/articles/:id/edit-lock`       | 查询编辑锁状态          |
| POST   | `/articles/:id/edit-lock/force` | 强制接管编辑锁（admin） |

#### 管理员专属接口（需 admin 角色）

| 方法   | 路径                | 说明                                                                                                                       |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| DELETE | `/categories/:id`   | 删除分类                                                                                                                   |
| DELETE | `/tags/:id`         | 删除标签                                                                                                                   |
| GET    | `/users`            | 用户列表                                                                                                                   |
| POST   | `/users`            | 创建用户                                                                                                                   |
| PUT    | `/users/:id`        | 更新用户（密码、显示名、角色；重置口令时同一步清除登录失败计数与锁定）                                                     |
| DELETE | `/users/:id`        | 删除用户（至少保留一个admin）                                                                                              |
| GET    | `/config/all`       | 全部配置                                                                                                                   |
| PUT    | `/config`           | 更新配置                                                                                                                   |
| GET    | `/friend-links/all` | 全部友链                                                                                                                   |
| POST   | `/friend-links`     | 创建友链                                                                                                                   |
| PUT    | `/friend-links/:id` | 更新友链                                                                                                                   |
| DELETE | `/friend-links/:id` | 删除友链                                                                                                                   |
| GET    | `/admin/export`     | 导出数据                                                                                                                   |
| POST   | `/admin/import`     | 导入数据                                                                                                                   |
| GET    | `/admin/scrape`     | 网页抓取代理（admin；SSRF/robots 校验，2MB/10s/每管理员 10 次/分；仅透传 HTML 与 Content-Type；`Cache-Control: no-store`） |
| GET    | `/settings`         | 拉取全部可视化配置（全量视图，与 `/settings/all` 等价）                                                                    |
| GET    | `/settings/all`     | 拉取全部可视化配置                                                                                                         |
| PUT    | `/settings`         | 更新可视化配置（配色 / 布局 / 背景 / 功能 / 文案 / 动效）                                                                  |
| POST   | `/settings/reset`   | 恢复默认可视化配置                                                                                                         |
| GET    | `/settings/export`  | 导出配置 JSON                                                                                                              |
| POST   | `/settings/import`  | 导入配置 JSON                                                                                                              |

## 前台页面

| 路径                 | 说明                            | 渲染模式 |
| -------------------- | ------------------------------- | -------- |
| `/`                  | 首页（Hero + 最新文章卡片网格） | 静态     |
| `/articles`          | 文章列表（分页）                | 静态     |
| `/articles/:slug`    | 文章详情（Markdown渲染）        | SSR      |
| `/categories`        | 分类云（全部分类）              | SSR      |
| `/categories/:slug`  | 分类文章                        | SSR      |
| `/tags`              | 标签云（全部标签）              | SSR      |
| `/tags/:slug`        | 标签文章                        | SSR      |
| `/api/v1/*`          | API代理到Worker                 | SSR      |
| `/rss.xml`           | RSS订阅源                       | SSR      |
| `/speculation-rules` | 空预取规则集（Cloudflare 护栏） | SSR      |
| `/archives`          | 时间线归档                      | 静态     |
| `/about`             | 关于页面                        | 静态     |
| `/search`            | 搜索页                          | 静态     |
| `/admin`             | 后台管理                        | 静态     |

## 后台管理

访问 `/admin` 进入管理后台，功能包括：

- **登录认证** — JWT Token，存储在 localStorage，登录返回用户信息和角色
- **角色权限** — admin（全部功能）和 editor（文章/分类/标签/评论/图片，受所有权限制）
- **文章管理** — 新建/编辑/删除，Markdown编辑器（编辑/分屏/预览三种模式），Slug支持中文
  - editor 只能编辑/删除自己的文章
  - 编辑锁：编辑前自动获取锁，冲突时弹窗提示，admin可强制接管
- **分类管理** — 增改（editor仅自己的），删除仅admin
- **标签管理** — 增（editor创建的），删除仅admin
- **评论管理** — 筛选/审核/拒绝/删除（editor仅自己文章的评论）
- **图片管理** — 上传/缩略图预览/复制链接/删除（editor仅自己上传的）
- **网页抓取**（仅admin）— 粘贴静态文章 URL，经 Worker 的 SSRF/robots 护栏取回 HTML，在管理端浏览器用 Readability（或手动 CSS selector）提取正文并转成 GFM Markdown；支持 GBK/GB2312 字符集、相对 URL 绝对化、危险 scheme 剥除、嵌入内容降级与可能坏图提示；「生成草稿并编辑」打开现有文章编辑器并预填标题/正文/分类 1/draft，保存前不创建任何数据
- **关于页面** — Markdown编辑，保存后前台实时更新（仅admin）
- **友情链接** — 增删改（仅admin）
- **站点配置** — 标题、副标题、描述、关键词等（仅admin）
- **外观与个性化** — 可视化配置中心（仅admin）：配色（日/夜 accent、背景、文字、边框）、布局（内容宽度/导航高度/圆角）、全站背景图、遮罩浓度、**背景雾化与亮度**、功能开关（评论/点赞/友链/搜索/RSS/暗色/双语）、文案覆盖（中/英）、动效强度与视差开关；支持导出 / 导入 / 一键恢复默认
- **账户管理** — 多用户支持（admin/editor角色），增删改，密码修改，自我降级保护（仅admin）

## 视觉与体验增强

> 以下三项能力均通过「可视化配置中心」在 `/admin` 后台实时调整，无需重新部署。详细设计见 `docs/` 目录：`BACKGROUND_IMAGE.md`、`SITE_SETTINGS.md`、`UI_MOTION_UPGRADE.md`。

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

### 外链内容智能代理

当外链图片因防盗链 / 域名失效无法显示、或外链文字接口因网络 / CORS 受限无法拉取时，自动降级到本站代理，用户无感。

- **图片通道** `/api/v1/img-proxy?url=`：前端全局监听 `<img>` 加载失败（`document` 捕获阶段 error 事件）→ 自动把 `src` 切换为代理地址；代理成功显示原图，代理也失败则隐藏占位（不显示破图）。仅本站之外的图片触发，同源图片不代理。
- **文字通道** `/api/v1/text-proxy?url=`：前端提供全局 `window.fetchWithProxy(url, opts)`——直连成功原样返回；失败（网络 / CORS / 非 2xx）自动改请求代理地址。返回标准 `Response`，调用方仅作文本 / JSON 解析。悬浮一言组件已接入。
- **安全**：仅 http/https、URL 长度限制、拒绝内网 / 保留 IP / 内部域名 / `*.workers.dev`（防递归代理套娃）、请求头净化（去 Referer / Cookie）、**域名解析后 IP 复核**（DoH A/AAAA，任一结果落入受限段即拒绝；解析失败 / 超时 / 无记录 fail-closed 拒绝；每一跳重定向均复核）、仅白名单 MIME（图片通道 image/_，文字通道 text/_ + json + xml）、≤10MB、每 IP 独立限流 120 次/分、10s 超时。**保持严格 TLS 证书校验**，不做全局绕过。
- **缓存自动过期删除**：代理结果写入 KV，`expirationTtl` 24h 到期自动清理，无需手动删除。
- **CORS**：文字通道响应带 `Access-Control-Allow-Origin: *` 并处理 OPTIONS 预检，前端可跨域读取。
- 代码：`worker/src/handlers/img_proxy.ts`、`worker/src/handlers/text_proxy.ts`、前端逻辑在 `src/components/layout/BaseLayout.astro`。

### 网页抓取（admin-only）

管理端「网页抓取」标签页把静态文章 URL 变成可校对的 Markdown 草稿（issue #33 / #34 / ADR 0003）。职责切分为两段：Worker 只做「安全取回」，正文提取与格式转换在管理员浏览器执行（字符集嗅探 → Readability 或手动 selector → Turndown + GFM），原始 HTML 不进入管理页 DOM。

注意：此「页面抓取」与上方「外链内容智能代理」是两条独立通道——代理负责前台运行时显示外链内容，抓取只服务管理端生成草稿。

- **入口** `GET /api/v1/admin/scrape?url=`：路由层 `requireAuth + requireAdmin`（editor 403），handler 内再次校验角色；editor 在管理端也看不到该标签页。
- **流程**：URL 校验（SSRF）→ robots.txt 预检 → 抓取目标 HTML（逐跳重定向复核）→ 返回原始 HTML 字节；前端按 BOM / `Content-Type` / `<meta charset>` 解码字节，以 `X-Final-URL` 绝对化相对链接、按 `X-Robots-Status` 决定是否显示「未做 robots 检查」警告，再生成预览。原始 HTML 保留在管理页内存，供 selector 本地重提取。
- **提取与转换**：默认用 Readability；识别不出正文时回退 `<body>` 并显示 no-article 警告。手动 CSS selector 覆盖提取（多个命中按文档顺序拼接），「重新提取」在已抓取的 HTML 上重跑、不重新请求源站；selector 语法错误 / 未命中给出明确错误并保留上一份预览。Markdown 保留标题、列表、引用、带语言标注的围栏代码、GFM 表格、图片与行内强调；正文中与标题同名的 h1 去重。相对链接 / 图片按页面自带 `<base>` 或 final URL 解析；iframe/embed/object 在 http/https 时降级为链接，否则丢弃；`javascript:` / `data:` / `vbscript:` 地址一律剥除。
- **字符集**：按 BOM → `Content-Type` → `<meta charset>` / XML 声明解码，覆盖 GBK / GB2312；未知或不支持的字符集回退 UTF-8 并显示警告。
- **预览**：显示正文图片数量；缺少可用地址的图片提示可能坏图，其余外链图片提示防盗链风险。
- **安全**：与图片 / 文字通道共用 SSRF 护栏（仅 http/https、拒绝内网 / 保留 IP / 内部域名 / `*.workers.dev`、解析后 IP 复核、每一跳重定向复核）、仅 `text/html` 与 `application/xhtml+xml`、≤2MB、目标 10s 超时（robots 预检另有 5s 上限）、每管理员 10 次/分限流、仅透传上游 `Content-Type`（其余上游头一律剥离）、`Cache-Control: no-store`、不缓存不写库。
- **robots.txt**：明确的 `Disallow` 命中 → 403 且不发起目标请求（响应里带命中规则）；404 / 410 / 非 2xx / 网络异常 / 超 500KB → 放行并置 `X-Robots-Status: unchecked`，UI 显示警告。
- **草稿交接**：预览区「生成草稿并编辑」复用现有文章编辑器（预填标题 / Markdown 正文 / 分类 1 / `draft`），取消不创建任何数据；保存仍走既有 `POST /articles`。
- **范围（T2）**：T1 的 UTF-8 限制已由字符集嗅探补齐；元数据与来源脚注仍留给后续票。
- 代码：`worker/src/handlers/scrape.ts`、`src/utils/scrape.ts`、管理端标签页在 `src/admin/App.vue`。

### UI 动效升级

基于 transform / opacity 的轻量动效体系，性能优先、尊重系统偏好，并可在配置中心按需开关。

- **基建**：`src/styles/motion.css`（入场 / 磁吸 / hover 样式 + 强度分级兜底）+ `src/utils/motion.ts`（初始化逻辑）。
- **能力**：
  - **入场动画** —— 通过 `[data-reveal]` / `[data-reveal="fade-up"]` 与 `[data-reveal-stagger]` 触发，IntersectionObserver 滚动进入视口时播放，支持错峰；
  - **滚动进度条** —— `ScrollProgress.astro` 顶部细进度条；
  - **磁吸 / hover 微动效** —— `[data-hover="magnetic"]` 按钮磁吸、卡片 / 图标 hover 反馈；
  - **视差** —— 背景层极轻微视差（`data-parallax-fixed`，位移 = 滚动进度 × 视口高 × 速度系数，有界），速度可在配置中心调节（默认 0.04）；
  - **主题 / 语言过渡** —— View Transitions 平滑过渡。
- **分级与兜底**：
  - 动效强度 `motion.intensity`：`normal`（全部）/ `reduced`（仅保留轻量入场与进度条，禁用磁吸 / 视差）/ `off`（全部禁用），写入 `<html data-motion-intensity>`；
  - 视差开关 `motion.parallax`：关闭时写 `data-parallax="off"`；
  - 全局 `prefers-reduced-motion` 兜底；移动端自动跳过磁吸 / 视差。
- **生命周期**：`BaseLayout.astro` 引入 Astro `ClientRouter` 并在 `astro:page-load` 后调用 `initMotion()`；动态渲染的内容触发 `motion:refresh` 事件重新绑定。

## 站点配置动态化

前台页面在加载时会自动从 `/api/v1/config` 读取站点配置并动态应用：

| 配置项             | 前台应用位置                           |
| ------------------ | -------------------------------------- |
| `site_title`       | 导航栏Logo、页面标题、页脚版权         |
| `site_subtitle`    | 首页Hero区域副标题                     |
| `site_description` | 首页Hero描述、meta description、OG描述 |
| `site_keywords`    | meta keywords                          |
| `about_content`    | `/about` 页面内容                      |

- 页面级 description 优先级高于站点级（不会被覆盖）
- 首页 Hero 区域的默认文案在无配置时显示，有配置后自动替换

## 本地开发

### 前置要求

- Node.js 22+
- npm

### 安装依赖

```bash
npm install
```

### 前端开发

```bash
npm run dev
```

访问 `http://localhost:4321`

> 前端类型门禁：`npm run check`（astro check，含 `.astro`/`.vue`/`.ts`；存在类型错误即非零退出）。入口为 `scripts/run-astro-check.mjs`——Node < 22.12 时自动补 `--experimental-require-module` 旗标（language-server 以 require 拉取 ESM-only 的 astro2tsx，组合钉版说明见脚本头注）。

### 前端单元测试

```bash
npm test
```

根级 vitest（jsdom）覆盖抓取管线：`tests/` 内的 HTML fixture → `src/utils/scrape.ts` 的标题/Markdown、selector 命中/未命中、正文回退、URL/嵌入降级与字符集解码输出。该命令已接入 CI，位于前端类型检查之后、构建之前。

### Worker 后端开发

```bash
cd worker
npm install
npx wrangler dev
```

Worker 本地运行在 `http://localhost:8787`

> 质量门禁：`npm run typecheck`（tsc，含 `tests/`）与 `npm test`（vitest）在 CI 部署前强制执行；CI 最先跑的是两份生成物漂移断言（设置白名单 `npm run gen:settings` issue #27 / ADR 0001、安全头 `npm run gen:headers` issue #28 / ADR 0002，各自重新生成 → git diff 必须为空），随后才是 worker typecheck / worker 测试、前端 check、根级 vitest、构建。

### 初始化数据库

```bash
cd worker
npx wrangler d1 execute blog-db --remote --file=./schema.sql
```

> **注意**：必须使用 `--remote` 标志操作远程数据库，否则只影响本地。

> **已有部署升级**：schema.sql 文件尾部的迁移语句仅供增量执行一次；对已有库请单独执行新增的迁移语句，勿重复执行全文（会因 `duplicate column` 报错）。

### 首次设置

数据库初始化后，默认管理员账户已自动创建（用户名: `admin`，初始口令为 schema.sql 中的种子值）；首次登录响应会返回 `must_change_password: true` 并强制要求改密，未完成改密前除 `POST /auth/refresh`（令牌续期）与 `POST /auth/change-password`（改密）外的写操作均会被拒绝。

JWT 密钥在首次登录时自动生成，无需手动配置。

## 部署

### GitHub Secrets 配置

在 GitHub 仓库的 Settings → Secrets and variables → Actions 中添加：

| Secret                  | 说明                 |
| ----------------------- | -------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare API Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID   |

### Cloudflare 资源

需要提前在 Cloudflare Dashboard 中创建：

1. **D1 数据库** — 名为 `blog-db`
2. **KV 命名空间** — `MEDIA`（媒体存储）+ `EDIT_LOCK`（编辑锁，TTL 30分钟）
3. **Pages 项目** — 名为 `blog-website-page`
4. **Worker** — 名为 `blog-api`

> **注意**：Worker 名称必须为 `blog-api`，不能与 Pages 项目同名，否则 Git 集成自动部署时会覆盖 API Worker。

### 自动部署

> **重要**：请在 Cloudflare Dashboard 中关闭所有 Pages 项目的 Git 自动部署（Settings → Builds & deployments → 关闭 Automatic deployments），统一由 GitHub Actions 管理部署，避免覆盖 API Worker。

推送到 `main` 分支后，GitHub Actions 自动执行：

1. 生成物漂移断言（设置白名单 / 安全头）→ 安装依赖 → Worker 类型检查与测试 → 前端类型检查（`npm run check`）→ 构建 Astro 站点（prebuild 先重新渲染 `public/_headers`（安全头 + HTML 护栏），构建后钩子收紧 CSP 产物）
2. 部署 `dist` 到 Cloudflare Pages（`blog-website-page`）
3. 部署 API Worker 到 Cloudflare Workers（`blog-api`）
4. 等待 120 秒待 Git 集成自动部署落定，再对 Pages 与 Worker 各执行一次覆盖部署——即使 Cloudflare 侧 Git 自动部署未关闭，最终生效的也始终是本次构建产物

### Cloudflare 平台注入护栏

自定义域会在 HTML 上追加 JavaScript Detections 内联脚本与 `Speculation-Rules: "/cdn-cgi/speculation"`（Speed Brain），分别触发 CSP violation 与预取 503。仓库不依赖 Dashboard 关闭这些功能，而由 `scripts/cloudflare-guards.mjs` 单源声明两个响应头：

- `Cache-Control: … no-transform` — 停 JavaScript Detections 注入（代价：HTML 不经边缘 gzip / brotli；`/_assets/*` 等资产不受影响）；
- `Speculation-Rules: "/speculation-rules"` — 以自有空规则集覆盖 Speed Brain（端点 `src/pages/speculation-rules.ts`，MIME 必须为 `application/speculationrules+json`）。

静态 / 预渲染页面由 `public/_headers` 的 HTML 路由块覆盖，SSR 路由由 `src/middleware.ts` 按 `content-type: text/html` 追加；资产不携带这两个头。新增预渲染 HTML 路由需同步 `HTML_ROUTE_PATTERNS`。验证步骤与已知边界（未知路径 404、zone 级响应头改写）见 `docs/security/cloudflare-guards.md`。

### 部署架构

| 项目                | 类型   | URL                              | 说明                            |
| ------------------- | ------ | -------------------------------- | ------------------------------- |
| `blog-website-page` | Pages  | `blog-website-page.pages.dev`    | 前端站点（Astro SSR + 静态）    |
| `blog-api`          | Worker | `blog-api.zen-13467.workers.dev` | API 后端（D1 + KV）             |
| `blog_website`      | Worker | —                                | Git集成自动创建（冗余，不冲突） |

前端通过 Astro API 路由（`/api/v1/*`）代理请求到 `blog-api` Worker。

### 手动部署

```bash
# 前端
npm run build
npx wrangler pages deploy dist --project-name=blog-website-page

# 后端
cd worker
npx wrangler deploy
```

## 自定义域名

- **前端（Pages）** — 在 Cloudflare Pages 项目设置中绑定自定义域名，例如本项目的 `blog.zenfishlog.dpdns.org`。
- **API Worker** — 前端通过 Astro API 路由（`/api/v1/*`）同源代理到 `blog-api` Worker，因此**无需**为 Worker 单独配置自定义域名或路由；自定义域名仅作用于 Pages 即可覆盖全站访问。

## 多语言 (i18n)

支持中文/英文切换，基于自定义轻量 i18n 方案：

- **翻译文件** — `src/i18n/zh.json` / `src/i18n/en.json`
- **工具模块** — `src/utils/i18n.ts`（`initLocale`, `setLocale`, `getLocale`, `t` 函数）
- **语言检测** — 优先读取 `localStorage` 中的 `locale`，其次根据浏览器语言自动选择
- **切换方式** — 导航栏地球图标按钮，切换后所有页面内容实时更新
- **前台页面** — 使用 `data-i18n` 属性标记静态文本，JS 动态内容使用 `t()` 函数
- **后台管理** — Vue 组件中直接调用 `t()` 函数

## 主题

支持亮色/暗色主题切换，设计令牌定义在 `src/styles/variables.css` 中：

- **亮色** — 白色背景 + 安知鱼蓝 (#49b1f5) 强调色
- **暗色** — 深色背景 + 亮蓝 (#7cb8f0) 强调色
- **字体** — Inter (正文) + JetBrains Mono (代码)
- **风格** — Apple式毛玻璃导航栏 + 卡片化布局；文章卡片「有封面图 → 上图下文、无封面 → 分类专属色渐变横幅」，分类徽标按分类着色（参考 hexo-theme-anzhiyu 视觉风格融合）
- **可配置** — 上述配色（accent / 背景 / 文字 / 边框等）现已可在后台「外观与个性化 → 配色」中可视化调整，日 / 夜分别配置，保存后实时生效，详见 [可视化配置中心](#可视化配置中心)。

## License

MIT
