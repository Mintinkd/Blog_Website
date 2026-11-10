# #58 阅读统计 6/7：后台「统计」面板 — 两轴复审

- 日期：2026-11-10
- 初始提交：`12c76d2`（`feat: #58 后台统计面板与按日趋势接口`）
- 复审修复提交：`573ef52`（`fix: #58 review fixes (stale comments, independent i18n expectations, dimension labels, locale reactivity)`）
- 固定点：`13694a1`
- 复审命令：`git diff 13694a1...12c76d2`
- 规格来源：issue #58；`docs/READER_ANALYTICS.md` §4.1 / §6 / §7.1–§7.6 / §9 / §10 / §11；`docs/adr/0005-reader-analytics-aggregate-first.md`；`GLOSSARY.md`
- 标准来源：`CODING_STANDARDS.md`、`README.md`、`docs/agents/testing.md`、`GLOSSARY.md`、`worker/schema.sql`、`.github/workflows/deploy.yml` + Fowler 坏味基线
- 说明：两个轴由**并行子代理**分别执行，独立成段，未合并排序。`README.md` 表格重排是 prettier 归一的既有行为，两轴均未计为违规。
- 范围裁定：#55–#57 的 4 个只读接口都不返回按日 PV / UV 序列，而 §7.3 要求双线趋势；老大明确选择「在 #58 内补最小 `GET /api/v1/admin/analytics/trend?range=` 只读接口」，不改动已关票接口契约。

## Standards

### Hard violations

1. **契约面同步** (`CODING_STANDARDS.md:7`) — `worker/src/handlers/analytics.ts` 头注仍写 `#55–#57 / §7.2、§7.4–§7.6`，L64 / L74 两处注释仍称「四个只读接口共用」，在第 5 个 handler `handleAnalyticsTrend` 落地后未同步；#57 复审刚修过同类即复发。router 注释、README、spec、`testing.md` 均已改。
2. **期望值独立来源** (`docs/agents/testing.md:88`) — `tests/analytics-view.test.ts` 直接以实现的 `ANALYTICS_I18N_KEYS` 作为 i18n 期望清单，等于从被测对象同一数据推回。质量门禁 `deploy.yml` 无违规。

### Baseline smells (judgement)

- **Divergent Change / Shotgun Surgery** — `src/admin/App.vue` 3592→约 4270 行，#58 散落 6 个 hunk（模板 / 取数 / navItems / adminOnlyTabs / 生命周期 / 样式），宜拆面板组件。
- **Primitive Obsession** — 新增的 `analyticsOverview` / `analyticsArticlesData` / `analyticsQuality` 均为 `ref<any>`。
- **Duplicated / Speculative Generality** — zh / en 各 53 条中 `analytics.dim_other` 无 `t()` 使用（实际用 `analytics.other`），死词条＋重复；原测试只查单向 ⊆ 故漏检。
- `scripts/verify-admin-analytics.mjs` 的 fixture 与两份 vitest 各手写同组日期 / 分页 / sparkline 字面量，按 `testing.md` 独立来源约定允许；浏览器回归只锁 DOM，未与单测重复。

## Spec

已知范围约定（trend 接口）、实现约定（A 补 0 与有效日、B `null` / `insufficient` / `other`、C `locale-changed` 不重挂载、D 导航回归前置条件）经核对一致，不重复报为缺陷。

### (a) Missing / partial

1. §4.1 注明确「`bot_filtered` 的后台解释文案由 #58 落地」（免费版无 Bot Management、规则 5/6 为永不触发守卫分支）；实现只有数值，无解释词条。
2. §7.5 地区要求「国家两位码 + 名称、Top 8」、设备要求「桌面 / 移动 / 平板 / 未知」；`dimensionRows()` 直出原始 bucket（`desktop` / `CN`），无名称映射、无 Top 8 截断，维度标签的中英同步缺位。
3. §7.6「清理心跳 > 26h 标红」：5 项告警统一用 `.alert`（黄），未分红 / 黄。

### (b) Scope creep

未触及 Out of scope（Tier 1 同意面板 / CSV 导出 / 单访客明细）。仅 §7 内的展示细化：趋势图例与圆点、异常正常态文案、`暂无数据` 复用；`analytics.dim_other` 死词条已在 S5 处理。

### (c) Looks implemented but questionable

