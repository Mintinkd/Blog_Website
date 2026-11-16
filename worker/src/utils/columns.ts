/**
 * 显式 SELECT 列清单（issue #73 / M22）。
 *
 * 所有向外返回对象或参与 join 的查询都从这里取列，禁止 `SELECT *`：
 *  - 与 worker/schema.sql 的表列 + 后续 ALTER TABLE 迁移列保持一致；
 *  - 与 admin 前端实际消费字段对齐（见 docs/agents/testing.md 的 M22 登记）；
 *  - 单点维护，列清单与结果类型在 type 层对齐（下方 *Columns 类型）。
 *
 * 修改 schema 新增列时，若该列需要对外暴露，须同步此处。
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

/** tags：创建返回体（含迁移列 created_by）。 */
export const TAG_COLUMNS = "id, name, slug, created_by, created_at" as const;

/** articles：局部更新读取只需 id 与 published_at（判断首次发布补时间戳）。 */
export const ARTICLE_PUBLISH_COLUMNS = "id, published_at" as const;
