import { describe, expect, it } from "vitest";
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

function makeEnv(row: { id: number; display_name?: string } | null) {
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
          return row === null ? null : ({ ...row } as T);
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
    const hit = makeEnv({ id: 42 });
    expect(await getUserIdByUsername(hit.env, "alice")).toBe(42);
    expect(hit.statements).toHaveLength(1);
    expect(hit.statements[0].sql).toMatch(
      /SELECT id FROM users WHERE username = \?/i
    );
    expect(hit.statements[0].binds).toEqual(["alice"]);

    const miss = makeEnv(null);
    expect(await getUserIdByUsername(miss.env, "nobody")).toBeNull();
  });

  it("getUserInfoByUsername 返回 id + display_name（编辑锁持有者名称）", async () => {
    const { getUserInfoByUsername } =
      await import("../src/services/user_service");
    const fake = makeEnv({ id: 7, display_name: "作者" });
    expect(await getUserInfoByUsername(fake.env, "owner")).toEqual({
      id: 7,
      display_name: "作者",
    });
    expect(fake.statements[0].binds).toEqual(["owner"]);
    expect(fake.statements[0].sql).toMatch(/display_name/);

    const miss = makeEnv(null);
    expect(await getUserInfoByUsername(miss.env, "nobody")).toBeNull();
  });
});
