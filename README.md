# Blog Website 部署指南

从零部署本网站到 Cloudflare（Pages 前端 + Worker 后端），直到站点可正常访问。项目介绍、API、开发与功能说明见文末「相关文档」。

## 一、环境要求

| 项目            | 要求                                                                      |
| --------------- | ------------------------------------------------------------------------- |
| Node.js         | 22.12+（wrangler 4 要求）                                                 |
| npm             | 随 Node.js 安装                                                           |
| Cloudflare 账户 | 需开通 Pages、Workers、D1、KV、R2                                         |
| API Token 权限  | Pages:Edit + Workers Scripts:Edit + D1:Edit + R2:Edit（与部署、迁移共用） |
| GitHub 仓库     | 自动部署必需（GitHub Actions）；手动部署可不需要                          |

## 二、前置依赖检查

按顺序完成以下 6 项，全部通过后再部署。

### 2.1 创建 Cloudflare 资源

在 Cloudflare Dashboard 创建：

| 资源        | 名称/标识                            | 说明                                                      |
| ----------- | ------------------------------------ | --------------------------------------------------------- |
| D1 数据库   | `blog-db`                            | 文章、分类、标签、评论、配置、统计                        |
| KV 命名空间 | `MEDIA` / `EDIT_LOCK` / `RATE_LIMIT` | 存量媒体读取 + 编辑锁（TTL 30 分钟）+ 限流计数            |
| R2 桶       | `blog-media`                         | 新上传媒体；CI 在 `Ensure R2 bucket` 步骤幂等创建         |
| Pages 项目  | `blog-website`                       | 默认子域 `blog-website-page.pages.dev`                    |
| Worker      | `blog-api`                           | **不可与 Pages 项目同名**，否则 Git 集成会覆盖 API Worker |

**预期结果**：`npx wrangler d1 list`、`npx wrangler kv namespace list`、`npx wrangler r2 bucket list` 能列出上述资源。

### 2.2 配置 GitHub Actions（Secrets / Variables）

在 GitHub 仓库 Settings → Secrets and variables → Actions 中配置。**Variables 均有默认值，可留空**；改域名/资源标识只需改变量，无需改代码。

**Secrets（敏感）**

| Secret                  | 说明                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare API Token（Pages + Workers + D1 编辑 + R2 编辑；zone 级 CORS 清理脚本另需 `Zone:Read` + `Transform Rules:Edit`，非部署门禁必需） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID                                                                                                                          |
| `R2_ACCESS_KEY_ID`      | 可选。R2 S3 兼容 Access Key（供迁移脚本 / 外部工具）                                                                                        |
| `R2_SECRET_ACCESS_KEY`  | 可选。R2 S3 兼容 Secret Key，与上项成对                                                                                                     |

**Variables（非敏感，可留空用默认值）**

| Variable              | 默认值                                   | 说明                                              |
| --------------------- | ---------------------------------------- | ------------------------------------------------- |
| `SITE_URL`            | `https://blog.zenfishlog.dpdns.org`      | 站点 origin，驱动 Astro `site` / robots / sitemap |
| `WORKER_ORIGIN`       | `https://blog-api.zen-13467.workers.dev` | API Worker origin                                 |
| `SITEMAP_API_BASE`    | 空（= `SITE_URL + /api/v1/articles`）    | sitemap 拉取文章列表的覆盖地址                    |
| `SITEMAP_PAGE_SIZE`   | `50`                                     | sitemap 分页大小（非法值构建失败）                |
| `PAGES_PROJECT_NAME`  | `blog-website`                           | Pages 项目名                                      |
| `WORKER_NAME`         | `blog-api`                               | Worker 名称                                       |
| `D1_DATABASE_ID`      | `5c759ce7-82e0-4205-8d01-fea18db55cd7`   | D1 数据库 UUID                                    |
| `D1_DATABASE_NAME`    | `blog-db`                                | D1 数据库名                                       |
| `KV_MEDIA_ID`         | `c4f354b6c61e43e798a679fb6733edd8`       | MEDIA KV 命名空间 id                              |
| `KV_EDIT_LOCK_ID`     | `8a63eee2d516410d8e6e5ec7d420a0b1`       | EDIT_LOCK KV 命名空间 id                          |
| `KV_RATE_LIMIT_ID`    | `e18fbfafedf048a380e6fe4e2a6f96d6`       | RATE_LIMIT KV 命名空间 id                         |
| `R2_BUCKET_NAME`      | `blog-media`                             | R2 媒体桶名                                       |
| `R2_REGION`           | `auto`                                   | R2 区域                                           |
| `R2_ENDPOINT`         | 空                                       | R2 S3 兼容端点覆盖                                |
| `R2_ACCOUNT_ID`       | 空（回退 `CLOUDFLARE_ACCOUNT_ID`）       | R2 S3 端点账户 ID                                 |
| `DEPLOY_BASE_URL`     | `https://blog-website-page.pages.dev`    | 就绪探针基地址（打生产别名，**不打自定义域**）    |
| `DEPLOY_TIMEOUT_SEC`  | `180`                                    | 就绪轮询超时（秒）                                |
| `DEPLOY_INTERVAL_SEC` | `5`                                      | 就绪轮询间隔（秒）                                |
| `NODE_VERSION`        | `22`                                     | CI Node 版本                                      |
| `PLAYWRIGHT_VERSION`  | `1.64.1`                                 | CI 临时安装的 Playwright 版本                     |

