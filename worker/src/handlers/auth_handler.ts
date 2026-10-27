import { Env } from "../index";
import {
  successResponse,
  error,
  ErrorCodes,
  unauthorized,
  rateLimited,
} from "../utils/response";
import {
  verifyToken,
  generateToken,
  base64UrlEncode,
} from "../middleware/auth";
import type { AuthResult } from "../middleware/auth";
import {
  hashPassword,
  verifyPassword,
  fakeVerifyPassword,
  assertPasswordStrength,
  MAX_PASSWORD_LENGTH,
} from "../utils/password";
import type { PasswordVerifyResult } from "../utils/password";
import { isMissingColumnError } from "../utils/d1_compat";
import {
  DEFAULT_SEED_PASSWORD,
  INITIAL_ADMIN_PASSWORD_HASH,
} from "../utils/seed";

// P1-5 / issue #8：初始/默认口令检测与登录失败锁定
// （种子口令/初始哈希的单一来源见 utils/seed.ts）
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MS = 10 * 60 * 1000;

/** #44：口令长度上限的早退判定与统一错误（登录 / 建号 / 改密 / 重置共用） */
function passwordTooLong(password: string): boolean {
  return password.length > MAX_PASSWORD_LENGTH;
}

function passwordTooLongError(): Response {
  return error(
    ErrorCodes.VALIDATION_FAILED,
    `Password must be at most ${MAX_PASSWORD_LENGTH} characters`
  );
}

/**
 * #45：口令强度不合规的统一 400。
 * 只返回策略摘要，不区分具体失败规则，避免暴露判定细节。
 */
function passwordStrengthError(): Response {
  return error(
    ErrorCodes.VALIDATION_FAILED,
    "口令强度不足：至少 12 位，且不得使用弱口令、站点名或用户名变体"
  );
}

/** #45：站点标题参与口令强度判定（站点名变体拒绝）；未配置时为空串 */
async function getSiteTitleForPasswordPolicy(env: Env): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT value FROM site_config WHERE key = 'site_title'"
  ).first<{ value: string }>();
  return row?.value ?? "";
}

/** Generate a strong random JWT secret (64-character base64url string) */
function generateJwtSecret(): string {
  const array = new Uint8Array(48); // 48 bytes = 384 bits (strong enough for HS256)
  crypto.getRandomValues(array);
  return base64UrlEncode(
    Array.from(array, (byte) => String.fromCharCode(byte)).join("")
  );
}

export async function getJwtSecret(env: Env): Promise<string> {
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
      "JWT secret not configured in site_config; auto-generated and persisted:",
      secret
    );
    return secret;
  }
  return row.value;
}

function lockedRemainingMs(lockedUntil: string | null): number {
  if (!lockedUntil) return 0;
  const until = new Date(lockedUntil).getTime();
  if (Number.isNaN(until)) return 0;
  return Math.max(0, until - Date.now());
}

/** 锁定反馈（#17）：仅凭据正确时调用，失败路径不得暴露锁定状态 */
function lockedFeedback(remainMs: number): Response {
  return rateLimited(
    `账号已锁定，请 ${Math.ceil(remainMs / 60000)} 分钟后再试`
  );
}

interface UserAuthRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  role: string;
  must_change_password: number;
  failed_login_attempts: number;
  locked_until: string | null;
}

/** 半迁移兜底行：新增列可能在（部分应用的）迁移前缺失，按列可选 */
interface UserAuthRowCompat extends Omit<
  UserAuthRow,
  "must_change_password" | "failed_login_attempts" | "locked_until"
> {
  must_change_password?: number;
  failed_login_attempts?: number;
  locked_until?: string | null;
}

