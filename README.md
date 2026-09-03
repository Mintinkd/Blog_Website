# Blog Website

基于 Astro + Cloudflare 技术栈的个人独立博客系统，前后端分离架构，部署在 Cloudflare Pages + Workers 上。

## 技术栈

### 前端
- **Astro v5** — SSG/SSR 混合渲染（静态页面 + SSR 动态路由）
- **Vue 3** — 岛屿架构交互组件（搜索、评论、点赞等）
- **Element Plus** — 后台管理UI组件库
- **marked + highlight.js + DOMPurify** — Markdown渲染与代码高亮

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
│   │       ├── BaseLayout.astro  # 全局布局（毛玻璃导航栏）
│   │       └── Sidebar.astro
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
│   │   ├── categories/[slug].astro  # 分类（SSR）
│   │   ├── tags/[slug].astro        # 标签（SSR）
│   │   ├── api/v1/[...path].ts      # API代理路由（SSR）
│   │   ├── rss.xml.ts               # RSS订阅源（SSR）
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
│   ├── utils/
│       ├── api.ts               # API请求工具
│       ├── markdown.ts          # Markdown渲染
│       ├── theme.ts             # 主题切换
│       ├── siteConfig.ts        # 站点基础配置读取与应用
│       ├── settings.ts          # 全站可视化配置（读取/注入CSS变量/功能开关/跨标签页同步）
│       ├── motion.ts            # 动效初始化（reveal/磁吸/视差/滚动进度条/View Transition）
│       └── i18n.ts              # 多语言工具（initLocale, setLocale, t函数）
├── worker/                      # Cloudflare Worker 后端
│   ├── wrangler.toml            # Worker配置（旧版，已弃用）
│   ├── wrangler.jsonc            # Worker配置（D1/KV绑定，实际生效）
│   ├── schema.sql               # 数据库Schema
│   └── src/
│       ├── index.ts             # Worker入口
│       ├── router.ts            # 路由注册与分发
│       ├── middleware/
│       │   ├── auth.ts          # JWT认证
│       │   ├── cors.ts          # 跨域
│       │   └── rate_limit.ts    # 限流
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
├── wrangler.jsonc                # 根目录Workers+Assets部署配置
├── tsconfig.json
├── .node-version
├── .npmrc
└── docs/                         # 设计与功能文档
    ├── UI_MOTION_UPGRADE.md     # UI 动效升级方案
    ├── BACKGROUND_IMAGE.md      # 全站背景图说明
    └── SITE_SETTINGS.md         # 可视化配置中心说明
```

## 数据库设计

D1 (SQLite) 共 9 张表：

| 表名 | 说明 |
|------|------|
| `users` | 用户账户（管理员/编辑者，SHA-256密码哈希，角色权限） |
| `categories` | 文章分类（含 created_by 所有权） |
| `tags` | 标签（含 created_by 所有权） |
| `articles` | 文章（含Markdown原文和HTML渲染结果，author_id作者，category_id默认1） |
| `article_tags` | 文章-标签多对多关联 |
| `comments` | 评论（含审核状态） |
| `article_likes` | 点赞记录（IP去重） |
| `media_assets` | 媒体文件元数据（含 uploaded_by 所有权） |
| `friend_links` | 友情链接 |
| `site_config` | 站点配置（KV结构，含JWT密钥） |

另含 FTS5 全文搜索虚拟表 `articles_fts` 及同步触发器。

## API 接口

所有接口前缀 `/api/v1`，前端通过 Astro API 路由代理到 Worker。

### 公开接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/auth/login` | 登录（返回JWT token和用户信息） |
| GET | `/articles` | 文章列表（支持分页、分类、标签过滤、status=all） |
| GET | `/articles/:slug` | 文章详情 |
| GET | `/categories` | 分类列表 |
| GET | `/tags` | 标签列表 |
| GET | `/articles/:article_id/comments` | 文章评论 |
| POST | `/articles/:article_id/comments` | 提交评论 |
| GET | `/search` | 全文搜索 |
| POST | `/articles/:article_id/like` | 点赞/取消 |
| GET | `/articles/:article_id/like-status` | 点赞状态 |
| GET | `/articles/:article_id/view` | 增加阅读量（Cookie去重，24小时TTL） |
| GET | `/media/serve/*` | 媒体文件访问 |
| GET | `/friend-links` | 友情链接 |
| GET | `/config` | 公开站点配置 |
| GET | `/settings` | 公开可视化配置（前台运行时套用） |

### 需认证接口（需 `Authorization: Bearer <token>` 请求头）

