<script setup lang="ts">
import "./admin-shared.css";
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { t, getLocale } from "../utils/i18n.ts";
import ArticlesPanel from "./articles/ArticlesPanel.vue";
import ArticleEditorOverlay from "./articles/ArticleEditorOverlay.vue";
import AdminSidebar from "./AdminSidebar.vue";
import CategoriesPanel from "./panels/CategoriesPanel.vue";
import TagsPanel from "./panels/TagsPanel.vue";
import CommentsPanel from "./panels/CommentsPanel.vue";
import MediaPanel from "./panels/MediaPanel.vue";
import ConfigPanel from "./panels/ConfigPanel.vue";
import AboutPanel from "./panels/AboutPanel.vue";
import AppearancePanel from "./panels/AppearancePanel.vue";
import UsersPanel from "./panels/UsersPanel.vue";
import FriendLinksPanel from "./panels/FriendLinksPanel.vue";
import {
  createAdminContext,
  provideAdminContext,
} from "./composables/adminContext";

// 抓取与阅读统计的依赖保持懒加载，不进入后台首屏 chunk（#69 验收）。
const ScrapePanel = defineAsyncComponent(
  () => import("./panels/ScrapePanel.vue")
);
const AnalyticsPanel = defineAsyncComponent(
  () => import("./panels/AnalyticsPanel.vue")
);

const ctx = createAdminContext();
provideAdminContext(ctx);
const { session, api, catalog, editor, locale } = ctx;

// 顶层 ref 绑定在模板里自动 unwrap，面板 / 编辑器拿到的是值而非 Ref。
const articles = catalog.articles;
const articlesLoading = catalog.articlesLoading;
const authorFilter = catalog.authorFilter;
const users = catalog.users;
const categories = catalog.categories;
const tags = catalog.tags;
const userRole = session.role;
const isLoggedIn = session.isLoggedIn;
const loadArticles = catalog.loadArticles;

const editorState = editor.state;
const editorConflict = editor.conflict;
const editorGuard = editor.guard;
const editorDraft = editor.draft;
const isEditorVisible = computed(() => editor.isOpen());

const currentTab = ref("articles");
const loginForm = ref({ username: "", password: "" });
const loginError = ref("");
const loginLoading = ref(false);

async function handleLogin() {
  loginError.value = "";
  loginLoading.value = true;
  try {
    const data = await api("POST", "/auth/login", loginForm.value);
    if (data.code === 0 && data.data?.token) {
      session.applyLogin(data.data);
      // 换账号登录后回到文章页，避免沿用上一个会话的管理员专属标签
      currentTab.value = "articles";
    } else {
      loginError.value = data.message || t("admin.login_error");
    }
  } catch (e) {
    loginError.value = t("admin.login_error");
  } finally {
    loginLoading.value = false;
  }
}

function handleLogout() {
  // 主动退出：释放编辑锁并清理该用户全部本地草稿（10003 会话失效不走这里）。
  session.logout();
  currentTab.value = "articles";
}

function switchTab(key: string) {
  currentTab.value = key;
}

function handleLocaleChanged() {
  // 只更新响应式 locale 触发重渲染，不重挂载面板，筛选 / 分页 / 数据状态保留
  locale.value = getLocale();
}

watch(isLoggedIn, (v) => {
  if (v) catalog.loadInitialData(userRole.value);
});

onMounted(() => {
  if (isLoggedIn.value) catalog.loadInitialData(userRole.value);
  document.addEventListener("locale-changed", handleLocaleChanged);
});

onBeforeUnmount(() => {
  document.removeEventListener("locale-changed", handleLocaleChanged);
});
</script>

<template>
  <div class="admin-app">
    <div v-if="!isLoggedIn" class="login-page">
      <div class="login-card">
        <div class="login-header">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path
              d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
            ></path>
          </svg>
          <h1>Blog Admin</h1>
        </div>
        <form @submit.prevent="handleLogin" class="login-form">
          <div class="form-group">
            <label>{{ t("admin.username") }}</label>
            <input
              v-model="loginForm.username"
              type="text"
              :placeholder="t('admin.username')"
              required
            />
          </div>
          <div class="form-group">
            <label>{{ t("admin.password") }}</label>
            <input
              v-model="loginForm.password"
              type="password"
              :placeholder="t('admin.password')"
              required
            />
          </div>
          <p v-if="loginError" class="error-msg">{{ loginError }}</p>
          <button type="submit" class="login-btn" :disabled="loginLoading">
            {{ loginLoading ? t("admin.login_loading") : t("admin.login") }}
          </button>
        </form>
      </div>
    </div>

    <div v-else class="admin-layout" :data-locale="locale">
      <AdminSidebar
        :role="userRole"
        :current-tab="currentTab"
        @switch-tab="switchTab"
        @logout="handleLogout"
      />

      <main class="admin-main">
        <ArticlesPanel
          v-if="currentTab === 'articles'"
          :articles="articles"
          :loading="articlesLoading"
          :author-filter="authorFilter"
          :users="users"
          :user-role="userRole"
          @new="editor.openNewArticle"
          @edit="editor.editArticle"
          @delete="editor.deleteArticle"
          @update:author-filter="editor.setAuthorFilter"
          @filter-change="loadArticles()"
        />
        <ScrapePanel v-if="currentTab === 'scrape'" />
        <CategoriesPanel v-if="currentTab === 'categories'" />
        <TagsPanel v-if="currentTab === 'tags'" />
        <AboutPanel v-if="currentTab === 'about'" />
        <ConfigPanel v-if="currentTab === 'config'" />
        <CommentsPanel v-if="currentTab === 'comments'" />
        <MediaPanel v-if="currentTab === 'media'" />
        <UsersPanel v-if="currentTab === 'users'" />
        <FriendLinksPanel v-if="currentTab === 'friend_links'" />
        <AppearancePanel v-if="currentTab === 'appearance'" />
        <AnalyticsPanel v-if="currentTab === 'analytics'" />

        <ArticleEditorOverlay
          v-if="isEditorVisible"
          :state="editorState"
          :conflict="editorConflict"
          :guard="editorGuard"
          :draft="editorDraft"
          :categories="categories"
          :tags="tags"
          :user-role="userRole"
          :get-token="editor.getToken"
          @update-form="editor.onEditorForm"
          @save="editor.onEditorSave"
          @close="editor.onEditorClose"
          @retry="editor.onEditorRetry"
          @takeover="editor.onEditorTakeover"
          @discard="editor.onEditorDiscard"
          @continue="editor.onEditorContinue"
          @open-link="editor.onEditorOpenLink"
          @open-preview="editor.onEditorOpenPreview"
          @close-dialog="editor.onEditorCloseDialog"
          @change-mode="editor.onEditorChangeMode"
          @override-guard="editor.onEditorOverrideGuard"
          @upload-error="editor.onEditorUploadError"
          @add-tag="editor.addEditorTag"
          @keep-draft="editor.onEditorKeepDraft"
          @restore-draft="editor.onEditorRestoreDraft"
          @discard-draft="editor.onEditorDiscardDraft"
        />
      </main>
    </div>
  </div>
</template>
