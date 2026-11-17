# taxonomy v2 T6 — 冲突审计报告与严格校验决策（#82 / #75 收口）

2026-11-17。实施代理（AI）在 #82 出具；审计数据来自 #77 的生产导出副本演练（见 #77 关票评论），跨分类清单由 `worker/schema-tag-category-incremental.sql` 的审计 SQL 产出。

## 1. 冲突审计（迁移演练后状态）

生产库 dump 快照（2026-11-17，`wrangler d1 execute --remote --json` 只读）：categories=4 / tags=1 / articles=3 / article_tags=1。

| 审计项                                                  | 结果                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| null category（回填后 `tags.category_id IS NULL` 计数） | **0**（唯一标签「AI」#4 成功回填）                                |
| 跨分类标签（文章分类 ≠ 所挂标签归属）                   | **0 条**——文章 #7 属「转载」(4)，挂标签「AI」(归属「转载」)，一致 |
| 各分类标签数                                            | 转载=1；未分类 / 学习 / 新闻=0                                    |

结论：**所有标签有分类，跨分类冲突为 0，无例外清单**。生产库实际执行 `schema-tag-category-incremental.sql`（一次性）后即达该状态；若上线后新增数据产生冲突，重放审计 2 即可产出当期清单，人工在后台（#80 的分类下标签管理 / TagsPanel 移动）整理。

## 2. 严格校验决策：默认关闭，开关已实现

- **决策**：默认关闭（ADR 0008 决策 2 的软约束口径维持）。理由：当前 0 冲突、数据量极小，开启只增加写入失败面；跨分类标签本身是允许的存量现实（如「转载」分类下挂技术标签）。
- **开关**：`site_config` 行 `strict_tag_category_validation`，值 `1` 开启，缺省 / 其他值关闭。开启后覆盖 `POST /articles` 与 `PUT /articles/:id`（含只改 `category_id` 不传 `tags` 的情况——用库内现有标签集合对生效后的分类校验）；冲突返回 400 `VALIDATION_FAILED`，message 含具体标签名（`TagCategoryConflictError`）。
- **开启方式**（手工 SQL，无需专门后台开关 UI）：
  ```sql
  UPDATE site_config SET value = '1', updated_at = datetime('now') WHERE key = 'strict_tag_category_validation';
  ```
  行不存在时 `INSERT OR IGNORE INTO site_config (key, value) VALUES ('strict_tag_category_validation', '1');`（首次写库自动建行亦可）。
- **回滚（关闭）**：`UPDATE site_config SET value = '0', updated_at = datetime('now') WHERE key = 'strict_tag_category_validation';` 立即生效（每次写路径实时读），无需重新部署。行为由 `worker/tests/tag_strict_validation.test.ts` 5 项钉住（默认关 / 显式关 / 开启冲突 400 / 开启合法 / update 双态）。

## 3. Retro（#75 批次复盘要点）

- **契约先行有效**：T0 的 ADR + GLOSSARY + README 契约让 T1–T6 的实施几乎不需要回头改口径；唯一返工是「schema.sql 尾部 ALTER」与 #94 全新库形态守卫冲突（改并入 CREATE TABLE，已在 #77 关票记录偏离）。
- **`wrangler d1 export` 不可用**是本批次最大的意外发现（FTS5 虚拟表限制）：生产备份兜底改走 D1 Time Travel + 逐表 dump，ADR 0008 的回滚原则不变、操作路径已修正记录。
- **测试桩的隐式契约**：改 `ARTICLE_PUBLISH_COLUMNS` / `ARTICLE_TAGS_SQL` 等共享 SQL 常量会连带破坏按 SQL 文本匹配的测试桩（#90/#101/#70 三处），共享常量的变更半径要在实现前 grep 调用方。
- **Bash 工具跑 PowerShell 脚本报语法错**（`gh.ps1` 需 pwsh）与**根包 vitest 大小写盘符坑**都在本批次再次出现，已分别由 AGENTS.md / 项目记忆固化。

## 4. 文档收尾清单（本票完成）

- README：`POST /articles` / `PUT /articles/:id` 行补严格校验开关说明（默认关 / 开启行为 / 开关 SQL）。
- GLOSSARY：新增「严格校验」术语。
- `docs/agents/testing.md`：taxonomy v2 矩阵补 #82 条目。
- 本报告：审计结果 + 开关决策 + retro。
