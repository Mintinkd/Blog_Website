import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/index";

/**
 * issue #101 / M21：三类重复收敛——「按 username 查 user id」单点。
 *
 * 接缝：user_service.getUserIdByUsername（D1 出口）。
 * 期望值全部手写字面量，不从被测实现反推。
 */

interface Recorded {
  sql: string;
  binds: unknown[];
}

function makeEnv(id: number | null) {
  const statements: Recorded[] = [];
  const db = {
    prepare(sql: string) {
      const stmt = {
        binds: [] as unknown[],
        bind(...values: unknown[]) {
          stmt.binds = values;
          return stmt;
        },
        async first<T>() {
          statements.push({ sql, binds: stmt.binds });
          return id === null ? null : ({ id } as T);
        },
      };
      return stmt;
    },
  };
  return { env: { DB: db } as unknown as Env, statements };
}

describe("getUserIdByUsername 单点（issue #101）", () => {
  it("命中返回 id，缺号返回 null", async () => {
    const { getUserIdByUsername } =
      await import("../src/services/user_service");
    const hit = makeEnv(42);
    expect(await getUserIdByUsername(hit.env, "alice")).toBe(42);
    expect(hit.statements).toHaveLength(1);
    expect(hit.statements[0].sql).toMatch(
      /SELECT id FROM users WHERE username = \?/i
    );
    expect(hit.statements[0].binds).toEqual(["alice"]);

    const miss = makeEnv(null);
    expect(await getUserIdByUsername(miss.env, "nobody")).toBeNull();
  });
});
