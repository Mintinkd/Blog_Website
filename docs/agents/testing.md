# 测试

本文件覆盖 worker、前端单元测试与 Playwright 浏览器回归；按改动面选择对应小节。

## Worker 测试

`worker/` 的测试用 vitest：`cd worker && npm test`。CI 最早的门禁是两份生成物漂移断言（设置白名单 `npm run gen:settings` issue #27、安全头 `npm run gen:headers` issue #28；各自重新生成 → git diff 必须为空），之后按 typecheck → 测试的顺序运行，任一失败即拦截部署。

## 前端单元测试

根目录的前端测试用 vitest：`npm test`（配置见 `vitest.config.ts`，测试放 `tests/`）。默认 jsdom 覆盖抓取管线（HTML + final URL / 字节 → 标题、Markdown、selector 提取与字符集解码）；文章详情页的服务端接缝与 SEO 元信息测试用 `@vitest-environment node`，stub `fetch` 或直接调用纯函数，覆盖三态映射、访客 Cookie / cf-connecting-ip 转发、Set-Cookie 回传与私有缓存响应头，不依赖真实站点。CI 在前端 `npm run check` 之后、构建之前执行。

## 浏览器回归（Playwright）

`scripts/repro-nav-home.mjs` / `scripts/verify-all-pages-nav.mjs` 走手动 Playwright 回归。`scripts/verify-article-ssr.mjs` 同时是 CI 门禁，在 `.github/workflows/deploy.yml` 的构建前步骤执行；CI 只跑文章 SSR 一条，两条导航回归仍手动。Playwright 不在 `package.json` 依赖里。首次手动运行（`--no-save` 保持 `package.json` / lock 不变，不要用 `npm i -D`）：

```bash
npm install --no-save playwright
npx playwright install chromium
```

CI 固定 `playwright@1.64.1` 并安装 Chromium。Windows 本地也可直接用系统 Edge，跳过下载（脚本读 `PW_CHANNEL`）：

```powershell
$env:PW_CHANNEL='msedge'
```

### 全站导航

```bash
npx astro dev --port 4321
node scripts/verify-all-pages-nav.mjs
```

端口用 `npx astro dev --port 4321`（`npm run dev -- --port` 的参数透传在本机不可靠）；脚本默认连 `http://localhost:4321`，可用 `BASE` 覆盖。

### 文章详情 SSR（#41，CI + 手动）

文章取数发生在 Astro 服务端，`page.route()` 只拦浏览器请求，拦不到 `loadArticleForPage` 的 fetch。因此用 dev-only 的 `ARTICLE_API_ORIGIN` 覆盖 + 本地 mock。CI 在构建前启动 dev server 并运行同一脚本；下面的双终端命令用于本地手动复现：

```powershell
# 终端 1：启动开发服务器，文章页取数指向 mock
$env:ARTICLE_API_ORIGIN='http://127.0.0.1:4322'
$env:SITEMAP_API_BASE='http://127.0.0.1:9'   # 避免 dev 启动时访问真实 sitemap API
npx astro dev --port 4321

# 终端 2：脚本自己拉起 mock（端口 4322，MOCK_PORT 可覆盖）
$env:PW_CHANNEL='msedge'   # 仅用系统 Edge 时
node scripts/verify-article-ssr.mjs
```

4321 / 4322 必须空闲：设置 `ARTICLE_API_ORIGIN` 时 `astro.config.mjs` 会为 Vite 启用 `strictPort`，端口被占用直接启动失败，避免自动顺延后抢占 mock 的 4322。脚本启动后还会确认 dev server 确实把 SSR 取数打到了本次 mock（`/__stats` 命中数），不匹配就立即失败并打印正确的 `ARTICLE_API_ORIGIN` 启动命令；mock 端口被占用也会直接报错。若要换端口，`MOCK_PORT` 必须与 dev server 的 `ARTICLE_API_ORIGIN` 保持一致。`SITEMAP_API_BASE` 指向不可达本地端口，dev 启动时的 sitemap 取数会失败并回退为空列表，不影响文章页回归。

脚本不访问真实 Worker：`scripts/mock-article-api.mjs` 提供 200（`ssr-regression`）/ 404（`missing-fixture`）/ 500→页面 502（`boom-fixture`）与站点标题；浏览器侧的同源 API 请求由 Playwright `page.route()` fulfill。`BASE` 可覆盖站点地址。断言范围：

