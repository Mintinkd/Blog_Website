# 站点配置保存失败与本地 API 代理解码失败 — 代码复审

- 复审范围：`git diff HEAD`（HEAD `94ec1b3`，工作区未提交）
- 规格来源：本轮缺陷报告与用户确认的修复要求
- 复审方式：Standards / Spec 两轴分开评估；子代理因额度限制未启动，由主会话按同一提示词执行

## Standards

结论：无硬性违规。

- `CODING_STANDARDS.md`「契约面同步」：`README.md` 的 `PUT /config` 行已同步为“值必须为字符串；整批校验通过后才写入”；`worker/src/handlers/config.ts`、`src/utils/api-proxy.ts` 的相邻注释均描述新行为。
- `docs/agents/testing.md`：配置回归测试放 `worker/tests/`（handler 接缝）；代理测试放根 `tests/`（纯函数接缝）；整页行为只由浏览器 E2E 验证，符合“同一行为不两边重复测”。
- 基线 smell：无可执行发现。`buildProxyResponseHeaders(headers, dev)` 的布尔参数属于可接受的旗标参数（两个分支都由测试钉住），不构成 Speculative Generality。

## Spec

结论：无缺失。

- 站点配置保存：UI 通过 `toConfigPayload` 统一序列化为字符串；Worker 先全量校验再写入；`worker/tests/t9-mini-fixes.test.ts` 新增“任一键非法 ⇒ 零写入”。
- 本地代理：`buildProxyResponseHeaders` 在 dev 下剥离 `content-encoding` / `content-length`，生产保留；`tests/api-proxy-headers.test.ts` 同时锁两个分支。
- 无范围蔓延；未放宽 Worker 的字符串契约；未新增运行时依赖。
- 复审中发现并已补的缺口：UI 的 number → string 转换最初只有临时 E2E 覆盖，已提取 `src/utils/config-payload.ts` 并新增 `tests/config-payload.test.ts`。

## 验证

- Worker：typecheck 通过，169 tests / 16 files
- 前端：`npm run check` 0 error / 0 warning，103 tests / 14 files
- `npm run build` 通过
- 整页 E2E（临时脚本，非仓库）：44/44；站点配置保存 200 + 落库 + 前台生效；`astro dev` 下 `/api/v1/*` 恢复 200
- 临时 `WORKER_ORIGIN` 覆盖已还原，`dist` 以生产 origin 重建

## 处置

无未处置发现。
