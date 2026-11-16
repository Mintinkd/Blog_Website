# DNS rebinding 的处置边界：不做「连接级 IP 绑定」，改双解析器一致性校验

2026-11-17。SSRF 护栏（`worker/src/handlers/img_proxy.ts` 的 `fetchWithValidatedRedirects`，被 img / text / scrape 三通道共用）当前链路是：URL 校验 → DoH 解析 → 结果逐条比对受限网段 → `fetch`。**校验与建连是两次互相独立的 DNS 解析**，攻击者用短 TTL 双答案域名可以让校验拿到公网 IP、而 Workers 运行时自己那次解析拿到 `127.0.0.1` / `169.254.169.254`（#19 记为范围外，#88 只把判定复用窗口压到 1 秒）。#109 要求评估「把 fetch 的目标 socket 绑定到已校验 IP」的可行性。

## 结论

**Cloudflare Workers 上没有可用的连接级绑定原语**，本仓不做这条实现。依据（官方文档，2026-11 核对）：

1. **`cf.resolveOverride` 不能用于第三方目标**。它接受的是**主机名**而不是 IP（"specifies an alternate hostname which will be used when determining the origin IP address"），且 "will only take effect if **both** the URL host and the host specified by `resolveOverride` are within your zone. If either specifies a host from a different zone / domain, then the option will be **ignored** for security reasons."（`developers.cloudflare.com/workers/runtime-apis/request/`）。本站代理的目标是任意第三方 URL，两条前提都不成立——传进去会被静默忽略，看着"已绑定"其实仍是运行时自行解析，属于**伪修复**，所以不采用。
2. **`Host` 头不可跨 zone 改写**。"it is not possible to set the `Host` header to specify a host outside of your zone unless the request is actually being sent to that host"（同上）。因此「URL 用 IP + Host 用域名」这条通用反代套路在 Workers 上不成立。
3. **`cloudflare:sockets` 不能替代 HTTP(S) 建连**。`connect()` 只暴露 `secureTransport` / `allowHalfOpen`，**没有 SNI / 证书主机名覆盖参数**——连 IP 时 TLS 校验证书必然对不上主机名，握手失败；官方对「需要访问 443 上的 HTTPS 服务」也明确指向 `fetch`（原文："If you need to connect to addresses on port 80 or 443 to make HTTP requests, use `fetch`"），`connect()` 的定位是原始 TCP 场景。退一步说，即使能用，也要自己实现 HTTP 解析 / 重定向 / 超时 —— 等于把整个代理逻辑重写一遍。
4. Durable Object 里也只能拿到同一套 `connect()` / `fetch`，不能突破上面三条。

真正能根治的形态是「自建 TCP 出站代理（自有 VPS 或 Workers VPC / Hyperdrive 类绑定），Worker 只连这个可信代理，由代理按已校验 IP 建连并做 SNI 与证书校验」。那需要新增常驻基础设施与凭证，超出本仓当前架构（纯 Serverless、零自建服务），本决定不等于否决它，而是记录「当前不做、且不要用 resolveOverride 假装做了」。

## 替代方案：双解析器一致性校验（已落地）

既然不能绑定连接，就把「DNS 是否稳定」本身变成拒绝条件：

- 主解析器（`cloudflare-dns.com`）查 A + AAAA → 受限段判定（原有逻辑，不变）；
- 第二解析器（`dns.google`）对同一主机再查一轮，**答案集合必须与首轮完全一致**（顺序无关）；不一致即判定 `reason: "rebinding"`，写 `[ssrf-blocked]` 结构化日志（含 `evidence.primaryIps` / `secondaryIps`）并在发起目标请求前返回 `blocked`；
- **两轮并发发出**（`Promise.all`）：串行时最坏 3 轮 × 3s = 9s，会撞代理 10s 预算（robots 预检另占 5s），并发后最坏 2 轮 = 6s；
- 备用解析器的失败要**分性质**处理（这是 review 抓出来的关键点，混在一起就等于留了降级口子）：
  - **NXDOMAIN（Status=3）**：解析器明确答复「这个名字不存在」，而主解析器有记录 → 分裂解析的强证据，**直接拒绝，不再复检**；
  - **SERVFAIL / REFUSED / 传输失败 / 非 2xx**：结论不可用，退回主解析器再查一次，两次不一致同样按 rebinding 拒绝，一致才放行（备用解析器长期只能两轮主查，交叉验证能力降级但不会误放行）。

这条规则覆盖两类真实攻击形态：① 授权 DNS 对同一查询交替返回公网 / 内网（跨解析器答案不一致）；② 分裂解析（不同解析器看到不同视图）。它**不能**覆盖「两次查询都返回同一公网 IP、直到运行时那次解析才切到内网」的窗口——这正是平台限制留下的残余风险。

## 生产验证方案（本票未执行，列为上线后验证项）

单元测试只能证明「拿到 A/B 两套答案时的分支行为」，证明不了线上的**真实 DoH 行为**（Cloudflare 与 Google 对同一域名的实际答复、配额、GeoDNS 差异）。上线后按下面三步在**生产**验证，任一步不符合预期就按「回滚策略」处理：

