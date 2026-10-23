# 全仓代码审查报告（2026-10-23）

> 审查对象：`Blog_Website`（Astro 5 + Vue 3 前端 / Cloudflare Workers + D1 + KV 后端）
> 审查方式：静态通读 + 门禁实测（`npm test`、`worker npm test`、`npm run check`、两条生成物漂移断言）
> 结论口径：本仓库工程成熟度**高于同类个人项目平均水平**（单源治理、鉴权与消毒实现、测试门禁都到位）；主要风险集中在「配置冗余与误操作面」「跨入口语义不一致」「数据库访问放大」三处，无已确认的可直接利用的 Critical 漏洞。

---

## 0. 审查范围与规模

| 区域                    | 行数          | 说明                                                        |
| ----------------------- | ------------- | ----------------------------------------------------------- |
| `src/`（前端）          | 12,196        | `.astro` / `.vue` / `.ts` / `.css`                          |
| `worker/src/`（后端）   | 4,968         | 入口 / 路由 / 中间件 / handlers / services / models / utils |
| `tests/`（根，jsdom）   | 1,745         | 抓取管线 + 文章服务端接缝                                   |
| `worker/tests/`（node） | 1,919         | 代理 SSRF / 抓取 robots / 安全头 / 导入校验                 |
| `scripts/`              | 1,776         | 生成物脚本 + Playwright 回归                                |
| `worker/schema.sql`     | 212           | 10 张表 + 索引 + FTS5 + 迁移                                |
| `docs/`                 | 3,176         | ADR / 代理约定 / 历史审查报告                               |
| **合计**                | **约 26k 行** | 不含 `dist/` 与 `node_modules/`                             |

---

## 1. 整体架构

### 1.1 部署拓扑

```
浏览器
  │  https://blog.zenfishlog.dpdns.org
  ▼
Cloudflare Pages（blog-website-page，自定义域）
  ├─ 静态/预渲染 HTML：/、/articles、/archives、/about、/search、/admin、/404
  ├─ SSR 路由（Pages Functions = dist/_worker.js）
  │    /articles/[slug]  /categories/*  /tags/*  /rss.xml  /speculation-rules
  └─ 同源 API 代理      /api/v1/*  ─────────┐
                                          │ fetch(${WORKER_ORIGIN}/api/v1…)
                                          ▼
                              Cloudflare Worker（blog-api）
                                   ├─ D1（blog-db）
                                   └─ KV（MEDIA / EDIT_LOCK / RATE_LIMIT）
```

- 前端：`@astrojs/cloudflare` + `output: "static"`，靠逐页 `prerender = false` 打开按需渲染（`astro.config.mjs:47`）。
- 后端：`worker/src/index.ts:17` 只放行 `API_PREFIX`（默认 `/api/v1`）前缀，其余一律 404。
- Worker **没有配置自定义域路由**（`worker/wrangler.jsonc` 无 `routes`），只经 Pages 代理与 `*.workers.dev` 可达。

### 1.2 两条 API 入口路径（本仓最容易出问题的地方）

| 入口                   | 链路                                                                           | 谁来解析访客 IP                                            |
| ---------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| ① 浏览器 → `/api/v1/*` | Pages Function 代理（`src/pages/api/v1/[...path].ts`）→ Worker                 | 代理层把 `cf-connecting-ip` 映射为 `X-Real-IP`（`:23-29`） |
| ② SSR 文章页           | Pages Function 直连 `WORKER_ORIGIN`（`src/utils/articleServer.ts:72`）→ Worker | 同理转发 `X-Real-IP`（`:120-126`）                         |

两条链路的上游都是 `https://blog-api.zen-13467.workers.dev`。由于 Worker 侧多个 handler 对 IP 的读取口径不一致（见 **M3**），存在语义分歧。

### 1.3 渲染模式矩阵

| 模式                       | 路由                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 静态预渲染                 | `/`、`/articles`、`/archives`、`/about`、`/search`、`/admin`、`/404`                                                            |
| SSR（`prerender = false`） | `/articles/[slug]`、`/categories`、`/categories/[slug]`、`/tags`、`/tags/[slug]`、`/rss.xml`、`/speculation-rules`、`/api/v1/*` |

> 一致性核对已通过：`dist/_routes.json` 的 `exclude` 清单与 `scripts/cloudflare-guards.mjs` 的 `HTML_ROUTE_PATTERNS` 完全对齐；`categories` / `tags` 确为 SSR，因此未出现在 `_headers` 的 HTML 路由块中属正确做法。

### 1.4 后端请求链路

```
worker/src/index.ts       前缀判定
  └─ router.ts:162-210    CORS 预检 → 限流 → 路由匹配 → 鉴权 → handler
       ├─ middleware/cors.ts             精确白名单 + Vary: Origin
       ├─ middleware/rate_limit.ts       仅写操作 + /search（KV 固定窗口）
       ├─ middleware/auth.ts             JWT 校验 + 回查 role/mustChangePassword
       ├─ handlers/*.ts                  业务
       ├─ services/article_service.ts    列表/详情/读写/计数
       └─ middleware/security_headers.ts CSP default-src 'none' 等
```

路由表在启动时一次性编译为 `RegExp`（`router.ts:42-59`），运行时线性扫描约 50 条规则并逐个 `match()`。

---

## 2. 模块划分评价

### 2.1 后端：清晰，但有两处职责越界

**优点**

- 分层明确：`handlers`（HTTP 语义）→ `services`（业务/事务边界）→ `models`（类型）→ `utils`（无状态工具）。
- 响应与错误信封统一（`utils/response.ts`），`router.ts` 统一套 `withCors(withSecurityHeaders(...))`。
- 安全护栏可复用：`img_proxy.ts` 导出的 `validateTargetUrl` / `fetchWithValidatedRedirects` / `readBodyWithLimit` / `mapFetchedFailure` 被 `text_proxy.ts`、`scrape.ts` 复用（issue #22 收敛），避免了三份实现漂移。

**问题**

- **鉴权信息散落两处**：`router.ts:184-193` 做「是否登录 / 是否 admin / 是否须改密」的粗粒度判定，而「editor 只能操作自己的资源」散落在 `article.ts`/`comment.ts`/`category.ts`/`media.ts` 各 handler 内手写。新增接口极易漏判（见 **M5**）。
- **同一查询被复制多份**：`SELECT id FROM users WHERE username = ?` 在 `auth_handler.ts:103/391/…`、`article_service.ts:32/…`、`tag.ts:43`、`category.ts:62`、`media.ts:103`、`comment.ts` 等多处重复（至少 8 处），每次调用多一次 D1 往返。
- **`handlers` 里大量 `await import('../services/...')` 动态导入**（`article.ts:36/43/102/142/165/172`、`comment.ts:108`、`edit_lock.ts:13/31/42/51`）。在 Worker 中这会让每段逻辑变成独立 chunk，首次调用多一次模块解析；且这些并非按需懒加载（几乎每次请求都会走到），收益接近零、可读性受损。

### 2.2 前端：合理，但两个文件已成为「巨石」

- 页面 12 个，组件/岛屿 9 个，`utils/` 23 个模块，粒度总体偏细、职责单一。
- **`src/admin/App.vue` 共 3,578 行**：template 1,481 行 / script setup 1,187 行 / style 907 行，单文件承载 10+ 个功能模块（文章、分类、标签、评论、媒体、友链、用户、配置、关于、抓取、设置）。任何一处改动都会产生巨大 diff，且无法做组件级测试。
- **`src/components/layout/BaseLayout.astro` 共 823 行，其中内联 `<script>` 约 600 行**（`:174` 起），内含主题/语言持久化、标签页标题挽留、回到顶部、悬浮一言自定义元素、`window.fetchWithProxy`、`<img>` 失败降级代理等 6 类互不相关的逻辑，全部无测试覆盖。

### 2.3 单源治理：本仓最值得肯定的设计

两条「生成物 + 漂移断言」链路，且**已实测通过**：

```
settings.rules.json（手写单源）
   └─ npm run gen:settings ─┬─> src/generated/settings-rules.ts
                            └─> worker/src/generated/settings-rules.ts   （双端同构）

scripts/security-headers.mjs + scripts/cloudflare-guards.mjs（手写单源）
   ├─> public/_headers（生成物，prebuild 自动执行）
   └─> src/middleware.ts（直接 import，覆盖 SSR）
```

实测结果：

- `cmp src/generated/settings-rules.ts worker/src/generated/settings-rules.ts` → **字节一致**（md5 均为 `17692a5cdf29a0d7c5e216af35bf17e3`）
- `npm run gen:settings && git diff --exit-code` → **clean**
- `npm run gen:headers && git diff --exit-code` → **clean**

这是把「跨端规则一致性」从人的纪律变成机器门禁的正确做法，建议在更多约束上复制该模式。

---

## 3. 核心功能逻辑走查

### 3.1 认证与口令（实现质量高）

| 关注点       | 实现                                                                                       | 位置                                              |
| ------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 哈希         | PBKDF2-SHA256，100,000 迭代，16 字节随机盐，自描述格式 `pbkdf2$sha256$<iter>$<salt>$<key>` | `utils/password.ts:9-11,45-49`                    |
| 比较         | 恒定时间（逐字符 XOR 累加）                                                                | `utils/password.ts:38-43`                         |
| 旧格式兼容   | 无盐 SHA-256 校验 + 登录后透明升级                                                         | `password.ts:75-81`、`auth_handler.ts:193-196`    |
| 时序侧信道   | 未知账号执行同代价假验证；旧格式校验后补一次 PBKDF2                                        | `password.ts:79,87-89`、`auth_handler.ts:331-333` |
| 锁定         | 5 次失败锁 10 分钟；失败路径统一 401，不暴露锁定状态                                       | `auth_handler.ts:27-28,49-53,336-347`             |
| 令牌         | HS256，24h，密钥存 D1 `site_config.jwt_secret`                                             | `middleware/auth.ts:43-64,137-143`                |
| 角色即时生效 | 每请求回查 `users.role`                                                                    | `auth.ts:129-134`                                 |
| 须改密门禁   | 写方法（POST/PUT/DELETE/PATCH）全拦，仅豁免 `/auth/refresh`、`/auth/change-password`       | `router.ts:38-40,190-192`                         |

**评价**：口令与登录安全是本仓最强的部分，连「失败路径耗时差」这种细节都处理了。

### 3.2 文章详情 SSR（设计正确，但有放大问题）

- 三态映射清晰：`ok → 200` / `not-found → 404` / `error → 502`，且 2xx 但响应体非法时仍回传去重 Cookie（`articleServer.ts:82-102`、`137-152`）。
- 缓存语义正确：`Cache-Control: private, no-cache`（`:131`），避免含访客 Cookie 的页面被共享缓存复用。
- 兜底完整：`<noscript>` 强显 `[data-reveal]`（`BaseLayout.astro:94-102`）+ motion chunk 失败 3s 兜底（`BaseLayout.astro:359-376`）。
- **问题**：每次访问都触发一次 D1 写（`article_service.ts:261-271`），而 SSR 页又不缓存 → 「一次访问 = 一次数据库写」。详见 **P2**。

### 3.3 设置注入（双端同构，注入面收敛到位）

