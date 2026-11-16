# Code Review: #83 H1 种子口令随机化 + 会话级强制改密 + 强度校验统一

- **Fixed point:** `69cbf30`（#83 改动前的 main）
- **Commit under review:** `d4236f0 fix(worker): randomize seed credential and enforce session-wide password gate (#83)`
- **Spec:** GitHub issue #83（H1，Deferred from #42，Epic #71）
- **Standards sources:** `README.md`（契约）、`CODING_STANDARDS.md`、`AGENTS.md`、`docs/agents/testing.md`
- **Review date:** 2026-11-16

## 实现摘要

1. **随机种子口令**：新增 `worker/scripts/seed-credential.mjs`（纯函数：生成/哈希/UPSERT SQL）与 `worker/scripts/db-seed.mjs`（CLI，写库成功后才打印一次明文）。口令 `randomUUID().slice(0,16)`，PBKDF2 哈希与 `worker/src/utils/password.ts` 同参同格式，登录路径可直接校验。全新库 `schema.sql` 删除可登录的种子 admin 行。
2. **会话级闸门**：`router.ts` 移除 `WRITE_METHODS` 限制，须改密会话的任何鉴权请求（含 GET 类管理接口）一律 403，仅 `/auth/refresh`、`/auth/change-password` 豁免。
3. **fail-closed**：`middleware/auth.ts` 的 `getUserAuth` 在 `must_change_password` 列缺失时返回 `mustChangePassword: true`（旧口径 false 会放行未迁移库），由 router 闸门拦截。
4. **三路径强度统一**：`assertPasswordStrength`（#45 已建）保持为建号/重置/自助改密单一入口；`auth_password_strength.test.ts` 已逐路径覆盖，本票加 `seed_random.test.ts` / `h1-password-gate.test.ts` 补关节点。
5. **存量识别常量收窄**：`utils/seed.ts` 仅保留 `LEGACY_SEED_PASSWORD_HASH` / `LEGACY_SEED_PLAINTEXT`（明确只用于存量弱口令账号识别 + 黑名单），移除旧 `DEFAULT_SEED_PASSWORD` / `INITIAL_ADMIN_PASSWORD_HASH` 命名。`seed_constants.test.ts` 改写为守卫「schema.sql 恰一处历史哈希 + 无种子 INSERT」。

## Standards 轴

1. **[judgement] 常量命名**：`LEGACY_SEED_PLAINTEXT = "password"` 仍是字面量，但其语义已收窄为「存量识别 + 弱口令黑名单输入」，且 `utils/seed.ts` 顶部注释明确不参与建号。符合「契约面同步」——README 已同步 seed 流程。**可接受**。
2. **[judgement] `db-seed.mjs` 的 `spawnSync` + `shell: win32`**：仅用于对固定数组参数（`npx wrangler d1 execute blog-db --command <sql>`，SQL 由白名单用户名与 hex 哈希拼成）调用，无外部输入注入面；`seedUpsertSql` 已校验用户名与哈希格式。**可接受**。
3. **[judgement] 测试 fixture 重复**：`h1-password-gate.test.ts` 的 `makeEnv` 与 `reconcile_route.test.ts` 同构，符合 `docs/agents/testing.md` 既有约定（每测试文件独立 stub），不计 smell。

**Standards 总结：0 hard / 3 judgement（均可接受），无阻断项。**

## Spec 轴（验收标准逐条）

| #   | 验收标准                                                       | 覆盖                                                                                                                  | 结论 |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | 新部署无硬编码可登录口令；db:seed 随机口令仅输出一次、不可复现 | `seed_random.test.ts` 5 条 + `seed_constants.test.ts` 无种子 INSERT 断言；`db-seed.mjs` 仅写库成功后 console.log 一次 | ✅   |
| 2   | 列未迁移 getUserAuth 不放行（fail-closed），有单测             | `h1-password-gate.test.ts` 2 条（含缺列 GET 403、豁免路径可达）                                                       | ✅   |
| 3   | needsChange 会话 GET 管理接口 403，仅两豁免可达，有单测        | `h1-password-gate.test.ts` 6 条（GET /users、/settings、写接口、正常放行、refresh、change-password）                  | ✅   |
| 4   | 三路径拒绝同一组弱口令样例，有单测                             | `auth_password_strength.test.ts` 三条路径各测弱口令/站名/用户名变体 + `assertPasswordStrength` 单测                   | ✅   |
| 5   | D1 迁移步骤写入 README，存量库与全新库都有明确路径             | README「初始化数据库 / 首次设置」两段：全新库 db:init + db:seed；存量库 fail-closed 与必须回放三列迁移                | ✅   |
| 6   | 三套门禁全绿                                                   | worker 34 files/318 tests + typecheck；根包 41 files/491 tests；`npm run check` 0 errors/0 warnings/8 hints           | ✅   |

**Spec 总结：6/6 验收标准满足，无缺失/部分实现。**

## 取舍与残余风险（如实留痕）

- **fail-closed 代价**：未迁移库上，已改密用户也会被当作须改密（无法从旧列判断），仅续期/改密可达。这是有意选择——正确出路是立即回放 `schema.sql` 中 `users` 三列迁移，README 已明确标注。不静默宣称「未迁移也能正常运行」。
- **存量识别哈希**：`5e884898...`（SHA-256 of "password"）保留仅作存量打标，不用于建号；新库无此口令。永久保留是存量库识别的必要条件。
- **Out of scope（票面明确）**：`jwt_secret` 写白名单（M8/#51 已修）、通用 D1 迁移框架（M12）、须改密以外的会话/权限模型改造——本票均未触碰。

## 门禁结果（本地 HEAD `d4236f0`）

- `cd worker && npm test`：34 files / 318 tests PASS
- `cd worker && npm run typecheck`：0 errors
- 根包 `npm test`：41 files / 491 tests PASS
- `npm run check`：0 errors / 0 warnings / 8 hints（150 files）
