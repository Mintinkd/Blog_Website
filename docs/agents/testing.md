# 测试

本文件覆盖 worker、前端单元测试与 Playwright 浏览器回归；按改动面选择对应小节。

## Worker 测试

`worker/` 的测试用 vitest：`cd worker && npm test`。CI 最早的门禁是两份生成物漂移断言（设置白名单 `npm run gen:settings` issue #27、安全头 `npm run gen:headers` issue #28；各自重新生成 → git diff 必须为空），之后按 typecheck → 测试的顺序运行，任一失败即拦截部署。维度桶映射的边界值由 `worker/tests/analytics_dimensions.test.ts` 的表驱动用例钉住，分布接口走 `router()` 全链路；文章明细 / 质量接口的聚合口径（分页 20、分母为 0、心跳边界、3σ）由 `worker/tests/analytics_reports.test.ts` 的 `router()` 全链路用例钉住；趋势接口由 `worker/tests/analytics_trend.test.ts` 覆盖；同一行为不在浏览器回归里重复测。后台「统计」面板的展示纯函数（SVG 路径 / 空态 / 比率 / 小样本 / Tier 0 白名单 / i18n 词条同步）由 `tests/analytics-view.test.ts` 钉住，该文件另锁 `formatAnalyticsFailures` 与 README 的 D1 迁移清单。2026-11-11 加固后，`worker/tests/article_view.test.ts` 用 `failAnalyticsWrites` 模拟生产缺表，锁定「计数写库失败不得拖挂文章详情响应」。`worker/tests/article_update_clear.test.ts` 用有状态 D1 桩走 `handleUpdateArticle` → `updateArticle` → 响应全链路，钉住 `PUT /articles/:id`「字段存在即写入、`""` 清空正文 / 摘要 / 封面、未传保持原值、空标题不落库」，并走 `router()` 全链路锁定无 token 401 / 非 owner 403 不变（issue #70）。`/privacy` 页面与跨文档一致性（中英词条、页脚入口、`public/_headers` 护栏块、README 路由表、GLOSSARY 口径、ADR 状态）由 `tests/privacy-page.test.ts` 钉住；护栏白名单本身由 `worker/tests/cloudflare_guards.test.ts` 的手写清单逐字面量锁定。`worker/tests/article_edit_detail.test.ts` 走 `router()` 全链路钉住 `GET /articles/:id/edit`（issue #63）：401 / 403 / 400 非法 id / 404 / owner / admin / 草稿可读，响应字段清单用手写字面量锁定（不含 `content_html` 与统计字段），零写库（`run` / `batch` 为空且无 `analytics_` / `view_count` SQL）、无 `Set-Cookie`，并用公开 `/articles/:slug` 的对照证明两条路由不冲突（公开侧仍带 `content_html` 与 `view_<id>` Cookie）。`worker/tests/edit_lock.test.ts` 用内存 KV 桩与只 mock `Date` 的假定时器钉住编辑锁四类服务端契约（T3 依赖）：同用户续期（`acquired_at` 不变 / `expires_at` 后移 / `expirationTtl`）、他人冲突（含 handler 的 409 + code 10006）、释放（holder / 非 holder / admin / 无锁幂等）、admin 强制接管（`previous_holder` 与新持有人）。

## 前端单元测试

根目录的前端测试用 vitest：`npm test`（配置见 `vitest.config.ts`，测试放 `tests/`）。默认 jsdom 覆盖抓取管线（HTML + final URL / 字节 → 标题、Markdown、selector 提取与字符集解码）；文章详情页的服务端接缝与 SEO 元信息测试用 `@vitest-environment node`，stub `fetch` 或直接调用纯函数，覆盖三态映射、访客 Cookie / 白名单头转发（含 `CF-IPCountry` 映射与伪造 `X-Real-IP` / `X-Visitor-Country` 拒绝）、Set-Cookie 逐字回传（含 `HttpOnly`）与私有缓存响应头，不依赖真实站点。CI 在前端 `npm run check` 之后、构建之前执行。

文章编辑器纯函数行为基线（issue #62）也用 `@vitest-environment node`，五个文件顺带钉住「纯函数不依赖 DOM / Vue 运行时」：`tests/editor-commands.test.ts`（源码模式包裹 / 行前缀 / 列表续行 / 链接与图片插入，Markdown 转义与 `escape.ts` HTML 编码的分工）、`tests/editor-draft.test.ts`（键结构 / 用户+文章隔离 / 7 天过期 / 1MB 配额 / 清理，storage 用内存桩注入）、`tests/editor-state.test.ts`（脏状态 / 关闭决策 / 保存失败 / 锁丢失 reducer）、`tests/editor-slug.test.ts` 与 `tests/editor-word-count.test.ts`（各用一组与 Worker `generateSlug` / `calculateReadingTime` 相同的手写样例做口径对齐，不跨包 import Worker 实现）。期望值均为手写字面量，不从被测函数反推；编辑器 Playwright 回归由 T7 追加，同一行为不在浏览器回归里重复测。

