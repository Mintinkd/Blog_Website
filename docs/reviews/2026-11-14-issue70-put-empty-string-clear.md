# issue #70（编辑器 T2b）PUT 空字符串清空 — 实施与两轴复审

- 日期：2026-11-14
- 工单：[#70](https://github.com/Mintinkd/Blog_Website/issues/70)（Part of #60；解除 #65 / #67 的前置阻塞）
- 范围：Worker `PUT /articles/:id` 的局部更新语义；请求 / 响应契约不变，不新增 D1 迁移
- 标准来源：`README.md`（主契约）、`CODING_STANDARDS.md`、`docs/agents/testing.md`、`GLOSSARY.md`、`docs/ARTICLE_EDITOR_UPGRADE.md` §9.3、`.github/workflows/deploy.yml`

## 改动清单

| 文件                                        | 内容                                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `worker/src/handlers/article.ts`            | 新增 `optionalTextField()`：字段存在即写入（`""` 清空），`undefined` / `null` 视为未提供；只替换 `content` / `summary` / `cover_image` 三行 |
| `worker/src/services/article_service.ts`    | `updateArticle` 类型注释同步「`undefined` 不写入、`""` 合法清空」契约                                                                       |
| `worker/tests/article_update_clear.test.ts` | 新增 11 个用例（见下「Spec」），D1 用按 SQL 语义落库的有状态内存桩                                                                          |
| `README.md`                                 | 需认证接口表后补一段 `PUT /articles/:id` 局部更新契约                                                                                       |
| `docs/agents/testing.md`                    | Worker 测试段按文件列举，补该测试的覆盖说明                                                                                                 |

`title`、`slug`、`status`、`category_id`、`tags` 的分支、`POST /articles` 的创建分支、接口形状与 D1 schema 均未改动。

## Standards（契约面同步 / 测试约定）

- **契约面同步**（`CODING_STANDARDS.md` 头号复发项）：改动点相邻注释（`optionalTextField` 的 JSDoc）、service 层 `updateArticle` 注释、README 接口契约段、`docs/agents/testing.md` 测试清单四处同步；README 原表无「空值忽略」类失真描述，故只在表后补契约，不重写表格行。
- **行为锁期望值独立来源**（`docs/agents/testing.md`）：初始文章行、完整 `UPDATE articles SET … WHERE id = ?` SQL 与 bind 值全部为手写字面量，不从被测实现反推；D1 桩按 SET 子句列名与 bind 顺序落库，SQL 写法改变会让断言失败。
- **接缝分层**：清空 / 保持原值走 `handleUpdateArticle → updateArticle → getArticleBySlug → 响应` 全链路；401 / 403 与 admin 可清空走 `router()` 全链路（工单测试清单点名，视为已确认接缝）。没有把同一行为再放进浏览器回归。
- **术语**：沿用 GLOSSARY「单一事实源 / 生成物」等口径，未引入新术语；未触碰生成物，CI 漂移断言为空。
- **无新增依赖 / 迁移 / 配置改动**：`deploy.yml`、两份 wrangler 配置、`schema.sql` 均未改。

## Spec（逐条对照工单）

| 工单条目                                   | 落地与证据                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `content: ""` 清空正文并返回空正文         | 响应 `data.content === ""`；UPDATE SQL `content = ?, updated_at = ?`，bind 首位为 `""`              |
| `summary: ""` 清空摘要                     | 响应 `data.summary === ""`，正文保持原值                                                            |
| `cover_image: ""` 清空封面                 | 响应 `data.cover_image === ""`，正文保持原值                                                        |
| 未传字段保持原值                           | 空请求体只写 `updated_at`；只改标题时 SET 子句无三个文本字段；另钉住三字段同时清空与非空值普通更新  |
| 空标题仍被拒绝                             | 落地为「拒绝把空标题落库」：`title: ""` 时 SET 子句不含 `title`、响应标题保持原值（见下方口径说明） |
| 非 owner 403 / 无 token 401                | `router()` 全链路断言 10004 / 10003，且两者都不产生 UPDATE                                          |
| `title` 等字段校验与语义不变               | 分支未改；测试钉住空标题、仅改标题、非空值写入的既有行为                                            |
| 不改接口形状 / 不新增迁移 / 不动 POST      | diff 仅含上表五处代码/文档，无 schema / workflow / 前端调用改动                                     |
| README / `docs/agents/testing.md` 文档同步 | 已同步（见改动清单）                                                                                |

**「空标题仍被拒绝」口径**：PUT 既有实现不对 `title` 做 400 校验（只在 POST 创建时 `validate()`），工单同时要求「`title` … 的现有校验与语义不变」。因此不新增 400 校验，保持 `""` 按「未提供」跳过写入；测试断言的是空标题不会被落库，而非 HTTP 400。

**`null` 口径**：契约文字为「字段存在即写入」，但三个文本字段若收到 JSON `null`，`String(null)` 会写进字面量 `"null"`。实现把 `null` 与 `undefined` 一起视为未提供，沿用旧假值判断下的行为；后台表单（`src/admin/App.vue` 的 `saveArticle()`）只发送字符串，无 null 来源。

## 红测验证（行为锁有效性）

临时把 `worker/src/handlers/article.ts` 回退到 HEAD 旧实现后运行 `worker/tests/article_update_clear.test.ts`：`5 failed | 6 passed`（5 个清空类用例全部失败，含 admin 经 `router()` 的用例；其余 6 个「既有行为不变」用例仍通过），随后恢复实现并复跑全量 255 passed。证明新测试确实锁定本次缺陷，而非自我证明。

## 验证

- Worker `npm run typecheck`：`tsc --noEmit` + `tsc -p tsconfig.test.json` 通过
- Worker `npm test`：25 文件 / 255 用例通过（含新增 11 个）
- 根包 `npm run check`：0 errors（7 hints，均为既有未使用变量）；`npm test`：19 文件 / 170 用例通过
- CI 生成物漂移断言：`npm run gen:settings` / `npm run gen:headers` 后 `git diff --exit-code` 均为空
- Prettier `--check`（本次 5 个改动文件）：通过
- Playwright（系统 Edge）：`verify-article-ssr.mjs`、`verify-admin-responsive.mjs`、`verify-visual-friendliness.mjs`（4 组 × 348 条断言）全 PASS
- 提交前 pre-commit hook：`npx lint-staged` + Worker typecheck / test 通过；推送后 GitHub Actions 结论见关票留言

## Out of scope（如实保留）

- 后台编辑器（#64 / #65 / #67）的清空 UI 与调用链不在本票；本票只保证服务端能正确接收 `""`。
- `docs/ARTICLE_EDITOR_UPGRADE.md` §9.3 是 #60 的 spec 文档（本批次未纳入本次提交），其「由 #70 单独修复」仍作为设计意图成立，未改写他票在建文件。
- 浏览器回归用本地 mock 拦截 `/api/v1/**`，不覆盖真实 Worker 的 PUT 接缝；该接缝由 Worker vitest 覆盖，二者不重复。
- 未新增 title 的 400 校验、未处理 `PUT` 的乐观并发、未改 `POST /articles` 创建语义（均属契约不变范围）。