> 非法 D1 / KV / R2 / `SITE_URL` 值会让 `scripts/render-worker-config.mjs` 直接失败（fail-closed）。迁移到新域名时，除改 `SITE_URL` 外还须把新 origin 加进 `cors.origins.json` 并重跑 `npm run gen:cors`，否则浏览器跨域直连 Worker 的请求会被拒绝。

**预期结果**：CI 能用这些值渲染出 `worker/wrangler.deploy.jsonc`（生成物，不入 git），且绑定指向正确资源。

### 2.3 配置必填服务端密钥

两项都是生产必配，缺任一项相关功能 fail-closed 或精度下降。

```bash
# ① 访客 IP 签名密钥：点赞/评论去重、代理限流、阅读统计依赖
# Worker 侧（验签）
cd worker && npx wrangler secret put VISITOR_IP_SIGNING_SECRET
# Pages 侧（签名）：Cloudflare Dashboard → Pages 项目 blog-website → Settings → Environment variables
# 新增 Secret 变量 VISITOR_IP_SIGNING_SECRET（Production + Preview 都加），值与 Worker 侧相同

# ② IP 哈希盐：点赞去重与评论溯源的 ip_hash 计算
# Worker 侧（只需 Worker，Pages 侧不需要）
cd worker && npx wrangler secret put IP_HASH_SECRET
```

**预期结果**：`npx wrangler secret list`（在 `worker/` 下）能看到 `VISITOR_IP_SIGNING_SECRET` 与 `IP_HASH_SECRET`；Pages 环境变量页能看到同名 Secret。缺 `IP_HASH_SECRET` 时 `POST /articles/:id/like`、`GET /articles/:id/like-status`、`POST /articles/:id/comments` 一律 500。

### 2.4 关闭两条并行部署通道

**两条都必须断开**，否则每次 push 多出一条不受门禁约束的部署，线上版本取决于谁后完成。

| 通道               | 关闭位置                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Pages Git 自动部署 | Dashboard → Pages 项目 `blog-website` → Settings → Builds & deployments → 关闭 Automatic deployments               |
| Workers Build 目标 | Dashboard → Workers & Pages → Worker `blog_website`（根 `wrangler.jsonc`）→ Settings → Build → Disconnect Git 连接 |

**预期结果**：`npx wrangler pages project list` 显示项目存在且无 Automatic deployments 条目；Worker `blog_website` 的 Git 连接显示 Disconnected。仓库侧无法验证 Dashboard 状态，须人工核查（见第四节）。

### 2.5 初始化数据库（仅首次部署）

```bash
cd worker
npx wrangler d1 execute blog-db --remote --file=./schema.sql
npx wrangler d1 execute blog-db --remote --file=./migrations-baseline.sql   # 把历史迁移标记为已应用
npm run db:seed          # 生成随机初始管理员口令（仅终端打印一次，首次登录强制改密）
```

- 必须使用 `--remote` 操作远程库，否则只影响本地。
- `schema.sql` 可重复执行；存量库不要执行 `migrations/0001_baseline.sql`（会 duplicate column），用 `migrations-baseline.sql` 标记即可。
- `npm run db:seed` 用 `randomUUID()` 生成随机口令、以 PBKDF2 哈希 UPSERT 写入 `admin` 账户，终端**仅打印一次**明文，请立即保存。

**预期结果**：`npx wrangler d1 migrations list blog-db --remote`（在 `worker/` 下）显示「No migrations to apply」；用 seed 打印的口令可登录 `/admin`，并强制跳转到改密。

> **已有库升级**：新增结构变更写成 `worker/migrations/0002_*.sql` 后用 `wrangler d1 migrations apply` 应用，切勿把全量 `schema.sql` 当迁移跑。存量库的一次性列/索引增量（Tier0、M22、taxonomy v2）与迁移前置备份步骤见 `docs/LOCAL_DEVELOPMENT.md`。

