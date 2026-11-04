import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANALYTICS_RETENTION_DAYS,
  dayKey,
  getAnalyticsHmacSecret,
  retentionCutoffDay,
  runAnalyticsCleanup,
} from "../src/services/analytics_service";
import worker from "../src/index";
import type { Env } from "../src/index";

/**
 * issue #53：阅读统计 Tier 0 数据层与每日清理骨架。
 *
 * 接缝（工单 Key interfaces / 验收）：
 *   - dayKey()：站点时区常量 Asia/Shanghai 的日界（后续计数与清理共用）；
 *   - runAnalyticsCleanup()：D1 可观察副作用——过期令牌、400 天保留窗口、心跳；
 *   - getAnalyticsHmacSecret()：site_config 懒生成（独立于 jwt_secret）；
 *   - schema.sql / worker/wrangler.jsonc：幂等 DDL 与每日 cron 的契约面。
 * D1 用按 SQL 语义执行的内存桩（不是只记录 SQL 文本的桩），断言清理后的行集合。
 */

interface TokenRow {
  token: string;
  day: string;
  expires_at: string;
}

interface DailyRow {
  article_id: number;
  day: string;
}

interface DimRow {
  day: string;
  dim: string;
  bucket: string;
  article_id: number;
}

interface FakeState {
  tokens: TokenRow[];
  articleDays: DailyRow[];
  dimDays: DimRow[];
  config: Map<string, string>;
  /** 已执行的写语句（读语句不计），用于断言密钥只在首次使用时落库 */
  writes: string[];
}

function makeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    tokens: [],
    articleDays: [],
    dimDays: [],
    config: new Map(),
    writes: [],
    ...overrides,
  };
}

interface FakeStatement {
  bind(...args: unknown[]): FakeStatement;
  run(): Promise<{ success: boolean; meta: { changes: number } }>;
  first<T = unknown>(): Promise<T | null>;
}

/** 按 SQL 中实际写出的比较符求值；SQL 改了运算符，测试必须跟着失败 */
function compare(a: string, b: string, op: "<" | "<="): boolean {
  return op === "<" ? a < b : a <= b;
}

function deleteOperator(sql: string, column: string): "<" | "<=" {
  if (sql.includes(`${column} < ?`)) return "<";
  if (sql.includes(`${column} <= ?`)) return "<=";
  throw new Error(`Unexpected delete predicate: ${sql}`);
}

