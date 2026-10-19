# 代码审查报告 — #29 前端 dist 产物移出 git 跟踪（code-review 技能，基点 `7c7fc08`）

- **日期**：2026-10-19
- **基点**：`7c7fc08`（#27/#28 dist 同步提交，本票实施前 HEAD）
- **变更提交**（1 个，实施提交）：
  - `8be65d1` chore: #29 前端 dist 产物移出 git 跟踪——git rm -r --cached 全量取消（101 文件）+ 根 dist/ 忽略条目（构建期生成）；部署链路核对：deploy.yml / README / wrangler.jsonc 均消费构建期产物，SITE_SETTINGS「git push dist」口径修正
- **复审修正提交**（1 个）：
  - `420e251` chore: #29 复审修正——dist 忽略规则锚定根目录（/dist/），worker/dist 条目恢复独立命中
- **Spec 来源**：GitHub issue #29 原文（enhancement / ready-for-agent）
- **标准来源**：`CODING_STANDARDS.md`（契约面同步）+ `README.md` 契约面 + `AGENTS.md`（CI/CD 导航）+ `GLOSSARY.md`（产物 / 生成物口径）；Fowler 坏味道基线
- **方法**：code-review 技能原流程 — 两轴并行子代理（Standards / Spec）；本文件归并两轴结论与处置，**不做跨轴合并或重排序**

---

## Spec

**（a）缺失 / 部分落实 — 1 条**

1. 「部署链路核对结论逐条回帖（deploy.yml / README 手动部署 / 根 wrangler.jsonc：各自消费什么、是否受影响）」：复审时 issue #29 尚无评论（`comments: 0`），提交信息只有一句总括。**处置**：已随关票留言逐条回帖；本文件「部署链路核对底稿」段为留言底稿。

**（b）超纲 — 1 条（judgement）**

1. diff 含 `docs/SITE_SETTINGS.md`，超出验收列出的三条部署路径。其中一行确为必要修正——原文「（或 git push `dist`）」在本票后失效（属于「如有依赖则已改造」条款）；同文件 ~34 行表格重排为仓库 pre-commit `lint-staged` + prettier 钩子的自动格式化，非手改。**处置**：保留并记录。回退重排会在下次提交同文件时被钩子再次施加；仓库其他 Markdown（README）已是 prettier 表格格式。

**（c）实现但不够精确 — 1 条**

1. `.gitignore` 条目 `dist/` 未锚定（gitignore 语法：无前导 `/` 即任意深度匹配），同时命中 `worker/dist/`，使票面要求保留的 `worker/dist/` 条目失活，且注释「前端…」的覆盖面窄于实际匹配面。**处置**：已修复（`420e251`）——改为 `/dist/`；复测 `git check-ignore -v dist` → `.gitignore:8:/dist/`，`git check-ignore -v worker/dist` → `.gitignore:11:worker/dist/`（恢复独立命中）。

---

## Standards

**（a）违反已文档化标准 — 0 条**

无硬性违规。

**（b）基线坏味道与判断项**

1. **Duplicated Code（judgement，已修复 `420e251`）** — `.gitignore:7-11`：未锚定的 `dist/` 重复覆盖 `worker/dist/`。`/dist/` 恢复「一条规则一件事」；无功能影响。
2. **契约面同步（judgement，记录不改）** — `docs/reviews/2026-10-17-code-review.md:8`（「`dist/` 构建产物被提交进 git」）与 `:317`（建议移出 git）在行为变更后成为历史态陈述。按本仓库既往做法，历史复审报告是日期快照、由新报告收口；本文件即本票收口记录，不回写历史报告。
3. 其他：无基线坏味道。`docs/SITE_SETTINGS.md:82` 的修正与 deploy.yml / README 实际契约一致；`dist/.assetsignore` 的删除无构建输入损失（源为 `public/.assetsignore`，构建期复制）。

---

## 部署链路核对底稿（关票留言逐条）

- **deploy.yml**：漂移断言（`gen:settings` / `gen:headers` + `git diff --exit-code`）→ 依赖安装 → worker 门禁 → 前端 check → `npm run build` → `pages deploy dist`（含覆盖 Git 集成部署的重部署）；Worker 在 `worker/` 目录另行 `wrangler deploy`。部署阶段消费的是构建期产物，不读仓库版 dist。**结论：不受影响。**
- **README 手动部署**：先 `npm run build`，再 `npx wrangler pages deploy dist --project-name=blog-website-page`。**结论：不受影响**（本就先构建后消费）。
- **根 wrangler.jsonc**：`main` = `dist/_worker.js/index.js`、`assets.directory` = `./dist`，服务本地 / 手动 wrangler 流程，同样读取构建期产物。**结论：不受影响**（核对确认未新增对仓库版 dist 的依赖）。
- **附带发现并改造**：`docs/SITE_SETTINGS.md:81` 的「（或 git push `dist`）」依赖已跟踪 dist，已改为构建期消费口径（`8be65d1`）。

---

## 复审后的门禁重放

- `git ls-files dist` → 0；`git check-ignore -v dist` → `.gitignore:8:/dist/`；`git check-ignore -v worker/dist` → `.gitignore:11:worker/dist/`
- `npm run build` 全绿：CSP 收紧输出「内联脚本 19 处 / 唯一 hash 3 个」，静态与 SSR 两份 CSP 逐字符一致；构建后 `git status` 无 dist 条目
- `npm run gen:settings` + `git diff --exit-code -- src/generated/settings-rules.ts worker/src/generated/settings-rules.ts` → 空 diff
- `npm run gen:headers` + `git diff --exit-code -- public/_headers` → 空 diff
- worker `npm run typecheck` + `npm run test`（7 文件 / 56 用例）全绿
- `npm run check` 0 错误（5 条 hints 为既有项，不在本票 diff 范围）
- 以上即 deploy.yml 全部门禁的本地等价重放

**总结**：Spec 轴 1 条缺失（关票留言，已随关票补齐）+ 1 条超纲记录（SITE_SETTINGS 必要修正 + 钩子重排）+ 1 条精确性问题（已随 `420e251` 修复）；Standards 轴 0 硬违规，1 条判断项已修复、1 条记录不改。
