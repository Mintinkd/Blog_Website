import { router } from "./router";
import { runAnalyticsCleanup } from "./services/analytics_service";

export interface Env {
  DB: D1Database;
  MEDIA: KVNamespace;
  RATE_LIMIT: KVNamespace;

  EDIT_LOCK: KVNamespace;
  API_PREFIX: string;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const apiPrefix = env.API_PREFIX || "/api/v1";

    if (url.pathname.startsWith(apiPrefix)) {
      return router(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  },

  /** 每日 cron（worker/wrangler.jsonc triggers.crons）：阅读统计清理与心跳 */
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(runAnalyticsCleanup(env));
  },
};
