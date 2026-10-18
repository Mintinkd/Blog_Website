# 代码审查报告 — 工单批次 #22–#26（code-review 技能，`2cc2d66...HEAD`）

- **日期**：2026-10-18
- **基点**：`2cc2d66`（pre-commit hooks 之后；three-dot diff：`git diff 2cc2d66...HEAD`，排除 `dist/`）
- **变更提交**（5 个，覆盖 issues #22–#26）：
  - `d266b1e` 代理响应映射去重——img/text 通道共用 fetched.kind→Response 共享映射（#22）
  - `9e59dbe` admin 导入收敛——五个并行按表结构 → 每表描述符（#23）
  - `b19c360` 种子口令/初始哈希单一来源——utils/seed.ts + schema.sql 互指注释（#24）
  - `916f8f3` isPlainObject 谓词合一 + applySettings 单次净化（#25）
  - `4d3d423` 前端类型门禁——astro check 修通并钉版 + 存量 3 错误清零（#26）
- **Spec 来源**：GitHub issues #22–#26（`Mintinkd/Blog_Website`，均带 ready-for-agent 标签；实现后逐票回帖并关闭）
- **标准来源**：`CODING_STANDARDS.md`（契约面同步）、`README.md`（主契约）、`docs/agents/testing.md`；Fowler 坏味道基线
- **方法**：code-review 技能原流程——两轴并行子代理（Standards / Spec），本文件原样归并，**不做跨轴合并或重排序**

---

## Standards

### 文档标准排查：契约面同步

**硬违规：未发现。** 逐面验证均同步：`README.md` 技术栈行随 App.vue/markdown.ts 移除 hljs 同步改写；img/text-proxy 行为行与安全段随 #22 语义收口；`README.md` 部署流水线随 `deploy.yml` 新增 `npm run check` 同步；`worker/schema.sql` 种子注释与新增 `seed.ts` 互指；`auth_handler.ts` 头注已更新而非陈述旧行为。

两处判断级缺口（复审后已随手修正，见复核备注）：

- **结构清单缺项**：#26 新增 `scripts/run-astro-check.mjs` 与 `src/types/global.d.ts` 未进 README「项目结构」。
- **相邻注释与代码语义冲突**（`auth_handler.ts`）：注释称「本处只保留与种子无关的门禁常量」，但下一行 `WEAK_DEFAULT_PASSWORDS = ["password", …]` 首项恰是种子口令字面量，与 #24 单一来源表述矛盾。

### 文档标准排查：testing.md

**合规。** 新测试全部落 `worker/tests/` 并入 typecheck；`admin_import.test.ts` 测 `handleImport` 属工单 Key interfaces 点名的 handler 接缝（页首显式注明）；代理/导入路径无网络边界，无需 stubGlobal 打桩；`seed_constants.test.ts` 以文件读取守卫 SQL/TS 双侧一致，是对已声明重复的机械看护。

### 基线坏味（均为判断题，未阻塞）

1. **Duplicated Code / Shotgun Surgery（存量，非本批引入）**：`SiteSettings` 接口 + `getDefaultSettings()` 在 `src/utils/settings.ts` 与 `worker/src/handlers/settings.ts` 逐字段孪生，靠注释互指同步（#11 遗留面，复审报告 2026-10-18 P1 批次 Standards (b)1 已记录）。
2. **Duplicated Code（新增，轻）**：`bodyOf` 助手在 `worker/tests/admin_import.test.ts` 与 `worker/tests/proxy_response.test.ts` 各一份。
3. **可接受**：`ImportableTable.deleteRank/insertRank` 手工 1..9 编号（描述符注释已认领为唯一编辑点）；`proxy_response.test.ts` 以运行时清点 kinds 锁定 `Exclude` 契约形状。

---

## Spec

五票主线全部实现且行为零变化证据充分：worker 40/40 测试全绿、`npm run check` 本地 0 errors（3 → 0）、`mapFetchedFailure` 单点、`IMPORTABLE_TABLES` 单点、seed.ts 单一导出点（grep 哈希字面量仅 `seed.ts`）。

### (a) 缺失 / 部分

