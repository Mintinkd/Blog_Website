# Code Review: #73 M22 索引与 SELECT * 列裁剪

- **Fixed point:** `39a9442`
- **Diff:** `git diff 39a9442...HEAD`
- **Commits under review:** `6b9cd36 perf(worker): add missing indexes, explicit select columns and paged export (#73)`
- **Spec:** GitHub issue #73（M22，Deferred from #42，Epic #71）
- **Standards sources:** `CODING_STANDARDS.md`、`AGENTS.md`、`docs/agents/testing.md`、`docs/agents/domain.md`
- **Review date:** 2026-11-16

## Standards

（子代理报告，lightly cleaned）

**HARD**

- **F1 契约面同步**：`columns.ts:6` 注释引用 "docs/agents/testing.md 的 M22 登记"，但该文件 M22/#73 零登记；`README.md:264/344` 未同步分页、5000 上限、`table` 参数与新响应字段。注释/契约段失真。
- **F2 数据完整性＋契约违约**：`handleExport` 默认导出由全表变为每表 `LIMIT 5000`，响应无每表 `total` / `has_more`，调用方无法可靠翻页，备份静默截断，与 README "整站备份" 冲突。
- **F3 测试约定**：新增 3 个测试文件零登记；`columns.ts` 列清单与 schema 一致性无独立来源锁定，`query_columns.test.ts` 仅用源码正则断言（brittle）。

**JUDGEMENT**

- **F4 Duplicated/Divergent Code**：`columns.ts` 常量区与 `admin.ts:48-157`（`IMPORTABLE_TABLES.columns`）重复维护多表列清单，两处均自称唯一来源。
- **F5 Shotgun Surgery**：改一处列需同步 schema + columns + importables + 3 处测试桩 SQL 字符串。
- **F6 安全白名单**：`admin.ts:183` 用 `IMPORTABLE_TABLES[tableParam]` 做白名单，未用 `hasOwn`；`constructor`/`toString` 等原型属性可绕过到 `:208` 的 `.columns.join` 抛未捕获 500。测试只测 `users_secret`，漏继承属性。无 SQL 注入。
- **F7 契约失真**：`columns.ts:4` 称 "所有外返查询都从这里取列"，但 `handleExport` 取自 `IMPORTABLE_TABLES`。

**PASS**：列裁剪保留 `category.created_by`、`article.published_at`、`media.uploaded_by`；`idx_media_assets_uploaded_by` 位于 `ALTER TABLE` 之后；两处测试桩仅同步 SQL 字符串，断言未削弱。

**Standards: 7 findings（HARD 3 / JC 4）；最严重 F1 契约面同步。**

## Spec

（子代理报告，lightly cleaned）

**AC 逐条**：索引（三个 + IF NOT EXISTS + 顺序）✅；SELECT * 清零（6 文件无裸星号，`a.*` 属 M2 正当排除）✅；导出上限/单测 ✅。

**缺失/部分**

- **F1** "索引变更需在 README 或迁移说明中留痕"未满足：README 未登记分页/上限/table/新响应字段，也无三索引迁移登记。
- **F2** "关闭评论附查询计划或耗时对比"属关票人工动作，标注。

**scope creep（轻微）**

- **F3** friend_link.ts/tag.ts 的引号/换行格式化噪音；导出 `table` 参数略超字面但服务于分片，合理。

**实现有误**

- **F4（最严重）** "响应形状兼容或迁移路径说明"仅满足前半：默认行为由全表导出变为每表最多 5000 行静默截断，不传 `page` 会丢数据，迁移路径未见说明。

**Spec: 4 findings；最严重 F4 导出默认静默截断。**

## 处置

| 来源                        | Finding                                                              | 处置                                                                                                                                                                     | Fix commit       |
| --------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| Standards 1 [hard] / Spec 1 | README 未登记导出分页/上限/table 与三索引迁移                        | README 导出表行、初始化数据库段、部署迁移核对命令均已更新；新建 `worker/schema-m22-incremental.sql` 作为存量库升级唯一可执行来源                                         | 见下方 follow-up |
| Standards 2 [hard] / Spec 4 | 导出默认 5000 行静默截断，备份丢数据                                 | 改为 `LIMIT pageSize+1` 哨兵：响应每表 `has_more[table]` 明确标记是否还有下一页，哨兵行不泄漏；README 写明"须翻页取全"的迁移路径；单测覆盖 has_more 真/假两态            | 同上             |
| Standards 3 [hard]          | 3 个新测试零登记、列清单无独立来源守卫                               | testing.md 补 M22 登记；`query_columns.test.ts` 加增量 DDL 与 schema.sql 索引语句一致性机械守卫                                                                          | 同上             |
| Standards 4/7 [judgement]   | columns.ts 与 IMPORTABLE_TABLES.columns 双源、注释自称"所有查询"失真 | 重写 columns.ts 注释明确职责边界：handler 读取列在此、admin 导出列在 `IMPORTABLE_TABLES`（导入/导出共用白名单），两处不重叠                                              | 同上             |
| Standards 5 [judgement]     | Shotgun Surgery（改列要同步多处）                                    | 接受不改：根因是 D1 无迁移工具（M12 另票）与测试桩按 SQL 字符串分派；本次已把 handler 列集中到 columns.ts、导出列集中到 descriptors，改列最多触及 schema + 一处清单 + 桩 | —                |
| Standards 6 [judgement]     | 原型属性（constructor/**proto**）绕过 table 白名单致 500             | 改用 `Object.prototype.hasOwnProperty.call`；单测补 constructor/toString/\_\_proto\_\_ 四例均 400                                                                        | 见下方 follow-up |
| Spec 3 [轻微]               | friend_link.ts/tag.ts 格式化噪音、table 参数略超字面                 | 接受：格式化来自 pre-commit prettier；table 参数服务于分片且已在 README 登记                                                                                             | —                |
| Spec 2 / F2                 | 关闭评论附 EXPLAIN QUERY PLAN                                        | 关票评论补记（人工动作，非代码）                                                                                                                                         | 关票时           |

> follow-up commit hash 在提交后回填。所有修复通过 worker 304 测试 + typecheck + 根包 `npm run check`（0 errors）。