- 服务端 HTML 含正文 / GFM 表格 / 围栏代码 / 每篇文章 meta，并带 `Cache-Control: private, no-cache` 与阅读量 `Set-Cookie`；
- 禁用 JS 时标题 / 摘要 / 正文段落及正文容器的 computed `opacity` 均为 `1`（不能只用 `toBeVisible()`——Playwright 把 `opacity:0` 也算 visible）；
- 阻断 motion chunk 后，`data-motion-failed` 必须在 DOMContentLoaded 后 1.5s 内出现，证明走的是动态 import 的 catch 兜底而不是 3s 看门狗，随后首屏仍可见；
- 未知 slug 返回 404，上游失败返回 502 且渲染重试入口；
- 控制台无页面脚本报错（404 / 502 导航文档自身触发的资源错误、以及被主动阻断的 motion chunk 资源错误按预期过滤）。

回归上下文固定 `locale: zh-CN`，保证中文 UI 文案断言稳定。

`ARTICLE_API_ORIGIN` 只在 dev 且显式设置时生效；生产构建忽略它，继续走 `WORKER_ORIGIN`（`src/utils/workerOrigin.ts`）。

### 新增回归检查单

浏览器回归只锁只有在完整页面里才能确认的行为：SSR 首屏的可读性、水合、禁用 JS、computed style、资源加载失败。数据映射 / 三态 / 转发等接缝优先放 node vitest；同一行为不要两边重复测。

先定最小矩阵：服务端 HTML 可读、JS 正常水合、禁用 JS、关键失败态（如 404 / 502）、资源失败兜底；按页面契约裁剪，不要只测 happy path。写完逐条过：

- **SSR 证据来自 HTTP 响应。** 服务端正文 / meta 直接读页面响应（或禁用 JS 的首个文档），不要从水合后的 DOM 反推；浏览器用例只负责水合、交互和兜底。
- **服务端请求也隔离了吗？** `page.route()` 只拦浏览器请求；SSR 的 fetch 用 dev-only origin 指向本地 mock，并在断言前确认 mock 命中数增加（文章 SSR 的 `/__stats` 预检）。
- **能证明连的是本次 mock 吗？** 端口固定且与 origin 一致；回归模式启用 `strictPort`；冲突直接失败，避免顺延端口或复用别人的服务。
- **无 JS / reveal 可见性是量出来的吗？** 用独立 context 关闭 JS，读取 `getComputedStyle` 的 `opacity` 与尺寸，并同时检查容器和子元素。
- **兜底断言卡在看门狗之前吗？** 阻断资源后从 `DOMContentLoaded` 起算，用明显小于页面看门狗的预算断言失败标记；预算过宽会让看门狗掩盖 catch 分支失效。
- **等待条件可观察吗？** 用 `waitForFunction` / locator 状态 / `expect.poll` 等条件等待，不用固定 `waitForTimeout` 猜时间；兜底预算从事件锚点起算。
- **环境固定了吗？** 每个场景独立 context；固定 `locale`（CI Chromium 默认 en-US）、viewport，必要时时区；中文文案断言不能依赖本机语言，语义选择器优先。
- **失败会变红吗？** 等待挂载 / 标记出现不要用空 `catch` 吞掉；控制台与 `pageerror` 过滤限定到具体 URL + 错误文本，宽泛的 `/ERR_FAILED/` 会把新错误变成通过。
- **共享定义只有一份吗？** mock、脚本、断言共用的端口、路径、资源匹配器放同一 fixture 模块，避免三处各写一份后漂移。
- **CI 化后还能稳定复现吗？** 本地按文档命令可复现；CI 入口拉起 dev server、等待就绪、失败打印日志、退出清理进程，mock 由脚本自己拉起；外部 API 指向本地不可达地址；先选高价值且稳定的一条，其余保留手动。

## 约定

- 测试文件放 `worker/tests/`；`tsconfig.test.json` 使其参与 `npm run typecheck`。
- 网络边界用 `vi.stubGlobal('fetch', ...)` 打桩：按 URL 分流外部查询（如 DoH）与目标请求，并记录调用，用于断言「拒绝时不发起真实请求」。范例：`worker/tests/img_proxy.test.ts`。
- 优先测多入口共用的流水线（一处覆盖多消费方）；handler 级接缝（env/KV、HTTP 响应）在确认接缝时显式提出，由用户决定是否纳入。工单 Key interfaces 点名的接缝视为已确认。
- 行为锁测试的期望值须有独立来源：全序列表用手写字面量钉住（范例 `worker/tests/settings_rules.test.ts` 的 `EXPECTED_PATHS`），逐 kind 探针走约定的非法样本，不得从被测对象（生成物/实现）的同一数据直接推回——否则等于自己证明自己。
