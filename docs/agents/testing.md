# Worker 测试

`worker/` 的测试用 vitest：`cd worker && npm test`。CI 最早的门禁是两份生成物漂移断言（设置白名单 `npm run gen:settings` issue #27、安全头 `npm run gen:headers` issue #28；各自重新生成 → git diff 必须为空），之后按 typecheck → 测试的顺序运行，任一失败即拦截部署。

## 前端单元测试

根目录的前端测试用 vitest：`npm test`（配置见 `vitest.config.ts`，测试放 `tests/`）。默认 jsdom 覆盖抓取管线（HTML + final URL / 字节 → 标题、Markdown、selector 提取与字符集解码）；文章详情页的服务端接缝与 SEO 元信息测试用 `@vitest-environment node`，stub `fetch` 或直接调用纯函数，覆盖三态映射、访客 Cookie / cf-connecting-ip 转发、Set-Cookie 回传与私有缓存响应头，不依赖真实站点。CI 在前端 `npm run check` 之后、构建之前执行。

## 浏览器回归（Playwright）

`scripts/repro-nav-home.mjs` / `scripts/verify-all-pages-nav.mjs` / `scripts/verify-article-ssr.mjs` 走手动 Playwright 回归，Playwright 不在 `package.json` 依赖里。首次运行（`--no-save` 保持 `package.json` / lock 不变，不要用 `npm i -D`）：

```bash
npm install --no-save playwright
npx playwright install chromium
```

Windows 也可直接用系统 Edge，跳过下载（脚本读 `PW_CHANNEL`）：

```powershell
$env:PW_CHANNEL='msedge'
```

### 全站导航

```bash
npx astro dev --port 4321
node scripts/verify-all-pages-nav.mjs
```

端口用 `npx astro dev --port 4321`（`npm run dev -- --port` 的参数透传在本机不可靠）；脚本默认连 `http://localhost:4321`，可用 `BASE` 覆盖。

### 文章详情 SSR（#41）

文章取数发生在 Astro 服务端，`page.route()` 只拦浏览器请求，拦不到 `loadArticleForPage` 的 fetch。因此用 dev-only 的 `ARTICLE_API_ORIGIN` 覆盖 + 本地 mock：

```powershell
# 终端 1：启动开发服务器，文章页取数指向 mock
$env:ARTICLE_API_ORIGIN='http://127.0.0.1:4322'
npx astro dev --port 4321

# 终端 2：脚本自己拉起 mock（端口 4322，MOCK_PORT 可覆盖）
$env:PW_CHANNEL='msedge'   # 仅用系统 Edge 时
node scripts/verify-article-ssr.mjs
```

4321 / 4322 必须空闲：设置 `ARTICLE_API_ORIGIN` 时 `astro.config.mjs` 会为 Vite 启用 `strictPort`，端口被占用直接启动失败，避免自动顺延后抢占 mock 的 4322。脚本启动后还会确认 dev server 确实把 SSR 取数打到了本次 mock（`/__stats` 命中数），不匹配就立即失败并打印正确的 `ARTICLE_API_ORIGIN` 启动命令；mock 端口被占用也会直接报错。若要换端口，`MOCK_PORT` 必须与 dev server 的 `ARTICLE_API_ORIGIN` 保持一致。

脚本不访问真实 Worker：`scripts/mock-article-api.mjs` 提供 200（`ssr-regression`）/ 404（`missing-fixture`）/ 500→页面 502（`boom-fixture`）与站点标题；浏览器侧的同源 API 请求由 Playwright `page.route()` fulfill。`BASE` 可覆盖站点地址。断言范围：

- 服务端 HTML 含正文 / GFM 表格 / 围栏代码 / 每篇文章 meta，并带 `Cache-Control: private, no-cache` 与阅读量 `Set-Cookie`；
- 禁用 JS 时标题 / 摘要 / 正文段落及正文容器的 computed `opacity` 均为 `1`（不能只用 `toBeVisible()`——Playwright 把 `opacity:0` 也算 visible）；
- 阻断 motion chunk 后，`data-motion-failed` 必须在 DOMContentLoaded 后 1.5s 内出现，证明走的是动态 import 的 catch 兜底而不是 3s 看门狗，随后首屏仍可见；
- 未知 slug 返回 404，上游失败返回 502 且渲染重试入口；
- 控制台无页面脚本报错（404 / 502 导航文档自身触发的资源错误、以及被主动阻断的 motion chunk 资源错误按预期过滤）。

`ARTICLE_API_ORIGIN` 只在 dev 且显式设置时生效；生产构建忽略它，继续走 `WORKER_ORIGIN`（`src/utils/workerOrigin.ts`）。

## 约定

- 测试文件放 `worker/tests/`；`tsconfig.test.json` 使其参与 `npm run typecheck`。
- 网络边界用 `vi.stubGlobal('fetch', ...)` 打桩：按 URL 分流外部查询（如 DoH）与目标请求，并记录调用，用于断言「拒绝时不发起真实请求」。范例：`worker/tests/img_proxy.test.ts`。
- 优先测多入口共用的流水线（一处覆盖多消费方）；handler 级接缝（env/KV、HTTP 响应）在确认接缝时显式提出，由用户决定是否纳入。工单 Key interfaces 点名的接缝视为已确认。
- 行为锁测试的期望值须有独立来源：全序列表用手写字面量钉住（范例 `worker/tests/settings_rules.test.ts` 的 `EXPECTED_PATHS`），逐 kind 探针走约定的非法样本，不得从被测对象（生成物/实现）的同一数据直接推回——否则等于自己证明自己。
