# 代码审查报告 — #40 T4 文章详情 SSR：阅读量 Cookie 与缓存语义（code-review 技能，基点 `68de85f`）

- **日期**：2026-10-22
- **基点**：`68de85f`（#40 实施前 HEAD）
- **变更提交**（1 个，实施提交）：
  - `1d2007c` feat: 文章详情 SSR T4——阅读量 Cookie 与缓存语义（#40）
- **复审修正提交**（1 个）：
  - `baa4947` fix: 文章 SSR T4 审查跟进——Cookie 去重与响应头（#40）
- **Spec 来源**：GitHub issue #40 原文（enhancement / ready-for-agent；Parent #36）
- **标准来源**：`CODING_STANDARDS.md`（契约面同步）+ `README.md` 契约面 + `AGENTS.md` + `docs/agents/testing.md` + ADR 0004；Fowler 坏味道基线
- **方法**：code-review 技能原流程 — 两轴并行子代理（Standards / Spec）；本文件归并两轴结论与处置，**不做跨轴合并或重排序**

---

## Spec

### （a）缺失 / 部分落实

1. **AC「同一 Cookie 连续访问只 +1；无 Cookie 的新访客 +1」缺 API 层行为锁 — 已修复 `baa4947`**
   根级接缝测试打桩 `fetch`，只能证明 SSR 转发了 Cookie / `X-Real-IP`、回传了 `Set-Cookie`，无法证明 Worker 端真的按 `view_<id>` 去重，也无法锁住 Cookie 的 `Max-Age=86400; Path=/; SameSite=Lax` 属性。若 handler / service 的计数或 Cookie 属性漂移，上述测试仍会全绿。
   **处置**：新增 `worker/tests/article_view.test.ts`，用 handler + 真实 service、D1 以记录 `prepare` / `bind` 顺序的桩替代。以手写字面量钉住完整 Cookie 串；断言同一 Cookie 第二次访问不再发 `UPDATE`、无 Cookie 与其他 Cookie 各计一次、`view_8` 不影响文章 7。只测外部可观察行为，未改 API 计数实现与公开契约。

2. **2xx 响应体解析失败时 `Set-Cookie` 被丢弃 — 已修复 `baa4947`**
   初版只在 `response.json()` 与 `parseArticle` 成功后读取 `setCookies`；响应体非法时直接返回 `{ status: "error" }`。但 API 在序列化响应体之前已完成计数，页面丢掉去重 Cookie 后，访客重试会被再次计数，破坏「同一访客 24 小时只 +1」。
   **处置**：在解析响应体之前读取 `response.headers.getSetCookie()`；`withSetCookies` 在 2xx 解析失败 / 未发布分支上按需挂回 `setCookies`，页面响应头 helper 统一用 `result.setCookies ?? []` 回传。新增「200 + HTML 响应体 + Set-Cookie」用例。

### （b）超纲 / 行为漂移

1. **`x-forwarded-for` 回退超出 #40 的信任边界 — 已移除 `baa4947`**
   #40 只点名转发 `cf-connecting-ip`。初版在该头缺失时回退到客户端可自行设置的 `X-Forwarded-For` 首跳，并映射为 `X-Real-IP`；这既超出票面范围，也让访客可伪造上游看到的 IP。
   **处置**：只读取 `cf-connecting-ip` 并 `trim()`；仅带 `X-Forwarded-For` 的请求不再附加 `X-Real-IP`。原回退用例改为断言不转发，锁住信任边界。

### （c）实现但不够精确

1. **缓存语义只测 helper 单点，未锁与 HTML 护栏的组合 — 已修复 `baa4947`**
   `scripts/cloudflare-guards.mjs` 的 `guardHtmlResponse` 会向 `Cache-Control` 追加 `no-transform`；只断言 `applyArticleResponseHeaders` 的单独输出，无法发现后续组合把 `private` 覆盖掉。
   **处置**：新增组合用例：先写文章页响应头，再跑 `guardHtmlResponse`，断言最终值同时含 `private`、`no-cache`、`no-transform`。真实页面探针也确认了最终响应头。

---

## Standards

### （a）违反已文档化标准 — 0 条

无硬性违规。`CODING_STANDARDS.md` 的唯一规则（契约面同步）为判断题，见（b）。

### （b）已文档化标准的判断项

1. **注释把 IP 转发说成阅读量去重所需 — 已修复 `baa4947`**
   `LoadArticleOptions.request` 与模块 JSDoc 原文称「转发 Cookie 与 cf-connecting-ip，用于 API 侧阅读量去重」。实际去重只看 `view_<id>` Cookie；IP 映射只是与同源 API 代理保持约定一致，不参与计数。
   **处置**：改为「Cookie 供 API 侧阅读量去重；cf-connecting-ip 与同源 API 代理一致映射为 `X-Real-IP`」，函数内注释同步。

2. **README 页面表与结构树未体现阅读量 Cookie — 已修复 `baa4947`**
   实施提交只更新了 `articleServer.ts` 结构行与根级测试说明；`[slug].astro` 仍写「SSR：正文 + 每篇 SEO」，`/articles/:slug` 行仍写「Markdown + 每篇 meta」。行为已含 Set-Cookie 回传与私有缓存，契约面缺项。
   **处置**：结构树与页面表补「阅读量 Cookie」；表格由 prettier 重排产生的 churn 一并接受。`docs/agents/testing.md` 的前端测试段落已在实施提交中覆盖该接缝。

