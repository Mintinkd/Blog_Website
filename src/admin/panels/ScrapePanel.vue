<template>
  <div class="admin-panel">
    <div class="panel-header">
      <h2>{{ t("admin.scrape") }}</h2>
    </div>
    <div class="scrape-form">
      <input
        v-model="scrapeUrl"
        type="url"
        :placeholder="t('admin.scrape_url_placeholder')"
        :disabled="scrapeLoading"
        @keydown.enter.prevent="runScrape"
      />
      <button class="btn-primary" :disabled="scrapeLoading" @click="runScrape">
        {{
          scrapeLoading ? t("admin.scrape_loading") : t("admin.scrape_button")
        }}
      </button>
    </div>

    <div v-if="scrapeError" class="scrape-error">
      <p>{{ scrapeError }}</p>
      <button
        class="btn-secondary"
        :disabled="scrapeLoading"
        @click="runScrape"
      >
        {{ t("admin.scrape_retry") }}
      </button>
    </div>

    <div v-if="scrapePreview" class="scrape-preview">
      <h3>
        {{ scrapePreview.title || t("admin.scrape_no_title") }}
      </h3>
      <p v-if="scrapePreview.summary" class="scrape-summary">
        {{ scrapePreview.summary }}
      </p>
      <div
        v-if="scrapePreview.coverImage && !scrapeCoverFailed"
        class="scrape-cover"
      >
        <img
          :src="scrapePreview.coverImage"
          :alt="scrapePreview.title"
          loading="lazy"
          referrerpolicy="no-referrer"
          @error="scrapeCoverFailed = true"
        />
      </div>
      <p v-else class="scrape-hint">
        {{ t("admin.scrape_no_cover") }}
      </p>
      <p class="scrape-meta">
        {{ t("admin.scrape_final_url") }}:
        <a
          :href="scrapePreview.finalUrl"
          target="_blank"
          rel="noopener noreferrer"
          >{{ scrapePreview.finalUrl }}</a
        >
      </p>
      <p class="scrape-meta">
        {{
          t("admin.scrape_word_count", {
            count: scrapePreview.wordCount,
          })
        }}
        ·
        {{ t("admin.scrape_images", { count: scrapePreview.images.total }) }}
        · {{ t("admin.scrape_charset") }}: {{ scrapePreview.charset }}
      </p>
      <p class="scrape-meta">
        {{ t("admin.scrape_tags") }}:
        {{
          scrapePreview.tags.length
            ? scrapePreview.tags.join(", ")
            : t("admin.scrape_no_tags")
        }}
        · {{ t("admin.scrape_category") }}: {{ scrapeCategoryName }} ·
        {{ t("admin.scrape_status") }}: {{ t("article.draft") }}
      </p>
      <p v-if="scrapePreview.images.unresolved > 0" class="scrape-warning">
        {{
          t("admin.scrape_images_broken", {
            count: scrapePreview.images.unresolved,
          })
        }}
      </p>
      <p v-else-if="scrapePreview.images.total > 0" class="scrape-hint">
        {{ t("admin.scrape_images_external") }}
      </p>
      <p
        v-if="scrapePreview.robotsStatus === 'unchecked'"
        class="scrape-warning"
      >
        {{ t("admin.scrape_robots_unchecked") }}
      </p>
      <p
        v-for="warning in scrapePreview.warnings"
        :key="warning"
        class="scrape-warning"
      >
        {{ scrapeWarningText(warning) }}
      </p>
      <div class="scrape-selector">
        <input
          v-model="scrapeSelector"
          type="text"
          :placeholder="t('admin.scrape_selector_placeholder')"
          :disabled="scrapeLoading"
          @keydown.enter.prevent="reextractScrape"
        />
        <button
          class="btn-secondary"
          :disabled="scrapeLoading"
          @click="reextractScrape"
        >
          {{ t("admin.scrape_selector_button") }}
        </button>
      </div>
      <p v-if="scrapeSelectorError" class="scrape-selector-error">
        {{ scrapeSelectorError }}
      </p>
      <div class="scrape-actions">
        <button
          class="btn-secondary"
          :disabled="scrapeLoading"
          @click="runScrape"
        >
          {{ t("admin.scrape_again") }}
        </button>
        <button
          class="btn-primary"
          :disabled="!scrapePreview.markdown.trim()"
          @click="editScrapedDraft"
        >
          {{ t("admin.scrape_generate_draft") }}
        </button>
      </div>
      <div class="content-label-row">
        <label>{{ t("admin.scrape_preview") }}</label>
        <div class="preview-toggle">
          <button
            :class="['toggle-btn', { active: scrapeViewMode === 'markdown' }]"
            @click="scrapeViewMode = 'markdown'"
          >
            {{ t("admin.scrape_markdown") }}
          </button>
          <button
            :class="['toggle-btn', { active: scrapeViewMode === 'rendered' }]"
            @click="scrapeViewMode = 'rendered'"
          >
            {{ t("admin.scrape_rendered") }}
          </button>
        </div>
      </div>
      <pre v-if="scrapeViewMode === 'markdown'" class="scrape-markdown">{{
        scrapePreview.markdown
      }}</pre>
      <div
        v-else
        class="scrape-rendered prose"
        v-html="scrapePreviewHtml"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useAdminContext } from "../composables/adminContext";
