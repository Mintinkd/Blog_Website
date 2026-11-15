<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAdminContext } from "../composables/adminContext";
import { t } from "../../utils/i18n.ts";
import {
  parseProfileForm,
  emptyProfileForm,
  buildProfilePayload,
  type ProfileForm,
} from "./about.logic";

const { api, feedback, session } = useAdminContext();
const token = session.token;

const configLoading = ref(false);
const aboutContent = ref("");
const aboutSaving = ref(false);
const aboutMsg = ref("");

const profileForm = ref<ProfileForm>(emptyProfileForm());
const profileSaving = ref(false);
const profileAvatarUploading = ref(false);
const profileMsg = ref("");

async function loadConfig() {
  configLoading.value = true;
  try {
    const data = await api("GET", "/config/all");
    if (data.code === 0 && data.data) {
      aboutContent.value = data.data.about_content || "";
      profileForm.value = parseProfileForm(data.data.profile_card);
    }
  } finally {
    configLoading.value = false;
  }
}
onMounted(loadConfig);

async function saveAbout() {
  aboutSaving.value = true;
  aboutMsg.value = "";
  try {
    const data = await api("PUT", "/config", {
      about_content: aboutContent.value,
    });
    if (data.code === 0) aboutMsg.value = t("admin.save_success");
    else aboutMsg.value = data.message || t("admin.save_failed");
  } finally {
    aboutSaving.value = false;
  }
}

async function saveProfile() {
  profileSaving.value = true;
  profileMsg.value = "";
  try {
    // 半填 / 全空的示例行不提交，由后端白名单与协议校验兜住剩下的非法地址
    const data = await api("PUT", "/config", {
      profile_card: JSON.stringify(buildProfilePayload(profileForm.value)),
    });
    if (data.code === 0) profileMsg.value = t("admin.save_success");
    else profileMsg.value = data.message || t("admin.save_failed");
  } catch {
    profileMsg.value = t("admin.save_failed");
  } finally {
    profileSaving.value = false;
  }
}

async function uploadProfileAvatar(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  profileAvatarUploading.value = true;
  profileMsg.value = "";
  const formData = new FormData();
  formData.append("file", file);
  try {
    const res = await fetch(`${api.apiBase}/media/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.value}` },
      body: formData,
    });
    const data = await res.json();
    if (data.code === 0 && data.data?.url) {
      profileForm.value.avatar = data.data.url;
      profileMsg.value = "头像已上传，请点「保存名片」生效";
    } else {
      feedback.alert(data.message || t("admin.upload_failed"));
    }
  } catch {
    feedback.alert(t("admin.upload_failed"));
  } finally {
    profileAvatarUploading.value = false;
    input.value = "";
  }
}

function addProfileLink() {
  if (profileForm.value.links.length >= 6) return;
  profileForm.value.links.push({ label: "", url: "" });
}

function removeProfileLink(index: number) {
  profileForm.value.links.splice(index, 1);
}
</script>

<template>
  <div class="admin-panel">
    <div class="panel-header">
      <h2>{{ t("admin.about_page") }}</h2>
      <a
        href="/about"
        target="_blank"
        class="btn-secondary"
        style="
          font-size: 0.8rem;
          padding: 0.35rem 0.75rem;
          text-decoration: none;
        "
        >{{ t("admin.preview_page") }}</a
      >
    </div>
    <div v-if="configLoading" class="loading">
      {{ t("common.loading") }}
    </div>
    <div v-else class="config-form">
      <p
        style="
          font-size: 0.85rem;
          color: var(--color-text-tertiary);
          margin-bottom: 1rem;
        "
      >
        {{ t("admin.about_hint") }}
      </p>

      <!-- 个人名片：展示在 /about 页面顶部，与下方 Markdown 正文互不干扰 -->
      <div class="profile-editor">
        <div class="profile-editor-head">
          <h3>个人名片</h3>
          <span>展示在 /about 页面顶部；留空的字段前台会自动隐藏</span>
        </div>

        <div class="form-group">
          <label>头像</label>
          <div class="profile-avatar-row">
            <div class="profile-avatar-preview">
              <img
                v-if="profileForm.avatar"
                :src="profileForm.avatar"
                alt="头像预览"
              />
              <span v-else class="profile-avatar-initial">?</span>
            </div>
            <div class="profile-avatar-actions">
              <label class="btn-secondary profile-upload-btn">
                {{
                  profileAvatarUploading
                    ? t("common.loading")
                    : t("admin.upload")
                }}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  :disabled="profileAvatarUploading"
                  @change="uploadProfileAvatar"
                  style="display: none"
                />
              </label>
              <button
                v-if="profileForm.avatar"
                class="btn-secondary"
                @click="profileForm.avatar = ''"
              >
                移除头像
              </button>
              <p class="profile-tip">
                支持 PNG / JPG / GIF / WebP / SVG，≤
                10MB。上传后需点「保存名片」才生效。
              </p>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label>姓名</label>
          <input
            v-model="profileForm.name"
            maxlength="80"
            placeholder="例如：老大 / Laoda"
          />
        </div>
        <div class="form-group">
          <label>职位 / 头衔</label>
          <input
            v-model="profileForm.role"
            maxlength="120"
            placeholder="例如：独立开发者 · Indie Maker"
          />
        </div>
        <div class="form-group">
          <label>简介</label>
          <textarea
            v-model="profileForm.bio"
            rows="3"
            maxlength="500"
            placeholder="一句话介绍自己"
          ></textarea>
        </div>

        <div class="form-group">
          <label>社交联系方式</label>
          <div
            v-for="(link, index) in profileForm.links"
            :key="index"
            class="profile-link-row"
          >
            <input
              v-model="link.label"
              maxlength="30"
              placeholder="名称"
              class="profile-link-label"
            />
            <input
              v-model="link.url"
              maxlength="500"
              placeholder="https://... / mailto:... / /rss.xml"
              class="profile-link-url"
            />
            <button
              class="btn-danger profile-link-remove"
              @click="removeProfileLink(index)"
            >
              删除
            </button>
          </div>
          <button
            class="btn-secondary"
            :disabled="profileForm.links.length >= 6"
            @click="addProfileLink"
          >
            + 添加链接
          </button>
          <p class="profile-tip">
            最多 6 条；仅支持 http(s)://、mailto: 与站内 /
            路径。名称或地址留空的行保存时自动忽略。
          </p>
        </div>

        <div class="profile-editor-actions">
          <button
            class="btn-primary"
            :disabled="profileSaving"
            @click="saveProfile"
          >
            {{ profileSaving ? t("admin.save_loading") : "保存名片" }}
          </button>
          <span v-if="profileMsg" class="msg">{{ profileMsg }}</span>
        </div>
      </div>

      <div class="profile-editor-divider"></div>

      <div class="form-group">
        <label>关于页内容 (Markdown)</label>
        <textarea
          v-model="aboutContent"
          rows="20"
          class="editor-textarea"
        ></textarea>
      </div>
      <button class="btn-primary" @click="saveAbout" :disabled="aboutSaving">
        {{ aboutSaving ? t("admin.save_loading") : t("admin.save") }}
      </button>
      <p v-if="aboutMsg" class="msg">{{ aboutMsg }}</p>
    </div>
  </div>
</template>
