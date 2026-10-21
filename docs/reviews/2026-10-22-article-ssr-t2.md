# 代码审查报告 — #38 T2 文章详情 SSR：服务端取数与正文首屏（code-review 技能，基点 `3e30c4f`）

- **日期**：2026-10-22
- **基点**：`3e30c4f`（#38 实施前 HEAD）
- **变更提交**（1 个，实施提交）：
  - `7759678` feat: 文章详情 SSR T2——服务端取数与正文首屏（#38）
- **复审修正提交**（1 个）：
  - `2b295ad` fix: 文章 SSR T2 审查跟进——DOM clobbering、取数超时与无 JS 首屏（#38）
- **Spec 来源**：GitHub issue #38 原文（enhancement / ready-for-agent；Parent #36）
- **标准来源**：`CODING_STANDARDS.md`（契约面同步）+ `README.md` 契约面 + `AGENTS.md` + `docs/agents/testing.md` + ADR 0004；Fowler 坏味道基线
- **方法**：code-review 技能原流程 — 两轴并行子代理（Standards / Spec）；本文件归并两轴结论与处置，**不做跨轴合并或重排序**

---

## Spec

### （a）缺失 / 部分落实

1. **AC「禁用 JS 时正文可读」只部分落实 — 已修复 `2b295ad`**
   Spec 原句：「禁用 JS 时正文可读」。SSR 的 `<h1>`、摘要、分类、日期、计数与标签仍带 `data-reveal`；`src/styles/motion.css:24` 设置 `[data-reveal]{opacity:0}`，只有 `initMotion()`（JS）会添加 `.is-revealed`。没有 `<noscript>` 兜底，JS 被禁用或动效 chunk 加载失败时，正文段落可读但标题 / 头部不可见。
   **处置**：在 `BaseLayout.astro` 的 `<head>` 增加 `<noscript><style is:inline>`，无 JS 时把 `[data-reveal]` 强制为可见、取消 transform。该兜底覆盖全站所有 SSR 首屏，不只文章页；构建产物已确认 `<noscript><style>` 保留，且 CSP 的 `style-src 'unsafe-inline'` 未收紧。

2. **AC「Worker API 不可达时返回 502」未覆盖上游挂起 — 已修复 `2b295ad`**
   Spec 原句：「Worker API 不可达时返回 502 与重试入口」。`loadArticleForPage` 只捕获 fetch rejection，没有超时；上游接受连接但不返回响应时，SSR 会一直等到平台超时，而不是渲染 502 页。
   **处置**：新增 8 秒 `AbortController` 超时，超时与网络失败一样返回 `error`（页面映射 502 + 重试）；新增 fake timer 用例断言挂起请求最终得到 `{ status: "error" }`。

### （b）超纲 / 行为漂移

1. **`rss.xml.ts` / `api/v1/[...path].ts` 改为共享 `WORKER_ORIGIN` — 经复验保留**
   两处只是把重复的 origin 常量提取到 `src/utils/workerOrigin.ts`，并因格式化产生引号 / 换行 churn；行为不变，属于「文章 SSR 直连 Worker」这一变更的必要收口，不构成功能超纲。

### （c）实现但不够精确

1. **T1 转入的 DOM clobbering 前置条件未落实 — 已修复 `2b295ad`**
   Spec 原句：「渲染与消毒：marked（GFM）+ 服务端 HTML 消毒器；与后台预览共享同一策略。」`markdownPolicy.ts` 原注释明确要求 T2 移除客户端兜底前复核：「保留一次 DOMPurify 复消毒，或为 id 增加 denylist」。本提交删除了客户端 DOMPurify 复消毒，却没有补策略，`id` 仍在白名单中，`id="body"` / `id="forms"` 等会遮蔽 `document` / form 属性。
   **处置**：在 `ARTICLE_BODY_SANITIZE_HTML_OPTIONS.transformTags` 中增加 `*` 变换：`id` 命中 `ARTICLE_BODY_FORBIDDEN_IDS`（document / Element / Node / EventTarget / form / Object.prototype 常用属性）或 `on*` 事件处理器名时整条丢弃，普通锚点 id 保留；新增 `id="body"` / `forms` / `cookie` / `createElement` / `onclick` 丢弃、`section-1` 保留的回归测试。该名单是保守 denylist，无法完全复刻 DOMPurify 的动态 `value in document`，但覆盖会直接影响本站脚本的高危名称，且已在注释中记录边界。

---

## Standards

### （a）违反已文档化标准 — 0 条

无硬性违规。`CODING_STANDARDS.md` 的唯一规则（契约面同步）为判断题，见（b）。

### （b）已文档化标准的判断项

1. **README 契约面仍称「所有前端请求都走同源代理」— 已修复 `2b295ad`**
   原文：「所有接口前缀 `/api/v1`，前端通过 Astro API 路由代理到 Worker。」实施后文章详情 SSR 与 RSS 都直连 Worker origin。README 的 API 总述、部署拓扑与自定义域名三处均已改写为「浏览器走代理；文章 SSR / RSS 服务端直连」。
