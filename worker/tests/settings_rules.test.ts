import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";

/**
 * workers-types 的全局 URL 与 node:url 的 URL 类型不兼容（tests 下全局被 workers-types 抢注）；
 * 本测试需要 node:fs 逐字节对读生成物，这里做一次显式桥接。
 */
function toNodeFsPath(u: URL): string {
  return fileURLToPath(u as unknown as NodeURL);
}
import {
  PATTERNS,
  SETTINGS_RULES,
  type SettingsRule,
} from "../src/generated/settings-rules";
import {
  getDefaultSettings,
  validateSettings,
  deepMerge,
  validateCopyBody,
  type SiteSettings,
} from "../src/handlers/settings";

/**
 * issue #27（ADR 0001）：设置白名单「规则描述符单源 + 双端生成物」的机制锁定与行为锁定。
 *
 * 接缝：generated/settings-rules —— 双端各自生成的同构规则模块（写侧 validateSettings 消费）。
 *   - A 组：对称双生成。两侧生成物字节一致；规则路径落在八大分区、
 *           pattern / 枚举 / copy 上限引用自洽。
 *     （CI 同时以「重新生成 diff 必须为空」守护；此处为本地同一契约的测试面。）
 *   - B 组：写侧规则管线的行为锁定（validateSettings 消费生成物的安全网），
 *           见下方 B 组说明。
 *   不在此层：读侧 sanitizeSettings 的行为 —— 前端无测试设施，仅 astro check
 *     类型门禁（docs/agents/testing.md）。
 */

// 写侧生成物：worker/src/generated/settings-rules.ts
const WORKER_COPY = toNodeFsPath(
  new URL("../src/generated/settings-rules.ts", import.meta.url)
);
// 读侧生成物：仓库根 src/generated/settings-rules.ts
const ROOT_COPY = toNodeFsPath(
  new URL("../../src/generated/settings-rules.ts", import.meta.url)
);

/** 分区组：theme / copy 再细一层分区，其余取顶级段 */
function groupOf(path: string): string {
  const segs = path.split(".");
  return segs[0] === "theme" || segs[0] === "copy"
    ? segs.slice(0, 2).join(".")
    : segs[0];
}

/** 规则表条目展开：[路径, 规则]（Record → 有序 entries，顺序 = 描述符分区顺序） */
function ruleEntries(): Array<[string, SettingsRule]> {
  return Object.entries(SETTINGS_RULES);
}

describe("settings.rules 生成物（issue #27）", () => {
  it("两侧生成物字节一致（对称双生成）", () => {
    const worker = readFileSync(WORKER_COPY, "utf8");
    const root = readFileSync(ROOT_COPY, "utf8");
    expect(root).toBe(worker);
  });

  it("规则路径只落在既定八大分区，无游离路径", () => {
    const groups = new Set(ruleEntries().map(([path]) => groupOf(path)));
    expect(groups).toEqual(
      new Set([
        "theme.light",
        "theme.dark",
        "layout",
        "background",
        "features",
        "motion",
        "copy.zh",
        "copy.en",
      ])
    );
  });

  it("规则引用自洽：string 规则的 pattern、enum 规则的值集、copy 规则的上限全部有效", () => {
    for (const [, rule] of ruleEntries()) {
      switch (rule.kind) {
        case "string":
          expect(rule.patterns.length).toBeGreaterThan(0);
          for (const name of rule.patterns) {
            expect(PATTERNS[name]).toBeInstanceOf(RegExp);
          }
          break;
        case "number":
          expect(typeof rule.min).toBe("number");
          expect(typeof rule.max).toBe("number");
          break;
        case "enum":
          expect(rule.values.length).toBeGreaterThan(0);
          break;
        case "bool":
          break;
        case "copy":
          expect(rule.cap).toBeGreaterThan(0);
          break;
      }
    }
  });
});

/* ── B 组：写侧规则管线的行为锁定 ──
 * validateSettings 消费生成物后的行为安全网：每条路径按 kind 必拒、
 * 报错路径顺序与 copy 边界契约级锁定
 * （issue #27 验收：「现有正则/范围/上限逐字保留，语义不变」）。
 */

