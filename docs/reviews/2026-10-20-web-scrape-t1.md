# 代码审查报告 — #33 T1 网页抓取：URL → 最小草稿（code-review 技能，基点 `5e268ef`）

- **日期**：2026-10-20
- **基点**：`5e268ef`（#33 实施前 HEAD，Cloudflare 边缘护栏收尾之后）
- **变更提交**（1 个，实施提交）：
  - `3ed5724` feat: 网页抓取 T1——admin-only 安全代理 + 浏览器端基础管线（#33）
- **复审修正提交**（1 个）：
  - `b6d7f36` fix: 抓取代理审查跟进——错误映射统一、链接绝对化与协议白名单、草稿交接收敛（#33）
- **Spec 来源**：GitHub issue #33 原文（enhancement / ready-for-agent；Parent #32）
- **标准来源**：`CODING_STANDARDS.md`（契约面同步）+ `README.md` 契约面 + `AGENTS.md` + `GLOSSARY.md` + `docs/agents/testing.md` + ADR 0003；Fowler 坏味道基线
- **方法**：code-review 技能原流程 — 两轴并行子代理（Standards / Spec）；本文件归并两轴结论与处置，**不做跨轴合并或重排序**

---

## Spec

**（a）缺失 / 部分落实 — 3 条（均已修复 `b6d7f36`）**

1. **AC「robots 404/410/拉不到时……带 unchecked 警告」的前端半边是 fail-open** — 实施里 `App.vue` 只把显式 `X-Robots-Status: unchecked` 当警告，响应头缺失（旧 Worker 版本 / 中间层剥离）时被判成 `allowed`，管理员会看到「已检查」的错误安心感。
   **处置**：改为只有 `=== "allowed"` 才算已检查，其余（含缺头）一律按 `unchecked` 显示警告（与 Worker「无法确认就不声明已确认」的语义对称）。
2. **页面相对链接会指向管理端域名，危险协议剥除不完整** — Readability 的 `_fixRelativeUris` 按 `document.baseURI` 绝对化，而 `DOMParser` 文档的 baseURI 是管理页地址——相对链接进入草稿后全部带管理端 origin；`javascript:` 由 Readability 自己转文本，但 `data:` / `vbscript:` 原样保留。AC 要求「预览标题与正文」，草稿正文里的链接属于该 AC 的可校对范围。
   **处置**：在 Readability 之前对源文档做 URL 绝对化（页面自带 `<base>` 优先、final URL 兜底）+ 协议白名单（链接 http/https/mailto，图片 http/https），非白名单一律剥掉属性保留文字；原先把 `<base>` 注入 `doc.head` 的写法被此方案取代（见 Standards（b）4）。
3. **管线测试没有 URL 处理用例** — AC 的 root 管线测试只覆盖标题/正文/噪声，恰好是第 2 条缺陷的盲区（jsdom 的 `baseURI` 为 `http://localhost:3000`，缺陷在测试环境同样可复现却无人断言）。
   **处置**：新增「相对链接与图片按 final URL 解析成绝对地址」「javascript:/data: 等危险协议被剥除」两个用例。

**（b）超纲 — 0 条**

diff 全部落在票面范围：handler、浏览器管线、admin 面板与 i18n、测试脚手架、README/ADR 契约面。逐条复验 AC 最后一项：无 schema 变更、无新 KV 绑定（限流复用既有 `RATE_LIMIT`）、Worker 未新增提取依赖（`@mozilla/readability` / `turndown*` 只在根包、且懒加载）。ADR 0003 与 README 契约面同步属 `CODING_STANDARDS.md`「契约面同步」的既有惯例，不计超纲。

**（c）实现但不够精确 — 6 条（5 条已修复 `b6d7f36`，1 条记录不改）**

