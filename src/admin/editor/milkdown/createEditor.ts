/**
 * Milkdown 7 所见即所得编辑内核（T4 #65 / ADR 0006）。
 *
 * 装配清单按 T0 实测修订（docs/reviews/2026-11-14-milkdown-t0-validation.md §5）：
 * 只装 7 项 —— toolbar / list-item / link-tooltip / table / block-edit /
 * placeholder / cursor。**不装 image-block**：`@milkdown/components@7.23.0`
 * 的 imageBlockSchema 把 Markdown 图片的 alt 当宽高比，会静默改写存量正文。
 * code-mirror / latex / ai / top-bar 保持关闭（包体预算）。
 *
 * 三处适配层对应 T0 的 deferred obligations：
 * - 覆盖 `uploadConfig.uploader`，用普通 `image` 节点写上传返回的相对地址；
 * - 注册 embedLink 的 remark 插件 / 节点 / NodeView（见 embedLink.ts）；
 * - 工具栏 label 用 Vue `reactive` 对象承接，监听 `locale-changed` 原地更新，
 *   语言切换不重建编辑器实例、不丢正文。
 *
 * 依赖固定 `@milkdown/*` 7.23.0（package-lock.json）；本模块只在编辑器首次
 * 打开时由 MarkdownWorkspace 动态 import，不进入后台首屏 chunk。
 */
