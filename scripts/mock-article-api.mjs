/**
 * 本地 mock Worker API（#41 文章 SSR 回归 + #68 编辑器有状态回归）。
 *
 * 用法（由 scripts/verify-article-ssr.mjs / verify-article-editor.mjs 自动拉起，
 * 也可单独启动）：
 *   node scripts/mock-article-api.mjs --port 4322
 *
 * 单一进程同时提供两组端点：
 *   - #41 SSR：GET /api/v1/articles/ssr-regression → 200、missing-fixture → 404、
 *     boom-fixture → 500（页面映射 502）、GET /api/v1/config → 站点标题；
 *   - #68 编辑器：登录 / 列表 / 编辑详情 / 保存 / 编辑锁三端点 / 上传 /
 *     公开文章读取。保存与公开读取共用同一份内存数据，因此
 *     `PUT` 后的 Markdown 会立刻出现在文章页 SSR HTML 里。
 *
 * mock 自有运维端点：`GET /health`、`GET /__stats`、`POST /__control`
 * （注入加载 / 保存 / 锁故障）、`POST /__reset`（恢复初始状态）。
 *
 * 不访问真实 Worker，也不访问外网。浏览器侧请求由回归脚本用
 * `page.route()` 转发到本进程；SSR 取数由 dev-only ARTICLE_API_ORIGIN 直连。
 */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  API_PATHS,
  ARTICLE,
  DEFAULT_MOCK_PORT,
  ERROR_SLUG,
  MISSING_SLUG,
  MOCK_PATHS,
  PLACEHOLDER_PNG,
  SITE_TITLE,
  VIEW_COOKIE,
} from "./article-ssr-fixture.mjs";
import { createAdminApiState } from "./mock-admin-api.mjs";

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
    // 回归脚本也可能让浏览器直连 mock；同源代理转发路径不受影响。
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    ...extraHeaders,
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return { json: {}, raw: Buffer.alloc(0) };
  const raw = Buffer.concat(chunks);
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("application/json")) {
    try {
      return { json: JSON.parse(raw.toString("utf8")), raw };
    } catch {
      return { json: {}, raw };
    }
  }
  // multipart 上传：只需从 Content-Disposition 里取原始文件名，不落盘。
  const filename = raw.toString("utf8").match(/filename="([^"]+)"/)?.[1];
  return { json: { original_name: filename || "photo.png" }, raw };
}

export function createMockServer() {
  // 回归脚本用命中次数证明 dev server 确实把文章 SSR 取数指向了本 mock，
  // 而不是误连真实 Worker 后让断言以 502 / 超时形式失败。
  let articleRequests = 0;
  const admin = createAdminApiState();

  return createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;
    const method = req.method || "GET";

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      });
      res.end();
      return;
    }

    if (method === "GET" && pathname === MOCK_PATHS.health) {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }

    if (method === "GET" && pathname === MOCK_PATHS.stats) {
      sendJson(res, 200, { articleRequests, ...admin.stats() });
      return;
    }

    if (
      method === "POST" &&
      (pathname === MOCK_PATHS.control || pathname === MOCK_PATHS.reset)
    ) {
      const { json } = await readBody(req);
      if (pathname === MOCK_PATHS.reset) admin.reset();
      else admin.control(json);
      sendJson(res, 200, { ok: true, flags: admin.stats().flags });
      return;
    }

    // #41 的两条服务端契约保持原样：SSR 站点标题与公开设置投影。
    if (method === "GET" && pathname === API_PATHS.config) {
      sendJson(res, 200, {
        code: 0,
        message: "ok",
        data: { site_title: SITE_TITLE },
      });
      return;
    }
    if (method === "GET" && pathname === API_PATHS.settingsPublic) {
      sendJson(res, 200, { code: 0, message: "ok", data: {} });
      return;
    }

    // 上传接口返回的图片地址：编辑器会真的去加载它，缺响应会污染控制台。
    if (method === "GET" && pathname.startsWith("/api/v1/media/serve/")) {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": PLACEHOLDER_PNG.length,
        "Access-Control-Allow-Origin": "*",
      });
      res.end(PLACEHOLDER_PNG);
      return;
    }

    // 文章类请求的命中计数覆盖 SSR 与 admin 两侧；#41 的预检只读这个字段。
    if (method === "GET" && pathname.startsWith("/api/v1/articles")) {
      articleRequests += 1;
    }

    const { json } = await readBody(req);
    const adminResponse = admin.handle(method, url.pathname + url.search, json);
    if (adminResponse) {
      sendJson(res, adminResponse.status, adminResponse.body);
      return;
    }

    // #41 的 SSR 回归分支：只处理公开 slug 读取，其余 404。
    if (method === "GET" && pathname.startsWith(API_PATHS.articles)) {
      const slug = decodeURIComponent(
        pathname.slice(API_PATHS.articles.length)
      );
      if (slug === ARTICLE.slug) {
        sendJson(
          res,
          200,
          { code: 0, message: "ok", data: ARTICLE },
          {
            // 模拟 Worker 的阅读量去重 Cookie（含 HttpOnly）：页面应逐字回传浏览器。
            "Set-Cookie": VIEW_COOKIE,
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

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
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
}
