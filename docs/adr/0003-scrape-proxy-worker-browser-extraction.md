# 0003 · 网页抓取由 Worker 代理，提取与转换在管理端浏览器

2026-10-20。后台需要把任意网页转成本站 Markdown 草稿。抓取位置有三条路：浏览器端通过公开 `text-proxy` 拉取后解析、Worker 端直接 `fetch` 并解析、Cloudflare Browser Rendering。实测 Readability 管线在 22KB 页面约 11ms、86KB 约 48ms CPU，而 Free Workers 每请求只有 10ms CPU，Worker 端解析在目标套餐上不可行。决定：Worker 只做 admin-only 的 HTML 代理——复用 `img-proxy` 的 SSRF 护栏与重定向校验，检查 robots.txt，透传上游 `Content-Type`（含 charset）并返回原始 HTML 字节；提取（Readability）与转换（Turndown + GFM）在管理端浏览器执行，原始 HTML 留在浏览器内存，selector 重提取不重新请求源站。理由：浏览器没有 Worker 的 10ms CPU 预算，原生 `DOMParser` 省掉 linkedom，Worker 不新增运行时依赖，包体与冷启动更小。代价是抓取依赖管理员浏览器、无法服务端批量/定时抓取；后续要做批量或自动化时，再评估 Worker Paid + Readability 或 Browser Rendering。

## Considered Options

- **Worker 端解析**：实现集中、可服务端复用，但 Free 的 10ms CPU 预算扛不住 Readability，弃。
- **Cloudflare Browser Rendering**：能覆盖 JS 站点，但需要 Workers Paid/额外配置，v1 不做。
- **浏览器端直连目标站**：受 CORS 限制，弃；仍由 Worker 代理取 HTML。

## Consequences

- 抓取预览依赖管理员浏览器；关闭页面即丢失未生成草稿的预览（本来也不做历史）。
- 原始 HTML 不落 KV；Q10 的 10 分钟缓存取消，selector 重提取在本地完成。
- 前端新增 `@mozilla/readability`、`turndown`、`turndown-plugin-gfm`（懒加载，约 17KB gzip）；Worker 不新增提取依赖。
- 原始 HTML 只在 `DOMParser` 的惰性文档中解析，绝不注入管理页 DOM；预览仍走现有 `marked + DOMPurify`。
- HTML 上限降到 2MB（原代理通道为 10MB）：Free 的 10ms CPU 预算下，Worker 只做取回与透传，解析与转换在浏览器完成；2MB 对文章页足够，超限明确报错。
- charset：Worker 只透传上游 `Content-Type` 里的 charset，不做转码；前端按 BOM → Content-Type → `<meta charset>` 嗅探解码（GBK / GB2312 等），未知字符集回退 UTF-8 并警告（#34 补齐 T1 遗留项）。
