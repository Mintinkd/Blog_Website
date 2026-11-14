// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  clearDraft,
  clearUserDrafts,
  createDraft,
  DRAFT_MAX_BYTES,
  DRAFT_TTL_MS,
  DRAFT_VERSION,
  draftKey,
  isValidScope,
  loadDraft,
  parseDraft,
  saveDraft,
  serializeDraft,
  utf8ByteLength,
  type DraftForm,
  type DraftScope,
  type DraftStorage,
} from "../src/utils/editor/draftStore";

/**
 * issue #62（编辑器 T1）本地草稿行为基线。
 * 用内存 storage 桩，node 环境无 localStorage —— 由此证明存储层不依赖 DOM。
 * 期望值均为手写字面量；仅在「1MB 边界输入」处用纯函数计算固定序列化开销，
 * 属于构造输入，断言的成功 / 失败字面量不来自被测实现。
 */
const SCOPE: DraftScope = { userId: 7, articleId: 42 };
const SAVED_AT = 1_700_000_000_000;
const SEVEN_DAYS_MS = 604_800_000;

interface MemoryStorage extends DraftStorage {
  data: Map<string, string>;
}

function memoryStorage(): MemoryStorage {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
}

function sampleForm(overrides: Partial<DraftForm> = {}): DraftForm {
  return {
    title: "标题",
    slug: "",
    summary: "摘要",
    content: "正文",
    cover_image: "",
    category_id: "",
    status: "draft",
    tags: ["A", "B"],
    ...overrides,
  };
}

function options() {
  return { savedAt: SAVED_AT, baselineHash: "base-1" };
}

describe("草稿键与序列化", () => {
  it("常量钉住版本 / 7 天 / 1MB", () => {
    expect(DRAFT_VERSION).toBe(1);
    expect(DRAFT_TTL_MS).toBe(SEVEN_DAYS_MS);
    expect(DRAFT_MAX_BYTES).toBe(1_048_576);
  });

  it("键含版本、用户 id、文章 id；新建文章用 new", () => {
    expect(draftKey(SCOPE)).toBe("blog:article-draft:v1:u7:a42");
    expect(draftKey({ userId: 7, articleId: "new" })).toBe(
      "blog:article-draft:v1:u7:anew"
    );
    expect(draftKey({ userId: 8, articleId: 42 })).not.toBe(draftKey(SCOPE));
  });

  it("只投影表单白名单字段，token 不进草稿，tags 不共享引用", () => {
    const input = { ...sampleForm(), token: "secret" } as DraftForm & {
      token: string;
    };
    const draft = createDraft(SCOPE, input, options());
    expect(serializeDraft(draft)).not.toContain("secret");
    expect(serializeDraft(draft)).not.toContain("token");
    expect(draft.form).toEqual(sampleForm());
    input.tags.push("C");
    expect(draft.form.tags).toEqual(["A", "B"]);
  });

  it("utf8ByteLength 按 UTF-8 计字节，代理对算 4 字节", () => {
    expect(utf8ByteLength("")).toBe(0);
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("中文")).toBe(6);
    expect(utf8ByteLength("aé")).toBe(3);
    expect(utf8ByteLength("🚀")).toBe(4);
  });

  it("scope 非法时拒绝写入", () => {
    expect(isValidScope(SCOPE)).toBe(true);
    expect(isValidScope({ userId: 0, articleId: 42 })).toBe(false);
    expect(isValidScope({ userId: 7, articleId: 0 })).toBe(false);
    expect(isValidScope({ userId: Number.NaN, articleId: 42 })).toBe(false);
    const storage = memoryStorage();
    expect(
      saveDraft(storage, { userId: 0, articleId: 42 }, sampleForm(), options())
    ).toEqual({ ok: false, reason: "invalid-scope" });
    expect(storage.data.size).toBe(0);
  });
});

