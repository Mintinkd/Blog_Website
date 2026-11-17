import { router } from "./router";
import { runAnalyticsCleanup } from "./services/analytics_service";

export interface Env {
  DB: D1Database;
  MEDIA: KVNamespace;
  RATE_LIMIT: KVNamespace;

  EDIT_LOCK: KVNamespace;
  API_PREFIX: string;
  /**
   * R2 媒体桶绑定（wrangler.jsonc r2_buckets）。
   * 可选：未绑定时媒体读写回退旧 KV 路径，保证本地开发与回滚可用。
   */
  MEDIA_BUCKET?: R2Bucket;
  /** 站点 origin（wrangler vars；用于需要绝对地址的服务端输出） */
  SITE_URL?: string;
  /** R2 S3 兼容接口变量（wrangler secret；供迁移脚本 / 外部工具使用） */
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_REGION?: string;
  R2_ENDPOINT?: string;
  /** #84 / H3：与 Pages 共享的访客 IP 签名密钥（wrangler secret）；未配置时 fail-closed 不采信 X-Real-IP */
  VISITOR_IP_SIGNING_SECRET?: string;
  /** #104 / L5：ip_hash 的服务端盐（wrangler secret）；未配置时点赞 / 评论 fail-closed */
  IP_HASH_SECRET?: string;
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
