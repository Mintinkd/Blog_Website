import { describe, expect, it } from "vitest";
import { toConfigPayload } from "../src/utils/config-payload";

/**
 * 后台「站点配置」提交体。
 *
 * Worker 的 `PUT /config` 只接受字符串；`posts_per_page` 在表单里由
 * `v-model.number` 绑成 number，必须在边界统一序列化，否则整批 400
 * （表现为站点配置永远保存失败）。
 */

const form = {
  site_title: "标题",
  site_subtitle: "副标题",
  site_description: "描述",
  posts_per_page: 20,
};

describe("后台站点配置请求体", () => {
  it("posts_per_page 以十进制字符串提交", () => {
    expect(toConfigPayload(form).posts_per_page).toBe("20");
  });

  it("所有值都是字符串（Worker 白名单契约）", () => {
    for (const value of Object.values(toConfigPayload(form))) {
      expect(typeof value).toBe("string");
    }
  });
});
