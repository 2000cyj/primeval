<script setup lang="ts">
/**
 * skill 编辑器（独立页面）。
 *
 * 占用 Skills 页的位置，不是弹窗 —— 要写的正文很长，弹窗框太小，
 * 而且弹窗盖着列表，用户看不到自己改的是哪个 skill。
 *
 * 左上角有「返回列表」；**有未保存改动时会先问一句** ——
 * 内容写了一半点返回就没了，是最气人的那种丢数据。
 */
import { computed, ref, watch } from 'vue'
import { NButton, NIcon, NInput, NModal, useMessage } from 'naive-ui'
import { ArrowLeft, Save } from 'lucide-vue-next'

import MarkdownEditor from '@/components/MarkdownEditor.vue'
import { readSkill, updateSkill, type SkillDetail, type SkillInfo } from '@/api/skills'

const props = defineProps<{
  /** 要编辑的 skill 名 */
  skillName: string
}>()

const emit = defineEmits<{
  /** 返回列表（放弃改动） */
  cancel: []
  /** 保存成功 */
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
const loading = ref(true)
const saving = ref(false)
/** 离开确认弹窗 */
const confirmLeave = ref(false)

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

/** 返回列表 —— 有改动先问一句 */
const back = (): void => {
  if (dirty.value) {
    confirmLeave.value = true
    return
  }
  emit('cancel')
}

/** 确认放弃改动 */
const discardAndLeave = (): void => {
  confirmLeave.value = false
  emit('cancel')
}

/** 保存 */
const save = async (): Promise<void> => {
  if (saving.value) return
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
  <section class="page">
    <header class="page-head">
      <!-- 左上角：返回列表 -->
      <NButton quaternary size="small" class="back-btn" @click="back">
        <template #icon>
          <NIcon :size="14">
            <ArrowLeft />
          </NIcon>
        </template>
        返回列表
      </NButton>

      <div class="head-row">
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
        <div class="head-actions">
          <!-- 有改动就把「未保存」摆出来 —— 别让用户以为已经存了 -->
          <span v-if="dirty" class="dirty-tag">未保存</span>
          <NButton size="small" type="primary" :loading="saving" :disabled="!dirty" @click="save">
            <template #icon>
              <NIcon :size="13">
                <Save />
              </NIcon>
            </template>
            保存
          </NButton>
        </div>
      </div>
    </header>

    <div class="editor-body">
      <MarkdownEditor v-model="content" placeholder="用 Markdown 写这个 skill 能做什么…" />
    </div>

    <!-- 离开确认：有未保存的改动 -->
    <NModal
      v-model:show="confirmLeave"
      preset="card"
      class="confirm-modal"
      style="width: 380px"
      :bordered="false"
    >
      <h3 class="confirm-title">有未保存的修改</h3>
      <p class="confirm-text">这个 skill 还有改动没保存。返回列表会丢掉这些改动 —— 要先保存吗？</p>
      <div class="confirm-actions">
        <NButton size="small" @click="confirmLeave = false">继续编辑</NButton>
        <NButton size="small" @click="save">保存并返回</NButton>
        <NButton size="small" type="error" secondary @click="discardAndLeave"> 放弃改动 </NButton>
      </div>
    </NModal>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 16px 24px 20px;
}

.page-head {
  flex: none;
  margin-bottom: 12px;
}

.back-btn {
  margin-bottom: 10px;
  margin-left: -8px;
}

.head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
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

.head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

/* 「未保存」标记 —— 别让用户以为已经存了 */
.dirty-tag {
  padding: 2px 8px;
  border: 1px solid var(--c-border-strong);
  border-radius: 999px;
  background: var(--c-surface-sunken);
  font-size: 11px;
  color: var(--c-text-2);
}

/* 编辑区占满剩下的高度 */
.editor-body {
  flex: 1;
  min-height: 0;
}

/* 离开确认 */
.confirm-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-strong);
}

.confirm-text {
  margin: 0 0 16px;
  font-size: 12px;
  color: var(--c-text-2);
  line-height: 1.6;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