- 读侧兜底：`sanitizeSettings()` 逐字段按 `SETTINGS_RULES` 校验，非法值按字段回落到默认（`settings.ts:207-222`）。
- 写侧拒绝：`validateSettings()` 同一套规则，非法即 400（`worker/.../settings.ts:183-227`）。
- 公开投影：白名单 `PUBLIC_KEYS`，未来新增敏感字段默认不公开（`worker/.../settings.ts:21-37`）。
- CSS 生成：`cssFrom()` 输出的变量值均来自已净化后的字段；URL 经 `PATTERNS` 限制为站内相对路径或 https 外链，`bgBlur`/`bgBrightness`/`bgOpacity` 有同源数值钳制（`settings.ts:242-274`）。

**评价**：把「任意 JSON → 内联 `<style>`」这个高危场景用双端同构规则关住了，是本仓第二个亮点。

### 3.4 外链代理与抓取（SSRF 防护扎实）

三层防护（以 `img_proxy.ts` 为单一实现，`text_proxy.ts` / `scrape.ts` 复用）：

1. 同步字面量校验：协议 / 长度（2048）/ 黑名单域名 / IP 段（`:170-196`）
2. 解析后 IP 复核：DoH A/AAAA，任一结果落入受限段即拒绝；解析失败 / 超时 / 无记录 **fail-closed**（`:290-321`）
3. 重定向：`redirect: 'manual'` 逐跳复核，上限 5 跳（`:330-380`）

外加：请求头净化（去 Referer/Cookie）、MIME 白名单、10MB 流式读取超限即 `cancel()`、总超时、每 IP 限流、KV TTL 24h 自动过期。

抓取通道还额外做了 robots.txt 预检（`scrape.ts:168-198`）与 admin-only 双校验（路由层 `requireAuth+requireAdmin` + handler 内再判一次 `scrape.ts:206-208`）。

---

## 4. 做得好的地方（值得保持）

1. **生成物漂移门禁**：`git diff --exit-code` 守护两份生成物，且放在 CI **最早**步骤（先于 `npm ci`），失败成本最低。
2. **SSRF 三层校验 + fail-closed**，且跨三个通道复用同一实现，没有复制三份。
3. **口令安全**：PBKDF2 + 恒定时间比较 + 时序抹平 + 失败锁定 + 透明升级。
4. **前后端消毒规则同构**：`markdownPolicy` 被 DOMPurify（前端）与 sanitize-html（Worker）共用。
5. **半迁移兜底**：`isMissingColumnError` 严格限定「仅列不存在」才降级，其余一律 fail-closed 上抛。
6. **测试双环境隔离**：根级 jsdom / worker node，各自独立配置，避免环境串味。
7. **ADR + GLOSSARY + 代理约定文档齐全**（`docs/adr/` 4 篇），决策可追溯。
8. **无 TODO/FIXME 残留**（全仓扫描为 0）。

---

## 5. 风险清单

### 5.0 Critical

#### C1 — 友链 URL 无 scheme 白名单，构成站点源存储型 XSS（可窃取管理员令牌）

**链路（三处均已逐一复核）**

1. **服务端校验形同虚设** —— `worker/src/utils/validator.ts:65-72`：

```ts
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
```

`new URL('javascript:alert(document.cookie)')` **不抛错**，因此校验通过。实测：

```
$ node -e "try{new URL('javascript:alert(1)');console.log('PASS')}catch{console.log('BLOCKED')}"
PASS
```

2. **写入权限过低** —— `worker/src/router.ts:150`：

```ts
addRoute(
  "POST",
  "/friend-links",
  async (req, env) => handleCreateFriendLink(req, env),
  true
);
```

第 5 个参数 `requireAdmin` **未传 → false**，即 **editor 也能创建友链**；`worker/src/handlers/friend_link.ts:17-42` 内部也没有任何角色判断。

3. **渲染点未做任何清洗** —— `src/islands/FriendLinkList.vue:6`：

```html
<a
  :href="link.url"
  target="_blank"
  rel="noopener noreferrer"
  class="link-url"
></a>
```

而该组件挂在 `src/components/layout/BaseLayout.astro:145` 的 **全站页脚**（`friendLinks` 默认 `true`，见 `:36`、`:143`）。

**影响**

- 一个 **editor 账号**（低权限）即可在全站每个页面的页脚植入 `javascript:` 载荷；
- 管理员在后台点击该链接 → 脚本在 `blog.zenfishlog.dpdns.org` 源下执行 → 读取 `localStorage.admin_token`（`src/admin/App.vue:1526`）→ **后台完全接管**；
- 普通访客点击同样受影响（会话/本地存储泄露、被诱导跳转）。

**修复（三道，缺一不可）**

```ts
// ① worker/src/utils/validator.ts：scheme 白名单
export function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
```

```ts
// ② src/islands/FriendLinkList.vue：渲染前兜底
const safeUrl = (u: unknown) => {
  try {
    const p = new URL(String(u ?? ""), location.href).protocol;
    return p === "http:" || p === "https:" ? String(u) : "";
  } catch {
    return "";
  }
};
// <a :href="safeUrl(link.url)">
```

```ts
// ③ worker/src/router.ts:150-152：友链写操作收归 admin
addRoute('POST',   '/friend-links',    ..., true, true);
addRoute('PUT',    '/friend-links/:id',..., true, true);
addRoute('DELETE', '/friend-links/:id',..., true, true);
```

---

#### C2 — PBKDF2 迭代数直接取自被存储的字符串，**无上下界校验**

**位置**：`worker/src/utils/password.ts:66-72`

```ts
const iterations = Number(parts[2]);
if (!Number.isInteger(iterations) || iterations <= 0 || !salt) return { ok: false, ... };
const derived = await derivePbkdf2(password, salt, iterations);   // ❗iterations 无上限
```

- 存储格式为自描述字符串，迭代数由**被校验的数据自己声明**。
- 一旦攻击者能改写 `password_hash`（管理员可经 `PUT /config` 改 `admin_password_hash`，或诱导导入他人备份），即可写入 `iterations = 1e9` → **每次登录尝试触发一次长时间 CPU 占用，构成 CPU DoS**；反之写入 `iterations = 1` 使哈希强度降为可离线爆破。

**修复**：加常量上/下界并拒绝越界值（建议 `10_000 ≤ iterations ≤ 1_000_000`，越界即 `ok:false` + 记日志告警，而不是按数据声明的值执行）。

---

#### C3 — `jwt_secret` 全新部署为空，**且全仓没有任何代码/脚本生成它**

**证据（三条独立命令交叉验证）**

```
# ① schema.sql 把密钥初始化为空字符串
$ grep -n "jwt_secret" worker/schema.sql
171:INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('jwt_secret', '', 0);

# ② 全仓写侧零命中（去掉读取语句后）
$ grep -rn "jwt_secret" scripts/ src/ worker/src/ | grep -v "SELECT value"
(none)

# ③ README 反而宣称首次登录会返回 must_change_password
$ sed -n '481p' README.md
「首次登录响应会返回 must_change_password: true 并强制要求改密」
```

**实际执行时序**（`worker/src/handlers/auth_handler.ts:189-212`）

1. `verifyPassword()` 通过 ✅
2. 写回 `password_hash` / `must_change_password` ✅
3. `await getJwtSecret(env)` → 列仍是 `''` → **抛 `JWT secret not configured in site_config`** ❌
4. `router.ts:202-208` 兜底 → **500 + 回显该原文**

**影响**

- 任何一次「从零 `npm run db:init`」之后，**管理员登录永久 500**，且响应体直接把配置缺失的原因回显给匿名调用方。
- 现有线上环境能登录，只说明**历史上有人手工执行过一次 UPDATE 注入密钥**——该步骤既不在代码里，也不在 README 里，**属于不可复现的隐性部署知识**。
- 一旦重建 D1、迁移账号或换环境，故障必然重现且无文档可循。

**修复（推荐 ①，一次性根治）**

```sql
-- ① schema.sql:171 改为由 SQL 自动生成随机密钥
INSERT OR IGNORE INTO site_config (key, value, is_public)
VALUES ('jwt_secret', lower(hex(randomblob(32))), 0);
```

```ts
// ② 或在 Worker 首次启动时 lazy 生成（防存量库为空）
async function ensureJwtSecret(env: Env): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT value FROM site_config WHERE key='jwt_secret'"
  ).first<{ value: string }>();
  if (row?.value) return row.value;
  const fresh = crypto.randomUUID() + crypto.randomUUID();
  await env.DB.prepare(
    "UPDATE site_config SET value=? WHERE key='jwt_secret' AND (value IS NULL OR value='')"
  )
    .bind(fresh)
    .run();
  return fresh;
}
```

③ 同时在 README「初始化数据库」章节补一句密钥来源说明与手工轮换命令（`wrangler d1 execute blog-db --command "UPDATE site_config SET value=lower(hex(randomblob(32))) WHERE key='jwt_secret'"`）。

---

#### C4 — 登录接口无口令长度上限，且对不存在的用户名跑满 KDF → 匿名 CPU DoS

**位置**：`worker/src/handlers/auth_handler.ts`（登录入口）、`worker/src/utils/password.ts:87-89`

- 登录请求对 `password` **无长度上限校验**：攻击者可提交 10 MB 的字符串。
- `password.ts:87-89` 的 `fakeVerifyPassword()` 存在意义是「用户名不存在时也消耗等量 CPU，抹平时序差异」——防护本身正确，但它**同样跑满一次 PBKDF2**。
- 二者叠加：匿名请求者可用「随机用户名 + 超长口令」构造**最大化单次 CPU 消耗**的请求，无需任何凭据即可打满 Worker CPU 配额（Workers 按 CPU 时间计费且有单请求上限）。

**与 C3 的关系**：C3 是「被存储的迭代数可控」，C4 是「输入长度与调用次数不可控」，两者独立叠加。

**修复**：

1. 登录入口对 `password` 加**上限**（如 200 字符，与建号/改密一致），超限直接 400，不进 KDF。
2. `fakeVerifyPassword()` 改为**消耗固定的低量 CPU**（如固定 1000 次迭代的哑运算），而非跟随真实配置的 10 万次。
3. 登录接口叠加**按 IP 的限流**（注意 H8：限流 key 不能含 pathname，否则分桶失效）。

---

### 5.1 High

#### H1 — 种子管理员口令硬编码为 `password`

**位置**：`worker/src/utils/seed.ts:13`、`worker/schema.sql:186,192`

```ts
export const DEFAULT_SEED_PASSWORD = "password";
export const INITIAL_ADMIN_PASSWORD_HASH = "5e884898...d8"; // SHA-256("password")
```

**为什么是 High 而不是 Critical**：仓库有两道补偿控制——`must_change_password=1`（迁移 `schema.sql:213` 会给所有存量种子口令账号打标）+ 路由层拦截所有写方法（`router.ts:190-192`）。所以不是「开箱即被打穿」。

