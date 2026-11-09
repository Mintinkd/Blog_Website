# #54 阅读统计 2/7：SSR 取数转发访客上下文 — 两轴复审

- 日期：2026-11-09
- 初始提交：`d6a7993`（`feat: #54 forward visitor context from SSR to worker`）
- 复审修复提交：`92bd543`（`fix: #54 review fixes (X-Purpose, trust-boundary test, docs)`）
- 固定点：`4d1754f`
- 复审命令：`git diff 4d1754f...d6a7993`
- 规格来源：issue #54；`docs/READER_ANALYTICS.md` §3 / §4.1 / §9 第 2 步 / §10 / §11；`docs/adr/0005-reader-analytics-aggregate-first.md`
- 说明：本次复审原计划由两个并行子代理执行，但子代理因免费额度限制不可用，改为同一会话内分轴审查；两轴仍独立成段，未合并排序。

## Standards

**Hard violations: none.** 契约面已同步：README SSR 段、`articleServer.ts` 的接口 / 函数 / 转发注释、`docs/READER_ANALYTICS.md` §10、ADR 0005 白名单、`docs/agents/testing.md` 前端测试说明。Prettier、Astro check、worker typecheck 均通过；浏览器回归通过。

### Documented-standard breaches (judgement)

1. **契约面同步** (`CODING_STANDARDS.md:7`) — `docs/agents/testing.md:11` 仍只写「访客 Cookie / cf-connecting-ip 转发」，未覆盖新增的白名单头、`CF-IPCountry` 映射与伪造头拒绝。已修 `92bd543`：更新为「访客 Cookie / 白名单头转发（含 `CF-IPCountry` 映射与伪造 `X-Real-IP` / `X-Visitor-Country` 拒绝）」。

### Baseline smells (judgement)

- **Shotgun Surgery** — 白名单在 SSR 常量、Worker `VisitorContext` / `readVisitorContext`、两处测试、README、spec / ADR 中分别维护；新增一个头要改 6+ 处。接受：Pages 与 Worker 是独立 bundle，共享运行时常量会把两侧构建耦合；当前白名单稳定，且测试逐项钉住。
- **Speculative Generality** — `readVisitorContext` 暂无生产调用方，是 #55 的预置接缝。接受：工单 Key interfaces 与 §9 第 2 步明确要求 Worker 侧还原；#55 直接消费，测试已锁定口径。
- **Duplicated Code** — `sec-ch-ua*` 通配遍历在 SSR 与 Worker 各一份。接受：跨 bundle 无法共享；两侧职责不同（转发 vs 解析）。
- **Primitive Obsession** — `ip` / `country` 仍是裸 string。接受：存储层与消费层都在 #55 / #56；branded type 不改变本票行为，收益低于跨模块类型成本。

## Spec

### (a) Missing / partial

1. **`X-Purpose` 未转发 / 未还原** — §4.1 规则 2 明确使用 `X-Purpose: preview`，但工单白名单只列了 `Sec-Purpose` / `Purpose`。若 SSR 不转发，规则 2 的 `X-Purpose` 分支在 SSR 链路上不可达。已修 `92bd543`：SSR 白名单、`VisitorContext.xPurpose`、两处测试、README、spec §4.1、ADR 0005 一并补齐。
2. **Worker 解析未接线** — `readVisitorContext` 有测试但无生产调用方；README 原句「Worker 侧由 readVisitorContext 还原」容易被读成已接线。已修 `92bd543`：README 改为「Worker 侧提供 `readVisitorContext` 按缺失还原」；接线留给 #55（计数逻辑，本票 out of scope）。
3. **伪造头拒绝缺测试** — 代码只认 `CF-Connecting-IP` / `CF-IPCountry`，但原测试只覆盖「CF 头存在时覆盖伪造值」，没有覆盖「CF 头缺失时丢弃伪造的 `X-Real-IP` / `X-Visitor-Country`」。已修 `92bd543`：新增回归测试，断言只剩白名单内的 `user-agent`。

### (b) Scope creep

