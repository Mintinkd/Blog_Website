# 本地开发指南

本文档收录本地开发的环境要求、启动方式、测试命令与数据库初始化/首次设置流程。部署到生产见根目录 [`README.md`](../README.md)。

## 前置要求

- Node.js 22.12+（Worker 的 wrangler 4 要求；CI 使用 22.x 最新版）
- npm

## 安装依赖

```bash
npm install
```

## 前端开发

```bash
npm run dev
```

访问 `http://localhost:4321`

> 前端类型门禁：`npm run check`（astro check，含 `.astro`/`.vue`/`.ts`；存在类型错误即非零退出）。入口为 `scripts/run-astro-check.mjs`——Node < 22.12 时自动补 `--experimental-require-module` 旗标（language-server 以 require 拉取 ESM-only 的 astro2tsx，组合钉版说明见脚本头注）。

## 前端单元测试

```bash
npm test
```

根级 vitest（默认 jsdom）覆盖两块：一是抓取管线——`tests/` 内的 HTML/字节 fixture → `src/utils/scrape.ts` 的标题/Markdown、selector 命中/未命中、正文回退、懒加载图片、URL/嵌入降级、字符集解码、元数据映射（摘要/封面/标签/slug/分类/状态）、来源脚注与 CJK 字数；二是文章详情页的服务端接缝——stub `fetch` 验证已发布 / 404 / 未发布 / 上游失败 / 超时的三态映射、访客 Cookie / cf-connecting-ip 转发、Set-Cookie 逐字回传（含 `HttpOnly`）与 `Cache-Control: private, no-cache`；纯函数构造每篇文章的 SEO 元信息（唯一 title、summary / 正文摘录回退、canonical 编码、封面绝对化与缺省省略、`og:type=article` / 发布时间），以及 SSR 站点标题读取（stub `fetch` 验证成功 / 失败 / 脏数据回退）、dev-only `ARTICLE_API_ORIGIN` 解析（dev 生效并去尾斜杠 / 生产忽略 / 空值回退 `WORKER_ORIGIN`）；上述文件用 `@vitest-environment node` 覆盖默认 jsdom。该命令从仓库根目录运行，已接入 CI，位于前端类型检查之后、构建之前。文章 SSR 的浏览器回归（服务端正文 / 无 JS / motion 失败兜底 / 404 / 502）也已在构建前接入 CI，使用 Playwright + 本地 mock；T7 #68 又在同一 Playwright 步骤接入文章编辑器端到端回归 `scripts/verify-article-editor.mjs`（`ARTICLE_EDITOR_UPGRADE.md` §10.3 的九条检查单拆成 13 个独立 browser context 场景、有状态 mock 双通道、`POST /__control` 故障注入）与 `scripts/verify-editor-responsive.mjs`，失败即阻断部署；两条导航回归仍是手动 Playwright 脚本，安装、启动与设计检查单见 `agents/testing.md`。

## Worker 后端开发

```bash
cd worker
npm install
npx wrangler dev
```

Worker 本地运行在 `http://localhost:8787`

> 质量门禁：`npm run typecheck`（tsc，含 `tests/`）与 `npm test`（vitest）在 CI 部署前强制执行；CI 最先跑的是四份生成物漂移断言（设置白名单 `npm run gen:settings` issue #27 / ADR 0001、安全头 `npm run gen:headers` issue #28 / ADR 0002、CORS 白名单 `npm run gen:cors` issue #85 / H4、富文本白名单 `npm run gen:rich-text` issue #92 / #99，各自重新生成 → git diff 必须为空），随后才是 worker typecheck / worker 测试、前端 check、根级 vitest、文章 SSR 浏览器回归 / 文章编辑器端到端回归（`verify-article-editor`）/ 编辑器响应式回归（`verify-editor-responsive`）/ 后台移动端回归 / 页面观感友好度检查（`npm run verify:visual`，13 条规则，失败输出带规则 ID 与源码定位的问题清单）、构建；浏览器回归集中在同一 Playwright 步骤，失败即阻断部署，规则与复现命令见 `agents/testing.md`。

## 初始化数据库

```bash
cd worker
npx wrangler d1 execute blog-db --remote --file=./schema.sql
npx wrangler d1 execute blog-db --remote --file=./migrations-baseline.sql   # 把历史迁移标记为已应用
npm run db:seed          # 生成随机初始管理员口令（仅终端打印一次，首次登录强制改密）
```

> **注意**：必须使用 `--remote` 标志操作远程数据库，否则只影响本地。

> **数据库迁移框架（issue #94 / M12）**：`worker/schema.sql` 只保留「全新库」形态（历史 ALTER 列已并入 CREATE TABLE，可重复执行无 `duplicate column`）；历史增量 ALTER + UPDATE 收编在 `worker/migrations/0001_baseline.sql`，由 `wrangler d1 migrations` 管理（`wrangler.jsonc` 的 `migrations_dir: "migrations"`）。全新库与已迁移存量库**不要**执行 0001（会 duplicate column），改用上面的 `migrations-baseline.sql` 把 `0001_baseline.sql` 记为已应用（幂等，可重跑）；从未迁移过的极老库才用 `npx wrangler d1 migrations apply blog-db --remote` 执行 0001 补齐列。用 `npx wrangler d1 migrations list blog-db --remote` 查待应用列表——baseline 标记后应显示「No migrations to apply」。
>
> **#83 / H1**：`schema.sql` 不再写入任何硬编码可登录口令。全新库初始化后**必须**执行 `npm run db:seed`（本地库加 `--` 传 `--local`），它用 `randomUUID()` 生成随机口令、以 PBKDF2 哈希 UPSERT 写入 `admin` 账户并在终端打印一次明文；该口令无法从仓库或响应复现。若种子命令失败，本次口令不打印、可安全重跑。可用 `SEED_ADMIN_USERNAME` 覆盖用户名。

