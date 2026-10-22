# 代码审查报告 — #39 T3 文章详情 SSR：每篇独立 SEO 元信息（code-review 技能，基点 `bfaaa4d`）

- **日期**：2026-10-22
- **基点**：`bfaaa4d`（#39 实施前 HEAD）
- **变更提交**（1 个，实施提交）：
  - `2d90e72` feat: 文章详情 SSR T3——每篇独立 SEO 元信息（#39）
- **复审修正提交**（1 个）：
  - `5dec0ab` fix: 文章 SSR T3 审查跟进——SSR 读取站点标题与测试独立期望（#39）
- **Spec 来源**：GitHub issue #39 原文（enhancement / ready-for-agent；Parent #36，含 Implementation / Testing Decisions）
- **标准来源**：`CODING_STANDARDS.md`（契约面同步）+ `README.md` 契约面 + `AGENTS.md` + `docs/agents/testing.md` + ADR 0004；Fowler 坏味道基线
- **方法**：code-review 技能原流程 — 两轴并行子代理（Standards / Spec）；本文件归并两轴结论与处置，**不做跨轴合并或重排序**

---

## Spec

### （a）缺失 / 部分落实

1. **title / og:title 的站点标题被硬编码为 `Blog` — 已修复 `5dec0ab`**
   Parent #36 原句：「title = 文章标题 + 站点标题」；#39 要求「每篇文章的 HTML head 有唯一 title 与 description」。初版 `articleMeta.ts` 固定 `DEFAULT_SITE_TITLE = "Blog"` 并声称「配置化站名由客户端补齐」，但 `BaseLayout.astro` 只在标题恰为「首页」时用 `/api/v1/config` 覆盖 `<title>`，文章页永远不会更新，抓取器拿到的也是 `… | Blog`。
   **处置**：新增 `src/utils/siteTitleServer.ts`，文章页与文章取数并行读取 Worker 公共 `/api/v1/config` 的 `site_title`（800ms 超时、失败 / 脏数据回退 `Blog`），再交给 meta 构造；新增 4 个 stub `fetch` 用例。`og:title` 复用同一 title，SSR 即正确。

### （b）超纲 / 行为漂移

1. **404 / 502 页面也有独立 title / description 与 `og:type=website` — 经复验保留**
   #39 只要求文章页 meta。初版顺手让错误页不再共用「文章详情」空描述。保留理由：这是页面级 head 构造的自然分支，不新增接口 / 脚本；meta 文案为中文静态串，与页面可见文案的客户端 i18n 分工不同，风险低。若后续要求错误页也多语言，另开票。
2. **README 表格重排与 emoji / 实体 / 非 http(s) 封面等边界测试 — 经复验保留**
   README 表格由 prettier 对齐产生 churn，内容变更本身必要；边界测试是纯函数分支的低成本防回归，不改变线上行为。

### （c）实现但不够精确

1. **非 http(s) 封面被省略，严格于「缺失时省略」— 经复验保留**
   #39 原句：「封面缺失时省略 og:image」。`data:` / `javascript:` 封面即使存在也不是合法分享图，输出会污染卡片或被平台丢弃；按 http(s) 白名单省略更符合「og:image 为绝对 URL」的意图，已有测试钉住。
2. **测试用实现常量构造期望，未覆盖配置化站名 — 已修复 `5dec0ab`**
   初版断言 `… | ${DEFAULT_SITE_TITLE}`，既违反测试独立期望约定，也让「站点标题分支未实现」通过测试。修正为字面量 `"Blog"`，新增 `siteTitle: "My Blog"` 覆盖用例与「不同文章 title / canonical 不同」用例。
3. **summary 与正文都为空时 description 仍为空 — 已修复 `5dec0ab`**
   #39 要求 description「不再是空」。正文校验只保证 non-empty，纯空白内容仍可能产出空摘录；修正为最终回退文章标题，并补用例。

---

## Standards

### （a）违反已文档化标准 — 1 条（已修复）

1. **测试期望从被测对象同一数据推回 — 已修复 `5dec0ab`**
   `docs/agents/testing.md:29`：「行为锁测试的期望值须有独立来源……不得从被测对象（生成物/实现）的同一数据直接推回」。初版 `tests/article-meta.test.ts` 从 `articleMeta` 导入 `DEFAULT_SITE_TITLE` 拼期望。
   **处置**：删除该导出，期望硬编码 `"Blog"`；配置化标题用例用独立的 `"My Blog"`。

### （b）已文档化标准的判断项

1. **README 契约面「site_title 应用于页面标题」与实现不符 — 已修复 `5dec0ab`**
   README 站点配置表原称 `site_title` 影响「页面标题」，但文章页 SSR 用默认站名、客户端也不覆盖。修正为「首页客户端 / 文章页 SSR」，并在结构清单补 `siteTitleServer.ts`。
