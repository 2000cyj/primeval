<script setup lang="ts">
import { ref, watch } from 'vue'
import { NButton, NIcon, NInput, NModal } from 'naive-ui'
import { Loader2, Save } from 'lucide-vue-next'
import { readSkill, updateSkill, type SkillDetail, type SkillInfo } from '@/api/skills'

const props = defineProps<{
  show: boolean
  /** 要编辑的 skill 名 */
  skillName: string | null
}>()

const emit = defineEmits<{
  close: []
  saved: [skill: SkillInfo]
}>()

/** 打开状态由父组件控制 */
const visible = defineModel<boolean>('show', { default: false })

const name = ref('')
const description = ref('')
const content = ref('')
/** 只读展示的 frontmatter 其它字段 */
const extra = ref<Record<string, string>>({})
const path = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')

watch(
  () => visible.value,
  (show) => {
    if (!show) return
    name.value = props.skillName ?? ''
    description.value = ''
    content.value = ''
    extra.value = {}
    path.value = ''
    error.value = ''
    loading.value = true
    void readSkill(props.skillName ?? '')
      .then((detail: SkillDetail) => {
        name.value = detail.name
        description.value = detail.description
        content.value = detail.content
        extra.value = detail.frontmatter
        path.value = detail.path
      })
      .catch((err: unknown) => {
        error.value = err instanceof Error ? err.message : String(err)
      })
      .finally(() => {
        loading.value = false
      })
  },
  { immediate: true },
)

const save = async () => {
  const target = props.skillName
  if (!target || saving.value) return
  const trimmed = name.value.trim()
  if (!trimmed) {
    error.value = '请填写 skill 名称'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const skill = await updateSkill({
      name: target,
      newName: trimmed === target ? undefined : trimmed,
      description: description.value,
      content: content.value,
    })
    emit('saved', skill)
    visible.value = false
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <NModal
    :show="visible"
    preset="card"
    class="edit-modal"
    :style="{ width: '640px', maxHeight: 'calc(100vh - 64px)' }"
    content-style="max-height: calc(100vh - 190px); overflow-y: auto"
    :bordered="false"
    :mask-closable="!saving"
    @update:show="(show: boolean) => !show && emit('close')"
  >
    <!-- 标题走 header 插槽：关闭按钮用卡片自带的 -->
    <template #header>
      <div class="head-text">
        <h2 class="modal-title">编辑 skill</h2>
        <p class="modal-sub" :title="path">{{ path || '正在读取…' }}</p>
      </div>
    </template>

    <div class="form">
      <label class="field">
        <span class="field-label">名称</span>
        <NInput
          v-model:value="name"
          size="small"
          maxlength="64"
          show-count
          placeholder="skill 名称"
        />
      </label>

      <label class="field">
        <span class="field-label">描述</span>
        <NInput
          v-model:value="description"
          size="small"
          maxlength="1024"
          show-count
          placeholder="简要描述该 skill 可以完成什么任务"
        />
      </label>

      <label class="field">
        <span class="field-label">SKILL.md 正文</span>
        <NInput
          v-model:value="content"
          type="textarea"
          class="content-input"
          :autosize="{ minRows: 6, maxRows: 16 }"
          placeholder="# 说明…"
        />
      </label>

      <div v-if="Object.keys(extra).length" class="extra">
        <span class="field-label">frontmatter 其它字段</span>
        <div class="extra-list">
          <span v-for="(value, key) in extra" :key="key" class="extra-item">
            <code>{{ key }}</code>
            <span>{{ value }}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- 错误与操作放 footer：内容区滚动时按钮始终可见 -->
    <template #footer>
      <div class="modal-foot">
        <p v-if="error" class="error-text" role="alert">{{ error }}</p>
        <div v-else-if="loading" class="busy-tip">
          <NIcon :size="13">
            <Loader2 class="spin" />
          </NIcon>
          读取中…
        </div>
        <div class="modal-actions">
          <NButton size="small" :disabled="saving" @click="emit('close')">取消</NButton>
          <NButton size="small" type="primary" :loading="saving" :disabled="loading" @click="save">
            <template #icon>
              <NIcon :size="14">
                <Save />
              </NIcon>
            </template>
            保存
          </NButton>
        </div>
      </div>
    </template>
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
  overflow: hidden;
  font-size: 12px;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
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

.content-input :deep(textarea) {
  font-family: var(--c-font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.6;
}

.extra {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.extra-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.extra-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
  font-size: 11px;
  color: var(--c-text-2);
}

.extra-item code {
  color: var(--c-text-3);
}

.error-text {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: rgb(180 35 24 / 10%);
  font-size: 12px;
  line-height: 1.5;
  color: #b42318;
}

.modal-foot {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.busy-tip {
  display: flex;
  align-items: center;
  gap: 6px;
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
