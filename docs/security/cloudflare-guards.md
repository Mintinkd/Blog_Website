# Cloudflare 平台注入护栏（CSP violation / prefetch 503）

日期：2026-10-20　相关：`scripts/cloudflare-guards.mjs`、`scripts/security-headers.mjs`、`src/middleware.ts`、`src/pages/speculation-rules.ts`、`public/_headers`

## 结论

Cloudflare 自定义域会在 HTML 上追加两项与本站策略冲突的内容。**不依赖 Dashboard 关闭 Bot Fight Mode / JS Detections / Speed Brain**，代码侧用两个响应头即可消除控制台告警：

| 现象                                                    | 来源                                                                                               | 代码侧处置                                                                                                                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Refused to execute inline script …`（CSP violation）   | JavaScript Detections 注入内联 bootstrap（装载 `/cdn-cgi/challenge-platform/scripts/jsd/main.js`） | HTML 响应 `Cache-Control: no-transform`（[Cloudflare 文档](https://developers.cloudflare.com/cache/concepts/cache-control/)：带该指令即不注入）                                                     |
| `net::ERR_ABORTED 503`，响应头 `cf-speculation-refused` | Speed Brain 注入 `Speculation-Rules: "/cdn-cgi/speculation"`；本站路由全经 Worker，边缘拒绝预取    | HTML 响应 `Speculation-Rules: "/speculation-rules"` 指向自有空规则集（[Cloudflare 文档](https://developers.cloudflare.com/speed/optimization/content/speed-brain/)：origin 自带该头则「不会覆盖」） |

## 实测证据（2026-10-20，自定义域 `blog.zenfishlog.dpdns.org`）

- `curl -I https://blog.zenfishlog.dpdns.org/`：响应含 `Speculation-Rules: "/cdn-cgi/speculation"`；HTML 末尾含 `window.__CF$cv$params` 内联 bootstrap 与 `…/jsd/main.js` 装载器；
- 同一 URL 带 `Sec-Purpose: prefetch` 请求：`503` + `Cf-Speculation-Refused: prefetch refused: not eligible`；
- 生产 CSP 为构建期收紧后的 `script-src 'self' 'sha256-…'`，注入的内联 bootstrap 无 hash / nonce → 被拒绝执行（JSD 事实上也失效，只剩控制台报错）。

## 实现

单一事实源：`scripts/cloudflare-guards.mjs`（类型声明 `.d.mts`）持有路径、MIME、规则体与两个护栏头；两条渠道分别消费：

1. **静态 / 预渲染页面**（`_headers`，Pages 静态资产；不作用于 Functions 响应）：
   `renderHeadersFile()` 在 `/*` 5 头块之后，为 `HTML_ROUTE_PATTERNS`（`/`、`/404*`、`/about*`、`/archives*`、`/admin*`、`/articles*`、`/search*`，与 `dist/_routes.json` 的 exclude 页面路由对齐）各渲染一个规则块：

   ```txt
   /about*
     Cache-Control: public, max-age=0, must-revalidate, no-transform
     Speculation-Rules: "/speculation-rules"
   ```

   `/*` 块只保留 5 个安全头 —— 资产（`/_assets/*` 等）不能吃 `no-transform`，否则边缘压缩会被关闭。

2. **SSR 动态路由**（`src/middleware.ts`）：响应完成后按 `content-type: text/html` 调用 `guardHtmlResponse()`：已有 Cache-Control 追加 `no-transform`（保留原指令），并写入 `Speculation-Rules`；非 HTML（JSON / XML / 规则集本身）不动。

