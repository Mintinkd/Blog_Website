export interface FriendLink {
  id: number;
  name: string;
  url: string;
  description: string;
  logo_url: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateFriendLinkRequest {
  name: string;
  url: string;
  description?: string;
  logo_url?: string;
  sort_order?: number;
  is_active?: boolean;
}

export interface UpdateFriendLinkRequest {
  name?: string;
  url?: string;
  description?: string;
  logo_url?: string;
  sort_order?: number;
  is_active?: boolean;
}