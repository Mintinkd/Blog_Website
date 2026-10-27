import { Env } from "../index";
import { unauthorized, forbidden } from "../utils/response";
import { isMissingColumnError } from "../utils/d1_compat";

export interface AuthResult {
  username: string;
  role: "admin" | "editor";
  /** 账号仍在使用初始/默认口令（P1-5 / issue #8），未改密前管理端写操作被拒 */
  mustChangePassword: boolean;
}

interface JwtPayload {
  username: string;
  exp: number;
  iat: number;
}

async function hashKey(key: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  return await crypto.subtle.digest("SHA-256", data);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return atob(str);
}

export async function generateToken(
  username: string,
  secret: string,
  expiresInHours = 24
): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({
      username,
      iat: now,
      exp: now + expiresInHours * 3600,
    })
  );

  const key = await crypto.subtle.importKey(
    "raw",
    await hashKey(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  const signatureB64 = arrayBufferToBase64(signature)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${header}.${payload}.${signatureB64}`;
}

export async function verifyToken(
  token: string,
  secret: string
): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      await hashKey(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signatureBytes = Uint8Array.from(base64UrlDecode(signature), (c) =>
      c.charCodeAt(0)
    );
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(`${header}.${payload}`)
    );

    if (!isValid) return null;

    const decoded = JSON.parse(base64UrlDecode(payload)) as JwtPayload;
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    // 畸形 token（非法 base64/JSON 等）一律按无效处理，避免向上抛出 500
    return null;
  }
}

/** P1-5 / issue #8：鉴权时一并取回「须改密」标记，供路由层拦截管理写操作 */
async function getUserAuth(
  username: string,
  env: Env
): Promise<{ role: string; mustChangePassword: boolean } | null> {
  try {
    const row = await env.DB.prepare(
      "SELECT role, must_change_password FROM users WHERE username = ?"
    )
      .bind(username)
      .first<{ role: string; must_change_password: number }>();
    if (!row) return null;
    return {
      role: row.role,
      mustChangePassword: Boolean(row.must_change_password),
    };
  } catch (e) {
    // P1 复审 Spec(c)2 / #16：仅「列不存在」（迁移前）允许回退旧列；其余异常一律向上抛（fail-closed，不得静默关闭门禁）
    if (!isMissingColumnError(e)) throw e;
  }
  // 新增列尚未迁移时降级为旧列（须改密强制仅在迁移后生效）
  const row = await env.DB.prepare("SELECT role FROM users WHERE username = ?")
    .bind(username)
    .first<{ role: string }>();
  if (!row) return null;
  return { role: row.role, mustChangePassword: false };
}

/** Generate a strong random JWT secret (64-character base64url string) */
function generateJwtSecret(): string {
  const array = new Uint8Array(48); // 48 bytes = 384 bits (strong enough for HS256)
  crypto.getRandomValues(array);
  return base64UrlEncode(
    Array.from(array, (byte) => String.fromCharCode(byte)).join("")
  );
}

export async function authMiddleware(
  request: Request,
  env: Env
): Promise<{ user: AuthResult } | Response> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return unauthorized("Missing or invalid authorization header");
  }

  const token = authHeader.slice(7);
  const jwtSecret = await getJwtSecretFromDb(env);
  const payload = await verifyToken(token, jwtSecret);
  if (!payload) {
    return unauthorized("Invalid or expired token");
  }

  const auth = await getUserAuth(payload.username, env);
  if (!auth) {
    return forbidden("User role not found");
  }

  return {
    user: {
      username: payload.username,
      role: auth.role as "admin" | "editor",
      mustChangePassword: auth.mustChangePassword,
    },
  };
}

async function getJwtSecretFromDb(env: Env): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT value FROM site_config WHERE key = 'jwt_secret'"
  ).first<{ value: string }>();
  if (!row || !row.value) {
    // Auto-generate a strong random JWT secret (self-healing)
    const secret = generateJwtSecret();
    // Persist it to the database
    await env.DB.prepare(
      "INSERT OR REPLACE INTO site_config (key, value, is_public, updated_at) VALUES ('jwt_secret', ?, 0, datetime('now'))"
    )
      .bind(secret)
      .run();
    console.error(
      "JWT secret not configured; auto-generated and persisted:",
      secret
    );
    return secret;
  }
  return row.value;
}