#### 通用接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/refresh` | 刷新Token |
| POST | `/articles` | 创建文章（自动设置author_id） |
| PUT | `/articles/:id` | 更新文章（editor仅自己的） |
| DELETE | `/articles/:id` | 删除文章（editor仅自己的） |
| POST | `/categories` | 创建分类（自动设置created_by） |
| PUT | `/categories/:id` | 更新分类（editor仅自己的） |
| POST | `/tags` | 创建标签（自动设置created_by） |
| GET | `/comments` | 评论列表（editor仅自己文章的） |
| PUT | `/comments/:id/approve` | 审核通过 |
| PUT | `/comments/:id/reject` | 审核拒绝 |
| DELETE | `/comments/:id` | 删除评论 |
| POST | `/media/upload` | 上传媒体（自动设置uploaded_by） |
| GET | `/media` | 媒体列表（editor仅自己的） |
| DELETE | `/media/:id` | 删除媒体 |

#### 编辑锁接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/articles/:id/lock` | 获取编辑锁（30分钟TTL） |
| DELETE | `/articles/:id/lock` | 释放编辑锁 |
| GET | `/articles/:id/lock` | 查询编辑锁状态 |
| POST | `/articles/:id/lock/force` | 强制接管编辑锁（admin） |

#### 管理员专属接口（需 admin 角色）

| 方法 | 路径 | 说明 |
|------|------|------|
| DELETE | `/categories/:id` | 删除分类 |
| DELETE | `/tags/:id` | 删除标签 |
| GET | `/users` | 用户列表 |
| POST | `/users` | 创建用户 |
| PUT | `/users/:id` | 更新用户（密码、显示名、角色） |
| DELETE | `/users/:id` | 删除用户（至少保留一个admin） |
| GET | `/config/all` | 全部配置 |
| PUT | `/config` | 更新配置 |
| GET | `/friend-links/all` | 全部友链 |
| POST | `/friend-links` | 创建友链 |
| PUT | `/friend-links/:id` | 更新友链 |
| DELETE | `/friend-links/:id` | 删除友链 |
| GET | `/admin/export` | 导出数据 |
| POST | `/admin/import` | 导入数据 |
| GET | `/settings/all` | 拉取全部可视化配置 |
| PUT | `/settings` | 更新可视化配置（配色 / 布局 / 背景 / 功能 / 文案 / 动效） |
| POST | `/settings/reset` | 恢复默认可视化配置 |
| GET | `/settings/export` | 导出配置 JSON |
| POST | `/settings/import` | 导入配置 JSON |

## 前台页面

| 路径 | 说明 | 渲染模式 |
|------|------|----------|
| `/` | 首页（Hero + 最新文章卡片网格） | 静态 |
| `/articles` | 文章列表（分页） | 静态 |
| `/articles/:slug` | 文章详情（Markdown渲染） | SSR |
| `/categories/:slug` | 分类文章 | SSR |
| `/tags/:slug` | 标签文章 | SSR |
| `/api/v1/*` | API代理到Worker | SSR |
| `/rss.xml` | RSS订阅源 | SSR |
| `/archives` | 时间线归档 | 静态 |
| `/about` | 关于页面 | 静态 |
| `/search` | 搜索页 | 静态 |
| `/admin` | 后台管理 | 静态 |

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
- **关于页面** — Markdown编辑，保存后前台实时更新（仅admin）
- **友情链接** — 增删改（仅admin）
- **站点配置** — 标题、副标题、描述、关键词等（仅admin）
- **外观与个性化** — 可视化配置中心（仅admin）：配色（日/夜 accent、背景、文字、边框）、布局（内容宽度/导航高度/圆角）、全站背景图与遮罩浓度、功能开关（评论/点赞/友链/搜索/RSS/暗色/双语）、文案覆盖（中/英）、动效强度与视差开关；支持导出 / 导入 / 一键恢复默认
- **账户管理** — 多用户支持（admin/editor角色），增删改，密码修改，自我降级保护（仅admin）

## 视觉与体验增强

> 以下三项能力均通过「可视化配置中心」在 `/admin` 后台实时调整，无需重新部署。详细设计见 `docs/` 目录：`BACKGROUND_IMAGE.md`、`SITE_SETTINGS.md`、`UI_MOTION_UPGRADE.md`。

### 全站背景图

全站所有页面共享一张铺满视口的固定背景层，响应式适配桌面 / 平板 / 手机及横竖屏，不变形、不遮挡文字。

- **实现**：`BaseLayout.astro` 注入 `<div class="site-bg">` 固定层（`position: fixed; inset: -10% 0; z-index: -1`）；背景图与遮罩色由 CSS 变量 `--bg-image` / `--bg-overlay` / `--bg-position` 控制（`variables.css` 中日 / 夜各一份）。
- **默认图**：`public/bg-placeholder.svg`，可在配置中心替换为自定义图片 URL。
- **文字对比度**：遮罩按主题背景色 + 配置的浓度（`bgOpacity`，默认 0.85）自动生成渐变，保证前景文字清晰。
- **主题 / 语言切换**：通过 View Transitions（`startViewTransition`）做平滑过渡，背景层同步切换。

