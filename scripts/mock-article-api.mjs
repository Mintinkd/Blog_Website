/**
 * #41 文章 SSR 回归用的本地 mock Worker API。
 *
 * 用法（由 scripts/verify-article-ssr.mjs 自动拉起，也可单独启动）：
 *   node scripts/mock-article-api.mjs --port 4322
 *
 * 只提供文章页 SSR 需要的最小接口：
 *   GET /api/v1/articles/ssr-regression → 200 已发布文章
 *   GET /api/v1/articles/missing-fixture → 404
 *   GET /api/v1/articles/boom-fixture    → 500（页面应映射为 502）
 *   GET /api/v1/config                   → 200 站点标题
 *   GET /__stats                         → 文章取数命中次数（回归脚本预检用）
 *
 * 不访问真实 Worker，也不访问外网。
 */
import { createServer } from "node:http";
import {
  API_PATHS,
  ARTICLE,
  DEFAULT_MOCK_PORT,
  ERROR_SLUG,
  MISSING_SLUG,
  MOCK_PATHS,
  SITE_TITLE,
} from "./article-ssr-fixture.mjs";

function readPort() {
  const flagIndex = process.argv.indexOf("--port");
  const fromFlag = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;
  const raw = fromFlag || process.env.MOCK_PORT || String(DEFAULT_MOCK_PORT);
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`非法端口：${raw}`);
  }
  return port;
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function createMockServer() {
  // 回归脚本用命中次数证明 dev server 确实把文章 SSR 取数指向了本 mock，
  // 而不是误连真实 Worker 后让断言以 502 / 超时形式失败。
  let articleRequests = 0;

  return createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === MOCK_PATHS.health) {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }

    if (req.method === "GET" && url.pathname === MOCK_PATHS.stats) {
      sendJson(res, 200, { articleRequests });
      return;
    }

    if (req.method === "GET" && url.pathname === API_PATHS.config) {
      sendJson(res, 200, {
        code: 0,
        message: "ok",
        data: { site_title: SITE_TITLE },
      });
      return;
    }

    // BaseLayout 只在非 localhost 的 SSR 环境读取 settings/public；仍提供一份
    // 最小合法响应，方便用自定义 BASE 跑同一脚本。
    if (req.method === "GET" && url.pathname === API_PATHS.settingsPublic) {
      sendJson(res, 200, { code: 0, message: "ok", data: {} });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith(API_PATHS.articles)) {
      articleRequests += 1;
      const slug = decodeURIComponent(
        url.pathname.slice(API_PATHS.articles.length)
      );
      if (slug === ARTICLE.slug) {
        sendJson(
          res,
          200,
          { code: 0, message: "ok", data: ARTICLE },
          {
            // 模拟 Worker 的阅读量去重 Cookie：页面应原样回传浏览器。
            "Set-Cookie": "view_7=1; Path=/; Max-Age=86400; SameSite=Lax",
          }
        );
        return;
      }
      if (slug === MISSING_SLUG) {
        sendJson(res, 404, {
          code: 10005,
          message: "Article not found",
          data: null,
        });
        return;
      }
      if (slug === ERROR_SLUG) {
        sendJson(res, 500, { code: 10008, message: "boom", data: null });
        return;
      }
      sendJson(res, 404, {
        code: 10005,
        message: "Article not found",
        data: null,
      });
      return;
    }

    sendJson(res, 404, { code: 1404, message: "not found", data: null });
  });
}

const port = readPort();
const server = createMockServer();

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[mock-article-api] 端口 ${port} 已被占用。请换一个 MOCK_PORT，` +
        `并让 dev server 的 ARTICLE_API_ORIGIN 指向同一端口。`
    );
  } else {
    console.error("[mock-article-api] 启动失败：", err);
  }
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[mock-article-api] listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
