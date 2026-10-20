# 代码审查报告 — #34 T2 网页抓取：提取与转换质量（code-review 技能，基点 `0a58cbe`）

- **日期**：2026-10-20
- **基点**：`0a58cbe`（#34 实施前 HEAD，#33 审查报告入库之后）
- **变更提交**（1 个，实施提交）：
  - `b0f93c1` feat: 网页抓取 T2——提取与转换质量（selector/GFM/字符集）（#34）
- **复审修正提交**（1 个）：
  - `f9cfad9` fix: 抓取 T2 审查跟进——懒加载图片、selector 表格上下文与预览空态（#34）
- **Spec 来源**：GitHub issue #34 原文（enhancement / ready-for-agent；Parent #32）
- **标准来源**：`CODING_STANDARDS.md`（契约面同步）+ `README.md` 契约面 + `AGENTS.md` + `GLOSSARY.md` + `docs/agents/testing.md` + ADR 0003；Fowler 坏味道基线
- **方法**：code-review 技能原流程 — 两轴并行子代理（Standards / Spec）；本文件归并两轴结论与处置，**不做跨轴合并或重排序**

---

## Spec

**（a）缺失 / 部分落实 — 2 条（均已修复 `f9cfad9`）**

1. **AC「Markdown 保留……图片」「相对链接/图片正确解析」的懒加载半边未落实** — `data-src` 图片的 `src` 是 `data:` 占位图时，`resolveDocumentUrls` 先剥掉 `src`；Readability 的 `_fixLazyImages` 之后才把相对 `data-src` 抄进 `src`，再由 `_fixRelativeUris` 按 `DOMParser` 文档的管理页 baseURI 绝对化。结果是草稿图片指向管理端域名，而 `collectImageStats` 仍把它算作已解析。`srcset`-only 图片则完全不会被 Turndown 保留，却被计入「缺少可用地址」。实施前无 fixture 覆盖两种形态。
   **处置**：在 URL 绝对化之前新增 `promoteLazyImages()`，从 `data-src` / `data-original` / `data-lazy-src` / `srcset` / `data-srcset` / `<picture><source>` 提升真实地址，并移除会被 Readability 回抄的懒加载属性；新增懒加载 + srcset + picture fixture，断言图片使用发布站地址且 `unresolved === 0`。

2. **AC「selector 输入 +『重新提取』在已抓取的 HTML 上重跑」在空正文场景不可用** — 初次提取 Markdown 为空时，`runScrape` 在写入 `scrapeSource` / `scrapePreview` 之前就返回 `scrape_empty`；selector UI 只在 `v-if="scrapePreview"` 内渲染，管理员无法对已抓取的 HTML 手动覆盖。JS mount-point 页面正是最需要手动 selector 的场景。
   **处置**：初次抓取无论正文是否为空都保存源 HTML 与预览；空正文改为 selector 行内提示，同时禁用「生成草稿并编辑」。已有预览的替换确认、抓取失败重试路径不变。

**（b）超纲 / 行为漂移 — 1 条（已修复 `f9cfad9`）**

1. **标题优先级把默认路径的 `<title>` 挪到正文 H1 之后** — 实施把标题改为「正文 H1 → `<title>` → 页面 H1」，Readability 无标题或回退 `<body>` 时，导航/Logo 的 H1 可能变成草稿标题并被 `dedupeTitleHeading` 从正文删除。T1 契约是 `<title>` 优先；这项改动不在 #34 票面。
   **处置**：默认路径恢复 T1 顺序（Readability title → `<title>` → 正文 H1 → 页面 H1），仅 selector 模式优先所选子树的 H1；回退 fixture 增加隐藏导航 H1，断言标题仍取 `<title>`。同名 H1 全部去重保持不变（导航与正文的同名副本都不应重复渲染）。

**（c）实现但不够精确 — 2 条（均已修复 `f9cfad9`）**

