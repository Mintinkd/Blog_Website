export interface Tag {
  id: number;
  name: string;
  slug: string;
  article_count: number;
  created_at: string;
}

export interface CreateTagRequest {
  name: string;
  slug: string;
}