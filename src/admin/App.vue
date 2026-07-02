<template>
  <div class="admin-container">
    <p>管理后台加载中...</p>
    <p>请先登录：<a href="/api/v1/auth/login" target="_blank">获取Token</a></p>
  </div>
</template>

<script setup lang="ts">
</script>

<style scoped>
.admin-container {
  padding: 2rem;
  text-align: center;
}
</style>