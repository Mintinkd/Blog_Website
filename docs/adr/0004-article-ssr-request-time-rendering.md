# 文章正文在请求时由 Astro SSR 渲染

文章详情页长期是 `prerender=false` 的空壳：浏览器取回 Markdown 后在客户端渲染，`articles.content_html` 从未被写入。我们决定在请求时由 Astro SSR 用 marked 渲染 `content`、经服务端消毒后直接输出 HTML，而不是在写入时把 HTML 预渲染进 D1，也不保留客户端渲染兜底。原因是个人博客流量低、编辑后即时生效更重要，且避免为存量文章回填 HTML、在 Worker 侧再维护一套渲染配置。代价是每次请求都要渲染一次，`content_html` 列继续留空（清理另案）。

**Status:** accepted

## Considered Options

- **写入时由 Worker 渲染并持久化**：否决。需要回填存量文章，并在 Worker 与前端各维护一套渲染配置，容易漂移。
- **只 SSR meta、正文仍客户端渲染**：否决。空壳、首屏与无 JS 可读性问题仍在。
