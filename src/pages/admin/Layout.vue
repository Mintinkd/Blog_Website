<template>
  <div class="admin-layout">
    <aside class="admin-sidebar">
      <div class="sidebar-header">
        <h2>管理后台</h2>
      </div>
      <nav class="sidebar-nav">
        <a href="/admin/dashboard" :class="{ active: currentPage === 'dashboard' }">仪表盘</a>
        <a href="/admin/articles" :class="{ active: currentPage === 'articles' }">文章管理</a>
        <a href="/admin/comments" :class="{ active: currentPage === 'comments' }">评论管理</a>
        <a href="/admin/media" :class="{ active: currentPage === 'media' }">素材管理</a>
        <a href="/admin/config" :class="{ active: currentPage === 'config' }">网站配置</a>
        <a href="/admin/links" :class="{ active: currentPage === 'links' }">友情链接</a>
      </nav>
      <div class="sidebar-footer">
        <a href="/" target="_blank">查看网站</a>
        <a href="#" @click.prevent="logout">退出登录</a>
      </div>
    </aside>
    <main class="admin-main">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

defineProps<{ currentPage: string }>();

function logout() {
  localStorage.removeItem('auth_token');
  window.location.href = '/admin/login';
}
</script>

<style scoped>
.admin-layout {
  display: flex;
  min-height: 100vh;
}

.admin-sidebar {
  width: 240px;
  background-color: var(--color-bg-primary);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
}

.sidebar-header {
  padding: 1.5rem;
  border-bottom: 1px solid var(--color-border);
}

.sidebar-header h2 {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.sidebar-nav {
  flex: 1;
  padding: 0.5rem 0;
}

.sidebar-nav a {
  display: block;
  padding: 0.7rem 1.5rem;
  color: var(--color-text-secondary);
  font-size: 0.95rem;
  transition: all 0.2s;
}

.sidebar-nav a:hover,
.sidebar-nav a.active {
  color: var(--color-accent);
  background-color: var(--color-accent-light);
}

.sidebar-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border);
  display: flex;
  gap: 1rem;
}

.sidebar-footer a {
  font-size: 0.85rem;
  color: var(--color-text-tertiary);
}

.sidebar-footer a:hover {
  color: var(--color-accent);
}

.admin-main {
  flex: 1;
  margin-left: 240px;
  padding: 2rem;
  background-color: var(--color-bg-secondary);
}

@media (max-width: 767px) {
  .admin-sidebar {
    width: 200px;
  }
  .admin-main {
    margin-left: 200px;
  }
}
</style>