1. **AC「命中时使用所选子树」「GFM 表格」在表格内部节点命中时丢失结构** — `extractBySelector` 把多个 `outerHTML` 拼接后重新解析；`tbody tr` / `td` 脱离 `<table>` 上下文会被 HTML 解析器丢掉标签。复验 `tbody tr` 只得到 `"Alpha1 Beta2"`，`td` 只得到 `"Alpha 1 Beta 2"`，单元格与 GFM 表格均丢失。
   **处置**：新增 `wrapSelectedTableParts()`：行命中补 `<table><tbody>` 并带上原表 `<thead>`（若命中行已含表头则不重复补）；单元格命中补表/行上下文；section 命中补 `<table>`。新增 `tbody tr` 与 `tr` fixture，断言表头只出现一次、数据行按文档顺序保留。README 同步记录「命中表格行/单元格时保留表格与表头上下文」。

2. **AC「命中时使用所选子树」在只命中标题 H1 时被当成失败** — 标题从所选 H1 推出后又被去重，Markdown 为空，`reextractScrape` 走 `scrape_empty` 并保留旧预览；命中了却被当作未命中处理。
   **处置**：命中后无论 Markdown 是否为空都替换预览；空正文只在 selector 行下方提示，并禁用生成草稿。保留旧预览现在只发生在 selector 语法错误 / 未命中（AC 明确要求的路径）。

---

## Standards

**（a）违反已文档化标准 — 0 条**

无硬性违规。`CODING_STANDARDS.md` 的唯一规则（契约面同步，判断题）见（b）1-2；其余为 Fowler 坏味道基线判断项。

**（b）已文档化标准的判断项**

1. **注释描述了不存在的执行路径 — 已修复**：`fencedCodeBlock` 规则保留 `code.class="language-*"` 兜底，注释称「兼容未经过 Readability 的写法」；但 `annotateCodeLanguages()` 在 Readability 与 selector 两条路径上都会先把 class 搬到 `pre[data-language]`，兜底不可达。
   **处置**：删除兜底与失真注释，语言只从 `pre[data-language]` 读取；`buildScrapeDraft` 顶部契约注释同步标题优先级与懒加载步骤。

2. **README 结构清单与测试实际形态不符 — 已修复**：结构条目仍写「抓取管线 HTML fixture」，本票新增的字符集测试使用 GBK/UTF-16 字节数组，URL 测试也使用 HTML fixture。测试小节已更新，结构清单漏改会漂移。
   **处置**：结构条目改为「HTML/字节 fixture」；README 抓取契约同时补懒加载提升、表格上下文、字符集展示，测试段列出懒加载覆盖。

**（c）基线坏味道与判断项**

1. **Duplicated Code — 已修复**：`runScrape` 与 `reextractScrape` 各自组装 `title/markdown/warnings/images` 预览，并各自复制空正文判断。字段增加时要改两处，且空态语义已经分叉。
   **处置**：抽出 `previewFromDraft(draft, warnings, meta)`，两处共用；空正文判断保留在调用点（初次抓取与手动重提取的提示位置不同，但行为一致）。

2. **`ScrapePreview` 与 `ScrapeDraft` 结构重复 — 已修复**：T1 报告称预览「只额外持有 `finalUrl / robotsStatus`」，实际预览 interface 又手抄了 `title/markdown/warnings/images`。
   **处置**：`ScrapePreview extends ScrapeDraft`，只增加 `finalUrl / robotsStatus / charset`；T1 的收敛声明现在与代码一致。

3. **Primitive Obsession — 已修复**：警告码以 `string[]` 在管线、预览和 UI 之间传递，`scrapeWarningText` 用 `default` 吞掉未知值，新增警告码时编译器不会提醒。
   **处置**：`ScrapeWarning` 联合类型贯穿 `ScrapeDraft` / `DecodedHtml` / `ScrapeSource`；UI 用 `Record<ScrapeWarning, string>` 映射 i18n key，联合类型扩展时映射缺项会编译失败。

4. **Speculative Generality — 已修复**：① `DecodedHtml.charset` 已计算但生产代码从不读取，只有测试断言；② `decodeHtmlBytes` 接受 `ArrayBufferView`，唯一调用方是 `ArrayBuffer`，测试用 `Uint8Array`。
   **处置**：`charset` 显示在预览元信息（字符集是排查乱码的直接证据）；输入收窄为 `ArrayBuffer | Uint8Array`，保持两个真实调用形态。

