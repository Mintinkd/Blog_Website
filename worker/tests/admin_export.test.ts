import { describe, expect, it } from "vitest";
import { handleExport, MAX_EXPORT_ROWS } from "../src/handlers/admin";
import type { Env } from "../src/index";

/**
 * issue #73 / M22：`GET /admin/export` 分片导出与列裁剪。
 *
 * 接缝：handleExport —— 工单 Key interfaces 点名的 handler 接缝（D1 出口）。
 * 桩记录 SQL 与绑定值：断言每张表用显式列清单（无 SELECT *）、带 LIMIT/OFFSET，
 * 且单表 / 分页参数生效；不传参数时仍导出全部表（响应形状兼容既有调用方）。
 */

interface RecordedStatement {
  sql: string;
  binds: unknown[];
}

function makeExportDb(rowCount = 3): {
  db: unknown;
  statements: () => RecordedStatement[];
} {
  const recorded: RecordedStatement[] = [];
  const prepare = (sql: string) => {
    const stmt = {
      sql,
      binds: [] as unknown[],
      bind(...binds: unknown[]) {
        stmt.binds = binds;
        return stmt;
      },
      all: async () => ({
        results: Array.from({ length: rowCount }, (_, i) => ({ id: i + 1 })),
      }),
    };
    recorded.push(stmt);
    return stmt;
  };
  return { db: { prepare }, statements: () => [...recorded] };
}

function makeEnv(db: unknown): Env {
  return { DB: db } as unknown as Env;
}

/** handleExport 返回裸 JSON（非 successResponse 包装），字段在顶层。 */
interface ExportBody {
  export_data: Record<string, unknown[]>;
  exported_at: string;
  page?: number;
  page_size?: number;
  table?: string;
  total_tables?: number;
}

async function call(
  url: string,
  db: unknown
): Promise<{ res: Response; body: ExportBody }> {
  const res = await handleExport(new Request(url), makeEnv(db));
  return { res, body: (await res.json()) as ExportBody };
}

describe("handleExport 分片与列裁剪（#73 / M22）", () => {
  it("默认导出全部表，每张表用显式列清单 + LIMIT/OFFSET，不再 SELECT *", async () => {
    const fake = makeExportDb();
    const { res, body } = await call(
      "https://example.com/api/v1/admin/export",
      fake.db
    );
    expect(res.status).toBe(200);
    const stmts = fake.statements();
    expect(stmts.length).toBeGreaterThan(1); // 9 张表
    for (const s of stmts) {
      expect(s.sql, `${s.sql} 不应含 SELECT *`).not.toMatch(/SELECT\s+\*/i);
      expect(s.sql, `${s.sql} 应含 LIMIT`).toMatch(/LIMIT\s+\?/i);
      expect(s.sql, `${s.sql} 应含 OFFSET`).toMatch(/OFFSET\s+\?/i);
    }
    // 形状兼容：export_data + exported_at 仍在
    expect(body.export_data).toBeDefined();
    expect(typeof body.exported_at).toBe("string");
  });

  it("table 参数只导指定表", async () => {
    const fake = makeExportDb();
    const { res, body } = await call(
      "https://example.com/api/v1/admin/export?table=articles",
      fake.db
    );
    expect(res.status).toBe(200);
    expect(fake.statements()).toHaveLength(1);
    expect(fake.statements()[0].sql).toMatch(/FROM articles/i);
    expect(Object.keys(body.export_data ?? {})).toEqual(["articles"]);
    expect(body.table).toBe("articles");
  });

  it("page/page_size 参数生效，且 page_size 钳制到上限", async () => {
    const fake = makeExportDb();
    await call(
      "https://example.com/api/v1/admin/export?table=articles&page=3&page_size=999999",
      fake.db
    );
    const stmt = fake.statements()[0];
    // bind 形如 (limit, offset)；page=3, page_size 钳制后 offset=(3-1)*limit
    const [limit, offset] = stmt.binds as number[];
    expect(limit).toBe(MAX_EXPORT_ROWS);
    expect(offset).toBe(2 * MAX_EXPORT_ROWS);
  });

  it("非法 table 名返回 400，不执行任何 SQL（表白名单）", async () => {
    const fake = makeExportDb();
    const { res } = await call(
      "https://example.com/api/v1/admin/export?table=users_secret",
      fake.db
    );
    expect(res.status).toBe(400);
    expect(fake.statements()).toHaveLength(0);
  });

  it("非法分页参数是 400，不会一次性取全表", async () => {
    const fake = makeExportDb();
    const { res } = await call(
      "https://example.com/api/v1/admin/export?table=articles&page=0&page_size=-5",
      fake.db
    );
    expect(res.status).toBe(400);
    expect(fake.statements()).toHaveLength(0);
  });
});
