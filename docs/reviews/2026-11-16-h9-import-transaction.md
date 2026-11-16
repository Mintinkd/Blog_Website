# Code Review: #87 H9 admin/import 事务化（batch 原子替换 + KV 孤儿清理）

- **Fixed point:** `518cff0`（#87 改动前 main）
- **Commit under review:** `a138953 fix(admin-import): 批量事务化替换 + KV 孤儿清理 (#87)`
- **Spec:** GitHub issue #87（H9，Deferred from #42，Epic #71；与 #86 / H5 同批设计）
- **Standards sources:** `AGENTS.md`、`docs/agents/issue-tracker.md`、`docs/agents/testing.md`、`README.md`、`worker/tests/admin_import.test.ts`
- **Review date:** 2026-11-16

## 实现摘要

`worker/src/handlers/admin.ts` 的 `handleImport` 阶段 2 从「先逐表 DELETE、再逐行 INSERT 的串行写」改为**先构造全部语句、再分批 `env.DB.batch()` 提交**：

1. **语句构造**：`buildDeleteStatements()` 按 `DELETE_ORDER`（先子后父）产出 DELETE，`buildInsertStatements()` 按 `INSERT_ORDER`（先父后子）产出 INSERT；列名仍只取自 `IMPORTABLE_TABLES` 白名单，净化与密钥行跳过逻辑原样复用。
2. **事务保证**：D1 官方文档明确 `batch()` 内语句是 SQL 事务——「If a statement in the sequence fails ... it aborts or rolls back the entire sequence」。每批最多 `MAX_IMPORT_BATCH_STATEMENTS = 200` 条语句，批内 DELETE + INSERT 同生共死，不再出现「旧数据已删、新数据未写完」的半空表。
3. **跨批失败回滚**：阶段 1.5 的 KV 备份（`backupBeforeImport`）现在同时保留内存快照；任一批失败即按 FK 顺序重放本机快照（含 `site_config` 密钥行跳过的同一口径），响应 500 带 `data.backup_key` 与 `data.restored`，异常原文只写服务端日志。
4. **KV 孤儿清理**：DB 全部批成功提交后才执行 `env.MEDIA.delete()`；只删 `storage_type='kv'`、非空且**未被新导入复用**的旧 `kv_key`（复用 key 的对象仍是活的，不能删）。单个删除失败不回滚已提交的 DB，响应 `kv_orphans_deleted` / `kv_cleanup_failed` 如实报数。
5. **响应可观测**：新增 `batches`（提交批次数）、`kv_orphans_deleted`、`kv_cleanup_failed`；保留 #86 的 `imported` / `skipped_secret_rows` / `backup_key`。

测试：`admin_import.test.ts` 由 13 条扩充至 19 条（新增 6 条 H9：批失败原子性+快照回滚、跨表批顺序、200 条分批边界、KV 孤儿逐个清理/复用跳过、KV 删除失败不回滚 DB、路由层 401/403）；`friend_link_security.test.ts` 的假 D1 补 `batch()` 接口。

## Standards 轴

1. **[judgement] 分批而非单次超大 batch**：票面要求「大导入分批 batch」。D1 文档未给出公开的每批语句数硬上限，但给出单 SQL 100 KB / 100 bind 参数 / 30 秒执行上限与 Worker CPU/内存限制。取 200 条/批为保守值：典型 9 表全量（每表数百行）一次提交，超大备份切为多批。**可接受**。
2. **[judgement] 跨批原子性的处理**：D1 只保证**批内**事务，跨批天然不原子。选择「快照自动回滚」而非把所有语句塞进一个可能超平台限制的巨型 batch；回滚失败时保留 `backup_key` 并明确 `restored:false`，不谎称已恢复。**可接受，残余风险见下**。
3. **[judgement] KV 清理放在 DB 提交后**：与常规删除媒体「先删 KV 再删 DB」相反。这里若先删 KV 而 DB 批失败，会把仍被 DB 引用的对象删掉；提交后清理的最坏情况是残留孤儿（可重试/占存储），比删除活对象更安全。**可接受**。
4. **[judgement] 只清 `storage_type='kv'`**：远端存储行可能把 `kv_key` 当 URL 或留空，一律跳过，避免误删不存在的 KV 对象。**可接受**。