编辑器组件化（issue #64）后新增 `tests/edit-lock.test.ts` 与 `tests/article-editor-flow.test.ts`，均用 `@vitest-environment node`：`useEditLock` 的 10 分钟心跳 / 释放 / 保存前校验 / 强制接管 / `10003` 走 fake timers + mock fetch，断言真实 URL、method 与 `keepalive`，不只测 reducer；`createArticleEditor` 消费 T1 reducer 编排副作用，钉住「加载失败不可编辑且取数走 `/articles/:id/edit`、保存失败保持打开与锁、`pagehide` 释放、`beforeunload` 只提示、Esc 分层、保存前锁校验、强制接管重建基线、`10003` 落盘草稿、新建文章不抢锁」。心跳用 fake timers 承接，避免活跃定时器挂住测试进程；编辑器浏览器回归与 CI 门禁扩展仍由 T7 #68 承接。

## 浏览器回归（Playwright）

`scripts/repro-nav-home.mjs` / `scripts/verify-all-pages-nav.mjs` 走手动 Playwright 回归（依赖真实文章 API；本机 dev server 代理不可达时会超时，属环境前置条件，不是代码回归）。`scripts/verify-admin-analytics.mjs` 是 #58 后台「统计」面板的手动回归：拦截 `/api/v1/**` 返回本地 fixture、注入 admin 登录态，覆盖空库卡片 `—`/`0`、数据积累中、数据不足、PV/UV 双线与 sparkline、Tier 1 隐藏、错误态显示失败接口与 code、控制台无报错；先起 `npx astro dev --port 4321`，Windows 可设 `PW_CHANNEL=msedge`。`scripts/verify-privacy-page.mjs` 是 #59 隐私页的手动回归：从页脚入口进入 `/privacy`，验证中英切换、HttpOnly / HMAC / 保留期披露文案与控制台无报错；同样拦截 `/api/v1/**`，依赖 dev server。`scripts/verify-admin-history-nav.mjs` 是后台「前进/后退白屏」的手动回归：必须用真实链接点击造同文档 `popstate` 历史项（`page.goto` 造的是跨文档历史，后退会走 bfcache 恢复，测不到 ClientRouter 软导航），断言 forward / back 两个方向回到 `/admin/` 后 `#admin-app-mount` 恰好一个根节点、离开时旧 Vue 实例已卸载、反复往返幂等、控制台无报错；用 `astro:after-swap` 计数证明确实发生软导航，避免 bfcache 假通过。同样先起 `npx astro dev --port 4321`，Windows 可设 `PW_CHANNEL=msedge`。`scripts/verify-profile-card.mjs` 是个人名片的手动回归：用一个内存 mock 服务端状态串起「后台 `PUT /config` → 前台 `GET /config`」，覆盖未配置占位、字段编辑 / 头像上传预览 / 社交链接增删与空行过滤、保存后 `/about` 立即读到最新值、375px 无横向溢出、XSS 文本转义与 `javascript:` 链接丢弃、控制台无报错；同样拦截 `/api/v1/**`，不访问真实 Worker，先起 `npx astro dev --port 4321`。`scripts/verify-admin-responsive.mjs` 是后台移动端回归：注入 admin 登录态并拦截 `/api/v1/**`，在 280px / 375px 触控视口下逐页检查 6 张 `.data-table` 的单元格 ≥120px、单元格带 `data-label`、页面与主区域无横向滚动，另查外观页文案输入框 ≥80px；1280px 确认桌面表格布局未受影响。`scripts/verify-visual-friendliness.mjs` 是页面观感友好度检查：在真实渲染结果上量对比度、文案分行、留白、选中态、裁切与焦点环，输出带规则 ID 与源码定位的问题清单，详见下方专节。`scripts/verify-article-ssr.mjs`、`scripts/verify-admin-responsive.mjs` 与它同时是 CI 门禁，在 `.github/workflows/deploy.yml` 的构建前步骤执行；两条导航回归仍手动。Playwright 不在 `package.json` 依赖里。首次手动运行（`--no-save` 保持 `package.json` / lock 不变，不要用 `npm i -D`）：

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

### 后台移动端（CI + 手动）

后台数据表在 `< 768px` 改为卡片布局，字段名依赖 `data-label`。回归脚本用本地 fixture
替代真实 Worker，不依赖生产账号：

```powershell
npx astro dev --port 4321
$env:PW_CHANNEL='msedge'   # 仅用系统 Edge 时
node scripts/verify-admin-responsive.mjs
```

脚本在 280px / 375px 下遍历 12 个后台面板，锁定「单元格不被挤成竖排」和
「页面 / 主区域无横向滚动」；1280px 再确认桌面表格布局未受影响。

### 页面观感友好度（CI + 手动）

`scripts/verify-visual-friendliness.mjs` 不测功能，量「画出来好不好看」：用 Playwright 读取 computed style 与几何盒模型，把常见观感问题转成带规则 ID 的断言。默认目标清单 `TARGETS` 只有「插入链接弹窗 · 预览方式」，规则引擎对同类结构复用；新增页面只需加一条 target（`scope` / `option` / `parts` / `prepare`），不必复制规则。

