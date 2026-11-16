# Code Review: #109 H10-R DNS rebinding 的「连接级绑定」评估与双解析器一致性校验

- **Fixed point:** `3c29529`
- **Commit under review:** `f19aff7 fix(worker): 双解析器一致性校验拒绝 rebinding + ADR 0007 记录连接级绑定平台不可行 (#109)`
- **Review fixes (follow-up):** `3f1ff34`
- **Spec:** GitHub issue #109（H10-R，Deferred from #88；Part of #71）
- **Decision record:** `docs/adr/0007-dns-rebinding-connection-binding.md`
- **Review date:** 2026-11-17

## 结论先行

用户的裁决是「尝试真实现连接级绑定」。该尝试的结论是**平台不提供这个原语**，因此本票落在「如实记录为什么不行 + 落地当前平台能拿到的最强检测 + 明确残余风险」三件事上。审查后（`3f1ff34`）又补了一处**真实的实现缺陷**：主备解析器原来是串行查询，最坏 3 轮 × 3s = 9s 会撞代理 10s 预算；且备用解析器的 NXDOMAIN 被当成「暂时不可用」，使双解析器可被指纹降级成单解析器。

## 平台限制的四条依据（ADR 0007 摘要）

1. `cf.resolveOverride` 只收**主机名**且要求 URL 主机与目标主机**同 zone**，跨 zone 直接被忽略（静默无效 = 伪修复）。
2. `Host` 头不能跨 zone 改写，「URL 用 IP + Host 用域名」这条通用反套路在 Workers 上不成立。
3. `cloudflare:sockets` 的 `connect()` **没有 SNI / 证书主机名覆盖参数**，连 IP 做 TLS 必然失败；官方对 443 的 HTTPS 明确指向 `fetch`。
4. Durable Object 里是同一套 `connect()` / `fetch`，突破不了上面三条。

> 强度声明：以上是**文档结论**，未在真实 zone 上做 `resolveOverride` 正向验证（需同 zone 双主机名，仓库没有条件）。ADR 的「起草说明」已写明这一点与最小验证路径。

## 实现的最终形态

```
URL 校验 → [主解析器 A/AAAA ‖ 备用解析器 A/AAAA]（并发） → 受限段判定
        → 备用结论分类：ok → 集合比较；deny → 直接拒；error → 主解析器复检一轮
```

三态区分是本票的安全要点：

| 备用解析器结论                       | 处理                                     | 理由                                                                                                            |
| ------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `ok`（集合一致）                     | 放行                                     | —                                                                                                               |
| `ok`（集合不一致）                   | `blocked` / `rebinding`                  | 分裂解析                                                                                                        |
| `deny`（Status=3 NXDOMAIN）          | **直接** `blocked` / `rebinding`，不复检 | 主解析器说有记录、备用说这名字不存在 → 分裂解析的强证据；若走降级路径，攻击者只要让备用回 NXDOMAIN 就能绕过复核 |
| `error`（SERVFAIL/REFUSED/传输失败） | 主解析器再查一轮，不一致才拒             | 结论不可用 ≠ 答案不一致，不能因此误拒服务                                                                       |

`blocked` 日志现在带 `evidence.primaryIps` / `secondaryIps` / `secondaryUnavailable`——只写「因为 rebinding」等于没有可复现信息。

## 审查 findings 与处置

| 轴        | finding                                                             | 处置                                                                                           |
| --------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Standards | 主备串行，最坏 9s 超 10s 预算（robots 预检另占 5s）                 | 并发；`img_proxy.test.ts` 计数断言 6 → 8 并写明代价（主解析器已判拒绝的冷路径多 2 次查询）     |
| Standards | NXDOMAIN 与传输失败混为一类 → 可被指纹降级                          | 三态 `DohAnswer` + `roundFailure()`；新增 2 条测试                                             |
| Standards | rebinding 日志缺证据（只有 `blocked_ips`）                          | 加 `evidence` 三字段                                                                           |
| Standards | ADR 的 80/443 引用脱离上下文，结论强度被夸大                        | 改写引用 + 加起草说明                                                                          |
| Standards | ADR 声称「并发发出、p95 基本不变」与实际串行不符                    | 改为真实数字（并发 2 轮 6s vs 串行 9s）                                                        |
| Standards | ADR 未评估 GeoDNS / 分地域解析的误拒风险                            | 补「误拒风险」：严格集合相等会误拒 GeoDNS 站点，表现是图片走占位符；并说明为何不放宽成交集非空 |
| Spec      | ADR 缺「生产验证方案」（单测只证明分支行为，证明不了真实 DoH 行为） | 补三步生产验证（常规图床不得误拒 / 自控双 A 域名验证分裂解析被拒 / 日志抽查 evidence）         |
| Spec      | ADR 缺「回滚策略」                                                  | 补：无迁移无配置，回滚即回滚代码；并声明「回滚必须连测试一起撤，不许代码回滚、测试改成通过」   |
| Spec      | 测试分支数写「7 个」，实际已 9 个                                   | 更正并逐条列名                                                                                 |
| Spec      | 「SSR 输出一致」类验收措辞（相邻票）与本票无关，仅记录              | —                                                                                              |

**0 条 hard 遗留**；上述全部已进 `3f1ff34`。

## 门禁证据

- worker `npx vitest run`：**50 files / 462 tests passed**（`dns_stability.test.ts` 9 条、`img_proxy.test.ts` 23 条）
- worker `npm run typecheck`（含 `tsconfig.test.json`）：0 error
- 根包 `npm run lint` / worker `npm run lint`：0 problem

## 残余风险（不宣称已修）

1. **TOCTOU 窗口仍在**：`checkedAt` 到运行时解析之间，攻击者仍可切 DNS。双解析器只保证「校验时两个视角一致」。
2. 攻击前提是「控制目标域名授权 DNS」+「目标 URL 触发代理」；Workers 出网不在用户 VPC 内、访问不到 Cloudflare 自身元数据，暴露面小于传统容器，但不为零。
3. **误拒代价**：GeoDNS 站点会被判 rebinding 而走图片占位符。这是刻意取舍（宁可少显示一张图，不放行一次内网请求）。
4. 平台侧根治路径（自建出站代理 / Workers VPC）需新增常驻基础设施，超出本仓「纯 Serverless、零自建服务」的架构，ADR 记录为后续路径而非否决。
