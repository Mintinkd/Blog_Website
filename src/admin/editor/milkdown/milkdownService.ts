/**
 * 回写守卫的编辑器往返服务（T4 #65）。
 *
 * `useArticleEditor` 的守卫只认识 `roundTrip(markdown) => Promise<string>`，
 * 这里用一个隐藏的、与可见编辑器**同装配**的内核实例执行「解析 → 立即序列化」，
 * 结果只用于语义比较，绝不写回表单正文。Milkdown 通过动态 import 加载，
 * 只有真正打开编辑器（或执行加载判定）时才进入 chunk。
 */
import type { MilkdownEditorHandle } from "./createEditor";

let enginePromise: Promise<MilkdownEditorHandle> | null = null;

function createHeadlessRoot(): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-editor-roundtrip", "1");
  root.setAttribute("aria-hidden", "true");
  root.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;";
  document.body.appendChild(root);
  return root;
}

/** 并发调用共享同一实例；创建失败时清缓存，允许下一次重试。 */
export async function roundTripMarkdown(markdown: string): Promise<string> {
  if (!enginePromise) {
    enginePromise = import("./createEditor")
      .then(({ createMilkdownEditor }) =>
        createMilkdownEditor(createHeadlessRoot(), { defaultValue: "" })
      )
      .catch((error: unknown) => {
        enginePromise = null;
        throw error;
      });
  }
  const engine = await enginePromise;
  return engine.roundTrip(markdown);
}
