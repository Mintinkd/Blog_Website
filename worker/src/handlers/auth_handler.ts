import { Env } from '../index';
import { successResponse, error, ErrorCodes } from '../utils/response';
import { verifyToken, generateToken } from '../middleware/auth';

async function getJwtSecret(env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM site_config WHERE key = 'jwt_secret'").first<{ value: string }>();
  if (!row || !row.value) {
    throw new Error('JWT secret not configured in site_config');
  }
  return row.value;
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const { username, password } = body;

  if (!username || !password) {
    return error(ErrorCodes.VALIDATION_FAILED, 'Username and password are required');
  }

  const user = await env.DB.prepare('SELECT id, username, password_hash, display_name, role FROM users WHERE username = ?').bind(String(username)).first<{ id: number; username: string; password_hash: string; display_name: string; role: string }>();

  if (!user) {
    return error(ErrorCodes.UNAUTHORIZED, 'Invalid credentials');
  }

  const hashHex = await hashPassword(String(password));
  if (hashHex !== user.password_hash) {
    return error(ErrorCodes.UNAUTHORIZED, 'Invalid credentials');
  }

  const jwtSecret = await getJwtSecret(env);
  const token = await generateToken(user.username, jwtSecret);

  return successResponse({
    token,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
    },
  }, 'Login successful');
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

  const newToken = await generateToken(payload.username, jwtSecret);
  return successResponse({ token: newToken }, 'Token refreshed');
}

export async function handleListUsers(request: Request, env: Env): Promise<Response> {
  const users = await env.DB.prepare('SELECT id, username, display_name, role, created_at FROM users').all();
  return successResponse(users.results);
}

export async function handleCreateUser(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const { username, password, display_name, role } = body;

  if (!username || !password) {
    return error(ErrorCodes.VALIDATION_FAILED, 'Username and password are required');
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(String(username)).first();
  if (existing) {
    return error(ErrorCodes.VALIDATION_FAILED, 'Username already exists');
  }

  const passwordHash = await hashPassword(String(password));
  const displayName = display_name ? String(display_name) : String(username);
  const userRole = role === 'editor' ? 'editor' : 'admin';

  const result = await env.DB.prepare(
    'INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)'
  ).bind(String(username), passwordHash, displayName, userRole).run();

  return successResponse({
    id: result.meta.last_row_id,
    username: String(username),
    display_name: displayName,
    role: userRole,
  }, 'User created');
}

export async function handleUpdateUser(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const { id } = params;
  const body = await request.json() as Record<string, unknown>;

  const existing = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(Number(id)).first();
  if (!existing) {
    return error(ErrorCodes.NOT_FOUND, 'User not found');
  }

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.display_name !== undefined) {
    sets.push('display_name = ?');
    values.push(String(body.display_name));
  }

  if (body.role !== undefined) {
    sets.push('role = ?');
    values.push(body.role === 'editor' ? 'editor' : 'admin');
  }

  if (body.password) {
    const passwordHash = await hashPassword(String(body.password));
    sets.push('password_hash = ?');
    values.push(passwordHash);
  }

  if (sets.length === 0) {
    return error(ErrorCodes.VALIDATION_FAILED, 'No fields to update');
  }

  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(Number(id));

  await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();

  return successResponse(null, 'User updated');
}

export async function handleDeleteUser(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const { id } = params;

  const countResult = await env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  if (countResult && countResult.count <= 1) {
    return error(ErrorCodes.VALIDATION_FAILED, 'Cannot delete the last user');
  }

  const result = await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(Number(id)).run();
  if (result.meta.changes === 0) {
    return error(ErrorCodes.NOT_FOUND, 'User not found');
  }

  return successResponse(null, 'User deleted');
}
