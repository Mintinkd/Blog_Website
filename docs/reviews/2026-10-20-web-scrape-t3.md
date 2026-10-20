# 代码审查报告 — #35 T3 网页抓取：元数据、来源脚注与预览体验（code-review 技能，基点 `12a80fe`）

- **日期**：2026-10-20
- **基点**：`12a80fe`（#35 实施前 HEAD，#34 审查报告入库之后）
- **变更提交**（1 个，实施提交）：
  - `10bf085` feat: 网页抓取 T3——元数据、来源脚注与预览体验（#35）
- **复审修正提交**（1 个）：
  - `38311dc` fix: 抓取 T3 审查跟进——正文标签范围与来源标题转义（#35）
- **Spec 来源**：GitHub issue #35 原文（enhancement / ready-for-agent；Parent #32）
- **标准来源**：`CODING_STANDARDS.md`（契约面同步）+ `README.md` 契约面 + `AGENTS.md` + `docs/agents/testing.md` + ADR 0003；Fowler 坏味道基线
- **方法**：code-review 技能原流程 — 两轴并行子代理（Standards / Spec）；本文件归并两轴结论与处置，**不做跨轴合并或重排序**

---

## Spec

### （a）缺失 / 部分落实

1. **AC「标签只匹配已有标签（meta keywords + 正文 tag 链接）」的「正文」范围未落实 — 已修复 `38311dc`**
   `extractTags` 在整份 `doc` 上查询 `a[rel~="tag"], a[href*="/tag/"]…`，侧栏 / 页脚标签云里只要出现同名已有标签，就会进入草稿；而这些链接并不属于文章正文。测试 fixture 的唯一命中「Web」同时出现在 `meta keywords`，无法暴露链接提取过宽的问题。
   **处置**：链接候选限定在 `article` → `main` / `[role="main"]` → `body` 的正文根节点内；meta keywords 仍从文档头部读取。新增「侧栏 Rust / 页脚 Go 不得进入标签」用例，断言只保留 article 内的 Web。README 同步写明 `article` / `main` 范围。

2. **AC「人工烟测通过」缺少可追溯记录 — 本轮已补齐**
   提交本身无法证明 admin 全流程、editor 隔离与失败内联错误经过人工验证。
   **处置**：本轮完成并记录下方「人工烟测」；覆盖 admin 抓取失败/重试、元数据预览、渲染切换、tab 切换保留、覆盖确认、selector 重提取、草稿预填/保存/发布/前台渲染，以及 editor 无 tab + 直调 403。

### （b）超纲 / 行为漂移

1. **预览新增「标签 / 分类 / 状态」元信息行 — 经复验保留**
   AC 要求映射标签、分类与状态，但未明确要求在预览区展示。该行把即将写入草稿的映射结果直接暴露给管理员，属于「预览体验」的合理延伸，不改变保存行为，也没有新增接口或数据字段。
   **判定**：保留。

2. **换账号登录 / 退出时重置 `currentTab` — 经复验保留**
   该改动不在 #35 票面，但人工烟测发现：admin 停留在「网页抓取」后退出、同一 SPA 内改用 editor 登录，editor 虽看不到导航 tab，`currentTab` 仍为 `scrape`，抓取面板与上一会话预览继续显示。直调接口虽已 403，界面隔离仍不完整。
   **处置**：登录成功与退出登录都回到文章页；editor 重新登录后确认无抓取面板。作为 tab 隔离的必要收口保留，不扩展抓取契约。

### （c）实现但不够精确