/** 写侧报错路径的契约顺序（与描述符/生成物的分区顺序一致，随 API 面公开） */
const EXPECTED_PATHS = [
  "theme.light.accent",
  "theme.light.accentHover",
  "theme.light.bgPrimary",
  "theme.light.bgSecondary",
  "theme.light.bgTertiary",
  "theme.light.textPrimary",
  "theme.light.textSecondary",
  "theme.light.textTertiary",
  "theme.light.border",
  "theme.light.borderLight",
  "theme.dark.accent",
  "theme.dark.accentHover",
  "theme.dark.bgPrimary",
  "theme.dark.bgSecondary",
  "theme.dark.bgTertiary",
  "theme.dark.textPrimary",
  "theme.dark.textSecondary",
  "theme.dark.textTertiary",
  "theme.dark.border",
  "theme.dark.borderLight",
  "layout.contentMaxWidth",
  "layout.headerHeight",
  "layout.radiusSm",
  "layout.radiusMd",
  "layout.radiusLg",
  "background.bgImage",
  "background.bgOpacity",
  "background.bgBlur",
  "background.bgBrightness",
  "features.comments",
  "features.likes",
  "features.friendLinks",
  "features.search",
  "features.rss",
  "features.darkMode",
  "features.i18n",
  "motion.intensity",
  "motion.parallax",
  "motion.parallaxSpeed",
  "copy.zh",
  "copy.en",
];

/** 每种规则类别的通用「必拒」探针（与生成物值互不重复，独立于规则数据） */
function illegalProbe(rule: SettingsRule): unknown {
  switch (rule.kind) {
    case "string":
      return ""; // 四条 pattern 全不命中（hexColor/size 需内容，localPath 需前导 /，httpsUrl 需前缀）
    case "number":
      return NaN; // 有限数 + 区间内双关被拒
    case "bool":
      return 0; // 非布尔
    case "enum":
      return "unknown"; // 字面值集合之外
    case "copy":
      return null; // 非普通对象（maps 整体拒绝）
  }
}

/** 逐叶路径赋值（容器在 defaults 上原位存在；settings.rules 的路径全部为叶级） */
function assignByPath(obj: SiteSettings, path: string, value: unknown): void {
  let cur: any = obj;
  const segs = path.split(".");
  for (const k of segs.slice(0, -1)) cur = cur[k];
  cur[segs[segs.length - 1]] = value;
}

describe("settings.rules 规则管线（issue #27）", () => {
  it("defaults 深合并基线全合法 → 空报错", () => {
    expect(validateSettings(getDefaultSettings())).toEqual([]);
  });

  it("形状全空 → 全部路径按契约顺序报非法", () => {
    expect(validateSettings({} as SiteSettings)).toEqual(EXPECTED_PATHS);
  });

  it("每条规则路径的必拒探针 → 报出且仅报出该路径，顺序与契约一致", () => {
    const allBad = getDefaultSettings();
    for (const [path, rule] of ruleEntries()) {
      assignByPath(allBad, path, illegalProbe(rule));
    }
    expect(validateSettings(allBad)).toEqual(EXPECTED_PATHS);
  });

  it("copy 长度边界：恰为 cap 合法，cap+1 拒绝并点名键", () => {
    const cap =
      SETTINGS_RULES["copy.zh"].kind === "copy"
        ? SETTINGS_RULES["copy.zh"].cap
        : 0;
    const atCap = getDefaultSettings();
    (atCap.copy.zh as any).key = "a".repeat(cap);
    expect(validateSettings(atCap)).toEqual([]);

    const overCap = getDefaultSettings();
    (overCap.copy.zh as any).key = "a".repeat(cap + 1);
    expect(validateSettings(overCap)).toEqual(["copy.zh.key"]);

    const nonString = getDefaultSettings();
    (nonString.copy.zh as any).key = 42;
    expect(validateSettings(nonString)).toEqual(["copy.zh.key"]);
  });
});

/* ── H11：i18n 文案覆盖往返契约 ──
 * 深合并键集合 bug、validateSettings 错配、序列化丢字段，三类缺陷
 * 都被「write → read → 断言相等」这一条往返契约兜住。
 * 接缝：deepMerge + validateCopyBody（提交体校验）。
 */
