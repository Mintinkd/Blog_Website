import { Env } from '../index';
import { successResponse, error, ErrorCodes, notFound } from '../utils/response';
import { validate, isValidUrl } from '../utils/validator';

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function handleUploadMedia(request: Request, env: Env): Promise<Response> {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return error(ErrorCodes.PARAM_ERROR, 'No file provided');
  }

  if (file.size > MAX_FILE_SIZE) {
    return error(ErrorCodes.VALIDATION_FAILED, 'File size exceeds 10MB limit');
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return error(ErrorCodes.VALIDATION_FAILED, `File type ${file.type} is not allowed`);
  }

  const now = new Date();
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const ext = file.name.split('.').pop() || 'bin';
  const uuid = crypto.randomUUID();
  const kv_key = `media/${year}/${month}/${uuid}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  await env.MEDIA.put(kv_key, arrayBuffer, {
    metadata: { original_name: file.name, mime_type: file.type },
  });

  const result = await env.DB.prepare(`
    INSERT INTO media_assets (filename, original_name, mime_type, file_size, kv_key, storage_type, alt_text)
    VALUES (?, ?, ?, ?, ?, 'kv', ?)
  `).bind(`${uuid}.${ext}`, file.name, file.type, file.size, kv_key, '').run();

  const media_id = result.meta.last_row_id;
  const url = `/api/v1/media/serve/${kv_key}`;

  return successResponse({
    id: media_id,
    url,
    kv_key,
    filename: `${uuid}.${ext}`,
    original_name: file.name,
  }, 'File uploaded');
}

export async function handleListMedia(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const page_size = Math.min(50, Math.max(1, parseInt(url.searchParams.get('page_size') || '20', 10)));

  const media = await env.DB.prepare(`
    SELECT * FROM media_assets ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).bind(page_size, (page - 1) * page_size).all();

  const countResult = await env.DB.prepare('SELECT COUNT(*) as total FROM media_assets').first<{ total: number }>();

  return successResponse({
    items: media.results.map((m: Record<string, unknown>) => ({
      ...m,
      url: `/api/v1/media/serve/${m.kv_key}`,
    })),
    total: countResult?.total || 0,
    page,
    page_size,
  });
}

export async function handleDeleteMedia(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const { id } = params;

  const media = await env.DB.prepare('SELECT * FROM media_assets WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!media) return notFound('Media not found');

  await env.MEDIA.delete(media.kv_key as string);
  await env.DB.prepare('DELETE FROM media_assets WHERE id = ?').bind(id).run();

  return successResponse(null, 'Media deleted');
}