2. **README 结构清单与测试说明漏掉新增模块 — 已修复 `2b295ad`**
   结构清单补入 `articleDate.ts` / `articleServer.ts` / `workerOrigin.ts`；根级测试说明补上文章 SSR 取数接缝，并注明该测试用 `@vitest-environment node` 覆盖默认 jsdom。

### （c）基线坏味道与判断项

1. **`ArticleCategory` / `ArticleTag` 字段与解析逻辑重复 — 未采纳**
   两个类型字段相同、`parseCategory` / `parseTag` 校验逻辑相同。保留语义区分（分类与标签是不同领域概念），且解析器各只有十余行；合并成 `TaxonomyTerm` 会让页面读模型的含义变模糊，收益不足。
2. **`mountVueComponents` 两段挂载结构重复 — 未采纳**
   点赞与评论两次挂载形状相似，但组件动态 import、props 与挂载目标不同；抽 helper 会把异步 import 和 `data-mounted` 守卫藏进泛型参数，反而降低可读性。
3. **locale 联合类型在多处重复声明 — 未采纳**
   `articleDate.ts` 的 `'zh' | 'en'` 与 `i18n.ts` 的非导出 `Locale` 重复。`articleDate` 是服务端与客户端共用模块，从 `i18n.ts`（含 JSON 与 localStorage 逻辑）导入类型虽可擦除，但会把 SSR 模块与浏览器模块在概念上绑定；当前两处联合类型极窄，重复成本低于新增共享层。
4. **`LoadArticleOptions.origin` 仅测试使用 — 经复验保留**
   它是 `loadArticleForPage` 的显式测试接缝，允许本地 mock 与不同 Worker origin 的集成测试；生产调用不传，行为由 `WORKER_ORIGIN` 单一事实源决定。
5. **文章页用 `encodeURIComponent` 而非 `safePathSegment` — 经复验保留**
   `escape.ts` 顶层 `import DOMPurify`，而文章页是 SSR 入口；为复用一行 `encodeURIComponent` 把浏览器消毒器拉进服务端模块不划算。两者对 slug 的编码结果一致。

---

## 运行时探针

- **502 路径**：开发服务器 + 本地 mock 已验证状态 502、响应体含「服务暂时不可用」、重试链接存在、无空白加载壳。
- **200 路径**：本环境到 `blog-api.zen-13467.workers.dev` 出站超时，服务端直连无法在本机完成真实 200 探针；页面级回归（view-source 含正文、禁用 JS 可读、404 状态）按 Parent #36 的分工留给 T5 Playwright。`renderMarkdownServer` + 页面 SSR 分支由构建、类型检查与单元测试覆盖。
- **无 JS 兜底**：构建产物 `dist/index.html` 已确认 `<noscript><style>` 与 `[data-reveal]` 规则保留；CSP 仍为 `style-src 'self' 'unsafe-inline'`。
- **DOM clobbering**：`renderMarkdownServer` 回归用例确认高危 id 被丢弃、普通 id 保留。

---

## 验收对照

- [x] 文章页在服务端取 `GET /articles/:slug`，正文经共享渲染器输出到 `set:html`；客户端不再请求文章详情、不再拼接正文 HTML。
- [x] 未知 / 未发布 slug 返回 404 并渲染未找到 UI；上游失败 / 超时返回 502 与重试入口。
- [x] 点赞、评论岛屿、代码块增强、媒体链接增强保留；脚本只做岛屿挂载与增强。
- [x] 服务端输出中文默认 `data-i18n` 文案，客户端初始化后刷新；日期按 `data-locale` 重排，避免 locale 初始化竞态。
- [x] 无 JS 时标题 / 摘要 / 正文可见（`<noscript>` 兜底）。
- [x] DOM clobbering 防护在移除客户端 DOMPurify 后由服务端 denylist 接管。
- [x] 类型检查、根级测试、worker 测试、构建全绿。
- [ ] view-source / 禁用 JS / 404 的浏览器级断言：按分工由 T5（#41）Playwright 覆盖，本票不做。

---

## 门禁重放

- root `npm test`：7 文件 / 59 用例通过（新增 T2 取数 10 例、DOM clobbering 1 例）。
- root `npm run check`：0 errors / 0 warnings（5 hints，均为既有）。
- root `npm run build`：Astro 构建 + prebuild 生成物 + CSP 收紧通过（静态与 SSR 两份 CSP 逐字符一致）。
- worker `npm run typecheck`：`tsc --noEmit` + `tsconfig.test.json` 零错误。
- worker `npm test`：9 文件 / 82 用例通过。
- `git commit`（`7759678`、`2b295ad`）：仓库 pre-commit（lint-staged + worker typecheck/test）均通过，未跳过钩子。

**总结**：Spec 轴 4 条发现——3 条修复（无 JS 首屏、取数超时、DOM clobbering）、1 条经复验保留（RSS / API origin 收口）；Standards 轴 0 硬违规，2 条文档判断项修复，5 条基线坏味道中 2 条保留、3 条经复验不采纳。两轴结论按轴分列，不跨轴合并。
