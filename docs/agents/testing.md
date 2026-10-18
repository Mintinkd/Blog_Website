# Worker 测试

`worker/` 的测试用 vitest：`cd worker && npm test`。CI 最早的门禁是设置白名单生成物漂移断言（`npm run gen:settings` 重新生成 → git diff 必须为空，issue #27），之后按 typecheck → 测试的顺序运行，任一失败即拦截部署。

## 约定

- 测试文件放 `worker/tests/`；`tsconfig.test.json` 使其参与 `npm run typecheck`。
- 网络边界用 `vi.stubGlobal('fetch', ...)` 打桩：按 URL 分流外部查询（如 DoH）与目标请求，并记录调用，用于断言「拒绝时不发起真实请求」。范例：`worker/tests/img_proxy.test.ts`。
- 优先测多入口共用的流水线（一处覆盖多消费方）；handler 级接缝（env/KV、HTTP 响应）在确认接缝时显式提出，由用户决定是否纳入。工单 Key interfaces 点名的接缝视为已确认。
