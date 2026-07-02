import { Env } from '../index';
import { successResponse, error, ErrorCodes } from '../utils/response';

export async function handleExport(request: Request, env: Env): Promise<Response> {
  const tables = ['categories', 'tags', 'articles', 'article_tags', 'comments', 'article_likes', 'media_assets', 'friend_links', 'site_config'];
  const export_data: Record<string, unknown[]> = {};

  for (const table of tables) {
    const result = await env.DB.prepare(`SELECT * FROM ${table}`).all();
    export_data[table] = result.results as unknown[];
  }

  return new Response(JSON.stringify({ export_data, exported_at: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename=blog-export.json' },
  });
}

export async function handleImport(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { export_data?: Record<string, unknown[]> };

    if (!body.export_data) {
      return error(ErrorCodes.PARAM_ERROR, 'Invalid import data format');
    }

    const tables = ['site_config', 'categories', 'tags', 'articles', 'article_tags', 'comments', 'article_likes', 'media_assets', 'friend_links'];

    for (const table of tables) {
      const rows = body.export_data[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      await env.DB.prepare(`DELETE FROM ${table}`).run();

      for (const row of rows) {
        const columns = Object.keys(row);
        const values = Object.values(row);
        const placeholders = columns.map(() => '?').join(', ');
        await env.DB.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).bind(...values).run();
      }
    }

    return successResponse(null, 'Data imported successfully');
  } catch (e) {
    return error(ErrorCodes.SERVER_ERROR, 'Import failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
  }
}