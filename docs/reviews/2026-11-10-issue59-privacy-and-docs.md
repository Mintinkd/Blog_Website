# #59 阅读统计 7/7：隐私页与文档同步 — 两轴复审

- 日期：2026-11-10
- 初始提交：`7446d63`（`feat: #59 隐私披露页与跨文档同步`）
- 复审修复提交：`9907351`（`fix: #59 review fixes (guard docs, script inventory, static HTML assertion, disclosure wording)`）
- 固定点：`7ec3d6d`
- 复审命令：`git diff 7ec3d6d...7446d63`
- 规格来源：issue #59；母票 #52；`docs/READER_ANALYTICS.md` §2 / §3 / §4 / §5 / §6 / §7.8 / §8 / §9 / §11；`docs/adr/0005-reader-analytics-aggregate-first.md`；`GLOSSARY.md`
- 标准来源：`CODING_STANDARDS.md`、`README.md`、`docs/agents/testing.md`、`GLOSSARY.md`、`docs/security/cloudflare-guards.md`、`scripts/security-headers.mjs`、`.github/workflows/deploy.yml` + Fowler 坏味基线
- 说明：两个轴由**并行子代理**分别执行，独立成段，未合并排序。#58 已补第 5 个 admin 只读接口 `trend`，故 README 实际列 5 个而非工单立票时写的 4 个；`verify-all-pages-nav.mjs` 是手动前台导航回归、依赖真实文章 API，本机 dev server 代理超时属环境前置条件（#58 报告已记录）。

## Standards

### Hard violations

1. **关联文档** (`CODING_STANDARDS.md:15`) — `docs/security/cloudflare-guards.md:25` 仍把 `HTML_ROUTE_PATTERNS` 列为 7 项、缺 `/privacy*`，而 `scripts/cloudflare-guards.mjs` 已是 8 项；该文 `:85` 自设同步要求亦未满足。
2. **结构清单** (`CODING_STANDARDS.md:14`) — `README.md` 的 `scripts/` 结构树逐列 `.mjs`，漏本次新增 `verify-privacy-page.mjs`，也漏 #58 的 `verify-admin-analytics.mjs`。
3. **相邻注释与行为** (`CODING_STANDARDS.md:7`、`docs/agents/testing.md`) — `scripts/verify-privacy-page.mjs` 注释称「关键披露段落必须出现在静态 HTML 中（无 JS 也完整）」，实际用 `innerText()` 读 `refreshDomTranslations()` 覆写后的水合 DOM，未取 HTTP 响应或独立禁用 JS 的 context。

### Baseline smells (judgement)

- **Duplicated Code** — `src/pages/privacy.astro` 每个 `data-i18n` 内嵌中文与 `zh.json` 的 `privacy.*`、`BaseLayout.astro` 的「隐私」与 `nav.privacy` 逐字重复；`i18n.ts` 的 `textContent = t(key)` 会覆写首屏，两份漂移将破坏无 JS / 切回中文一致性，而 `tests/privacy-page.test.ts` 只锁键集合与非空、未锁二者相等。
- **Mysterious Name** — 新增 22 个 `privacy.*` 与既有页面级 `page.*` 前缀不一（`privacy.title` / `privacy.desc` 未循 `page.*`）；`nav.privacy` 与 `nav.*` 一致。
- **Shotgun Surgery** — 一条预渲染路由需同步 6 处清单，本次恰漏上述两处文档，印证漂移成本。
- 隐私页未误用 GLOSSARY `_Avoid_` 词；`public/_headers` 确由 `npm run gen:headers` 生成、块序与头值与 `renderHeadersFile()` 一致，`deploy.yml` 漂移门禁可过；`HTML_ROUTE_PATTERNS` 与 `worker/tests/cloudflare_guards.test.ts` 手写清单逐项同步；`tests/privacy-page.test.ts` 的 `PRIVACY_KEYS` / `ADMIN_STAT_ROUTES`（5 个含 trend）为独立手写字面量。

## Spec

### (a) Missing / partial

1. 隐私页未披露 `Asia/Shanghai` 日界 / 时区；spec §2 与 §11 决策 2 是口径单一来源，词条只写「按日汇总」「文章 × 日期 × 类别」。
2. ADR 0005 `Consequences` 仍称「`阅读量` 的 GLOSSARY 定义不变」，但 #59 已改写该定义，跨文档同步不彻底。

### (b) Scope creep

`scope_body` / `note` 额外披露 Desired 清单外的 §3 / §7.8 条目（指纹、单访客明细、精确坐标），`note` 预告未来「引入分类同意」触及 Out of scope 的 Tier 1 同意弹窗；IP 口径加码「不出现在日志 / never logged」，超出 spec §3「明文不落库」。

### (c) Looks implemented but questionable

