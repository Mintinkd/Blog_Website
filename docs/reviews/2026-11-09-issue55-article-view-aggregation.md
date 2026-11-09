# #55 阅读统计 3/7：详情访问落日聚合与概览接口 — 两轴复审

- 日期：2026-11-09
- 初始提交：`d4181ba`（`feat: #55 详情访问落日聚合与概览接口`）
- 复审修复提交：`048985f`（`fix: #55 review fixes (shared cookie fixture, contract sync, dedup branch)`）
- 固定点：`3353120`
- 复审命令：`git diff 3353120...d4181ba`
- 规格来源：issue #55；`docs/READER_ANALYTICS.md` §2 / §4.1 / §4.2 / §6 / §7.2 / §9 / §10 / §11；`docs/adr/0005-reader-analytics-aggregate-first.md`；`GLOSSARY.md`
- 标准来源：`CODING_STANDARDS.md`、`README.md`、`docs/agents/testing.md`、`GLOSSARY.md`、`.github/workflows/deploy.yml` + Fowler 坏味基线
- 说明：本次两个轴由**并行子代理**分别执行（#54 因子代理额度不可用改为同会话分轴），两轴独立成段，未合并排序。
- 已知背景：`worker/src/services/article_service.ts` 的 311 行 diff 中约 300 行是 pre-commit `lint-staged` 的 prettier 归一（单引号→双引号），行为变更仅删除 `incrementViewCount` 并留迁移注释；两轴均已单独甄别。

## Standards

**Hard violations: 1。**

### Hard violations

1. **共享定义只有一份** (`docs/agents/testing.md:80`) — `HttpOnly` Cookie 字面量在 `scripts/mock-article-api.mjs`、`scripts/verify-article-ssr.mjs`、`tests/article-server.test.ts`、`worker/tests/article_view.test.ts` 四处各写一份（本次 hunk 同步改），mock / 脚本 / 断言共用的契约值未收敛到 fixture。

### Documented-standard breaches (judgement)

1. **契约面同步** (`CODING_STANDARDS.md:7`) — `README.md:155` 结构树仍注 `analytics_service.ts # …（issue #53）`、`:305` 页面表仅「阅读量 Cookie」，缺 #55 的 `recordArticleView` 计数与 `handlers/analytics.ts`，违排查面第 2 条。
2. **契约面同步** (`CODING_STANDARDS.md:7`) — `docs/READER_ANALYTICS.md` 自称口径单一来源，但 §4.2 新增裁定块与紧邻伪代码第 1 步「直接跳过（不写库）」、第 3 步「存在 → 跳过」互斥；§1:17 仍称「计数入口 → `incrementViewCount`」，违排查面第 1 / 3 条。
3. `deploy.yml` 门禁与 `testing.md:87-88`（接缝确认、期望值独立来源）经核查无违反。

### Baseline smells (judgement)

- **Duplicated Code** — `analytics_service.ts` 的 `recordArticleView` 中，`cookieHit` 与 `existing` 两分支逐字重复 `bumpDaily(env, articleId, day, ["pv", "requests"]).run()`。
- **Data Clumps** — `(env, articleId, day, counters)` 在 4 处 `bumpDaily` 调用反复同行。
- **Shotgun Surgery** — 与 Hard violation 1 同一事实（Cookie 字面量跨文件散落）。
- `engaged: null` 有 README / §7.2 / 测试明文依据，非 Speculative Generality；`article_service.ts` 的格式归一不计违规。

## Spec

### (a) Missing / partial

1. §4.1 注要求规则改动同步 `bot_filtered` 的解释文案并注明「免费版无 Bot Management」；本次仅写入 `isBotRequest` 代码注释，§7.6 面向后台的文案未产出（§7 后台 UI 属 #55 out of scope）。
2. 除此之外，§10 验收 8 条与 Desired behavior（§4.1 七规则、HMAC 令牌、`batch()` 原子写、overview、range 白名单、草稿 / 直连口径）逐项落地，未见功能缺失。

### (b) Scope creep

- `article_service.ts` 311 行 diff 约 300 行是单引号→双引号格式化，与 §9 第 3 步迁走 `incrementViewCount` 无关。
- 概览多回显 `range` 字段；Desired behavior 仅要求返回「PV / UV / 过滤 bot / 有效阅读（Tier 0 为空）」。

### (c) Looks implemented but questionable