1. §7.1「数据时间」注明取「最近写入或清理任务心跳」；实现用 `new Date().toLocaleTimeString()`（客户端取数时刻），未用 `quality.heartbeat_at`。
2. 约定 (C) 下 `currentLocale` 只驱动模板重渲染；`analyticsCards` / `analyticsDimensionViews` / `analyticsQualityRows` 是 computed，内部 `t()` 读模块级变量、不依赖该 ref，缓存不会失效 → 切语言后卡片 / 维度 / 质量标签停留旧语言，冲验收 (4)。
3. §7.1 顶部「文章」筛选的 `article_id` 只拼进 3 个 `dimensions` 请求，overview / trend / articles / quality 均未带；下拉仅取前 50 篇。

## 处置

| #   | 轴        | 发现                                           | 处置                                                                                                                                                                      |
| --- | --------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Standards | 第 5 个 handler 落地后注释仍称「四个」（hard） | **已修 `573ef52`**：头注改 `#55–#58 / §7.2–§7.6`，两处改「五个只读接口共用」                                                                                              |
| S2  | Standards | i18n 期望清单来自实现（hard）                  | **已修 `573ef52`**：测试内手写 `EXPECTED_KEYS` 字面量，断言实现清单与之相等，并加 zh / en 双向 `analytics.*` 键集合断言                                                   |
| S3  | Standards | App.vue 4270 行、6 hunk                        | 接受：仓库是单文件 SPA（README 结构树明示），#58 改动集中在「统计面板」一域；拆组件需跨文件状态传递，风险高于收益                                                         |
| S4  | Standards | `ref<any>`（轻）                               | 接受：与 App.vue 既有 20+ 个 `ref<any>` 风格一致，单独类型化反而与周围不一致                                                                                              |
| S5  | Standards | `analytics.dim_other` 死词条                   | **已修 `573ef52`**：删除该中英词条，测试双向键集合断言可抓同类残留                                                                                                        |
| P1  | Spec      | §4.1 `bot_filtered` 解释文案缺                 | **已修 `573ef52`**：新增 `analytics.bot_hint` 中英词条，质量面板底部展示；spec §7.6 注同步                                                                                |
| P2  | Spec      | 设备 / 地区标签与 Top 8 缺，维度标签中英不同步 | **已修 `573ef52`**：设备走 `t("analytics.device_*")`，地区用 `Intl.DisplayNames` 补区域名（不维护易过期国家名表）并 Top 8 截断；新增 2 条表驱动测试；spec §7.5 注同步     |
| P3  | Spec      | 心跳告警未标红                                 | **已修 `573ef52`**：心跳行带 `critical`，CSS 用 `--color-error` 红；其余告警仍黄                                                                                          |
| P4  | Spec      | scope creep                                    | 无越界，仅 §7 展示细化；死词条随 S5 处理                                                                                                                                  |
| P5  | Spec      | 「数据时间」用客户端时钟                       | **已修 `573ef52`**：优先 `quality.heartbeat_at`（UTC → 本地 HH:mm），无心跳时回落本次取数时刻                                                                             |
| P6  | Spec      | computed 不依赖 locale，切语言标签不更新       | **已修 `573ef52`**：三个 computed 显式 `void currentLocale.value`，语言切换重算且不重挂载、筛选与分页状态保留                                                             |
| P7  | Spec      | 文章筛选只作用分布区、下拉前 50 篇             | **已澄清 `573ef52`**：已关票的 4 个接口中只有 `dimensions` 接受 `article_id`，要全站筛选须改后端（超本票范围）；spec §7.1 实现说明写明                                    |
| P8  | 环境      | 前台导航 Playwright 回归超时                   | 接受：手动脚本依赖真实文章 API，实测真实 API 200/5.7s、本机 dev server 代理 000/超时；`testing.md` 已记录前置条件。本次新增的 admin 面板回归与既有文章 SSR CI 门禁均 PASS |

**Summary:** Standards — 2 hard violations（S1 失效注释、S2 期望值独立来源，均已修）+ 3 judgement（S5 已修 / S3 S4 接受），轴内最严重为 S2；Spec — 8 findings（missing 3 / scope creep 0 / questionable 3 / 澄清 1 / 环境 1，行为性发现全部修复），轴内最严重为 P6 语言切换响应性。所有行为性发现已在 `573ef52` 闭环。

**Verification:** root `npm test` 123 passed；worker `npm test` 225 passed；worker `npm run typecheck` clean；root `npm run check` 0 errors；Prettier check clean；生成物漂移断言为空；`wrangler deploy --dry-run` 通过；`node scripts/verify-admin-analytics.mjs`（系统 Edge）PASS；`node scripts/verify-article-ssr.mjs`（系统 Edge）PASS；两次提交的 pre-commit hook 均通过。
