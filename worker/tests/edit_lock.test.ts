import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireLock,
  releaseLock,
  getLockStatus,
  forceReleaseLock,
} from "../src/services/edit_lock_service";
import {
  handleAcquireLock,
  handleReleaseLock,
  handleForceReleaseLock,
} from "../src/handlers/edit_lock";
import type { Env } from "../src/index";
import type { AuthResult } from "../src/middleware/auth";

/**
 * issue #63：编辑锁服务端契约（T3 依赖这套契约，spec §9.2 / ADR 0006）。
 *
 * 四类契约：同用户续期 / 他人冲突 / 释放 / admin 强制接管。
 * KV 用内存桩记录 get / put（含 expirationTtl）/ delete；时间只 mock Date，
 * 便于用手写字面量钉住 acquired_at 不变、expires_at 后移。
 * 期望值不从被测实现反推（docs/agents/testing.md 行为锁约定）。
 */

const ARTICLE_ID = 7;
const LOCK_KEY = `edit_lock:${ARTICLE_ID}`;
const LOCK_TTL = 1800;

/** 手写字面量：固定起点与两次租约到期时间 */
const ACQUIRED_AT = "2026-11-14T04:00:00.000Z";
const EXPIRES_AT = "2026-11-14T04:30:00.000Z";
const RENEWED_AT = "2026-11-14T04:05:00.000Z";
const RENEWED_EXPIRES_AT = "2026-11-14T04:35:00.000Z";
const NOW = new Date(ACQUIRED_AT);

const USERS: Record<string, { id: number; display_name: string }> = {
  owneruser: { id: 2, display_name: "作者" },
  otheruser: { id: 9, display_name: "另一位" },
  adminuser: { id: 1, display_name: "管理员" },
};

const OWNER: AuthResult = {
  username: "owneruser",
  role: "editor",
  mustChangePassword: false,
};
const OTHER: AuthResult = {
  username: "otheruser",
  role: "editor",
  mustChangePassword: false,
};
const ADMIN: AuthResult = {
  username: "adminuser",
  role: "admin",
  mustChangePassword: false,
};

const CTX = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;

interface PutCall {
  key: string;
  value: string;
  options?: { expirationTtl?: number };
}

interface KvState {
  store: Map<string, string>;
  puts: PutCall[];
  deletes: string[];
}

interface Harness {
  env: Env;
  state: KvState;
}

function makeHarness(options: { articleExists?: boolean } = {}): Harness {
  const state: KvState = {
    store: new Map(),
    puts: [],
    deletes: [],
  };

  const kv = {
    async get(key: string): Promise<string | null> {
      return state.store.get(key) ?? null;
    },
    async put(
      key: string,
      value: string,
      putOptions?: { expirationTtl?: number }
    ): Promise<void> {
      state.puts.push({ key, value, options: putOptions });
      state.store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      state.deletes.push(key);
      state.store.delete(key);
    },
  };

  const prepare = (sql: string) => {
    const stmt = {
      sql,
      binds: [] as unknown[],
      bind(...args: unknown[]) {
        stmt.binds = args;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        if (sql.includes("SELECT id, display_name FROM users")) {
          const user = USERS[String(stmt.binds[0])];
          return user ? ({ ...user } as T) : null;
        }
        if (sql.includes("SELECT id FROM articles WHERE id = ?")) {
          return options.articleExists === false
            ? null
            : ({ id: ARTICLE_ID } as T);
        }
        return null;
      },
      async all() {
        return { results: [] };
      },
      async run() {
        return { success: true, meta: { changes: 1 } };
      },
    };
    return stmt;
  };

  const env = {
    DB: { prepare },
    EDIT_LOCK: kv,
  } as unknown as Env;

  return { env, state };
}

function lockRequest(method: string): Request {
  return new Request(
    `https://api.example.test/api/v1/articles/${ARTICLE_ID}/edit-lock`,
    { method }
  );
}

const OWNER_LOCK = {
  holder_id: 2,
  holder_name: "作者",
  acquired_at: ACQUIRED_AT,
  expires_at: EXPIRES_AT,
};

