import { Env } from '../index';
import { successResponse, error, ErrorCodes } from '../utils/response';
import { verifyToken } from '../middleware/auth';

async function getJwtSecret(env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM site_config WHERE key = 'jwt_secret'").first<{ value: string }>();
  if (!row || !row.value) {
    throw new Error('JWT secret not configured in site_config');
  }
  return row.value;
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const { username, password } = body;

  const adminUsername = await env.DB.prepare("SELECT value FROM site_config WHERE key = 'admin_username'").first<{ value: string }>();
  const adminPasswordHash = await env.DB.prepare("SELECT value FROM site_config WHERE key = 'admin_password_hash'").first<{ value: string }>();

  if (!adminUsername || !adminPasswordHash) {
    return error(ErrorCodes.SERVER_ERROR, 'Admin credentials not configured');
  }

  if (username !== adminUsername.value) {
    return error(ErrorCodes.UNAUTHORIZED, 'Invalid credentials');
  }

  const encoder = new TextEncoder();
  const passwordData = encoder.encode(String(password));
  const hashBuffer = await crypto.subtle.digest('SHA-256', passwordData);
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (hashHex !== adminPasswordHash.value) {
    return error(ErrorCodes.UNAUTHORIZED, 'Invalid credentials');
  }

  const jwtSecret = await getJwtSecret(env);
  const { generateToken } = await import('../middleware/auth');
  const token = await generateToken(String(username), jwtSecret);

  return successResponse({ token }, 'Login successful');
}

export async function handleRefresh(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return error(ErrorCodes.UNAUTHORIZED, 'Missing token');
  }

  const jwtSecret = await getJwtSecret(env);
  const oldToken = authHeader.slice(7);
  const payload = await verifyToken(oldToken, jwtSecret);
  if (!payload) {
    return error(ErrorCodes.UNAUTHORIZED, 'Invalid token');
  }

  const { generateToken } = await import('../middleware/auth');
  const newToken = await generateToken(payload.username, jwtSecret);

  return successResponse({ token: newToken }, 'Token refreshed');
}