/** 取回登录所需用户行；新增列尚未迁移时降级为旧列（锁定/须改密功能待迁移后生效） */
async function loadUserAuthRow(
  env: Env,
  username: string
): Promise<UserAuthRow | null> {
  try {
    return await env.DB.prepare(
      "SELECT id, username, password_hash, display_name, role, must_change_password, failed_login_attempts, locked_until FROM users WHERE username = ?"
    )
      .bind(username)
      .first<UserAuthRow>();
  } catch (e) {
    // P1 复审 Spec(c)2 / #16：仅「列不存在」（迁移前）允许回退旧列；其余异常向上抛（fail-closed）
    if (!isMissingColumnError(e)) throw e;
  }
  // 半迁移兜底：schema.sql 三条独立 ALTER，按实际存在的列逐列降级——已存在的列（如 must_change_password）仍取真实值，不被一并置 0
  const info = await env.DB.prepare(
    "SELECT name FROM pragma_table_info('users')"
  ).all<{ name: string }>();
  const existing = new Set(info.results.map((r) => r.name));
  const columns = [
    "id",
    "username",
    "password_hash",
    "display_name",
    "role",
    ...["must_change_password", "failed_login_attempts", "locked_until"].filter(
      (c) => existing.has(c)
    ),
  ];
  const row = await env.DB.prepare(
    `SELECT ${columns.join(", ")} FROM users WHERE username = ?`
  )
    .bind(username)
    .first<UserAuthRowCompat>();
  if (!row) return null;
  return {
    ...row,
    must_change_password: row.must_change_password ?? 0,
    failed_login_attempts: row.failed_login_attempts ?? 0,
    locked_until: row.locked_until ?? null,
  };
}

/** 记一次登录失败；达到阈值即写入锁定截止时间（#17：阈值触发不再单独响应，失败路径统一 401） */
async function registerLoginFailure(
  env: Env,
  userId: number,
  currentAttempts: number
): Promise<void> {
  const attempts = (currentAttempts || 0) + 1;
  try {
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
      await env.DB.prepare(
        "UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?"
      )
        .bind(attempts, lockedUntil, userId)
        .run();
      return;
    }
    await env.DB.prepare(
      "UPDATE users SET failed_login_attempts = ? WHERE id = ?"
    )
      .bind(attempts, userId)
      .run();
  } catch (e) {
    // P1 复审 Spec(c)2 / #16：仅「列不存在」（迁移前，功能不可用）允许跳过；其余异常向上抛，不得静默丢失计数
    if (!isMissingColumnError(e)) throw e;
  }
}

/** 默认/初始口令判定：显式标记、种子哈希，或登录口令即种子默认值（兼容哈希已升级为 pbkdf2 的情形） */
function usingDefaultCredential(
  user: Pick<UserAuthRow, "must_change_password" | "password_hash">,
  providedPassword: string
): boolean {
  return (
    Boolean(user.must_change_password) ||
    user.password_hash === INITIAL_ADMIN_PASSWORD_HASH ||
    providedPassword === DEFAULT_SEED_PASSWORD
  );
}

