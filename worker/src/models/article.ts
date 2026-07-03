export interface Article {
  id: number;
  title: string;
  slug: string;
  content: string;
  content_html: string;
  summary: string;
  cover_image: string;
  category_id: number | null;
  status: 'draft' | 'published';
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
  status: 'draft' | 'published';
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at: string | null;
  created_at: string;
}

export interface ArticleDetail extends ArticleListItem {
  content: string;
  content_html: string;
}

export interface CreateArticleRequest {
  title: string;
  content: string;
  category_id: number | null;
  tags?: string[];
  status?: 'draft' | 'published';
  summary?: string;
  cover_image?: string;
}

export interface UpdateArticleRequest {
  title?: string;
  content?: string;
  category_id?: number | null;
  tags?: string[];
  status?: 'draft' | 'published';
  summary?: string;
  cover_image?: string;
}

interface CategoryBrief {
  id: number;
  name: string;
  slug: string;
}

interface TagBrief {
  id: number;
  name: string;
  slug: string;
}