import "@milkdown/crepe/theme/classic.css";
import { CrepeBuilder } from "@milkdown/crepe/builder";
import { blockEdit } from "@milkdown/crepe/feature/block-edit";
import { cursor } from "@milkdown/crepe/feature/cursor";
import {
  linkTooltip,
  type LinkTooltipFeatureConfig,
} from "@milkdown/crepe/feature/link-tooltip";
import { listItem } from "@milkdown/crepe/feature/list-item";
import {
  placeholder,
  placeholderConfig,
} from "@milkdown/crepe/feature/placeholder";
import { table } from "@milkdown/crepe/feature/table";
import {
  toolbar,
  type ToolbarFeatureConfig,
} from "@milkdown/crepe/feature/toolbar";
import { linkTooltipConfig } from "@milkdown/kit/component/link-tooltip";
import { EditorStatus, editorViewCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { uploadConfig } from "@milkdown/kit/plugin/upload";
import { getMarkdown, insert, replaceAll } from "@milkdown/kit/utils";
import { reactive } from "vue";
import { getLocale, t } from "../../../utils/i18n";
import { embedLinkRemark, embedLinkSchema, embedLinkView } from "./embedLink";
import { describeUploadError, uploadImageFile } from "./upload";

export interface MilkdownEditorOptions {
  defaultValue?: string;
  /** Bearer token 由宿主注入，便于测试与将来换会话来源。 */
  getToken?: () => string;
  onChange?: (markdown: string) => void;
  onUploadError?: (message: string) => void;
}

export interface MilkdownEditorHandle {
  getMarkdown(): string;
  /** 程序化替换正文（模式切换 / 草稿恢复）：不触发 onChange、不回写表单。 */
  setMarkdown(markdown: string): void;
  /** 守卫用：解析后立即序列化，不写回正文。 */
  roundTrip(markdown: string): string;
  /** LinkDialog 插入普通 / 内嵌链接片段；会触发 onChange（属于实际编辑）。 */
  insertMarkdown(snippet: string): void;
  setReadonly(value: boolean): void;
  applyLocale(): void;
  destroy(): Promise<void>;
}

function toolbarLabels(): ToolbarFeatureConfig {
  return {
    boldLabel: t("editor.toolbar_bold"),
    italicLabel: t("editor.toolbar_italic"),
    strikethroughLabel: t("editor.toolbar_strikethrough"),
    codeLabel: t("editor.toolbar_code"),
    linkLabel: t("editor.toolbar_link"),
  };
}

function defaultToken(): string {
  try {
    return localStorage.getItem("admin_token") ?? "";
  } catch {
    return "";
  }
}

export async function createMilkdownEditor(
  root: HTMLElement,
  options: MilkdownEditorOptions = {}
): Promise<MilkdownEditorHandle> {
  const getToken = options.getToken ?? defaultToken;
  // reactive 是 T0 第 10 项的解法：Crepe 的 Toolbar 组件用 computed 读取
  // config 字段，普通对象不更新；reactive 对象原地改字段即可热更新文案。
  const toolbarConfig = reactive<ToolbarFeatureConfig>(toolbarLabels());
  const linkConfig: LinkTooltipFeatureConfig = {
    inputPlaceholder: t("editor.link_placeholder"),
  };

  const builder = new CrepeBuilder({
    root,
    defaultValue: options.defaultValue ?? "",
  })
    .addFeature(toolbar, toolbarConfig)
    .addFeature(listItem)
    .addFeature(linkTooltip, linkConfig)
    .addFeature(table)
    .addFeature(blockEdit)
    .addFeature(placeholder, { text: t("editor.placeholder") })
    .addFeature(cursor);

  // 专用节点 / NodeView / remark 合并插件；tuple 展开后交给 Editor.use。
  builder.editor.use([embedLinkRemark, embedLinkSchema, embedLinkView].flat());

  // 覆盖默认 uploader（默认写 blob: URL，违反「保存只写 Markdown 相对地址」）。
  builder.editor.config((ctx) => {
    ctx.update(uploadConfig.key, (prev) => ({
      ...prev,
      // 把插入位置移到当前段落之后：在段落内部插入块级图片段落会拆出
      // 空段落，序列化成多余的 `<br />`；段落之后插入则保持原文完整。
      getInsertPos: (_event, ctx, defaultInsertPos) => {
        try {
          const view = ctx.get(editorViewCtx);
          const $pos = view.state.doc.resolve(defaultInsertPos);
          if ($pos.depth >= 1) return $pos.after(1);
        } catch {
          // 视图尚未就绪时退回插件默认位置，不阻断上传。
        }
        return defaultInsertPos;
      },
      uploader: async (files, schema) => {
        const imageType = schema.nodes.image;
        if (!imageType) return [];
        const nodes: ProseNode[] = [];
        for (let i = 0; i < files.length; i += 1) {
          const file = files.item(i);
          if (!file || !file.type.includes("image")) continue;
          try {
            const { url, alt } = await uploadImageFile(file, getToken);
            const node = imageType.createAndFill({ src: url, alt, title: "" });
            if (!node) continue;
            // T0 §5 第 2 条：直接插入 inline image 会紧贴上一段文字。
            // 包一层段落让图片独立成块；schema 不支持时退回原节点，不丢图片。
            const paragraphType = schema.nodes.paragraph;
            const block = paragraphType?.createAndFill(null, node);
            nodes.push(block ?? node);
          } catch (error) {
            // 与工具栏上传共用同一映射：预检走 i18n、服务端 message 优先。
            options.onUploadError?.(describeUploadError(error, t));
          }
        }
        return nodes;
      },
    }));
  });

  let mounted = false;
  let suppressChange = 0;
  builder.on((listener) => {
    listener.markdownUpdated((_ctx, markdown, prevMarkdown) => {
      if (!mounted || suppressChange > 0 || markdown === prevMarkdown) return;
      options.onChange?.(markdown);
    });
  });

  /** 切换语言只更新文案，不重建实例、不丢正文。 */
  function applyLocale(): void {
    Object.assign(toolbarConfig, toolbarLabels());
    if (builder.editor.status !== EditorStatus.Created) return;
    try {
      builder.editor.action((ctx) => {
        ctx.update(placeholderConfig.key, (prev) => ({
          ...prev,
          text: t("editor.placeholder"),
        }));
        ctx.update(linkTooltipConfig.key, (prev) => ({
          ...prev,
          inputPlaceholder: t("editor.link_placeholder"),
        }));
      });
    } catch {
      // 装饰性文案：极端情况（如 dev 首次依赖重优化产生模块副本、slice 尚未
      // 注入）下跳过即可，绝不能让语言切换影响编辑器实例或正文。
    }
  }

  const onLocaleChanged = (): void => applyLocale();
  document.addEventListener("locale-changed", onLocaleChanged);

  await builder.create();
  mounted = true;
  applyLocale();

  return {
    getMarkdown: () => builder.editor.action(getMarkdown()),
    setMarkdown: (markdown: string) => {
      if (builder.editor.status !== EditorStatus.Created) return;
      suppressChange += 1;
      try {
        builder.editor.action(replaceAll(markdown));
      } finally {
        // replaceAll 的 listener 可能同步或下一个微任务触发；两处都挡住，
        // 避免「打开 WYSIWYG 后不立即回写正文」被程序化 setMarkdown 破坏。
        queueMicrotask(() => {
          suppressChange = Math.max(0, suppressChange - 1);
        });
      }
    },
    roundTrip: (markdown: string) => {
      if (builder.editor.status !== EditorStatus.Created) return markdown;
      suppressChange += 1;
      try {
        builder.editor.action(replaceAll(markdown));
        return builder.editor.action(getMarkdown());
      } finally {
        queueMicrotask(() => {
          suppressChange = Math.max(0, suppressChange - 1);
        });
      }
    },
    insertMarkdown: (snippet: string) => {
      if (builder.editor.status !== EditorStatus.Created) return;
      builder.editor.action(insert(snippet, true));
    },
    setReadonly: (value: boolean) => {
      builder.setReadonly(value);
    },
    applyLocale,
    destroy: async () => {
      document.removeEventListener("locale-changed", onLocaleChanged);
      await builder.destroy();
    },
  };
}

/** 供守卫注入的装配清单（单测 / 文档可引用，避免与实现各写一份）。 */
export const MILKDOWN_FEATURES = [
  "toolbar",
  "list-item",
  "link-tooltip",
  "table",
  "block-edit",
  "placeholder",
  "cursor",
] as const;

/** 当前 locale，供 NodeView / 组件判断是否要刷新文案。 */
export function currentEditorLocale(): string {
  return getLocale();
}