```powershell
npx astro dev --port 4321
npm run verify:visual
$env:PW_CHANNEL='msedge'                       # 仅用系统 Edge 时
$env:VISUAL_REPORT_JSON='./visual-report.json' # 可选：输出机器可读报告
$env:VISUAL_SHOT_DIR='./visual-shots'          # 可选：输出各场景弹窗截图
```

矩阵固定为 375px / 1280px × light / dark，每组再采「普通链接」「内嵌网页预览」两种选中态。context 用 `reducedMotion: reduce` 让过渡退化为瞬时，采样前把鼠标移出卡片，避免 `:hover` 污染未选中态读数。全部 `/api/v1/**` 走本地 fixture，不依赖真实 Worker 与账号。

13 条规则（阈值集中在脚本头部常量）：

| 规则          | 检查内容                                                                         |
| ------------- | -------------------------------------------------------------------------------- |
| VF-01         | 分组标签 / 标题 / 描述的文本对比度 ≥ 4.5:1（WCAG 2.1 AA 正文）                   |
| VF-02 / VF-03 | 图标描边、未选中指示器边框 ≥ 3:1（AA 非文本图形）；选中态由 VF-07 的状态差异覆盖 |
| VF-04         | 标题与描述分行，图标 / 文案 / 指示器三栏互不重叠且落在卡片内                     |
| VF-05 / VF-06 | 卡片四边内边距 ≥ 12px、选项间距 ≥ 8px                                            |
| VF-07         | 选中态在边框 / 背景 / 圆点 / 强调条四个通道都可辨识                              |
| VF-08 / VF-09 | 文本不被裁切、触控目标 ≥ 44px                                                    |
| VF-10         | 真实 Tab 可聚焦 radio，且 `:focus-visible` 焦点环 ≥ 2px                          |
| VF-11         | 页面 / 弹窗 / 选项组 / 卡片均无横向溢出                                          |
| VF-12 / VF-13 | 选中态与 `v-model` 同步、控制台无报错                                            |

背景色按「从元素到根」逐层 alpha 合成后再算对比度（`scripts/visual-contrast.mjs`，算法由 `tests/visual-contrast.test.ts` 用手写样本钉住），不会因 `--color-accent-subtle` 这类半透明叠加误判。

失败输出每条都带「规则 ID / 场景 / 元素 / 实测值 / 期望值 / 源码定位」，可直接照着定位改代码：

```text
  1. [VF-01 文本对比度] link-dialog / 375px / dark / 选中=link
     元素：.link-mode-option:nth-child(2) .link-mode-desc
     实测：3.21:1（前景 rgb(110, 110, 115) / 背景 rgb(28, 28, 30)）
     期望：≥ 4.5:1（WCAG 2.1 AA 正文）
     定位：src/admin/App.vue → .link-mode-desc 的 color
```

退出码 `0` 通过 / `1` 存在观感问题 / `2` 环境或脚本异常；CI 在 `deploy.yml` 的同一 Playwright 步骤里调用，失败即阻断部署。`VISUAL_REPORT_JSON` 另写一份含全部断言与问题明细的 JSON，便于归档与 diff；`VISUAL_SHOT_DIR` 按「视口 / 主题 / 选中态」输出弹窗截图，方便人工复核数值之外的观感（两者默认关闭，不影响 CI）。

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
- **共享定义只有一份吗？** mock、脚本、断言共用的端口、路径、资源匹配器放同一 fixture 模块，避免三处各写一份后漂移。`scripts/` 内的 mock 与浏览器回归脚本共用 `article-ssr-fixture.mjs`（含 `VIEW_COOKIE`）；根包与 worker 是独立包，行为锁的期望值按「独立来源」约定仍各用手写字面量，不跨包导入 fixture。
- **CI 化后还能稳定复现吗？** 本地按文档命令可复现；CI 入口拉起 dev server、等待就绪、失败打印日志、退出清理进程，mock 由脚本自己拉起；外部 API 指向本地不可达地址；先选高价值且稳定的一条，其余保留手动。

## 约定

- 测试文件放 `worker/tests/`；`tsconfig.test.json` 使其参与 `npm run typecheck`。
- 网络边界用 `vi.stubGlobal('fetch', ...)` 打桩：按 URL 分流外部查询（如 DoH）与目标请求，并记录调用，用于断言「拒绝时不发起真实请求」。范例：`worker/tests/img_proxy.test.ts`。
- 优先测多入口共用的流水线（一处覆盖多消费方）；handler 级接缝（env/KV、HTTP 响应）在确认接缝时显式提出，由用户决定是否纳入。工单 Key interfaces 点名的接缝视为已确认。
- 行为锁测试的期望值须有独立来源：全序列表用手写字面量钉住（范例 `worker/tests/settings_rules.test.ts` 的 `EXPECTED_PATHS`），逐 kind 探针走约定的非法样本，不得从被测对象（生成物/实现）的同一数据直接推回——否则等于自己证明自己。
