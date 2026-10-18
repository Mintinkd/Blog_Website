# CSP 'unsafe-inline' 收敛评估与落地（审查报告 M3 / issue #10）

日期：2026-10-17（单源改造：2026-10-18，issue #28 / ADR 0002）　相关：`scripts/security-headers.mjs`、`scripts/generate-headers.mjs`、`src/middleware.ts`、`public/_headers`、`scripts/patch-csp.mjs`、`astro.config.mjs`

## 结论

| 指令         | 处置                   | 说明                                                                     |
| ------------ | ---------------------- | ------------------------------------------------------------------------ |
| `script-src` | **已收紧（落地）**     | 生产产物不再含 `'unsafe-inline'`，改为 `'self'` + 内联脚本 sha256 列表   |
| `style-src`  | 保留 `'unsafe-inline'` | 动态 settings 内联样式与模板 style 属性无法静态 hash；评估与替代路径见下 |

## script-src 落地方式

产物中存在且仅存在三类可执行内联脚本（全站一致）：主题初始化脚本（`BaseLayout.astro` 的 `is:inline`）、Astro 运行时 shim（客户端指令加载器、ClientRouter 引导）。其余 `<script>` 均由 Astro 打包为同源外链模块。

- 单源（issue #28 / ADR 0002）：5 个响应头（含 CSP 基线）只在 `scripts/security-headers.mjs` 手工维护——`src/middleware.ts` 直接 import；`public/_headers` 由 `npm run gen:headers`（prebuild 自动执行）整文件渲染，CI 漂移断言守护（重新生成 diff 必须为空）；
- 收紧：`astro.config.mjs` 注册 `astro:build:done` 钩子，调用 `scripts/patch-csp.mjs`——先校验 `dist/_headers` 与模块渲染一致，再扫描 `dist/**/*.html` 提取内联脚本 sha256（自动去重），以模块为源构造收紧后的 CSP，替换 `dist/_headers` 与 `dist/_worker.js`（SSR 中间件编译产物）中的基线整串；
- 自校验（构建失败即报错）：产物中不得残留基线 CSP，也不得存在仍放行 `'unsafe-inline'` 的 `script-src`（`style-src` 等其它指令的保留不受影响）；静态与 SSR 两份 CSP 必须逐字符一致且等于模块构造结果；
- 维护约定：改响应头 / CSP 只改 `scripts/security-headers.mjs`，重跑生成（`npm run gen:headers`，构建会自动执行）并一并提交；新增 `is:inline` 脚本由构建自动纳管（无需人工登记）；**禁止**使用内联事件处理器（`onclick="..."` 等）与 `javascript:` URL——当前代码库经全量检索均无此类用法，收紧后二者将被 CSP 拦截，如有新增必须改为 `addEventListener` / `Vue @click`；
- 基线只存在于安全头模块与 dev（middleware 直接 import 模块；`public/_headers` 生成物保留基线形态），生产以构建产物为准（源文件注释已同步说明）。

## style-src 保留 'unsafe-inline' 的原因

1. `BaseLayout` 每请求内联注入由 settings 生成的 CSS（`<style id="dynamic-settings">`），内容随站点配置动态变化，构建期无法 hash；
2. 模板与动态 HTML 使用大量 `style="..."` 属性；CSP3 下放行需 `'unsafe-hashes'` + 逐条 sha256，维护面巨大且本身即弱化；
3. Element Plus 等运行时注入样式。

风险与替代：

- 样式注入的现实风险为渲染篡改与 CSS exfil（需配合选择器探测），不产生脚本执行；XSS 的主要遏制面是 script-src（已收紧）；
- 后续迭代方向：动态 settings 样式改为外链样式表（如 `/api/v1/settings.css`），模板内联 style 属性逐步收敛为 class。

## 验证方式

1. `npm run build`：构建日志输出 `[csp] script-src 已收紧：…`、`[csp] 收紧结果 = 安全头模块构造（tightenCsp）`、`[csp] 静态与 SSR 两份 CSP 逐字符一致：OK`；
2. 抽查产物：`dist/_headers` 与 `dist/_worker.js/_astro-internal_middleware.mjs` 中 script-src 为 `'self' 'sha256-…'` 列表，无 `'unsafe-inline'`；
3. `npx wrangler pages dev dist` 后浏览器打开主要页面（首页/文章列表/文章详情/搜索/归档/关于/后台），控制台无 CSP 拦截报错、主题切换等内联脚本正常执行；
4. 语义对照：无 `'unsafe-inline'` 且无对应 hash 的内联脚本（如注入的 `onerror` 载荷）在产物中不再具备执行能力。
