# Worker 测试

`worker/` 的测试用 vitest：`cd worker && npm test`。CI 最早的门禁是两份生成物漂移断言（设置白名单 `npm run gen:settings` issue #27、安全头 `npm run gen:headers` issue #28；各自重新生成 → git diff 必须为空），之后按 typecheck → 测试的顺序运行，任一失败即拦截部署。

## 前端单元测试

根目录的前端测试用 vitest：`npm test`（配置见 `vitest.config.ts`，测试放 `tests/`）。默认 jsdom 覆盖抓取管线（HTML + final URL / 字节 → 标题、Markdown、selector 提取与字符集解码）；文章详情页的服务端接缝与 SEO 元信息测试用 `@vitest-environment node`，stub `fetch` 或直接调用纯函数，不依赖真实站点。CI 在前端 `npm run check` 之后、构建之前执行。

## 浏览器回归（Playwright）

`scripts/repro-nav-home.mjs` / `scripts/verify-all-pages-nav.mjs` 走手动 Playwright 回归，Playwright 不在 `package.json` 依赖里。首次运行：

```bash
npm i -D playwright
npx playwright install chromium
npx astro dev --port 4321
node scripts/verify-all-pages-nav.mjs
```

端口用 `npx astro dev --port 4321`（`npm run dev -- --port` 的参数透传在本机不可靠）；脚本默认连 `http://localhost:4321`，可用 `BASE` 覆盖。

文章详情是 SSR：取数发生在 Astro 服务端，`page.route()` 只能拦浏览器请求，拦不到 `loadArticleForPage` 的 fetch。离线验证 200 路径需要让页面在 dev 下读取可覆盖的 Worker origin（如 `ARTICLE_API_ORIGIN`）并启动本地 mock；具体接缝见 #41。禁用 JS 的可见性断言要检查 computed `opacity`，不能只用 Playwright 的 `toBeVisible()`——`opacity:0` 仍算 visible。

## 约定

- 测试文件放 `worker/tests/`；`tsconfig.test.json` 使其参与 `npm run typecheck`。
- 网络边界用 `vi.stubGlobal('fetch', ...)` 打桩：按 URL 分流外部查询（如 DoH）与目标请求，并记录调用，用于断言「拒绝时不发起真实请求」。范例：`worker/tests/img_proxy.test.ts`。
- 优先测多入口共用的流水线（一处覆盖多消费方）；handler 级接缝（env/KV、HTTP 响应）在确认接缝时显式提出，由用户决定是否纳入。工单 Key interfaces 点名的接缝视为已确认。
- 行为锁测试的期望值须有独立来源：全序列表用手写字面量钉住（范例 `worker/tests/settings_rules.test.ts` 的 `EXPECTED_PATHS`），逐 kind 探针走约定的非法样本，不得从被测对象（生成物/实现）的同一数据直接推回——否则等于自己证明自己。
