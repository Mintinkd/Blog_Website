# Code Review: 边缘 CORS API 自动删除

- **范围**：`9b8126b` 之后的工作区改动（5 文件）：`scripts/remove-edge-cors.mjs`、`tests/remove-edge-cors.test.ts`、`scripts/fix-edge-cors.sh`、`docs/security/cloudflare-guards.md`、`README.md`
- **用户裁决**：token 已加 zone 写权限；写 API 脚本自动删规则 + 保留 wizard 人工兜底，复用 `CLOUDFLARE_API_TOKEN`，不接入 CI
- **审查方式**：单轴全量只读审查（快照 `/tmp/cors-automation.diff`）
- **日期**：2026-11-16

## Findings

| #   | 严重度    | Finding                                                                                                                                                                          | 处置                                                                                                                                                                                                               |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | hard      | `PUT /zones/{id}/rulesets/{id}` 是**整体替换**；原实现优先用 list 摘要的 rules（可能缺 enabled/ref/description/action_parameters），会重置或误删同 ruleset 的其他 Transform Rule | 已改：始终 `GET` 单条拿完整 rules 作为 PUT 权威来源；新增 `sanitizeRuleForPut` 剥离 id/version/last_updated 等只读字段，只保留文档允许的可写字段（10 单测锁定）；PUT 前先 `?dry_run=true` 验证形状，通过才真实提交 |
| 2   | judgement | `per_page=50` 无翻页                                                                                                                                                             | 接受：zone 级每个 phase 恰一个 ruleset，总数远小于 50；已加注释说明                                                                                                                                                |
| 3   | judgement | 复验 3×1.5s 偏短、`redirect:"manual"` 遇 3xx 误判、失败即 exit 1 会让 wizard 误报人工兜底                                                                                        | 已改：4×2s + 跟随重定向；规则已删但缓存未失效只告警不判失败（exit 0），避免 wizard 误触发人工路径                                                                                                                  |
| 4   | judgement | wizard 的 `AUTO_OK` 赋值未使用                                                                                                                                                   | 已删                                                                                                                                                                                                               |
| 5   | judgement | README Secrets 表把 zone 权限写成 CI 必需，但裁决是"不接入 CI"                                                                                                                   | 已改：注明 zone 权限是清理脚本所需、非部署门禁必需                                                                                                                                                                 |

## PASS 维度

- **筛选保守性**：只删 `action=rewrite` + ACAO（大小写不敏感）+ operation set/add + 字面量 `value==="*"` + 无 expression；具体域名 / 其他 header / remove 操作 / 动态表达式一律不动，单测覆盖。
- **幂等与失败语义**：无目标规则退出 0；API 失败 fail-closed（明确报错 + exit 1）；无 token exit 2。
- **isMainModule**：与既有 `verify-d1-migrations.mjs` 同款，`path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)`；实测 CLI 触发 main、单测 import 不触发。
- **wizard**：`local` 在 `run_wizard()` 内合法；`if … && node …` 下 node 失败不受 `set -e` 影响，正确降级人工；`BASH_SOURCE[0]` 可靠；库部分与 template.sh 逐字一致。
- **契约同步**：README token 权限说明与 guards 文档、测试一致。

**finding 5（hard 1 已修 / judgement 4 已处置）；无遗留 hard。**

## 门禁

根包 41 files / 485 tests PASS、Worker 32 files / 304 tests PASS、`npm run check` 0 errors、`npm run build` PASS、`node --check` + `bash -n` + wizard 库一致性 PASS。
