<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAdminContext } from "../composables/adminContext";
import { t, getLocale } from "../../utils/i18n.ts";
import { formatDate as formatDatePure } from "./shared.logic";
import { buildUserRequest } from "./users.logic";

const { api, feedback, catalog } = useAdminContext();
const users = catalog.users;

const showUserForm = ref(false);
const userForm = ref({
  username: "",
  password: "",
  display_name: "",
  role: "admin",
});
const editingUserId = ref<number | null>(null);
const originalUserRole = ref<string>("");

function formatDate(d: string) {
  return formatDatePure(d, getLocale() === "zh" ? "zh" : "en");
}

async function saveUser() {
  const req = buildUserRequest(
    userForm.value,
    editingUserId.value,
    originalUserRole.value
  );
  if ("error" in req) {
    feedback.alert(t("admin.username_password_required"));
    return;
  }
  const data = await api(req.method, req.path, req.body);
  if (data.code === 0) {
    showUserForm.value = false;
    editingUserId.value = null;
    await catalog.loadUsers();
  } else {
    feedback.alert(data.message || t("admin.save_failed"));
  }
}

async function deleteUser(id: number) {
  if (!feedback.confirm(t("admin.delete_confirm"))) return;
  const data = await api("DELETE", `/users/${id}`);
  if (data.code === 0) await catalog.loadUsers();
  else feedback.alert(data.message || t("admin.delete_failed"));
}

onMounted(() => {
  void catalog.loadUsers();
});
</script>

<template>
  <div class="admin-panel">
    <div class="panel-header">
      <h2>{{ t("admin.users") }}</h2>
      <button
        class="btn-primary"
        @click="
          editingUserId = null;
          showUserForm = true;
          userForm = {
            username: '',
            password: '',
            display_name: '',
            role: 'admin',
          };
        "
      >
        {{ t("admin.new_user") }}
      </button>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>{{ t("admin.username") }}</th>
          <th>{{ t("admin.display_name") }}</th>
          <th>{{ t("admin.role") }}</th>
          <th>{{ t("admin.created_at") }}</th>
          <th>{{ t("admin.actions") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in users" :key="u.id">
          <td :data-label="t('admin.username')">{{ u.username }}</td>
          <td :data-label="t('admin.display_name')">
            {{ u.display_name || "-" }}
          </td>
          <td :data-label="t('admin.role')">
            <span :class="['status-badge', u.role]">{{
              u.role === "admin"
                ? t("admin.role_admin")
                : t("admin.role_editor")
            }}</span>
          </td>
          <td :data-label="t('admin.created_at')">
            {{ formatDate(u.created_at) }}
          </td>
          <td class="actions" :data-label="t('admin.actions')">
            <button
              @click="
                editingUserId = u.id;
                originalUserRole = u.role;
                userForm = {
                  username: u.username,
                  password: '',
                  display_name: u.display_name || '',
                  role: u.role,
                };
                showUserForm = true;
              "
            >
              {{ t("admin.edit") }}
            </button>
            <button @click="deleteUser(u.id)" class="btn-danger">
              {{ t("admin.delete") }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <div
      v-if="showUserForm"
      class="modal-overlay"
      @click.self="showUserForm = false"
    >
      <div class="modal">
        <h3>
          {{
            editingUserId
              ? t("admin.edit") + t("admin.users")
              : t("admin.new_user")
          }}
        </h3>
        <div class="form-group">
          <label>{{ t("admin.username") }}</label
          ><input v-model="userForm.username" :disabled="!!editingUserId" />
        </div>
        <div class="form-group">
          <label
            >{{ t("admin.password")
            }}{{ editingUserId ? t("admin.password_hint") : "" }}</label
          ><input
            v-model="userForm.password"
            type="password"
            :required="!editingUserId"
          />
        </div>
        <div class="form-group">
          <label>{{ t("admin.display_name") }}</label
          ><input v-model="userForm.display_name" />
        </div>
        <div class="form-group">
          <label>{{ t("admin.role") }}</label>
          <select v-model="userForm.role">
            <option value="admin">{{ t("admin.role_admin") }}</option>
            <option value="editor">{{ t("admin.role_editor") }}</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showUserForm = false">
            {{ t("admin.cancel") }}
          </button>
          <button class="btn-primary" @click="saveUser">
            {{ t("admin.save") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