> **更正一条历史结论**：`docs/reviews/2026-10-18-code-review-p1-skillrun.md:63` 登记的「`auth_handler.ts:113-119` 与 `auth.ts:88-96` 捕获任意 D1 异常并降级为 `must_change_password = 0`（fail-open）」**已修复**。本次复核当前代码，两处的 catch 均为 fail-closed：
>
> ```ts
> } catch (e) {
>   // P1 复审 Spec(c)2 / #16：仅「列不存在」（迁移前）允许回退旧列；其余异常向上抛（fail-closed）
>   if (!isMissingColumnError(e)) throw e;
> }
> ```
>
> 位置：`worker/src/handlers/auth_handler.ts:87-89`、`worker/src/middleware/auth.ts:106-109`（及其余 6 处同类 catch，均为同一守卫写法）。
> **因此 H1 的残余风险只剩「列未迁移 → 门禁不生效」这一条**，不再是「D1 抖动即可接管」。

**但缺口是真实的**：

- 若目标库**未执行** `schema.sql:208-213` 的迁移，`must_change_password` 列不存在 → `getUserAuth` 走兼容分支返回 `mustChangePassword: false`（`auth.ts:107-113`）→ **门禁完全失效**。
- `usingDefaultCredential` 只识别「口令等于种子值」；管理员自助改成其它弱口令（如 `12345678`）不再被拦截——`WEAK_DEFAULT_PASSWORDS`（`auth_handler.ts:26`）只在改密时生效，且仅两项。
- `PUT /config` 可写入任意 `site_config` 键，包括 `admin_username` / `jwt_secret`。

**修复建议**

1. 首次初始化改为**随机生成口令**：`wrangler d1 execute` 之外提供 `npm run db:seed`，用 `crypto.randomUUID().slice(0,16)` 生成并**只在终端打印一次**。
2. 在 `handleLogin` 成功且 `needsChange === true` 时，把「须改密」提升为**服务端会话状态**：除 `/auth/refresh`、`/auth/change-password` 外，其余接口（含 GET 类管理接口）一律 403，而不是只拦写方法。
3. 口令强度校验复用同一函数，覆盖「创建用户 / 管理员重置 / 自助改密」三条路径，规则包含长度 ≥ 12、非黑名单、非站点名/用户名变体。

---

#### H2 — 三份 wrangler 配置，两份是「地雷」

**位置与状态**

| 文件                    | name                    | 绑定              | 实际是否生效                                     |
| ----------------------- | ----------------------- | ----------------- | ------------------------------------------------ |
| `worker/wrangler.jsonc` | `blog-api`              | DB + 3 个 KV      | ✅ 生效（CI `npx wrangler deploy` in `worker/`） |
| `worker/wrangler.toml`  | `blog_website`          | **仅 MEDIA**      | ❌ 死配置（wrangler 优先 jsonc）                 |
| 根目录 `wrangler.jsonc` | **`blog-website-page`** | **无 DB / 无 KV** | ❌ 疑似遗留                                      |

**风险**

- `worker/wrangler.toml` 缺 `DB`、`EDIT_LOCK`、`RATE_LIMIT`；一旦被 `--config` 显式指定、或某工具按 toml 优先，就会部署出一个**启动即报错**的 Worker。
- 根 `wrangler.jsonc` 的 name 与 Pages 项目**同名**（`blog-website-page`），正是 README:505 自己警告「Worker 名称不能与 Pages 同名」的情形；在根目录误执行 `npx wrangler deploy` 会顶掉 Pages 项目。

**修复建议**

```bash
# 1. 删除死配置（先确认无 workflow / 脚本引用）
grep -rn "wrangler.toml" .github scripts package.json worker/package.json
git rm worker/wrangler.toml

# 2. 根目录配置要么删除、要么改名并加防护说明
#    若确需保留 Workers+Assets 部署，name 必须改为 blog-website-assets
#    并在 README 部署章节标注「根目录禁止执行 npx wrangler deploy」
```

---

#### H3 — 客户端 IP 解析口径不统一，点赞去重 / 评论 ip_hash 可能失真

**位置**（冲突点）

- 只读 `CF-Connecting-IP`：`worker/src/handlers/like.ts:13,34`、`worker/src/handlers/comment.ts:48`
- 有回退链：`worker/src/handlers/img_proxy.ts:143-150`（`CF-Connecting-IP` → `X-Real-IP` → `XFF`）、`worker/src/middleware/rate_limit.ts:17-21`

**问题**：SSR 文章页与 API 代理都把访客 IP 放进 **`X-Real-IP`**。但 Worker 的 `CF-Connecting-IP` 由 Cloudflare 边缘为「这一跳」设置——当请求来自 Pages Functions 的子请求时，它很可能是 **Cloudflare 边缘出口 IP**，而非访客真实 IP。结果是：所有访客在点赞表里被算成同一个 `ip_hash`（点赞总数恒为 0 或 1，且互相能看到「已点赞」），评论的 `ip_hash` 也不再具备去重/溯源价值。

**需实测确认**（我未在本次静态审查中验证 CF 内部子请求是否保留原始 IP）：

```bash
# 临时在 like.ts:13 后加一行日志，然后从两个不同网络各点赞一次，比对 D1 中的 ip_hash
console.log('cf-ip=', request.headers.get('CF-Connecting-IP'),
            'x-real=', request.headers.get('X-Real-IP'));
npx wrangler tail blog-api   # 观察真实取值
```

**修复建议**：抽一个 `worker/src/utils/client_ip.ts`，统一实现「`CF-Connecting-IP` → `X-Real-IP` → `XFF[0]` → `unknown`」，并**只允许受信任的跳（本账户 Pages/Worker）提供的 `X-Real-IP` 生效**；`like.ts` / `comment.ts` / `rate_limit.ts` / `img_proxy.ts` 全部改为调用它，配一条单元测试覆盖「经代理」与「直连」两种入参。

---

#### H4 — 同源 API 代理把 Worker 收敛后的 CORS 白名单重新放开

**位置**：`src/pages/api/v1/[...path].ts:6-16, 43-52`

```ts
responseHeaders.set("Access-Control-Allow-Origin", "*");
responseHeaders.set(
  "Access-Control-Allow-Headers",
  "Content-Type, Authorization"
);
```

- Worker 侧 `middleware/cors.ts:11-29` 已按渗透报告 001 收紧为**精确白名单 + `Vary: Origin`**；代理层在边缘又无条件覆盖成 `*`，等于把该修复在公开入口上开了一个口子——任意第三方站点可跨域读取本站公开 API 响应。
- `OPTIONS` 分支（`:6-16`）直接返回，不经过 `src/middleware.ts`；而 Pages 的 `_headers` **不作用于 Functions 响应** → 预检响应无任何安全头。
- 该代理 `fetch` **没有超时**，与 `articleServer.ts:45`（8s）口径不一致；上游挂起会一直占用 Pages Function。

**修复建议**

```ts
// 1) 不要无条件覆盖：仅当上游未设置 ACAO 时才回显白名单 Origin
const origin = request.headers.get("Origin");
if (origin && ALLOWED_ORIGINS.includes(origin)) {
  responseHeaders.set("Access-Control-Allow-Origin", origin);
  responseHeaders.set("Vary", "Origin");
}
// 2) 与 Worker 共用一份白名单常量（抽到 src/utils/corsOrigins.ts，Worker 侧 import 同文件）
// 3) 加超时
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 10_000);
const workerResponse = await fetch(workerUrl, { ..., signal: ctrl.signal });
```

---

#### H5 — 全量导入是「无刹车」的破坏性操作

**位置**：`worker/src/handlers/admin.ts:190-329`

- 语义是「提供即替换」：给了哪张表就 `DELETE FROM <table>` 再 `INSERT`（`:260-274`）。
- **没有** dry-run、**没有**自动备份、**没有**二次确认令牌（如要求带上 `site_title` 或一次性 token）。
- 一次误点/误传文件即可清空文章、评论、媒体、友链、分类、标签。

**修复建议**：

1. 导入前把当前全量数据写入 KV（key `backup:<ISO>`，TTL 7 天），返回 `backup_key`。
2. 提供 `GET /admin/export` 之外的 `POST /admin/import?dry_run=1`，只跑阶段 1 校验并返回将要删除/插入的行数。
3. 对行数超过阈值（如 0 行或 > 10× 现有行数）的导入要求显式 `confirm=1`。

---

#### H6 — 创建用户不置 `must_change_password`，且口令无强度校验

**位置**：`worker/src/handlers/auth_handler.ts:443-485`

```ts
if (!username || !password) return error(...);              // 仅判非空
const passwordHash = await hashPassword(String(password));   // ❗无 MIN_PASSWORD_LENGTH、无弱口令名单
await env.DB.prepare(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)"
).bind(...).run();                                           // ❗列清单里没有 must_change_password
```

- 后果：**新建的管理员账号永远不会被强制改密**，`router.ts:190-192` 的闸门对新账号完全失效；
- 管理员可创建口令为 `"1"` 的账号。

**对比**：`MIN_PASSWORD_LENGTH` / `WEAK_DEFAULT_PASSWORDS` 只挂在自助改密 `handleChangePassword`（`:403-409`）。

**修复**：把口令强度校验抽成 `assertPasswordStrength(pw)`，在「创建用户 / 管理员重置 / 自助改密」三条路径统一调用；INSERT 列清单补 `must_change_password` 并置 1。

---

#### H7 — 管理员重置他人口令不置 `must_change_password=1`

**位置**：`worker/src/handlers/auth_handler.ts:527-535`

```ts
sets.push("password_hash = ?");
values.push(passwordHash);
sets.push("failed_login_attempts = 0", "locked_until = NULL"); // ❗没有 must_change_password = 1
```

- 后果：重置后的临时口令（往往是弱口令）永久有效且无需更换，与「首次登录强制改密」的整体设计不一致。

**修复**：重置口令时同步 `must_change_password = 1`。

---

#### H8 — 限流 key 含 pathname → 按资源分桶，配额形同虚设

**位置**：`worker/src/middleware/rate_limit.ts:55`

```ts
const key = `rate_limit:${ip}:${pathname}:${Math.floor(Date.now() / config.window_ms)}`;
```

- pathname 里含资源 id：`POST /articles/1/comments` 与 `POST /articles/2/comments` 是**两个独立桶**。
- 评论接口本意 `POST:/comments = 3 次/分`（`:11`），攻击者遍历 article_id 即可无限发垃圾评论；点赞（`POST:/like` = 10/分）同理。
- 叠加问题：规则匹配用 `pathname.includes('/comments')` 等子串判断（`:42-51`），宽松易误配；`DELETE` 未定义 → 落到 `RATE_LIMITS['GET']`（60/分）。

**修复**：key 改用「规范化路由模板」（去掉 id 段）而非原始 pathname；配置改为按路由模板精确匹配。

---

#### H9 — `admin/import` 全程非事务，失败即留下半空数据库

**位置**：`worker/src/handlers/admin.ts:254-313`

- 阶段 2a 对全部涉及的表先执行 `DELETE`（`:260-274`），阶段 2b 再逐行 `INSERT`（`:303-311`）。
- 中间任何一次 INSERT 抛错 → 直接落到 `:323` 的 catch 返回 500，此时**旧数据已删除、新数据未写完**。
- 且逐行 `await` 而非 `env.DB.batch()`，一次大导入 = N 次串行往返。
- 另：`DELETE FROM media_assets`（`:272`）**不同步删 KV 对象** → 孤儿对象永久占用存储并持续计费。

**修复**：把「同表 DELETE + INSERT」包进 `env.DB.batch()`；跨表顺序保证 FK；`DELETE media_assets` 前先取出 `kv_key` 列表并逐个 `env.MEDIA.delete()`；大导入改为分批 batch。