1. `<title>` 与 meta `description` 在 `src/pages/privacy.astro` 硬编码中文、不随 locale 切换：`refreshDomTranslations()` 只刷 `[data-i18n]`，英文的 `privacy.title` / `privacy.desc` 仅挂 h1 / page-desc；而 README 当时称「中英文案走 data-i18n」。
2. 联系方式「通过关于页面找到博主联系方式」未必成立（`/about` 正文取运行时 `about_content`，无独立联系字段）；仅仓库 issue 真实可用。另 `item_ua` 只列三档，spec §3 设备为含 `unknown` 的四档。
3. 验收 6 的测试子代理未执行，需在报告中由实际门禁结果复核。

## 处置

| #   | 轴        | 发现                                        | 处置                                                                                                                                                                                                                                                                                                                                             |
| --- | --------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | Standards | 护栏文档仍列 7 项（hard）                   | **已修 `9907351`**：补 `/privacy*`，与 `HTML_ROUTE_PATTERNS` 8 项一致                                                                                                                                                                                                                                                                            |
| S2  | Standards | README 脚本结构树漏 2 个回归脚本（hard）    | **已修 `9907351`**：补 `verify-admin-analytics.mjs` / `verify-privacy-page.mjs` 两行                                                                                                                                                                                                                                                             |
| S3  | Standards | 注释称静态 HTML、实读水合 DOM（hard）       | **已修 `9907351`**：改用独立 `javaScriptEnabled: false` context 读首屏 HTML 断言 HttpOnly / HMAC-SHA256 / 24 小时 / 400 天，注释与行为一致                                                                                                                                                                                                       |
| S4  | Standards | 内嵌中文与 zh 词条重复、未锁相等            | **已修 `9907351`**：`tests/privacy-page.test.ts` 新增逐条相等断言（含 HTML 实体解码），并锁页脚「隐私」与 `nav.privacy`                                                                                                                                                                                                                          |
| S5  | Standards | `privacy.*` 与 `page.*` 前缀不一（轻）      | 接受：隐私页是独立主题的 22 条词条，独立命名空间比塞进 `page.*` 更清晰；`nav.privacy` 已沿用 `nav.*`                                                                                                                                                                                                                                             |
| S6  | Standards | 一条路由同步 6 处清单                       | 接受：S1 / S2 已补齐，且清单由单源生成器（`gen:headers`）与手写测试清单双向锁定，漂移会被 CI 拦截                                                                                                                                                                                                                                                |
| P1  | Spec      | 未披露 `Asia/Shanghai` 日界                 | **已修 `9907351`**：`retention_body` 中英补「日界按站点时区 Asia/Shanghai 切分」                                                                                                                                                                                                                                                                 |
| P2  | Spec      | ADR 仍称 GLOSSARY 定义不变                  | **已修 `9907351`**：改为「已随 #59 按 `Asia/Shanghai` 日界、Cookie 快路径与 HMAC 令牌口径精确化」                                                                                                                                                                                                                                                |
| P3  | Spec      | 过度承诺 IP 日志、note 预告 Tier 1 分类同意 | **已修 `9907351`**：删「不出现在日志 / never logged」与分类同意预告；`scope_body` 保留 §7.8「明确不做」的合理披露，不实现任何同意弹窗                                                                                                                                                                                                            |
| P4  | Spec      | `<title>` / description 不随 locale 切换    | 接受并澄清 `9907351`：站点**所有页面**的 head 文案都是 frontmatter 静态中文，`refreshDomTranslations()` 只覆盖 `[data-i18n]`；README 已写明该范围，正文与页脚中英完整由浏览器回归验证。要修需改 BaseLayout head 契约（给 Props 加可选 `titleI18nKey` / `descriptionI18nKey`，并让 `i18n.ts` 支持 `data-i18n-content`），属站点级改动，超本票范围 |
| P5  | Spec      | 联系方式不实、设备只三档                    | **已修 `9907351`**：联系方式改为仓库 `Mintinkd/Blog_Website` issue（真实可用）；设备补「未知」四档；中英词条与页面内嵌中文同步                                                                                                                                                                                                                   |
| P6  | Spec      | 验收 6 未由子代理执行                       | **已复核**：root 133 / worker 225 passed、`check` 0 errors、`typecheck`、Prettier、生成物零漂移、`dry-run`、privacy / admin / 文章 SSR 三条 Playwright 回归全绿，见下方 Verification                                                                                                                                                             |

**Summary:** Standards — 3 hard violations（S1 护栏文档、S2 脚本清单、S3 注释与行为，均已修）+ 3 judgement（S4 已修 / S5 S6 接受），轴内最严重为 S3 静态证据名不副实；Spec — 6 findings（missing 2 / scope creep 1 / questionable 3，行为性发现全部修复或澄清，P4 有据接受），轴内最严重为 P4 head 文案的站点级既有约定。所有行为性发现已在 `9907351` 闭环。

**Verification:** root `npm test` 133 passed；worker `npm test` 225 passed；worker `npm run typecheck` clean；root `npm run check` 0 errors；Prettier check clean；生成物漂移断言为空；`wrangler deploy --dry-run` 通过；`node scripts/verify-privacy-page.mjs`（系统 Edge，含无 JS context）PASS；`node scripts/verify-admin-analytics.mjs` PASS；`node scripts/verify-article-ssr.mjs` PASS；两次提交的 pre-commit hook 均通过。