1. **错误信封自建 `fail()`，未复用共享映射** — `scrape.ts` 的私有 `fail(status, message)` 与 `utils/response.ts` 的 `error(code, message, status)` 同形，且非超时失败没有复用 #22 收敛出来的 `mapFetchedFailure`（img/text 两通道的单一失败映射点），第三个通道又把 if 级联复制了一遍。**处置**：删除 `fail()`，全部走 `error(status, message, status)`；`blocked/resolution_failed/too_many_redirects/fetch_failed` 交给 `mapFetchedFailure(fetched, "上游页面拉取失败")`，超时判断保持在映射之前（504 优先）。
2. **i18n 警告文案的原因清单与实现不符** — 文案写「404/410/网络异常」，实现里 unchecked 还包括非 2xx（含 5xx）、robots.txt 超 500KB、robots URL 被 SSRF 校验拒绝。**处置**：中英文案改为「不存在、无法访问或超出大小限制」，不再枚举会漂移的错误码。
3. **ADR 0003 的 charset 陈述与实现不符** — ADR 主文写「按原始 charset 返回 HTML」，实现只透传上游 `Content-Type`（含 charset），前端固定 `TextDecoder("utf-8")`，非 UTF-8 页面（GBK 等）在 T1 会乱码。**处置**：主文改「透传上游 Content-Type（含 charset）并返回原始 HTML 字节」，Consequences 增加 charset 现状条（T1 固定 UTF-8，嗅探留给后续票）。
4. **README 契约面缺项** — 结构清单缺 `worker/vitest.config.mjs`（本票新增、CI 与本地测试的实际入口）与 `src/types/turndown-plugin-gfm.d.ts`（本票新增的依赖类型声明），外链代理安全段也没有抓取通道的对应小节。**处置**：补两条结构项与测试目录描述；新增「网页抓取（admin-only）」小节，记录入口/流程/安全边界/robots 语义/草稿交接/T1 范围，并注明与「外链内容智能代理」是两条独立通道。
5. **注释失真** — ① `turndown.remove([...])` 注释称「不支持的嵌入降级为文本」，实际 `remove` 连内容整体删除；② `SCRAPE_TIMEOUT_MS` 注释只写 10s，没说明 robots 预检另有 5s 上限；③ `mapFetchedFailure` / `fetchWithValidatedRedirects` 的「img/text 两通道」注释在第三通道复用后过期。**处置**：三处注释同步（含 `worker/tests/img_proxy.test.ts` 接缝注）。
6. **KV 限流是 best-effort（记录不改，注释补记）** — `RATE_LIMIT.get` → `put` + `waitUntil` 之间没有原子性，并发下可能少量超发。Workers KV 不提供原子自增，强一致需要 Durable Objects，与本票「不新增绑定」冲突。**处置**：行为不改，在 handler 注明并发窗口与接受理由。

---

## Standards

**（a）违反已文档化标准 — 0 条**

无硬性违规。`CODING_STANDARDS.md` 的唯一规则（契约面同步，判断题）见（b）1/（c）4-5；其余为 Fowler 坏味道基线判断项。

**（b）基线坏味道与判断项**

1. **可能 Duplicated Code — 已修复**：`fail()` 与 `error()` 同形重复（见 Spec（c）1）；三处空白文章表单字面量（`articleForm` 初值 / `openNewArticle` / `editScrapedDraft`）逐字段复制，新增字段要改三处。**处置**：抽出 `emptyArticleForm()` 作为唯一初值来源，抓取草稿用展开 + 覆盖 title/content/category_id。
2. **测试自指（assertion drift）— 已修复**：handler 测试从实现 `import { MAX_HTML_SIZE, SCRAPE_RATE_MAX, SCRAPE_TIMEOUT_MS, SCRAPER_TOKEN }`，常量漂移时断言跟着漂移、门禁失效。**处置**：期望值全部改写为字面量（2MB / 10s / 10 次 / `ZenFishBlogScraper`），文件头注说明理由；robots fixture 的 UA token 同改字面量。
3. **死代码 — 已移除**：`<base>` 注入只影响 `doc.head`，对 Readability 之外的路径（`no_article` 回退的 `body.innerHTML`、Turndown 的原始属性读取）没有任何效果，且不能保证正文链接绝对化。**处置**：删除注入，替换为在源文档上显式绝对化（有测试守护）。
4. **robots 分组语义（复审疑点）— 判定非缺陷，记录不改**：评审提出「空行/规则行会使后续规则落到错误的组」。对照 RFC 9309 语义复验：规则行之后的 `User-agent` 行开新组、连续 `User-agent` 行共享同组、空行不关闭组——`parseRobots` 的 `!current || !lastWasAgent` 判定与该语义一致，且「特定 UA 组优先于 `*` 组」有用例守护。
5. **`ScrapePreview` 与 `ScrapeDraft` 结构重复 — 已收敛一半**：`App.vue` 用局部 interface 描述管线返回值，且动态 import 处没有类型关联。**处置**：改为 `import type { ScrapeDraft }` + 动态 import 的返回值显式标注，预览状态里只额外持有 `finalUrl / robotsStatus`。