---

#### H10 — DoH 校验与真实建连之间的 TOCTOU / DNS rebinding

**位置**：`worker/src/handlers/img_proxy.ts:290-321`（含自承注释 `:294-297`）

> 注释原文：「DoH 结果与 fetch 建连时的实际解析之间存在 TOCTOU 窗口（DNS 可变更/轮换）。本复核只保证「校验时」解析结果安全；Workers 运行时无法把 fetch 绑定到已校验 IP，连接级绑定为 #19 明确的范围外事项。」

- 短 TTL + 双答案的自建 DNS 可让 DoH 返回公网 IP、实际 fetch 连到 `127.0.0.1` / `169.254.169.254`。
- 这是当前 SSRF 防护的**唯一实质缺口**（其余三层实现扎实）。
- 根治需要 Durable Object 或自建 connect 层；短期可「DoH 查询后立即 fetch + TTL 内缓存判定」收紧窗口，并对 `blocked` 结果记日志告警。

---

#### H11 — `deepMerge` 以默认值键集合为准 → i18n 文案覆盖 100% 静默丢失

**位置**：`worker/src/handlers/settings.ts:149-159`（配合 `getDefaultSettings():139`）

- 递归只遍历 `Object.keys(base)`；而默认值里 `copy: { zh: {}, en: {} }` 是**空容器** → 键集合恒为 `[]`。
- `validateSettings` 的 `case "copy"`（`:213-221`）校验的是**已被清空的 `merged`** 而非 `body`，因此永远合法。
- **后果**：`PUT /settings` 返回 200「设置已保存」，响应体 `copy` 变回 `{}`，刷新即回到默认文案 —— 功能完全不可用，且失败静默。
- 已用等价逻辑 node 实测复现（见 **§8.1**）。

**修复**：见 §8.1 的两个方向，推荐「把默认值改为显式键清单」—— 不动合并逻辑，且顺带产出可覆盖文案清单给后台 UI。

---

### 5.2 Medium

#### M1 — 列表查询 N+1：每篇文章单独查一次标签

**位置**：`worker/src/services/article_service.ts:95-100`

```ts
for (const row of articles.results) {
  const tags = await env.DB.prepare(`SELECT ... WHERE at.article_id = ?`)...
}
```

`page_size` 上限 50 → 一次列表请求最多 **51 次 D1 往返**，串行执行。

**修复**：一次查询取回，`GROUP_CONCAT` 后解析：

```sql
SELECT a.*, c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
       u.display_name AS author_name,
       (SELECT group_concat(t.id || '\u001f' || t.name || '\u001f' || t.slug, '\u001e')
          FROM article_tags at JOIN tags t ON t.id = at.tag_id
         WHERE at.article_id = a.id) AS tags_blob
FROM articles a ...
```

---

#### M2 — 列表接口把全量 Markdown 正文从 D1 搬到前端再丢弃

**位置**：`worker/src/services/article_service.ts:80`（`a.content`）、`:118`（仅用于 `calculateReadingTime`）、`ArticleListItem` **不含** `content` 字段

- 列表项最终不输出 `content`，但 SQL 取了它，只为算阅读时长。
- 50 篇 × 20KB = 约 1MB 的无用传输（D1 → Worker → 客户端），且无缓存时每次列表翻页都重来。

**修复**：创建/更新文章时把 `reading_time` 落库（`articles` 表加列或复用 `site_config` 之外的轻量字段），列表 SQL 不再 select `content`。

---

#### M3 — 限流实现偏弱且三处重复

**位置**：`worker/src/middleware/rate_limit.ts:9-67`、`worker/src/handlers/img_proxy.ts:442-454`、`worker/src/handlers/text_proxy.ts:93-107`

- **固定窗口**：`Math.floor(Date.now() / window_ms)`（`:55`）→ 窗口边界突发可达 2× 配额。
- **KV 计数非原子**：`get` → 判断 → `put`（`:57-64`），并发下超发；KV 全球最终一致（约 60s 传播），跨 PoP 计数被严重低估。
- **三套近似实现**：全局中间件 / 图片代理 / 文字代理各写一份，规则（窗口、阈值、键名）分散。
- **GET 类读接口完全不限流**（`:37-39` 刻意跳过），含 `/articles/:slug`——而它**每次都会写 D1**（见 **P2**）。

**修复建议**：统一到 `RateLimiter` 模块；对 `/articles/:slug` 至少加宽松限流；长期方案改用 Durable Objects 或 Cloudflare Rate Limiting API。

---

#### M4 — 顶层 catch 把内部错误原文回给客户端

**位置**：`worker/src/router.ts:202-208`

```ts
const errMsg = error instanceof Error ? error.message : String(error);
return ... Response.json({ code: 500, message: errMsg, data: null }, { status: 500 });
```

D1 异常消息可能包含表名 / 列名 / SQL 片段，属信息泄露。

**修复**：对外统一 `message: 'Internal server error'`，原文只进 `console.error`（已有）+ 结构化日志。

---

#### M5 — 所有权校验散落各 handler，口径不一致

| 位置                                             | 行为                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `worker/src/services/article_service.ts:205-212` | ✅ fail-closed（用户解析失败返回 false）                                                     |
| `worker/src/handlers/media.ts:132-140`           | ✅ fail-closed                                                                               |
| `worker/src/handlers/comment.ts:73-86`           | ✅ fail-closed                                                                               |
| `worker/src/handlers/category.ts:61-66`          | ⚠️ **fail-open**：`if (user && existing.created_by !== user.id)` —— 用户行解析失败时**放行** |
| `worker/src/handlers/tag.ts`                     | ⚠️ 无 `PUT /tags/:id` 路由，标签不支持改名/改所有权                                          |

**修复建议**：

```ts
// category.ts:61-66 改为
const userId = await getUserIdByUsername(env, authResult.username);
if (!userId || existing.created_by !== userId) {
  return forbidden("您没有权限编辑此分类");
}
```

并把所有权判定收敛到 `services/` 的一个 `assertOwnership(kind, id, auth)` 单点。

---

#### M6 — 消毒器是正则黑名单，且两个白名单常量定义后从未被使用

**位置**：`worker/src/utils/sanitizer.ts:1-29, 46`

```ts
const ALLOWED_TAGS = [...];        // ❗ 定义后无任何代码引用
const ALLOWED_ATTR = {...};        // ❗ 定义后无任何代码引用
export function sanitizeHtml(dirty: string): string {
  let cleaned = dirty;
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  ... 8 条正则黑名单 ...
}
```

- 正则黑名单天然弱于白名单（大小写、换行、编码、`<svg>`/`<math>` 命名空间、`<img src=x onerror=...>` 的属性清洗仅靠两条 `on\w+\s*=` 正则等）。
- 更严重的是：`ALLOWED_TAGS` / `ALLOWED_ATTR` **已导出但全仓无引用**，说明「白名单化」是**打算做而没做完**的事——下一位维护者很容易误以为正文已经按这两个常量消毒了。
- 该消毒器用于：评论内容（`comment.ts:46`）、导入的文章 `content` / `content_html` 与评论内容（`admin.ts:288`）——即**不可信输入入库路径**。

**修复建议**：直接用 `sanitize-html` 实现（Worker 侧已在 `markdownServer.ts` 依赖它，无新增依赖），把 `ALLOWED_TAGS` / `ALLOWED_ATTR` 作为 `allowedTags` / `allowedAttributes` 真正消费掉，并补测试（`<script>`、`<img onerror>`、`<svg onload>`、`<a href="javascript:">`）。

---

#### M7 — 图片代理可同源返回可执行的 SVG，缺少纵深防御

**位置**：`worker/src/handlers/img_proxy.ts:32`（允许 `image/svg+xml`）、`:549-556`（未设置 `Content-Disposition`）
**对照**：`worker/src/handlers/media.ts:202-207` 对同类型**强制** `attachment` + `nosiff`

`/img-proxy?url=<外链 svg>` 会以 `image/svg+xml` 在**博客源**下返回；外链 SVG 内嵌 `<script>` 时可直接执行。当前**唯一**的拦截来自 API 侧 CSP（`security_headers.ts:17-20` 的 `default-src 'none'`），属单点防护——一旦 CSP 因任何原因失效即为同源 XSS。

**修复建议**：给 `img-proxy` 的 SVG 响应加 `Content-Disposition: attachment` 与 `Content-Security-Policy: default-src 'none'; sandbox`，与 `media.ts` 口径保持一致。

---

#### M8 — 配置写入无键白名单，`jwt_secret` 可被写空

**位置**：`worker/src/handlers/config.ts:26-34`

```ts
for (const [key, value] of Object.entries(body)) {
  await env.DB.prepare('UPDATE site_config SET value = ? ... WHERE key = ?')...
}
```

- 任意键可写（SQL 已参数化，无注入），但**没有**键白名单、没有非空校验。
- 把 `jwt_secret` 置空 → `getJwtSecretFromDb` 抛错 → **全站鉴权接口 500**，且 admin 自己也登不进去（刷新 token 同样依赖密钥）。

**修复建议**：加 `CONFIG_KEYS` 白名单（与 `schema.sql` 的初始键一致），`jwt_secret` / `admin_password_hash` 只允许通过专门的改密 / 轮换接口变更，且拒绝空值。

---

#### M9 — 点赞计数与记录非同一事务，无对账入口

**位置**：`worker/src/handlers/like.ts:21-28`

```ts
await DELETE FROM article_likes ...;
await UPDATE articles SET like_count = like_count - 1 ...;
```

两步独立 `await`，中间失败即计数漂移（`like_count` 与 `article_likes` 实际行数不一致）。无后台校验/修复接口。

**修复建议**：用 `env.DB.batch([...])` 包成同一批；并加一个 admin 接口 `POST /admin/reconcile-counters` 按 `COUNT(*)` 重算 `like_count` / `comment_count`。

---

#### M10 — 搜索异常被完全吞掉，LIKE 回退未转义通配符

**位置**：`worker/src/handlers/search.ts:143`（`catch {}`）、`:149-174`

- `catch {}` 无任何日志 → FTS 长期静默失败无法发现。
- LIKE 回退里 token 未转义 `%` / `_` → 输入 `%` 命中全表。
- LIKE 回退无索引可用 → `COUNT(*)` + 分页 = 两次全表扫描。

**修复建议**：`catch (e) { console.error('[search] fts failed', e); }`；token 用 `ESCAPE '\'` 转义 `%_\\`；或长期改为把关键词也写入 FTS，去掉 LIKE 回退。

---

#### M11 — 删除用户无自我保护

**位置**：`worker/src/handlers/auth_handler.ts:567-593`

README 声称有「自我降级保护」，实际只在角色降级时校验（`:511-521`）；删除路径未做 self 检查 → admin 可把自己删掉。

**修复建议**：`if (Number(id) === 当前登录用户 id) return error(...)`

---

#### M12 — 数据库迁移不可重复执行，无迁移工具

**位置**：`worker/schema.sql:194-213`（三条 `ALTER TABLE` + 一条 `UPDATE` 置于文件尾，README:477 已注明）

- 整文件重跑会 `duplicate column` 报错；跨环境（本地 / 预发 / 生产）靠人工记忆执行到哪一步。
- 没有 `migrations/` 目录与 `wrangler d1 migrations` 流程 → 环境漂移只是时间问题。