export async function handleLogin(
  request: Request,
  env: Env
): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>;
  const { username, password } = body;

  if (!username || !password) {
    return error(
      ErrorCodes.VALIDATION_FAILED,
      "Username and password are required"
    );
  }

  const providedPassword = String(password);

  // #44：超长口令在查库与 KDF 前拒绝，避免匿名请求放大 CPU 开销
  if (passwordTooLong(providedPassword)) return passwordTooLongError();

  // 1. Try users table
  const user = await loadUserAuthRow(env, String(username));

  // #17 verify-first：锁定剩余时间只用于「凭据正确」分支的反馈，失败路径不据此区分账号是否存在
  const remainMs = user ? lockedRemainingMs(user.locked_until) : 0;

  // 先验证口令；未知用户名在下方（非遗留管理员名）分支执行固定低量假验证（#44）
  let userVerified: PasswordVerifyResult | null = null;
  if (user) {
    const verified = await verifyPassword(providedPassword, user.password_hash);
    if (verified.ok) userVerified = verified;
  }

  if (userVerified && user) {
    // 口令正确但锁定期内：反馈剩余锁定时间（#8），不发 token、不重置计数
    if (remainMs > 0) return lockedFeedback(remainMs);

    const needsChange = usingDefaultCredential(user, providedPassword);
    const hashToStore = userVerified.needsUpgrade
      ? await hashPassword(providedPassword)
      : user.password_hash;
    try {
      await env.DB.prepare(
        "UPDATE users SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL, must_change_password = ? WHERE id = ?"
      )
        .bind(hashToStore, needsChange ? 1 : 0, user.id)
        .run();
    } catch (e) {
      // P1 复审 Spec(c)2 / #16：仅「列不存在」（迁移前）允许降级；其余异常向上抛，不得静默放行
      if (!isMissingColumnError(e)) throw e;
      // 迁移前降级：至少写回口令哈希（#7 透明升级不丢失）
      await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
        .bind(hashToStore, user.id)
        .run();
    }
    const jwtSecret = await getJwtSecret(env);
    const token = await generateToken(user.username, jwtSecret);

    return successResponse(
      {
        token,
        user: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          role: user.role,
          must_change_password: needsChange,
        },
      },
      "Login successful"
    );
  }

  // 2. Fallback: check site_config (legacy) and auto-migrate to users table
  const adminUsername = await env.DB.prepare(
    "SELECT value FROM site_config WHERE key = 'admin_username'"
  ).first<{ value: string }>();
  const adminPasswordHash = await env.DB.prepare(
    "SELECT value FROM site_config WHERE key = 'admin_password_hash'"
  ).first<{ value: string }>();

  if (
    adminUsername &&
    adminPasswordHash &&
    String(username) === adminUsername.value
  ) {
    const fallbackVerified = await verifyPassword(
      providedPassword,
      adminPasswordHash.value
    );
    if (fallbackVerified.ok) {
      // 遗留口令正确但锁定期内：与 users 表分支一致，只对凭据正确者反馈剩余时间
      if (remainMs > 0) return lockedFeedback(remainMs);

      const needsChange =
        adminPasswordHash.value === INITIAL_ADMIN_PASSWORD_HASH ||
        providedPassword === DEFAULT_SEED_PASSWORD;
      const migratedHash = await hashPassword(providedPassword);
      // Auto-migrate: update or create user in users table from legacy site_config
      if (user) {
        // User row exists but its hash didn't match (e.g. stale seed) - update with the verified password
        try {
          await env.DB.prepare(
            "UPDATE users SET password_hash = ?, must_change_password = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?"
          )
            .bind(migratedHash, needsChange ? 1 : 0, user.id)
            .run();
        } catch (e) {
          // P1 复审 Spec(c)2 / #16：仅「列不存在」（迁移前）允许降级；其余异常向上抛
          if (!isMissingColumnError(e)) throw e;
          await env.DB.prepare(
            "UPDATE users SET password_hash = ? WHERE id = ?"
          )
            .bind(migratedHash, user.id)
            .run();
        }
        const jwtSecret = await getJwtSecret(env);
        const token = await generateToken(user.username, jwtSecret);
        return successResponse(
          {
            token,
            user: {
              id: user.id,
              username: user.username,
              display_name: user.display_name,
              role: user.role,
              must_change_password: needsChange,
            },
          },
          "Login successful (password migrated)"
        );
      } else {
        // User doesn't exist yet - create from legacy config
        const displayName = adminUsername.value;
        let newId: number | undefined;
        try {
          const result = await env.DB.prepare(
            "INSERT INTO users (username, password_hash, display_name, role, must_change_password) VALUES (?, ?, ?, ?, ?)"
          )
            .bind(
              String(username),
              migratedHash,
              displayName,
              "admin",
              needsChange ? 1 : 0
            )
            .run();
          newId = result.meta.last_row_id;
        } catch (e) {
          // P1 复审 Spec(c)2 / #16：仅「列不存在」（迁移前）允许降级；其余异常向上抛
          if (!isMissingColumnError(e)) throw e;
          const result = await env.DB.prepare(
            "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)"
          )
            .bind(String(username), migratedHash, displayName, "admin")
            .run();
          newId = result.meta.last_row_id;
        }
        const jwtSecret = await getJwtSecret(env);
        const token = await generateToken(String(username), jwtSecret);
        return successResponse(
          {
            token,
            user: {
              id: newId,
              username: String(username),
              display_name: displayName,
              role: "admin",
              must_change_password: needsChange,
            },
          },
          "Login successful (migrated from legacy config)"
        );
      }
    }
  } else if (!user) {
    // 未知用户名（且非遗留管理员名）：固定低量假验证（#44），为匿名请求的 CPU 成本设上限；
    // 不再以「与真实校验等代价」为目标，账号存在性的剩余时序差见 utils/password.ts 的取舍说明
    await fakeVerifyPassword(providedPassword);
  }

  // 凭据失败：统一 401「Invalid credentials」——不区分未知账号与错误口令、不暴露锁定（#17 AC1/AC2）
  // 计数/锁定语义不变：仅对已存在账号计数；锁定期内不累加、不延长；锁定期满后从 0 重新计数
  if (user && remainMs === 0) {
    const lockExpired = user.locked_until !== null;
    await registerLoginFailure(
      env,
      user.id,
      lockExpired ? 0 : user.failed_login_attempts
    );
  }

  return unauthorized("Invalid credentials");
}