function makeEnv(state: FakeState): Env {
  const prepare = (sql: string): FakeStatement => {
    let binds: unknown[] = [];
    const statement: FakeStatement = {
      bind(...args: unknown[]) {
        binds = args;
        return statement;
      },
      async run() {
        state.writes.push(sql);
        if (sql.startsWith("DELETE FROM analytics_view_token")) {
          const now = String(binds[0]);
          const op = deleteOperator(sql, "expires_at");
          const before = state.tokens.length;
          state.tokens = state.tokens.filter(
            (row) => !compare(row.expires_at, now, op)
          );
          return {
            success: true,
            meta: { changes: before - state.tokens.length },
          };
        }
        if (sql.startsWith("DELETE FROM analytics_article_daily")) {
          const cutoff = String(binds[0]);
          const op = deleteOperator(sql, "day");
          const before = state.articleDays.length;
          state.articleDays = state.articleDays.filter(
            (row) => !compare(row.day, cutoff, op)
          );
          return {
            success: true,
            meta: { changes: before - state.articleDays.length },
          };
        }
        if (sql.startsWith("DELETE FROM analytics_dim_daily")) {
          const cutoff = String(binds[0]);
          const op = deleteOperator(sql, "day");
          const before = state.dimDays.length;
          state.dimDays = state.dimDays.filter(
            (row) => !compare(row.day, cutoff, op)
          );
          return {
            success: true,
            meta: { changes: before - state.dimDays.length },
          };
        }
        if (sql.includes("analytics_last_job_at")) {
          state.config.set("analytics_last_job_at", String(binds[0]));
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("analytics_hmac_secret")) {
          state.config.set("analytics_hmac_secret", String(binds[0]));
          return { success: true, meta: { changes: 1 } };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      async first<T = unknown>() {
        if (sql.includes("analytics_hmac_secret")) {
          const value = state.config.get("analytics_hmac_secret");
          return value ? ({ value } as T) : null;
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    return statement;
  };

  return { DB: { prepare } } as unknown as Env;
}

/** 2026-11-04 12:00 Asia/Shanghai */
const NOW = new Date("2026-11-04T04:00:00.000Z");

describe("dayKey：站点时区日界（Asia/Shanghai）", () => {
  it("UTC 16:00 是上海次日 00:00", () => {
    expect(dayKey(new Date("2026-11-04T15:59:59.999Z"))).toBe("2026-11-04");
    expect(dayKey(new Date("2026-11-04T16:00:00.000Z"))).toBe("2026-11-05");
  });

  it("跨年边界仍按上海时区切日", () => {
    expect(dayKey(new Date("2026-12-31T15:59:59.999Z"))).toBe("2026-12-31");
    expect(dayKey(new Date("2026-12-31T16:00:00.000Z"))).toBe("2027-01-01");
  });
});

describe("runAnalyticsCleanup：过期令牌", () => {
  it("删除已过期令牌，保留未过期令牌；恰在 now 的令牌按过期处理", async () => {
    const state = makeState({
      tokens: [
        {
          token: "expired",
          day: "2026-11-03",
          expires_at: "2026-11-04 03:59:59",
        },
        {
          token: "boundary",
          day: "2026-11-04",
          expires_at: "2026-11-04 04:00:00",
        },
        {
          token: "live",
          day: "2026-11-04",
          expires_at: "2026-11-04 04:00:01",
        },
      ],
    });

    const result = await runAnalyticsCleanup(makeEnv(state), NOW);

    expect(state.tokens.map((row) => row.token)).toEqual(["live"]);
    expect(result.expiredTokens).toBe(2);
  });
});

describe("runAnalyticsCleanup：400 天保留窗口", () => {
  it("399 天前保留，400/401 天前删除；日聚合与维度桶同一边界", async () => {
    // NOW 的上海日界 = 2026-11-04；保留窗口起点 = 2025-10-01（399 天前）
    expect(ANALYTICS_RETENTION_DAYS).toBe(400);
    const state = makeState({
      articleDays: [
        { article_id: 1, day: "2025-09-29" }, // 401 天前
        { article_id: 1, day: "2025-09-30" }, // 400 天前
        { article_id: 1, day: "2025-10-01" }, // 399 天前
      ],
      dimDays: [
        { day: "2025-09-29", dim: "device", bucket: "mobile", article_id: 1 },
        { day: "2025-09-30", dim: "device", bucket: "mobile", article_id: 1 },
        { day: "2025-10-01", dim: "device", bucket: "mobile", article_id: 1 },
      ],
    });

    const result = await runAnalyticsCleanup(makeEnv(state), NOW);

    expect(retentionCutoffDay(NOW)).toBe("2025-10-01");
    expect(state.articleDays.map((row) => row.day)).toEqual(["2025-10-01"]);
    expect(state.dimDays.map((row) => row.day)).toEqual(["2025-10-01"]);
    expect(result.articleDays).toBe(2);
    expect(result.dimDays).toBe(2);
  });
});

describe("runAnalyticsCleanup：心跳", () => {
  it("成功清理后写入 site_config.analytics_last_job_at（UTC datetime）", async () => {
    const state = makeState();
    const result = await runAnalyticsCleanup(makeEnv(state), NOW);

    expect(state.config.get("analytics_last_job_at")).toBe(
      "2026-11-04 04:00:00"
    );
    expect(result.heartbeatAt).toBe("2026-11-04 04:00:00");
  });
});

describe("scheduled 入口", () => {
  it("cron 触发后经 ctx.waitUntil 执行清理并写心跳", async () => {
    const state = makeState();
    let pending: Promise<unknown> | undefined;
    const ctx = {
      waitUntil(promise: Promise<unknown>) {
        pending = promise;
      },
    } as unknown as ExecutionContext;

    await worker.scheduled({} as ScheduledEvent, makeEnv(state), ctx);
    await pending;

    expect(state.config.get("analytics_last_job_at")).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
    );
  });
});

describe("getAnalyticsHmacSecret：懒生成", () => {
  it("首次使用时生成 64 位 hex 并持久化；之后复用同值，不再写库", async () => {
    const state = makeState();
    state.config.set("jwt_secret", "jwt-secret-value");

    const first = await getAnalyticsHmacSecret(makeEnv(state));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe("jwt-secret-value");
    expect(state.config.get("analytics_hmac_secret")).toBe(first);

    const writesAfterFirst = state.writes.length;
    const second = await getAnalyticsHmacSecret(makeEnv(state));
    expect(second).toBe(first);
    expect(state.writes.length).toBe(writesAfterFirst);
  });
});

describe("契约面：schema.sql 与 wrangler cron", () => {
  const schema = readFileSync(
    join(import.meta.dirname, "..", "schema.sql"),
    "utf8"
  );

  it("三张 Tier 0 表与索引全部 IF NOT EXISTS，且不建 Tier 1 同意表", () => {
    for (const table of [
      "analytics_article_daily",
      "analytics_view_token",
      "analytics_dim_daily",
    ]) {
      expect(schema).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`)
      );
      expect(schema).not.toMatch(new RegExp(`CREATE TABLE ${table}\\b`));
    }
    expect(schema).toMatch(/CREATE INDEX IF NOT EXISTS idx_view_token_expires/);
    expect(schema).toMatch(/CREATE INDEX IF NOT EXISTS idx_dim_daily_lookup/);
    expect(schema).not.toMatch(
      /CREATE TABLE (?:IF NOT EXISTS )?analytics_consent/
    );
  });

  it("analytics_article_daily 含 requests 列；site_config 预置密钥与心跳键", () => {
    const daily = schema.slice(
      schema.indexOf("CREATE TABLE IF NOT EXISTS analytics_article_daily")
    );
    expect(daily.slice(0, daily.indexOf(");"))).toMatch(/\brequests\b/);
    expect(schema).toMatch(/VALUES \('analytics_hmac_secret', '', 0\)/);
    expect(schema).toMatch(/VALUES \('analytics_last_job_at', '', 0\)/);
  });

  it("worker/wrangler.jsonc 声明每日 cron", () => {
    // .jsonc 允许尾逗号；去掉后再走 JSON.parse，避免为测试引入 JSONC 依赖
    const raw = readFileSync(
      join(import.meta.dirname, "..", "wrangler.jsonc"),
      "utf8"
    ).replace(/,\s*([}\]])/g, "$1");
    const config = JSON.parse(raw);
    expect(config.triggers.crons).toHaveLength(1);
    expect(config.triggers.crons[0]).toMatch(/^\d+ \d+ \* \* \*$/);
  });
});
