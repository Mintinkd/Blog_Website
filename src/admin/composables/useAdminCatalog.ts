import { ref } from "vue";
import type { AdminApi } from "./useAdminApi";

/**
 * 评论列表的 URL 构造。拆分前是 `App.vue` 的 `loadComments()` 行内逻辑，
 * 现在由本数据层唯一持有，`tests/admin-content-panels.test.ts` 直接锁定它，
 * 避免壳层反向依赖 `panels/*`，也避免测试锁到未被消费的镜像实现。
 */
export function commentsPath(filter: string): string {
  const status = filter ? `?status=${filter}` : "";
  return `/comments${status}`;
}

/**
 * 跨面板共享的数据层。
 *
 * 拆分前这些 ref / loader 全部散落在 `App.vue` 的 script 中，被文章列表、
 * 编辑器（分类 / 标签）、抓取（分类名 / 已有标签）和多个面板共同读取。
 * 集中到这里后 `App.vue` 只保留编排，且登录 / 切 tab 时的加载时机不变：
 * - `loadInitialData` 仍是登录与挂载时的一次性预加载；
 * - 各面板挂载时再各自调用对应的 load 刷新（等价拆分前 watch(currentTab)）。
 */
export function createAdminCatalog(api: AdminApi) {
  const articles = ref<any[]>([]);
  const articlesLoading = ref(false);
  const authorFilter = ref("");

  const categories = ref<any[]>([]);
  const tags = ref<any[]>([]);
  const users = ref<any[]>([]);

  const comments = ref<any[]>([]);
  const commentFilter = ref("");

  const mediaList = ref<any[]>([]);
  const mediaLoading = ref(false);

  const friendLinks = ref<any[]>([]);

  async function loadArticles(): Promise<void> {
    articlesLoading.value = true;
    try {
      let url = "/articles?page_size=100&status=all";
      if (authorFilter.value) url += `&author_id=${authorFilter.value}`;
      const data = await api("GET", url);
      if (data.code === 0) articles.value = data.data?.items || [];
    } finally {
      articlesLoading.value = false;
    }
  }

  async function loadCategories(): Promise<void> {
    const data = await api("GET", "/categories");
    if (data.code === 0) categories.value = data.data?.items || data.data || [];
  }

  async function loadTags(): Promise<void> {
    const data = await api("GET", "/tags");
    if (data.code === 0) tags.value = data.data?.items || data.data || [];
  }

  async function loadUsers(): Promise<void> {
    const data = await api("GET", "/users");
    if (data.code === 0) users.value = data.data || [];
  }

  async function loadComments(): Promise<void> {
    const data = await api("GET", commentsPath(commentFilter.value));
    if (data.code === 0) comments.value = data.data || [];
  }

  async function loadMedia(): Promise<void> {
    mediaLoading.value = true;
    try {
      const data = await api("GET", "/media");
      if (data.code === 0) mediaList.value = data.data?.items || [];
    } finally {
      mediaLoading.value = false;
    }
  }

  async function loadFriendLinks(): Promise<void> {
    const data = await api("GET", "/friend-links/all");
    if (data.code === 0)
      friendLinks.value = data.data?.items || data.data || [];
  }

  /** 拆分前 `loadInitialData()`：登录 / 挂载时预加载，admin 额外加载用户列表。 */
  function loadInitialData(role: string): void {
    void loadArticles();
    void loadCategories();
    void loadTags();
    void loadComments();
    void loadMedia();
    void loadFriendLinks();
    if (role === "admin") void loadUsers();
  }

  return {
    articles,
    articlesLoading,
    authorFilter,
    categories,
    tags,
    users,
    comments,
    commentFilter,
    mediaList,
    mediaLoading,
    friendLinks,
    loadArticles,
    loadCategories,
    loadTags,
    loadUsers,
    loadComments,
    loadMedia,
    loadFriendLinks,
    loadInitialData,
  };
}

export type AdminCatalog = ReturnType<typeof createAdminCatalog>;
