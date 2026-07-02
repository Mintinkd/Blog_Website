import { Env } from '../index';
import { successResponse, error, ErrorCodes } from '../utils/response';
import { verifyToken } from '../middleware/auth';

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

  const { generateToken } = await import('../middleware/auth');
  const token = await generateToken(String(username), env.jwt_secret);

  return successResponse({ token }, 'Login successful');
}

export async function handleRefresh(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return error(ErrorCodes.UNAUTHORIZED, 'Missing token');
  }

  const oldToken = authHeader.slice(7);
  const payload = await verifyToken(oldToken, env.jwt_secret);
  if (!payload) {
    return error(ErrorCodes.UNAUTHORIZED, 'Invalid token');
  }

  const { generateToken } = await import('../middleware/auth');
  const newToken = await generateToken(payload.username, env.jwt_secret);

  return successResponse({ token: newToken }, 'Token refreshed');
}