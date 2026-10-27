import { Env } from "../index";
import {
  successResponse,
  error,
  ErrorCodes,
  notFound,
  forbidden,
  unauthorized,
} from "../utils/response";
import type { AuthResult } from "../middleware/auth";

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
];

/** P1-8 / issue #13：扩展名白名单（与 MIME 一一对应，上传时双向校验） */
const ALLOWED_EXTENSIONS: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "image/svg+xml": ["svg"],
  "application/pdf": ["pdf"],
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** 读取字节区间为 ASCII 字符串（用于魔数比较） */
function ascii(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end && i < bytes.length; i++)
    s += String.fromCharCode(bytes[i]);
  return s;
}

/**
 * P1-8 / issue #13：魔数嗅探 —— 不再信任客户端自报 MIME。
 * 返回白名单内的实际类型；无法识别时返回 null（调用方一律拒绝）。
 */
function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
    return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return "image/jpeg";
  if (
    b.length >= 6 &&
    (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")
  )
    return "image/gif";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP")
    return "image/webp";
  if (b.length >= 5 && ascii(b, 0, 5) === "%PDF-") return "application/pdf";
  // SVG 为文本格式：容许 BOM/前导空白，须以 <svg / <?xml（随后出现 <svg）/ <!doctype svg 开头
  const head = new TextDecoder("utf-8")
    .decode(b.slice(0, 1024))
    .replace(/^\uFEFF/, "")
    .trimStart()
    .toLowerCase();
  if (head.startsWith("<svg")) return "image/svg+xml";
  if (
    head.startsWith("<?xml") &&
    head.indexOf("<svg") >= 0 &&
    head.indexOf("<svg") < 512
  )
    return "image/svg+xml";
  if (head.startsWith("<!doctype svg")) return "image/svg+xml";
  return null;
}