**修复建议**：把尾部迁移拆成 `worker/migrations/000X_*.sql`，接入 `wrangler d1 migrations apply blog-db --remote`；`schema.sql` 只保留「全新库」形态。

---

#### M13 — 后台文章预览用 DOMPurify **默认配置**，与生产白名单不一致

**位置**：`src/admin/App.vue:1510-1521`（`updatePreview`）→ `:1453`（`v-html="previewHtml"`）

```ts
const raw = marked.parse(articleForm.value.content) as string;
previewHtml.value = DOMPurify.sanitize(raw); // ❗无配置 = DOMPurify 默认
```

对比生产侧：同一份内容由 `src/utils/markdownServer.ts:16-19` 用 `ARTICLE_BODY_SANITIZE_HTML_OPTIONS` 严格消毒。

- DOMPurify 默认放行 `<form>`、`<input>`、以及 **SVG / MathML 命名空间**——这正是历史 mXSS（命名空间混淆绕过）的高发面；而项目自己的白名单（`markdownPolicy.ts`）明确不放行这些。
- 后果：① **editor 可构造 Markdown，让管理员在后台预览时执行 JS** → 窃取 `admin_token` → **权限提升**；② 预览与线上渲染结果不一致（所见非所得）。

**修复**：`updatePreview()` 改为直接调用 `renderMarkdown()`（`src/utils/markdown.ts:14-17`，已绑项目策略），或导出 `sanitizePreviewHtml(html)` 复用 `ARTICLE_BODY_DOMPURIFY_CONFIG`。

---

#### M14 — `data-i18n-params` 是死属性，且导致**可见文案回归**

**位置**：`src/pages/categories/[slug].astro:12`、`src/pages/tags/[slug].astro:12`

```html
<h1 class="page-title" data-i18n="page.category" data-i18n-params='{"name":""}'>
  分类: {slug}
</h1>
```

- 写入了 `data-i18n-params`，但 `refreshDomTranslations`（`src/utils/i18n.ts:62-70`）**只处理 `data-i18n` 与 `data-i18n-placeholder`，从不读取 params**。
- 字典里 `page.category = "分类: {name}"` / `page.tag = "标签: {name}"`。
- 于是每次 `astro:page-load` 或语言切换后执行 `el.textContent = t(key)`，会把 SSR 渲染的真实标题（如"分类: tech"）**覆盖成字面量 `分类: {name}`**，用户直接看到花括号。

**修复**：让 `refreshDomTranslations` 解析 `data-i18n-params`（`JSON.parse` 包 try/catch）并调用 `t(key, params)`；或删除该属性、在 SSR 侧渲染不含占位符的完整文案。

---

#### M15 — escape 实现四份且口径不一致（其中一份漏转义 `'`）

**位置**：`src/utils/escape.ts:12-20`、`src/pages/categories/index.astro:96-103`、`src/pages/search.astro:118-125`、`src/pages/tags/[slug].astro:57-61`

- 前三者转义 `& < > " '`；`tags/[slug].astro` 的本地 `esc()` **只转义 `& < > "`，漏了 `'`**。
- 该副本恰好用在 `categories/[slug].astro` 同款模板上，若将来出现单引号属性包裹即为破绽。

**修复**：全仓统一 `import { escapeHtml, escapeAttr } from '../utils/escape.ts'`，删除 3 份本地副本；建议加一条 lint 规则禁止重复定义。

---

#### M16 — 指纹资产无 `immutable` 长缓存

**位置**：`public/_headers`（只有 `/*` 安全头块与 HTML 路由护栏块，无 `/_assets/*` 规则）

- `dist/_assets/*.js|css` 均带内容哈希，却**没有** `Cache-Control: public, max-age=31536000, immutable` 规则 → 每次访问都要回源校验。

**修复**：在 `scripts/security-headers.mjs` 的 `renderHeadersFile()` 中增补规则块（**顺序上必须在 `/*` 之后**，Pages `_headers` 后出现者优先）：

```
/_assets/*
  Cache-Control: public, max-age=31536000, immutable
```

然后 `npm run gen:headers && (cd worker && npm test)` 同步生成物与镜像断言。

---

#### M17 — `/categories`、`/tags` 系列声明为 SSR，但服务端零产出

**位置**：`src/pages/categories/index.astro:4`、`categories/[slug].astro:4`、`tags/index.astro:4`、`tags/[slug].astro:4`（均 `prerender = false`），数据全部由客户端 `fetch` 拉取（`categories/index.astro:105-142`、`categories/[slug].astro:58-121`、`tags/index.astro:75-106`、`tags/[slug].astro:62-126`）。

**代价**：① 每次访问都走 Worker（冷启动 + middleware）；② 触发 BaseLayout 自请求拉 settings（见 **P1**）；③ 首屏 HTML 是空壳，非 JS 抓取器什么都拿不到 —— 却付出了 SSR 的全部成本。

**修复**：二选一 —— 复用 `articleServer.ts` 模式补 SSR 首屏；或直接改回预渲染（省掉 SSR 开销），不要把页面停在"半 SSR"。

---

#### M18 — 后台 SPA 与岛屿零测试覆盖

**缺失测试的关键路径**：

- `src/utils/settings.ts` —— **唯一把远端 JSON 写进 `<style>` 的路径**，却零测试（`}` 逃逸、`url(javascript:)`、非 http scheme、NaN/负数、超长值、容器被污染为字符串，全靠人工 review）
- `src/pages/api/v1/[...path].ts` —— 开放代理、hop-by-hop 头、`%2e%2e` 前缀逃逸、超时缺失
- `src/admin/App.vue`（3,578 行）—— 含 `v-html` 预览、编辑锁、权限分支
- `src/utils/escape.ts` —— 消毒兜底层
- i18n 字典对称性（本次靠一次性脚本才发现 `{name}` 回归）

---

#### M19 — 富文本策略三套并存，互不共享

| 策略         | 位置                                  | 消费方                                                                 | 机制                        |
| ------------ | ------------------------------------- | ---------------------------------------------------------------------- | --------------------------- |
| 前端正文     | `src/utils/markdownPolicy.ts`         | `markdown.ts:16`（DOMPurify）、`markdownServer.ts:18`（sanitize-html） | 白名单 ✅                   |
| 前端搜索高亮 | `src/utils/escape.ts:36-40`           | `SearchBox.vue`                                                        | `ALLOWED_TAGS: ['mark']` ✅ |
| Worker 正文  | `worker/src/utils/sanitizer.ts:14-29` | `comment.ts:46`、`admin.ts:288`                                        | **正则黑名单** ❌           |

- `sanitizer.ts:1-5` 的 `ALLOWED_TAGS`（26 个标签）与 `:7-12` 的 `ALLOWED_ATTR` **全仓零引用**（grep 仅命中定义与导出三行）——是"定义了但没接线"的死代码，却制造了"有白名单在生效"的假象。

**黑名单已知可绕过点（`sanitizer.ts:14-29`）**

- 未闭合标签：`<script src=//evil.com>` 因缺 `</script>` 不被第 17 行正则匹配，浏览器照常执行
- 实体绕过：`href="javascript&#58;alert(1)"` 中的 `&#58;` 不被第 21 行 `javascript\s*:` 识别，浏览器解码后即 `javascript:` URL
- 未覆盖标签：`<meta http-equiv="refresh">`、`<base href=//evil>`、`<frameset>`、`<noscript>` 包裹型 mXSS
- SVG 载体：`<animate attributeName="href">`、`<foreignObject>` 无人处理

**修复**：`sanitizer.ts` 直接改用 `sanitize-html` 并真正消费 `ALLOWED_TAGS` / `ALLOWED_ATTR`（Worker 侧已在 `markdownServer.ts` 依赖它，无新增依赖），补 XSS 回归用例。

---

#### M20 — 路由注册粒度粗，参数解析脆弱

**位置**：`worker/src/router.ts:42-75`

- `:id` 编译为 `([^/]+)` 而非 `(\d+)` → `PUT /api/v1/articles/abc` 先命中路由，再在 `article.ts:143` 做 `Number(id)` 得到 `NaN` 后 `bind(NaN)`
- 通配 `*` 的参数名硬编码为字符串 `'0'`，消费端 `media.ts:181` 写 `params['0']`，靠约定维系
- `patternStr` 未对路径中的正则元字符转义（当前路径均安全，属潜在地雷）
- 线性首匹配、注册顺序敏感（`/articles/:slug` 早于 `/articles/:id/edit-lock`，靠 `$` 锚点才没冲突），无注释说明

**修复**：区分 `:id`（`(\d+)`）与 `:slug`（`[\w-]+`）；通配参数名改为具名；`patternStr` 生成前统一转义；按 method 分桶。

---

#### M21 — 分层越界：handlers 直接写 SQL，service 层被架空

| 位置                                                        | 问题                                                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `handlers/article.ts:96-98, 121-125, 166-170`               | handler 直接查 slug 重复，绕过 `article_service`                                               |
| `handlers/comment.ts:89-96, 120, 123, 133, 144`             | 全部内联 SQL；`:123` 就地用子查询重算 `comment_count`，service 层零参与                        |
| `handlers/search.ts:94-194`                                 | 单个 handler 同时承担分词 / FTS / LIKE 回退 / 高亮 / 转义，无 service / model                  |
| `services/article_service.ts:95-100, 137-141, 201, 252-253` | service 反调 `getArticleBySlug` 做「写后重读」，与 handler 的响应形成回环                      |
| 多处                                                        | 「按 username 查 user id」重复约 10 处；「取文章 tags」在 `:96-100` 与 `:137-141` 逐字重复两遍 |
| `models/*.ts`（8 文件 118 行）                              | 几乎全是不再被引用的「文档式」interface（如 `CreateCategoryRequest` 从未使用）                 |
| `utils/response.ts:29-45, 75-77`                            | `success()` / `paginated()` / `serverError()` 三个导出无人调用                                 |

---

#### M22 — 索引缺失与 `SELECT *`

**缺失索引**（`schema.sql:109-117` 只有 8 个二级索引）

- `media_assets(uploaded_by)` → `media.ts:135` 的 `WHERE uploaded_by = ?` 全表扫描
- `comments(article_id, status)` 复合 → `handleListComments` 两条查询各走单列索引后回表
- `friend_links(is_active)` → `friend_link.ts:7` 每页全表扫描（表小，影响有限）

`SELECT *` 位置：`article_service.ts:127`、`admin.ts:165`（导出 9 张表全表全列）、`category.ts:14/51/86`、`friend_link.ts:13/49/69`、`media.ts:143`。
其中 `GET /admin/export` 尤其危险：无流式分片、无行数上限，数据量大时是内存炸弹。

---

#### M23 — `/health` 无鉴权且回显 D1 异常原文

**位置**：`worker/src/router.ts:76-83`

```ts
catch (e) { return Response.json({ status: 'error', message: String(e) }); }
```

- 任何人可拿到 D1 异常原文（含表名 / 列名 / SQL 片段），同时是免费的数据库存活探针。

**修复**：生产环境对外只返回 `status: 'error'`，详情进日志；或加共享密钥 / 仅内网可达。

---

### 5.3 Low