> **数据库迁移由 CI 自动执行**：每次 push 在全部门禁通过后、部署前，依次重放幂等增量 DDL（`schema-tier0-incremental.sql` / `schema-m22-incremental.sql`）与 `scripts/migrate-reading-time.mjs`，再由 `scripts/verify-d1-migrations.mjs` 核对 3 表 + 5 索引确实存在；`CLOUDFLARE_API_TOKEN` 须具备目标 D1 的**编辑权限**。CI 不执行 `scripts/remove-edge-cors.mjs`（zone 级 CORS 清理为手动项）。手动应急命令见 `docs/LOCAL_DEVELOPMENT.md`。

### 2.6 绑定自定义域名（可选）

在 Cloudflare Pages 项目设置中绑定自定义域（如 `blog.zenfishlog.dpdns.org`）。API Worker 无需单独配置域名：浏览器经 Astro 同源代理（`/api/v1/*`）访问，文章 SSR 与 RSS 服务端直连 Worker origin。

**预期结果**：自定义域能打开首页，且 `/api/v1/health` 返回 200。

## 三、分步部署操作

### 3.1 方式 A：GitHub Actions 自动部署（推荐）

**执行**：确认 2.1–2.5 全部完成后，推送到 `main`。

```bash
git push origin main
```

CI（`.github/workflows/deploy.yml`）按顺序执行以下步骤，任一步失败即阻断后续：

| #   | 步骤                                       | 执行命令 / 配置项                                                                                                                  | 预期结果                            |
| --- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1   | 检出代码                                   | `actions/checkout@v7`                                                                                                              | 源码就绪                            |
| 2   | 配置 Node.js                               | `actions/setup-node@v7`，版本取 `NODE_VERSION`（默认 22）                                                                          | Node 环境就绪                       |
| 3   | 检查设置规则漂移                           | `npm run gen:settings` + `git diff --exit-code`（生成物两处）                                                                      | diff 为空                           |
| 4   | 检查安全响应头漂移                         | `npm run gen:headers` + `git diff --exit-code -- public/_headers`                                                                  | diff 为空                           |
| 5   | 检查 CORS 来源漂移                         | `npm run gen:cors` + `git diff --exit-code`（Worker/Pages 两处）                                                                   | diff 为空                           |
| 6   | 检查富文本策略漂移                         | `npm run gen:rich-text` + `git diff --exit-code`                                                                                   | diff 为空                           |
| 7   | 安装根包依赖                               | `npm ci`（根目录）                                                                                                                 | 依赖就绪                            |
| 8   | 安装 Worker 依赖                           | `npm ci`（`worker/`）                                                                                                              | 依赖就绪                            |
| 9   | Worker 类型检查                            | `npm run typecheck`（`worker/`）                                                                                                   | 全绿                                |
| 10  | 测试 Worker                                | `npm run test`（`worker/`）                                                                                                        | 全绿                                |
| 11  | 前端类型检查                               | `npm run check`（根目录）                                                                                                          | 全绿                                |
| 12  | 代码静态检查                               | `npm run lint`（根目录）                                                                                                           | 全绿                                |
| 13  | 测试前端                                   | `npm test`（根目录）                                                                                                               | 全绿                                |
| 14  | 安装 Playwright Chromium                   | `npm install --no-save playwright@${PLAYWRIGHT_VERSION}` + `npx playwright install --with-deps chromium`                           | 浏览器就绪                          |
| 15  | 文章 SSR + 编辑器 + 后台回归（Playwright） | 拉起 `astro dev :4321` 与 mock `:4322`，跑 5 个 `verify-*.mjs`（文章 SSR / 编辑器端到端 / 编辑器响应式 / 后台移动端 / 观感友好度） | 全绿                                |
| 16  | 构建 Astro 站点                            | `npm run build`（prebuild 生成 `public/_headers`，构建后收紧 CSP）                                                                 | `dist/` 产物生成                    |
| 17  | 渲染 Worker 部署配置                       | `node scripts/render-worker-config.mjs`                                                                                            | 生成 `worker/wrangler.deploy.jsonc` |
| 18  | 执行 D1 迁移                               | `wrangler d1 execute ... --config=wrangler.deploy.jsonc --file=./schema-tier0-incremental.sql`（及 M22、reading-time）             | 迁移成功，不报 duplicate column     |
| 19  | 校验 D1 迁移                               | `node scripts/verify-d1-migrations.mjs`                                                                                            | 3 表 + 5 索引齐全                   |
| 20  | 部署到 Cloudflare Pages                    | `wrangler pages deploy dist --project-name=blog-website`                                                                           | 部署成功                            |
| 21  | 确保 R2 存储桶存在                         | `wrangler r2 bucket create "$R2_BUCKET_NAME"`（已存在视为成功）                                                                    | 桶存在                              |
| 22  | 部署 Worker                                | `wrangler deploy --config=wrangler.deploy.jsonc`（`worker/`）                                                                      | 部署成功                            |
| 23  | 同步 R2 凭据到 Worker                      | 配置 `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` 时同步为 Worker secret                                                            | secret 写入成功                     |
| 24  | 等待部署就绪                               | `node scripts/wait-for-deploy.mjs`                                                                                                 | 探针就绪，退出码 0（详见第四节）    |

