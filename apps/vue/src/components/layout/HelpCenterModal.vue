<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useToast } from '../../composables/useToast'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { push } = useToast()

const HELP_LINKS = [
  {
    icon: 'book',
    title: 'Skills 使用指南',
    desc: '创建并配置智能体能力',
    toast: '已打开 Skills 使用指南',
  },
  { icon: 'plug', title: 'MCP 连接文档', desc: '连接和调试外部服务', toast: '已打开 MCP 连接文档' },
  {
    icon: 'info',
    title: '联系技术支持',
    desc: '通常在一个工作日内回复',
    toast: '已提交联系支持请求',
  },
]

const onEsc = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.open) emit('close')
}

onMounted(() => window.addEventListener('keydown', onEsc))
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc))
</script>

<template>
  <div v-if="open" class="overlay" role="presentation" @click.self="emit('close')">
    <section class="modal help-modal" role="dialog" aria-modal="true" aria-label="帮助中心">
      <div class="modal-head">
        <div>
          <span>HELP CENTER</span>
          <strong>有什么可以帮你？</strong>
        </div>
        <button class="modal-close" type="button" aria-label="关闭" @click="emit('close')">
          <AppIcon name="x" :size="19" />
        </button>
      </div>
      <label class="help-search">
        <AppIcon name="search" :size="19" />
        <input type="text" placeholder="搜索使用指南和常见问题" />
      </label>
      <div class="help-links">
        <button
          v-for="link in HELP_LINKS"
          :key="link.title"
          type="button"
          @click="push(link.toast)"
        >
          <AppIcon :name="link.icon" :size="20" />
          <span class="link-copy">
            <strong>{{ link.title }}</strong>
            <span>{{ link.desc }}</span>
          </span>
          <AppIcon class="arrow" name="chevron" :size="16" />
        </button>
      </div>
    </section>
  </div>
</template>
