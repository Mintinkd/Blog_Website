<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useAdminContext } from "../composables/adminContext";
import { t } from "../../utils/i18n.ts";
import { safeFriendLinkUrl } from "../../utils/friend-link-url";
import {
  buildFriendLinkRequest,
  decorateFriendLinks,
} from "./friend-links.logic";

const { api, feedback, catalog } = useAdminContext();
const friendLinks = catalog.friendLinks;

const safeFriendLinks = computed(() =>
  decorateFriendLinks(friendLinks.value, safeFriendLinkUrl)
);
const showFriendLinkForm = ref(false);
const friendLinkForm = ref({
  name: "",
  url: "",
  description: "",
  sort_order: 0,
  is_active: true,
});
const editingFriendLinkId = ref<number | null>(null);

async function saveFriendLink() {
  const req = buildFriendLinkRequest(
    friendLinkForm.value,
    editingFriendLinkId.value
  );
  const data = await api(req.method, req.path, req.body);
  if (data.code === 0) {
    showFriendLinkForm.value = false;
    editingFriendLinkId.value = null;
    await catalog.loadFriendLinks();
  } else {
    feedback.alert(data.message || t("admin.save_failed"));
  }
}

async function deleteFriendLink(id: number) {
  if (!feedback.confirm(t("admin.delete_confirm"))) return;
  const data = await api("DELETE", `/friend-links/${id}`);
  if (data.code === 0) await catalog.loadFriendLinks();
  else feedback.alert(data.message || t("admin.delete_failed"));
}

onMounted(() => {
  void catalog.loadFriendLinks();
});
</script>

<template>
  <div class="admin-panel">
    <div class="panel-header">
      <h2>{{ t("admin.friend_links") }}</h2>
      <button
        class="btn-primary"
        @click="
          showFriendLinkForm = true;
          editingFriendLinkId = null;
          friendLinkForm = {
            name: '',
            url: '',
            description: '',
            sort_order: 0,
            is_active: true,
          };
        "
      >
        {{ t("admin.new_friend_link") }}
      </button>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>{{ t("admin.name") }}</th>
          <th>URL</th>
          <th>{{ t("admin.description") }}</th>
          <th>{{ t("admin.sort_order") }}</th>
          <th>{{ t("admin.status") }}</th>
          <th>{{ t("admin.actions") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="fl in safeFriendLinks" :key="fl.id">
          <td :data-label="t('admin.name')">{{ fl.name }}</td>
          <td :data-label="'URL'">
            <a
              v-if="fl.safe_url"
              :href="fl.safe_url"
              target="_blank"
              style="font-size: 0.8rem"
              >{{ fl.url }}</a
            >
            <span v-else style="font-size: 0.8rem">{{ fl.url }}</span>
          </td>
          <td :data-label="t('admin.description')">
            {{ fl.description || "-" }}
          </td>
          <td :data-label="t('admin.sort_order')">{{ fl.sort_order }}</td>
          <td :data-label="t('admin.status')">
            <span
              :class="['status-badge', fl.is_active ? 'published' : 'draft']"
              >{{
                fl.is_active ? t("admin.active") : t("admin.inactive")
              }}</span
            >
          </td>
          <td class="actions" :data-label="t('admin.actions')">
            <button
              @click="
                editingFriendLinkId = fl.id;
                friendLinkForm = {
                  name: fl.name,
                  url: fl.url,
                  description: fl.description || '',
                  sort_order: fl.sort_order,
                  is_active: !!fl.is_active,
                };
                showFriendLinkForm = true;
              "
            >
              {{ t("admin.edit") }}
            </button>
            <button @click="deleteFriendLink(fl.id)" class="btn-danger">
              {{ t("admin.delete") }}
            </button>
          </td>
        </tr>
        <tr v-if="friendLinks.length === 0">
          <td colspan="6" class="empty">
            {{ t("admin.no_friend_links") }}
          </td>
        </tr>
      </tbody>
    </table>
    <div
      v-if="showFriendLinkForm"
      class="modal-overlay"
      @click.self="showFriendLinkForm = false"
    >
      <div class="modal">
        <h3>
          {{
            editingFriendLinkId
              ? t("admin.edit") + t("admin.friend_links")
              : t("admin.new_friend_link")
          }}
        </h3>
        <div class="form-group">
          <label>{{ t("admin.name") }}</label
          ><input v-model="friendLinkForm.name" />
        </div>
        <div class="form-group">
          <label>URL</label><input v-model="friendLinkForm.url" />
        </div>
        <div class="form-group">
          <label>{{ t("admin.description") }}</label
          ><input v-model="friendLinkForm.description" />
        </div>
        <div class="form-group">
          <label>{{ t("admin.sort_order") }}</label
          ><input v-model.number="friendLinkForm.sort_order" type="number" />
        </div>
        <div class="form-group">
          <label class="checkbox-label"
            ><input type="checkbox" v-model="friendLinkForm.is_active" />
            {{ t("admin.active") }}</label
          >
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showFriendLinkForm = false">
            {{ t("admin.cancel") }}
          </button>
          <button class="btn-primary" @click="saveFriendLink">
            {{ t("admin.save") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
