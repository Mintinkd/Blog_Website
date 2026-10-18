# Worker 测试

`worker/` 的测试用 vitest：`cd worker && npm test`。CI 在 typecheck 之后运行同一命令，失败即拦截部署。

## 约定

- 测试文件放 `worker/tests/`；`tsconfig.test.json` 使其参与 `npm run typecheck`。
- 网络边界用 `vi.stubGlobal('fetch', ...)` 打桩：按 URL 分流外部查询（如 DoH）与目标请求，并记录调用，用于断言「拒绝时不发起真实请求」。范例：`worker/tests/img_proxy.test.ts`。
- 优先测多入口共用的流水线（一处覆盖多消费方）；handler 级接缝（env/KV、HTTP 响应）在确认接缝时显式提出，由用户决定是否纳入。