3. **规则集端点** `src/pages/speculation-rules.ts`（SSR，`prerender = false`）：返回

   ```json
   {
     "prefetch": [
       {
         "source": "document",
         "where": {
           "href_matches": "/__speculation_rules_disabled__",
           "relative_to": "document"
         },
         "eagerness": "conservative"
       }
     ]
   }
   ```

   MIME 必须为 `application/speculationrules+json`（HTML 规范要求；静态 `.json` 资产会被 Pages 标成 `application/json`，浏览器会忽略），并带 `Cache-Control: public, max-age=86400`（部署期常量，浏览器缓存）。规则锚定一个永不存在的同源路径 → 不匹配任何链接 → 不发起预取。

## 取舍与影响

- **HTML 压缩**：`no-transform` 会关闭 Cloudflare 对 HTML 的 gzip / brotli（实测启用时 HTML 为 `Content-Encoding: br`）。这是停止 JSD 注入的文档化代价；只有 HTML 文档承担，`/_assets/*` 的 JS / CSS / 图片不受影响。若更在意 HTML 传输体积，可在 Dashboard 关闭 Bot Fight Mode 并移除 no-transform（Speculation-Rules 护栏可独立保留）。
- **JSD 结果**：`cf.bot_management.js_detection.passed` 将显示 `missing`；本站未用该字段做 WAF 规则，无行为影响。
- **Speed Brain**：规则集为空，等于对本站关闭该优化；预取本就不生效（Worker 路由必 503），无性能回退。
- **CSP**：不放松 `script-src`，继续用构建期 sha256；no-transform 是让边缘**不注入**，而不是给注入脚本开口子。

## 已知边界

- `_headers` 只能按路径匹配，无法按 content-type 匹配：**未知路径的 404**（Pages 用 `404.html` 响应任意未匹配路径）不落入 HTML 路由块，若 JSD 开启仍可能在 404 页注入；正常页面路由均已覆盖。
- 自定义域上另有 zone 级响应头改写（实测 `Referrer-Policy: same-origin`、`X-Frame-Options: SAMEORIGIN`、`X-XSS-Protection`、`Access-Control-Allow-Origin: *` 覆盖了 `_headers` 的值；`pages.dev` 域为仓库值）。属 Dashboard 配置，不在本仓库代码范围；排查时先看 Transform Rules / 安全响应头类设置。
- Speed Brain / JSD 都是 Cloudflare 边缘行为；本仓库只保证 origin 声明正确，发布后需按下方步骤复验自定义域。

## 验证

1. `npm run gen:headers` 后 `public/_headers` 含 HTML 路由护栏块（CI 漂移断言守护）；
2. `npm run build`：`patch-csp` 的 `dist/_headers` 逐字符断言通过；`dist/_routes.json` 的 include 含 `/speculation-rules`；
3. `npx wrangler pages dev dist` 后：
   - `curl -sI http://127.0.0.1:8788/` → `Cache-Control: … no-transform` 且 `Speculation-Rules: "/speculation-rules"`；
   - `curl -sI http://127.0.0.1:8788/_assets/<任意 js>` → 无 `no-transform`；
   - `curl -s -D - http://127.0.0.1:8788/speculation-rules` → `Content-Type: application/speculationrules+json` 与空规则体；
4. 线上发布后（自定义域）：`curl -sI https://blog.zenfishlog.dpdns.org/` 应看到同一对头；DevTools 检查：
   - 控制台无 `Refused to execute inline script` 等 JSD 相关 CSP violation；
   - Network 面板 hover 站内链接不再出现 `Sec-Purpose: prefetch` 的 503；
   - Application → Speculation Rules 不再加载 `/cdn-cgi/speculation`；
5. `cd worker && npm test`（`worker/tests/cloudflare_guards.test.ts`）。

## 维护

- 新增预渲染 HTML 路由：同步 `HTML_ROUTE_PATTERNS`（生成物随之更新，CI 漂移断言会提醒未重跑生成）；
- 改规则体 / 头值只改 `scripts/cloudflare-guards.mjs`，并同步 `.d.mts` 与 `worker/tests/cloudflare_guards.test.ts` 的手写字面量；
- 不要在 `/*` 块追加 `no-transform`（资产压缩回退）。
