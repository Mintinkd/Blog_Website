// @vitest-environment node
// issue #69 / T8：阶段3 配置类 3 个面板的纯逻辑。期望值均为手写字面量，不从被测实现反推。
import { describe, expect, it } from "vitest";
import { normalizeConfigForm } from "../src/admin/panels/config.logic";
import {
  parseProfileForm,
  buildProfilePayload,
} from "../src/admin/panels/about.logic";
import {
  copyKeyUnion,
  addCopyEntry,
  removeCopyEntry,
  renameCopyEntry,
  normalizeSettings,
} from "../src/admin/panels/appearance.logic";

/** 手写字面量：钉住后台「空名片 + 三条示例链接」的形状，不从被测函数推导 */
const EMPTY_PROFILE_LINKS = [
  { label: "GitHub", url: "" },
  { label: "Email", url: "" },
  { label: "RSS", url: "" },
];
const EMPTY_PROFILE = {
  name: "",
  role: "",
  bio: "",
  avatar: "",
  links: EMPTY_PROFILE_LINKS,
};

describe("ConfigPanel / normalizeConfigForm", () => {
  it("原样取四个字段，posts_per_page 走 parseInt", () => {
    expect(
      normalizeConfigForm({
        site_title: "我的博客",
        site_subtitle: "记录生活",
        site_description: "描述文本",
        posts_per_page: "25",
      })
    ).toEqual({
      site_title: "我的博客",
      site_subtitle: "记录生活",
      site_description: "描述文本",
      posts_per_page: 25,
    });
  });

  it("缺失字段回退空串，非法每页条数回退 10", () => {
    expect(normalizeConfigForm({ posts_per_page: "abc" })).toEqual({
      site_title: "",
      site_subtitle: "",
      site_description: "",
      posts_per_page: 10,
    });
    expect(normalizeConfigForm({ posts_per_page: 0 }).posts_per_page).toBe(10);
  });
});

describe("AboutPanel / parseProfileForm", () => {
  it("坏 JSON 字符串回退空表单", () => {
    expect(parseProfileForm("{not-json")).toEqual(EMPTY_PROFILE);
  });

  it("数组 / JSON 数组 / 非对象一律回退空表单", () => {
    for (const raw of [[1, 2, 3], "[1,2]", null, 123, "   ", undefined]) {
      expect(parseProfileForm(raw)).toEqual(EMPTY_PROFILE);
    }
  });

  it("links 截断到 6 条", () => {
    const links = Array.from({ length: 8 }, (_, i) => ({
      label: `L${i}`,
      url: `/p${i}`,
    }));
    expect(parseProfileForm({ links }).links).toEqual([
      { label: "L0", url: "/p0" },
      { label: "L1", url: "/p1" },
      { label: "L2", url: "/p2" },
      { label: "L3", url: "/p3" },
      { label: "L4", url: "/p4" },
      { label: "L5", url: "/p5" },
    ]);
  });

  it("无 links 时回退 3 条示例，文本字段原样保留", () => {
    expect(parseProfileForm({ name: "老大" })).toEqual({
      name: "老大",
      role: "",
      bio: "",
      avatar: "",
      links: EMPTY_PROFILE_LINKS,
    });
    expect(parseProfileForm({ links: [] }).links).toEqual(EMPTY_PROFILE_LINKS);
  });

  it("links 行字段非字符串时归为空串", () => {
    expect(
      parseProfileForm({ links: [{ label: 123, url: null }] }).links
    ).toEqual([{ label: "", url: "" }]);
  });
});

describe("AboutPanel / buildProfilePayload", () => {
  it("半填行被过滤，label/url 去首尾空格", () => {
    expect(
      buildProfilePayload({
        name: "老大",
        role: "开发者",
        bio: "简介",
        avatar: "/a.png",
        links: [
          { label: "  GitHub  ", url: "  https://github.com  " },
          { label: "半填", url: "   " },
          { label: "", url: "https://example.com" },
          { label: "Email", url: "mailto:hi@example.com" },
        ],
      })
    ).toEqual({
      name: "老大",
      role: "开发者",
      bio: "简介",
      avatar: "/a.png",
      links: [
        { label: "GitHub", url: "https://github.com" },
        { label: "Email", url: "mailto:hi@example.com" },
      ],
    });
  });
});

describe("AppearancePanel / copy 操作", () => {
  it("copyKeyUnion 按 zh→en 顺序去重", () => {
    expect(
      copyKeyUnion(
        { "nav.home": "首页", a: "甲" },
        { "nav.home": "Home", b: "B" }
      )
    ).toEqual(["nav.home", "a", "b"]);
  });

  it("addCopyEntry 去空键、trim 键、只写非空文案", () => {
    expect(
      addCopyEntry({ zh: {}, en: {} }, "  nav.home  ", "首页", "Home")
    ).toEqual({ zh: { "nav.home": "首页" }, en: { "nav.home": "Home" } });
    expect(addCopyEntry({ zh: {}, en: {} }, "  ", "首页", "")).toEqual({
      zh: {},
      en: {},
    });
  });

  it("removeCopyEntry 同时删 zh / en", () => {
    expect(
      removeCopyEntry({ zh: { a: "甲", b: "乙" }, en: { a: "A" } }, "a")
    ).toEqual({ zh: { b: "乙" }, en: {} });
  });

  it("renameCopyEntry 搬运值并删旧键，空键不动", () => {
    expect(
      renameCopyEntry(
        {
          zh: { "nav.home": "首页", keep: "保留" },
          en: { "nav.home": "Home" },
        },
        "nav.home",
        "nav.index"
      )
    ).toEqual({
      zh: { keep: "保留", "nav.index": "首页" },
      en: { "nav.index": "Home" },
    });
    expect(renameCopyEntry({ zh: { a: "甲" }, en: {} }, "a", "  ")).toEqual({
      zh: { a: "甲" },
      en: {},
    });
  });
});

describe("AppearancePanel / normalizeSettings", () => {
  const DEFAULTS = {
    motion: { intensity: "normal", parallax: true, parallaxSpeed: 0.04 },
  };

  it("缺 copy / motion 时回退空覆盖表与默认动效", () => {
    expect(
      normalizeSettings(
        { theme: "T", layout: "L", background: "B", features: "F" },
        DEFAULTS
      )
    ).toEqual({
      theme: "T",
      layout: "L",
      background: "B",
      features: "F",
      copy: { zh: {}, en: {} },
      motion: { intensity: "normal", parallax: true, parallaxSpeed: 0.04 },
    });
  });

  it("有 copy / motion 时原样取用", () => {
    const n = normalizeSettings(
      {
        copy: { zh: { x: "X" }, en: { x: "X" } },
        motion: { intensity: "off", parallax: false, parallaxSpeed: 0 },
      },
      DEFAULTS
    );
    expect(n.copy).toEqual({ zh: { x: "X" }, en: { x: "X" } });
    expect(n.motion).toEqual({
      intensity: "off",
      parallax: false,
      parallaxSpeed: 0,
    });
  });
});
