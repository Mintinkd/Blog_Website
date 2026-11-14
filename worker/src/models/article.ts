export interface Article {
  id: number;
  title: string;
  slug: string;
  content: string;
  content_html: string;
  summary: string;
  cover_image: string;
  category_id: number | null;
  author_id: number | null;
  status: "draft" | "published";
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArticleListItem {
  id: number;
  title: string;
  slug: string;
  summary: string;
  cover_image: string;
  category: CategoryBrief | null;
  tags: TagBrief[];
  status: "draft" | "published";
  view_count: number;
  like_count: number;
  comment_count: number;
  author_id: number | null;
  author_name: string | null;
  published_at: string | null;
  created_at: string;
  reading_time: number;
}

export interface ArticleDetail extends ArticleListItem {
  content: string;
  content_html: string;
}

/**
 * 编辑器按稳定 id 取正文的响应（issue #63 / ADR 0006 取数接缝）。
 *
 * 字段与 `PUT /articles/:id` 请求体对齐（title / slug / content / summary /
 * cover_image / category_id / status，tags 由 `TagBrief[].name` 回写），另带
 * id / author_id / created_at / updated_at 供编辑器装载元信息。
 * 刻意不含 `content_html`：该列是历史遗留、页面与编辑器都不读取，从类型上
 * 避免编辑器误用；也不带 view_count / reading_time 等阅读统计字段。
 */
export interface ArticleEditDetail {
  id: number;
  title: string;
  slug: string;
  content: string;
  summary: string;
  cover_image: string;
  category_id: number | null;
  category: CategoryBrief | null;
  tags: TagBrief[];
  status: "draft" | "published";
  author_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateArticleRequest {
  title: string;
  content: string;
  slug?: string;
  category_id: number | null;
  tags?: string[];
  status?: "draft" | "published";
  summary?: string;
  cover_image?: string;
}

export interface UpdateArticleRequest {
  title?: string;
  content?: string;
  slug?: string;
  category_id?: number | null;
  tags?: string[];
  status?: "draft" | "published";
  summary?: string;
  cover_image?: string;
}

export interface EditLock {
  holder_id: number;
  holder_name: string;
  acquired_at: string;
  expires_at: string;
}

export interface EditLockStatus {
  is_locked: boolean;
  holder_id: number | null;
  holder_name: string | null;
  acquired_at: string | null;
  expires_at: string | null;
}

export interface CategoryBrief {
  id: number;
  name: string;
  slug: string;
}

export interface TagBrief {
  id: number;
  name: string;
  slug: string;
}
