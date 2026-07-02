<template>
  <div id="admin-app">
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';

onMounted(() => {
  const token = localStorage.getItem('auth_token');
  if (!token && window.location.pathname !== '/admin/login') {
    window.location.href = '/admin/login';
  }
});
</script>

<style>
#admin-app {
  min-height: 100vh;
  background-color: var(--color-bg-secondary);
}
</style>