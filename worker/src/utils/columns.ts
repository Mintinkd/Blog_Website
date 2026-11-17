/**
 * 业务 handler 的显式 SELECT 列清单（issue #73 / M22）。
 *
 * 覆盖分类 / 友链 / 媒体 / 标签 / 文章局部更新这些 handler 的读取列，禁止
 * `SELECT *`：列与 worker/schema.sql 的表列 + ALTER TABLE 迁移列保持一致，
 * 并与 admin 前端实际消费字段对齐（见 docs/agents/testing.md 的 M22 登记）。
 *
 * 职责边界：admin 全表导出（handleExport）的列清单不在此处，而在
 * `admin.ts` 的 `IMPORTABLE_TABLES[*].columns` —— 那张表是导入/导出共用的白名单，
 * 属导出的唯一来源。两处互不重叠，避免双源维护。
 *
 * 修改 schema 新增列时，若该列需要对外暴露，须按所属域同步此处或 importables。
 */

/** categories：列表 / 创建 / 更新返回体（列表另经 LEFT JOIN 追加 article_count）。 */
export const CATEGORY_COLUMNS =
  "id, name, slug, description, created_by, created_at, updated_at" as const;
/** categories 更新时判断所有权只需这两列。 */
export const CATEGORY_OWNER_COLUMNS = "id, created_by" as const;

/** friend_links：管理端全字段（含 logo_url / sort_order / is_active，前端编辑表单依赖）。 */
export const FRIEND_LINK_COLUMNS =
  "id, name, url, description, logo_url, sort_order, is_active, created_at, updated_at" as const;
/** friend_link 更新时判断存在性只需 id。 */
export const FRIEND_LINK_ID_COLUMNS = "id" as const;

/** media_assets：列表返回体，前端用 kv_key 拼 url、uploaded_by 做归属过滤。 */
export const MEDIA_COLUMNS =
  "id, filename, original_name, mime_type, file_size, kv_key, storage_type, alt_text, uploaded_by, created_at" as const;

/** tags：创建返回体（含迁移列 created_by 与 taxonomy v2 的 category_id）。 */
export const TAG_COLUMNS =
  "id, name, slug, category_id, created_by, created_at" as const;

/** articles：局部更新读取只需 id / published_at / category_id（#82 严格校验要算生效分类）。 */
export const ARTICLE_PUBLISH_COLUMNS = "id, published_at, category_id" as const;