1. **正向（不得误拒常规图片）**：取 3 个常见图床域名（例如 `picsum.photos`、`i.imgur.com`、`raw.githubusercontent.com`），走 `/api/v1/img-proxy?url=...` 各拉一次，要求 200 且 `content-type: image/*`。若有域名被 403 + `[ssrf-blocked] reason=rebinding`，先确认是否 GeoDNS（见误拒风险），再决定是否需要白名单。
2. **负向（分裂解析必须被拒）**：用自控域名配一个「双 A 记录、一条公网一条 `127.0.0.1`」的授权 DNS（TTL 设 0），把 URL 交给 img-proxy，要求 403 + `reason=doh`（首轮即命中受限段）；再把两条记录改成「首次公网、之后内网」模拟 rebinding，要求 403 + `reason=rebinding` + `evidence.secondaryIps` 与 `primaryIps` 不同。
3. **日志抽查**：Cloudflare 日志里 `[ssrf-blocked]` 的 `evidence` 字段能被检索到（`evidence.secondaryUnavailable` 区分「分裂解析」与「备用解析器挂了」），并确认没有把目标 URL / 原始客户端 IP 写进日志。

## 回滚策略

本改动**没有数据库迁移、没有配置项**，回滚就是回滚代码：把 `worker/src/handlers/img_proxy.ts` 里的 `resolveRound` 调用与 `roundFailure` 分支还原到 #109 之前的单解析器版本（即删掉 second-opinion 那段，保留首轮受限段判定），`cd worker && npx wrangler deploy` 即可。回滚后 `worker/tests/dns_stability.test.ts` 会整体失败——这是有意的：它是本决定的守卫，回滚必须连测试一起撤，不允许「代码回滚、测试留着但改成通过」。若只是备用解析器长期不可用（`evidence.secondaryUnavailable` 持续为 true），不需要回滚：系统已自动降级为「主解析器两轮一致」，先修可用性再观察。

## Consequences

- **残余风险（明确记录，不再当"已修"）**：#88 的 1s TTL 缩窗 + 本决定的双解析器校验之后，TOCTOU 窗口仍在（`checkedAt` 到运行时解析之间的任意时刻可被 rebinding 利用）。评估口径：攻击者需同时具备「控制目标域名的授权 DNS」+「目标 URL 由管理员/访客触发代理」两个条件；被利用后的影响是 Worker 以自身身份请求内网/元数据地址。Workers 出网不落在用户 VPC 内、也无法访问 Cloudflare 自身元数据服务，实际暴露面小于传统容器环境，但不为零。
- **成本**：每次「解析判定」由 2 次 DoH 变 4 次（主/备 × A+AAAA），同一轮内 4 个请求并发；最坏延时从串行的 3 轮 × 3s（9s，超出代理 10s 预算）降到并发 2 轮（6s）。代价是「主解析器已命中受限段」这条冷路径也会多打 2 次备用查询。img / text 通道有 KV 24h 缓存，判定只在缓存未命中时发生。
- **可用性**：第二解析器故障不会造成拒绝服务（回退主解析器复检），但会失去跨解析器交叉验证能力，退化为「同解析器两次查询一致」。
- **误拒风险（新增，已知代价）**：严格集合相等对 **GeoDNS / 分地域解析** 的站点不友好——同一域名从 Cloudflare 与 Google 的出口解析到不同 CDN 节点时会被判 `rebinding` 而拒绝。这是刻意选择「宁可少显示一张图，也不放行一次内网请求」；表现是该图片走 `img-proxy-fallback` 占位符。若后续希望放宽，可改为「两集合交集非空且交集内无受限 IP」，但那样就放弃了「一套答案全是公网、另一套含内网」这一最重要场景的检出，故本 ADR 不采用。
- **测试**：`worker/tests/dns_stability.test.ts` 固定 9 个分支（一致 / 顺序无关 / 分裂解析 / 集合不等 / 备用不可用但稳定 / 备用不可用且抖动 / 主解析失败 / 备用 NXDOMAIN 直接拒绝且不复检 / 备用 SERVFAIL 回退复检）；`worker/tests/img_proxy.test.ts` 的 DoH 计数断言已按「每跳 4 次」更新。
- **后续路径**：若将来引入自建出站代理或 Workers VPC 绑定，改动点集中在 `resolveRound` 与 `fetchWithValidatedRedirects` 的建连处；届时本 ADR 需改为 superseded，不要就地改口径。

**Status:** accepted（2026-11-17；#109 以「平台不可行 + 双解析器校验 + 残余风险记录」收口）

> 起草说明：本文由实现代理（AI）在 #109 实施过程中起草，平台限制部分的结论基于 2026-11 的官方文档核对（`developers.cloudflare.com/workers/runtime-apis/request/`、`runtime-apis/connect/`），**未在真实 zone 上以 `resolveOverride` 做过正向验证**（需同 zone 双主机名，仓库无此条件）。若要推翻第 1 条，最小验证路径是：自建同 zone 的两个子域，对其中一个设 `resolveOverride` 指向另一个，看 Worker 侧实际连到哪个 IP。该验证未执行，故第 1 条的强度是「文档结论」而非「实测结论」。
