# #57 阅读统计 5/7：文章明细与数据质量接口 — 两轴复审

- 日期：2026-11-09
- 初始提交：`e4208e6`（`feat: #57 文章明细与数据质量接口`）
- 复审修复提交：`a1607d4`（`fix: #57 review fixes (shared totals SQL, orphan rows, heartbeat format, comments)`）
- 固定点：`d4eb01f`
- 复审命令：`git diff d4eb01f...e4208e6`
- 规格来源：issue #57；`docs/READER_ANALYTICS.md` §2 / §6 / §7.1 / §7.3 / §7.4 / §7.6 / §9 / §10 / §11；`docs/adr/0005-reader-analytics-aggregate-first.md`；`GLOSSARY.md`
- 标准来源：`CODING_STANDARDS.md`、`README.md`、`docs/agents/testing.md`、`GLOSSARY.md`、`worker/schema.sql`、`.github/workflows/deploy.yml` + Fowler 坏味基线
- 说明：两个轴由**并行子代理**分别执行，独立成段，未合并排序。`README.md` 表格重排是 prettier 归一的既有行为，两轴均未计为违规。

## Standards

### Hard violation

1. **契约面同步** (`CODING_STANDARDS.md:7`) — `worker/src/handlers/analytics.ts:47` 头注释仍称「概览与分布共用」、`:57` 仍称「两个只读接口共用」，而新增 `articles` / `quality` 后 `parseRange` / `rangeBounds` 已供 **4 个** handler 调用，两处相邻注释陈述旧行为且对应 hunk 均未触及，正是该规则点名的「handler 内旧行为注释失效」复发。README 接口表 / 结构树、spec §7.4 / §7.6 契约段、`testing.md`、`deploy.yml` 门禁均已同步或无需改。

### Baseline smells (judgement)

- **Divergent Change／过度膨胀** — `analytics.ts` 现 393 行聚 overview / dimensions / articles / quality 四类变更理由，#55–#57 连续加料；建议按报表拆文件或把 quality 告警计算下沉 service。README 结构树仍单列该文件、明文未禁多 handler 同文件，故判 judgement。
- **Feature Envy／D1 桩耦合** — `analytics_reports.test.ts:132-265` 的 `makeEnv` 按 `sql.includes("JOIN articles a" / "SUM(bot_filtered)" / "dim = 'referrer'")` 等 SQL 特征串分流，并重实现 GROUP BY / SUM / MIN / 分页；期望值仍为手写 `toEqual`（`pv: 15`、`sparkline`、`since`），未违 `testing.md` 独立来源要求。
- **Duplicated Code** — 概览与质量两处 `COALESCE(SUM(pv/uv/...)) … WHERE day BETWEEN` 近乎重复；`sparkline` 与基线两条 `SUM(pv) GROUP BY` 亦形似。
- **Data Clumps / Primitive Obsession（轻）** — `{from, to}` 与 `pv/uv/requests/bot_filtered` 反复成组，心跳为裸 string，quality 平铺 18 字段。

## Spec

已知裁定 (A) sparkline 固定 7 日 / `since` 全表 `MIN(day)`、(B) 分母为 0 返回 `null` / bot 占比分母 / 心跳告警、(C) 3σ 基线与基线全 0 不误报、(D) Tier 1 恒 `null`，经核对与实现、代码注释、spec 均一致，不重复报为缺陷。

### (a) Missing / partial

接口侧无硬性缺失：验收 (1)–(5)、Desired behavior 全部字段、Out of scope 三项均落地。仅残留措辞：§7.4 正文「数据点 < 2 隐藏」「桶最大值」未同步契约注「补 0 恒 7 点」「合计最大值」。

### (b) Scope creep

无。字段、`page` 校验（§7.4）、告警布尔（§7.6）皆出自契约注；README / `testing.md` 属 §9 第 6 步文档同步；`ORDER BY …, article_id ASC` 次级键仅为分页确定性。

