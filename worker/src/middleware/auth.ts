import { Env } from '../index';
import { unauthorized, ErrorCodes, error } from '../utils/response';

interface JwtPayload {
  username: string;
  exp: number;
  iat: number;
}

async function hashKey(key: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  return await crypto.subtle.digest('SHA-256', data);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

export async function generateToken(username: string, secret: string, expiresInHours = 24): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(JSON.stringify({
    username,
    iat: now,
    exp: now + expiresInHours * 3600,
  }));

  const key = await crypto.subtle.importKey(
    'raw',
    await hashKey(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`));
  const signatureB64 = arrayBufferToBase64(signature).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return `${header}.${payload}.${signatureB64}`;
}

export async function verifyToken(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;

  const key = await crypto.subtle.importKey(
    'raw',
    await hashKey(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signatureBytes = Uint8Array.from(base64UrlDecode(signature), (c) => c.charCodeAt(0));
  const isValid = await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    new TextEncoder().encode(`${header}.${payload}`)
  );

  if (!isValid) return null;

  try {
    const decoded = JSON.parse(base64UrlDecode(payload)) as JwtPayload;
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function authMiddleware(request: Request, env: Env): Promise<Response | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return unauthorized('Missing or invalid authorization header');
  }

  const token = authHeader.slice(7);
  const payload = await verifyToken(token, env.jwt_secret);
  if (!payload) {
    return unauthorized('Invalid or expired token');
  }

  return null;
}