import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createArticle,
  updateArticle,
  slugExists,
} from "../src/services/article_service";
import type { Env } from "../src/index";

/**
 * issue #101 / M21：slug 检查单点 + 消除 service 写后重读回环。
 *
 * 接缝：article_service 的 D1 出口。
 * 期望值全部手写字面量，不从被测实现反推。
 */

interface Recorded {
  sql: string;
  binds: unknown[];
}

const DETAIL = {
  id: 7,
  title: "标题",
  slug: "new-slug",
  content: "正文",
  content_html: "",
  summary: "",
  cover_image: "",
  status: "draft",
  author_id: null,
  published_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  view_count: 0,
  like_count: 0,
  comment_count: 0,
  reading_time: 1,
  category_id: null,
  category_name: null,
  category_slug: null,
  author_name: null,
};

/** 写桩：slug 唯一检查返回 null，详情按 id 或 slug 分流，记录全部 SQL。 */
function makeWriteDb(slugDup: { id: number } | null = null) {
  const recorded: Recorded[] = [];
  const prepare = (sql: string) => {
    const stmt = {
      sql,
      binds: [] as unknown[],
      bind(...binds: unknown[]) {
        stmt.binds = binds;
        return stmt;
      },
      async first() {
        recorded.push({ sql: stmt.sql, binds: [...stmt.binds] });
        if (/SELECT id FROM articles WHERE slug = \?/i.test(stmt.sql))
          return slugDup;
        if (
          /SELECT id, published_at FROM articles WHERE id = \?/i.test(stmt.sql)
        )
          return { id: 7, published_at: null };
        if (/FROM articles a[\s\S]*WHERE a\.id = \?/i.test(stmt.sql))
          return DETAIL;
        if (/FROM articles a[\s\S]*WHERE a\.slug = \?/i.test(stmt.sql))
          return DETAIL;
        if (/SELECT slug FROM articles WHERE id = \?/i.test(stmt.sql))
          return { slug: DETAIL.slug };
        return null;
      },
      async all() {
        recorded.push({ sql: stmt.sql, binds: [...stmt.binds] });
        return { results: [] };
      },
      async run() {
        recorded.push({ sql: stmt.sql, binds: [...stmt.binds] });
        return { success: true, meta: { changes: 1, last_row_id: 7 } };
      },
    };
    return stmt;
  };
  return { db: { prepare } as unknown, statements: () => [...recorded] };
}

describe("slugExists 单点（issue #101）", () => {
  it(" slug 存在时返回 true（含排除 id 参数）", async () => {
    const fake = makeWriteDb({ id: 9 });
    expect(await slugExists({ DB: fake.db } as unknown as Env, "dup")).toBe(
      true
    );
    const check = fake
      .statements()
      .find((s) => /SELECT id FROM articles WHERE slug = \?/i.test(s.sql));
    expect(check).toBeDefined();
    expect(check!.binds).toEqual(["dup"]);
  });

  it("slug 不存在时返回 false", async () => {
    const fake = makeWriteDb(null);
    expect(await slugExists({ DB: fake.db } as unknown as Env, "free")).toBe(
      false
    );
  });
});

describe("取文章 tags 单点（issue #101 / 与 M1 协同）", () => {
  it("全 worker 只有 article_service 的 loadArticleTags 逐篇取标签，其余为列表批量/过滤语义", () => {
    const ROOT = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      ".."
    );
    const srcDir = path.join(ROOT, "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".ts")) files.push(full);
      }
    };
    walk(srcDir);
    // 逐篇取标签的 SQL（article_tags at ON t.id = at.tag_id + WHERE at.article_id = ?）
    // 只应出现在 article_service.ts 的 loadArticleTags / listArticles 的 group_concat 子查询中。
    const offenders = files.filter((f) => {
      if (!f.endsWith("article_service.ts")) {
        const src = readFileSync(f, "utf8");
        return /JOIN article_tags at[\s\S]{0,120}WHERE at\.article_id = \?/i.test(
          src
        );
      }
      return false;
    });
    expect(offenders, `逐篇取标签 SQL 泄漏到: ${offenders.join(", ")}`).toEqual(
      []
    );
  });
});

describe("写后重读回环消除（issue #101）", () => {
  it("createArticle 返回详情时按 id 回读，不再经 getArticleBySlug 的 slug 详情查询", async () => {
    const fake = makeWriteDb(null);
    const article = await createArticle({ DB: fake.db } as unknown as Env, {
      title: "标题",
      content: "正文",
      category_id: null,
    });
    expect(article.id).toBe(7);
    // 详情回读按 id，而非 getArticleBySlug 的 WHERE a.slug = ?
    expect(
      fake
        .statements()
        .some((s) => /FROM articles a[\s\S]*WHERE a\.id = \?/i.test(s.sql))
    ).toBe(true);
    expect(
      fake
        .statements()
        .some((s) => /FROM articles a[\s\S]*WHERE a\.slug = \?/i.test(s.sql))
    ).toBe(false);
  });

  it("updateArticle 返回详情时按 id 回读，不再先查 slug 再回环", async () => {
    const fake = makeWriteDb(null);
    const article = await updateArticle({ DB: fake.db } as unknown as Env, 7, {
      title: "新标题",
    });
    expect(article).not.toBeNull();
    expect(
      fake
        .statements()
        .some((s) => /FROM articles a[\s\S]*WHERE a\.id = \?/i.test(s.sql))
    ).toBe(true);
    expect(
      fake
        .statements()
        .some((s) => /SELECT slug FROM articles WHERE id = \?/i.test(s.sql))
    ).toBe(false);
    expect(
      fake
        .statements()
        .some((s) => /FROM articles a[\s\S]*WHERE a\.slug = \?/i.test(s.sql))
    ).toBe(false);
  });
});
