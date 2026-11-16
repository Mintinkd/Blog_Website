# Code Review: CI/CD D1 自动迁移与流程自动化

- **范围**：本轮未提交工作区改动（base `6ec7702`），8 个文件：`.github/workflows/deploy.yml`、`README.md`、`docs/security/cloudflare-guards.md`、`tests/privacy-page.test.ts`、`scripts/fix-edge-cors.sh`、`scripts/verify-d1-migrations.mjs`、`tests/d1-migration-verify.test.ts`、`worker/schema-verify.sql`
- **用户裁决**：CI 每次 push 自动跑两个幂等增量 DDL + 迁移后核对 + 删 L8 sleep120 二次部署 + 边缘 CORS 人工 wizard（四项全做）
- **审查方式**：单轴全量只读审查（未提交快照 `/tmp/ci-cd.diff`），门禁由本地实测提供
- **审查日期**：2026-11-16

## Findings

| #   | 严重度    | 维度        | Finding                                                                                                                                              | 处置                                                                                                                                                      |
| --- | --------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | hard      | 契约同步    | `README.md:696` 残留「等待 120 秒…二次覆盖部署」，与 `deploy.yml` 已删除该步骤直接矛盾（CODING_STANDARDS.md「契约面同步」复发项）                    | 已改：README 自动部署清单第 2 步改为 D1 迁移、末尾加「L8 已清理」说明；`tests/privacy-page.test.ts` 新增 CI 契约测试锁定顺序与无 sleep/Re-deploy 实际语句 |
| 2   | hard      | wizard 语义 | `scripts/fix-edge-cors.sh:236` 裸 `confirm` 在 `set -e` 下回答 N / 回车即 exit 1，跳过 Stage 3 复验与 finish，与 guards 文档「最后自动复验」承诺矛盾 | 已改：包进 `if confirm ...; then ... else ... fi`，未确认也继续复验                                                                                       |
| 3   | judgement | 失败耦合    | 迁移与前端部署强耦合：token 无 D1 权限或 m22 前置列缺失时，连与 D1 无关的 Pages 前端也阻断；无前置权限探测                                           | 接受：代码/schema 版本必须一致，迁移失败本就该阻断整批部署；失败信息依赖 wrangler 原生输出，已由 README「token 需 D1 编辑权限」前置说明                   |
| 4   | judgement | 前置依赖    | `schema-m22-incremental.sql` 依赖存量库已执行 `ALTER TABLE ... uploaded_by`                                                                          | 接受：存量生产库已执行过迁移（T7/T8 时期），全新库按 schema.sql 顺序执行；前置条件已写进增量文件头注释                                                    |

## PASS 维度

- **CI 顺序 / 失败语义**：迁移+核对在全部门禁之后、Pages/Worker 部署之前；无 `|| true`，失败即 fail job。
- **核对脚本正确性**：`shell:true` 仅 win32、CI(Linux) 走直连；`parseWranglerJson` fail-closed 且不受 wrangler stderr warning 污染；8 项预期对象与两份增量 DDL 产物一一对应；`--file` 规避 Windows 引号问题（本地空库冒烟正确报 8 缺失 + exit 1）。
- **幂等性**：两份 DDL 全 `CREATE ... IF NOT EXISTS`，无 DROP/ALTER/UPDATE/DELETE，CI 重放安全。
- **wizard 库一致性**：1–192 行与 template.sh 逐字一致；3 stage 与 TOTAL_STAGES=3 一致；URL/人工步骤准确，`scripts/fix-edge-cors.sh:234` 明确勿删其他规则；实测线上 `Access-Control-Allow-Origin: *` 仍在（问题属实，wizard 有实际用途）。
- **契约同步**：README 部署段与 `tests/privacy-page.test.ts` 断言一致（自动迁移、verify 脚本、编辑权限、tier0 文件名）。

**finding 总数 4（hard 2 已修 / judgement 2 接受）；无遗留 hard。**

## 门禁（本地实测）

- 根包 `npm test` 40 files / 477 tests PASS；`npm run check` 0 errors / 8 hints
- Worker `npm test` 32 files / 304 tests PASS；`npm run typecheck` PASS
- `npm run build` PASS，CSP 静态 / SSR 逐字符一致
- workflow YAML 用 node yaml 解析 PASS（17 步，顺序正确）
- `bash -n scripts/fix-edge-cors.sh` PASS；wizard 库与 template 逐字一致
- `node scripts/verify-d1-migrations.mjs --local` 正确 fail-closed（空库报 8 缺失 + exit 1）
