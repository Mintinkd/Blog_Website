# 代码审查报告 — #41 T5 文章详情 SSR：回归验证与文档收口（code-review 技能，基点 `3154fa6`）

- **日期**：2026-10-22
- **基点**：`3154fa6`（#41 实施前 HEAD）
- **变更提交**（1 个，实施提交）：
  - `22fe22f` feat: 文章详情 SSR T5——回归验证与文档收口（#41）
- **复审修正提交**（1 个）：
  - `4ecf016` fix: 文章 SSR T5 审查跟进——回归预检与兜底断言（#41）
- **Spec 来源**：GitHub issue #41 原文（enhancement / ready-for-agent；Parent #36）
- **标准来源**：`CODING_STANDARDS.md`（契约面同步）+ `README.md` 契约面 + `AGENTS.md` + `docs/agents/testing.md` + ADR 0004；Fowler 坏味道基线
- **方法**：code-review 技能原流程 — 两轴并行子代理（Standards / Spec）；本文件归并两轴结论与处置，**不做跨轴合并或重排序**

---

## Spec

### （a）缺失 / 部分落实

1. **回归脚本没有确认 dev server 真的指向 mock — 已修复 `4ecf016`**
   脚本只等待 mock 的 `/health` 与站点根路径，随后直接请求文章页。若 dev server 不是用 `ARTICLE_API_ORIGIN` 启动的，SSR 会连真实 Worker；在受限网络下表现为 502 / 超时，读者很难判断是页面回归还是启动配置错了，AC「回归必须能在本机离线跑通」缺少可靠的失败边界。
   **处置**：mock 增加 `/__stats` 文章取数计数；脚本在启动浏览器前先请求文章页，再断言计数增加，否则立即以退出码 2 失败，并打印正确的 `ARTICLE_API_ORIGIN` 启动命令。

2. **4321 / 4322 端口冲突可能让脚本连错服务 — 已修复 `4ecf016`**
   Astro 默认在 4321 被占用时自动顺延端口，可能直接抢占 mock 的 4322；原脚本也不检测 mock 子进程是否因 `EADDRINUSE` 退出，健康检查可能误连到别的服务。
   **处置**：设置 `ARTICLE_API_ORIGIN` 时在 `astro.config.mjs` 为 Vite 启用 `strictPort`，冲突在启动阶段直接失败；mock 增加 `error` 处理并打印可操作的换端口提示；脚本的 `waitForMock()` 监听子进程退出，且给健康检查成功加一个事件循环周期的复核，避免把别人的服务当成自己的 mock；`BASE` 与 mock 同源时直接报错。

### （b）超纲 / 行为漂移

无。修改集中在回归脚本、mock、dev-only origin 与契约文档；`strictPort` 仅在设置 `ARTICLE_API_ORIGIN` 的 dev 回归模式生效，生产构建路径不变。

### （c）实现但不够精确

1. **禁用 JS 的正文断言只采样了 `<p>`，没有采样正文容器 — 已修复 `4ecf016`**
   `getComputedStyle(child).opacity` 不会继承父级；若 `.article-content` 仍是 `opacity:0`，子段落仍会报告 `1`。AC 明确要求「正文」的 computed opacity，原断言可能漏掉容器级回归。
   **处置**：`readRevealStyles()` 同时读取 `.article-content` 容器与 `.article-content p`，两者都断言 computed `opacity === 1` 且高度大于 0；正常 JS 路径的等待条件也同步加入容器。

2. **阻断 motion chunk 的测试可能被 3s 看门狗误判为通过 — 已修复 `4ecf016`**
   原测试最多等 6s 才要求 `data-motion-failed`，而 `BaseLayout` 自身有 3s 超时兜底。即使动态 import 的 `catch` 分支失效，测试仍会在 3s 后变绿，无法证明「阻断 chunk 后走 catch 兜底」。
   **处置**：改用 `DOMContentLoaded` 起算，要求标记在 1.5s 预算内出现；超时即断言失败，并在注释中说明预算必须明显小于页面 3s watchdog。资源报错过滤也从宽泛的 `/ERR_FAILED/` 收窄为「URL 命中 motion chunk 且文本为 `ERR_FAILED`」。

3. **README / ADR 的 502 口径把 404 也包含进「非 2xx」 — 已修复 `4ecf016`**
   `loadArticleForPage` 对上游 404 返回 `not-found`（页面 404），其余非 2xx 才映射 502；原文「上游不可达 / 非 2xx / 超时 → 502」与实现不一致。
   **处置**：README 与 ADR 0004 统一改为「上游不可达 / 404 以外的非 2xx / 2xx 响应体非法 / 超时（8s）→ 502」，与三态映射和解析失败分支一致。

---

## Standards

### （a）违反已文档化标准 — 0 条

无硬性违规。`CODING_STANDARDS.md` 的唯一规则（契约面同步）为判断题，见（b）。

### （b）已文档化标准的判断项

1. **`workerOrigin.ts` 头注仍称三个入口必须指向同一个 Worker — 已修复 `4ecf016`**
   引入 dev-only `ARTICLE_API_ORIGIN` 后，文章页在 dev 下可以指向 mock，而 RSS / API 代理仍走 `WORKER_ORIGIN`；原注释已失真。
   **处置**：改为「生产环境三者指向同一个 Worker；dev 下文章页可取数指向本地 mock，RSS / API 代理仍走 `WORKER_ORIGIN`」。

2. **README 结构树 / 测试说明漏掉新增的 origin 覆盖 — 已修复 `4ecf016`**
   `workerOrigin.ts` 行、`tests/` 行与根级测试段落仍只描述原有接缝，没有体现 `ARTICLE_API_ORIGIN` 的 dev 生效 / 生产忽略 / 空值回退规则。
   **处置**：结构树补「dev-only 文章取数覆盖」「dev-only origin 覆盖」；测试段落补 `resolveArticleApiOrigin` 的三条规则。