import { t } from "../../utils/i18n.ts";
import { renderMarkdown } from "../../utils/markdown";
import type { ScrapeDraft, ScrapeWarning } from "../../utils/scrape";
import {
  previewFromDraft,
  scrapeWarningKey,
  buildScrapeOptions,
  resolveFinalUrl,
  resolveRobotsStatus,
} from "./scrape.logic";

const { api, feedback, catalog, editor, session } = useAdminContext();

// 顶层同名绑定：<script setup> 会自动 unwrap，模板里不写 catalog.xxx / session.xxx
const categories = catalog.categories;
const tags = catalog.tags;
const token = session.token;

interface ScrapeSource {
  html: string;
  finalUrl: string;
  decodeWarnings: ScrapeWarning[];
  /** 首次抓取时间；selector 重提取沿用，避免脚注日期漂移 */
  scrapedAt: Date;
}

interface ScrapePreview extends ScrapeDraft {
  finalUrl: string;
  robotsStatus: "allowed" | "unchecked";
  charset: string;
}
const scrapeUrl = ref("");
const scrapeLoading = ref(false);
const scrapeError = ref("");
const scrapeSource = ref<ScrapeSource | null>(null);
const scrapeSelector = ref("");
const scrapeSelectorError = ref("");
const scrapePreview = ref<ScrapePreview | null>(null);
const scrapeViewMode = ref<"markdown" | "rendered">("markdown");
const scrapeCoverFailed = ref(false);

const scrapePreviewHtml = computed(() => {
  const markdown = scrapePreview.value?.markdown;
  if (!markdown) return "";
  try {
    return renderMarkdown(markdown);
  } catch {
    return "";
  }
});

const scrapeCategoryName = computed(() => {
  const id = scrapePreview.value?.categoryId;
  const category = categories.value.find((item) => Number(item.id) === id);
  return category?.name || t("admin.scrape_default_category");
});

// 新预览 / 重新提取后重置封面加载失败状态
watch(scrapePreview, () => {
  scrapeCoverFailed.value = false;
});

function scrapeWarningText(warning: ScrapeWarning): string {
  return t(scrapeWarningKey(warning));
}

/** 初次抓取与 selector 重提取共用同一组标签/日期参数。 */
function scrapeBuildOptions(scrapedAt: Date) {
  return buildScrapeOptions(
    tags.value.map((tag) => tag.name),
    scrapedAt
  );
}

