// @vitest-environment node
/**
 * 回写守卫接入 useArticleEditor 的编排行为锁（T4 #65）。
 *
 * 纯函数判定由 tests/editor-markdown-bridge.test.ts 钉住；本文件只测
 * 「守卫是否真的接进 T3 的加载 / 模式切换 / 保存编排」：
 * 加载判定、lossy 默认源码、显式覆盖、保存前二次判定、阻止保存时不发请求 /
 * 不改 phase / 保持锁、源码模式保留原始字节。不挂载 Vue / DOM / Milkdown，
 * 往返与渲染器都是可编程 stub，期望值全部手写字面量。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createArticleEditor,
  type ArticleEditorCore,
  type EditorGuardAdapter,
} from "../src/admin/editor/useArticleEditor";
import { createEditLock } from "../src/admin/editor/useEditLock";
import { renderMarkdownServer } from "../src/utils/markdownServer";

const DETAIL = {
  title: "已发布文章",
  slug: "published-post",
  content: "# 存量的标题\n\n原始正文字节。",
  summary: "摘要",
  cover_image: "",
  category_id: 3,
  tags: [{ name: "标签A" }],
  status: "published",
};

interface ApiCall {
  method: string;
  path: string;
  body?: unknown;
}

function ok(): Response {
  return {
    json: async () => ({ code: 0, message: "ok", data: null }),
  } as Response;
}

afterEach(() => {
  vi.useRealTimers();
});

/** 往返实现可在用例中途替换，用来验证「保存前不复用加载结论」。 */
function setup() {
  vi.useFakeTimers();
  const apiCalls: ApiCall[] = [];
  const map = new Map<string, string>();
  let roundTripImpl: (markdown: string) => Promise<string> = async (markdown) =>
    markdown;

  const guard: EditorGuardAdapter = {
    roundTrip: (markdown) => roundTripImpl(markdown),
    render: renderMarkdownServer,
  };

  const lock = createEditLock({
    fetchImpl: vi.fn(async () => ok()) as unknown as typeof fetch,
    getToken: () => "guard-token",
  });
  const onError = vi.fn();
  const onSaved = vi.fn();

  const core: ArticleEditorCore = createArticleEditor({
    userId: 7,
    lock,
    guard,
    storage: {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value);
      },
      removeItem: (key) => {
        map.delete(key);
      },
      get length() {
        return map.size;
      },
      key: (index) => [...map.keys()][index] ?? null,
    },
    now: () => 1700000000000,
    api: {
      request: async (method, path, body) => {
        apiCalls.push({ method, path, body });
        if (method === "GET" && path.endsWith("/edit")) {
          return { code: 0, message: "ok", data: DETAIL };
        }
        return { code: 0, message: "ok", data: null };
      },
    },
    messages: () => ({
      loadFailed: "load failed",
      saveFailed: "save failed",
      lockFailed: "lock failed",
      lockLost: "lock lost",
      guardLossy: "已在源码模式打开",
      guardBlocked: "请在源码模式保存",
    }),
    onError,
    onSaved,
  });

  return {
    core,
    apiCalls,
    onError,
    onSaved,
    makeLossy: () => {
      // 把标题降级为普通段落：渲染结果从 <h1> 变成 <p>，守卫应判 lossy。
      roundTripImpl = async (markdown) => markdown.replace(/^# /gm, "");
    },
    makeSafe: () => {
      roundTripImpl = async (markdown) => markdown;
    },
  };
}

function saveCalls(calls: ApiCall[]): ApiCall[] {
  return calls.filter(
    (call) => call.method === "PUT" || call.method === "POST"
  );
}

