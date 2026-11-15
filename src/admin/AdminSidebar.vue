<script setup lang="ts">
import { computed, defineComponent, h } from "vue";
import { t } from "../utils/i18n.ts";
import { useAdminContext } from "./composables/adminContext";

/**
 * 后台侧栏：导航定义、角色可见性、登出入口。
 *
 * 拆分前是 `App.vue` 的 `<aside>` + `navItems` / `adminOnlyTabs` /
 * `visibleNavItems` / `switchTab`，这里只把「越权进入 admin-only tab」的
 * 拦截与文案原样保留，切换结果通过 emit 交回壳层。
 */
const props = defineProps<{
  role: string;
  currentTab: string;
}>();

const emit = defineEmits<{
  "switch-tab": [key: string];
  logout: [];
}>();

const { feedback } = useAdminContext();

const SvgIcon = (paths: string) =>
  defineComponent({
    render() {
      return h("svg", {
        xmlns: "http://www.w3.org/2000/svg",
        width: 16,
        height: 16,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": 2,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        innerHTML: paths,
      });
    },
  });

const navItems = [
  {
    key: "analytics",
    label: () => t("analytics.nav"),
    minRole: "admin",
    icon: SvgIcon(
      '<path d="M3 3v18h18"></path><polyline points="7 15 11 10 15 13 20 6"></polyline>'
    ),
  },
  {
    key: "articles",
    label: () => t("admin.articles"),
    minRole: "editor",
    icon: SvgIcon(
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>'
    ),
  },
  {
    key: "scrape",
    label: () => t("admin.scrape"),
    minRole: "admin",
    icon: SvgIcon(
      '<circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>'
    ),
  },
  {
    key: "categories",
    label: () => t("admin.categories"),
    minRole: "editor",
    icon: SvgIcon(
      '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>'
    ),
  },
  {
    key: "tags",
    label: () => t("admin.tags"),
    minRole: "editor",
    icon: SvgIcon(
      '<line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line><line x1="10" y1="3" x2="8" y2="21"></line><line x1="16" y1="3" x2="14" y2="21"></line>'
    ),
  },
  {
    key: "about",
    label: () => t("admin.about_page"),
    minRole: "admin",
    icon: SvgIcon(
      '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>'
    ),
  },
  {
    key: "comments",
    label: () => t("admin.comments"),
    minRole: "editor",
    icon: SvgIcon(
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>'
    ),
  },
  {
    key: "media",
    label: () => t("admin.media"),
    minRole: "editor",
    icon: SvgIcon(
      '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>'
    ),
  },
  {
    key: "friend_links",
    label: () => t("admin.friend_links"),
    minRole: "admin",
    icon: SvgIcon(
      '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>'
    ),
  },
  {
    key: "config",
    label: () => t("admin.site_config"),
    minRole: "admin",
    icon: SvgIcon(
      '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>'
    ),
  },
  {
    key: "appearance",
    label: () => "外观与个性化",
    minRole: "admin",
    icon: SvgIcon(
      '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.1 0 2-.9 2-2 0-.53-.21-1.01-.55-1.37-.34-.36-.55-.84-.55-1.38 0-1.1.9-2 2-2h2.34c2.64 0 4.79-2.15 4.79-4.79C21.63 6.32 17.31 2 12 2z"></path><circle cx="7.5" cy="10.5" r="1.5"></circle><circle cx="12" cy="7.5" r="1.5"></circle><circle cx="16.5" cy="10.5" r="1.5"></circle>'
    ),
  },
  {
    key: "users",
    label: () => t("admin.users"),
    minRole: "admin",
    icon: SvgIcon(
      '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>'
    ),
  },
];

const adminOnlyTabs = [
  "analytics",
  "scrape",
  "config",
  "users",
  "about",
  "friend_links",
  "appearance",
];

const visibleNavItems = computed(() =>
  navItems.filter(
    (item) => !(item.minRole === "admin" && props.role !== "admin")
  )
);

function switchTab(key: string): void {
  if (adminOnlyTabs.includes(key) && props.role !== "admin") {
    feedback.alert("您没有权限访问此页面");
    return;
  }
  emit("switch-tab", key);
}
</script>

<template>
  <aside class="admin-sidebar">
    <div class="sidebar-header">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
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
      <span>Blog Admin</span>
    </div>
    <nav class="sidebar-nav">
      <button
        v-for="item in visibleNavItems"
        :key="item.key"
        :class="['nav-item', { active: currentTab === item.key }]"
        @click="switchTab(item.key)"
      >
        <component :is="item.icon" />
        {{ item.label() }}
      </button>
    </nav>
    <div class="sidebar-footer">
      <a href="/" class="nav-item">{{ t("admin.back_site") }}</a>
      <button class="nav-item" @click="emit('logout')">
        {{ t("admin.logout") }}
      </button>
    </div>
  </aside>
</template>
