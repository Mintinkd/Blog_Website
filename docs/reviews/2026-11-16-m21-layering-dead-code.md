# M21 #101 分层归位与死代码清理 — 审查处置报告

**日期**：2026-11-16
**review 固定点**：`b69dfe8` → `7ca6524`（三提交 972c63b / 682bd21 / 7ca6524）
**双轴**：Standards + Spec，独立并行审查

## 交付

1. username→id 收敛 `services/user_service.ts`（11 处 + edit_lock_service 2 处变体）
2. slug 检查收敛 `slugExists()`（handler 2 处 + service 1 处 → 单点）
3. 写后重读回环消除：create/update 改走模块内 `loadArticleDetailById(id)`，不再反调公开 `getArticleBySlug`
4. 死代码：删除 3 个全死 models 文件、2 个零引用 interface、response.ts 的 success/paginated 去 export

## Findings 与处置

### HARD（两轴共同）

**edit_lock_service.ts 收敛遗漏，注释失真**。

- 现象：`src/services/edit_lock_service.ts` 有两个本地 helper（`getUserIdByUsername` / `getUserInfoByUsername`），内联两份逐字相同的 `SELECT id, display_name FROM users WHERE username = ?`；而 user_service.ts 注释自称"全 Worker 唯一入口"。
- 处置：`user_service.ts` 扩展导出 `getUserInfoByUsername`（id+display_name）；edit_lock_service 删除两个本地 helper，全部委托公共服务。grep `FROM users WHERE username` 现只剩 user_service（2 函数）+ auth 登录/鉴权路径（带 password_hash/role 等功能性查询，非"取 id"域，合理保留）。

### Judgement

1. **文档契约**：README services 清单 + testing.md 未登记新 service / 写后重读契约 → 已补（CODING_STANDARDS 契约面同步头号复发项）。
2. **tags 单点无本票证据**：#89 已交付 `loadArticleTags`（group_concat 列表 + 逐篇详情），本票未改 → 补守卫测试 `article_service_layering.test.ts` 证明"逐篇取标签 SQL 未泄漏到其他文件"，关票说明协同关系。
3. **`??` vs `||` 口径**：`getUserIdByUsername` 用 `?? null`，被替换处部分用 `|| null`。AUTOINCREMENT id 从 1 起，id=0 不可达，行为等价；测试补 display_name 边界（getUserInfoByUsername）。
4. **写后"仍回读一次"**：Spec 轴指出 `loadArticleDetailById(id)` 仍读一次（非"零回读"）。判定：票面原文是"消除 service 写后重读**回环**"——核心是 create→getArticleBySlug 的跨 service 公开入口回环，已消除；保留一次按 id 的详情读回是为确保 category/author/tags 响应形状 100% 不变（写入数据不含这些关联字段）。关票评论明确"写入返回什么"契约。
5. **格式 churn**：response.ts / models/comment.ts 的引号/换行变化为 pre-commit prettier 所致（历史同类），无实质变更。

## 未迁移范围（票面允许"按领域分批"）

- `comment.ts` 10 处内联 SQL（含 :208 的 `comment_count` 重算）——属 Out of scope 的 M9 计数对账（#72 已修域），本票不动
- `search.ts` 4 处内联 SQL——属 Out of scope 的搜索架构域，本票不改算法
- auth_handler / middleware/auth 的 `FROM users WHERE username` 变体——登录/鉴权专用查询（需 password_hash/role/must_change_password），非"取 id"重复

## 门禁

- `cd worker && npm test`：46 文件 / 412 测试全绿
- `cd worker && npm run typecheck`：0 errors
- 根包 `npm test`：50 文件 / 553 passed + 1 expected fail（#110 移交的 hop-by-hop 缺陷）
- 根包 `npm run check`：0 errors / 0 warnings / 8 hints（既有）
- `privacy-page.test.ts`（README 契约）：13 全绿

无遗留 finding。
