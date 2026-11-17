# 2026-11-17 push 审查待办 9–11：访客 IP / 代理 Vary / 502 头

**日期**：2026-11-17
**固定点**：`b58243a`（事故记录后的 main）
**来源**：`docs/reviews/2026-11-17-push-review.md` §三「待办（不阻断 push，建议开票）」第 9–11 条
**范围**：三条**代码口径**缺陷（其余 12 条待办见文末「去向」）

---

## 一、改动

| #   | 位置                                  | 问题（原状）                                                                                            | 后果                                                                                                              | 处置                                                                                                                                                                                  |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | `worker/src/utils/visitor_context.ts` | `ip` 直读 `x-real-ip`，不经验签；与「只有 `client_ip.ts` 读 `X-Real-IP`」的单点主张相悖（#84 验收条款） | 直连 Worker 者可伪造 `X-Real-IP`，把任意请求伪装成 SSR 链路：阅读统计写 `pv`/`uv`/维度桶、`bot_filtered` 口径失真 | `readVisitorContext(request, secret)` 改 async，`ip` 走新增的 `resolveSignedProxyIp`（只认签名通过，**不做**边缘 / XFF 回退）；`recordArticleView` 传 `env.VISITOR_IP_SIGNING_SECRET` |
| 10  | `src/utils/api-proxy.ts`              | `buildProxyResponseHeaders` 中整条 `headers.delete("vary")`                                             | 连带丢掉上游 `Vary: Accept-Encoding` 等缓存键，共用缓存可能把 gzip / br 变体发给不支持的客户端                    | 新增 `mergeVary`：只摘掉 `Origin`（由本地重建），其余 token 原样合并；`Vary: *` 整体保留（RFC 7234 §4.1）                                                                             |
| 11  | `src/pages/api/v1/[...path].ts`       | 非 OPTIONS 的 502 兜底复用 `buildPreflightHeaders`                                                      | 套上预检专用 `Access-Control-Allow-Methods/-Headers/Max-Age`，却漏掉 `Content-Type: application/json`             | 新增 `buildProxyErrorHeaders(origin)`：白名单 CORS + 安全头 + `application/json; charset=utf-8`                                                                                       |

**顺带闭合**（push-review 待办 4 的一半）：`tests/api-proxy-guard.test.ts` 原先用源码正则断言「10s 超时 + 502 兜底」，改为真实行为——`fetch` 拒绝 → 502 JSON、上游挂起 → `advanceTimersByTime(10_000)` 后 abort → 502。剩余「路径逃逸只断言 WHATWG URL 归一化」保留（平台层防线，非 handler 职责）。

## 二、行为断言（新增 / 改写）

| 文件                                   | 用例                                                                                                                   | 钉住什么                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `worker/tests/client_ip.test.ts`       | 「`resolveSignedProxyIp`（SSR 链路判定专用）」3 条                                                                     | 签名通过 → IP；直连（只有 `CF-Connecting-IP`）→ null 不回退；伪造 / 未签名 / 缺 secret → null           |
| `worker/tests/visitor_context.test.ts` | 「未签名 / 签名错误的 `X-Real-IP` 一律不采信，也不回退 `CF-Connecting-IP`」；「secret 未配置时签名通过也 fail-closed」 | 修复点本身；`readVisitorContext` 全文件改 async + 签名头                                                |
| `worker/tests/article_view.test.ts`    | 「伪造 `X-Real-IP`（无签名）按直连处理：不得计入 pv / uv」                                                             | 端到端后果：只累加 `requests`，不写令牌 / 维度桶 / `view_count`                                         |
| `tests/api-proxy-headers.test.ts`      | 「上游 Vary 合并」4 条 + 「代理 502 错误响应头」2 条                                                                   | `Accept-Encoding, Origin` 合并 / 不重复 / `*` 保留 / 无 Vary 仍写 Origin；502 的 JSON 类型与白名单 ACAO |
| `tests/api-proxy-guard.test.ts`        | 「上游 fetch 拒绝 → 502 JSON」「上游挂起 → 10s abort → 502」                                                           | 真实时序与响应体，替代源码文本断言                                                                      |

## 三、契约面同步

- `README.md`：SSR 计数段（验签口径与单点位置）、代理段（`Vary` 合并 + 502 头）、访客上下文段、secret 缺失时的统计降级口径。
- `docs/READER_ANALYTICS.md`：四处计数谓词由「带 `X-Real-IP`」改为「带**验签通过**的 `X-Real-IP`」。
- `docs/agents/testing.md`：新增「2026-11-17 审查待办 9–11」块（改前先看这里）。
- `docs/adr/0005-reader-analytics-aggregate-first.md` **不改**：ADR 是当时决策记录，现行口径以 README / READER_ANALYTICS / 代码注释为准。

## 四、门禁实测

| 项                                                    | 结果                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 根包 `npm run lint`（`--max-warnings=0`）             | 0 problem                                                                               |
| worker `npm run lint`（同一配置）                     | 0 problem                                                                               |
| 根包 `npx vitest run`                                 | **56 files / 625 tests passed**                                                         |
| worker `npm run typecheck`（含 `tsconfig.test.json`） | 0 error                                                                                 |
| worker `npx vitest run`                               | **471 passed / 1 failed**——失败项 `tests/d1_migrations.test.ts`「no such module: fts5」 |
| 根包 `npm run check`                                  | **185 files，0 errors / 0 warnings / 1 hint**                                           |

**本机环境说明（不是本次回归）**：Node `v22.9.0` 的 `node:sqlite` 仍需 `--experimental-sqlite`，且该版本内置 SQLite **未编入 FTS5**，`schema.sql` 里的 FTS 建表必然报 `no such module: fts5`；不加 flag 时整份文件在 import 阶段即失败（`No such built-in module: node:sqlite`）。CI 用 Node 22 的较新补丁版（`.github/workflows/deploy.yml` 固定 `node-version: "22"`），此前该文件在 CI 为绿。本地复跑方式：`$env:NODE_OPTIONS='--experimental-sqlite'`，FTS5 项仍需在 CI 或更新 Node 上验证。

## 五、去向（push-review 其余待办）

- **票 A「测试假绿修复」**：待办 1、2、3、5、6、7、8（4 已在本轮部分闭合）。
- **票 B「代码口径修复」**：待办 12、13、14、15（9–11 已在本轮修复）。
- 部署通道与 zone 规则属人工 Dashboard 项，见 `README.md`「部署通道人工核查清单」，不在票 A/B。
