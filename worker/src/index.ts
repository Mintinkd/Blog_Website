import { router } from './router';

export interface Env {
  DB: D1Database;
  MEDIA: KVNamespace;
  VIEW_CACHE: KVNamespace;
  API_PREFIX: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const apiPrefix = env.API_PREFIX || '/api/v1';

    if (url.pathname.startsWith(apiPrefix)) {
      return router(request, env, ctx);
    }

    return new Response('Not Found', { status: 404 });
  },
};
