# 代码审查报告 — code-review 技能实测（`e19ee4d...HEAD`）

- **日期**：2026-10-17
- **基点**：`e19ee4d`；diff 命令：`git diff e19ee4d...HEAD`（85 文件含 dist；代码文件 30 个，`:(exclude)dist` 后）
- **变更提交**（4 个）：
  - `28fa575` slug 自定义修改 + 未发布文章访问控制
  - `8962d4a` 媒体卡片（音频播放器 / 视频嵌入）
  - `7f3624c` 媒体卡片触控 44px
  - `fae355d` 渗透报告修复（CORS / 安全头 / XSS 转义 / settings 鉴权投影）
- **Spec 来源**：`.codeartsdoer/specs/blog_site/spec.md`（用户指定）
- **标准来源**：`README.md`（本仓库无 `CODING_STANDARDS.md` / `CONTRIBUTING.md`）；Fowler 坏味道基线（仓库标准优先）
- **方法**：code-review 技能原流程 — 两轴并行子代理（Standards / Spec），本文件原样归并，**不做跨轴合并或重排序**

---

## Standards

### (a) 违反已文档化标准（硬性）

1. **README.md:167、285**：文档明确 `GET /settings` 为**公开接口**（"供前台拉取"）。本 diff 在 `worker/src/router.ts` 将 `/settings` 收为 admin 专属并新增 `/settings/public`，README 未同步——接口契约与文档不一致，新接口也未入 API 表。
2. **README.md:443**："静态文本用 `data-i18n` 标记"。`src/pages/index.astro:9-12` 移除 hero 标题/副标题的 `data-i18n`（注释说明为配置独占驱动，属刻意取舍，但 README 未记录）。
3. **README.md:73-112**：结构清单逐文件列举，本次新增 `src/utils/escape.ts`、`src/middleware.ts`、`worker/src/middleware/security_headers.ts`、`public/_headers` 均未登记（轻）。另未发布文章 404 行为亦未写入 README:155。

### (b) 基线坏味道（判断性）

1. **Duplicated Code（重）**：`worker/src/handlers/article.ts:48` 草稿鉴权内联 `SELECT id FROM users WHERE username = ?`，与 `worker/src/services/article_service.ts:31` 的 `getUserIdByUsername()` 逐字重复 → 应复用服务函数。
2. **Duplicated Code + 规则分叉**：slug 校验/占用检测块在 `article.ts:82-90` 与 `122-130` 完全同形（含同一错误文案）；`article_service.ts:159-166` 又做第三次唯一性兜底（`-n` 后缀）。同一规则散落 3 处且行为分叉（CONFLICT 报错 vs 静默改名）；空 slug 在 create 视为"自动生成"、update 视为"不修改"。→ 抽单一 slug 策略。
3. **Duplicated Code**：`src/pages/tags/[slug].astro:58` 保留本地 `esc()`（不转义 `'`）与新引入 `escapeHtml()` 同文件并用，两套语义 → 删 `esc`。同形 `escapeHtml` 在 `src/utils/escape.ts` 与 `worker/src/handlers/search.ts` 各一份（跨运行时，可接受，建议互指注释）。
4. **Duplicated Code**：`worker/src/router.ts:164/168/177/179/189/193` 六处 `withSecurityHeaders(withCors(x, request))` → 提取单点 finalize。
5. **Duplicated Code / 发散风险**：安全头策略在 `public/_headers`、`src/middleware.ts`、`security_headers.ts` 三处手写（`src/middleware.ts:16` 注释自认"保持同一策略"），改动易漏。
6. **Dead code**：`article_service.ts:160` `if (!slug) slug = generateSlug(data.title);` 在前一行三元后恒无效；`scripts/repro-nav-home.mjs:73` `phase &&` 恒真。→ 删除。
7. **Duplicated Code（轻）**：两个 `scripts/*nav*.mjs` 重复 BASE/chromium/snapshot/等待骨架，可抽共享 helper。
8. **Middle Man（轻）**：`index.astro:214`、`articles/index.astro:67`、`articles/[slug].astro:100` 的 `const escAttr = escapeAttr;` 别名无增益，直接调用 `escapeAttr`。
9. **判断提示（非归类）**：`articles/[slug].astro:134` `enhanceMediaLinks` 处于 `loadArticle` 的 try 内，其中 `decodeURIComponent(href…)` 遇畸形 `%` 序列会抛 URIError，使整篇文章落入 139-141 的"加载失败" → 局部兜底或安全解码。