1. **已知裁定的残留** — 实现注释与 §4.2 裁定块已一致，但 §4.2 第 1 步正文仍写「直接跳过、不写库」，第 3 步「令牌存在 → 跳过」亦未改，裁定块只澄清第 1 步；而 `recordArticleView` 对令牌命中同样累加 `pv` / `requests`。
2. **代理覆盖率分母可能系统性漏计** — 验收 6 / §2 要求直连 `requests` +1 作分母；真实直连多为 `Accept` 非 html 或 `curl` UA，命中 §4.1 规则 4 / 7，按其末段「不计 requests 也不计 bot_filtered」，分母恐被漏计；测试以浏览器头绕开了这一点。
3. **§11 决策 7 的「后台预览已发布文章不再污染数据」** — `handleGetArticle` 不区分后台预览，直连仍 `requests` +1 并下发 Cookie，与决策 7 影响栏相左。

## 处置

| #   | 轴        | 发现                                                      | 处置                                                                                                                                                                                                   |
| --- | --------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | Standards | Cookie 字面量四处散落（hard violation）                   | **已修 `048985f`**：`scripts/` 侧 mock 与浏览器回归共用 `article-ssr-fixture.mjs` 的 `VIEW_COOKIE`；根包 / worker 单测按 `testing.md:88` 独立来源约定保留手写字面量，并在 `testing.md:80` 写明跨包边界 |
| S2  | Standards | README 结构树 / 页面表契约面失真                          | **已修 `048985f`**：结构树补 `handlers/analytics.ts` 与 `recordArticleView`，页面表补 Tier 0 计数与 `HttpOnly`                                                                                         |
| S3  | Standards | spec §4.2 裁定块与伪代码互斥、§1:17 旧计数入口            | **已修 `048985f`**：伪代码 1 / 3 步改为「跳过 UV 去重分支」并补第 4 步 pv / requests，裁定块覆盖两步；§1 计数入口改 `recordArticleView`                                                                |
| S4  | Standards | Duplicated Code：两个分支重复的 `bumpDaily`               | **已修 `048985f`**：收敛为 `pendingToken === null` 单一出口                                                                                                                                            |
| S5  | Standards | Data Clumps：`(env, articleId, day, counters)`            | 接受：4 次调用均在同模块内且参数固定，封装类型只增加间接层；S4 修复后调用点已减少                                                                                                                      |
| S6  | Standards | `article_service.ts` 311 行格式归一                       | 接受：pre-commit `lint-staged` 的 prettier 机械归一，无行为变化                                                                                                                                        |
| P1  | Spec      | `bot_filtered` 解释文案未产出                             | **已修 `048985f`**：spec §4.1 注补「文案由 #58 面板落地，#55 只写数据」；后台 UI 本就 out of scope                                                                                                     |
| P2  | Spec      | 格式归一属 scope creep                                    | 接受：同 S6，hook 强制行为                                                                                                                                                                             |
| P3  | Spec      | 概览多回显 `range`                                        | 接受：`range` 是请求参数回显，不引入新数据；便于 #58 前端把响应与筛选条件对齐，避免错配过期响应                                                                                                        |
| P4  | Spec      | §4.2 第 1 / 3 步文字残留互斥（同 S3）                     | **已修 `048985f`**，同 S3                                                                                                                                                                              |
| P5  | Spec      | 代理覆盖率分母可能系统性漏计                              | 接受且不改实现：§4.1 末段明文规定「被规则丢弃的直接请求不计 `requests`」，属 spec 既定口径；按 §9 第 7 步观察两周后评估，#57 质量面板负责告警                                                          |
| P6  | Spec      | §11 决策 7「后台预览不污染数据」与直连 `requests` +1 相左 | 接受：工单验收 6 与 §2 明确 `requests` 含全部过滤后 200（代理覆盖率分母）；实现不污染 PV / UV / `view_count`，仅影响分母，属既定口径                                                                   |

**Summary:** Standards — 1 hard violation（S1，共享契约值漂移，已修）+ 5 judgement（S2–S6，2 已修 / 3 接受），轴内最严重为 S1；Spec — 6 findings（missing 1 / scope creep 2 / questionable 3，2 已修 / 4 接受），轴内最严重为 P5 代理覆盖率分母口径（接受，留观察期）。所有行为性发现已在 `048985f` 闭环。

**Verification:** root `npm test` 106 passed；worker `npm test` 195 passed；worker `npm run typecheck` clean；root `npm run check` 0 errors；Prettier check clean；生成物漂移断言为空；`wrangler deploy --dry-run` 通过；文章 SSR Playwright 回归（系统 Edge）在修复后复跑 PASS；两次提交的 pre-commit hook（lint-staged + worker typecheck/test）均通过。
