# 代码审查报告：M3 限流重构（issue #91）

**日期**：2026-11-16
**固定点**：`c776d89`（改动前 HEAD）
**审查范围**：`git diff c776d89...HEAD`（提交 `70a57a8` 实现 + follow-up 修复）
**双轴**：Standards（仓库明文标准 + Fowler smell 基线）、Spec（issue #91 验收），并行子代理独立审查。

---

## Standards

**HARD（1 项，已修）**：

1. `README.md:190/362-367` 契约面失真——仍写「KV 固定窗口」「普通 GET 完全跳过限流」，与滑动窗口 + `GET /articles/:slug` 限流矛盾（违反 CODING_STANDARDS「契约面同步」头号规则）。→ follow-up 已改为滑动窗口 + 文章详情 120/分 + 残余风险。

**JUDGEMENT（6 项）**：

| #   | 位置                                      | finding                                                                            | 处置                                                                               |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | `rate_limit.ts` isArticleDetailGet        | 尾斜杠 `/articles/hello/` 在 normalize 前判断，绕过限流                            | **已修**：判断前先去尾斜杠，补同桶测试                                             |
| 2   | middleware identity=template              | 每 IP 跨所有 slug 共享 120/分，单 IP 重度阅读可能误伤                              | **接受**：H8「跨资源共享桶」同哲学，正是抑制遍历 slug 放大 D1 写；关票评论写明取舍 |
| 3   | `consumeRateLimit` await put              | 原 `waitUntil` 后台写改同步 await，高频路径增尾延迟；但 get/put 跨请求仍非原子     | **接受**：限流路径为写操作 / 低频代理，正确性优先；残余风险关票说明                |
| 4   | 测试 `rate_limit.test.ts`                 | seed 只写当前键、prev=0，滑动窗口退化为固定窗口，阈值断言仍有效但缺策略层×边界集成 | **接受**：边界算法由 `rate_limiter.test.ts` 专测，分层不重复                       |
| 5   | `docs/agents/testing.md:7`                | 单段超长追加可读性差                                                               | **接受**：与该文件既有风格一致（整段密集登记）                                     |
| 6   | `scrape.ts` ctx 参数移除 waitUntil 后未用 | tsconfig 未开 noUnusedParameters，不致编译失败                                     | **接受**：保持 handler 签名一致（router 统一传 ctx）                               |

**最严重（Standards）**：README 契约失真（已修）。

---

## Spec

**(a) 验收缺失**

- 「关闭评论如实说明数值 / 残余风险 / 后续移交」：需在 #91 关票评论完整写明（仓库代码注释指向关票评论，评审时点尚未发布）→ 关票评论已覆盖。
- 「npm run check 全绿」：审查子代理误以为 worker 包缺该脚本——验收指根包 `npm run check`（astro check）+ worker `npm run typecheck`，两者实测均绿。

**(b) scope creep**

- `GET /articles/<纯数字>` 并入详情 120/分桶：公开路由 `GET /articles/:slug` 本就接受数字段（router 单段匹配），非越界。

**(c) 实现有误**

- `retryAfterSec` 沿用固定窗口「距窗口末」，滑动窗口跨边界后上一窗口残余仍生效，「X 秒后可重试」承诺不成立（且写进 scrape 文案）→ **已修**：改为保守上界「当前剩余 + 一整个窗口」，注释与测试同步（边界场景 =120s）。

**核对通过**：旧 `Math.floor(Date.now()/RATE_WINDOW_MS)` 四处全清、无第二套算法；H8 分桶口径不变；img-proxy 429 / text-proxy corsify 429 / scrape 文案 / 全局 429 code 10007 响应格式保持；未引入 DO / Rate Limiting API。

**最严重（Spec）**：retryAfterSec 语义失真（已修）。

---

## 门禁（修复后）

- Worker：38 files / 363 tests PASS；`tsc --noEmit` + `tsconfig.test.json` 0 errors。
- 根包：43 files / 511 tests PASS；`npm run check` 0 errors / 0 warnings / 8 hints；README 契约测试 13 PASS。
- grep：四处调用点全部走 `consumeRateLimit`，唯一算法实现在 `utils/rate_limiter.ts`。

## 残余风险（关票评论同步）

- KV 无原子自增：`get→put` 并发窗口仍可能少量超发（await 只缩小未消除）。
- 跨 PoP 最终一致（约 60s）：计数低估，限流被放宽。
- 根治方案 Durable Objects / Cloudflare Rate Limiting API 不在本批，作为残余风险移交。
