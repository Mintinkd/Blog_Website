import type { CategoryBrief } from "./article";

/** 标签（taxonomy v2 / ADR 0008：归属分类 1:N；迁移期 category_id 可空）。 */
export interface Tag {
  id: number;
  name: string;
  slug: string;
  category_id: number | null;
  category: CategoryBrief | null;
  article_count: number;
  created_at: string;
}

/** 创建标签请求（T3 起消费可选 category_id；旧 {name, slug} 请求体仍兼容）。 */
export interface CreateTagRequest {
  name: string;
  slug: string;
  category_id?: number;
}
