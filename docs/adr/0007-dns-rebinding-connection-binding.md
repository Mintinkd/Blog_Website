# DNS rebinding 的处置边界：不做「连接级 IP 绑定」，改双解析器一致性校验

2026-11-17。SSRF 护栏（`worker/src/handlers/img_proxy.ts` 的 `fetchWithValidatedRedirects`，被 img / text / scrape 三通道共用）当前链路是：URL 校验 → DoH 解析 → 结果逐条比对受限网段 → `fetch`。**校验与建连是两次互相独立的 DNS 解析**，攻击者用短 TTL 双答案域名可以让校验拿到公网 IP、而 Workers 运行时自己那次解析拿到 `127.0.0.1` / `169.254.169.254`（#19 记为范围外，#88 只把判定复用窗口压到 1 秒）。#109 要求评估「把 fetch 的目标 socket 绑定到已校验 IP」的可行性。

## 结论

**Cloudflare Workers 上没有可用的连接级绑定原语**，本仓不做这条实现。依据（官方文档，2026-11 核对）：

1. **`cf.resolveOverride` 不能用于第三方目标**。它接受的是**主机名**而不是 IP（"specifies an alternate hostname which will be used when determining the origin IP address"），且 "will only take effect if **both** the URL host and the host specified by `resolveOverride` are within your zone. If either specifies a host from a different zone / domain, then the option will be **ignored** for security reasons."（`developers.cloudflare.com/workers/runtime-apis/request/`）。本站代理的目标是任意第三方 URL，两条前提都不成立——传进去会被静默忽略，看着"已绑定"其实仍是运行时自行解析，属于**伪修复**，所以不采用。
2. **`Host` 头不可跨 zone 改写**。"it is not possible to set the `Host` header to specify a host outside of your zone unless the request is actually being sent to that host"（同上）。因此「URL 用 IP + Host 用域名」这条通用反代套路在 Workers 上不成立。
3. **`cloudflare:sockets` 不能替代 HTTP(S) 建连**。`connect()` 只暴露 `secureTransport` / `allowHalfOpen`，**没有 SNI / 证书主机名覆盖参数**，连 IP 做 TLS 校验必然失败；而运行时对 80/443 的原始 TCP 连接按文档要求改用 `fetch`（"If you need to connect to addresses on port 80 or 443 to make HTTP requests, use `fetch`"）。
4. Durable Object 里也只能拿到同一套 `connect()` / `fetch`，不能突破上面三条。

真正能根治的形态是「自建 TCP 出站代理（自有 VPS 或 Workers VPC / Hyperdrive 类绑定），Worker 只连这个可信代理，由代理按已校验 IP 建连并做 SNI 与证书校验」。那需要新增常驻基础设施与凭证，超出本仓当前架构（纯 Serverless、零自建服务），本决定不等于否决它，而是记录「当前不做、且不要用 resolveOverride 假装做了」。

## 替代方案：双解析器一致性校验（已落地）

既然不能绑定连接，就把「DNS 是否稳定」本身变成拒绝条件：

- 主解析器（`cloudflare-dns.com`）查 A + AAAA → 受限段判定（原有逻辑，不变）；
- 第二解析器（`dns.google`）对同一主机再查一轮，**答案集合必须与首轮完全一致**（顺序无关）；不一致即判定 `reason: "rebinding"`，写 `[ssrf-blocked]` 结构化日志并在发起目标请求前返回 `blocked`；
- 第二解析器不可用（网络 / 超时）时**不降级放行**：退回主解析器再查一次，两次不一致同样按 rebinding 拒绝，一致才放行。

这条规则覆盖两类真实攻击形态：① 授权 DNS 对同一查询交替返回公网 / 内网（跨解析器答案不一致）；② 分裂解析（不同解析器看到不同视图）。它**不能**覆盖「两次查询都返回同一公网 IP、直到运行时那次解析才切到内网」的窗口——这正是平台限制留下的残余风险。

## Consequences

- **残余风险（明确记录，不再当"已修"）**：#88 的 1s TTL 缩窗 + 本决定的双解析器校验之后，TOCTOU 窗口仍在（`checkedAt` 到运行时解析之间的任意时刻可被 rebinding 利用）。评估口径：攻击者需同时具备「控制目标域名的授权 DNS」+「目标 URL 由管理员/访客触发代理」两个条件；被利用后的影响是 Worker 以自身身份请求内网/元数据地址。Workers 出网不落在用户 VPC 内、也无法访问 Cloudflare 自身元数据服务，实际暴露面小于传统容器环境，但不为零。
- **成本**：每次「解析判定」由 2 次 DoH 变 4 次（主/备各 A+AAAA），且是并发发出，p95 延迟基本不变；img / text 通道有 KV 24h 缓存，判定只在缓存未命中时发生。
- **可用性**：第二解析器故障不会造成拒绝服务（回退主解析器复检），但会失去跨解析器交叉验证能力，退化为「同解析器两次查询一致」。
- **测试**：`worker/tests/dns_stability.test.ts` 固定 7 个分支（一致 / 顺序无关 / 分裂解析 / 集合不等 / 备用不可用但稳定 / 备用不可用且抖动 / 主解析失败）；既有 20 条 SSRF 用例的 DoH 计数断言已按 4 次/轮更新。
- **后续路径**：若将来引入自建出站代理或 Workers VPC 绑定，改动点集中在 `resolveRound` 与 `fetchWithValidatedRedirects` 的建连处；届时本 ADR 需改为 superseded，不要就地改口径。

**Status:** accepted（2026-11-17；#109 以「平台不可行 + 双解析器校验 + 残余风险记录」收口）
