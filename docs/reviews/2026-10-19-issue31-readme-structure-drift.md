# 代码审查报告 — #31 README 结构与仓库现状对齐（code-review 技能，基点 `788d488`）

- **日期**：2026-10-19
- **基点**：`788d488`（#30 复审报告入库后的 HEAD，本票实施前）
- **变更提交**（1 个，实施提交）：
  - `de71ead` docs: #31 README 与仓库现状对齐——八项结构漂移收口：表数量改 10、分类/标签索引页入清单与路由表、Sidebar 幽灵条目移除、utils/scripts/docs/根文档清单补录、部署二次覆盖步骤补记
- **复审修正提交**（1 个）：
  - `0886ef3` docs: #31 复审修正——结构清单补齐 code-review 发现：src/middleware.ts 与 worker security_headers.ts 入树、worker package.json/tsconfig 入清单、utils 块缩进与 types 末子项对齐
- **Spec 来源**：GitHub issue #31 原文（documentation / ready-for-agent）
- **标准来源**：`CODING_STANDARDS.md`（契约面同步）+ `README.md` 契约面 + `AGENTS.md` + `GLOSSARY.md` + `docs/agents/testing.md` / `domain.md` / `issue-tracker.md`；Fowler 坏味道基线
- **方法**：code-review 技能原流程 — 两轴并行子代理（Standards / Spec）；本文件归并两轴结论与处置，**不做跨轴合并或重排序**

---

## Spec

**（a）缺失 / 部分落实 — 1 条（已分诊处置 `0886ef3`）**

1. **AC「结构清单与 `git ls-files` 对照：无幽灵条目、无已跟踪缺项」只做到一半** — 幽灵条目 0（解析 127 条清单项全部命中已跟踪路径），但缺项仍在：`worker/src/middleware/security_headers.ts` 已跟踪却未列（复审时 README:112-115 只有 auth/cors/rate_limit）；同类约 12 处（`src/middleware.ts`、`public/favicon*`、`scripts/*.d.mts`、`worker/package.json|tsconfig*.json`、`.github/workflows/backup.yml` 等），均系本 diff 前既有遗留，票面 8 条本身逐条落实。
   **处置**：代码类缺项随 `0886ef3` 补入——`src/middleware.ts`（SSR 安全响应头中间件，消费安全头单源）、`worker/src/middleware/security_headers.ts`（API 侧安全响应头）、`worker/package.json`、`worker/tsconfig.json`（注释携带 `tsconfig.test.json`）；工具文件 / 锁文件 / favicon 样板资产维持既有策展式省略，记录不改；`.github/workflows/backup.yml` 处于删除收尾中（AGENTS.md 已先行），不补。

**（b）超纲 — 0 条**

diff 仅 `README.md`；新增行全部对应票面 8 项要求；`docs/reviews/` 历史未回写，合「Out of scope」。

**（c）实现但不够精确 — 0 条**

逐项实测：「表数量改 10」→ `worker/schema.sql` 10 张实表 + `articles_fts` 虚表与同步触发器属实（第 11 条 CREATE TABLE 系迁移块重复 users）；「补 categoryColors.ts、escape.ts」→ 导出（escapeHtml/escapeAttr/safePathSegment/sanitizeHighlight、hexToRgba/shade 等）与行注相符；「删除 Sidebar.astro」→ layout 仅剩 BaseLayout；「/categories、/tags」→ 两 `index.astro` `prerender = false` 且 `fetch('/api/v1/...')`；「部署第 4 步」→ 与 `deploy.yml:70-86`（sleep 120 → 覆盖 Pages → 覆盖 Worker）一致；playwright 未见于 package.json 与 lock，「需先自行安装」属实；ADR 0001/0002 标题对得上；重放 gen:settings / gen:headers 无新漂移。

---

## Standards

**（a）违反已文档化标准 — 0 条**

无硬性违规。逐 hunk 核对仓库现状全部相符；`CODING_STANDARDS.md` 唯一规则「契约面同步」为判断题，见下。

**（b）基线坏味道与判断项**

1. **契约面同步（判断项，部分修复 `0886ef3`）** — 补录未穷尽：根清单仍缺 `.husky/`、`.prettierrc`、`.lintstagedrc`、`skills-lock.json`、`package-lock.json`；worker 块缺 `tsconfig.test.json`（`docs/agents/testing.md` 点名的 typecheck 件）。README 未声明清单完备度口径，属既有策展风格。**处置**：worker tsconfig 已补（注释携带 test 配置）；工具文件 / 锁文件按清单策展口径记录不改（与 status quo 一致）。
2. **可能 Duplicated Code（判断项，记录不改）** — 渲染模式在树注（「分类云（SSR）」）与路由表两处并存；本次两侧已同步；属结构视图与路由视图的固有重复，后续改动需扫两处。
3. **可能 Duplicated Code（判断项，记录不改）** — 新增第 4 步「等待 120 秒」复述 `deploy.yml:71` 的 `sleep 120`；README 惯例以具体数字描述行为（如编辑锁 30 分钟 TTL），deploy.yml 为实施源，数字漂移风险可接受。
4. **格式（判断项，已修复 `0886ef3`）** — utils 块树前缀少一层；同段 `types/` 末子项标记 `├──` 未收尾。**处置**：两处缩进 / 标记对齐（纯格式，零语义）。

---

## 验收对照

- [x] 上列 8 项全部修正（`de71ead`）
- [x] 结构清单与 `git ls-files` 对照：幽灵条目 0；复审发现的代码类缺项补齐（`0886ef3`）
- [x] 表数量与 `worker/schema.sql` 一致；`/categories`、`/tags` 与 `src/pages/` 实际页面一致；部署步骤与 `deploy.yml` 一致（Spec 轴逐项实测）
- [x] 门禁重放全绿（见下）
- [x] 实施提交 diff 仅 `README.md`

**Out of scope 保留**：playwright 声明与 nav 脚本去留；`docs/reviews/` 历史快照未回写；README 全量 API 契约逐行重审未做（#30 已收口路由表）。

---

## 门禁重放

- 两次提交的 pre-commit：`npx lint-staged`（prettier）→ worker `npm run typecheck` → `npm run test`（7 文件 / 56 用例）全绿
- `npm run gen:settings` + `git diff --exit-code -- src/generated/settings-rules.ts worker/src/generated/settings-rules.ts` → 空 diff（exit 0）
- `npm run gen:headers` + `git diff --exit-code -- public/_headers` → 空 diff（exit 0）
- `npx prettier --check README.md` → 通过

**总结**：Spec 轴 1 条缺失（既有清单缺项，`0886ef3` 部分修复、其余记录不改）；Standards 轴 0 硬违规，4 条判断项中 2 条已修复（契约面同步-代码类、格式）、2 条记录不改。