export async function handleRefresh(
  request: Request,
  env: Env
): Promise<Response> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return unauthorized("Missing token");
  }

  const jwtSecret = await getJwtSecret(env);
  const oldToken = authHeader.slice(7);
  const payload = await verifyToken(oldToken, jwtSecret);
  if (!payload) {
    return unauthorized("Invalid token");
  }

  const newToken = await generateToken(payload.username, jwtSecret);
  return successResponse({ token: newToken }, "Token refreshed");
}

/** P1-5 / issue #8：自助改密（验证旧口令 + #45 共享强度校验），成功后清除「须改密」标记 */
export async function handleChangePassword(
  request: Request,
  env: Env,
  authResult?: AuthResult
): Promise<Response> {
  if (!authResult) return unauthorized("Authentication required");

  const body = (await request.json()) as Record<string, unknown>;
  const { old_password, new_password } = body;

  if (!old_password || !new_password) {
    return error(
      ErrorCodes.VALIDATION_FAILED,
      "old_password and new_password are required"
    );
  }

  const oldPassword = String(old_password);
  const newPassword = String(new_password);

  // #44：与登录同口径，超长口令在查库与 KDF 前拒绝
  if (passwordTooLong(oldPassword) || passwordTooLong(newPassword)) {
    return passwordTooLongError();
  }

  const user = await env.DB.prepare(
    "SELECT id, password_hash FROM users WHERE username = ?"
  )
    .bind(authResult.username)
    .first<{ id: number; password_hash: string }>();
  if (!user) return unauthorized("User not found");

  const verified = await verifyPassword(oldPassword, user.password_hash);
  if (!verified.ok) return error(ErrorCodes.VALIDATION_FAILED, "旧口令不正确");

  if (newPassword === oldPassword)
    return error(ErrorCodes.VALIDATION_FAILED, "新口令不能与旧口令相同");

  // #45：共享口令强度校验（自助改密）
  const siteTitle = await getSiteTitleForPasswordPolicy(env);
  if (
    !assertPasswordStrength(newPassword, {
      username: authResult.username,
      siteTitle,
    })
  ) {
    return passwordStrengthError();
  }

  const newHash = await hashPassword(newPassword);
  const nowIso = new Date().toISOString();
  try {
    await env.DB.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 0, failed_login_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?"
    )
      .bind(newHash, nowIso, user.id)
      .run();
  } catch (e) {
    // P1 复审 Spec(c)2 / #16：仅「列不存在」（迁移前）允许降级；其余异常向上抛，不得静默放行
    if (!isMissingColumnError(e)) throw e;
    // 迁移前降级：仅更新口令哈希
    await env.DB.prepare(
      "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?"
    )
      .bind(newHash, nowIso, user.id)
      .run();
  }

  return successResponse({ must_change_password: false }, "口令已更新");
}

export async function handleListUsers(
  request: Request,
  env: Env
): Promise<Response> {
  const users = await env.DB.prepare(
    "SELECT id, username, display_name, role, created_at FROM users"
  ).all();
  return successResponse(users.results);
}

export async function handleCreateUser(
  request: Request,
  env: Env
): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>;
  const { username, password, display_name, role } = body;

  if (!username || !password) {
    return error(
      ErrorCodes.VALIDATION_FAILED,
      "Username and password are required"
    );
  }

  const usernameForPolicy = String(username);
  const providedPassword = String(password);
  const displayName = display_name ? String(display_name) : usernameForPolicy;

  // #44：与登录同口径，超长口令在查库与哈希前拒绝
  if (passwordTooLong(providedPassword)) return passwordTooLongError();

  // #45：共享口令强度校验（创建用户 / 管理员重置 / 自助改密）
  const siteTitle = await getSiteTitleForPasswordPolicy(env);
  if (
    !assertPasswordStrength(providedPassword, {
      username: usernameForPolicy,
      siteTitle,
    })
  ) {
    return passwordStrengthError();
  }

  const existing = await env.DB.prepare(
    "SELECT id FROM users WHERE username = ?"
  )
    .bind(String(username))
    .first();
  if (existing) {
    return error(ErrorCodes.VALIDATION_FAILED, "Username already exists");
  }

  const passwordHash = await hashPassword(providedPassword);
  const userRole = role === "editor" ? "editor" : "admin";

  const result = await env.DB.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, must_change_password) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(String(username), passwordHash, displayName, userRole, 1)
    .run();

  return successResponse(
    {
      id: result.meta.last_row_id,
      username: String(username),
      display_name: displayName,
      role: userRole,
    },
    "User created"
  );
}

