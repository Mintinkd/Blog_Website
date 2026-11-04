# #53 阅读统计 Tier 0 表结构与每日清理骨架 — 两轴复审

- 日期：2026-11-04
- 初始提交：`46ac0ac`（`feat: #53 阅读统计 Tier 0 表结构与每日清理骨架`）
- 复审修复提交：`afee2d2`（`fix: #53 review fixes ...`）
- 固定点：`60b441b`（`HEAD~1`）
- 复审命令：`git diff 60b441b...46ac0ac`
- 规格来源：issue #53；`docs/READER_ANALYTICS.md` §5 / §9 第 1 步 / §10 / §11；`docs/adr/0005-reader-analytics-aggregate-first.md`

## Standards

**Hard violations: none.** Contract faces are synced: README structure (119/128/155), DB table (184–200), incremental DDL (491–528), `schema.sql` header comment, `admin.ts` header + `skipKeys` + descriptor comment, and the updated test title all match the code. Prettier check passes on all changed files; the `index.ts` quote churn and `wrangler.jsonc` trailing commas are tooling-canonical — skipped.

### Documented-standard breaches (judgement)

1. **契约面同步** (`CODING_STANDARDS.md:7`) — README's `/admin/import` behaviour row (`README.md:278`) never says the three `analytics_*` tables are outside backup/restore. `handleExport` iterates `IMPORTABLE_TABLES` (`admin.ts:171`), so 13 tables (README:184) back up as 10. `admin.ts:30` claims the descriptor is "新增表/列的唯一编辑点" — three tables were added without it, and no comment records the deliberate exclusion. Either add them or state the exclusion in README.
2. **testing.md:88** (expectations need an independent source) — the cron contract test pins only shape: `expect(config.triggers.crons[0]).toMatch(/^\d+ \d+ \* \* \*$/)` (`analytics_cleanup.test.ts:310`). A drift from README:528 / ADR 0005 (`0 16 * * *`) still passes; pin the literal.
3. **testing.md:87 / behaviour comment** — `runAnalyticsCleanup`'s comment promises "心跳只在全部删除成功后写入；失败时保持旧值", but no test makes a DELETE reject. The `worker.scheduled` test is also a handler seam not in the ticket interfaces listed at `analytics_cleanup.test.ts:17-21`.

### Baseline smells (judgement)

- **Mysterious Name** — `AnalyticsCleanupResult` fields hold counts, not days:
  ```ts
  articleDays: articleDays.meta.changes,
  dimDays: dimDays.meta.changes,
  ```
  → `articleRowsDeleted` / `dimRowsDeleted`.
- **Duplicated Code** — three DELETEs differ only by table/column (`analytics_service.ts:70-86`), mirrored three times in the stub (`test:90-125`). The lazy-secret shape is now a third copy (`auth_handler.ts:76-88`, `middleware/auth.ts:187-195`) → **Shotgun Surgery** on secret storage.
- **Shotgun Surgery** — one key list is hand-maintained in `schema.sql:257-258`, `admin.ts:145-151`, README:197/491, docs §5 and tests; a single exported `ANALYTICS_CONFIG_KEYS` could derive `skipKeys` and the test.
- **Primitive Obsession** — `day` (`YYYY-MM-DD`) and `expires_at`/`heartbeatAt` (`YYYY-MM-DD HH:MM:SS`) are both bare `string` inside one function; branded types would block cross-passing.
- **Speculative Generality** — `getAnalyticsHmacSecret` has no `src` caller (tests only); README:491 already advertises "首次计数时懒生成".

## Spec

**(a) Missing / partial**