> **L8 已清理**：旧的「sleep 120 + 二次覆盖部署」已删除，改为上表的轮询就绪检查。双通道须在 Dashboard 断开（见 2.4），由 Actions 单点管理。

### 3.2 方式 B：手动部署

**执行**（在仓库根目录）：

```bash
# 前端
npm run build
npx wrangler pages deploy dist --project-name=blog-website

# 后端（本地默认资源标识）
cd worker
npx wrangler deploy

# 后端（按 Variables / 环境变量渲染 CI 同款配置）
node scripts/render-worker-config.mjs
cd worker && npx wrangler deploy --config=wrangler.deploy.jsonc
```

**配置项说明**：

- Worker 部署**必须在 `worker/` 目录下执行**。根目录 `npx wrangler deploy` 消费的是前端 Workers Build 配置（缺 D1/KV/R2 绑定），部署出的 Worker 启动即报错。
- CI 用 `scripts/render-worker-config.mjs` 渲染 `worker/wrangler.deploy.jsonc`（生成物，不入 git）；本地手动部署用提交的 `worker/wrangler.jsonc`。两者绑定结构一致。

**预期结果**：`npx wrangler deployments list`（在 `worker/` 下）显示新部署；Pages 项目出现新部署记录。

## 四、启动验证

### 4.1 自动就绪探针（CI 已执行）

`node scripts/wait-for-deploy.mjs` 轮询两条链路：

- `GET /`（Pages 生产别名 `https://blog-website-page.pages.dev`）→ 验 Pages 产物
- `GET /api/v1/health`（经同源代理）→ 要求 `status=ok` 且 `db` 非 `error`，验 Worker + D1/KV/R2 绑定

默认 180s 超时 / 5s 间隔；就绪即结束，超时打印每条探针末次状态并以退出码 1 失败。探针**不打自定义域**：zone 边缘规则会把 CI 出口 IP 判为 bot 导致恒 403，那是边缘拦截而非未就绪（遇 403 会标注「边缘拦截」）。该探针只校验可达性 + 健康，不校验线上版本号。

### 4.2 手动验证

```bash
# Pages 前端（生产别名）
curl -fsS https://blog-website-page.pages.dev/ | head

# API 健康（Worker origin）
curl -fsS https://blog-api.zen-13467.workers.dev/api/v1/health
# 预期：{"status":"ok", ...}

# 同源代理链路
curl -fsS https://blog-website-page.pages.dev/api/v1/health

# 自定义域（如已绑定）
curl -fsS https://blog.zenfishlog.dpdns.org/
```

**预期结果**：四条请求均返回 200；health 响应 `status=ok`、`db` 非 `error`；用 2.5 的 initial 口令能登录 `/admin`。

### 4.3 部署通道人工核查清单

每次改动部署链路后过一遍（仓库内无法自动验证）：

1. `npx wrangler pages project list` → `blog-website` 存在；Dashboard → Settings → Builds & deployments 确认无 Automatic deployments 条目。
2. Dashboard → Workers & Pages → `blog_website` → Settings → Build，确认 Git 连接为 **Disconnected**（唯一真判据；`wrangler deployments list` 分不出是 push 还是 Actions 触发）。
3. 同一次 push 后 `gh run list --workflow=deploy.yml --limit 3` 只有一个运行在跑，且 `blog_website` 的部署条目不增加。
4. 就绪轮询报「探针一直 200 但内容还是旧的」→ 通常是并行通道覆盖，先查本清单，不要调大超时。

自定义域的 CI 出口 IP 放行属未闭环项；探针绿但自定义域 403 时按本节排查，不要在 README 里改探针超时。

## 相关文档

- [项目概览（技术栈 / 目录结构 / 数据库设计 / License）](docs/PROJECT_OVERVIEW.md)
- [API 接口参考（公开 / 认证 / 管理员 / 限流）](docs/API_REFERENCE.md)
- [前台页面与展示（页面清单 / SSR / 内嵌预览 / 配置 / i18n / 主题 / 响应式）](docs/FRONTEND_FEATURES.md)
- [后台管理与视觉增强（后台 / 编辑器 / 背景 / 配置中心 / 代理 / 抓取 / 动效）](docs/ADMIN_AND_VISUAL.md)
- [本地开发指南（环境 / 启动 / 测试 / 数据库初始化 / 首次设置 / JWT 密钥）](docs/LOCAL_DEVELOPMENT.md)
- [测试约定](docs/agents/testing.md) · [Windows Shell](docs/agents/windows-shell.md) · [GLOSSARY](GLOSSARY.md) · [ADR](docs/adr/) · [代码审查报告](docs/reviews/)