export async function handleUpdateUser(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  const { id } = params;
  const body = (await request.json()) as Record<string, unknown>;

  // #44：与登录同口径，超长口令在查库与哈希前拒绝
  if (body.password && passwordTooLong(String(body.password))) {
    return passwordTooLongError();
  }

  const existing = await env.DB.prepare("SELECT id FROM users WHERE id = ?")
    .bind(Number(id))
    .first();
  if (!existing) {
    return error(ErrorCodes.NOT_FOUND, "User not found");
  }

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.display_name !== undefined) {
    sets.push("display_name = ?");
    values.push(String(body.display_name));
  }

  if (body.role !== undefined) {
    const newRole = body.role === "editor" ? "editor" : "admin";
    if (newRole === "editor") {
      const adminCount = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM users WHERE role = 'admin'"
      ).first<{ count: number }>();
      if (adminCount && adminCount.count <= 1) {
        return error(
          ErrorCodes.VALIDATION_FAILED,
          "系统必须至少保留一个管理员"
        );
      }
    }
    sets.push("role = ?");
    values.push(newRole);
  }

  const passwordReset = Boolean(body.password);

  if (passwordReset) {
    const providedPassword = String(body.password);

    // #44：与登录同口径，超长口令在查库与哈希前拒绝
    if (passwordTooLong(providedPassword)) return passwordTooLongError();

    // #45：共享口令强度校验
    const siteTitle = await getSiteTitleForPasswordPolicy(env);
    const user = await env.DB.prepare("SELECT username FROM users WHERE id = ?")
      .bind(Number(id))
      .first<{ username: string }>();
    if (!user) return error(ErrorCodes.NOT_FOUND, "User not found");

    if (
      !assertPasswordStrength(providedPassword, {
        username: user.username,
        siteTitle,
      })
    ) {
      return passwordStrengthError();
    }

    const passwordHash = await hashPassword(providedPassword);
    sets.push("password_hash = ?");
    values.push(passwordHash);
    // 管理员重置口令（#18）：与自助改密对齐，同一步清零失败计数、清空锁定截止时间
    // #45：同时置 must_change_password = 1
    sets.push(
      "failed_login_attempts = 0",
      "locked_until = NULL",
      "must_change_password = 1"
    );
  }

  if (sets.length === 0) {
    return error(ErrorCodes.VALIDATION_FAILED, "No fields to update");
  }

  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(Number(id));

  try {
    await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();
  } catch (e) {
    // P1 复审 Spec(c)2 / #16：仅「列不存在」（迁移前）允许降级；其余异常向上抛，不得静默丢失更新
    if (!isMissingColumnError(e) || !passwordReset) throw e;
    // 迁移前降级：仅更新既有字段（角色/显示名/口令哈希），锁定清零待迁移后生效
    const fallbackSets = sets.filter(
      (s) =>
        !s.startsWith("failed_login_attempts") && !s.startsWith("locked_until")
    );
    await env.DB.prepare(
      `UPDATE users SET ${fallbackSets.join(", ")} WHERE id = ?`
    )
      .bind(...values)
      .run();
  }

  return successResponse(null, "User updated");
}

export async function handleDeleteUser(
  request: Request,
  env: Env,
  params: Record<string, string>,
  authResult?: AuthResult
): Promise<Response> {
  const { id } = params;

  // #51：禁止删除当前登录用户（角色降级有 self 检查，删除路径此前缺失）
  if (authResult) {
    const self = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
      .bind(authResult.username)
      .first<{ id: number }>();
    if (self && self.id === Number(id)) {
      return error(ErrorCodes.VALIDATION_FAILED, "无法删除当前登录账户");
    }
  }

  const user = await env.DB.prepare("SELECT role FROM users WHERE id = ?")
    .bind(Number(id))
    .first<{ role: string }>();
  if (!user) {
    return error(ErrorCodes.NOT_FOUND, "User not found");
  }

  if (user.role === "admin") {
    const adminCount = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM users WHERE role = 'admin'"
    ).first<{ count: number }>();
    if (adminCount && adminCount.count <= 1) {
      return error(ErrorCodes.VALIDATION_FAILED, "系统必须至少保留一个管理员");
    }
  }

  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(Number(id)).run();

  return successResponse(null, "User deleted");
}
