export interface MediaAsset {
  id: number;
  filename: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  kv_key: string;
  storage_type: 'kv' | 'r2';
  alt_text: string;
  created_at: string;
}

export interface MediaUploadResult {
  id: number;
  url: string;
  kv_key: string;
  filename: string;
  original_name: string;
}