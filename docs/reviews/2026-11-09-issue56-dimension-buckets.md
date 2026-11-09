# #56 阅读统计 4/7：Tier 0 维度桶与分布接口 — 两轴复审

- 日期：2026-11-09
- 初始提交：`522a9d4`（`feat: #56 Tier 0 维度桶与分布接口`）
- 复审修复提交：`10498d4`（`fix: #56 review fixes (shared range parse, device buckets, tablet UA-CH, wording)`）
- 固定点：`eedd357`
- 复审命令：`git diff eedd357...522a9d4`
- 规格来源：issue #56；`docs/READER_ANALYTICS.md` §3 / §4.2 / §5 / §6 / §7.5 / §9 / §10 / §11；`docs/adr/0005-reader-analytics-aggregate-first.md`；`GLOSSARY.md`
- 标准来源：`CODING_STANDARDS.md`、`README.md`、`docs/agents/testing.md`、`GLOSSARY.md`、`worker/schema.sql`、`.github/workflows/deploy.yml` + Fowler 坏味基线
- 说明：两个轴由**并行子代理**分别执行，独立成段，未合并排序。`README.md` 的表格重排是 prettier 归一的既有行为，两轴均未计为违规。

## Standards

**Hard violations: none.** `CODING_STANDARDS.md`「契约面同步」逐项已同步（README 结构树 / 接口表 / 计数段、spec §5 / §7.5、`worker/schema.sql` 注释、handler / service / router / `visitor_context` 相邻注释）；`docs/agents/testing.md` 的独立来源、共用流水线约定与 `deploy.yml`（漂移断言 → typecheck → test）均合规。

### Documented-standard breaches (judgement)

1. **词汇一致性** (`GLOSSARY.md`「去重访客」_Avoid_ 明列 "UV"；`CODING_STANDARDS.md` 排查面第 3 条) — `worker/src/services/analytics_dimensions.ts:11`、`docs/READER_ANALYTICS.md` §3 裁定注使用了 "UV" 缩写；ADR 0005 的「文档面：GLOSSARY 阅读词条实施时同步」本次未动。
2. **关联文档** (同规则) — `docs/reviews/2026-11-09-issue54-ssr-visitor-context.md:36` 把 `Sec-CH-UA-Mobile` 归 #55、`Sec-CH-UA` / platform 归 #56，与 #56 实际只用前者相反。

### Baseline smells (judgement)

- **Duplicated Code** — `worker/src/handlers/analytics.ts` 新增 handler 整块复制了 overview 的 range 校验与逐字文案「仅支持 today/7d/30d/90d」，未从 `RANGE_DAYS` 派生。
- **Shotgun Surgery / 单一来源** — `analytics_dimensions.ts` 的 `mobile` / `desktop` / `tablet` 是 5 处裸字面量，而 `unknown` / `direct` / `internal` / `other` 已常量化；阈值 5 / 20 与白名单在 README 接口表、§7.5、schema.sql 注释有副本。集中化只做到了运行时白名单 / 阈值。
- **Data Clumps** — `DimRow` 与 `analytics_dim_daily` mock 在两个测试文件各一份（#55 复审 S1 已接受单测各留字面量，仅提示）。

## Spec

已知裁定 (A) UV 口径、(B) 缺失桶名 / 同站判定、(C) `other` / `insufficient` 经核对与实现、代码注释、spec 均一致，不重复报为缺陷。

### (a) Missing / partial

1. §3 维度表与工单 Desired「`country`（两位码）」：`dimensionBuckets` 仅 `context.country ?? "unknown"` 原样落桶，无两位码校验 / 归一；测试把 `T1`（CF Tor 标记）钉为合法桶。裁定 (B) 只写「缺失落 unknown」，未覆盖两位码，属残留不一致。

### (b) Scope creep

- 顺带重构 #55 的 `handleAnalyticsOverview`（抽出 `rangeBounds()`、改 `from` / `to` 计算）：工单 #56 的 Desired / Key interfaces / §6 均不含概览，属超出本票范围的既有代码改动（行为未变）。

### (c) Looks implemented but questionable

