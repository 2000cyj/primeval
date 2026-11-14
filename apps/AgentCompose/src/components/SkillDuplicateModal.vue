<script setup lang="ts">
import { ref, watch } from 'vue'
import { NButton, NIcon, NInput, NModal } from 'naive-ui'
import { Copy, Loader2 } from 'lucide-vue-next'
import { duplicateSkill, type SkillInfo } from '@/api/skills'

const props = defineProps<{
  show: boolean
  /** 被复制的 skill 名 */
  skillName: string | null
}>()

const emit = defineEmits<{
  close: []
  created: [skill: SkillInfo]
}>()

/** 打开状态由父组件控制 */
const visible = defineModel<boolean>('show', { default: false })

const newName = ref('')
const busy = ref(false)
const error = ref('')

watch(
  () => visible.value,
  (show) => {
    if (!show) return
    newName.value = props.skillName ? `${props.skillName} 副本` : ''
    error.value = ''
  },
  { immediate: true },
)

const submit = async () => {
  const trimmed = newName.value.trim()
  if (!props.skillName || !trimmed) {
    error.value = '请填写副本名称'
    return
  }
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const skill = await duplicateSkill(props.skillName, trimmed)
    emit('created', skill)
    visible.value = false
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <NModal
    :show="visible"
    preset="card"
    class="duplicate-modal"
    :style="{ width: '400px', maxHeight: 'calc(100vh - 64px)' }"
    :bordered="false"
    :mask-closable="!busy"
    @update:show="(show: boolean) => !show && emit('close')"
  >
    <!-- 标题走 header 插槽：关闭按钮用卡片自带的 -->
    <template #header>
      <div class="head-text">
        <h2 class="modal-title">创建副本</h2>
        <p class="modal-sub">复制「{{ props.skillName }}」的全部文件，新副本会改用新名字。</p>
      </div>
    </template>

    <label class="field">
      <span class="field-label">副本名称</span>
      <NInput
        v-model:value="newName"
        size="small"
        maxlength="64"
        placeholder="例如：知识库检索 副本"
        @update:value="error = ''"
      />
    </label>

    <p v-if="error" class="error-text" role="alert">{{ error }}</p>

    <div class="modal-actions">
      <NButton size="small" :disabled="busy" @click="emit('close')">取消</NButton>
      <NButton size="small" type="primary" :loading="busy" @click="submit">
        <template #icon>
          <NIcon :size="14">
            <Copy />
          </NIcon>
        </template>
        创建副本
      </NButton>
    </div>

    <div v-if="busy" class="busy-tip">
      <NIcon :size="13">
        <Loader2 class="spin" />
      </NIcon>
      复制中…
    </div>
  </NModal>
</template>

<style scoped>
/* 卡片自带的关闭按钮绝对定位在右上角，标题要给右边让位 */
.head-text {
  min-width: 0;
  padding-right: 28px;
}

.modal-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.modal-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-text-3);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  color: var(--c-text-3);
}

.error-text {
  margin: 12px 0 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: rgb(180 35 24 / 10%);
  font-size: 12px;
  line-height: 1.5;
  color: #b42318;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.busy-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--c-text-3);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
