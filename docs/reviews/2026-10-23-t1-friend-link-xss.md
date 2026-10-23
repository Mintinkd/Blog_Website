# T1 友链安全修复（C1 / issue #43）code-review 报告

- **日期**：2026-10-23
- **固定点**：`5fb9854`（修复前）→ `af5b88e`（修复）→ `64fae25`（审查修复）
- **Spec 源**：GitHub issue #43「T1 友链安全：URL scheme 白名单 + 写权限收敛 + 渲染兜底（C1）」
- **审查方式**：code-review 技能双轴（Standards / Spec 并行子代理）

## Standards

**硬违规（文档标准）：未发现。**

逐项核对「契约面同步」四个排查面，均一致：

- **相邻注释**：`worker/src/utils/validator.ts` 的 isValidUrl 白名单注释、`worker/src/router.ts` 友链写路由上方的 C1 注释、`src/islands/FriendLinkList.vue` 的 safeLinks 兜底注释都与新行为相符，无陈旧陈述。
- **README 契约段**：友链写接口两行已补「URL 仅 http/https」；editor→admin 收敛恰使「editor（文章/分类/标签/评论/图片）」由失真变为准确，无需再改。
- **关联文档**：`docs/reviews/2026-10-23-full-codebase-review.md` C1 条目为时点记录，实现与其处方一致。
- **测试约定**（`docs/agents/testing.md` + `AGENTS.md`）：位置（`worker/tests/`、`tests/`）、期望值全为手写字面量、接缝选择（共享 isValidUrl + 工单点名接缝）均合规。

**判断题（气味）**：

1. **Duplicated Code** — 测试文件中两个假 D1 构造器仅 `first()` 分支不同，同文件同形状 → 可合并为一个参数化 fake。
2. **Duplicated Code**（跨包，知情取舍）— scheme 白名单在 `validator.ts:isValidUrl` 与 `src/utils/friend-link-url.ts:safeFriendLinkUrl` 各一份；worker 与根包无法直接共享，头注已声明。
3. **Shotgun Surgery / 可审查性** — 修复提交把 prettier 全量重排（`router.ts`、`validator.ts` 单引号→双引号+折行）与安全改动混在一个 commit，diff 噪声约 10:1。
4. **细微取舍** — `safeFriendLinkUrl("//evil.com")` 会放行（带 base 解析为 http:）而 `isValidUrl` 拒绝，读侧与写侧并非同一集合。

## Spec

**(a) 要求缺失或只做了一半**：

1. 「前端渲染友链 URL 前做兜底……不输出可点击链接」未限定组件，但管理后台 `src/admin/App.vue` 仍 `<a :href="fl.url">` 裸绑原始 URL，未接 `safeFriendLinkUrl`——存量脏数据在后台仍可点击。
2. 「URL 校验收敛为 scheme 白名单」：`worker/src/handlers/admin.ts` 的 import 直接 INSERT `friend_links` 行，不经 `isValidUrl`，防线一被 bulk import 旁路。

**(b) Scope creep**：`router.ts`（655 行）与 `validator.ts`（75 行）整文件 prettier 重排，功能变更仅 3 个路由加 `requireAdmin` + 1 处协议判断，严重放大 review 面。

**(c) 实现隐患**：`safeFriendLinkUrl` 以 `location.href` 为 base 且返回原始串：`//evil.com` 会按页面协议放行并保持可点击，与 validator 的无 base 语义不对称。

**核对通过**：三层各自独立成立、验收标准均有对应用例（editor 403×3、scheme 拒绝×8、兜底单测×4）、无清库/数据迁移、`isValidUrl` 收紧无跨模块回归（media.ts 仅 import 未使用）。

## 处置（fix commit：`64fae25`）

| #   | 轴                   | 发现                                         | 处置                                                                                                                                                                                                                             |
| --- | -------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Spec a1              | 后台友链表格裸绑 `:href`，存量脏数据后台可点 | **已修复**：App.vue 接 `safeFriendLinks` computed，非法协议降级 `<span>`；补测试见既有 router/handler 用例之外的渲染单测（根包）                                                                                                 |
| 2   | Spec a2              | bulk import 旁路防线一                       | **已修复**：admin.ts 导入阶段一对 `friend_links.url` 过 `isValidUrl`，拒绝即零副作用；新增 3 例 import 测试                                                                                                                      |
| 3   | Spec c / Standards 4 | `//evil.com` 读写集合不对称                  | **已修复**：`safeFriendLinkUrl` 改无 base 解析，与 `isValidUrl` 同一接受集合；新增读写同集合用例                                                                                                                                 |
| 4   | Standards 1          | 两个假 D1 同形状                             | **已修复**：合并为参数化 `recordingDb(role?)`                                                                                                                                                                                    |
| 5   | Standards 2          | 跨包 scheme 白名单两份                       | **接受（记录在案）**：worker 与根包为独立 npm 包，无法共享模块；两处头注互相声明，语义由双侧测试共同锁定                                                                                                                         |
| 6   | Standards 3 / Spec b | prettier 重排噪声混入修复提交                | **接受（记录在案）**：lint-staged 钩子强制 prettier，且两文件修复前即不符合现行 `.prettierrc`（单引号），本次提交顺带归一；后续 diff 不再受噪声影响。修复提交本身（af5b88e）的功能变更面已由归一化比对确认为 3 路由 + 1 协议判断 |

## 小结

- Standards：**0 硬违规**，4 条判断题（2 修复 / 2 接受记录）；最严重： prettier 噪声（可审查性，已记录）。
- Spec：**2 条实质缺口**（均已修复）+ 1 条隐患（已修复）+ 1 条 scope creep（同 Standards 3，已记录）。
- 修复后门禁：`npm test` 95 通过、`cd worker && npm test` 99 通过、`npm run check` 0 errors、`worker npm run typecheck` 退出 0。