1. **同站判定前提** — `dimensionBuckets(context, new URL(request.url).hostname)` 拿 Worker API origin 当站点 host；§1、README 载明 SSR 直连 Worker origin，若与读者侧站点域不同，站内 Referer 永不命中 `internal`，§3「区分站内跳转」落空。
2. **验收 (3) 的边界** — 测试 `DIM_ROWS` 每篇 total ≥ 21、无 `< 5` 桶；小样本保护在查询层各查各做，某篇含小桶先并 `other` 时，逐篇 `buckets` 之和 ≠ 全站 `buckets`，该边界未覆盖。
3. **平板识别** — §3 设备四值含 `tablet`：`deviceBucket` 的 UA-CH `?0` 直接短路 `desktop`（测试钉死 iPhone + `?0` → desktop），真实平板发 `?0` + 桌面 UA 不会落 `tablet`。

## 处置

| #   | 轴        | 发现                                              | 处置                                                                                                                                                                                   |
| --- | --------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Standards | 注释 / 文档使用 GLOSSARY 避免的 "UV"              | **已修 `10498d4`**：service 注释、spec §3、README、测试描述统一为「去重访客」，报表 `uv` 列名保留；GLOSSARY 的「去重访客」「聚合桶」两条已覆盖本次概念（#53 已补去重键），无新术语需增 |
| S2  | Standards | #54 历史复审报告对后续票的维度推测与 #56 实际不符 | 接受：该句是 #54 复审时的推测，非契约；归档报告保留原文以维持可追溯性。#56 只用 `Sec-CH-UA-Mobile`，`Sec-CH-UA` / platform 属 Tier 1 out of scope                                      |
| S3  | Standards | Duplicated Code：两处 range 校验与逐字文案        | **已修 `10498d4`**：抽 `parseRange(params)`，错误文案由 `Object.keys(RANGE_DAYS)` 派生，两个 handler 共用                                                                              |
| S4  | Standards | device 桶名裸字面量，与其余桶名常量化不一致       | **已修 `10498d4`**：新增 `DEVICE_BUCKETS` 常量；README / spec / schema 的副本是跨角色契约说明，运行时单一来源已收敛到 `analytics_dimensions.ts`                                        |
| S5  | Standards | Data Clumps：两个测试文件各一份 `DimRow` mock     | 接受：两处分别模拟 D1 写路径与读路径，按 `testing.md:88` 独立来源约定保留；#55 复审 S1 同裁定                                                                                          |
| P1  | Spec      | `country` 未重复做两位码校验，`T1` 被钉为合法     | **已澄清 `10498d4`**：spec §3 裁定注明确「两位码由 #54 `readVisitorContext` 归一，含 `T1` 等 CF 特殊码，映射函数不重复校验」；代码不改，避免与 #54 口径冲突                            |
| P2  | Spec      | 顺带重构 #55 概览属 scope creep                   | 接受：分布接口需同一套日界口径；`10498d4` 进一步与 `parseRange` 共用，#55 的 5 个 overview 测试全绿、行为未变                                                                          |
| P3  | Spec      | 同站判定依赖 Worker origin 与站点同域             | **已澄清 `10498d4`**：spec §3 注明该前提（README 文章详情页 SSR 段已载明同域），拆域部署时须同步调整；当前部署同域，代码不改                                                           |
| P4  | Spec      | 含小桶时逐篇展示桶之和 ≠ 全站展示桶               | **已澄清 `10498d4`**：spec §7.5 与测试注释写明验收 (3) 的「一致」指 `SUM(count)` 聚合计数；§7.5 明文要求保护在查询层做，行为不改                                                       |
| P5  | Spec      | UA-CH `?0` 短路 desktop，平板无法识别             | **已修 `10498d4`**：`?0` 时先按 UA 识别 `tablet`，再压过 UA 中的手机特征；新增 2 条表驱动用例                                                                                          |

**Summary:** Standards — 0 hard violations、5 judgement（S1 / S3 / S4 已修，S2 / S5 接受），轴内最严重为 S3 重复校验与逐字文案；Spec — 5 findings（missing 1 / scope creep 1 / questionable 3，P5 已修、P1 / P3 / P4 已澄清、P2 接受），轴内最严重为 P3 同站判定的部署前提。所有行为性发现已在 `10498d4` 闭环。

**Verification:** root `npm test` 106 passed；worker `npm test` 208 passed；worker `npm run typecheck` clean；root `npm run check` 0 errors；Prettier check clean；生成物漂移断言为空；`wrangler deploy --dry-run` 通过；文章 SSR Playwright 回归（系统 Edge）在修复后复跑 PASS；两次提交的 pre-commit hook（lint-staged + worker typecheck/test）均通过。