| ID  | 问题                                                                                                       | 位置                                             |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| L1  | 3 个未使用依赖：`highlight.js`（0 引用）、`vue-router`（0 引用）、`uuid`（代码只用 `crypto.randomUUID()`） | `package.json:31,36,34`                          |
| L2  | 无 ESLint，仅 prettier + husky；未使用变量只产生 hint，不会拦截                                            | `.lintstagedrc`、`.husky/pre-commit`             |
| L3  | `src/admin/App.vue` 3,578 行巨石组件（template 1,481 / script 1,187 / style 907）                          | `src/admin/App.vue`                              |
| L4  | `BaseLayout.astro` 内联 script 约 600 行，6 类逻辑混杂且无测试                                             | `src/components/layout/BaseLayout.astro:174-780` |
| L5  | `hashIp` 盐硬编码在源码（`-salt-blog-2024` / `-salt-like-2024`），IPv4 空间小 → ip_hash 可彩虹表反推       | `handlers/comment.ts:152`、`handlers/like.ts:6`  |
| L6  | `handleServeMedia` 无鉴权，草稿图片可被枚举访问                                                            | `handlers/media.ts:180-210`                      |
| L7  | CSP 保留 `style-src 'self' 'unsafe-inline'`（为动态 settings 内联样式），script-src 收紧后样式仍是注入面   | `scripts/security-headers.mjs:30`                |
| L8  | CI `sleep 120` + 二次覆盖部署：部署时长翻倍，依赖「Git 集成自动部署」的隐式时序                            | `.github/workflows/deploy.yml:121-137`           |
| L9  | `handleToggleLike` 对不存在的 `article_id` 返回 400 而非 404，与其余接口语义不一致                         | `handlers/like.ts:15-17`                         |
| L10 | 路由启动时编译全部正则、运行时线性扫描 ~50 条；当前量级无碍，但无按 method 分桶                            | `router.ts:36-75`                                |

---

## 6. 性能瓶颈（按影响排序）

### P1 — 文章详情页一次请求要跑 3 条上游链路

| 链路                                        | 位置                      | 超时  |
| ------------------------------------------- | ------------------------- | ----- |
| `GET /api/v1/articles/:slug`（直连 Worker） | `articleServer.ts:72`     | 8s    |
| `GET /api/v1/config`（站点标题）            | `siteTitleServer.ts`      | 无    |
| `GET /api/v1/settings/public`               | **`BaseLayout.astro:51`** | 800ms |

第三条尤其值得注意：BaseLayout 在 **SSR 阶段 fetch 自己站点的 `/api/v1/settings/public`**，而该路径又会经 `src/pages/api/v1/[...path].ts` 再代理一跳到 Worker——**自己请求自己，多一次完整网络往返**，且只有 800ms 预算，超时就静默回退默认值（首屏与客户端不一致，出现样式跳动）。

**修复建议**

1. SSR 路径直接调用 Worker origin（和 `loadArticleForPage` 一样用 `WORKER_ORIGIN`），不要绕自己的 `/api/v1` 路由。
2. 把「文章 + 站点标题 + settings/public」合并为一次并行 `Promise.all` 放在**页面**里（现在 config 与 article 并行了，但 settings 在布局里，是第三处独立发起）。
3. settings 加进程内短缓存（60s）+ `site-settings-version` 校验，避免每个 SSR 请求都打后端。

### P2 — 一次文章访问 = 一次 D1 写，且页面明确不缓存

`article_service.ts:261-271` 在每次 `GET /articles/:slug` 时 `UPDATE articles SET view_count = view_count + 1`；同时 `articleServer.ts:131` 设置 `Cache-Control: private, no-cache`。

后果：浏览量无法被任何层缓存吸收，全部落到 D1 单写者；爬虫 / 扫描器 / 刷新刷访问会直接放大为写负载（且 GET 类读接口**不被限流**，见 **M3**）。

**修复建议**

```ts
// 方案 A（改动最小）：KV 计数 + 定时落库
const key = `views:${id}`;
const n = Number((await env.VIEWS.get(key)) || 0) + 1;
await env.VIEWS.put(key, String(n), { expirationTtl: 60 });
// 由 Cron Worker 每 60s 批量 UPDATE articles SET view_count = view_count + ?
```

方案 B（更简单）：`ctx.waitUntil()` 内做异步写，主响应不阻塞；配合 KV 去重保留 24h Cookie 语义。

### P3 — 首页 / 列表页首屏无内容，依赖客户端二次请求

`src/pages/index.astro:203`、`src/pages/articles/index.astro:57` 在客户端再 fetch 一次 `/api/v1/articles`。

- 首屏 HTML 是空骨架（文章链接不在 HTML 内），与文章详情页「SSR 首屏出正文」的取向不一致；
- 首屏内容延迟到 JS 执行后才出现；
- SEO 只靠 `sitemap.xml` 暴露文章页，首页 / 列表页自身不贡献内链。

### P4 — Admin 包体偏大（仅影响后台）

`dist/_assets/index.astro_astro_type_script_index_0_lang.BwHedeyz.js` **901 KB**，`index.v2dh7-NQ.css` **357 KB**。

原因：`src/pages/admin/index.astro` 用 `app.use(ElementPlus)` 全量注册 + `import 'element-plus/dist/index.css'` 全量样式，没做按需引入/树摇。

**修复建议**：改用 `unplugin-vue-components` + `ElementPlusResolver` 按需引入；或至少改为只 `import` 用到的组件，样式按组件引入。

### P5 — 代理通道每次请求都做 DoH 查询

`img_proxy.ts:250-321`：每个新主机都要 2 次 DoH 请求（A + AAAA），单查询超时 3s；重定向每遇到新主机再重复。图片代理链路总延迟 = DoH(最多 3s) + 上游 RTT + 读取。

**修复建议**：把「主机 → 解析结果/判定」缓存进 KV（TTL 300s），命中则跳过 DoH；fail-closed 语义保持不变（缓存只存 `ok` 判定，负面判定短 TTL 或不缓存）。

---

## 7. 优化建议（按阶段）

### 第一阶段：低风险、当天可完成

1. **删除死配置**：`git rm worker/wrangler.toml`；根目录 `wrangler.jsonc` 改名或加显式禁令说明（H2）。
2. **修掉 fail-open**：`category.ts:61-66` 改为「用户解析失败即拒绝」（M5）。
3. **统一错误出口**：`router.ts:202-208` 对外不再回显内部异常（M4）。
4. **参数解码加固**：`router.ts:65-69` 的 `decodeURIComponent` 包 try/catch，非法编码返回 400。
5. **搜索不再吞异常**：`search.ts:143` 补 `console.error`；LIKE token 加 `ESCAPE` 转义（M10）。
6. **删除用户自保护**：`auth_handler.ts:567-593` 禁止删除自己（M11）。
7. **配置写入白名单**：`config.ts:26-34` 限定可写键并拒绝空 `jwt_secret`（M8）。
8. **卸载未使用依赖**：`npm uninstall highlight.js vue-router uuid`（L1）。
9. **修掉 i18n 文案覆盖丢失**：把 `getDefaultSettings():139` 的 `copy: { zh: {}, en: {} }` 改为显式键清单，让 `deepMerge` 的 `Object.keys(base)` 非空（H11，见 §8.1）。
10. **删掉误导性死 import**：`article.ts:4` 的 `sanitizeHtml` 与 `media.ts:3` 的 `validate`（§8.2）。

### 第二阶段：结构性改进（1～2 周）

11. **收敛 IP 解析**：新建 `worker/src/utils/client_ip.ts`，`like` / `comment` / `rate_limit` / `img_proxy` 统一调用，补测试（H3）。
12. **消除 N+1 与正文搬运**：`listArticles` 改为单查询 + `group_concat`，并把 `reading_time` 落库（M1、M2）。
13. **白名单化消毒器**：`sanitizer.ts` 改用 `sanitize-html` 并真正消费 `ALLOWED_TAGS` / `ALLOWED_ATTR`，补 XSS 用例（M6）。
14. **代理层 CORS 收敛**：`src/pages/api/v1/[...path].ts` 改为回显白名单 Origin + 加 10s 超时（H4）。
15. **SSR 取数合并**：settings 走 `WORKER_ORIGIN` 直连，与文章 / config 合并为一次 `Promise.all`，并加 60s 进程内缓存（P1）。
16. **点赞计数事务化**：改用 `env.DB.batch`，增加计数对账接口（M9）。
17. **接入迁移工具**：`worker/migrations/000X_*.sql` + `wrangler d1 migrations apply`（M12）。

### 第三阶段：工程质量基础设施

18. **CI 增加 `pull_request` 触发**：当前 `deploy.yml` 只在 `push: main` 跑，所有门禁（漂移断言 / typecheck / 单测 / SSR 回归）都在**合入之后**才执行，坏提交无法被拦截。
    ```yaml
    on:
      push:
        branches: [main]
      pull_request: # 新增
        branches: [main]
    ```
    并给 `deploy` job 加 `if: github.event_name == 'push'`，或拆成 `verify` / `deploy` 两个 job，`deploy` 用 `needs: verify`。
19. **加 `concurrency`** 防并发部署互相覆盖：
    ```yaml
    concurrency:
      group: deploy-${{ github.ref }}
      cancel-in-progress: false
    ```
20. **action SHA 钉版**：`actions/checkout@v4`、`actions/setup-node@v4`、`cloudflare/wrangler-action@v3` 改为完整 commit SHA + 版本注释（供应链风险）。
21. **引入 ESLint**（`@typescript-eslint` + `eslint-plugin-vue` + `eslint-plugin-astro`），把未使用变量、any、危险 `innerHTML` 变成硬错误。
22. **拆分巨石**：`App.vue` 按 tab 拆为 `src/admin/tabs/*.vue` + `composables/use*.ts`；`BaseLayout` 的内联 script 拆为 `src/utils/themeBoot.ts`、`src/utils/hitokoto.ts`、`src/utils/proxyFetch.ts` 并补单元测试。
23. **去掉 `handlers` 里的 `await import()` 动态导入**（除真正懒加载的 `scrape`），改为顶部静态 import。

---

## 7-bis. CI/CD 与工程配置专项（深度审计补充）

### 7-bis.1 供应链：third-party action 未 pin SHA，且直接握有生产 Token

**位置**：`.github/workflows/deploy.yml:17`（`actions/checkout@v4`）、`:20`（`actions/setup-node@v4`）、`:107`、`:125`（`cloudflare/wrangler-action@v3`）

- `wrangler-action` **非 GitHub 官方 action**，浮动 tag `@v3` 指向可变 commit，且与 `apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}`（`:109/128`）直连——该 Token 可修改 Pages 与 Workers 生产环境。
- 另两处 `uses` 同样未 pin。
- **无任何 Dependabot / Renovate / CODEOWNERS 配置**（`.github` 下仅 `deploy.yml` 一个文件）。

**修复**

```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
- uses: actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a # v4.4.0
- uses: cloudflare/wrangler-action@<真实 SHA> # v3.x
```

取 SHA：`gh api repos/cloudflare/wrangler-action/git/ref/tags/v3 --jq .object.sha`

---

### 7-bis.2 `npx wrangler deploy` 是隐式依赖，本地缺包时会静默下载任意版本部署生产

**位置**：`.github/workflows/deploy.yml:115`、`:133`