/** Content-Disposition 文件名安全化（防响应头注入；非 ASCII 走 RFC 5987 filename*） */
function contentDisposition(filename: string): string {
  const fallback =
    filename
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\\/\r\n]/g, "_")
      .slice(0, 100) || "file";
  const encoded = encodeURIComponent(filename)
    .replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .slice(0, 300);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function handleUploadMedia(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
  authResult?: AuthResult
): Promise<Response> {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return error(ErrorCodes.PARAM_ERROR, "No file provided");
  }

  if (file.size > MAX_FILE_SIZE) {
    return error(ErrorCodes.VALIDATION_FAILED, "File size exceeds 10MB limit");
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return error(
      ErrorCodes.VALIDATION_FAILED,
      `File type ${file.type} is not allowed`
    );
  }

  // P1-8 / issue #13：扩展名白名单 + 魔数校验（客户端自报 MIME 不可信）
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const allowedExts = ALLOWED_EXTENSIONS[file.type] || [];
  if (!allowedExts.includes(ext)) {
    return error(
      ErrorCodes.VALIDATION_FAILED,
      `文件扩展名 .${ext || "(无)"} 与类型 ${file.type} 不匹配（允许：${allowedExts.join("/") || "无"}）`
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const sniffed = sniffMime(new Uint8Array(arrayBuffer));
  if (sniffed !== file.type) {
    return error(
      ErrorCodes.VALIDATION_FAILED,
      `文件内容与声明类型不符（声明 ${file.type}，内容识别为 ${sniffed || "未知"}），已拒绝`
    );
  }

  const now = new Date();
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const uuid = crypto.randomUUID();
  const kv_key = `media/${year}/${month}/${uuid}.${ext}`;

  await env.MEDIA.put(kv_key, arrayBuffer, {
    metadata: { original_name: file.name, mime_type: file.type },
  });

  let uploaded_by: number | null = null;
  if (authResult) {
    const user = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
      .bind(authResult.username)
      .first<{ id: number }>();
    uploaded_by = user?.id || null;
  }

  const result = await env.DB.prepare(
    `
    INSERT INTO media_assets (filename, original_name, mime_type, file_size, kv_key, storage_type, alt_text, uploaded_by)
    VALUES (?, ?, ?, ?, ?, 'kv', ?, ?)
  `
  )
    .bind(
      `${uuid}.${ext}`,
      file.name,
      file.type,
      file.size,
      kv_key,
      "",
      uploaded_by
    )
    .run();

  const media_id = result.meta.last_row_id;
  const url = `/api/v1/media/serve/${kv_key}`;

  return successResponse(
    {
      id: media_id,
      url,
      kv_key,
      filename: `${uuid}.${ext}`,
      original_name: file.name,
    },
    "File uploaded"
  );
}

export async function handleListMedia(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
  authResult?: AuthResult
): Promise<Response> {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const page_size = Math.min(
    50,
    Math.max(1, parseInt(url.searchParams.get("page_size") || "20", 10))
  );

  let whereClause = "";
  const queryParams: unknown[] = [];

  if (authResult && authResult.role === "editor") {
    const user = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
      .bind(authResult.username)
      .first<{ id: number }>();
    if (user) {
      whereClause = "WHERE uploaded_by = ?";
      queryParams.push(user.id);
    } else {
      // 审查报告 H2 修复：用户无法解析时 fail-closed，不再回退为「不过滤」
      whereClause = "WHERE 1 = 0";
    }
  }

  const media = await env.DB.prepare(
    `
    SELECT * FROM media_assets ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `
  )
    .bind(...queryParams, page_size, (page - 1) * page_size)
    .all();

  const countResult = await env.DB.prepare(
    `SELECT COUNT(*) as total FROM media_assets ${whereClause}`
  )
    .bind(...queryParams)
    .first<{ total: number }>();

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

/** 审查报告 H2 修复：媒体删除须为管理员或上传者本人；越权时 KV 对象与元数据均保持不动 */
export async function handleDeleteMedia(
  request: Request,
  env: Env,
  params: Record<string, string>,
  authResult?: AuthResult
): Promise<Response> {
  const { id } = params;

  if (!authResult) return unauthorized("Authentication required");

  const media = await env.DB.prepare(
    "SELECT kv_key, uploaded_by FROM media_assets WHERE id = ?"
  )
    .bind(id)
    .first<{ kv_key: string; uploaded_by: number | null }>();
  if (!media) return notFound("Media not found");

  if (authResult.role !== "admin") {
    const user = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
      .bind(authResult.username)
      .first<{ id: number }>();
    if (!user || media.uploaded_by !== user.id)
      return forbidden("仅可删除自己上传的媒体");
  }

  await env.MEDIA.delete(media.kv_key);
  await env.DB.prepare("DELETE FROM media_assets WHERE id = ?").bind(id).run();

  return successResponse(null, "Media deleted");
}

export async function handleServeMedia(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  const key = params["0"] || params.key || "";
  if (!key) return notFound("Media not found");

  const value = await env.MEDIA.get(key, { type: "arrayBuffer" });
  if (!value) return notFound("Media not found");

  const metadata = await env.MEDIA.getWithMetadata(key);
  const meta = metadata.metadata as {
    mime_type?: string;
    original_name?: string;
  } | null;

  // P1-8 / issue #13：防止「直接打开媒体链接」获得同源脚本执行能力 ——
  // 判定结果非白名单时不给可渲染类型；<img> 等子资源请求按浏览器规则会
  // 忽略 Content-Disposition，站内内嵌引用不受影响。
  // issue #20：存量资产回退 —— 白名单判定落空（元数据缺失 / 历史非白名单类型）时，
  // 对已取回的字节按上传侧同一套魔数嗅探规则识别；命中白名单则以其真实 MIME 返回
  // （处置策略不变：attachment + nosniff），仍无法识别则维持 octet-stream 强制下载。
  const rawMime = meta?.mime_type || guessMimeType(key);
  // 白名单命中路径不嗅探，行为与开销不变。
  const mimeType = ALLOWED_MIME_TYPES.includes(rawMime)
    ? rawMime
    : sniffMime(new Uint8Array(value)) || "application/octet-stream";
  const filename = meta?.original_name || key.split("/").pop() || "file";

  const headers = new Headers({
    "Content-Type": mimeType,
    "Content-Disposition": contentDisposition(filename),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=31536000, immutable",
  });

  return new Response(value, { headers });
}

function guessMimeType(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
  };
  return map[ext] || "application/octet-stream";
}
