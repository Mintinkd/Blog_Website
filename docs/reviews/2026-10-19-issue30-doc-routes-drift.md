# 代码审查报告 — #30 路由文档对齐 router（code-review 技能，基点 `bbfcbda`）

- **日期**：2026-10-19
- **基点**：`bbfcbda`（#29 复审报告入库提交，本票实施前 HEAD）
- **变更提交**（1 个，实施提交）：
  - `6d22e6e` docs: #30 路由文档对齐 router——三组漂移收口：/settings 公开口径改为 /settings/public 白名单投影（/settings 与 /settings/all 归 admin 全量视图）、编辑锁改 /articles/:id/edit-lock（含 /force）、阅读量并入 GET /articles/:slug（删除不存在的 /articles/:article_id/view）
- **复审修正提交**（1 个）：
  - `9a69282` docs: #30 复审修正——README 默认值标识符 DEFAULT_SETTINGS→getDefaultSettings()、SITE_SETTINGS 架构图补 admin GET /settings、前言设置清单补动效
- **Spec 来源**：GitHub issue #30 原文（documentation / ready-for-agent）
- **标准来源**：`CODING_STANDARDS.md`（契约面同步）+ `README.md` 契约面 + `AGENTS.md` + `GLOSSARY.md` + `docs/agents/testing.md` / `domain.md` / `issue-tracker.md`；Fowler 坏味道基线
- **方法**：code-review 技能原流程 — 两轴并行子代理（Standards / Spec）；本文件归并两轴结论与处置，**不做跨轴合并或重排序**

---

## Spec

**（a）缺失 / 部分落实 — 0 条**

六个漂移点与扫描项逐条核过：

1. README 公开表删除 `GET /settings`、新增 `GET /settings/public`（白名单投影口径）——与 `router.ts:136` 及 `PUBLIC_KEYS`（theme/layout/background/features/motion/copy）一致。
2. README 管理员表补 `GET /settings`（全量视图，与 `/settings/all` 等价）——两者在 `router.ts:137-138` 均映射 `handleGetSettings`（auth+admin）。
3. README 旧 :298 / :306 的「/settings 公开」口径已改为 `/settings/public`，全量读取明确归 admin。
4. README 编辑锁 4 条路径改为 `/articles/:id/edit-lock`（×3）+ `/articles/:id/edit-lock/force`（admin）——与 `router.ts:153-156` 一致；30 分钟 TTL 与 `LOCK_TTL = 1800` 一致。
5. 删除 `/articles/:article_id/view` 行；阅读量说明并入 `GET /articles/:slug`——与 `handleGetArticle` → `incrementViewCount`（Cookie `view_<id>`，`Max-Age=86400`）一致。
6. `docs/SITE_SETTINGS.md` 表格：`/settings/public` 公开、`/settings` 与 `/settings/all` admin 且说明各自独立——与 router 逐条一致。
7. 其余 live 文档（`docs/BACKGROUND_IMAGE.md`、`docs/UI_MOTION_UPGRADE.md`、`docs/security/csp-evaluation.md`、根文档）无三组漂移表述。

验收 grep（`/articles/:id/lock`、`/articles/:article_id/view`、`/settings` 公开口径）仅命中 `docs/reviews/` 历史快照——票面明确排除。

**（b）超纲 — 0 条**

超出票面行号的修改（SITE_SETTINGS 前言 / 架构图 / 安全段）均由 Desired behavior 第 7 条「扫描其余 live 文档…一并对齐」与第 3、6 条覆盖；无代码、构建、部署机制或历史快照改动。

**（c）实现但不够精确 — 0 条**

路径、方法、鉴权级别、公开投影字段、阅读量 Cookie TTL、编辑锁 TTL 均与实现一致；无残留旧契约。

---

## Standards

**（a）违反已文档化标准 — 0 条**

无硬性违规。`CODING_STANDARDS.md` 唯一规则「契约面同步」为判断题，见下。

**（b）基线坏味道与判断项**

1. **契约面同步（judgement，已修复 `9a69282`）** — `README.md:298` 同一句内的 `DEFAULT_SETTINGS` 标识符不存在；实现为 `getDefaultSettings()`（`worker/src/handlers/settings.ts:88`）。已随复审修正改为实际符号。代码侧同句注释（`worker/src/handlers/settings.ts:12`）同样写 `DEFAULT_SETTINGS`，属票面「不改代码」范围，记录不改。
2. **契约面同步（judgement，已修复 `9a69282`）** — `docs/SITE_SETTINGS.md:13` 架构图只列 admin 写操作，遗漏面板加载时的 `GET /settings`（`src/admin/App.vue:1937`）。已补入图中。
3. **Duplicated Code / Shotgun Surgery（judgement，记录不改）** — README 与 SITE_SETTINGS 各保留两行近乎相同的 `/settings` / `/settings/all` 全量视图说明。这是票面 Desired behavior 第 2、6 条的显式要求（`/settings/all` 说明须独立写明）；根因是代码层两个路由指向同一 handler 的别名设计，属 out-of-scope（不改 worker 路由）。文档已写明「等价」关系，读者可判别。
4. **Mysterious Name（judgement，记录不改）** — `/settings` 与 `/settings/all` 名称无法自解释何者规范。同上，属代码层别名；本票以「等价入口」标注缓解，未改路由。
5. **契约面同步（judgement，已修复 `9a69282`）** — `docs/SITE_SETTINGS.md:3` 前言设置清单遗漏「动效」，与数据模型 / API 表中的 `motion` 不一致。已补。

---

## 验收对照

- [x] 上列 6 个漂移点全部修正（`6d22e6e`）
- [x] settings / 编辑锁 / 阅读量三组表格与 `worker/src/router.ts` 逐条对照：路径、方法、鉴权一致（Spec 轴逐条复核）
- [x] live 文档无残留「`/settings` 公开」「`/articles/:id/lock`」「`/articles/:article_id/view`」表述（grep 验证，仅 `docs/reviews/` 历史快照命中）
- [x] 不改代码、构建与部署机制（diff 仅 `README.md`、`docs/SITE_SETTINGS.md`）

**Out of scope 保留**：worker 路由 / 鉴权行为未动；`docs/reviews/` 历史快照未回写；未做 README 全量路由表重新审计。

---

## 门禁重放

- 两次提交的 pre-commit：`npx lint-staged`（prettier）→ worker `npm run typecheck` → `npm run test`（7 文件 / 56 用例）全绿
- `npm run gen:settings` + `git diff --exit-code -- src/generated/settings-rules.ts worker/src/generated/settings-rules.ts` → 空 diff（exit 0）
- `npm run gen:headers` + `git diff --exit-code -- public/_headers` → 空 diff（exit 0）
- `npm run check`：0 errors / 0 warnings（5 条 hints 为既有项，不在本票 diff 范围）

**总结**：Spec 轴 0 条发现；Standards 轴 0 硬违规，5 条判断项中 3 条已随 `9a69282` 修复、2 条（路由别名相关）按票面 out-of-scope 记录不改。
