# Blog Website

基于 Astro + Cloudflare 技术栈的个人独立博客系统，前后端分离架构，部署在 Cloudflare Pages + Workers 上。

## 技术栈

### 前端
- **Astro v5** — 静态网站生成器，输出纯静态HTML
- **Vue 3** — 岛屿架构交互组件（搜索、评论、点赞等）
- **Element Plus** — 后台管理UI组件库
- **marked + highlight.js + DOMPurify** — Markdown渲染与代码高亮

### 后端
- **Cloudflare Workers** — 无服务器API后端
- **Cloudflare D1** — SQLite数据库（文章、分类、标签、评论等）
- **Cloudflare KV** — 键值存储（媒体文件临时方案）
- **JWT** — 管理员认证

### 部署
- **Cloudflare Pages** — 前端静态托管
- **GitHub Actions** — CI/CD 自动部署

## 项目结构

```
├── .github/workflows/
│   └── deploy.yml              # CI/CD 自动部署
├── functions/
│   └── api/v1/[[path]].ts      # Pages Functions API代理 → Worker
├── public/
│   ├── _routes.json            # Pages路由规则
│   └── robots.txt
├── src/
│   ├── admin/
│   │   └── App.vue             # 后台管理SPA（Vue 3 + Element Plus）
│   ├── components/
│   │   ├── article/
│   │   │   └── ArticleCard.astro
│   │   ├── common/
│   │   │   ├── Pagination.astro
│   │   │   └── EmptyState.astro
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
│   │   │   └── [slug].astro     # 文章详情
│   │   ├── categories/[slug].astro
│   │   ├── tags/[slug].astro
│   │   ├── archives.astro       # 归档
│   │   ├── about.astro          # 关于
│   │   ├── search.astro         # 搜索
│   │   ├── admin/index.astro    # 后台管理入口
│   │   └── 404.astro
│   ├── i18n/                     # 多语言翻译
│   │   ├── zh.json               # 中文
│   │   └── en.json               # 英文
│   ├── styles/
│   │   ├── variables.css        # 设计令牌（颜色、字体、阴影等）
│   │   ├── global.css           # 全局样式
│   │   └── prose.css            # 文章排版样式
│   └── utils/
│       ├── api.ts               # API请求工具
│       ├── markdown.ts          # Markdown渲染
│       ├── theme.ts             # 主题切换
│       ├── siteConfig.ts        # 站点配置读取与应用
│       └── i18n.ts              # 多语言工具（initLocale, setLocale, t函数）
├── worker/                      # Cloudflare Worker 后端
│   ├── wrangler.toml            # Worker配置（D1/KV绑定）
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
│       │   ├── friend_link.ts
│       │   ├── auth_handler.ts
│       │   └── admin.ts
│       ├── services/
│       │   └── article_service.ts
│       ├── models/              # 数据模型
│       └── utils/               # 工具函数
├── astro.config.mjs
├── package.json
├── tsconfig.json
├── .node-version
└── .npmrc
```

## 数据库设计

D1 (SQLite) 共 9 张表：

| 表名 | 说明 |
|------|------|
| `users` | 用户账户（管理员/编辑者，SHA-256密码哈希） |
| `categories` | 文章分类 |
| `tags` | 标签 |
| `articles` | 文章（含Markdown原文和HTML渲染结果） |
| `article_tags` | 文章-标签多对多关联 |
| `comments` | 评论（含审核状态） |
| `article_likes` | 点赞记录（IP去重） |
| `media_assets` | 媒体文件元数据 |
| `friend_links` | 友情链接 |
| `site_config` | 站点配置（KV结构，含JWT密钥） |

另含 FTS5 全文搜索虚拟表 `articles_fts` 及同步触发器。

## API 接口

所有接口前缀 `/api/v1`，通过 Pages Functions 代理到 Worker。

