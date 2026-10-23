<template>
  <div class="friend-links" :class="variant === 'footer' && 'footer-variant'">
    <h3 class="links-title">友情链接</h3>
    <ul v-if="links.length > 0" class="links-list">
      <li v-for="link in safeLinks" :key="link.id" class="link-item">
        <a
          v-if="link.safe_url"
          :href="link.safe_url"
          target="_blank"
          rel="noopener noreferrer"
          class="link-url"
        >
          {{ link.name }}
        </a>
        <span v-else class="link-url">{{ link.name }}</span>
      </li>
    </ul>
    <p v-else class="no-links">暂无友情链接</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { safeFriendLinkUrl } from "../utils/friend-link-url";

const props = defineProps<{ variant?: string }>();

const links = ref<any[]>([]);

/** C1 / issue #43：渲染前兜底，协议非 http/https 不产出可点击 href（存量脏数据同样拦截） */
const safeLinks = computed(() =>
  links.value.map((link) => ({
    ...link,
    safe_url: safeFriendLinkUrl(link.url),
  }))
);

onMounted(async () => {
  try {
    const response = await fetch("/api/v1/friend-links");
    const data = await response.json();
    if (data.code === 0 && data.data) {
      links.value = data.data;
    }
  } catch (e) {
    console.error("Load friend links failed:", e);
  }
});
</script>

<style scoped>
.friend-links {
  padding: 1rem;
  background-color: var(--color-bg-secondary);
  border-radius: var(--radius-lg);
}

.links-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.75rem;
}

.links-list {
  list-style: none;
  padding: 0;
}

.link-item {
  padding: 0.4rem 0;
}

.link-url {
  color: var(--color-accent);
  font-size: 0.9rem;
}

.link-url:hover {
  color: var(--color-accent-hover);
  text-decoration: underline;
}

.no-links {
  color: var(--color-text-tertiary);
  font-size: 0.85rem;
}

/* 底部横向排列变体 */
.footer-variant {
  padding: 0;
  background-color: transparent;
  border-radius: 0;
}

.footer-variant .links-title {
  font-size: 0.95rem;
  margin-bottom: 0.6rem;
  padding-top: 1.5rem;
}

.footer-variant .links-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1.5rem;
}

.footer-variant .link-item {
  padding: 0;
}
</style>
