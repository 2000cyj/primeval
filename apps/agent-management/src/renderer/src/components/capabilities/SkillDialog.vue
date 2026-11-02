<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AppIcon from '../icons/AppIcon.vue'
import type { Capability } from '../../mocks/types'

export interface SkillFormPayload {
  name: string
  description: string
  category: string
}

/** 校验提示统一文案（原型口径） */
const REQUIRED_MESSAGE = '请完整填写名称、描述和分类'
const DESCRIPTION_MAX = 120

const props = defineProps<{
  /** 传入能力对象即为编辑模式，否则为新建 */
  capability?: Capability | null
}>()

const visible = defineModel<boolean>({ default: false })

const emit = defineEmits<{
  submit: [payload: SkillFormPayload]
}>()

const form = reactive<SkillFormPayload>({
  name: '',
  description: '',
  category: '',
})
const error = ref('')

// 打开时同步表单初值（新建用空表单，编辑用原能力字段）
watch(
  () => [visible.value, props.capability] as const,
  () => {
    if (!visible.value) return
    const cap = props.capability
    form.name = cap?.name ?? ''
    form.description = cap?.description ?? ''
    form.category = cap?.category ?? ''
    error.value = ''
  },
)

const onEsc = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && visible.value) visible.value = false
}

onMounted(() => window.addEventListener('keydown', onEsc))
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc))

const onSubmit = () => {
  const name = form.name.trim()
  const description = form.description.trim()
  const category = form.category.trim()
  if (!name || !description || !category) {
    error.value = REQUIRED_MESSAGE
    return
  }
  error.value = ''
  emit('submit', { name, description, category })
  visible.value = false
}
</script>

<template>
  <div v-if="visible" class="overlay" role="presentation" @click.self="visible = false">
    <section class="modal editor-modal" role="dialog" aria-modal="true" aria-label="Skill 编辑">
      <div class="modal-head">
        <div>
          <span>SKILL</span>
          <strong>{{ capability ? '编辑 Skill' : '新建 Skill' }}</strong>
        </div>
        <button class="modal-close" type="button" aria-label="关闭" @click="visible = false">
          <AppIcon name="x" :size="19" />
        </button>
      </div>

      <form class="editor-form" @submit.prevent="onSubmit">
        <label class="form-field">
          <span>名称<em>必填</em></span>
          <input v-model="form.name" maxlength="30" placeholder="例如：市场报告生成器" />
        </label>

        <label class="form-field">
          <span>能力描述<em>必填</em></span>
          <textarea
            v-model="form.description"
            rows="4"
            :maxlength="DESCRIPTION_MAX"
            placeholder="简要描述该能力可以完成什么任务"
          />
          <small>{{ form.description.length }}/{{ DESCRIPTION_MAX }}</small>
        </label>

        <label class="form-field">
          <span>分类<em>必填</em></span>
          <input v-model="form.category" maxlength="30" placeholder="例如：效率工具" />
        </label>

        <p v-if="error" class="form-error">{{ error }}</p>

        <div class="modal-actions">
          <button class="secondary-button" type="button" @click="visible = false">取消</button>
          <button class="primary-button" type="submit">
            {{ capability ? '保存修改' : '创建 Skill' }}
          </button>
        </div>
      </form>
    </section>
  </div>
</template>
