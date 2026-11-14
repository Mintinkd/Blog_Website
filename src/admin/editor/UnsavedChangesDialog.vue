<script setup lang="ts">
/**
 * 未保存保护三出口（T3 #64）：保存并关闭 / 放弃修改 / 继续编辑。
 * docs/ARTICLE_EDITOR_UPGRADE.md §5.6：脏状态下 X / 取消 / Esc 都走这里，
 * 「放弃」由宿主释放编辑锁并清本地草稿，「保存」不得静默关闭编辑器。
 */
import { t } from "../../utils/i18n.ts";

defineProps<{
  visible: boolean;
  saving: boolean;
}>();

const emit = defineEmits<{
  (e: "save"): void;
  (e: "discard"): void;
  (e: "continue"): void;
}>();
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay unsaved-dialog-overlay">
      <div class="modal unsaved-dialog" role="dialog" aria-modal="true">
        <h3>{{ t("admin.unsaved_title") }}</h3>
        <p>{{ t("admin.unsaved_message") }}</p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="emit('continue')">
            {{ t("admin.unsaved_continue") }}
          </button>
          <button class="btn-danger" @click="emit('discard')">
            {{ t("admin.unsaved_discard") }}
          </button>
          <button class="btn-primary" :disabled="saving" @click="emit('save')">
            {{
              saving ? t("admin.save_loading") : t("admin.unsaved_save_close")
            }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
