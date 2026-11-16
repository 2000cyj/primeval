<script setup lang="ts">
/**
 * skill 编辑器（大页面）。
 *
 * 流程是「小弹窗填名字 → 大页面写正文」：
 * 名字在创建时定，正文和描述在这里写 —— 两件事分开，各管一段。
 *
 * 预览用项目自己的 MarkdownView（marked + DOMPurify），跟 Wiki 页共用
 * 同一个 MarkdownEditor 组件 —— 两边写 Markdown 的手感得一样。
 */
import { computed, ref, watch } from 'vue'
import { NButton, NIcon, NInput, NModal, useMessage } from 'naive-ui'
import { Save } from 'lucide-vue-next'

import MarkdownEditor from '@/components/MarkdownEditor.vue'
import { readSkill, updateSkill, type SkillDetail, type SkillInfo } from '@/api/skills'

const props = defineProps<{
  /** 要编辑的 skill 名；null = 没打开 */
  skillName: string | null
}>()

const emit = defineEmits<{
  close: []
  saved: [skill: SkillInfo]
}>()

const message = useMessage()

/** 名称 */
const name = ref('')
/** 描述 */
const description = ref('')
/** 正文（SKILL.md 去掉 frontmatter 的部分） */
const content = ref('')
/** 打开时的原始值 —— 用来算有没有改动 */
const original = ref({ name: '', description: '', content: '' })
/** 加载中 / 保存中 */
const loading = ref(false)
const saving = ref(false)

/** 打开 skill 时读一遍 */
watch(
  () => props.skillName,
  (skillName) => {
    if (!skillName) return
    loading.value = true
    void readSkill(skillName)
      .then((detail: SkillDetail) => {
        name.value = detail.name
        description.value = detail.description
        content.value = detail.content
        original.value = {
          name: detail.name,
          description: detail.description,
          content: detail.content,
        }
      })
      .catch((error: unknown) => {
        message.error(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        loading.value = false
      })
  },
  { immediate: true },
)

/** 有没有改动 */
const dirty = computed(
  () =>
    name.value !== original.value.name ||
    description.value !== original.value.description ||
    content.value !== original.value.content,
)

/** 保存 */
const save = async (): Promise<void> => {
  if (!props.skillName || saving.value) return
  saving.value = true
  try {
    const info = await updateSkill({
      name: props.skillName,
      newName: name.value.trim(),
      description: description.value.trim(),
      content: content.value,
    })
    message.success('已保存')
    original.value = {
      name: info.name,
      description: info.description,
      content: content.value,
    }
    emit('saved', info)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <NModal
    :show="props.skillName !== null"
    preset="card"
    class="skill-editor-modal"
    style="width: min(1180px, 94vw)"
    :bordered="false"
    :mask-closable="false"
    @update:show="(value: boolean) => !value && emit('close')"
  >
    <header class="modal-head">
      <div class="head-fields">
        <NInput
          v-model:value="name"
          class="name-input"
          size="small"
          maxlength="64"
          placeholder="skill 名称"
        />
        <NInput
          v-model:value="description"
          class="desc-input"
          size="small"
          maxlength="1024"
          placeholder="这个 skill 能完成什么任务（一两句话）"
        />
      </div>
      <div class="modal-actions">
        <NButton size="small" :disabled="saving" @click="emit('close')">关闭</NButton>
        <NButton size="small" type="primary" :loading="saving" :disabled="!dirty" @click="save">
          <template #icon>
            <NIcon :size="13">
              <Save />
            </NIcon>
          </template>
          保存
        </NButton>
      </div>
    </header>

    <div class="editor-body">
      <MarkdownEditor v-model="content" placeholder="用 Markdown 写这个 skill 能做什么…" />
    </div>
  </NModal>
</template>

<style scoped>
.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--c-border);
}

.head-fields {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.name-input {
  font-weight: 600;
}

.modal-actions {
  display: flex;
  gap: 8px;
  flex: none;
}

/*
 * 编辑区要占满弹窗剩下的高度。
 *
 * NModal preset="card" 的内容容器默认不是 flex —— 不给 display: flex，
 * .editor-body 的 flex: 1 不起作用，编辑器就按内容高度排（下面留一片空白）。
 * 用 :deep() 打到卡片内容容器上。
 */
.editor-body {
  flex: 1;
  min-height: 0;
  margin-top: 12px;
}

/*
 * 卡片尺寸加在 .n-card 上，不靠 NModal 的 style 属性 ——
 * style 落在 .n-modal（遮罩层）上，撑不到卡片。
 */
:deep(.n-card) {
  height: min(880px, 92vh);
  max-height: 92vh;
}

/* 卡片内容容器：竖向 flex，让编辑区能撑满 */
:deep(.n-card__content) {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
</style>
