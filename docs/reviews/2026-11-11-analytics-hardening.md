# 2026-11-11 生产故障加固 — 两轴复审

- 日期：2026-11-11
- 背景：推送 Tier 0 代码后漏跑 `README.md:509` 的 D1 增量 DDL，生产统计面板「统计加载失败」，且 `recordArticleView` 异常连带把文章详情接口拖成 500。当天已用只读诊断 + 生产 DDL 修复；本报告覆盖事后的三条代码/文档加固。
- 初始提交：`9cb146c`（`fix: harden analytics (counting fault tolerance, diagnosable errors, D1 migration checklist)`）
- 复审修复提交：`3722bbf`（`fix: review follow-ups (no message passthrough, list failure, single DDL source, spec note)`）
- 固定点：`af523a7`
- 复审命令：`git diff af523a7...9cb146c`
- 需求：老大确认的三条——① 计数失败不影响文章正文响应；② 后台错误态带出失败接口 / code；③ README 部署段加 D1 迁移手动清单与 `sqlite_master` 核对。
- 标准来源：`CODING_STANDARDS.md`、`README.md`、`docs/agents/testing.md`、`GLOSSARY.md`、`docs/READER_ANALYTICS.md` §2 / §4.2 / §10、`.github/workflows/deploy.yml` + Fowler 坏味基线
- 说明：两个轴由**并行子代理**分别执行，独立成段，未合并排序。

## Standards

### Hard violation

`scripts/verify-admin-analytics.mjs` 的 error 场景断言 `/overview: 500/` 与 `/D1 error/`，与 `tests/analytics-view.test.ts` 的 `toBe("overview: 500")` 重锁同一段纯函数拼接 → 违反 `docs/agents/testing.md`「同一行为不在浏览器回归里重复测／展示纯函数由单测钉住」。

### Judgement（含规则自标的契约面同步）

- `README.md` 结构树「空库／有数据两场景」失真（新增 error 场景）、`analyticsView.ts` 注释漏 `formatAnalyticsFailures`；`docs/READER_ANALYTICS.md` §4.2 / §10 未同步计数失败时 `setCookie=false` 的异常分支（`CODING_STANDARDS.md` 契约面同步）。
- README 部署清单用 `--file=./<本次增量DDL>.sql` 占位符、无对应可执行文件且 `<>` 易被 shell 当重定向；核对 SQL 的 `LIKE 'analytics%'` 漏两个 `idx_*` 索引。
- **Duplicated Code**：`"overview: 500"` / `code:500` / `sqlite_master` 散见单测、fixture、断言、README；**Shotgun Surgery**：错误契约一改需同动六处；**Primitive Obsession**：布尔 `analyticsError` ＋ 裸 string `analyticsErrorDetail` 双状态源；**Speculative Generality / Divergent Change**：纯函数兼容多类型 code、`checks` 七接口名硬编码。
- 合规核对：新增期望值均为手写字面量（独立来源）；GLOSSARY `_Avoid_` 无新增误用；`deploy.yml` 无 `wrangler d1` 步骤，与「迁移是手动步骤」陈述一致；`loadAnalytics` 在重试 / 切 range 都清空 detail，状态机一致。

## Spec

### (a) Missing / partial

1. `checks` 漏第 8 个并发接口 `list=/articles?page_size=50`，其失败仍静默跳过；`catch` 分支只显示裸异常 message，无接口名 / code。
2. `formatAnalyticsFailures` 边界用例缺字符串 code、`code=0`、空 message、`message==="ok"` 过滤。

### (b) Scope creep

需求 2 只要接口名 / code，实现却把服务端 `res.message` 透传进 DOM（回归脚本还把「D1 error」钉为验收）；内部错误文本 / SQL 片段原样展示，虽 admin-only 仍扩大暴露面且中文界面混英文。另把 README 迁移清单断言塞进纯函数单测，按 `testing.md` 应归跨文档一致性测试。

### (c) Looks implemented but questionable

