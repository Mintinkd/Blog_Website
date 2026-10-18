# 代码审查报告 — #27 设置白名单双端同构后复审（code-review 技能，`b77c8c0...HEAD`）

- **日期**：2026-10-18
- **基点**：`b77c8c0`（#27 拍板档案提交——ADR 0001 + GLOSSARY 入库；three-dot diff：`git diff b77c8c0...HEAD`）
- **变更提交**（1 个，实施提交）：
  - `73f5838` feat: #27 设置白名单双端同构——`settings.rules.json` 单源描述符 + `generate-settings-rules` 双端生成物，读侧 sanitize / 写侧 validate 消费生成物，CI 最早门禁漂移断言
- **Spec 来源**：GitHub issue #27 原文（enhancement / ready-for-agent，拍板=候选 a 对称双生成）+ `docs/adr/0001-settings-rules-descriptor-generated.md` + `GLOSSARY.md` 词表
- **标准来源**：`CODING_STANDARDS.md`（契约面同步）+ `README.md` 契约段 + `docs/agents/testing.md`；Fowler 坏味道基线
- **方法**：code-review 技能原流程 — 两轴并行子代理（Standards / Spec），本文件原样归并，**不做跨轴合并或重排序**

---

## Spec

**四条验收标准全部落实，未发现缺失 / 超纲 / 错实现**（子代理以 `git show b77c8c0:<旧文件>` 逐一对照旧规则值）：

1. **AC1（描述符单源 + 双端生成物 + 两侧消费 + 语义逐字保留）** — 4 条 pattern（hexColor / size / localPath / httpsUrl）经 `new RegExp(JSON.stringify(src))` 重拼后正则源逐字节一致；数值区间 `0..1 / 0..30 / 0.7..1.3 / 0..0.1`、copy 上限 `2000`、intensity 枚举逐字等价。容器判定语义保留：读侧每级 `isPlainObject` ≡ 旧「污染容器整体回落」，写侧 `ruleValue` 的 `typeof object` 判定 ≡ 旧实现，各 hop 取值结果一致。
2. **AC2（npm script + worker 质量门禁仍绿）** — `gen:settings` 已入 root package.json；worker `tsc` 两份 tsconfig 绿、vitest 47/47 绿（40 存量 + 7 新增）；前端 `npm run check` 0 错误。
3. **AC3（CI 漂移断言生效）** — `deploy.yml` 在 `npm ci` 之前（最早门禁）执行 `npm run gen:settings && git diff --exit-code`；本机重放 exit=0。
4. **AC4（行级手抄清零）** — 全仓 grep：`{3,8}` / `2000` / 四段区间字面量仅存于描述符与其生成物；连 `cssFrom` / `buildOverlay` 的防御性钳制数都改为 `numericRangeAt` 消费生成物。

错误路径顺序以 `worker/tests/settings_rules.test.ts` B 组 `EXPECTED_PATHS`（40 条全序，独立字面量非派生）契约级锁定：形状全空 / 每路径必拒探针 / copy 恰为 cap 合法、cap+1 与非字符串点名键，与旧实现报错序一致。

**已记录的两条提示（非缺陷）**：

- 漂移断言仅挂载 `push main` / `workflow_dispatch`（PR 阶段不跑）——本仓以 `main` 直部署为现状形状，spec 未要求 PR 覆盖。
- `numericRangeAt` 模块加载期对描述符形状 fail-fast 抛错——代码注释已声明为刻意设计。

**超纲说明**：无实质超纲。新增 A 组（生成物机制锁定：双端字节一致 + 分区集合 + 引用自洽）为 AC 的测试面伴随物，与 testing.md 既有约定相容。

---

## Standards

### (a) 违反已文档化标准（本次复审在案并已修复）

1. **`worker/tests/settings_rules.test.ts` B 组横幅注释**「validateSettings 当前为手写逐字段实现，本组先以行为钉住再重构」——TDD 过程叙事被带入成品，与同提交已完成的改写相矛盾（契约面同步：同文件相邻注释必须与行为是同一件事）。**随复审 amend 修复**：改为陈述现状「validateSettings 消费生成物后的行为安全网」。
2. **README 质量门禁行分隔符笔误**「测试 前端」读作一词——随复审 amend 修复。

其余契约排查面（双端 `settings.ts` 相邻注释、README 结构树 / 合法性单源段 / 质量门禁行、`docs/agents/testing.md` 门禁顺序、ADR 0001、GLOSSARY 词表使用）逐项核过，无失真。

### (b) 基线坏味道（判断性，有意保留，非违规）

1. **Duplicated Code（跨包不可共享的通用谓词）**：`applyLeaf`（读侧）与 `validateSettings`（写侧）的按 kind 判定谓词逐字同形，`readValue` / `ruleValue` 的取值遍历同形——两包各自的 tsconfig 不可跨包 import（根 `tsconfig.json` 显式 `exclude: worker`），且 CI 漂移断言只护「描述符 → 生成物」的字节一致、不护两侧谓词；读侧无测试设施仅 `astro check` 门禁，是最少守卫的面。属候选 a 机制的既定代价；若将来出现第三消费方，收敛方向是 third package 或 codegen 注入谓词。
2. **Repeated Switches（`switch (rule.kind)` 四处）**——`applyLeaf` / `validateSettings` / 测试探针与自洽测试各一；闭集 union 的显式分发是本机制的形态，新增 kind 本就要同步四处（四处均以穷举 switch 提示）。
3. **命名**与 GLOSSARY 新词（规则描述符 / 生成物 / 单一事实源 / 写侧 / 读侧）全部对齐，无 Mysterious Name；测试 `EXPECTED_PATHS` 为独立契约锁，不计重复。

**来源闭环**：本报告的存在理由本身是 2026-10-18 P1 复审报告 `docs/reviews/2026-10-18-code-review-p1-skillrun.md` §(b).1「Duplicated Code（双端同套规则）」的收口——该条已由本票消除。

---

## 复审后的门禁重放

- worker `npm run typecheck` + `npm test`（6 文件 / 47 用例）全绿
- 根 `npm run check` 0 错误
- 漂移断言本地重放：`npm run gen:settings && git diff --exit-code -- src/generated/settings-rules.ts worker/src/generated/settings-rules.ts` → 空 diff

**总结**：Spec 轴 0 开放项（AC 1–4 全落实）；Standards 轴 2 处硬项（注释契约面 ×1 + 文档笔误 ×1）已随复审 amend 修复，余 2 条判断性坏味道为机制既定代价并已记录收敛方向。