- `npx` 契约：本地命中则用本地，miss 则从 registry 下载。当前「侥幸」命中 `worker/node_modules/.bin/wrangler`。
- 一旦 worker 依赖安装失败或 wrangler 被误删，CI 会用**未被 lockfile 约束的版本**部署生产。

**修复**：`worker/package.json:7` 已定义 `"deploy": "wrangler deploy"`，改为

```yaml
- name: Deploy Worker
  working-directory: worker
  run: npm run deploy
```

---

### 7-bis.3 依赖树里 wrangler 3（EOL）与 wrangler 4 并存

实测：

```
node_modules/wrangler                                       = 3.114.17
node_modules/@astrojs/cloudflare/node_modules/wrangler      = 4.59.2
```

- 根 `package.json:51` 与 `worker/package.json:13` 均声明 `^3.80.0`；`@astrojs/cloudflare@12` 内部已升到 4.x 并隔离安装。
- 被跟踪的 `d1_output.txt` 里就有 wrangler 自报：`3.114.17 (update available 4.107.0)`。
- 风险：`astro build`（内置 4.x 行为）与 `wrangler deploy`（3.114.17）行为可能分化（compatibility flags、`_routes.json` 生成、部署协议）。

**修复**：统一升到 wrangler 4 最新，并把 worker 的 wrangler 从 `dependencies` 移到 `devDependencies`（`worker/src/index.ts` 从不 import 它）。

---

### 7-bis.4 `.gitattributes` 漏覆盖两个生成物 → 潜在的行尾环境性误红

**位置**：`.gitattributes`（仅 2 行）

```
public/_headers text eol=lf        ✅ 已覆盖
src/generated/settings-rules.ts    ❌ 未覆盖
worker/src/generated/settings-rules.ts  ❌ 未覆盖
```

- `worker/tests/settings_rules.test.ts:62` 是 `expect(root).toBe(worker)` 的**逐字节**比较。
- 当前两份恰好都是 LF（已实测 `含CR 0`），但无强制约束；本机 `core.autocrlf=true`，任何会做行尾转换的工具碰过就可能出现「本地红、CI 绿」的难以定位失败。

**修复**（一行）：

```gitattributes
src/generated/*.ts text eol=lf
worker/src/generated/*.ts text eol=lf
```

---

### 7-bis.5 `sleep 120` + 二次覆盖部署：与 README 自相矛盾，且无收敛校验

**位置**：`.github/workflows/deploy.yml:121-137`

矛盾点：

- `README.md:516`：等待 120s 让 Git 集成自动部署落定，再各覆盖一次。
- `README.md:509`：**要求关闭** Dashboard 的 Automatic deployments。

若已关闭 → 这 120s + 两次重复上传是纯废弃逻辑；若未关闭 → Git 部署耗时 >120s 就会反覆盖本次产物，产生「CI 全绿但线上是旧版」的静默故障。且部署后**没有任何健康检查 step**。

**修复**：确认关闭 Git 自动部署后删除 step 16/17/18；若需保留，改为轮询 `dist/build-id.txt`（由 `patch-csp.mjs` 产出）与线上一致后再结束。

---

### 7-bis.6 CI 缺缓存 / concurrency / job 超时 / environment 保护

**位置**：`.github/workflows/deploy.yml:8-13`

- 全文无 `actions/cache`，`setup-node` 也未传 `cache: npm` → 每次冷跑两次 `npm ci` + playwright 安装 + apt deps + build。
- 无 `concurrency` → 并发 push 会并发部署（与上面的 sleep 竞态叠加，后果不可预测）。
- 无 job 级 `timeout-minutes`（只有两个 step 级），`--with-deps` 走 apt 卡住会长期占用配额。
- 无 `environment: production` → 无法用 GitHub Environment 的 required reviewers / wait timer。

**修复**

```yaml
deploy:
  runs-on: ubuntu-latest
  timeout-minutes: 30
  concurrency:
    group: deploy-${{ github.ref }}
    cancel-in-progress: false # 部署不取消在途，只排队
  environment: production
  permissions:
    contents: read
    deployments: write
  steps:
    - uses: actions/setup-node@<sha> # v4.4.0
      with:
        node-version-file: .node-version
        cache: npm
        cache-dependency-path: |
          package-lock.json
          worker/package-lock.json
```

---

### 7-bis.7 pre-commit 覆盖不足

**位置**：`.husky/pre-commit`（2 行）

```sh
npx lintstaged
cd worker && npm run typecheck && npm run test
```

缺失：根 `tests/` 的前端测试（`npm test`）、两条生成物漂移断言、前端类型门禁 `npm run check`。
→ **生成物漂移只能 push 后靠 CI 发现**，而 CI 每步都要付云端时长。

**修复**：漂移断言是零依赖、秒级，可安全前移：

```sh
npm run gen:settings && npm run gen:headers
git diff --quiet -- src/generated/settings-rules.ts worker/src/generated/settings-rules.ts public/_headers || { \
  echo "生成物漂移：请运行 npm run gen:settings && npm run gen:headers 并一并提交"; exit 1; }
npx lintstaged
npm run test
cd worker && npm run typecheck && npm run test
```

---

### 7-bis.8 仓库卫生：被跟踪的杂项与陈旧产物

| 项                | 状态                                                                                                          | 建议                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `d1_output.txt`   | **已 tracked**，内容只是 wrangler 启动横幅                                                                    | `git rm --cached` + gitignore                                  |
| `worker/dist/`    | 2026-07-10 的陈旧 tsc 产物（来自 `worker/tsconfig.json:13` `outDir`），已 gitignore，但**从不参与 CI 与部署** | 删除；`outDir` 改 `.tsc-out` 或移除（typecheck 走 `--noEmit`） |
| `.agents/skills/` | 103 个文件进 git（约全仓 34%），属工具链产物                                                                  | 考虑移出主仓或独立管理                                         |
| `.codeartsdoer/`  | 本地遗留，未 tracked                                                                                          | 可忽略                                                         |
| `ui-preview/`     | 3 个文件 tracked，预览脚手架                                                                                  | 确认是否仍需保留                                               |

另：`.gitignore` **未忽略 `.dev.vars` / `.env`**（wrangler 本地秘密文件），虽当前磁盘上无此类文件，但属制度缺口。

```gitignore
.dev.vars
.dev.vars.*
.env
.env.*
!.env.example
worker/dist/
d1_output.txt
```

---

### 7-bis.9 文档与实现漂移（约定层面）

**位置**：`docs/agents/testing.md:85` 声明「测试文件放 `worker/tests/`」，与同文件 `:11`（根 `tests/` + `npm test`）及 `deploy.yml:52-53` **直接冲突**。
→ 新接手者/agent 极易漏跑前端 10 个测试文件。建议统一表述并同步 `AGENTS.md:17`。

---

## 8. 代码质量与死代码（后端深度补充）

### 8.1 功能性缺陷：`deepMerge` 静默吞掉全部 i18n 文案覆盖

**这不是风格问题，是功能不可用。** 严重度建议按 **High** 处理（对应风险编号 **H11**）。

**位置**：`worker/src/handlers/settings.ts:149-159`

```ts
const out: any = { ...base };
for (const k of Object.keys(base as any)) {
  // ← 只遍历 base 的键
  if (k in override) out[k] = deepMerge((base as any)[k], (override as any)[k]);
}
```

**机理**：递归以 **base（默认值）的键集合**为准。而 `getDefaultSettings():139` 给出的是：

```ts
copy: { zh: {}, en: {} },   // ← 空容器，键集合恒为 []
```

于是 `copy.zh` / `copy.en` 两层递归的键集合恒为空 → 用户提交的每一条文案 **100% 被丢弃**。

**校验为什么没拦住**：`validateSettings` 的 `case "copy"`（`:213-221`）只断言「是普通对象 + 每个值是字符串且长度 ≤ cap」，空对象天然合法；更关键的是它校验的是 **`merged`（已被清空后的结果）而非 `body`**，所以永远不可能报错。

**后果**：`PUT /settings` 返回 **200「设置已保存」**，响应体里 `copy` 变回 `{}`，后台 UI 显示保存成功但刷新即回到默认文案。**i18n 文案覆盖功能完全不可用，且失败是静默的。**

**实测复现**（等价逻辑，node 直跑）：

```
输入 def   = {copy:{zh:{},en:{}}, site:{title:'T'}}
输入 body  = {copy:{zh:{hero_title:'喵'},en:{hero_title:'Meow'}}, site:{title:'X'}}
输出 merged= {"copy":{"zh":{},"en":{}},"site":{"title":"X"}}
                       ↑ 文案全丢        ↑ 普通字段正常
```

**修复**（两个方向，推荐后者）：

1. 给 `deepMerge` 对 `copy` 分区特判：键集合改取 `override`，再按「键名匹配 `/^[a-z][a-z0-9_]{0,63}$/`、`zh`/`en` 分区、值长度 ≤ cap」三重过滤后写入。
2. **把默认值改成显式键清单** —— 把所有可覆盖的文案键在 `getDefaultSettings()` 里列全，值为默认文案。这样 `Object.keys(base)` 非空，现有合并逻辑无需改动即可生效。附带收益：这份键清单可以直接喂给后台 UI 做下拉选项，避免管理员手打键名打错。

> 方向 2 更贴合现有架构（默认值即契约），且能顺带解决「后台不知道有哪些键可覆盖」的可发现性问题。

---

### 8.2 死代码与死 import 清单

| 位置                                  | 符号                            | 状态与风险                                                                    |
| ------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------- |
| `worker/src/handlers/article.ts:4`    | `import { sanitizeHtml }`       | **死 import，且有害** —— 制造「文章正文入库前已消毒」的假象                   |
| `worker/src/handlers/media.ts:3`      | `validate`                      | 死 import，无害                                                               |
| `worker/src/handlers/search.ts:29-49` | `buildLikeClause`               | 定义后零调用（实际 LIKE 拼接内联在 `:149-158`）                               |
| `worker/src/utils/sanitizer.ts:31-33` | `stripAllHtml`                  | 零调用；语义是「去标签」而非「净化」，误用会留洞                              |
| `worker/src/utils/response.ts:29-45`  | `success()` / `paginated()`     | 零调用（实际用 `successResponse` / `paginatedResponse`）—— **命名近似易误用** |
| `worker/src/utils/response.ts:75-77`  | `serverError()`                 | 零调用                                                                        |
| `worker/src/utils/sanitizer.ts:1-12`  | `ALLOWED_TAGS` / `ALLOWED_ATTR` | 定义并导出后**零引用**                                                        |

**`article.ts:4` 那一行是本次审查里最该优先删掉的一行。** 它不是无害冗余——它会让后续维护者（包括接手的 agent）以为文章正文入库前做了 HTML 净化，从而放松警惕。真实的链路是：`article.content_html` 入库恒为空串，正文在**前端**用 marked + DOMPurify 渲染，**服务端零净化**。删掉这个 import，等于把这条事实重新暴露出来。

**`response.ts` 的命名问题值得单独处理**：`success` / `successResponse`、`paginated` / `paginatedResponse` 两套并存且其中一套是死的，极易写错。建议删除死的那套，只保留 `successResponse` / `paginatedResponse`。

---

### 8.3 富文本策略三套并存（与 M19 同一问题域的后端视角）