3. **README 动效段未记录 `data-motion-failed` 兜底 — 已修复 `4ecf016`**
   文章 SSR 段已提到该标记，但「动效」章节的基建与兜底列表没有，读者无法从动效契约找到失败路径。
   **处置**：`motion.css` 结构行改为「强度分级 / 加载失败兜底」；动效「分级与兜底」补 motion chunk 动态 import 失败 / 3s 未初始化时写入 `<html data-motion-failed>` 并强制 `[data-reveal]` 可见。

### （c）基线坏味道与判断项

1. **`BaseLayout` 兜底分支重复写属性、超时值裸奔 — 已修复 `4ecf016`**
   **处置**：提取 `MOTION_FALLBACK_TIMEOUT_MS = 3000` 与 `markMotionFailed()`；catch 与看门狗共用同一标记入口。

2. **`waitForIslands()` 静默吞掉页脚选择器超时 — 已修复 `4ecf016`**
   `.catch(() => {})` 会把「岛屿没挂载」当成通过，之后的控制台断言仍可能全绿。
   **处置**：移除 catch，让等待超时直接由用例失败；注释说明静默跳过的风险。

3. **端点表与 motion chunk 匹配规则在 fixture / mock / 脚本间重复 — 已修复 `4ecf016`**
   **处置**：`article-ssr-fixture.mjs` 导出 `DEFAULT_MOCK_PORT`、`API_PATHS`、`MOCK_PATHS`、`MOTION_CHUNK_RE` / `isMotionChunkUrl()`；mock 与回归脚本改为消费同一份定义。

4. **宽泛的 `/ERR_FAILED/` 忽略规则 — 已修复 `4ecf016`**
   **处置**：`collectErrors()` 支持谓词过滤；motion 用例只忽略「被阻断的 motion chunk URL + `ERR_FAILED`」这一种预期资源报错，其他失败请求仍会让用例变红。

---

## 运行时探针

- **回归脚本（200 / 404 / 502 全链路）**：`$env:PW_CHANNEL='msedge'; node scripts/verify-article-ssr.mjs` → 6 个检查全部 `OK`；服务端 HTML 含正文标记 / GFM 表格 / 围栏代码 / 每篇文章 meta，`Cache-Control: private, no-cache` 与 `view_7` Set-Cookie 均存在。
- **无 JS**：标题 / 摘要 / 正文段落 / 正文容器的 computed `opacity` 均为 `1`。
- **motion chunk 阻断**：`data-motion-failed` 在 DOMContentLoaded 后 1.5s 预算内出现（catch 路径），首屏仍可见；控制台仅过滤被阻断 chunk 的资源报错。
- **预检失败路径**：用 `MOCK_PORT=4323`（dev server 仍指向 4322）运行 → 退出码 2，提示 dev server 未把 SSR 取数指向本次 mock，并打印正确启动命令。
- **端口冲突路径**：先手动占用 4322 再运行 → 退出码 2，mock 打印 `EADDRINUSE` 与换端口提示。
- **strictPort**：在 4321 已占用时以 `ARTICLE_API_ORIGIN` 启动第二个 dev server → `Port 4321 is already in use` 并退出，未自动顺延到 mock 端口。
- **dev-only origin**：单测锁定 dev 覆盖 / 生产忽略 / 空值回退；构建产物 `DEV: false` 时仍走 `WORKER_ORIGIN`。

---

## 验收对照

- [x] 验证脚本可手动运行（沿用现有 Playwright 安装约定），覆盖文章页服务端正文、禁用 JS、404、控制台无报错。
- [x] 禁用 JS 时标题 / 摘要 / 正文段落及正文容器的 computed `opacity` 均为 `1`，不使用只靠 `toBeVisible()` 的断言。
- [x] 增加阻断 motion chunk 后首屏仍可见的断言；默认可见兜底在 `4ecf016` 前已由 `22fe22f` 补齐，复审进一步锁定 catch 路径。
- [x] 回归脚本不依赖真实 Worker：dev-only `ARTICLE_API_ORIGIN` + 本地 mock 覆盖 200 / 404 / 502；安装与启动命令写入 `docs/agents/testing.md`。
- [x] README 不再声称数据库保存 HTML 渲染结果；文章页 SSR 的取数 / 缓存 / 错误口径与实际实现一致。
- [x] ADR 0004 的决策与实现一致，并从 README 文章 SSR 段链接可达。
- [x] 全部质量门禁通过（见下）。

---

## 门禁重放

- 生成物漂移：`npm run gen:settings`（41 条规则，2 份生成物）与 `npm run gen:headers` 后 `git status` 无生成物变更。
- worker `npm run typecheck`：`tsc --noEmit` + `tsconfig.test.json` 零错误。
- worker `npm test`：10 文件 / 84 用例通过。
- root `npm run check`：0 errors / 0 warnings（5 hints，均为既有）。
- root `npm test`：10 文件 / 90 用例通过。
- root `npm run build`：Astro 构建 + prebuild 生成物 + CSP 收紧通过；静态与 SSR 两份 CSP 逐字符一致。
- `git commit`（`22fe22f`、`4ecf016`）：仓库 pre-commit（lint-staged + worker typecheck/test）均通过，未跳过钩子。

**总结**：Spec 轴 5 条发现——2 条缺失（离线回归预检、端口冲突）、3 条精确性（正文容器 opacity、motion catch 路径、502 口径），全部修复；Standards 轴 0 硬违规，3 条契约判断项与 4 条基线坏味道全部修复。两轴结论按轴分列，不跨轴合并。
