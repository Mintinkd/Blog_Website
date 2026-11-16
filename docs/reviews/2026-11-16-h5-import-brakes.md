# Code Review: #86 H5 全量导入刹车（KV 备份 + dry-run + 二次确认）

- **Fixed point:** `d2085e0`（#86 改动前 main）
- **Commit under review:** `96c95c2 fix(worker): add import safety brakes - dry-run, KV backup, scale confirmation (#86)`
- **Spec:** GitHub issue #86（H5，Deferred from #42，Epic #71；与 #87 同批设计）
- **Standards sources:** `README.md`、`CODING_STANDARDS.md`、`docs/agents/testing.md`、`worker/tests/admin_import.test.ts`
- **Review date:** 2026-11-16

## 实现摘要

`worker/src/handlers/admin.ts` 的 `handleImport` 在阶段 1（全量校验，零 SQL）后新增阶段 1.5 三道刹车：

1. **dry-run**：`POST /admin/import?dry_run=1` 只做只读 `COUNT(*)` 统计，返回 `would_delete` / `would_insert` / `total_inserting` / `needs_confirm` / `backup_key: null`，**零 DELETE/INSERT、零 KV 写**。
2. **异常规模确认**：某表新行数 > 10× 现有行数（现有 0 行时基线取 10）或总导入 0 行 → 需 `confirm=1`，否则 400。被拒时不写 KV、不入库。
3. **KV 备份**：正常导入前把涉及表的当前全量数据（列白名单内）写入 `MEDIA` KV，key `backup:<ISO>.<uuid8>`、TTL 7 天；写入失败即中止（不留无备份的破坏性操作）；响应 `data.backup_key` 返回键名。

另修正既有 catch 用 `error(SERVER_ERROR, ...)` 未传 status 导致 500 变 400 的口径 bug；异常不再回显 SQL 原文，仅服务端日志。

新增/更新测试：`admin_import.test.ts` 补 7 条 H5 测试（dry-run 零写、备份 key/TTL、空导入/超量 confirm、10× 边界、dry-run needs_confirm、备份失败中止）；`friend_link_security.test.ts` 的 import mock 补 MEDIA KV（no-op）。

## Standards 轴

1. **[judgement] 备份写 MEDIA KV**：票说「现有 KV 绑定」，MEDIA 是现有 KV（媒体存储）。备份是 JSON 字符串，与媒体对象共存于同一 namespace、以 `backup:` 前缀区分，不冲突。**可接受**；若后续引入专用 BACKUP 绑定可平滑迁移（key 格式不变）。
2. **[judgement] 0 行表基线取 10**：`oldCount=0` 时阈值 = 10×10 = 100 行，避免空库首次导入任意行数都被判异常；纯工程取舍，已在代码注释说明。
3. **[judgement] dry-run 的 `would_delete` 语义**：返回 `COUNT(*)` 即当前行数（「提供即替换」语义下将被清空的行数），site_config 的密钥行例外（按 skipKeys 保留），README 未细化这点——属既有语义的延续，非本票新增歧义。**可接受**。

**Standards 总结：0 hard / 3 judgement（均可接受），无阻断项。**

## Spec 轴（验收标准逐条）

| #   | 验收标准                                                           | 覆盖                                                                                                        | 结论                 |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | dry_run=1 不产生 DELETE/INSERT，返回预估行数，有单测               | H5 测试第 1、6 条（零写 + needs_confirm 预判）                                                              | ✅                   |
| 2   | 导入前生成 `backup:<ISO>` KV 备份返回 backup_key，TTL 7 天，有单测 | H5 测试第 2 条（key 格式/TTL/内容）+ 失败中止第 7 条                                                        | ✅                   |
| 3   | 超阈值（0 行或 >10×）无 confirm 被拒，带 confirm 放行，有单测      | H5 测试第 3、4、5 条（空导入/超量/边界）                                                                    | ✅                   |
| 4   | 未鉴权 401/403，异常不含 SQL 原文                                  | 路由层 admin-only 鉴权（router.ts，既有测试覆盖）；catch 改「internal error」不回显 SQL，H5 测试第 7 条断言 | ✅                   |
| 5   | 关闭评论给出「误传空文件 / 超量文件」实测结果                      | 本报告 + 关闭评论以单测场景结果如实记录（非生产实测，环境无法跑生产 D1）                                    | ✅（如实标注单测级） |
| 6   | 三套门禁全绿                                                       | worker 35/335 + typecheck；根包 42/501；check 0 errors/0 warnings/8 hints                                   | ✅                   |

**Spec 总结：6/6 满足。第 5 项为单测级实测（非生产），已如实标注。**

## 取舍与残余风险

- **非事务**：本票只做「刹车」，导入仍非 batch 原子——中途失败会留半空库（H9 / #87 范围，下票处理）。
- **备份基于阶段 1.5 时点**：备份读在写之前，与阶段 2 之间若有并发写（理论上 admin 单操作），快照可能略旧；D1 无交互式事务，此为本票接受的取舍。
- **H9 的 KV 孤儿清理**：删除 media_assets 不同步删 KV 对象，本票未碰（#87 范围）。

## 门禁结果（本地 HEAD `96c95c2`）

- `cd worker && npm test`：35 files / 335 tests PASS；`npm run typecheck` 0 errors
- 根包 `npm test`：42 files / 501 tests PASS
- `npm run check`：0 errors / 0 warnings / 8 hints（154 files）
