/** 分类（taxonomy v2 / ADR 0008：tag_count 为名下标签数，不受文章状态影响）。 */
export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string;
  article_count: number;
  tag_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCategoryRequest {
  name: string;
  slug: string;
  description?: string;
}

export interface UpdateCategoryRequest {
  name?: string;
  slug?: string;
  description?: string;
}