**Standards 总结：0 hard / 4 judgement（均可接受），无阻断项。**

## Spec 轴（验收标准逐条）

| #   | 验收标准                                                                   | 覆盖                                                                                                                                           | 结论 |
| --- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | 单测：batch 中某条 INSERT 失败时 DELETE 不生效（原子性），库保持导入前状态 | H9 测试第 1 条：假 D1 在批失败时抛错且不 apply 任何语句；断言 500、`restored:true`、状态回到 `OLD`、无 KV 删除                                 | ✅   |
| 2   | 单测：`DELETE media_assets` 时对应 KV 对象被逐个删除，无孤儿残留           | H9 KV 测试第 1 条：旧 `old-1`/`reused`/`remote-url`/`null` 四种行，新导入复用 `reused` → 只删 `old-1`；第 2 条断言删除失败不回滚 DB 且如实报数 | ✅   |
| 3   | 跨表 batch 顺序满足外键约束，有集成测或说明                                | H9 测试第 2 条：打乱输入顺序后，展平 batch 语句的 DELETE/INSERT 表序仍等于 `DELETE_ORDER` / `INSERT_ORDER`；实现注释标明 rank 来源             | ✅   |
| 4   | 大导入分批执行，关闭评论说明分批策略与上限                                 | H9 测试第 3 条：450 行 → 451 条语句切成 200/200/51 三批；关闭评论给出 200 条/批、批内事务、跨批回滚策略                                        | ✅   |
| 5   | 未鉴权返回 401/403，异常响应不含 SQL 表名/原文                             | H9 测试第 1 条断言 500 响应 message 无 `site_config`/`INSERT`/`DELETE`/`SELECT`；路由级新增 2 条断言 401/403                                   | ✅   |
| 6   | `npm test`、`cd worker && npm test`、`npm run check` 全绿                  | 根包 42/501；worker 35/342 + typecheck 0 errors；check 0 errors / 0 warnings / 8 hints                                                         | ✅   |

**Spec 总结：6/6 满足。**

## 取舍与残余风险

- **跨批失败依赖自动回滚**：回滚本身也是分批执行，极端情况下（回滚批再次失败）会部分恢复，响应 `restored:false` + `backup_key`；生产需在 #86 备份 TTL（7 天）内按 `backup_key` 人工恢复。未实现自动重试，避免失败循环中反复写库。
- **KV 删除不可与 D1 同事务**：批提交后逐个删，删除失败响应报 `kv_cleanup_failed`；孤儿对象可能残留并继续计费，需要重试导入或人工按 key 清理。未实现后台补偿队列（超出本票范围）。
- **备份时点窗口**：快照读在阶段 1.5，语句提交在阶段 2；若其间有其他写路径改动同表（管理员导入为单操作、D1 单线程），快照可能略旧；D1 无交互式事务，沿用 #86 的取舍。
- **生产 D1 实测未做**：本地以假 D1 模拟 batch 事务语义，未在 Cloudflare 生产 D1 上跑大导入；批大小 200 为保守工程值，未经生产压测定标。
- **未做（out of scope）**：dry-run / 备份 / 二次确认（#86 已做）；点赞/评论计数对账（#72 已做）；导入字段净化（#43 等已做）；编辑器/前端 UI 无变化。

## 门禁结果（本地 HEAD `a138953`）

- `cd worker && npm test`：35 files / 342 tests PASS；`npm run typecheck` 0 errors
- 根包 `npm test`：42 files / 501 tests PASS
- `npm run check`：0 errors / 0 warnings / 8 hints（154 files）
