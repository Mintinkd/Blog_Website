// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  resolveArticleApiOrigin,
  WORKER_ORIGIN,
} from "../src/utils/workerOrigin";

/**
 * #41：文章 SSR 的 dev-only Worker origin 覆盖。
 *
 * 回归脚本需要把服务端取数指向本地 mock；生产构建必须继续走
 * WORKER_ORIGIN，不能被同名环境变量劫持。这里固定解析规则，
 * 页面级取数行为由 `tests/article-server.test.ts` 覆盖。
 */

describe("文章 SSR 的 Worker origin 解析", () => {
  it("dev 下采用 ARTICLE_API_ORIGIN 覆盖并去掉尾部斜杠", () => {
    expect(
      resolveArticleApiOrigin({
        DEV: true,
        ARTICLE_API_ORIGIN: "http://127.0.0.1:4322/",
      })
    ).toBe("http://127.0.0.1:4322");
  });

  it("生产构建忽略 ARTICLE_API_ORIGIN", () => {
    expect(
      resolveArticleApiOrigin({
        DEV: false,
        ARTICLE_API_ORIGIN: "http://127.0.0.1:4322",
      })
    ).toBe(WORKER_ORIGIN);
  });

  it("覆盖值为空或只有空白时回退 WORKER_ORIGIN", () => {
    expect(
      resolveArticleApiOrigin({ DEV: true, ARTICLE_API_ORIGIN: "   " })
    ).toBe(WORKER_ORIGIN);
    expect(resolveArticleApiOrigin({ DEV: true })).toBe(WORKER_ORIGIN);
  });
});
