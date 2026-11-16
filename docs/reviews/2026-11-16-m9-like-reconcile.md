# Code Review: #72 M9 点赞事务与对账入口

- **Fixed point:** `566b89d`（HEAD~1，#72 改动前的 main）
- **Diff:** `git diff 566b89d...HEAD`
- **Commits under review:** `8837835 fix(worker): atomic like counters and admin reconcile endpoint (#72)`
- **Spec:** GitHub issue #72（M9，Deferred from #42，Epic #71）
- **Standards sources:** `CODING_STANDARDS.md`、`AGENTS.md`、`docs/agents/testing.md`、`docs/agents/domain.md`、`worker/tests/admin_import.test.ts`
- **Smell baseline:** Fowler ch.3 heuristics（judgement call，repo standard 优先）
- **Review date:** 2026-11-16

> 说明：`worker/src/handlers/like.ts` 的 88 行改动中，大部分是 pre-commit prettier 的引号/分号/换行格式噪音（原文件为单引号无分号风格）。真实逻辑改动为三处：`run()→batch()` 原子化、`try/catch + serverError`、两条注释。格式噪音按「工具已强制跳过」处理，不计 finding。

## Standards

（子代理报告原文， lightly cleaned）

1. **[hard] worker/src/router.ts（+516~524）**：新增 admin 端点 `POST /admin/reconcile-counters` 未进 `README.md` 的 admin 接口表（344–351 行）。违反 `CODING_STANDARDS.md`「契约面同步」排查项：该模块在 README 契约段的行文是否失真或已缺项——此处为明确缺项。
2. **[judgement] docs/agents/testing.md**：逐一登记了既有测试，三个新测试文件与新端点零登记，与该文件的登记惯例不符（描述性文件，弱）。
3. **[judgement] worker/src/handlers/reconcile.ts（+30~47, +50~79）**：`likeTruth`/`commentTruth` 两个 Map 构建循环近乎逐字重复；两段 `if(before!==after){differences.push;statements.push}` 同构（Duplicated Code / Data Clumps）。
4. **[judgement] worker/src/handlers/reconcile.ts**：全篇 `as Array<Record<string,unknown>>` + `String()/Number()` 强转、`field` 用字面量联合而非领域类型（Primitive Obsession）。

测试文件风格与 `admin_import.test.ts` 一致（手写期望、独立来源、stub 记录 SQL），符合 `docs/agents/testing.md`；测试间 fixture 重复属该约定预期，不计 smell。like.ts 两个 batch 分支的镜像重复为弱 Duplicated Code。

**Standards 总结：4 条 finding（1 hard / 3 judgement）；最严重为 README admin 接口表缺项。**

## Spec

（子代理报告原文，lightly cleaned）

**缺失 / 部分实现**

- **F1 [缺失]**：spec「在关闭评论中如实记录存量漂移是否已随对账接口修复，以及是否需要人工触发一次」。需关闭 #72 时人工补记。
- **F2 [部分]**：spec「模拟 batch 中 UPDATE 失败时，DELETE 不生效（原子性），计数与记录一致」。`like_transaction.test.ts` 在 batch() 层直接 throw，断言 batchCommitted() 为空只复述桩自身行为；桩无真实 DB 状态，「计数与记录一致」未真正断言。
- **F3 [部分]**：spec「like_count 收敛到 COUNT(*) 真值，响应含修复差异」。`reconcile_counters.test.ts` 的 batch() 只记录 UPDATE 不回写 state，仅证明「发出写真值的 UPDATE」；收敛后实际值未读回。

**Scope creep**：无实质越界。comment_count 对账为 spec 明示允许，口径 `status='approved'` 与 `comment.ts` 一致。like.ts 的 prettier 重排属噪音。

**实现有误**：未发现阻断性错误。两条分支均用 `env.DB.batch`；路由鉴权、401/403 测试齐全；`serverError` 500 不回显 SQL。

**Spec 总结：3 条 finding；最严重 F2——原子性仅获桩级验证，存在验收盲区。**

## 处置

| 来源                    | Finding                                                   | 处置                                                                                                                      | Fix commit       |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Standards 1 [hard]      | README admin 接口缺 `/admin/reconcile-counters`           | 已补接口表行（含口径说明）                                                                                                | 见下方 follow-up |
| Standards 2 [judgement] | testing.md 未登记新测试                                   | 已在 Worker 测试段补三条登记                                                                                              | 同上             |
| Standards 3 [judgement] | reconcile.ts 两个 Map 循环 / 两段 diff 同构               | 已抽 `truthMap` / `diffField` helper，`field` 收敛为 `CounterField` 类型                                                  | 同上             |
| Standards 4 [judgement] | Primitive Obsession（`as Array<Record<string,unknown>>`） | 接受不改：D1 `all().results` 返回 `unknown[]`，字段读出必须强转；属边界适配而非领域概念缺类型。抽 helper 后强转集中到一处 | —                |
| Spec F1 [缺失]          | 关闭评论须记录存量漂移是否需要人工触发                    | 关票评论补记（非代码）                                                                                                    | 关票时           |
| Spec F2 [部分]          | 原子性仅桩级验证，「计数与记录一致」未真断言              | like 桩改为有状态 in-memory D1：`likes` 集合为独立真值源，batch 成功才应用；三个用例均读回断言 `likeCount === likes.size` | 见下方 follow-up |
| Spec F3 [部分]          | 对账只验证「发出 UPDATE」，未读回收敛值                   | reconcile 桩 batch 成功后写回 `state.articles`；新增读回断言 + 二次对账 `fixed=0` 幂等断言                                | 同上             |

> follow-up commit hash 在提交后回填。所有修复均通过 worker 全量测试（294）+ typecheck + 根包 `npm run check`。