- **#26 AC「devDependencies：`@astrojs/check` + typescript」**已齐。但 AC「worker 门禁（typecheck + test）不受影响」与 Out of scope「不动 worker 的 typecheck/test 配置」存在触碰：`worker/tsconfig.test.json` 加了 `types: […, "node", "vite/client"]`、`worker/package.json` 加了 `@types/node`。系 #24 新测试用 `node:fs`/`import.meta.dirname` 的连带必需改动（否则 test typecheck 断），动机正当但落在了 #26 的免改区——已在 #24 关单留言反述。
- **#24 AC「schema.sql 两处 SQL 字面量旁均有互指注释」**✔ 两处都有；但 INSERT 旁注释说「TS 与本文件强制同步」、迁移 UPDATE 旁注释引入「三处同改」的新提法，措辞不同步（复审后已统一为「三处同改」）。

### (b) 票面之外（scope creep）

- **全仓引号/格式化重排**：`auth_handler.ts`、`admin.ts`、`settings.ts`、`img_proxy.ts`、`text_proxy.ts`、`App.vue`（模板整体重排，占 1972 行变更的大头）、`deploy.yml` 的 `'22'→"22"`。五票均无此要求——来源是 `2cc2d66` 加装的 lint-staged（prettier --write 整文件）；零行为差异已逐条核对。
- **#26 附带**：`src/utils/markdown.ts` 与 `App.vue` 删 marked `highlight` 回调、README 技术栈行改写。票面只要求清类型错误；「marked v14 起死代码」属实（装的是 14.1.4），行为中性，但与 hljs 依赖残留一并留在 README 行文中说明。
- `BaseLayout.astro` 的 `teardown` 死变量移除——本是 #26 错误 2 的必需修复（`initMotion(): void` 可证），可接受。

### (c) 看似实现、实现存疑

- **#23 AC「DELETE_ORDER / INSERT_ORDER 的输出序不变」**：自 `deleteRank`/`insertRank` 排序派生，序与旧字面量一致（测试断言与输入顺序无关）；若新增表漏配 rank 会得 NaN 静默排序——但 rank 是描述符的必填字段，漏配即 typecheck 断，当前无静默面。
- **#26「check 失败时部署不发生」**：`Check Frontend Types` 在 Build/Deploy 前；`scripts/run-astro-check.mjs` 以文件路径直达 hoisted bin，pnpm/yarn 布局会断——仓库固定 npm，票内已自述。
- **#26「禁止静默降级」**：根 `tsconfig.json` 排除 `worker`/`dist` 属工具范围矫正（worker 有独立门禁），且已在 #26 关单留言披露（首测 57 项的构成 + 矫正后 3 条清零），合规。

---

## 两轴小结

- **Standards**：0 项硬违规；4 项判断级（2 项已随手修正：README 结构清单缺项、WEAK_DEFAULT_PASSWORDS 注释；2 项存量接受：双端 settings 孪生、测试助手重复）。最严重：**结构清单缺项**（文档失真风险，已修）。
- **Spec**：6 项观察（跨票触碰 1 / 措辞不同步 1 / 范围外 2 / 存疑 2，处置见复核备注）。最严重：**全仓格式化重排**（零行为差异，非行为缺陷，但抬高了本批 diff 的评审成本，已定性为 pre-commit 钩子产出的工具噪音）。

---

## 复核备注（非子代理输出）

- 本批实现期间每组改动先测后改（#22 红绿先行、#23 行为锁定测试先行、#24 一致性守卫先行），两轴子代理报告原样归并如上。
- **已随报告一并修正**（见下个提交）：README 结构清单补 `scripts/run-astro-check.mjs` 与 `src/types/global.d.ts`；`auth_handler.ts` 弱口令名单注释改述为「与 seed.ts 联动复核」；schema.sql 两处注释统一为「三处同改」提法。`worker typecheck + 40 测试` 重跑全绿。
- **接受不修**：双端 `SiteSettings` 孪生（#11 时已明确「两侧语义一致是正确取舍」，如要收敛建议单独立票评估抽共享常量模块）；`bodyOf` 两份（两个独立测试文件的局部助手，出现第三处再做共享工具）；`tsconfig.test.json`/`@types/node` 跨票触碰（#24 必要件，已在 #24 留言反述）；格式化重排（钩子机制性产物，属 2cc2d66 既定设计）。