describe("回写守卫接入编辑器编排", () => {
  it("加载判定 safe：默认 WYSIWYG，且不改写正文原始字节", async () => {
    const s = setup();
    await s.core.open({ id: 42 });

    expect(s.core.getGuard()).toEqual({
      mode: "wysiwyg",
      status: "safe",
      override: false,
      message: "",
    });
    expect(s.core.getState().form.content).toBe(
      "# 存量的标题\n\n原始正文字节。"
    );
    expect(s.core.getState().baseline.content).toBe(
      "# 存量的标题\n\n原始正文字节。"
    );
    expect(s.core.getState().phase).toBe("ready");
  });

  it("加载判定 lossy：默认进源码模式并提示，正文仍是原始字节", async () => {
    const s = setup();
    s.makeLossy();
    await s.core.open({ id: 42 });

    expect(s.core.getGuard().mode).toBe("source");
    expect(s.core.getGuard().status).toBe("lossy");
    expect(s.core.getGuard().message).toBe("已在源码模式打开");
    expect(s.core.getState().form.content).toBe(
      "# 存量的标题\n\n原始正文字节。"
    );
  });

  it("模式切换守卫：lossy 未覆盖切 WYSIWYG 被保留在源码模式", async () => {
    const s = setup();
    s.makeLossy();
    await s.core.open({ id: 42 });

    await s.core.setEditorMode("wysiwyg");
    expect(s.core.getGuard().mode).toBe("source");
    expect(s.core.getGuard().override).toBe(false);

    await s.core.setEditorMode("source");
    expect(s.core.getGuard().mode).toBe("source");
    expect(s.core.getGuard().message).toBe("");
  });

  it("显式覆盖可进 WYSIWYG，但 override 标记与提示保留", async () => {
    const s = setup();
    s.makeLossy();
    await s.core.open({ id: 42 });

    await s.core.overrideGuard();
    expect(s.core.getGuard().mode).toBe("wysiwyg");
    expect(s.core.getGuard().override).toBe(true);
    expect(s.core.getGuard().message).toBe("请在源码模式保存");
  });

  it("保存前二次守卫：加载 safe 但保存时判定 lossy → 阻止保存、不发 PUT、保持编辑器与锁", async () => {
    const s = setup();
    await s.core.open({ id: 42 });
    s.core.updateForm({
      ...s.core.getState().form,
      title: "改过的标题",
    });
    s.makeLossy();
    await s.core.save();

    expect(saveCalls(s.apiCalls)).toHaveLength(0);
    expect(s.core.getState().phase).toBe("ready");
    expect(s.core.getState().lockHeld).toBe(true);
    expect(s.core.getState().form.title).toBe("改过的标题");
    expect(s.core.getGuard().status).toBe("lossy");
    expect(s.onError).toHaveBeenCalledWith("请在源码模式保存");
    expect(s.onSaved).not.toHaveBeenCalled();
  });

  it("显式覆盖后保存前守卫仍失败时照常阻止保存", async () => {
    const s = setup();
    s.makeLossy();
    await s.core.open({ id: 42 });
    await s.core.overrideGuard();

    s.core.updateForm({
      ...s.core.getState().form,
      content: "# 存量的标题\n\n作者又改了正文。",
    });
    await s.core.save();

    expect(saveCalls(s.apiCalls)).toHaveLength(0);
    expect(s.core.getState().phase).toBe("ready");
    expect(s.onError).toHaveBeenCalledWith("请在源码模式保存");
  });

  it("源码模式下 lossy 仍可保存，且未修改正文保留原始字节", async () => {
    const s = setup();
    s.makeLossy();
    await s.core.open({ id: 42 });
    await s.core.save();

    const calls = saveCalls(s.apiCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].path).toBe("/articles/42");
    expect(calls[0].body).toEqual(
      expect.objectContaining({ content: "# 存量的标题\n\n原始正文字节。" })
    );
    expect(s.onSaved).toHaveBeenCalledTimes(1);
  });

  it("覆盖后判定转 safe 时放行保存，正文只写 Markdown", async () => {
    const s = setup();
    s.makeLossy();
    await s.core.open({ id: 42 });
    await s.core.overrideGuard();
    s.makeSafe();

    s.core.updateForm({
      ...s.core.getState().form,
      content: "作者编辑过的正文",
    });
    await s.core.save();

    const calls = saveCalls(s.apiCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual(
      expect.objectContaining({ content: "作者编辑过的正文" })
    );
    expect(calls[0].body).not.toHaveProperty("content_html");
  });

  it("草稿恢复 / 正文被外部替换后可重新执行加载判定", async () => {
    const s = setup();
    await s.core.open({ id: 42 });
    expect(s.core.getGuard().mode).toBe("wysiwyg");

    s.makeLossy();
    s.core.updateForm({
      ...s.core.getState().form,
      content: "# 草稿里的标题\n\n草稿恢复的正文",
    });
    await s.core.reevaluateGuard();

    expect(s.core.getGuard().status).toBe("lossy");
    expect(s.core.getGuard().mode).toBe("source");
    expect(s.core.getState().form.content).toBe(
      "# 草稿里的标题\n\n草稿恢复的正文"
    );
  });
});