async function runScrape() {
  const target = scrapeUrl.value.trim();
  if (!target) {
    scrapeError.value = t("admin.scrape_url_required");
    return;
  }
  if (
    scrapePreview.value &&
    !feedback.confirm(t("admin.scrape_replace_confirm"))
  ) {
    return;
  }

  scrapeLoading.value = true;
  scrapeError.value = "";
  scrapeSelectorError.value = "";
  const scrapedAt = new Date();
  try {
    const res = await fetch(
      `${api.apiBase}/admin/scrape?url=${encodeURIComponent(target)}`,
      { headers: { Authorization: `Bearer ${token.value}` } }
    );
    if (!res.ok) {
      let message = t("admin.scrape_failed");
      try {
        const data = await res.json();
        if (data?.message) message = data.message;
      } catch {
        // 非 JSON 错误响应保留通用文案
      }
      scrapeError.value = message;
      return;
    }

    const bytes = await res.arrayBuffer();
    const finalHeader = res.headers.get("X-Final-URL");
    const finalUrl = resolveFinalUrl(target, finalHeader);
    const robotsStatus = resolveRobotsStatus(
      res.headers.get("X-Robots-Status")
    );

    const { buildScrapeDraft, decodeHtmlBytes } =
      await import("../../utils/scrape");
    // #34：按 BOM / Content-Type / <meta charset> 解码字节，未知字符集回退 UTF-8
    const decoded = decodeHtmlBytes(bytes, res.headers.get("Content-Type"));
    // #35：元数据映射只匹配已有标签；来源脚注日期固定为本次抓取日期
    const draft: ScrapeDraft = buildScrapeDraft(
      decoded.html,
      finalUrl,
      scrapeBuildOptions(scrapedAt)
    );

    // 原始 HTML 留在内存，供 selector「重新提取」本地重跑（不重新请求源站）
    scrapeSource.value = {
      html: decoded.html,
      finalUrl,
      decodeWarnings: decoded.warnings,
      scrapedAt,
    };
    scrapeSelector.value = "";
    scrapePreview.value = previewFromDraft(draft, decoded.warnings, {
      finalUrl,
      robotsStatus,
      charset: decoded.charset,
    });
    // 空正文也保留预览与 selector，允许在已抓取的 HTML 上手动覆盖
    if (!draft.markdown.trim()) {
      scrapeSelectorError.value = t("admin.scrape_empty");
    }
  } catch {
    scrapeError.value = t("admin.scrape_failed");
  } finally {
    scrapeLoading.value = false;
  }
}

/**
 * 在已抓取的 HTML 上按手动 selector 重新提取；失败时保留上一份预览，
 * 错误只显示在 selector 行下方（不影响「重新抓取」的错误区）。
 */
async function reextractScrape() {
  const source = scrapeSource.value;
  const current = scrapePreview.value;
  if (!source || !current) return;

  scrapeSelectorError.value = "";

  let mod: typeof import("../../utils/scrape");
  try {
    mod = await import("../../utils/scrape");
  } catch {
    scrapeSelectorError.value = t("admin.scrape_selector_failed");
    return;
  }

  try {
    const draft = mod.buildScrapeDraft(source.html, source.finalUrl, {
      selector: scrapeSelector.value,
      ...scrapeBuildOptions(source.scrapedAt),
    });
    scrapePreview.value = previewFromDraft(draft, source.decodeWarnings, {
      finalUrl: current.finalUrl,
      robotsStatus: current.robotsStatus,
      charset: current.charset,
    });
    // 命中但正文为空（例如只选中了标题 H1）仍算命中，预览照常替换
    if (!draft.markdown.trim()) {
      scrapeSelectorError.value = t("admin.scrape_empty");
    }
  } catch (error) {
    if (error instanceof mod.ScrapeSelectorError) {
      scrapeSelectorError.value =
        error.code === "selector_invalid"
          ? t("admin.scrape_selector_invalid")
          : t("admin.scrape_selector_no_match");
    } else {
      scrapeSelectorError.value = t("admin.scrape_selector_failed");
    }
  }
}

function editScrapedDraft() {
  const draft = scrapePreview.value;
  if (!draft) return;
  editor.openFromScrape({
    title: draft.title,
    slug: draft.slug,
    summary: draft.summary,
    content: draft.markdown,
    cover_image: draft.coverImage,
    category_id: String(draft.categoryId),
    status: draft.status,
    tags: [...draft.tags],
  });
}
</script>