- **`clientHints` 收集全部 `Sec-CH-UA*`** — 工单 Key interfaces 只点名 UA / Accept / 国家 / IP，但 §3 的维度表需要 `Sec-CH-UA-Mobile`（#55）与 `Sec-CH-UA` / platform（#56）。接受：这是转发契约的一部分，不是提前实现维度映射。
- **国家码归一（大写 + 两位字母 / 数字）** — 工单只说「国家」，spec 说「两位码」。接受：避免 `cn` / `CN` 落成两个桶；`T1` 等 CF 特殊值保留。
- **`docs/agents/testing.md` 与 spec / ADR 的文档改动** — 超出「README SSR 说明」的字面要求。接受：`CODING_STANDARDS.md` 的契约面同步要求关联文档随行为更新。

### (c) Looks implemented but questionable

1. **`readVisitorContext` 仍是死代码** — 与 Standards 的 Speculative Generality 同一事实。接受：本票明确先落转发 / 还原契约，#55 接线；若在 #55 前发现接口不合适，改动面仅一个 util + 测试。
2. **浏览器回归不校验转发头** — `verify-article-ssr.mjs` 的 mock 只校验页面输出与 Cookie，不检查 SSR 发出的头。接受：转发面已由 node 单测逐项钉住；浏览器回归的职责是首屏 / 无 JS / 404 / 502，按 `docs/agents/testing.md:68` 不重复测。
3. **白名单测试的期望列表与实现常量同形** — 测试用手写数组而非从实现导出，符合 `docs/agents/testing.md:88` 的独立来源要求；但新增头时两处都要改。接受：这正是「独立来源」的代价，且 `Array.from(keys()).sort()` 能抓住多转发 / 漏转发。

## 处置

| #   | 轴        | 发现                                                          | 处置                                                           |
| --- | --------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| S1  | Standards | `docs/agents/testing.md` 未覆盖新转发面                       | 已修 `92bd543`                                                 |
| S2  | Standards | 白名单多处维护（Shotgun Surgery）                             | 接受：Pages / Worker 独立 bundle，白名单稳定且测试逐项钉住     |
| S3  | Standards | `readVisitorContext` 暂无生产调用方（Speculative Generality） | 接受：工单 Key interfaces + §9 第 2 步要求，#55 消费           |
| S4  | Standards | `sec-ch-ua*` 遍历两侧重复（Duplicated Code）                  | 接受：跨 bundle 无法共享，职责不同                             |
| S5  | Standards | `ip` / `country` 裸 string（Primitive Obsession）             | 接受：branded type 不改变本票行为                              |
| P1  | Spec      | §4.1 的 `X-Purpose` 未转发 / 未还原                           | 已修 `92bd543`：SSR + Worker + 测试 + README / spec / ADR      |
| P2  | Spec      | Worker 解析未接线，README 措辞像已接线                        | 已修 `92bd543`：README 改为「提供 ... 按缺失还原」；接线留 #55 |
| P3  | Spec      | 伪造 `X-Real-IP` / `X-Visitor-Country` 缺拒绝测试             | 已修 `92bd543`：新增回归测试                                   |
| P4  | Spec      | `clientHints` / 国家归一超出工单字面                          | 接受：§3 维度与 #55 / #56 需要                                 |
| P5  | Spec      | 文档改动超出 README 字面要求                                  | 接受：契约面同步                                               |
| P6  | Spec      | 浏览器回归不校验转发头                                        | 接受：node 单测负责转发面，浏览器回归不重复测                  |

**Summary:** Standards — 0 hard violations, 1 documented-standard breach (testing.md stale) + 4 baseline smells (all judgement); Spec — 3 findings: 2 fixed (X-Purpose, forged-header test), 1 partial accepted (parser wiring in #55), plus 3 scope-creep / questionable notes accepted. All behavioural findings fixed in `92bd543`.

**Verification:** root `npm test` 106 passed; worker `npm test` 184 passed; worker `npm run typecheck` clean; root `npm run check` 0 errors; Prettier check clean; `wrangler deploy --dry-run` succeeded; article SSR Playwright regression passed.
