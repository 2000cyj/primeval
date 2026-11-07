<script setup lang="ts">
import { NIcon, NModal } from 'naive-ui'
import { ChevronRight, Copy, FilePlus2, FolderOpen, Globe } from 'lucide-vue-next'

export type CreateMethod = 'manual' | 'local' | 'url' | 'runtime'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: []; pick: [method: CreateMethod] }>()

const methods = [
  {
    key: 'manual' as const,
    title: '手动创建',
    desc: '从空白 SKILL.md 开始写。',
    icon: FilePlus2,
  },
  {
    key: 'local' as const,
    title: '从本地导入',
    desc: '选择包含 SKILL.md 的文件夹，或 .skill / .zip 压缩包。',
    icon: FolderOpen,
  },
  {
    key: 'url' as const,
    title: '从 URL 导入',
    desc: '通过 URL 拉取已发布的 skill。',
    icon: Globe,
  },
  {
    key: 'runtime' as const,
    title: '从运行时复制',
    desc: '把本地运行时里已装好的 skill 提升到工作区。',
    icon: Copy,
  },
]
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    class="create-modal"
    style="width: 460px"
    :bordered="false"
    :mask-closable="true"
    @update:show="(show: boolean) => !show && emit('close')"
  >
    <header class="modal-head">
      <div>
        <h2 class="modal-title">新建 skill</h2>
        <p class="modal-sub">选择添加 skill 的方式。</p>
      </div>
    </header>

    <ul class="method-list">
      <li v-for="method in methods" :key="method.key">
        <button type="button" class="method" @click="emit('pick', method.key)">
          <span class="method-icon" aria-hidden="true">
            <NIcon :size="18">
              <component :is="method.icon" />
            </NIcon>
          </span>
          <span class="method-text">
            <span class="method-title">{{ method.title }}</span>
            <span class="method-desc">{{ method.desc }}</span>
          </span>
          <NIcon class="method-arrow" :size="16" color="var(--c-text-4)">
            <ChevronRight />
          </NIcon>
        </button>
      </li>
    </ul>
  </NModal>
</template>

<style scoped>
.modal-head {
  margin-bottom: 16px;
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

.method-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.method {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface);
  text-align: left;
}

.method:hover {
  border-color: var(--c-border-strong);
  background: var(--c-surface-sunken);
}

.method-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
  color: var(--c-text-2);
}

.method-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.method-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text);
}

.method-desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--c-text-3);
}

.method-arrow {
  flex: none;
}
</style>
