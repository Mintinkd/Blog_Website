# Code Review: #85 H4 同源代理 CORS 白名单回归修复 + 共用常量 + 代理超时

- **Fixed point:** `f25ed07`（#85 改动前 main）
- **Commit under review:** `5776937 fix: converge CORS allowlist across worker and proxy, add proxy timeout (#85)`
- **Spec:** GitHub issue #85（H4，Deferred from #42，Epic #71）
- **Standards sources:** `README.md`、`CODING_STANDARDS.md`、`AGENTS.md`、`docs/agents/testing.md`、`scripts/generate-settings-rules.mjs`（双端生成先例）
- **Review date:** 2026-11-16

## 边缘层规则状态（票面人工前置，如实留痕）

关闭前用票面诊断命令实测：

```
curl -sS -D - -o /dev/null https://blog.zenfishlog.dpdns.org/ | grep -i access-control-allow-origin
→ HTTP/1.1 200 OK
→ Access-Control-Allow-Origin: *
```

**结论：zone `zenfishlog.dpdns.org` 的边缘层通配 ACAO 规则仍在（2026-11-16 实测，全站生效）。** 本 agent 无 zone 写权限、无 CLOUDFLARE_API_TOKEN，无法删除。代码侧修复（origin 层）已落地，但要完全生效需运维执行 `node scripts/remove-edge-cors.mjs`（或 `bash scripts/fix-edge-cors.sh` 人工兜底），详见 `docs/security/cloudflare-guards.md` §zone 级 CORS 残留。**不宣称已闭环。**

## 实现摘要

1. **白名单单源（消除两份漂移）**：新增 `cors.origins.json`（单一事实源）+ `scripts/generate-cors-origins.mjs`（零依赖生成器），产出 `src/generated/cors-origins.ts` 与 `worker/src/generated/cors-origins.ts` 字节一致模块。Worker `cors.ts` 与 Pages 代理 `api-proxy.ts` 各自 import 对应生成物。
   - **为何不是「Worker import 同一文件」**（票面字面）：根包与 worker 是独立 TS 包（根 tsconfig `exclude: ["worker"]`、worker `rootDir: src`），跨包 import 会破坏各自门禁边界。改用仓库既有 `settings.rules.json` 的双端生成模式，实质达成「grep 无第二份硬编码列表」。`tests/api-proxy-headers.test.ts` 机械守卫两端字节一致 + 描述符同步；CI 新增 `Check CORS Origins drift`（gen:cors → diff 为空）。
2. **代理不再无条件 `*`**：`buildProxyResponseHeaders` 先删上游/本地全部 CORS 头，再按请求 Origin 白名单精确回显 + `Vary: Origin`；非白名单/无 Origin 不写 ACAO。
3. **OPTIONS 预检补安全头**：`buildPreflightHeaders` = CORS 头 + `SECURITY_HEADERS`（5 头，与 `src/middleware.ts` / `_headers` 同口径）；502 错误响应同样补齐。
4. **代理 fetch 10s 超时**：`AbortController` + `finally clearTimeout`，超时映射 502（与网络失败同口径），与 `articleServer.ts` 8s 同量级。
5. **文档**：README 新增 CORS 白名单单源段，门禁清单补 gen:cors 漂移断言。

## Standards 轴

1. **[judgement] 双端生成 vs 字面 import**：如上，包边界决定不能字面 import 同一文件；沿用仓库既有生成物模式是合规的等价实现，且有 CI + 单测双重漂移守卫。**可接受**。
2. **[judgement] 502 响应头用 `buildPreflightHeaders`**：该函数含 CORS 方法/头/max-age（预检语义），用于 502 略宽泛；但安全头齐全、不写 ACAO（除非白名单 Origin），无安全问题。**可接受**。
3. **[hard] 边缘层通配头未删**：非代码缺陷，属运维前置未完成，已如实记录于关闭评论。**不记为代码 finding**。

**Standards 总结：0 hard（代码）/ 2 judgement（均可接受）；1 项运维前置未闭环已留痕。**

## Spec 轴（验收标准逐条）

| #   | 验收标准                                                  | 覆盖                                                                                     | 结论               |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------ |
| 1   | 非白名单 Origin 响应不含 ACAO: *                          | `api-proxy-headers.test.ts`：非白名单/仿冒域名/无 Origin 三例均 null                     | ✅                 |
| 2   | 白名单 Origin 回显 + Vary: Origin，与 Worker 一致，有单测 | 4 个白名单 Origin 逐一回显 + Vary；两端共用生成物                                        | ✅                 |
| 3   | 两端共用同一白名单常量，grep 无第二份硬编码               | 生成物字节一致守卫 + 描述符同步断言 + CI 漂移                                            | ✅                 |
| 4   | 代理 fetch 有超时，OPTIONS 带安全头                       | 10s AbortController + finally clear；OPTIONS 5 安全头 + CORS 断言                        | ✅                 |
| 5   | 关闭评论记录边缘层规则人工删除状态                        | 本报告顶部实测（仍在）+ 关闭评论如实标注                                                 | ✅（如实记录未删） |
| 6   | 三套门禁全绿                                              | 根包 42/501、worker 35/328、worker typecheck 0 errors、check 0 errors/0 warnings/8 hints | ✅                 |

**Spec 总结：6/6 验收标准满足（第 5 项为如实记录状态，实际删除待运维）。**

## 取舍与残余风险

- **边缘层通配 ACAO 仍在**：代码侧修复被 zone 边缘头覆盖，运维须执行清理脚本才能完全生效（见顶部）。
- **text-proxy 的 `ACAO: *`**（Worker `text_proxy.ts` 的 corsify）：票面 Out of scope（本票聚焦同源代理），未改动，README 494 行原有描述保留。
- **封面图外链改本站媒体库**（报告 003 图片侧）：票面 Out of scope，未触碰。

## 门禁结果（本地 HEAD `5776937`）

- `cd worker && npm test`：35 files / 328 tests PASS；`npm run typecheck` 0 errors
- 根包 `npm test`：42 files / 501 tests PASS
- `npm run check`：0 errors / 0 warnings / 8 hints（154 files）
- `node scripts/generate-cors-origins.mjs` 幂等：重跑后两端生成物 hash 不变