1. **AC「来源脚注……标题做转义」只转义了 `]` — 已修复 `38311dc`**
   标题 `A [Draft] Title` 生成 `[A [Draft\] Title](…)`；`marked` 实测渲染为 `[A <a …>Draft] Title</a>`，链接文字错误且前缀泄漏。原测试只断言 Markdown 文本，未验证渲染结果，因而把错误输出固化了。
   **处置**：`escapeFootnoteLabel` 同时转义 `\`、`[`、`]`；测试期望改为 `A \[Draft\] Title`。用 `marked` 复验渲染为完整链接文字 `A [Draft] Title`。README 同步为「标题中的 `[` / `]` 会转义」。

---

## Standards

### （a）违反已文档化标准 — 0 条

无硬性违规。`CODING_STANDARDS.md` 的唯一规则（契约面同步）为判断题，见（b）。

### （b）已文档化标准的判断项

1. **README 写「正文 tag 链接」，实现却扫描整页 — 已修复 `38311dc`**
   与 Spec（a）1 同一问题；按正文根节点收窄后，README 与代码一致。

2. **README 写「使用现有 `marked + DOMPurify` 渲染路径」，实际调用全站 `renderMarkdown` — 已同步措辞**
   `renderMarkdown` 内部就是 `marked + DOMPurify`，但带标签白名单；编辑器预览仍是另一套 `marked.parse` + `DOMPurify.sanitize`。行为没有错，契约描述不够精确。
   **处置**：README 改为「复用全站 `renderMarkdown`（`marked + DOMPurify`，标签白名单）」。

3. **README 的 T3 范围未提 `currentTab` 重置 — 经复验保留**
   该行为属于后台会话隔离，不是抓取契约；已在 Spec（b）2 记录，不塞进抓取范围说明。

### （c）基线坏味道与判断项

1. **Divergent Change — `App.vue` 同提交包含抓取预览、认证流与样式 — 经复验保留**
   认证流改动是烟测发现的 tab 隔离缺口，与 #35 的 editor 隔离直接相关；拆分提交会让该修复失去上下文。保留并在 Spec（b）2 说明。

2. **Shotgun Surgery — 抓取参数在初次抓取与 selector 重提取各组装一次 — 已修复 `38311dc`**
   `existingTags: tags.value.map(...)` 与 `scrapedAt` 成对出现两次，新增参数要改两处。
   **处置**：抽出 `scrapeBuildOptions(scrapedAt)`，两处共用；selector 重提取仍沿用首次抓取日期。

3. **Duplicated Code（测试）— 两条 tag 断言复用同一 fixture — 经复验保留**
   一条验证「有已有标签时只保留命中项」，另一条验证「没有已有标签时为空」；语义不同，合并会降低失败定位精度。保留。

4. **冗余分割 — meta keywords 先按逗号分割，循环内又分割一次 — 已修复 `38311dc`**
   重写 `extractTags` 时合并为一次候选构建：keywords 分割 + 正文链接文本分割，循环内只做 trim / 去重 / 白名单判断。

5. **来源脚注转义不完整 — 已修复 `38311dc`**
   与 Spec（c）1 同一问题，两轴均命中；修复与验证见上。

---

## 人工烟测

环境：本地 worker（`127.0.0.1:8787`）+ Astro dev（`127.0.0.1:4321`）。本机 DNS/DoH 无法解析外部目标，实际抓取通过浏览器注入 fixture `fetch` 响应完成；为连通本地 worker 临时修改过 `src/pages/api/v1/[...path].ts` 的代理地址与响应头，烟测后已全部还原，`git status` 干净。

- **admin 全流程**：
  - `admin` 登录后可见「网页抓取」tab。
  - 首次请求返回 502 时显示内联错误「目标域名解析失败或超时，已拒绝代理」与「重试」按钮；改为成功响应后点击重试进入预览。
  - 预览正确显示：`og:title` 标题、meta description 摘要（剥掉字面量 `<b>` 并解码实体）、仅 `og:image` 封面、final URL、字数 39（CJK 逐字 + 英文逐词，不含脚注）、字符集、图片数；关键词 `TypeScript, Rust, Web` 只保留已有标签 `TypeScript` / `Web`，`Rust` 与正文 `Go` 链接被丢弃。
  - 来源脚注为 `> 原文：[标题](final URL)（抓取于 2026-10-20）`，使用重定向后的 final URL。
  - Markdown / 渲染切换正常；渲染视图走 `renderMarkdown`，脚注渲染为 `blockquote` 链接。
  - 切到「文章管理」再切回，预览、URL、渲染模式均保留。
  - 再次抓取弹出「当前预览将被替换，确认继续？」；确认后预览替换，本地封面 URL 正常显示缩略图。
  - selector 输入 `.detail` 重新提取只保留所选段落，字数与图片数更新，脚注日期仍为首次抓取日期。
  - 「生成草稿并编辑」预填标题、空 slug、摘要、封面、正文、分类 1、标签 `TypeScript` / `Web`、状态 `draft`；修改标题后保存。
  - 保存请求体 `slug: ""`，仍走既有 `POST /articles`；服务端生成唯一 slug，创建文章 id `9902`。
  - 将该文章发布后访问前台 `/articles/<slug>`：标题、摘要、封面、标签、正文与来源脚注均正常渲染，无控制台错误。
- **editor 隔离**：
  - `editor1` 登录后导航无「网页抓取」，默认落在文章页，抓取面板不存在。
  - 使用 editor token 直调 `GET /api/v1/admin/scrape?url=…` 返回 `403` +「权限不足，仅管理员可执行此操作」。
- **失败路径**：失败抓取显示内联错误与独立「重试」，重试成功后进入预览；selector 错误路径沿用 T2，本轮未重复验证。

---

## 验收对照

- [x] 标题 Readability → `og:title` → `<title>`；摘要 meta/OG description → 正文前 120 字；封面只取 `og:image`；slug 留空；分类默认 1；状态 `draft`。
- [x] 标签只匹配已有标签（meta keywords + 正文区域 tag 链接）；未匹配丢弃、不创建新标签。
- [x] 来源脚注使用 final URL + 抓取日期；标题 `[` / `]` 均转义；selector 重提取沿用首次日期。
- [x] 编辑器预填全部映射字段且可编辑；保存走既有 `POST /articles`，slug 为空由服务端生成并去重。
- [x] 预览支持 Markdown / 渲染切换；切 tab 保留；新抓取覆盖前确认；失败可重试。
- [x] 新增后台文案 zh / en 成对。
- [x] README 记录抓取 tab / 接口、元数据与脚注契约、root 测试命令。
- [x] 人工烟测：admin 全流程到前台渲染；editor 无 tab 且直调 403；失败抓取内联错误。
- [x] 未加 `articles.source_url`、抓取历史 / 查重、图片转存或自动发布。

---

## 门禁重放

- root `npm test`：3 文件 / 26 用例通过（新增正文标签范围用例）。
- root `npm run check`：0 errors / 0 warnings（5 hints，均为既有）。
- root `npm run build`：Astro 构建 + prebuild 生成物 + CSP 收紧通过（两份 CSP 逐字符一致）。
- worker `npm run typecheck`：`tsc --noEmit` + `tsconfig.test.json` 零错误。
- worker `npm test`：9 文件 / 82 用例通过。
- `npx prettier --write`：本次改动文件全部通过。
- `git commit`（`10bf085`、`38311dc`）：仓库 pre-commit（lint-staged + worker typecheck/test）均通过，未跳过钩子。

**总结**：Spec 轴 5 条发现——2 条修复（标签范围、脚注转义）、1 条补齐证据（人工烟测）、2 条经复验保留（预览元信息行、会话 tab 重置）；Standards 轴 0 硬违规，判断项中 2 条修复 / 措辞同步、3 条经复验保留（重复测试断言、README 范围、Divergent Change）。
