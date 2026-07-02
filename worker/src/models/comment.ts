export interface Comment {
  id: number;
  article_id: number;
  nickname: string;
  content: string;
  status: 'pending' | 'approved' | 'rejected';
  ip_hash: string;
  created_at: string;
}

export interface SubmitCommentRequest {
  nickname: string;
  content: string;
}

export interface CommentListItem {
  id: number;
  article_id: number;
  article_title: string;
  nickname: string;
  content: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}