### 公开接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/auth/login` | 登录（返回JWT token和用户信息） |
| GET | `/articles` | 文章列表（支持分页、分类、标签过滤） |
| GET | `/articles/:slug` | 文章详情 |
| GET | `/categories` | 分类列表 |
| GET | `/tags` | 标签列表 |
| GET | `/articles/:article_id/comments` | 文章评论 |
| POST | `/articles/:article_id/comments` | 提交评论 |
| GET | `/search` | 全文搜索 |
| POST | `/articles/:article_id/like` | 点赞/取消 |
| GET | `/articles/:article_id/like-status` | 点赞状态 |
| GET | `/friend-links` | 友情链接 |
| GET | `/config` | 公开站点配置 |

### 需认证接口（需 `Authorization: Bearer <token>` 请求头）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/articles` | 创建文章 |
| PUT | `/articles/:id` | 更新文章 |
| DELETE | `/articles/:id` | 删除文章 |
| POST | `/categories` | 创建分类 |
| PUT | `/categories/:id` | 更新分类 |
| DELETE | `/categories/:id` | 删除分类 |
| POST | `/tags` | 创建标签 |
| DELETE | `/tags/:id` | 删除标签 |
| GET | `/comments` | 所有评论（管理） |
| PUT | `/comments/:id/approve` | 审核通过 |
| PUT | `/comments/:id/reject` | 审核拒绝 |
| DELETE | `/comments/:id` | 删除评论 |
| POST | `/media/upload` | 上传媒体 |
| GET | `/media` | 媒体列表 |
| DELETE | `/media/:id` | 删除媒体 |
| GET | `/users` | 用户列表 |
| POST | `/users` | 创建用户 |
| PUT | `/users/:id` | 更新用户（密码、显示名、角色） |
| DELETE | `/users/:id` | 删除用户（至少保留一个） |
| GET | `/config/all` | 全部配置 |
| PUT | `/config` | 更新配置 |
| GET | `/friend-links/all` | 全部友链 |
| POST | `/friend-links` | 创建友链 |
| PUT | `/friend-links/:id` | 更新友链 |
| DELETE | `/friend-links/:id` | 删除友链 |
| GET | `/admin/export` | 导出数据 |
| POST | `/admin/import` | 导入数据 |

## 前台页面

| 路径 | 说明 |
|------|------|
| `/` | 首页（Hero + 最新文章卡片网格） |
| `/articles` | 文章列表（分页） |
| `/articles/:slug` | 文章详情（Markdown渲染） |
| `/categories/:slug` | 分类文章 |
| `/tags/:slug` | 标签文章 |
| `/archives` | 时间线归档 |
| `/about` | 关于页面 |
| `/search` | 搜索页 |
| `/admin` | 后台管理 |

## 后台管理

访问 `/admin` 进入管理后台，功能包括：

- **登录认证** — JWT Token，存储在 localStorage，登录返回用户信息
- **文章管理** — 新建/编辑/删除，Markdown编辑器，支持草稿和已发布状态，Slug支持中文
- **分类管理** — 增删改
- **标签管理** — 增删
- **关于页面** — Markdown编辑关于页内容，保存后前台 `/about` 页面实时更新
- **站点配置** — 标题、副标题、描述、关键词等
- **账户管理** — 多用户支持（管理员/编辑者角色），增删改，密码修改

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

数据库初始化后，需要配置 JWT 密钥。默认管理员账户已自动创建（用户名: `admin`，密码: `changeme`），**请首次登录后立即修改密码**。

```bash
# 设置JWT密钥（自行生成一个随机字符串）
npx wrangler d1 execute blog-db --remote --command="UPDATE site_config SET value='你的随机密钥' WHERE key='jwt_secret'"
```

> 旧版使用 `site_config` 中的 `admin_username` / `admin_password_hash` 已废弃，新版使用 `users` 表管理账户。

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
2. **KV 命名空间** — 用于媒体存储
3. **Pages 项目** — 名为 `blog-website-page`
4. **Worker** — 名为 `blog_website`

### 自动部署

推送到 `main` 分支后，GitHub Actions 自动执行：

1. 安装依赖 → 构建Astro站点
2. 部署 `dist` 到 Cloudflare Pages
3. 部署 Worker 到 Cloudflare Workers

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

在 Cloudflare Pages 项目设置中绑定自定义域名，Worker 同样需要在 Workers 设置中添加自定义域名或路由。

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

## License

MIT