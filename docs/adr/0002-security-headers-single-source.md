# 0002 · CSP 基线：安全头模块单源，`_headers` 为纯生成物

2026-10-18（issue #28）。CSP 曾以三份人工拷贝维护：`public/_headers`（生产静态头）、`src/middleware.ts`（开发态基线，`'unsafe-inline'` 不进生产）、`scripts/patch-csp.mjs`（`UNSAFE_SRC` 目标串 + 替换逻辑），任一漂移分别导致生产头失真、dev/生产分叉、替换失配。决定：新增手写安全头模块（`.mjs`——patch 脚本、astro config、middleware 均可直接 import，dev 零生成步骤；类型由同目录声明文件提供），以声明式常量持有全部 5 个响应头（CSP 基线值含 `'unsafe-inline'` 不变）；middleware 直接 import 该模块；`patch-csp` 从「目标串精确匹配替换」升级为「以模块为源构造收紧后的 CSP」（hash 仍在构建期从 dist 内联脚本实时计算）；`public/_headers` 变为 prebuild 阶段由同一模块整文件渲染的纯生成物，提交进库并受 CI「重新生成 diff 必须为空」漂移断言约束。改的是构建管线与产物结构，返工成本高，故立档。

## Considered Options

- **三份互检断言加严**（#28 候选 c）：只加校验不消拷贝，三个手工编辑点原样保留，弃。
- **生成中间 TS 模块供 middleware 引用**（#28 候选 a/b 的共同形态）：dev 引用生成物比直接 import 手写模块多一跳生成、收益为零，弃。

## Consequences

- dev（`astro dev`）行为零变化；生产产物不含 `'unsafe-inline'` 的既有保证（#9/#10）与指令内容不动。
- `_headers` 中 CSP 之外 4 头与 middleware 的手抄重复一并消除。
- 收紧后双断言保留：产物无残留基线 token；静态/SSR 已收紧 CSP 逐字符一致。
