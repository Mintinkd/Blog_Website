// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  canSave,
  closeDecision,
  emptyEditorForm,
  initialEditorState,
  isEditorDirty,
  isEditorOpen,
  reduceEditorState,
  shouldBlockUnload,
  type EditorFormSnapshot,
  type EditorState,
} from "../src/utils/editor/editorState";

/**
 * issue #62（编辑器 T1）useArticleEditor 纯 reducer 行为基线。
 * 状态机来源：docs/ARTICLE_EDITOR_UPGRADE.md §7；期望值全部手写字面量。
 * node 环境证明 reducer 不 import Vue / DOM。
 */
function loadedForm(
  overrides: Partial<EditorFormSnapshot> = {}
): EditorFormSnapshot {
  return {
    title: "标题",
    slug: "title",
    summary: "摘要",
    content: "正文",
    cover_image: "",
    category_id: "",
    status: "draft",
    tags: ["A"],
    ...overrides,
  };
}

/** 串联 open → lock-acquired → loaded 得到可编辑状态（用于构造测试前置）。 */
function readyState(): EditorState {
  let state = reduceEditorState(initialEditorState(), {
    type: "open",
    articleId: 42,
  });
  state = reduceEditorState(state, { type: "lock-acquired" });
  return reduceEditorState(state, { type: "loaded", form: loadedForm() });
}

function dirtyState(): EditorState {
  return reduceEditorState(readyState(), {
    type: "edit",
    form: loadedForm({ content: "未保存正文" }),
  });
}

describe("初始状态与状态转移", () => {
  it("initialEditorState 是手写的全字段空白基线", () => {
    expect(initialEditorState()).toEqual({
      phase: "closed",
      articleId: null,
      form: {
        title: "",
        slug: "",
        summary: "",
        content: "",
        cover_image: "",
        category_id: "",
        status: "draft",
        tags: [],
      },
      baseline: emptyEditorForm(),
      dialog: "none",
      lockHeld: false,
      error: null,
    });
  });

  it("open → 抢锁 → 加载 → 保存 → 成功，逐段钉住 phase 与锁", () => {
    const s0 = initialEditorState();
    const s1 = reduceEditorState(s0, { type: "open", articleId: 42 });
    expect(s1.phase).toBe("acquiring-lock");
    expect(s1.articleId).toBe(42);
    expect(s1.lockHeld).toBe(false);

    const s2 = reduceEditorState(s1, { type: "lock-acquired" });
    expect(s2.phase).toBe("loading-content");
    expect(s2.lockHeld).toBe(true);

    const s3 = reduceEditorState(s2, {
      type: "loaded",
      form: loadedForm(),
    });
    expect(s3.phase).toBe("ready");
    expect(s3.error).toBe(null);
    expect(isEditorDirty(s3)).toBe(false);
    expect(canSave(s3)).toBe(true);

    const s4 = reduceEditorState(s3, { type: "save" });
    expect(s4.phase).toBe("saving");
    expect(canSave(s4)).toBe(false);

    const s5 = reduceEditorState(s4, { type: "save-ok" });
    expect(s5.phase).toBe("saved");
    expect(s5.lockHeld).toBe(false);
    expect(s5.dialog).toBe("none");
    expect(isEditorOpen(s5)).toBe(false);
  });

  it("抢锁冲突可重试，加载出的表单不与基线共享引用", () => {
    const conflicted = reduceEditorState(
      reduceEditorState(initialEditorState(), {
        type: "open",
        articleId: 42,
      }),
      { type: "lock-conflict" }
    );
    expect(conflicted.phase).toBe("lock-conflict");
    expect(conflicted.lockHeld).toBe(false);
    expect(reduceEditorState(conflicted, { type: "lock-retry" }).phase).toBe(
      "acquiring-lock"
    );

    const form = loadedForm();
    let state = reduceEditorState(initialEditorState(), {
      type: "open",
      articleId: 42,
    });
    state = reduceEditorState(state, { type: "lock-acquired" });
    state = reduceEditorState(state, { type: "loaded", form });
    form.tags.push("B");
    expect(state.baseline.tags).toEqual(["A"]);
    expect(state.form.tags).toEqual(["A"]);

    const edited = reduceEditorState(state, {
      type: "edit",
      form: loadedForm({ tags: ["A", "B"] }),
    });
    expect(edited.baseline.tags).toEqual(["A"]);
    expect(isEditorDirty(edited)).toBe(true);
  });
});