- `worker/src/utils/sanitizer.ts` —— 正则黑名单（_*已被证明不安全，且 ALLOWED_* 是死的_*）
- `src/utils/markdownPolicy.ts` —— DOMPurify 白名单 + sanitize-html 双端同构（**唯一可信**）
- `worker/src/handlers/article.ts:4` —— 只 import 不用（**假象**）

建议：确认 `markdownPolicy.ts` 为唯一真源；删除 `sanitizer.ts` 的 `ALLOWED_TAGS` / `ALLOWED_ATTR` / `stripAllHtml`；`sanitizeHtml` 若仍被外链代理路径使用，需加注释明确「仅用于二次确认，不构成主防线」。

---

## 9. 测试覆盖缺口

**现状**：前端 10 文件 / **90** 用例；worker 10 文件 / **84** 用例。门禁全绿，但覆盖分布**严重偏向「规则/生成物」而非「业务处理逻辑」**。

### 9.1 worker 侧零测试清单

| 模块                              | 行数    | 说明                                                                                                           |
| --------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `handlers/auth_handler.ts`        | **593** | **全仓最大文件，零测试**。涵盖登录/登出/改密/建号/重置口令/删用户/失败锁定 —— C2、C4、H6、H7、M11 全部落在这里 |
| `utils/password.ts`               | 89      | PBKDF2 / 恒定时间比较 / **迭代数解析（C3）** / 旧格式升级 / `fakeVerifyPassword`（C4）                         |
| `router.ts`                       | 210     | 路由编译、参数解析、`:190-192` 强制改密拦截、`:202-208` 顶层 catch                                             |
| `middleware/cors.ts`              | —       | 白名单精确匹配、`Vary`                                                                                         |
| `middleware/rate_limit.ts`        | —       | key 构造（**H8**）、窗口边界、非原子自增（**H4** 相关）                                                        |
| `utils/sanitizer.ts`              | 46      | 正则黑名单                                                                                                     |
| `handlers/search.ts`              | 194     | FTS 与 LIKE 回退（**M10**）                                                                                    |
| `handlers/comment.ts` / `like.ts` | —       | 越权场景                                                                                                       |

### 9.2 根因：`settings_rules.test.ts` 只测了 `validateSettings`，没测 `deepMerge`

这正是 §8.1 那个 copy bug 漏网的**直接原因**：现有测试断言「非法值会被拒绝」，却从未断言「合法值写完能读回来」。后者才是能一次性抓住 `deepMerge` 类缺陷的断言。

**建议**：补一条**往返契约测试**（write → read → 断言相等），针对每个分区各挑一个代表字段。`deepMerge` 的键集合 bug、`validateSettings` 的错配、序列化丢字段，三类缺陷都能被这一条测试兜住。

### 9.3 补测优先级

按**风险优先级**而非**覆盖率数字**排：

1. C1–C4 与 H1–H5 的回归测试（先锁住已知缺陷，防止修完回退）
2. `auth_handler.ts` 的建号 / 重置口令 / 改密闸门 / 锁定退避
3. `password.ts` 的迭代数上下界与旧格式升级
4. settings 往返契约测试
5. 越权矩阵（editor 对每个写接口的访问结果）

---

## 10. 附：门禁实测结果

| 门禁               | 命令                                             | 结果                                       |
| ------------------ | ------------------------------------------------ | ------------------------------------------ |
| 前端单元测试       | `npm test`                                       | ✅ 10 files / **90 tests passed**          |
| Worker 单元测试    | `cd worker && npm test`                          | ✅ 10 files / **84 tests passed**          |
| 前端类型门禁       | `npm run check`                                  | ✅ 66 files，0 errors、0 warnings、5 hints |
| 设置规则漂移断言   | `npm run gen:settings && git diff --exit-code`   | ✅ clean                                   |
| 安全头漂移断言     | `npm run gen:headers && git diff --exit-code`    | ✅ clean                                   |
| 双端生成物字节一致 | `cmp src/generated/... worker/src/generated/...` | ✅ 一致（md5 `17692a5c…`）                 |

工作区当前无未提交改动（`git status --short` 为空），最近提交为 `279e6ef docs: 补充浏览器回归设计检查单（P5）`。

---

## 11. 待确认项（需一次线上实测）

| 项                                     | 说明                                                                                                                     | 验证方式                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 访客 IP 是否穿透 Pages → Worker 子请求 | 决定 **H3** 是真 bug 还是虚警                                                                                            | 在 `like.ts:13` 后打日志，两个不同网络各点赞一次，`npx wrangler tail blog-api` 比对 `CF-Connecting-IP` 与 `X-Real-IP` |
| zone 级 CORS 边缘规则是否仍在          | 工作记忆记载 `zenfishlog.dpdns.org` 上有硬加 `Access-Control-Allow-Origin: *` 的 Transform Rule，需人工在 Dashboard 删除 | `curl -I https://blog.zenfishlog.dpdns.org/` 检查响应头                                                               |
| `dist/` 是否需要入 git                 | 工作记忆记载「dist 必须进 git」，但实测 `git ls-files dist` 为 0 且 `.gitignore` 已忽略 `/dist/`（issue #29 决策）       | 以 `.gitignore` 与 CI 流程为准，工作记忆需更新                                                                        |

---

## 12. 严重度汇总清单

**合计：Critical 4 · High 11 · Medium 23 · Low 10 = 48 条。**

### 12.1 Critical（4）—— 建议 48 小时内处理

| ID     | 一句话                                                                                                                    | 主责文件                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **C1** | 友链 URL 无 scheme 白名单 + 写接口对 editor 开放 + 前端 `:href` 无清洗 → **全站页脚存储型 XSS，可窃管理员令牌并接管站点** | `utils/validator.ts:65-72`、`router.ts:150-152`、`islands/FriendLinkList.vue:6` |
| **C2** | 建号 / 重置口令不置 `must_change_password=1`、无强度校验 → **强制改密闸门可绕开**；`role` 表达式静默提权                  | `handlers/auth_handler.ts:443-485, 529-535`                                     |
| **C3** | `jwt_secret` 初始为空且**全仓无生成流程** → 全新部署管理员登录永久 500，且异常原文回显给匿名方                            | `schema.sql:171`、`middleware/auth.ts:137-143`                                  |
| **C4** | 登录无口令长度上限 + `fakeVerifyPassword` 跑满 KDF → **匿名 CPU DoS**                                                     | `handlers/auth_handler.ts`、`utils/password.ts:87-89`                           |

### 12.2 High（11）—— 建议两周内处理

| ID      | 一句话                                                       |
| ------- | ------------------------------------------------------------ |
| **H1**  | 种子管理员口令硬编码为 `password`（`utils/seed.ts:13`）      |
| **H2**  | 三份 wrangler 配置，两份是过期死配置（改错文件不生效）       |
| **H3**  | 客户端 IP 解析口径不统一，点赞去重 / 评论 `ip_hash` 可能失真 |
| **H4**  | 同源 API 代理把 Worker 收敛后的 CORS 白名单重新放开          |
| **H5**  | 全量导入是无刹车的破坏性操作                                 |
| **H6**  | 创建用户不置 `must_change_password`，且口令无强度校验        |
| **H7**  | 管理员重置他人口令不置 `must_change_password=1`              |
| **H8**  | 限流 key 含 pathname → 按资源分桶，配额形同虚设              |
| **H9**  | `admin/import` 全程非事务，失败即留半空数据库；删 KV 未同步  |
| **H10** | DoH 校验与真实建连之间的 TOCTOU / DNS rebinding              |
| **H11** | `deepMerge` 以默认值键集合为准 → i18n 文案覆盖 100% 静默丢失 |

### 12.3 Medium（23）—— 建议排入下个迭代

| ID  | 领域   | 一句话                                            |
| --- | ------ | ------------------------------------------------- |
| M1  | 性能   | 列表查询 N+1：每篇文章单独查一次标签              |
| M2  | 性能   | 列表接口把全量 Markdown 正文从 D1 搬到前端再丢弃  |
| M3  | 架构   | 限流实现偏弱且三处重复                            |
| M4  | 安全   | 顶层 catch 把内部错误原文回给客户端               |
| M5  | 安全   | 所有权校验散落各 handler，口径不一致              |
| M6  | 安全   | 消毒器是正则黑名单，两个白名单常量定义后从未使用  |
| M7  | 安全   | 图片代理可同源返回可执行 SVG，缺纵深防御          |
| M8  | 安全   | 配置写入无键白名单，`jwt_secret` 可被写空         |
| M9  | 一致性 | 点赞计数与记录非同一事务，无对账入口              |
| M10 | 正确性 | 搜索异常被完全吞掉，LIKE 回退未转义通配符         |
| M11 | 安全   | 删除用户无自我保护                                |
| M12 | 工程   | 数据库迁移不可重复执行，无迁移工具                |
| M13 | 安全   | 后台预览用 DOMPurify 默认配置，与生产白名单不一致 |
| M14 | 质量   | `data-i18n-params` 死属性，且导致可见文案回归     |
| M15 | 质量   | escape 实现四份且口径不一致（一份漏转义 `'`）     |
| M16 | 性能   | 指纹资产无 `immutable` 长缓存                     |
| M17 | 架构   | `/categories`、`/tags` 声明 SSR 但服务端零产出    |
| M18 | 测试   | 后台 SPA 与岛屿零测试覆盖                         |
| M19 | 架构   | 富文本策略三套并存，互不共享                      |
| M20 | 架构   | 路由注册粒度粗，参数解析脆弱                      |
| M21 | 架构   | 分层越界：handlers 直接写 SQL，service 层被架空   |
| M22 | 性能   | 索引缺失与 `SELECT *`                             |
| M23 | 安全   | `/health` 无鉴权且回显 D1 异常原文                |

### 12.4 Low（10）—— 有余力再清

L1 三个未使用依赖（`highlight.js` / `vue-router` / `uuid`）· L2 无 ESLint · L3 `admin/App.vue` 3,578 行巨石组件 · L4 `BaseLayout.astro` 内联 600 行无测试 · L5 `hashIp` 盐硬编码且 IPv4 可彩虹表 · L6 草稿图片可被枚举 · L7 CSP 仍留 `style-src 'unsafe-inline'` · L8 CI `sleep 120` 二次部署 · L9 点赞错误码语义不一致 · L10 路由无 method 分桶。

### 12.5 建议的处理顺序（依赖感知）

```
第一批（安全止血，可并行）
  C1 友链 scheme 白名单 ──┐
  C4 口令长度上限        ├─ 都是小改动，单文件可完成
  C2 建号/重置置位       ─┘
  C3 jwt_secret 生成流程 ── 需要动 schema.sql + README

第二批（正确性修复）
  H11 deepMerge 默认值改显式键清单 ── 顺带产出可覆盖文案清单
  H8  限流 key 去掉 pathname
  H6/H7 ── 依赖 C2 的落地形态

第三批（架构债，需 PR 级别改动）
  H2  删死配置 · M19 统一消毒策略 · M21 分层归位
  M1/M2 性能 · M15 escape 收敛
```

> **依赖提醒**：C4 的修复项 3（按 IP 限流）依赖 H8 先修 —— 若限流 key 仍含 pathname，加在登录接口上的限流会按资源分桶而失效。
