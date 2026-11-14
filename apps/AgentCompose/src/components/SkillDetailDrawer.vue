<script setup lang="ts">
import { ref, watch } from 'vue'
import { NButton, NDrawer, NDrawerContent, NIcon, NSwitch, useMessage } from 'naive-ui'
import { FolderOpen, Pencil, Trash2 } from 'lucide-vue-next'
import { readSkill, setSkillEnabled, type SkillDetail } from '@/api/skills'

const props = defineProps<{
  /** 要查看的 skill 名；null 表示关闭 */
  skillName: string | null
}>()

const emit = defineEmits<{
  close: []
  edit: [skillName: string]
  remove: [skillName: string]
  /** 启用状态变更（成功后通知列表同步） */
  toggle: [skillName: string, enabled: boolean]
}>()

const message = useMessage()

const detail = ref<SkillDetail | null>(null)
const loading = ref(false)
const loadError = ref('')

/** 来源的中文名 */
const sourceLabel = (source: string): string => {
  const labels: Record<string, string> = {
    manual: '手动创建',
    local: '从本地导入',
    url: '从 URL 导入',
    runtime: '从运行时复制',
    duplicate: '创建副本',
  }
  return labels[source] ?? source
}

/** 字节数格式化 */
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 时间格式化 */
const formatTime = (ms: number): string => {
  if (!ms) return '—'
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const load = (name: string) => {
  loading.value = true
  loadError.value = ''
  detail.value = null
  void readSkill(name)
    .then((value) => {
      detail.value = value
    })
    .catch((error: unknown) => {
      loadError.value = error instanceof Error ? error.message : String(error)
    })
    .finally(() => {
      loading.value = false
    })
}

watch(
  () => props.skillName,
  (name) => {
    if (!name) {
      detail.value = null
      loadError.value = ''
      return
    }
    load(name)
  },
  { immediate: true },
)

const toggle = (value: boolean) => {
  const name = props.skillName
  if (!name) return
  void setSkillEnabled(name, value)
    .then(() => emit('toggle', name, value))
    .catch((error: unknown) => {
      message.error(error instanceof Error ? error.message : String(error))
      load(name)
    })
}
</script>

<template>
  <NDrawer
    :show="props.skillName !== null"
    :width="430"
    placement="right"
    :trap-focus="false"
    @update:show="(show: boolean) => !show && emit('close')"
  >
    <NDrawerContent closable :native-scrollbar="false" body-content-style="padding: 0">
      <template #header>
        <span class="drawer-title">能力详情</span>
      </template>

      <div class="body">
        <section v-if="loading" class="state">读取中…</section>
        <section v-else-if="loadError" class="state error" role="alert">{{ loadError }}</section>

        <template v-else-if="detail">
          <section class="identity">
            <span class="identity-icon" aria-hidden="true">
              <NIcon :size="18">
                <FolderOpen />
              </NIcon>
            </span>
            <div class="identity-text">
              <span class="identity-name">{{ detail.name }}</span>
              <span class="identity-category">{{ sourceLabel(detail.source) }}</span>
            </div>
            <NSwitch
              :value="detail.enabled"
              size="small"
              :aria-label="`${detail.name} 状态`"
              @update:value="toggle"
            />
          </section>

          <section class="section">
            <h3 class="section-label">能力描述</h3>
            <p class="section-text">{{ detail.description || '（暂无描述）' }}</p>
          </section>

          <section class="section">
            <h3 class="section-label">基本信息</h3>
            <dl class="meta">
              <div class="meta-row">
                <dt>当前状态</dt>
                <dd :class="{ running: detail.enabled }">
                  {{ detail.enabled ? '运行中' : '已停用' }}
                </dd>
              </div>
              <div class="meta-row">
                <dt>能力类型</dt>
                <dd>Skill</dd>
              </div>
              <div class="meta-row">
                <dt>来源</dt>
                <dd>{{ sourceLabel(detail.source) }}</dd>
              </div>
              <div class="meta-row">
                <dt>最近更新</dt>
                <dd>{{ formatTime(detail.updatedAtMs) }}</dd>
              </div>
              <div class="meta-row">
                <dt>文件数</dt>
                <dd class="tnum">{{ detail.files.length }}</dd>
              </div>
              <div class="meta-row">
                <dt>占用空间</dt>
                <dd class="tnum">{{ formatSize(detail.totalSize) }}</dd>
              </div>
            </dl>
          </section>

          <section class="section">
            <h3 class="section-label">存放位置</h3>
            <p class="path-text">{{ detail.path }}</p>
          </section>

          <section class="section">
            <h3 class="section-label">文件清单</h3>
            <ul class="file-list">
              <li v-for="file in detail.files" :key="file.rel" class="file-row">
                <span class="file-name" :title="file.rel">{{ file.rel }}</span>
                <span class="file-size tnum">{{ formatSize(file.size) }}</span>
              </li>
            </ul>
          </section>
        </template>
      </div>

      <template #footer>
        <div v-if="props.skillName" class="actions">
          <NButton
            class="danger-button"
            secondary
            size="small"
            @click="emit('remove', props.skillName)"
          >
            <template #icon>
              <NIcon :size="14">
                <Trash2 />
              </NIcon>
            </template>
            删除
          </NButton>
          <NButton type="primary" size="small" @click="emit('edit', props.skillName)">
            <template #icon>
              <NIcon :size="14">
                <Pencil />
              </NIcon>
            </template>
            编辑配置
          </NButton>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
.drawer-title {
  font-size: 12px;
  color: var(--c-text-3);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px 20px;
}

.state {
  font-size: 13px;
  color: var(--c-text-3);
}

.state.error {
  color: #b42318;
}

.identity {
  display: flex;
  align-items: center;
  gap: 12px;
}

.identity-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: var(--radius);
  background: var(--c-surface-sunken);
  color: var(--c-text-2);
}

.identity-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.identity-name {
  font-size: 16px;
  font-weight: 600;
}

.identity-category {
  font-size: 12px;
  color: var(--c-text-3);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid var(--c-border);
}

.section-label {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--c-text-3);
}

.section-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--c-text-2);
}

.path-text {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
  font-family: var(--c-font-mono, ui-monospace, monospace);
  font-size: 11px;
  line-height: 1.5;
  color: var(--c-text-2);
  word-break: break-all;
}

.meta {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
}

.meta-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}

.meta-row dt {
  font-size: 12px;
  color: var(--c-text-3);
}

.meta-row dd {
  margin: 0;
  font-size: 12px;
  color: var(--c-text-2);
}

.meta-row dd.running {
  color: #2f7d5d;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.file-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
  font-size: 12px;
}

.file-name {
  overflow: hidden;
  color: var(--c-text-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  flex: none;
  color: var(--c-text-3);
}

.actions {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.tnum {
  font-variant-numeric: tabular-nums;
}
</style>
