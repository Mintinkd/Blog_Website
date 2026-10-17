/**
 * 口令哈希（审查报告 P1-4 / C1 修复）：
 * - 新格式：pbkdf2$sha256$<迭代数>$<盐hex>$<派生密钥hex>，自描述、可调参
 * - 旧格式（无盐单轮 SHA-256 hex）仅保留「校验兼容」，登录成功后由调用方透明升级
 */

const PBKDF2_SCHEME = 'pbkdf2';
const PBKDF2_HASH = 'sha256';
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT_BYTES = 16;
const DERIVED_KEY_BITS = 256;

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function derivePbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial,
    DERIVED_KEY_BITS
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const derived = await derivePbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `${PBKDF2_SCHEME}$${PBKDF2_HASH}$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(derived)}`;
}

export interface PasswordVerifyResult {
  ok: boolean;
  /** 校验通过且存储为旧格式（无盐 SHA-256），调用方应用 hashPassword 重写存储完成升级 */
  needsUpgrade: boolean;
}

export async function verifyPassword(password: string, stored: string): Promise<PasswordVerifyResult> {
  if (stored.startsWith(`${PBKDF2_SCHEME}$`)) {
    const parts = stored.split('$');
    if (parts.length !== 5 || parts[0] !== PBKDF2_SCHEME || parts[1] !== PBKDF2_HASH) {
      return { ok: false, needsUpgrade: false };
    }
    const iterations = Number(parts[2]);
    const salt = fromHex(parts[3]);
    if (!Number.isInteger(iterations) || iterations <= 0 || !salt) {
      return { ok: false, needsUpgrade: false };
    }
    const derived = await derivePbkdf2(password, salt, iterations);
    return { ok: timingSafeEqual(toHex(derived), parts[4].toLowerCase()), needsUpgrade: false };
  }

  // 旧格式兼容：无盐单轮 SHA-256，仅用于校验存量哈希，不再写入
  const legacy = toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(password))));
  const ok = timingSafeEqual(legacy, stored.toLowerCase());
  return { ok, needsUpgrade: ok };
}