describe("脏状态与关闭决策", () => {
  it("任一表单字段或 tags 顺序变化即脏，改回基线即干净", () => {
    const clean = readyState();
    expect(isEditorDirty(clean)).toBe(false);
    const changedForms: EditorFormSnapshot[] = [
      loadedForm({ title: "changed" }),
      loadedForm({ slug: "changed" }),
      loadedForm({ summary: "changed" }),
      loadedForm({ content: "changed" }),
      loadedForm({ cover_image: "changed" }),
      loadedForm({ category_id: "changed" }),
      loadedForm({ status: "changed" }),
      loadedForm({ tags: ["A", "B"] }),
    ];
    changedForms.forEach((form) => {
      const state = reduceEditorState(clean, { type: "edit", form });
      expect(isEditorDirty(state)).toBe(true);
    });
    expect(
      isEditorDirty(
        reduceEditorState(clean, {
          type: "edit",
          form: loadedForm({ tags: ["A", "B"] }),
        })
      )
    ).toBe(true);
    expect(
      isEditorDirty(
        reduceEditorState(dirtyState(), {
          type: "edit",
          form: loadedForm(),
        })
      )
    ).toBe(false);
  });

  it("干净关闭 → 直接关闭并释放锁 / 清草稿；脏关闭 → 确认并保留草稿", () => {
    expect(closeDecision(readyState())).toEqual({
      action: "close",
      releaseLock: true,
      clearDraft: true,
      keepDraft: false,
    });
    expect(closeDecision(dirtyState())).toEqual({
      action: "confirm",
      releaseLock: false,
      clearDraft: false,
      keepDraft: true,
    });
    const saved = reduceEditorState(
      reduceEditorState(readyState(), { type: "save" }),
      { type: "save-ok" }
    );
    expect(closeDecision(saved)).toEqual({
      action: "ignore",
      releaseLock: false,
      clearDraft: false,
      keepDraft: false,
    });
  });

  it("未保存确认三出口：放弃关闭、继续编辑、保存并关闭", () => {
    const prompted = reduceEditorState(dirtyState(), { type: "close" });
    expect(prompted.dialog).toBe("unsaved");
    expect(prompted.phase).toBe("ready");
    expect(isEditorOpen(prompted)).toBe(true);

    const discarded = reduceEditorState(prompted, { type: "discard" });
    expect(discarded.phase).toBe("closed");
    expect(discarded.lockHeld).toBe(false);
    expect(discarded.dialog).toBe("none");

    const continued = reduceEditorState(prompted, { type: "continue" });
    expect(continued.dialog).toBe("none");
    expect(continued.form.content).toBe("未保存正文");

    const saving = reduceEditorState(prompted, { type: "save" });
    expect(saving.phase).toBe("saving");
  });
});

describe("保存失败 / 锁丢失 / 加载失败", () => {
  it("保存失败保持编辑器打开、保持锁、保留内容与草稿", () => {
    let state = reduceEditorState(dirtyState(), { type: "save" });
    state = reduceEditorState(state, {
      type: "save-failed",
      message: "服务端 500",
    });
    expect(state.phase).toBe("ready");
    expect(state.lockHeld).toBe(true);
    expect(state.form.content).toBe("未保存正文");
    expect(state.error).toBe("服务端 500");
    expect(state.dialog).toBe("none");
    expect(isEditorOpen(state)).toBe(true);
    expect(canSave(state)).toBe(true);
    expect(shouldBlockUnload(state)).toBe(true);
    expect(closeDecision(state)).toEqual({
      action: "confirm",
      releaseLock: false,
      clearDraft: false,
      keepDraft: true,
    });
  });

  it("锁丢失禁止保存，仍可编辑 / 复制正文，关闭时保留草稿", () => {
    const lost = reduceEditorState(dirtyState(), { type: "lock-lost" });
    expect(lost.phase).toBe("lock-lost");
    expect(lost.lockHeld).toBe(false);
    expect(canSave(lost)).toBe(false);
    expect(reduceEditorState(lost, { type: "save" })).toEqual(lost);
    expect(closeDecision(lost)).toEqual({
      action: "confirm",
      releaseLock: false,
      clearDraft: false,
      keepDraft: true,
    });
    const edited = reduceEditorState(lost, {
      type: "edit",
      form: loadedForm({ content: "可继续编辑" }),
    });
    expect(edited.form.content).toBe("可继续编辑");
    expect(canSave(edited)).toBe(false);
  });

  it("加载失败不得进入可编辑状态，可重试", () => {
    let state = reduceEditorState(initialEditorState(), {
      type: "open",
      articleId: 42,
    });
    state = reduceEditorState(state, { type: "lock-acquired" });
    state = reduceEditorState(state, {
      type: "load-failed",
      message: "网络错误",
    });
    expect(state.phase).toBe("load-error");
    expect(state.error).toBe("网络错误");
    expect(canSave(state)).toBe(false);
    expect(
      reduceEditorState(state, { type: "edit", form: loadedForm() })
    ).toEqual(state);
    const retry = reduceEditorState(state, { type: "retry-load" });
    expect(retry.phase).toBe("loading-content");
    expect(retry.error).toBe(null);
  });

  it("会话失效保留表单内容供同步落盘草稿，退出不清正文", () => {
    const expired = reduceEditorState(dirtyState(), {
      type: "session-expired",
    });
    expect(expired.phase).toBe("closed");
    expect(expired.lockHeld).toBe(false);
    expect(expired.form.content).toBe("未保存正文");
    expect(expired.baseline.content).toBe("正文");
  });
});

describe("Esc 分层与刷新保护", () => {
  it("Esc 先关最上层弹窗，没有弹窗才触发未保存保护", () => {
    const withDialog = reduceEditorState(readyState(), {
      type: "open-dialog",
      dialog: "link",
    });
    expect(withDialog.dialog).toBe("link");
    const closedDialog = reduceEditorState(withDialog, { type: "esc" });
    expect(closedDialog.dialog).toBe("none");
    expect(closedDialog.phase).toBe("ready");

    const prompted = reduceEditorState(dirtyState(), { type: "esc" });
    expect(prompted.dialog).toBe("unsaved");
    expect(prompted.phase).toBe("ready");
    expect(reduceEditorState(prompted, { type: "esc" }).dialog).toBe("none");

    const cleanEsc = reduceEditorState(readyState(), { type: "esc" });
    expect(cleanEsc.phase).toBe("closed");
    expect(cleanEsc.lockHeld).toBe(false);
  });

  it("shouldBlockUnload 只在编辑器打开且脏时为真", () => {
    expect(shouldBlockUnload(readyState())).toBe(false);
    expect(shouldBlockUnload(dirtyState())).toBe(true);
    const saved = reduceEditorState(
      reduceEditorState(dirtyState(), { type: "save" }),
      { type: "save-ok" }
    );
    expect(shouldBlockUnload(saved)).toBe(false);
    expect(shouldBlockUnload(initialEditorState())).toBe(false);
  });
});