5. **Duplicated Code / 漂移风险 — 已修复**：协议白名单判断在 base、嵌入、链接、图片、统计五处重复 `url && SET.has(url.protocol)`；语言 class 正则与 `annotateCodeLanguages` 各写一份且字符类不同。
   **处置**：抽出 `isSafeLink()` / `isSafeMedia()` 类型谓词；删除 Turndown 侧的正则副本，语言标注只保留 `annotateCodeLanguages` 一处来源。

6. **Mysterious Name — 已修复**：`ScrapeSource.charsetWarnings` 实际存放所有解码警告（当前为 `charset_fallback`），字段名把范围说窄了。
   **处置**：改名 `decodeWarnings`。

7. **Data Clumps — 记录不改**：`resolveBaseUrl` / `downgradeEmbeds` / `resolveDocumentUrls` / `collectImageStats` 都以 `(root, base)` 两参数结伴传递。评审建议收成 `{ root, base }` 上下文对象；四个 helper 都是文件内私有、调用点集中，引入对象只会把两个明确参数换成 `ctx.root / ctx.base`，没有独立行为可承载。**判定：当前形态更直接，保留。**

---

## 验收对照

- [x] selector 输入 +「重新提取」在已抓取的 HTML 上重跑，不发起目标请求 — `reextractScrape` 只读 `scrapeSource.html`，不调用 `fetch`；抓取失败/selector 失败路径均不重新请求。
- [x] selector 未命中给出清晰错误并保留上一个预览；命中时使用所选子树（多个命中按文档顺序拼接）— 语法错误 / 未命中有独立 i18n 文案且不写预览；多命中顺序有测试；表格内部节点命中保留表格上下文（`f9cfad9`）。
- [x] Readability 没识别出正文时回退 `<body>`，并显示 no-article 警告 — 回退与警告保持；默认路径标题顺序恢复 `<title>` 优先（`f9cfad9`）。
- [x] Markdown 保留标题、列表、引用、带语言标注的围栏代码、GFM 表格、图片、行内强调 — 复杂页面 fixture 逐项断言；懒加载 / srcset / picture 图片补测（`f9cfad9`）。
- [x] 相对链接/图片正确解析；iframe/embed/object 安全时转链接、否则丢弃；`javascript:` / `data:` / `vbscript:` 被丢弃 — URL fixture 覆盖；懒加载图片不会再落到管理端 origin（`f9cfad9`）。
- [x] 正文不重复出现文章标题 h1 — 标题去重保持；selector 只命中 H1 时输出空正文 + 提示，不再把命中当未命中（`f9cfad9`）。
- [x] GBK/GB2312 字节正确解码；未知字符集回退 UTF-8 并给警告 — BOM / Content-Type / meta / XML 声明优先级有字节 fixture；预览显示实际字符集。
- [x] 预览显示图片数量与可能坏图的提示 — 保留；另显示字符集。
- [x] fixture 管线测试覆盖复杂页面、selector 命中/未命中、正文回退、表格/代码/图片、相对 URL、危险 scheme、h1、字符集解码 — 3 文件 / 18 用例。

---

## 门禁重放

- root `npm test`：3 文件 / 18 用例通过（新增懒加载图片、selector 表格上下文）
- root `npm run check`：0 errors / 0 warnings（5 hints，均为既有）
- root `npm run build`：Astro 构建 + prebuild 生成物 + CSP 收紧通过（两份 CSP 逐字符一致）；`scrape` 动态 chunk 52.76 kB / gzip 17.76 kB
- worker `npm run typecheck`：`tsc --noEmit` + `tsconfig.test.json` 零错误
- worker `npm test`：9 文件 / 82 用例通过
- `npx prettier --write`：本次改动文件全部通过
- `git commit`（`f9cfad9`）：仓库 pre-commit（lint-staged + worker typecheck/test）通过，未跳过钩子

**总结**：Spec 轴 5 条发现全部修复（2 条缺失、1 条行为漂移、2 条实现偏差）；Standards 轴 0 硬违规，5 条判断项已修复、1 条 Data Clumps 经复验保留。验收 9 条全部满足，剩余未覆盖项只有票面明确留给后续的元数据 / 来源脚注。