describe("i18n 文案覆盖往返契约（H11）", () => {
  const CAP =
    SETTINGS_RULES["copy.zh"].kind === "copy"
      ? SETTINGS_RULES["copy.zh"].cap
      : 2000;

  /** 模拟 PUT → GET 的完整往返：deepMerge 写入侧 + loadStored 读取侧各跑一次 */
  function roundTrip(body: any): SiteSettings {
    const written = deepMerge(getDefaultSettings(), body);
    // loadStored 侧：从 DB 读出 JSON 后再 deepMerge 一次默认值
    const stored = JSON.parse(JSON.stringify(written));
    return deepMerge(getDefaultSettings(), stored);
  }

  it("提交合法文案键后，读取返回与提交完全一致的值", () => {
    const body = {
      copy: {
        zh: { "nav.home": "首页-test", "hero.title": "测试标题" },
        en: { "nav.home": "Home-test" },
      },
    };
    const result = roundTrip(body);
    expect(result.copy.zh["nav.home"]).toBe("首页-test");
    expect(result.copy.zh["hero.title"]).toBe("测试标题");
    expect(result.copy.en["nav.home"]).toBe("Home-test");
  });

  it("往返契约：每个分区各挑一个代表字段，write → read → 断言相等", () => {
    const body = {
      copy: {
        zh: {
          "site.title": "我的博客",
          "nav.home": "首页-overridden",
          "hero.title": "探索 · 记录 · 分享-test",
          "page.category": "分类: {name}-test",
        },
        en: {
          "site.title": "My Blog",
          "nav.home": "Home-overridden",
        },
      },
    };
    const result = roundTrip(body);
    expect(result.copy.zh["site.title"]).toBe("我的博客");
    expect(result.copy.zh["nav.home"]).toBe("首页-overridden");
    expect(result.copy.zh["hero.title"]).toBe("探索 · 记录 · 分享-test");
    expect(result.copy.zh["page.category"]).toBe("分类: {name}-test");
    expect(result.copy.en["site.title"]).toBe("My Blog");
    expect(result.copy.en["nav.home"]).toBe("Home-overridden");
  });

  it("未提交的键保持默认文案，不被清空、不变成 undefined", () => {
    const body = {
      copy: {
        zh: { "nav.home": "首页-overridden" },
      },
    };
    const result = roundTrip(body);
    // 提交的键被覆盖
    expect(result.copy.zh["nav.home"]).toBe("首页-overridden");
    // 未提交的键保持默认
    expect(result.copy.zh["hero.title"]).toBe("探索 · 记录 · 分享");
    expect(result.copy.en["nav.home"]).toBe("Home");
    expect(result.copy.en["hero.title"]).toBe("Explore · Record · Share");
    // 无 undefined
    for (const v of Object.values(result.copy.zh)) {
      expect(typeof v).toBe("string");
    }
    for (const v of Object.values(result.copy.en)) {
      expect(typeof v).toBe("string");
    }
  });

  it("非法文案：非字符串值被 400 拒绝", () => {
    const bad = validateCopyBody({ copy: { zh: { "nav.home": 12345 } } }, CAP);
    expect(bad).toEqual(["copy.zh.nav.home"]);
  });

  it("非法文案：超长值被 400 拒绝", () => {
    const bad = validateCopyBody(
      { copy: { zh: { "nav.home": "a".repeat(CAP + 1) } } },
      CAP
    );
    expect(bad).toEqual(["copy.zh.nav.home"]);
  });

  it("非法文案：键名不合法被 400 拒绝", () => {
    const bad = validateCopyBody(
      { copy: { zh: { "Bad-Key": "x", "123abc": "x", "has space": "x" } } },
      CAP
    );
    expect(bad).toEqual([
      "copy.zh.Bad-Key",
      "copy.zh.123abc",
      "copy.zh.has space",
    ]);
  });

  it("合法键名边界：month.01 这类数字起头分段可通过", () => {
    const bad = validateCopyBody(
      {
        copy: {
          zh: { "month.01": "1月", "admin.scrape_selector_invalid": "x" },
        },
      },
      CAP
    );
    expect(bad).toEqual([]);
  });

  it("未提交 copy 分区时 validateCopyBody 返回空", () => {
    expect(validateCopyBody({}, CAP)).toEqual([]);
    expect(validateCopyBody({ theme: {} }, CAP)).toEqual([]);
  });

  it("copy 分区非对象时整体拒绝", () => {
    expect(validateCopyBody({ copy: "not an object" }, CAP)).toEqual(["copy"]);
    expect(validateCopyBody({ copy: { zh: null } }, CAP)).toEqual(["copy.zh"]);
  });

  it("默认值深合并基线：全量默认文案均可往返", () => {
    const def = getDefaultSettings();
    const result = roundTrip({ copy: { zh: {}, en: {} } });
    // 所有默认文案完整保留
    for (const [key, value] of Object.entries(def.copy.zh)) {
      expect(result.copy.zh[key]).toBe(value);
    }
    for (const [key, value] of Object.entries(def.copy.en)) {
      expect(result.copy.en[key]).toBe(value);
    }
  });

  it("默认值键集合非空（H11 根因修复）", () => {
    const def = getDefaultSettings();
    expect(Object.keys(def.copy.zh).length).toBeGreaterThan(0);
    expect(Object.keys(def.copy.en).length).toBeGreaterThan(0);
  });
});
