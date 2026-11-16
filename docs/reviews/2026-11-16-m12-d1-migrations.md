# 代码审查报告：M12 数据库迁移工具（issue #94）

**日期**：2026-11-16
**固定点**：`07ab163`（改动前 HEAD）
**审查范围**：`git diff 07ab163...HEAD`（提交 `01fdad9` 实现 + follow-up 修复）
**双轴**：Standards + Spec，并行子代理独立审查。

---

## Standards

**HARD（2 项，均已修）**：

1. `migrations/0001_baseline.sql` 漏了旧 schema.sql 尾部的 `CREATE TABLE IF NOT EXISTS users(...)` 兜底——极老库无 users 表时 `ALTER TABLE users...` / `UPDATE ... SELECT FROM users` 报 `no such table: users`，违背「极老库可补齐」承诺。→ 补 CREATE TABLE IF NOT EXISTS users；测试加「极老库无 users 表也能 apply 0001」真实 SQLite 守卫。
2. `docs/agents/testing.md` 两处失实：① 仍称 query_columns 锁「索引位于 ALTER TABLE 之后」（已改为列在 CREATE TABLE）；② 称 d1_migrations.test.ts 有 wrangler `--local` 端到端测试（实为人工实测）。→ 两处均改为准确描述。

**JUDGEMENT（2 项）**：

| #   | finding                                                                                                        | 处置                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | `schema-m22-incremental.sql:4` / `deploy.yml:139` 注释仍说「schema.sql 尾部 ALTER TABLE」，已收编至 migrations | **已修**：更新两处注释                                                      |
| 2   | node:sqlite 属 experimental、CI Node 版本浮动                                                                  | **接受**：CI node-version 22 自带 node:sqlite；测试用 :memory: 无持久化依赖 |

**最严重（Standards）**：HARD-1 极老库无 users 表失败（已修）。

---

## Spec

**(a) 验收缺失/部分**

- A3「重复 apply 不报错，有说明或测试」：wrangler 层端到端为人工实测（已验证 baseline 标记后 `No migrations to apply`），自动化测试覆盖 node:sqlite 层幂等。→ testing.md 已如实说明，不虚报。
- A4「#73 脚本去向在关闭评论明确」：关票评论写明（结构性历史走 migrations、CI 幂等补丁保留为防御网）。

**(b) scope creep**

- testing.md 配套文档改动：合理配套，非功能越界。

**(c) 实现有误**

- 无（HARD-1 已在 Standards 轴处置）。

**核对通过**：migrations 命名合规且 wrangler 能 list；全新库 schema.sql 连跑两次无 duplicate；baseline 标记后不重放 0001（实测 `No migrations to apply`）；H1 legacy hash 逐字搬运、reading_time 未动；deploy.yml 的 Apply D1 migrations 步骤未改；全绿实测。

**最严重（Spec）**：A3 自动化覆盖边界（已如实记录）。

---

## 门禁（修复后）

- Worker：43 files / 402 tests PASS；typecheck 0 errors。
- 根包：47 files / 535 tests PASS；`npm run check` 0 errors / 0 warnings / 8 hints。
- wrangler：`migrations list --local` 正确识别 0001_baseline.sql。