### 可视化配置中心

所有个性化设置（配色 / 布局 / 背景 / 功能开关 / 文案 / 动效）统一存为 `site_config` 表中的 JSON blob（key = `site_settings`），由后台「外观与个性化」面板可视化编辑，前后端实时生效。

- **后端**：`worker/src/handlers/settings.ts` —— 读取时与 `DEFAULT_SETTINGS` 深度合并（缺失字段自动补默认、未知字段被过滤，防注入）；提供公开读取 + admin 写 / 导出 / 导入 / 恢复默认接口。
- **前端注入器**：`src/utils/settings.ts` 的 `applySettings()` 把配置转成可直接生效的视觉与行为：
  1. **配色 / 布局 / 背景** → 注入 CSS 变量覆盖 `variables.css` 默认值（`!important` 保证生效），按 `[data-theme="light"/"dark"]` 分写，日 / 夜切换照常生效；
  2. **功能开关** → 在 `<html>` 写 `data-feature-<name>="off"`，配合 `[data-feature]` 钩子隐藏对应模块（评论 / 点赞 / 友链 / 搜索 / RSS / 暗色 / 双语）；
  3. **文案覆盖** → 写入 i18n 覆盖层并按当前 locale 刷新 `[data-i18n]` 文本，中 / 英切换照常生效；
  4. **动效** → 写 `data-motion-intensity` 与 `data-parallax` 及 `--parallax-speed`。
- **配置项**（见 `SiteSettings` 接口）：`theme`（light/dark 各 10 项配色）、`layout`（内容宽度 / 导航高度 / 三档圆角）、`background`（图片 URL / 遮罩浓度）、`features`（7 个开关）、`copy`（中 / 英文案覆盖）、`motion`（强度 / 视差开关 / 视差速度）。
- **同步**：`initSettings()` 在页面加载时拉取并套用；保存后通过 `storage` 事件 + `settings-updated` 事件跨标签页实时刷新。
- **数据安全**：这些设置不含任何密钥，`/settings` 作为公开接口供前台拉取；写 / 导出 / 导入 / 恢复均为 admin 专属。

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

| 配置项 | 前台应用位置 |
|--------|-------------|
| `site_title` | 导航栏Logo、页面标题、页脚版权 |
| `site_subtitle` | 首页Hero区域副标题 |
| `site_description` | 首页Hero描述、meta description、OG描述 |
| `site_keywords` | meta keywords |
| `about_content` | `/about` 页面内容 |

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

### Worker 后端开发

```bash
cd worker
npm install
npx wrangler dev
```

Worker 本地运行在 `http://localhost:8787`

### 初始化数据库

```bash
cd worker
npx wrangler d1 execute blog-db --remote --file=./schema.sql
```

> **注意**：必须使用 `--remote` 标志操作远程数据库，否则只影响本地。

### 首次设置

数据库初始化后，默认管理员账户已自动创建（用户名: `admin`，密码: `changeme`），**请首次登录后立即修改密码**。

JWT 密钥在首次登录时自动生成，无需手动配置。

## 部署

### GitHub Secrets 配置

在 GitHub 仓库的 Settings → Secrets and variables → Actions 中添加：

| Secret | 说明 |
|--------|------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |

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

1. 安装依赖 → 构建Astro站点
2. 部署 `dist` 到 Cloudflare Pages（`blog-website-page`）
3. 部署 API Worker 到 Cloudflare Workers（`blog-api`）

### 部署架构

| 项目 | 类型 | URL | 说明 |
|------|------|-----|------|
| `blog-website-page` | Pages | `blog-website-page.pages.dev` | 前端站点（Astro SSR + 静态） |
| `blog-api` | Worker | `blog-api.zen-13467.workers.dev` | API 后端（D1 + KV） |
| `blog_website` | Worker | — | Git集成自动创建（冗余，不冲突） |

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

- **亮色** — 白色背景 + indigo (#6366f1) 强调色
- **暗色** — 深色背景 + 浅紫 (#818cf8) 强调色
- **字体** — Inter (正文) + JetBrains Mono (代码)
- **风格** — Apple式毛玻璃导航栏 + 卡片化布局
- **可配置** — 上述配色（accent / 背景 / 文字 / 边框等）现已可在后台「外观与个性化 → 配色」中可视化调整，日 / 夜分别配置，保存后实时生效，详见 [可视化配置中心](#可视化配置中心)。

## License

MIT