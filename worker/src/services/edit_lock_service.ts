import { Env } from '../index';
import { EditLock, EditLockStatus } from '../models/article';
import type { AuthResult } from '../middleware/auth';

const LOCK_TTL = 1800;

async function getUserIdByUsername(env: Env, username: string): Promise<number | null> {
  const row = await env.DB.prepare('SELECT id, display_name FROM users WHERE username = ?').bind(username).first<{ id: number; display_name: string }>();
  return row?.id || null;
}

async function getUserInfoByUsername(env: Env, username: string): Promise<{ id: number; display_name: string } | null> {
  const row = await env.DB.prepare('SELECT id, display_name FROM users WHERE username = ?').bind(username).first<{ id: number; display_name: string }>();
  return row ? { id: row.id, display_name: row.display_name } : null;
}

export async function acquireLock(env: Env, articleId: number, authResult: AuthResult): Promise<{ success: boolean; lock?: EditLock; conflict?: EditLockStatus }> {
  const key = `edit_lock:${articleId}`;
  const userInfo = await getUserInfoByUsername(env, authResult.username);
  if (!userInfo) return { success: false };

  const existing = await env.EDIT_LOCK.get(key);
  if (existing) {
    const lock: EditLock = JSON.parse(existing);

    // 同一用户已持有锁 → 直接放行并续期，避免自己锁自己
    if (lock.holder_id === userInfo.id) {
      const now = new Date();
      const expires = new Date(now.getTime() + LOCK_TTL * 1000);
      const renewedLock: EditLock = {
        holder_id: lock.holder_id,
        holder_name: lock.holder_name,
        acquired_at: lock.acquired_at,
        expires_at: expires.toISOString(),
      };
      await env.EDIT_LOCK.put(key, JSON.stringify(renewedLock), { expirationTtl: LOCK_TTL });
      return { success: true, lock: renewedLock };
    }

    // 他人持有锁 → 返回冲突
    const status: EditLockStatus = {
      is_locked: true,
      holder_id: lock.holder_id,
      holder_name: lock.holder_name,
      acquired_at: lock.acquired_at,
      expires_at: lock.expires_at,
    };
    return { success: false, conflict: status };
  }

  const now = new Date();
  const expires = new Date(now.getTime() + LOCK_TTL * 1000);
  const lock: EditLock = {
    holder_id: userInfo.id,
    holder_name: userInfo.display_name || authResult.username,
    acquired_at: now.toISOString(),
    expires_at: expires.toISOString(),
  };

  await env.EDIT_LOCK.put(key, JSON.stringify(lock), { expirationTtl: LOCK_TTL });
  return { success: true, lock };
}

export async function releaseLock(env: Env, articleId: number, authResult: AuthResult): Promise<{ success: boolean; forbidden?: boolean }> {
  const key = `edit_lock:${articleId}`;
  const existing = await env.EDIT_LOCK.get(key);

  if (!existing) return { success: true };

  const lock: EditLock = JSON.parse(existing);
  const userId = await getUserIdByUsername(env, authResult.username);

  if (authResult.role !== 'admin' && lock.holder_id !== userId) {
    return { success: false, forbidden: true };
  }

  await env.EDIT_LOCK.delete(key);
  return { success: true };
}

export async function getLockStatus(env: Env, articleId: number): Promise<EditLockStatus> {
  const key = `edit_lock:${articleId}`;
  const existing = await env.EDIT_LOCK.get(key);

  if (!existing) {
    return { is_locked: false, holder_id: null, holder_name: null, acquired_at: null, expires_at: null };
  }

  const lock: EditLock = JSON.parse(existing);
  return {
    is_locked: true,
    holder_id: lock.holder_id,
    holder_name: lock.holder_name,
    acquired_at: lock.acquired_at,
    expires_at: lock.expires_at,
  };
}

export async function forceReleaseLock(env: Env, articleId: number, authResult: AuthResult): Promise<{ success: boolean; previous_holder?: string }> {
  const key = `edit_lock:${articleId}`;
  const existing = await env.EDIT_LOCK.get(key);
  let previous_holder: string | undefined;

  if (existing) {
    const lock: EditLock = JSON.parse(existing);
    previous_holder = lock.holder_name;
    await env.EDIT_LOCK.delete(key);
  }

  const result = await acquireLock(env, articleId, authResult);
  return { success: result.success, previous_holder };
}