beforeEach(() => {
  // 只 mock Date：不影响 Promise / crypto 等异步行为
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("issue #63：同用户续期", () => {
  it("首次取锁写入 30 分钟 TTL，字段与手写字面量一致", async () => {
    const { env, state } = makeHarness();

    const result = await acquireLock(env, ARTICLE_ID, OWNER);

    expect(result.success).toBe(true);
    expect(result.lock).toEqual(OWNER_LOCK);
    expect(state.puts).toHaveLength(1);
    expect(state.puts[0].key).toBe(LOCK_KEY);
    expect(state.puts[0].options?.expirationTtl).toBe(LOCK_TTL);
    expect(JSON.parse(state.store.get(LOCK_KEY)!)).toEqual(OWNER_LOCK);
  });

  it("同一用户重取：直接放行并续期，acquired_at / holder 不变、expires_at 后移", async () => {
    const { env, state } = makeHarness();
    await acquireLock(env, ARTICLE_ID, OWNER);

    vi.setSystemTime(new Date(RENEWED_AT));
    const renewed = await acquireLock(env, ARTICLE_ID, OWNER);

    expect(renewed.success).toBe(true);
    expect(renewed.conflict).toBeUndefined();
    expect(renewed.lock).toEqual({
      holder_id: 2,
      holder_name: "作者",
      acquired_at: ACQUIRED_AT,
      expires_at: RENEWED_EXPIRES_AT,
    });
    expect(state.puts).toHaveLength(2);
    expect(state.puts[1].options?.expirationTtl).toBe(LOCK_TTL);
    expect(state.deletes).toHaveLength(0);
  });
});

describe("issue #63：他人冲突", () => {
  it("他人持锁 → conflict（含 holder 信息），不改写锁、不续期", async () => {
    const { env, state } = makeHarness();
    await acquireLock(env, ARTICLE_ID, OWNER);
    const before = state.store.get(LOCK_KEY);

    const result = await acquireLock(env, ARTICLE_ID, OTHER);

    expect(result.success).toBe(false);
    expect(result.lock).toBeUndefined();
    expect(result.conflict).toEqual({
      is_locked: true,
      holder_id: 2,
      holder_name: "作者",
      acquired_at: ACQUIRED_AT,
      expires_at: EXPIRES_AT,
    });
    expect(state.store.get(LOCK_KEY)).toBe(before);
    expect(state.puts).toHaveLength(1);
    expect(await getLockStatus(env, ARTICLE_ID)).toEqual({
      is_locked: true,
      holder_id: 2,
      holder_name: "作者",
      acquired_at: ACQUIRED_AT,
      expires_at: EXPIRES_AT,
    });
  });

  it("handler 把冲突映射为 409 / code 10006（T3 弹窗依赖该 code）", async () => {
    const { env } = makeHarness();
    await acquireLock(env, ARTICLE_ID, OWNER);

    const response = await handleAcquireLock(
      lockRequest("POST"),
      env,
      CTX,
      { id: String(ARTICLE_ID) },
      OTHER
    );
    const body = (await response.json()) as {
      code: number;
      message: string;
    };

    expect(response.status).toBe(409);
    expect(body.code).toBe(10006);
    expect(body.message).toContain("作者");
  });
});

describe("issue #63：释放", () => {
  it("holder 释放 → 删除键，状态回到未锁定", async () => {
    const { env, state } = makeHarness();
    await acquireLock(env, ARTICLE_ID, OWNER);

    const result = await releaseLock(env, ARTICLE_ID, OWNER);

    expect(result).toEqual({ success: true });
    expect(state.deletes).toEqual([LOCK_KEY]);
    expect(await getLockStatus(env, ARTICLE_ID)).toEqual({
      is_locked: false,
      holder_id: null,
      holder_name: null,
      acquired_at: null,
      expires_at: null,
    });
  });

  it("非 holder 且非 admin 释放 → forbidden，锁保留", async () => {
    const { env, state } = makeHarness();
    await acquireLock(env, ARTICLE_ID, OWNER);

    const result = await releaseLock(env, ARTICLE_ID, OTHER);

    expect(result).toEqual({ success: false, forbidden: true });
    expect(state.deletes).toHaveLength(0);
    expect((await getLockStatus(env, ARTICLE_ID)).holder_id).toBe(2);

    const response = await handleReleaseLock(
      lockRequest("DELETE"),
      env,
      CTX,
      { id: String(ARTICLE_ID) },
      OTHER
    );
    expect(response.status).toBe(403);
  });

  it("admin 可释放他人的锁；无锁时释放幂等成功", async () => {
    const { env, state } = makeHarness();
    await acquireLock(env, ARTICLE_ID, OWNER);

    expect(await releaseLock(env, ARTICLE_ID, ADMIN)).toEqual({
      success: true,
    });
    expect(state.deletes).toEqual([LOCK_KEY]);
    expect(await releaseLock(env, ARTICLE_ID, ADMIN)).toEqual({
      success: true,
    });
    expect(state.deletes).toEqual([LOCK_KEY]);
  });
});

describe("issue #63：admin 强制接管", () => {
  it("forceReleaseLock 删旧锁、返回 previous_holder、新锁归 admin", async () => {
    const { env, state } = makeHarness();
    await acquireLock(env, ARTICLE_ID, OWNER);

    const result = await forceReleaseLock(env, ARTICLE_ID, ADMIN);

    expect(result.success).toBe(true);
    expect(result.previous_holder).toBe("作者");
    expect(state.deletes).toContain(LOCK_KEY);
    const status = await getLockStatus(env, ARTICLE_ID);
    expect(status.is_locked).toBe(true);
    expect(status.holder_id).toBe(1);
    expect(status.holder_name).toBe("管理员");
    expect(status.acquired_at).toBe(ACQUIRED_AT);
  });

  it("handler 拒绝 editor 强制接管（403），且不动现有锁", async () => {
    const { env, state } = makeHarness();
    await acquireLock(env, ARTICLE_ID, OWNER);
    const before = state.store.get(LOCK_KEY);

    const response = await handleForceReleaseLock(
      lockRequest("POST"),
      env,
      CTX,
      { id: String(ARTICLE_ID) },
      OTHER
    );

    expect(response.status).toBe(403);
    expect(state.store.get(LOCK_KEY)).toBe(before);
    expect(state.deletes).toHaveLength(0);
  });

  it("handler 强制接管成功返回 previous_holder", async () => {
    const { env } = makeHarness();
    await acquireLock(env, ARTICLE_ID, OWNER);

    const response = await handleForceReleaseLock(
      lockRequest("POST"),
      env,
      CTX,
      { id: String(ARTICLE_ID) },
      ADMIN
    );
    const body = (await response.json()) as {
      code: number;
      data: { previous_holder: string | null };
    };

    expect(response.status).toBe(200);
    expect(body.code).toBe(0);
    expect(body.data.previous_holder).toBe("作者");
  });

  it("文章不存在时取锁 → 404，且不写 KV", async () => {
    const { env, state } = makeHarness({ articleExists: false });

    const response = await handleAcquireLock(
      lockRequest("POST"),
      env,
      CTX,
      { id: String(ARTICLE_ID) },
      OWNER
    );

    expect(response.status).toBe(404);
    expect(state.puts).toHaveLength(0);
  });
});