> **已有部署升级**：schema.sql 现为全新库形态、可重复执行，尾部不再有增量 ALTER。已迁移过的库如需接入迁移框架，执行 `migrations-baseline.sql` 标记 0001 已应用即可；新增结构变更写成 `worker/migrations/0002_*.sql`（命名 `{number}_{name}.sql`，按数字排序）后用 `wrangler d1 migrations apply` 应用。切勿把历史 0001 直接 apply 到已迁移库（duplicate column）。

**阅读统计（Tier 0）增量 DDL**：已有库升级时执行 `worker/schema-tier0-incremental.sql`（5 条语句，均 `IF NOT EXISTS`，重复执行安全）。issue #94 后 `schema.sql` 已是幂等全新库形态、重跑不再报 duplicate；该文件仍作为「只补 Tier 0、不碰其他结构」的最小增量来源保留。它与 `worker/schema.sql` 的「阅读统计 Tier 0」段同义。`site_config` 的 `analytics_hmac_secret` 在首次计数时懒生成，`analytics_last_job_at` 由每日清理任务写入，无需手工预置；Tier 1 的 `analytics_consent` 本批不建。

```bash
cd worker
npx wrangler d1 execute blog-db --remote --file=./schema-tier0-incremental.sql
```

**M22 索引增量 DDL**：补 `media_assets(uploaded_by)`、`comments(article_id, status)`、`friend_links(is_active)` 三个二级索引（issue #73）。执行 `worker/schema-m22-incremental.sql`（3 条，均 `IF NOT EXISTS`，重复执行安全；前置条件是存量库已有 `uploaded_by` 迁移列）。该文件与 `worker/schema.sql` 中对应索引语句一致，由 `worker/tests/query_columns.test.ts` 机械守卫。

```bash
cd worker
npx wrangler d1 execute blog-db --remote --file=./schema-m22-incremental.sql
```

**taxonomy v2 标签归属迁移（一次性，issue #75 / #77）**：`tags.category_id` 加列 + 索引 + 「未分类」种子 + 存量回填（回填规则见 [ADR 0008](adr/0008-tag-as-category-subsystem.md) 决策 4）。全新库无需单独执行——`schema.sql` 已含同构 DDL；**存量库执行 `worker/schema-tag-category-incremental.sql` 只允许执行一次**：文件含不带 `IF NOT EXISTS` 的 `ALTER TABLE ADD COLUMN`，重复执行会报 `duplicate column`。执行前先备份并在副本上演练（行数不变 → `category_id` 空值归零 → 跨分类审计清单产出，三关都过才上生产）；备份走 **D1 Time Travel 恢复点 + 逐表 `wrangler d1 execute --remote --json` dump**——`wrangler d1 export` 因 FTS5 虚拟表限制在本库不可用（见 [2026-11-17 audit](reviews/2026-11-17-taxonomy-t6-audit.md)）。执行后用 `PRAGMA table_info(tags)` / `PRAGMA index_list(tags)` 核对列与索引。回滚按 ADR 0008：只回代码不回 schema，数据用迁移前备份恢复。可运行交互式引导脚本 `bash scripts/migrate-taxonomy-wizard.sh` 逐步完成上述备份 / 演练 / 三关确认 / 生产执行（脚本代跑前需二次确认）/ 审计全流程。

> 每日 cron（`0 16 * * *`，即 Asia/Shanghai 00:00）由 Worker `scheduled` 入口执行：删除过期令牌、删除 400 天保留窗口外的日聚合与维度桶，并写入 `site_config.analytics_last_job_at` 心跳。

## 首次设置

数据库初始化并执行 `npm run db:seed` 后，管理员账户（默认用户名 `admin`）以随机初始口令创建；首次登录响应返回 `must_change_password: true` 并强制要求改密。**须改密会话被服务端会话级闸门拦截**：未完成改密前，除 `POST /auth/refresh`（令牌续期）与 `POST /auth/change-password`（改密）外，所有携带该会话令牌的鉴权请求（含 GET 类管理接口）一律返回 403。

> **存量库升级（#83 / H1）**：已执行过旧版 `schema.sql` 的库含硬编码种子口令账号，其 `must_change_password=1` 标记由迁移中的存量识别 UPDATE 完成。若目标库**缺 `must_change_password` 列**（从未跑过该迁移），鉴权采用 fail-closed：所有会话被视为「须改密」，仅续期/改密路径可达——正确出路是立即重放 `schema.sql` 中 `users` 三列迁移（`must_change_password` / `failed_login_attempts` / `locked_until`）。切勿在库未迁移状态下长期运行。

**JWT 密钥**：

- 首次读取时自动生成（48字节随机数据，经 base64url 编码），无需手动配置
- 永不出现在任何 API 响应或公开设置中
- 如需手动轮换（例如密钥泄露或重建环境），可通过以下命令更新：
  ```sql
  UPDATE site_config SET value = '<新的64字符密钥>', updated_at = datetime('now') WHERE key = 'jwt_secret';
  ```
  新密钥会立即生效，所有现有 token 在过期前仍可使用。