2. **README 结构清单与测试说明缺新增模块 / 接缝 — 已修复 `5dec0ab`**
   `tests/` 行仍只写「抓取管线 + 文章 SSR 取数接缝」，`vitest.config.ts` 仍写「jsdom：抓取管线测试」。已补 SEO / 站点标题接缝与默认 jsdom、node 覆盖说明；`docs/agents/testing.md` 的前端测试段落同步更新。

### （c）基线坏味道与判断项

1. **Speculative Generality：`siteTitle` 选项无生产调用 — 已消除 `5dec0ab`**
   初版只有测试传 `siteTitle`。修复后文章页生产调用传入 SSR 读取结果，选项成为真实接缝。
2. **Duplicated Code：title 后缀三处重复、404/502 回退结构近似 — 已修复 `5dec0ab`**
   提取 `titled()` 统一后缀；错误页回退合并为一个 `[title, description]` 分支。
3. **Duplicated Code：404/502 的 meta 文案与页面可见文案各一份 — 经复验保留**
   页面文案走 `data-i18n`（客户端可切英文），meta 文案是 SSR 中文静态串；强行共用会把手写中文键与 i18n 生命周期绑在一起。两处文案短且变更频率低，接受重复。
4. **Divergent Change：`markdownServer.ts` 同时承担正文 HTML 与纯文本提取 — 经复验保留**
   两者都是「Markdown → 目标格式」的渲染职责，共用 `MARKDOWN_PARSE_OPTIONS`；纯文本模式的白名单只有「无标签」一条，放进 `markdownPolicy.ts`（正文白名单单源）反而混淆两种策略的边界。
5. **Mysterious Name：`buildArticleMeta` / `buildArticlePageMeta` — 经复验保留**
   前者输入是文章、后者输入是三态取数结果；命名分别对应「文章 meta」与「页面 meta」，配合 JSDoc 足够，改名收益低于 churn。

---

## 运行时探针

- **构建产物**：`npm run build` 通过；CSP 仍为「内联脚本 19 处 / 唯一 hash 3 个」，与实施前一致，未新增内联脚本、未放宽 CSP。
- **SSR bundle**：`BaseLayout` chunk 含 `ogType` 与 `article:published_time` 条件输出；文章页 chunk 含 meta 构造、中文 slug 编码、站点标题读取逻辑。
- **真实 200 路径**：本环境到 Worker API 出站受限，未做真实文章页浏览器探针；页面级「服务端 HTML 含正文 / 禁用 JS 可读 / 404」按 Parent #36 分工由 T5（#41）Playwright 覆盖。纯函数与取数接缝由单元测试锁住。

---

## 验收对照

- [x] 每篇文章 head 有独立 title（`文章标题 | 站点标题`）与 description（summary → 正文纯文本 160 字 → 标题）。
- [x] canonical 为 `Astro.site` 绝对 URL，slug 经 `encodeURIComponent` 编码（中文 / 空格用例）。
- [x] `og:type=article`、`article:published_time` 仅在文章页输出；`og:image` 绝对化，无封面或非 http(s) 时省略。
- [x] summary 为空时回退正文摘录，Markdown / HTML 已去除，按 Unicode 码点截 160 字。
- [x] meta 构造为纯函数，测试覆盖 summary / 摘录 / 空内容、封面相对 / 绝对 / 缺失 / 非 http(s)、中文 slug、发布时间缺失、配置化站名、错误页分支。
- [x] 构建产物未新增内联脚本，CSP 门禁未放宽。
- [x] 站点标题通过 SSR 读取公共 config，抓取器无需执行 JS。

---

## 门禁重放

- root `npm test`：9 文件 / 77 用例通过（新增 T3 meta 14 例、站点标题 4 例）。
- root `npm run check`：0 errors / 0 warnings（5 hints，均为既有）。
- root `npm run build`：Astro 构建 + prebuild 生成物 + CSP 收紧通过（静态与 SSR 两份 CSP 逐字符一致）。
- worker `npm run typecheck`：`tsc --noEmit` + `tsconfig.test.json` 零错误。
- worker `npm test`：9 文件 / 82 用例通过。
- `git commit`（`2d90e72`、`5dec0ab`）：仓库 pre-commit（lint-staged + worker typecheck/test）均通过，未跳过钩子。

**总结**：Spec 轴 6 条发现——3 条修复（SSR 站点标题、测试独立期望、空 description 兜底）、3 条经复验保留（错误页 meta、非 http(s) 封面省略、README / 边界测试 churn）；Standards 轴 1 条硬违规（测试期望来源）已修复，2 条文档判断项已修复，5 条基线坏味道中 2 条修复、3 条经复验保留。两轴结论按轴分列，不跨轴合并。
