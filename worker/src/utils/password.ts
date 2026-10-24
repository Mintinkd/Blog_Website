/**
 * 口令哈希与输入口径（审查报告 P1-4 / C1、C4 / #44）：
 * - 新格式：pbkdf2$sha256$<迭代数>$<盐hex>$<派生密钥hex>，自描述、可调参
 * - 旧格式（无盐单轮 SHA-256 hex）仅保留「校验兼容」，登录成功后由调用方透明升级
 */

import { DEFAULT_SEED_PASSWORD } from "./seed";

const PBKDF2_SCHEME = "pbkdf2";
const PBKDF2_HASH = "sha256";
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT_BYTES = 16;
const DERIVED_KEY_BITS = 256;

/** 口令长度上限（#44）：登录 / 建号 / 改密共用，超限在进入 KDF 前拒绝 */
export const MAX_PASSWORD_LENGTH = 200;

/** 口令强度下限（#45）：建号 / 管理员重置 / 自助改密共用同一策略 */
export const MIN_PASSWORD_LENGTH = 12;

export interface PasswordStrengthContext {
  /** 目标账号用户名：口令不得是其大小写 / 空格 / leet 变体 */
  username?: string;
  /** 站点标题：口令不得是其大小写 / 空格 / leet 变体 */
  siteTitle?: string;
}

const LEET_SUBSTITUTIONS: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
  "!": "i",
};

/** 归一化：NFKC → 小写 → 常见 leet 折叠 → 去掉分隔符，用于弱口令与身份变体比较 */
function canonicalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[013457@$!]/g, (char) => LEET_SUBSTITUTIONS[char] ?? char)
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * 弱口令名单（#45）。统一经 canonicalize 折叠后比较，
 * 因此大小写、常见 leet 替换（0→o、@→a 等）与分隔符差异都命中。
 * 种子口令从单一来源引入，避免改种子值后漏拦。
 */
const WEAK_PASSWORDS = new Set(
  [
    DEFAULT_SEED_PASSWORD,
    "changeme",
    "changeme1234",
    "password1",
    "password123",
    "password1234",
    "qwerty",
    "qwertyuiop",
    "letmein",
    "welcome",
    "admin",
    "administrator",
    "12345678",
    "123456789",
    "1234567890",
    "123456789012",
    "111111111111",
    "iloveyou",
    "monkey",
    "dragon",
  ].map(canonicalize)
);

function identityVariants(value: string | undefined): string[] {
  if (!value) return [];
  const canonical = canonicalize(value);
  // 过短的用户名/站名（如 "a"）会产生大面积误伤，不参与变体判定
  if (canonical.length < 3) return [];
  return [canonical, [...canonical].reverse().join("")];
}

function isWeakPassword(password: string): boolean {
  return (
    WEAK_PASSWORDS.has(password.trim().toLowerCase()) ||
    WEAK_PASSWORDS.has(canonicalize(password))
  );
}

/**
 * 共享口令强度断言（#45）：创建用户 / 管理员重置 / 自助改密三条路径必须调用同一实现。
 *
 * 返回是否满足策略，由 handler 统一转 400；不抛异常，避免三处各写一份 try/catch。
 * 规则：长度 ≥ 12、非弱口令名单、不含站点标题或用户名的正向/反向变体。
 * 长度上限由 #44 的 MAX_PASSWORD_LENGTH 在进入本函数前单独早退（错误口径不同）。
 */
export function assertPasswordStrength(
  password: string,
  context: PasswordStrengthContext = {}
): boolean {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return false;
  }
  if (isWeakPassword(password)) return false;

  const canonicalPassword = canonicalize(password);
  for (const value of [context.username, context.siteTitle]) {
    for (const variant of identityVariants(value)) {
      if (variant && canonicalPassword.includes(variant)) return false;
    }
  }
  return true;
}

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
 * 假验证（#17 / #44）：对不存在的账号执行固定低量 CPU 的 PBKDF2 哑运算（1000 次）。
 *
 * 取舍：#17 的「与真实校验等代价」被 #44 的匿名 CPU 上限取代——真实校验跑 100000 次、
 * 本函数只跑 1000 次，失败响应会相差数十毫秒，账号存在性理论上仍可被反复采样区分。
 * 这是为消除「随机用户名 + 超长口令」的匿名 CPU 放大而接受的残余风险；不得单独把本常量
 * 调回跟随配置，等代价抹平需与按 IP 限流（T6）一起评估。结果不参与任何判定，直接丢弃。
 */
export async function fakeVerifyPassword(password: string): Promise<void> {
  await derivePbkdf2(password, COST_FILLER_SALT, FAKE_VERIFY_ITERATIONS);
}