**做得好的部分**：`toPublicSettings` 白名单投影（默认不公开）、session 级缓存后重挂 `astro:page-load` 的模式在 6 个页面一致，未发现 Repeated Switches / Shotgun Surgery 级问题。

---

## Spec

审查对象：`git diff e19ee4d...HEAD`（排除 `dist/`、`ui-preview/`），对照 `.codeartsdoer/specs/blog_site/spec.md`。

### (a) spec 要求了、diff 缺失或只做了一半

1. **「未发布文章仅作者与管理员可访问」只拦了详情接口。** `worker/src/handlers/article.ts:23` 将 `status` 原样传入；`worker/src/services/article_service.ts:43` 的过滤为 `if (status && status !== 'all')` —— 匿名请求 `GET /articles?status=all` 或省略 status（空串）时不加状态条件，**草稿仍会返回给任何人**。与 §5.6.1-3「文章支持"草稿"和"已发布"两种状态，仅已发布文章在前台展示」不符；仅因前端各页固定传 `status=published` 而未暴露。

### (b) diff 出现、spec 未要求的行为（增量改进，不冲突）

1. **音频/视频链接渲染为媒体卡片**（自定义播放器、B 站/YouTube iframe）：§5.8.1-2 媒体素材格式仅列「JPG、PNG、GIF、SVG、WebP、PDF」，无音视频嵌入要求。
2. **文章 slug 自定义修改**：§6.1 文章字段清单无 slug；§6.2/§6.3 只对分类/标签定义 slug（属激活既有后台表单字段）。
3. **CSP/安全响应头**（`public/_headers`、`src/middleware.ts`）、**CORS 白名单收敛**、匿名 **`/settings/public`** 投影：§4.3 只要求 HTTPS、评论 XSS 过滤、DOMPurify、Cloudflare 基础防护；`/settings/public` 不在 §7.4.1 公开接口清单。
4. `astro:page-load` 初始化修复、媒体卡片 44px 触控目标：§4.5.2 仅要求响应式断点适配，无具体实现要求。

### (c) 看似实现、与 spec 不符或明显有问题

1. **`GET /settings` 由匿名公开直接收紧为 `requireAuth+requireAdmin`**（`worker/src/router.ts`），旧公开契约无过渡版本，与 §4.5.3「API接口变更必须保持向后兼容，旧版本接口至少保留一个版本的过渡期」冲突；但符合 §7.1.3「编辑者访问站点配置接口→拒绝」。
2. **新增 slug 校验与文案不符**：`validator.ts:62` 的 `isValidSlug` 正则 `[\p{L}\p{N}]` 实际允许大写字母，与新增报错「仅支持小写字母、数字、中文与连字符」矛盾；该函数同时服务分类/标签，未按 §6.2-3/§6.3-3「仅允许小写字母、数字和连字符」收紧。
3. **XSS 转义修复不完整**：同批改动的 `src/pages/tags/index.astro:94` 仍以 `${tag.name}` 裸插 innerHTML（`categories/index.astro`、`search.astro` 已用 `esc()`）；§4.3 虽只硬性要求评论过滤与 Markdown DOMPurify，但同一风险面未收敛。
4. 另注：详情 API 对匿名访问草稿由 200 改为 404，与 §7.4.1-3「公开接口无需认证…正常处理并返回结果」字面有出入；语义上符合 §5.6.1-3，属可接受取舍。

---

## 两轴小结（技能要求的收官行）

- **标准轴**：12 项发现（硬性 3 / 坏味道 9）。最严重：**slug 校验与唯一性逻辑 3 处实现且行为分叉**（报 CONFLICT vs 静默 `-n` 改名）。
- **Spec 轴**：9 项发现（缺失 1 / 增量 4 / 偏差 4）。最严重：**「未发布文章仅作者与管理员可访问」只拦了详情接口**，列表接口仍可匿名拉到草稿（§5.6.1-3）。

---

## 复核备注（非技能输出）

- 两轴独立复现了 2026-10-17 全量审查中的两条关键结论：`tags/index.astro` 转义遗漏、草稿列表过滤缺口——与全量报告一致，互为交叉验证。
- 标准轴的 README `/settings` 契约漂移与全量报告「README ↔ 实现漂移」结论一致。
- 技能实测结论：流程可跑通（基点校验 → spec 定位 → 双轴并行 → 归并）；正式使用前建议先跑 `/setup-matt-pocock-skills` 配置 issue tracker。