3. **新增 worker handler 测试是否符合测试约定 — 经复验保留**
   `docs/agents/testing.md` 要求 handler 级接缝「在确认接缝时显式提出」。本票 AC 直接要求证明阅读量计数与 `Set-Cookie` 属性，而 service 测试不经过 handler，无法覆盖响应头；该测试只断言 HTTP 可观察行为，不改实现，属于 AC 要求的必要接缝。后续同类 worker 契约仍按该约定逐票确认。

### （c）基线坏味道与判断项

1. **`ArticleLoadResult` 内嵌 `setCookies`，响应头 helper 消费整个取数结果 — 经复验保留**
   复审建议拆出独立的页面响应类型，把「取数结果」与「要写给浏览器的头」分开。保留理由：`setCookies` 确实由取数产生，拆类型会引入一层状态映射并让页面同时持有两个对象；当前调用点 `applyArticleResponseHeaders(headers, result)` 更直接，三态映射也只有一个事实源。行为由接缝测试锁住，接受该取舍。

2. **未抽取跨 `articleServer.ts` / API 代理的客户端 IP helper — 经复验保留**
   两处都做 `cf-connecting-ip → X-Real-IP`。但 API 代理另有历史 XFF 回退，且位于 Astro 路由层；为三行逻辑抽共享模块会把 SSR util 与路由实现绑在一起，而 #40 明确不改 API 公开契约。SSR 侧只按票面头转发，代理现状不在本票范围；两侧约定由接缝测试分别锁住。

3. **README 表格重排 churn — 经复验保留**
   由 prettier 对齐产生，内容变更本身必要；与 T2 / T3 的处理一致。

---

## 运行时探针

- **构建产物**：`npm run build` 通过；CSP 仍为「内联脚本 19 处 / 唯一 hash 3 个」，与实施前一致，未新增内联脚本、未放宽 CSP。
- **本地 mock 200 路径**：临时把 `WORKER_ORIGIN` 指向本地 mock 后启动 dev server。首次访问：200 + `Set-Cookie: view_7=1; Path=/; Max-Age=86400; SameSite=Lax`；带同一 Cookie 再次访问：200 且无 `Set-Cookie`；两次响应均为 `Cache-Control: private, no-cache, no-transform`（`no-transform` 由 HTML 护栏追加）。mock 收到 `Cookie: view_7=1` 与 `X-Real-IP: 203.0.113.9`。临时改动已还原，提交前 `git status` 为空。
- **真实 Worker**：本环境到线上 Worker 的出站受限，未做真实文章页浏览器探针；真实浏览器下的阅读量 Cookie 行为按 Parent #36 分工由 T5（#41）Playwright 覆盖。

---

## 验收对照

- [x] 同一 Cookie 连续访问阅读量只 +1；无 Cookie 的新访客 +1（worker handler 行为锁）。
- [x] 浏览器收到 `view_<id>` Set-Cookie：`Max-Age=86400`、`Path=/`、`SameSite=Lax`（逐字符断言 + 页面回传测试）。
- [x] 文章页响应带 `Cache-Control: private, no-cache`（helper 单测 + 与 HTML 护栏组合测试 + 运行时探针）。
- [x] 取数接缝测试覆盖 Cookie / `X-Real-IP` 转发与 Set-Cookie 回传。
- [x] 不改变 API 计数实现与公开契约（实施与修正提交均未改 `worker/src`）。
- [x] 2xx 响应体解析失败时仍回传已下发的 Set-Cookie，避免重试重复计数。
- [x] 未采信客户端 `X-Forwarded-For`；仅转发 `cf-connecting-ip`。
- [ ] 真实浏览器 / 真实 Worker 下的阅读量回归：按分工由 T5（#41）覆盖，本票不做。

---

## 门禁重放

- root `npm test`：9 文件 / 87 用例通过（T4 新增取数、响应头、缓存组合共 10 例）。
- root `npm run check`：0 errors / 0 warnings（5 hints，均为既有）。
- root `npm run build`：Astro 构建 + prebuild 生成物 + CSP 收紧通过（静态与 SSR 两份 CSP 逐字符一致）。
- worker `npm run typecheck`：`tsc --noEmit` + `tsconfig.test.json` 零错误。
- worker `npm test`：10 文件 / 84 用例通过（新增阅读量 Cookie 2 例）。
- `git commit`（`1d2007c`、`baa4947`）：仓库 pre-commit（lint-staged + worker typecheck/test）均通过，未跳过钩子。

**总结**：Spec 轴 4 条发现——3 条修复（API 计数行为锁、2xx 解析失败保留 Set-Cookie、与 HTML 护栏的缓存组合）、1 条移除超纲（XFF 回退）；Standards 轴 0 硬违规，2 条文档判断项修复、1 条测试约定经复验保留，3 条基线坏味道 / churn 经复验保留。两轴结论按轴分列，不跨轴合并。
