/**
 * 口令哈希（审查报告 P1-4 / C1 修复）：
 * - 新格式：pbkdf2$sha256$<迭代数>$<盐hex>$<派生密钥hex>，自描述、可调参
 * - 旧格式（无盐单轮 SHA-256 hex）仅保留「校验兼容」，登录成功后由调用方透明升级
 */

const PBKDF2_SCHEME = "pbkdf2";
const PBKDF2_HASH = "sha256";
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT_BYTES = 16;
const DERIVED_KEY_BITS = 256;

/** 口令长度上限（#44）：登录 / 建号 / 改密共用，超限在进入 KDF 前拒绝 */
export const MAX_PASSWORD_LENGTH = 200;

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex))
    return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function derivePbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
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

/** 固定盐（#17 / #44）：旧格式校验补偿跑真实迭代数；未知账号假验证只做固定低量哑运算。不参与任何真实凭据的存储与校验 */
const COST_FILLER_SALT = new Uint8Array(PBKDF2_SALT_BYTES);

/**
 * 假验证固定迭代数（#44）：与真实哈希的 PBKDF2_ITERATIONS、以及存储声明的迭代数解耦。
 * 匿名「未知用户名」请求只消耗固定低量 CPU，不得改回跟随配置，否则可被放大为 CPU DoS。
 */
const FAKE_VERIFY_ITERATIONS = 1_000;

export async function verifyPassword(
  password: string,
  stored: string
): Promise<PasswordVerifyResult> {
  if (stored.startsWith(`${PBKDF2_SCHEME}$`)) {
    const parts = stored.split("$");
    if (
      parts.length !== 5 ||
      parts[0] !== PBKDF2_SCHEME ||
      parts[1] !== PBKDF2_HASH
    ) {
      return { ok: false, needsUpgrade: false };
    }
    const iterations = Number(parts[2]);
    const salt = fromHex(parts[3]);
    if (!Number.isInteger(iterations) || iterations <= 0 || !salt) {
      return { ok: false, needsUpgrade: false };
    }
    const derived = await derivePbkdf2(password, salt, iterations);
    return {
      ok: timingSafeEqual(toHex(derived), parts[4].toLowerCase()),
      needsUpgrade: false,
    };
  }

  // 旧格式兼容：无盐单轮 SHA-256，仅用于校验存量哈希，不再写入
  const legacy = toHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(password))
    )
  );
  const ok = timingSafeEqual(legacy, stored.toLowerCase());
  // #17：旧格式校验远快于 PBKDF2——补一次同代价派生，失败耗时不得明显快于新格式（账号存在性耗时不可区分）
  await derivePbkdf2(password, COST_FILLER_SALT, PBKDF2_ITERATIONS);
  return { ok, needsUpgrade: ok };
}

/**
 * 假验证（#17 / #44）：对不存在的账号执行固定低量 CPU 的 PBKDF2 哑运算（1000 次），
 * 抹平「账号是否存在」的部分响应耗时差，同时不让匿名请求按真实 KDF 成本放大。
 * 结果不参与任何判定，直接丢弃。
 */
export async function fakeVerifyPassword(password: string): Promise<void> {
  await derivePbkdf2(password, COST_FILLER_SALT, FAKE_VERIFY_ITERATIONS);
}
