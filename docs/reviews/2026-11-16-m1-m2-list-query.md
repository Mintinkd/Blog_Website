# 代码审查报告：M1 列表 N+1 / M2 列表正文裁剪（issue #89 / #90）

**日期**：2026-11-16
**固定点**：`b9a232e`（改动前 HEAD）
**审查范围**：`git diff b9a232e...HEAD`，两笔实现提交 + 一笔修复提交

- `eea8a4f` perf(worker): 列表标签改一次查询消除 N+1 (#89)
- `86140d5` perf(worker): reading_time 落库 + 列表不再取正文 (#90)
- `b04b501` fix(worker): address #89/#90 review findings (#89,#90)

**双轴**：Standards（仓库明文标准 + Fowler smell 基线）、Spec（issue #89/#90 验收标准），并行子代理独立审查后聚合。

---

## Standards

**HARD（明文标准破坏）**：无。CODING_STANDARDS「契约面同步」自标 judgement；testing.md「期望值独立来源」未被突破——期望均为手写字面量。

**JUDGEMENT（6 项）**：

| #   | 位置                                       | finding                                                                                                              | 处置                                                                                                                                                                                 |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `parseTagsBlob`                            | 按 `^^` split，name 无转义；标签名含连续 `^^` 会被拆成两段致整条标签丢失。测试只覆盖 `^_`                            | **部分接受**：`^^` 是票面指定的分隔符方案固有边界，标签 slug 受 URL-safe 约束、连续 `^^` 属人为构造；已补单个 `^` 用例（`x^y`）与 SQL 拼接格式守卫，连续 `^^` 边界在关票评论如实留痕 |
| 2   | `listArticles` reading_time 回退           | NULL 回退调用 `calculateReadingTime(row.content)`，但列表 SELECT 已删 content → 恒算为 1，注释「惰性现算」与行为不符 | **已修**（`b04b501`）：回退改为字面量 1（与 schema DEFAULT 一致），注释更正；详情 `mapArticleDetail` 因 `a.*` 含 content 保留现算回退                                                |
| 3   | `schema.sql` vs `migrate-reading-time.mjs` | schema 新建库 `NOT NULL DEFAULT 1`，迁移 ALTER 仅可空无默认 → 新旧库约束分叉（Divergent Change）                     | **已修**（`b04b501`）：迁移 ALTER 改为 `INTEGER NOT NULL DEFAULT 1`，两端一致                                                                                                        |
| 4   | 两份 `calculateReadingTime`                | 脚本版多 `String(text ?? "")`，「逐字一致」措辞不成立（Duplicated Code）                                             | **接受**：脚本从 D1 读的 content 可能为 null，Worker 端入参恒为 string，差异是必要防御；`tests/reading-time-migration.test.ts` 交叉锁定 7 组样例同值，防漂移                         |
| 5   | `README.md` articles 结构表                | 未补 `reading_time` 列说明（部署段已改）                                                                             | **已修**（`b04b501`）：结构表补 reading_time 语义                                                                                                                                    |
| 6   | 回退三元重复 + SQL 拼接格式无守卫          | 列表/详情两处回退三元重复；`article_list_tags.test.ts` 只喂预拼 blob                                                 | **已修**（`b04b501`）：补 `ORDER BY t.id` 与 `'^^'`/`'^_'` 分隔符守卫；详情保留现算属正当差异（有 content），不做强合并                                                              |

**最严重（Standards 轴）**：#1 标签名含连续 `^^` 致列表标签丢失（票面分隔符方案边界， judgement）。

---

## Spec

**(a) 验收缺失 / 部分实现**

- #90「存量回填：迁移 / 惰性二选一并说明」：选了迁移却仍保留惰性回退代码、未写「关闭另一路径」说明 → 与 (c) 同源，关票评论明确选「迁移脚本回填」为唯一路径、列表的 1 是缺值兜底而非回填。

**(b) scope creep**

- 无。`mapArticleDetail` 改 reading_time 取值来源未裁详情列，不违反 #73 的 out-of-scope。

**(c) 实现有误**

- #90 列表惰性回退读不到 content，存量 reading_time 静默错为 1 → **已修**（见 Standards #2）。
- #89 特殊字符无损不成立（name 含 `^^` 被截断）→ 同 Standards #1，接受为分隔符边界并补测。

**最严重（Spec 轴）**：#90 列表回退恒为 1（已修）。

---

## 门禁（修复后）

- Worker：`37 files / 354 tests PASS`，`tsc --noEmit` + `tsconfig.test.json` 0 errors。
- 根包：`43 files / 511 tests PASS`；`npm run check` 0 errors / 0 warnings / 8 hints（156 files）。
- 真实 SQLite 冒烟：`group_concat` blob 顺序稳定、含 `^_` 的 name 可正确解析。
- CI 接线：`node ../scripts/migrate-reading-time.mjs` 在 `working-directory=worker` 下路径正确；脚本 `node --check` 通过。

## 结论

Standards 6 项 judgement（3 已修 / 3 接受并留痕），Spec 3 项（2 已修 / 1 关票说明）；无遗留 hard finding。两票改动与测试文件分离，可分别关票。