describe("写入 / 读取 / 隔离", () => {
  it("往返读写还原同一份手写草稿", () => {
    const storage = memoryStorage();
    expect(saveDraft(storage, SCOPE, sampleForm(), options())).toEqual({
      ok: true,
      key: "blog:article-draft:v1:u7:a42",
    });
    expect(loadDraft(storage, SCOPE, { now: SAVED_AT })).toEqual({
      version: 1,
      userId: 7,
      articleId: 42,
      savedAt: SAVED_AT,
      baselineHash: "base-1",
      form: sampleForm(),
    });
  });

  it("按用户 + 文章隔离，互不覆盖", () => {
    const storage = memoryStorage();
    const scopes: DraftScope[] = [
      { userId: 7, articleId: 42 },
      { userId: 7, articleId: "new" },
      { userId: 8, articleId: 42 },
    ];
    scopes.forEach((scope, index) => {
      saveDraft(
        storage,
        scope,
        sampleForm({ content: `body-${index}` }),
        options()
      );
    });
    expect(loadDraft(storage, scopes[0], { now: SAVED_AT })?.form.content).toBe(
      "body-0"
    );
    expect(loadDraft(storage, scopes[1], { now: SAVED_AT })?.form.content).toBe(
      "body-1"
    );
    expect(loadDraft(storage, scopes[2], { now: SAVED_AT })?.form.content).toBe(
      "body-2"
    );
  });

  it("坏数据 / 版本不符 / 串到别的 scope 都惰性清理", () => {
    const storage = memoryStorage();
    const key = draftKey(SCOPE);
    storage.setItem(key, "not-json");
    expect(loadDraft(storage, SCOPE, { now: SAVED_AT })).toBeNull();
    expect(storage.data.has(key)).toBe(false);

    storage.setItem(
      key,
      JSON.stringify({
        version: 2,
        userId: 7,
        articleId: 42,
        savedAt: SAVED_AT,
        form: sampleForm(),
      })
    );
    expect(loadDraft(storage, SCOPE, { now: SAVED_AT })).toBeNull();
    expect(storage.data.has(key)).toBe(false);

    const foreignKey = draftKey({ userId: 8, articleId: 42 });
    storage.setItem(
      foreignKey,
      serializeDraft(createDraft(SCOPE, sampleForm(), options()))
    );
    expect(
      loadDraft(storage, { userId: 8, articleId: 42 }, { now: SAVED_AT })
    ).toBeNull();
    expect(storage.data.has(foreignKey)).toBe(false);
  });

  it("parseDraft 丢弃额外字段并过滤非字符串标签", () => {
    const raw = JSON.stringify({
      version: 1,
      userId: 7,
      articleId: 42,
      savedAt: SAVED_AT,
      baselineHash: "b",
      form: {
        ...sampleForm(),
        tags: ["A", 3, "B"],
        token: "secret",
        admin_token: "x",
      },
    });
    expect(parseDraft(raw)).toEqual({
      version: 1,
      userId: 7,
      articleId: 42,
      savedAt: SAVED_AT,
      baselineHash: "b",
      form: { ...sampleForm(), tags: ["A", "B"] },
    });
    expect(parseDraft(null)).toBeNull();
  });
});

describe("7 天过期与 1MB 配额", () => {
  it("恰好 7 天仍有效，超过 1ms 惰性清理", () => {
    const storage = memoryStorage();
    saveDraft(storage, SCOPE, sampleForm(), options());
    expect(
      loadDraft(storage, SCOPE, { now: SAVED_AT + SEVEN_DAYS_MS })
    ).not.toBeNull();
    expect(
      loadDraft(storage, SCOPE, { now: SAVED_AT + SEVEN_DAYS_MS + 1 })
    ).toBeNull();
    expect(storage.data.has(draftKey(SCOPE))).toBe(false);
  });

  it("恰好 1MB 可写入，多 1 字节跳过且不落盘", () => {
    const probe = createDraft(SCOPE, sampleForm({ content: "" }), options());
    const overhead = utf8ByteLength(serializeDraft(probe));
    const exactContent = "x".repeat(DRAFT_MAX_BYTES - overhead);

    const atLimit = memoryStorage();
    expect(
      saveDraft(
        atLimit,
        SCOPE,
        sampleForm({ content: exactContent }),
        options()
      )
    ).toEqual({ ok: true, key: "blog:article-draft:v1:u7:a42" });

    const overLimit = memoryStorage();
    expect(
      saveDraft(
        overLimit,
        SCOPE,
        sampleForm({ content: exactContent + "x" }),
        options()
      )
    ).toEqual({ ok: false, reason: "oversize" });
    expect(overLimit.data.size).toBe(0);
  });

  it("storage 写入抛错（配额 / 隐私模式）映射为 storage-error", () => {
    const storage: DraftStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect(saveDraft(storage, SCOPE, sampleForm(), options())).toEqual({
      ok: false,
      reason: "storage-error",
    });
  });
});

describe("清理", () => {
  it("clearDraft 只删目标键", () => {
    const storage = memoryStorage();
    saveDraft(storage, SCOPE, sampleForm(), options());
    saveDraft(
      storage,
      { userId: 7, articleId: "new" },
      sampleForm(),
      options()
    );
    clearDraft(storage, SCOPE);
    expect(storage.data.has(draftKey(SCOPE))).toBe(false);
    expect(
      loadDraft(storage, { userId: 7, articleId: "new" }, { now: SAVED_AT })
    ).not.toBeNull();
  });

  it("clearUserDrafts 只清该用户全部草稿，不动其他用户", () => {
    const storage = memoryStorage();
    saveDraft(storage, SCOPE, sampleForm(), options());
    saveDraft(
      storage,
      { userId: 7, articleId: "new" },
      sampleForm(),
      options()
    );
    saveDraft(storage, { userId: 8, articleId: 42 }, sampleForm(), options());
    expect(clearUserDrafts(storage, 7)).toBe(2);
    expect(storage.data.size).toBe(1);
    expect(
      loadDraft(storage, { userId: 8, articleId: 42 }, { now: SAVED_AT })
    ).not.toBeNull();
  });
});
