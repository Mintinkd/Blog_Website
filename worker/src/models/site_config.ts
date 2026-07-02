export interface SiteConfig {
  key: string;
  value: string;
  is_public: boolean;
  updated_at: string;
}

export interface PublicConfig {
  [key: string]: string;
}