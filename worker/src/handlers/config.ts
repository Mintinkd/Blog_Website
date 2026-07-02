import { Env } from '../index';
import { successResponse } from '../utils/response';

export async function handleGetPublicConfig(request: Request, env: Env): Promise<Response> {
  const configs = await env.DB.prepare('SELECT key, value FROM site_config WHERE is_public = 1').all();

  const public_config: Record<string, string> = {};
  for (const row of configs.results) {
    public_config[row.key as string] = row.value as string;
  }

  return successResponse(public_config);
}

export async function handleGetAllConfig(request: Request, env: Env): Promise<Response> {
  const configs = await env.DB.prepare('SELECT key, value, is_public, updated_at FROM site_config').all();
  return successResponse(configs.results);
}

export async function handleUpdateConfig(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as Record<string, string>;

  for (const [key, value] of Object.entries(body)) {
    await env.DB.prepare('UPDATE site_config SET value = ?, updated_at = ? WHERE key = ?').bind(value, new Date().toISOString(), key).run();
  }

  return successResponse(null, 'Configuration updated');
}