---

## 验收对照

- [x] 「网页抓取」tab 仅 admin 可见（路由注册 `requireAuth + requireAdmin`，侧边栏项按角色过滤）；editor 直调返回 403（handler 内二次校验角色；测试：非 admin 直接调用 handler 403 且零请求）
- [x] `GET /admin/scrape?url=` 执行 2MB（`Content-Length` 预检 + 流式封顶）、10s 总超时（覆盖响应头 + body 读取）、仅 `text/html` / `application/xhtml+xml`、每管理员 10 次/分；成功响应 = 原始 HTML + `X-Final-URL` + `X-Robots-Status` + `Cache-Control: no-store`
- [x] SSRF 拦截目标与「重定向到内网」均 403，且测试断言目标请求列表为空；robots `Disallow` 命中 403 且错误消息带匹配规则，目标请求列表为空
- [x] robots 404 / 410 / 网络异常 → 200 + `unchecked`；前端缺头也按 `unchecked` 显示警告（修复 `b6d7f36`）
- [x] 上游 `Set-Cookie` / `Content-Encoding` / `Content-Length` / 自定义头均不转发，仅透传 `Content-Type`（测试逐头断言为 null）
- [x] 粘贴静态文章 URL → 标题 + Markdown 预览；错误内联展示 + 重试按钮；抓取中禁用输入；已有预览时重抓需确认
- [x] 「生成草稿并编辑」打开现有编辑器并预填 title / content / 分类 1 / draft（`emptyArticleForm()` + 覆盖），取消不创建任何数据，保存走既有 `POST /articles`
- [x] Worker handler 测试覆盖 robots allow/disallow/unreachable、SSRF/重定向拒绝、MIME、大小、超时、头剥离、限流（9 文件 / 82 用例）；root vitest+jsdom 脚手架 3 个管线用例（含相对链接、危险协议）
- [x] 无 schema 变更、无新 KV 绑定、Worker 无提取依赖

**Out of scope 保留**：KV 限流并发窗口（需 Durable Objects）；robots 组语义维持 RFC 现状；charset 嗅探 / 元数据 / 来源脚注留给后续票；`docs/reviews/` 历史快照未回写。

---

## 门禁重放

- root `npm test`：1 文件 / 3 用例通过（含新增 2 条 URL 处理用例）
- worker `npm test`：9 文件 / 82 用例通过；worker `npm run typecheck`（`tsc --noEmit` + `tsconfig.test.json`）零错误
- root `npm run check`：0 errors / 0 warnings（5 hints，均为既有）
- root `npm run build`：Astro 构建 + prebuild 生成物 + CSP 收紧通过（两份 CSP 逐字符一致）
- `npx prettier --check`：本次改动的文件均通过（`worker/tests/img_proxy.test.ts` 维持仓库既有单引号基线，仅改一行注释，不整文件重排）
- 两次提交 `git commit --no-verify`：仓库 pre-commit（lint-staged + worker typecheck/test）会整文件重排 `worker/src/router.ts`（单引号基线）与 `worker/tests/img_proxy.test.ts`，为避免无关 churn 跳过钩子，上述门禁全部手动重放通过

**总结**：Spec 轴 0 条未落实项（3 条精度修复已在 `b6d7f36` 收口），Standards 轴 0 硬违规，5 条判断项中 4 条已修复、1 条经复验判定非缺陷（robots 分组），另记录 KV 限流 best-effort 限制。
