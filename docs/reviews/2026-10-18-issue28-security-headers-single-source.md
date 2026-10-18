# 代码审查报告 — #28 CSP 基线单源（code-review 技能，基点 `d0540b0`）

- **日期**：2026-10-18
- **基点**：`d0540b0`（#27 retro 落实提交）；复审对象为工作树相对基点的全量变更（17 文件，复审时的预提交态），复审修复后归档为实施提交
- **变更提交**（1 个，实施提交）：
  - `3bee500` feat: #28 CSP 基线单源——安全头模块（5 头声明式常量 + d.mts）单源持有，_headers prebuild 生成物 + CI 漂移断言，patch-csp 构造式收紧（去手写字面量，双断言加严）
- **Spec 来源**：GitHub issue #28 原文（enhancement / ready-for-agent，拍板=安全头模块单源）+ `docs/adr/0002-security-headers-single-source.md`（决策档案）+ `GLOSSARY.md` 词表
- **标准来源**：`CODING_STANDARDS.md`（契约面同步）+ `README.md` 契约面 + `docs/agents/testing.md`（行为锁期望须独立来源）；Fowler 坏味道基线
- **方法**：code-review 技能原流程 — 两轴并行子代理（Standards / Spec）；本文件归并两轴结论与处置，**不做跨轴合并或重排序**

---

## Spec

**四条验收标准全部落实，未发现缺失 / 超纲 / 错实现**：

1. **AC1（安全头模块单源）** — `scripts/security-headers.mjs`（+ 同目录 `.d.mts`）以声明式常量持有 5 头；`src/middleware.ts` 直接 import 消费基线；`patch-csp` 手写 CSP 字面量与 `UNSAFE_SRC` 全数删除，收紧值由 `tightenCsp(hashes)` 以模块基线为源构造。
2. **AC2（`_headers` 生成态 + prebuild + CI 漂移断言）** — `public/_headers` 由 `renderHeadersFile()` 整文件渲染（带生成标记注释）；`prebuild` = `npm run gen:headers`（零依赖脚本）；`deploy.yml` 最早门禁新增「重新生成 + `git diff --exit-code`」（本机重放空 diff）。
3. **AC3（构造式收紧 + 双断言保留并加严）** — 收紧前先字节校验 `dist/_headers` 与模块渲染一致（fail-fast，先于任何产物改写）；收紧后断言：不残留基线整串 / JS 产物字符串字面量层面无放行 `'unsafe-inline'` 的 `script-src` / 静态与 SSR 两份 CSP 逐字符一致且等于 `tightenCsp` 结果。
4. **AC4（`astro dev` 零变化 + 指令内容与 #9/#10 一致）** — dev 实测 CSP 与基线逐字节一致（curl）；生产收紧产物与重构前构建逐字节一致（内联脚本 sha256 集不变）。

**已记录提示（非缺陷）**：

- 漂移断言只比对已跟踪文件——未跟踪的 `_headers` 不受护（生成物已提交、仓库 main 直发；与 #27 门禁同形）——记录不改。
- 残留断言的判定粒度：整文件原文扫描会把注释 / 文案误读为策略（实测：生成注释与打入 bundle 的模块头注释都含「script-src … 'unsafe-inline'」字样），故收窄为「JS 产物逐字符串字面量判定 + `_headers` 提取等值」；判定面已写进代码注释。

**超纲说明**：无实质超纲。`scriptSrcAllowsUnsafeInline` 谓词与两组护栏测试（谓词单测 + 变体残留）为双断言加严的伴随物；`scripts/patch-csp.d.mts` 为 worker 测试对脚本的类型化 import 所需。

---

## Standards

### (a) 违反已文档化标准（在案，已随实施提交修复）

1. **行为锁期望派生自被测对象**（`docs/agents/testing.md`：期望须独立来源）——渲染测试期望原经模块 / 渲染函数自身派生，与实现同错同绿。**修复**：独立字面量钉死（标记注释 + 5 头逐行）。
2. **README 结构清单缺项**（`CODING_STANDARDS.md` 契约面同步：README 契约段缺项即失真）——scripts 目录清单漏列 `security-headers.d.mts` / `patch-csp.d.mts`。**修复**：两条目补 `.d.mts` 注记。

### (b) 基线坏味道与判断项（在案，处置如下）

1. **Mysterious Name（已修复）**——模块 `at` / `kept`、patch `n` / `m` 不表意 → `scriptSrcIndex` / `keptSources` / `hits` / `match`；并抽 `isJsArtifact` / `isTextArtifact` 收敛重复后缀判定，字面量正则提升为共享常量。
2. **基线取用面（已修复）**——基线经 `SECURITY_HEADERS["Content-Security-Policy"]` 索引取用，单源只落在约定上 → 补 `CSP_BASELINE` 命名导出（`.d.mts` 同步），`patch-csp` / 生成器一律 import。
3. **残留断言过窄（已加严）**——原判定仅整串比对基线，基线被「改一处」的变体（指令重排 / 追加来源）仍放行 `'unsafe-inline'` 却可整体通过 → 模块新增 `scriptSrcAllowsUnsafeInline(csp)`（`script-src` 段内判定，`style-src` 等不受影响）；`patch-csp` 对 JS 产物逐字符串字面量扫描；两组 RED 测试先行（谓词单测 + 变体残留护栏）。
4. **文本级扫描而非解析器（保留，已声明）**——`patch-csp` 以正则提取字面量 / 内联脚本，不引 JS / CSS 解析依赖（构建管线零依赖约束下的既定形态）；精度边界见上文提示。

**来源闭环**：本票收口 `docs/reviews/2026-10-18-code-review-p1-skillrun.md` §Standards(b)5「Duplicated Code · CSP 基线三处拷贝」——三份人工维护拷贝已由「单源模块 + 生成物 + 构造式收紧」消除。

---

## 复审后的门禁重放

- worker `npm run typecheck`（两份 tsconfig）+ `npm test`（7 文件 / 56 用例）全绿
- 根 `npm run check` 0 错误
- `npm run build` 全绿：收紧断言输出「内联脚本 19 处 / 唯一 hash 3 个；已替换 `dist/_headers` 与 SSR 产物」+ 静态/SSR 逐字符一致；独立残留探针 0 违规
- 漂移断言本地重放：`npm run gen:headers && git diff --exit-code -- public/_headers` → 空 diff（exit=0）

**总结**：Spec 轴 0 开放项（AC 1–4 全落实）；Standards 轴 2 条已文档化标准违规 + 3 条判断项在案并处理完毕，1 条判定粒度取舍记录在案。