1. _"心跳键加入备份导出跳过名单"_ — only the **import** path filters keys. `handleExport` (`worker/src/handlers/admin.ts:171-177`) still does `SELECT * FROM ${table}` over `site_config`, so `analytics_last_job_at` (and `jwt_secret`) are still exported. `skipKeys` (`admin.ts:145-151`) only drives import DELETE/INSERT. Intent (don't overwrite local heartbeat on import) is met; the stated export-side skip is not.
2. _"schema.sql 重复执行不报错（新增语句全部幂等）"_ — never executed. `analytics_cleanup.test.ts:273-296` only regex-matches `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` text. Also the new block sits after the non-idempotent `ALTER TABLE users ADD COLUMN …` lines, so a literal full-file rerun still errors (`duplicate column`) — README acknowledges this, but the acceptance line is verified only textually.

**(b) Scope creep**

- Whole-file reformat churn unrelated to the feature: `worker/src/index.ts` quote style flipped throughout, `wrangler.jsonc` gains trailing commas on every pre-existing entry and loses a blank line, `admin_import.test.ts` `bodyOf` signature reflow. Prettier-clean, but pure noise in review.
- `getAnalyticsHmacSecret()` (`analytics_service.ts:112-126`, ~66 lines + tests) has **no production caller**; §9 puts secret consumption in step 3 (counting). It ships an unexercised read-then-write path early.
- README edits beyond the deployment section (structure tree, 10→13 table list). Reasonable doc hygiene, just wider than "部署章节".

**(c) Looks implemented but questionable**

1. Secret generation is read-then-`INSERT OR REPLACE` (`analytics_service.ts:113-124`). Two concurrent first-use isolates both generate; the later write wins, so tokens hashed with the losing secret never match — up to 24h of extra UV. Spec: _"`analytics_hmac_secret`（首次使用时懒生成，**不复用** `jwt_secret`）"_. `INSERT OR IGNORE` + re-read is race-safe. (Same pattern as `jwt_secret` in `auth.ts:194`, so it follows precedent rather than inventing a new bug.)
2. Retention boundary encodes an unspecified decision: `retentionCutoffDay` = today−399 and `DELETE … WHERE day < ?` deletes rows **exactly 400 days old**. Issue pins only _"399 天前的行保留，401 天前的行删除"_; the test asserts 400-deleted (`analytics_cleanup.test.ts:191`). Defensible ("保留 400 天" = 400 days incl. today) but should be confirmed, since it's now locked by tests and README.
3. Schema seeds `analytics_last_job_at` as `''` (`schema.sql:257-258`) while README says it's cron-written and _"无需手工预置"_. Harmless, but §7.6's "> 26 小时标红" check must special-case empty string.

Everything else checks out: three tables/columns/indexes match §5 byte-for-byte in README vs `schema.sql`; no `analytics_consent`; `scheduled` + `0 16 * * *` (= Shanghai 00:00); expired/unexpired, 399/401 boundary and heartbeat all covered; `npm test` 179 pass, `typecheck` clean.

## 处置

| #   | 轴        | 发现                                    | 处置                                                                                                                                                  |
| --- | --------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Standards | 备份/恢复未说明 analytics 三表排除      | 已修 `afee2d2`：README API 行 + 数据库设计段说明「派生数据不参与备份」；`admin.ts` 描述符与 `handleExport` 补刻意排除注释                             |
| S2  | Standards | cron 契约测试只钉形状                   | 已修 `afee2d2`：逐字断言 `["0 16 * * *"]`，与 README 一致                                                                                             |
| S3  | Standards | 心跳失败路径无测试                      | 已修 `afee2d2`：新增「DELETE 失败 → 不写心跳」测试；`scheduled` 入口测试保留为接线守卫                                                                |
| S4  | Standards | `articleDays`/`dimDays` 名称不表意      | 已修 `afee2d2`：改为 `expiredTokensDeleted` / `articleRowsDeleted` / `dimRowsDeleted`                                                                 |
| S5  | Standards | 三处 DELETE 与密钥读取形状重复          | 部分处置：密钥并发路径已收敛；JWT/统计密钥共用 helper 属跨模块重构，留待后续；三处 DELETE 为不同表/列的显式 SQL，保留可读性                           |
| S6  | Standards | 配置键清单多处手维护                    | 接受：仅两键，且 `schema.sql` 无法 import TS；`skipKeys` 还含 JWT/管理员键，派生常量收益有限                                                          |
| S7  | Standards | `day`/时间戳裸字符串                    | 接受：存储层契约已在 schema 注释固定；branded type 不改变本层行为                                                                                     |
| S8  | Standards | `getAnalyticsHmacSecret` 暂无生产调用方 | 接受：工单明确要求懒生成，#55 是命名消费者，测试已覆盖                                                                                                |
| P1  | Spec      | 心跳键仅在 import 侧跳过，export 仍全量 | 接受并澄清 `afee2d2`：`skipKeys` 是「跨环境导入保留本机值」名单；导出保持 admin 全量快照。若要对导出也过滤，属单独行为变更（会同时移除 JWT/管理员键） |
| P2  | Spec      | schema 幂等仅文本断言                   | 接受：已用 `node --experimental-sqlite` 对新增块连续执行两次（表/索引/种子均成功）；全文含非幂等 `ALTER`，README 已明确不得重跑全文                   |
| P3  | Spec      | Prettier 全文件格式化噪声               | 接受：lint-staged/prettier 为仓库工具链，提交时强制执行                                                                                               |
| P4  | Spec      | `getAnalyticsHmacSecret` 提前落地       | 接受：见 S8                                                                                                                                           |
| P5  | Spec      | README 结构/表清单改动超出部署章节      | 接受：`CODING_STANDARDS.md` 契约面同步要求结构清单与数据库表清单随行为更新                                                                            |
| P6  | Spec      | 首次使用密钥并发覆盖                    | 已修 `afee2d2`：改为「仅填空值」upsert + 回读；`node:sqlite` 验证第二次写入不覆盖首个值                                                               |
| P7  | Spec      | 400 天边界未在工单钉死                  | 接受：按「保留 400 个日界（含今天）」实现——399 天前保留、400/401 天前删除；工单只钉 399/401，测试已锁定该解释                                         |
| P8  | Spec      | 心跳种子为空串                          | 接受：新库种下空值表示「从未运行」；存量库由 cron 首次写入，README 的「无需手工预置」指增量片段                                                       |

**Summary:** Standards — 3 documented-standard breaches (worst: backup/restore contract gap) + 5 baseline smells (all judgement); Spec — 2 missing/partial (worst: export-side heartbeat skip wording), 3 scope-creep notes, 3 questionable implementations (worst: first-use secret race). All hard/behavioural findings fixed in `afee2d2`; remaining items accepted with rationale above.