### (c) Looks implemented but questionable

1. `total` = `COUNT(DISTINCT article_id)` 无 `JOIN`、`items` 用 `JOIN articles`（§7.4）；文章删除后日聚合按 §5 保留 400 天，悬空 id 可令 `total` / `total_pages` 偏大、末页空页，冲验收 (1)。
2. 心跳「格式非法」仅判 `Date.parse` 有限，未校验 UTC `YYYY-MM-DD HH:MM:SS`；`"2026-11-09 03:00"`（缺秒）、`"2026-11-09"`（仅日期）被解析为有效而不告警，违契约注。
3. 口径差异正文未点明：`top_referrer` 随 `range`、`sparkline` 不随；`pv` 随 `range` 而 `today_pv` / `anomaly` 固定今日。

## 处置

| #   | 轴        | 发现                                               | 处置                                                                                                                              |
| --- | --------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Standards | 两处相邻注释仍称「两个只读接口」（hard violation） | **已修 `a1607d4`**：改为「四个只读接口共用」                                                                                      |
| S2  | Standards | Divergent Change：393 行 4 个 handler              | 接受：四者同属「阅读统计后台只读接口」单一职责，共用私有 helper 正是收敛；文件量级未超 `router.ts`，#58 若再加接口再拆            |
| S3  | Standards | D1 桩按 SQL 特征串分流、重实现聚合语义             | 接受：项目既定模式（`analytics_cleanup.test.ts` 明确「SQL 改了运算符，测试必须跟着失败」），期望值手写独立来源，未违 `testing.md` |
| S4  | Standards | Duplicated Code：两处日聚合汇总 SQL                | **已修 `a1607d4`**：抽 `DAILY_TOTALS_SQL` + `TotalsRow`，overview / quality 共用；#55 的 5 个 overview 测试全绿、行为未变         |
| S5  | Standards | Data Clumps / Primitive Obsession（轻）            | 接受：字段即 §7.6 接口契约，`{from, to}` 已由 `rangeBounds()` 单一来源；DTO 化只增加间接层                                        |
| P1  | Spec      | `total` 无 JOIN，悬空 id 致末页空页                | **已修 `a1607d4`**：total 同样 `JOIN articles`；新增悬空 `article_id` 回归测试；spec §7.4 契约注同步                              |
| P2  | Spec      | 心跳格式非法未严格校验                             | **已修 `a1607d4`**：`HEARTBEAT_PATTERN` 严格匹配 `YYYY-MM-DD HH:MM:SS`；新增缺秒 / 仅日期 / 乱串测试；spec §7.6 契约注同步        |
| P3  | Spec      | `range` 与固定窗口的口径差异未点明                 | **已澄清 `a1607d4`**：spec §7.4 / §7.6 契约注补「sparkline 固定 7 日、`today_pv` / 3σ 固定今日与之前 7 日，均不受 `range` 影响」  |
| P4  | Spec      | §7.4 表格措辞与契约注不一致                        | **已修 `a1607d4`**：改为「`referrer` 桶合计最大值」「内联 sparkline（固定 7 点）；接口补 0，前台按有效点数决定隐藏」              |

**Summary:** Standards — 1 hard violation（S1 失效注释，已修）+ 4 judgement（S4 已修 / S2 S3 S5 接受），轴内最严重为 S1；Spec — 4 findings（missing 1 措辞 / scope creep 0 / questionable 3，全部修复或澄清），轴内最严重为 P1 `total` 与 `items` 口径不一致。所有行为性发现已在 `a1607d4` 闭环。

**Verification:** root `npm test` 106 passed；worker `npm test` 220 passed；worker `npm run typecheck` clean；root `npm run check` 0 errors；Prettier check clean；生成物漂移断言为空；`wrangler deploy --dry-run` 通过；文章 SSR Playwright 回归（系统 Edge）在修复后复跑 PASS；两次提交的 pre-commit hook（lint-staged + worker typecheck/test）均通过。