1. `recordArticleView` catch 后 `setCookie=false`，与 spec §4.2 / §10「SSR 仍下发 `view_` Cookie」不一致；且降级只有 `console.error`，PV/UV 丢失后质量面板无结构化告警。
2. README 命令与上文的「增量 DDL 代码块」操作方式不一致（一处复制 SQL、一处 `--file`）。

## 处置

| #   | 轴        | 发现                                         | 处置                                                                                                                                                                                                                                                                             |
| --- | --------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Standards | 浏览器回归重复锁纯函数拼接（hard）           | **已修 `3722bbf`**：error 场景只断言「错误态指出失败接口 + `.analytics-error-detail` 可见」，拼接格式交 `tests/analytics-view.test.ts`                                                                                                                                           |
| S2  | Standards | 结构树失真、漏列纯函数、spec 异常分支未同步  | **已修 `3722bbf`**：README 两行结构树更新并新增 SQL 文件行；spec §4.2 加「异常降级（2026-11-11 加固）」注；`docs/agents/testing.md` 同步                                                                                                                                         |
| S3  | Standards | 占位符无文件、核对 SQL 漏索引、两份 DDL 维护 | **已修 `3722bbf`**：新建 `worker/schema-tier0-incremental.sql` 作**唯一可执行来源**（3 表 + 2 索引、纯 `IF NOT EXISTS`），README 内嵌代码块替换为文件引用、命令指向它，核对 SQL 覆盖 `idx_view_token*` / `idx_dim_daily*`；新增文档测试锁文件内容与无危险语句                    |
| S4  | Standards | 五类基线坏味（轻）                           | 接受：错误契约由纯函数单测 / 浏览器回归 / 文档测试三层锁定；`analyticsError` 与 `analyticsErrorDetail` 在每次取数开始时成对清空；`checks` 的接口名是接口清单的自然表达，抽常量反增间接层                                                                                         |
| P1  | Spec      | `list` 漏报、catch 无接口名、边界用例不全    | **已修 `3722bbf`**：`checks` 加 `articles_list`；catch 显示 `request: <ErrorName>` 且不带任意异常文本；单测补字符串 code / `code=0` / `null` / 空数组                                                                                                                            |
| P2  | Spec      | 透传服务端 message                           | **已修 `3722bbf`**：`AnalyticsFailure` 去掉 `message`，DOM 只显示接口名与 code；fixture 与回归断言同步删除，回归脚本注释写明分工                                                                                                                                                 |
| P3  | Spec      | `setCookie=false` 与 §4.2 冲突、无结构化告警 | **裁定接受并澄清 `3722bbf`**：DB 故障属异常路径，不下发 Cookie 可让下次访问重试计数、不伪造「已去重」状态；`console.error` 是 Worker 侧可观测信号。spec §4.2 注已写明该次 PV/UV 丢失、恢复后由后续访问自然补齐、不回填历史。结构化告警（计入质量面板）属 Tier 1 观测，超本票范围 |
| P4  | Spec      | 文档一致性测试放错文件                       | **已修 `3722bbf`**：从 `tests/analytics-view.test.ts` 移到 `tests/privacy-page.test.ts`，并补 SQL 文件与 spec 注的断言                                                                                                                                                           |

**Summary:** Standards — 1 hard（S1 重复测，已修）+ 3 judgement（S2 / S3 已修，S4 接受），轴内最严重为 S1；Spec — 4 findings（missing 2 / scope creep 1 / questionable 2，行为性发现全修，P3 有据接受并同步 spec）。所有行为性发现已在 `3722bbf` 闭环。

**Verification:** root `npm test` 136 passed；worker `npm test` 226 passed；worker `npm run typecheck` clean；root `npm run check` 0 errors；Prettier check clean；生成物漂移断言为空；`wrangler deploy --dry-run` 通过；`verify-admin-analytics.mjs`（空库 / 有数据 / 错误态三场景）、`verify-privacy-page.mjs`、`verify-article-ssr.mjs`（系统 Edge）全 PASS；两次提交的 pre-commit hook 均通过。
