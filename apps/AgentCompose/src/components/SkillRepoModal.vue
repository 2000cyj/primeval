<script setup lang="ts">
/**
 * 从 GitHub 仓库添加 skill。
 *
 * 导入时来源就记在 skill 的 sidecar 里（`origin: {type: "git", …}`），
 * 所以这里列的是「以前从哪些仓库导过」—— 不用再输一遍地址，
 * 选一下就能把那个仓库里的 skill 再导进来。
 *
 * 已经导入过的 skill 也允许再选 —— 再导一次会覆盖成仓库里的最新版本。
 */
import { computed, ref, watch } from 'vue'
import { NButton, NCheckbox, NEmpty, NIcon, NInput, NModal, NSpin, useMessage } from 'naive-ui'
import { Github, RefreshCw, Search } from 'lucide-vue-next'
import {
  discoverRepoSkills,
  importRepoSkills,
  listGitRepos,
  type DiscoveredSkill,
  type GitRepo,
} from '@/api/skills'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [value: boolean]; imported: [] }>()

const message = useMessage()

/**
 * 弹窗宽度。
 *
 * 用 min() 夹一下 —— 窗口再窄也不至于弹窗比窗口还宽。
 * exe 最小窗口是 1200×700，560 在那儿绰绰有余。
 */
const modalWidth = 'min(560px, calc(100vw - 48px))'

/** 记录下来的仓库 */
const repos = ref<GitRepo[]>([])
const reposLoading = ref(false)
const reposError = ref('')

/** 当前选中的仓库 */
const current = ref<GitRepo | null>(null)
/** 该仓库里能导的 skill */
const discovered = ref<DiscoveredSkill[]>([])
const discovering = ref(false)
const importing = ref(false)
/** 勾选要导入的 skill 路径 */
const picked = ref<string[]>([])
/** 搜索 */
const keyword = ref('')

const visible = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return discovered.value
  return discovered.value.filter((item) =>
    `${item.name}${item.description}`.toLowerCase().includes(text),
  )
})

/** 已经导入过的 skill 名 */
const installedNames = computed(() => new Set(current.value?.skills ?? []))

/** 重新读一遍仓库列表 */
const loadRepos = async (): Promise<void> => {
  reposLoading.value = true
  reposError.value = ''
  try {
    repos.value = await listGitRepos()
  } catch (error) {
    reposError.value = error instanceof Error ? error.message : String(error)
  } finally {
    reposLoading.value = false
  }
}

/** 选中一个仓库 —— 去把它里面的 skill 扫出来 */
const pickRepo = async (repo: GitRepo): Promise<void> => {
  current.value = repo
  picked.value = []
  keyword.value = ''
  discovered.value = []
  discovering.value = true
  try {
    discovered.value = await discoverRepoSkills(repo.sourceUrl, repo.sourceRef ?? 'main')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    discovering.value = false
  }
}

/** 回到仓库列表 */
const back = (): void => {
  current.value = null
  discovered.value = []
  picked.value = []
}

const isPicked = (path: string): boolean => picked.value.includes(path)

const toggle = (path: string, checked: boolean): void => {
  const next = new Set(picked.value)
  if (checked) next.add(path)
  else next.delete(path)
  picked.value = [...next]
}

const allPicked = computed(
  () => visible.value.length > 0 && visible.value.every((item) => isPicked(item.path)),
)

const somePicked = computed(
  () => !allPicked.value && visible.value.some((item) => isPicked(item.path)),
)

const toggleAll = (checked: boolean): void => {
  const next = new Set(picked.value)
  for (const item of visible.value) {
    if (checked) next.add(item.path)
    else next.delete(item.path)
  }
  picked.value = [...next]
}

/** 把选中的 skill 导进来 */
const doImport = async (): Promise<void> => {
  const repo = current.value
  if (!repo || picked.value.length === 0) return
  importing.value = true
  try {
    const items = await importRepoSkills(repo.sourceUrl, repo.sourceRef ?? 'main', picked.value)
    message.success(`已导入 ${items.length} 个 skill`)
    picked.value = []
    // 重新读仓库列表（已导入清单变了）
    await loadRepos()
    emit('imported')
    // 回到列表，让用户继续挑别的仓库
    back()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    importing.value = false
  }
}

// 打开时读一次仓库列表
watch(
  () => props.show,
  (open) => {
    if (open) {
      back()
      void loadRepos()
    }
  },
)
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    class="repo-modal"
    :style="{ width: modalWidth, maxHeight: 'calc(100vh - 64px)' }"
    content-style="max-height: calc(100vh - 170px); overflow-y: auto"
    :title="current ? `从 ${current.sourceUrl} 添加` : '从 GitHub 仓库添加'"
    :bordered="false"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <!-- 仓库列表 -->
    <template v-if="!current">
      <p v-if="reposError" class="error-text" role="alert">{{ reposError }}</p>
      <NSpin :show="reposLoading">
        <div v-if="repos.length" class="repo-list">
          <button
            v-for="repo in repos"
            :key="`${repo.sourceUrl}@${repo.sourceRef ?? ''}`"
            type="button"
            class="repo-item"
            @click="pickRepo(repo)"
          >
            <span class="repo-icon" aria-hidden="true">
              <NIcon :size="16">
                <Github />
              </NIcon>
            </span>
            <span class="repo-text">
              <span class="repo-name">{{ repo.sourceUrl }}</span>
              <span class="repo-meta">
                <span v-if="repo.sourceRef" class="repo-ref">{{ repo.sourceRef }}</span>
                已导入 {{ repo.skills.length }} 个
              </span>
            </span>
          </button>
        </div>
        <NEmpty v-else-if="!reposLoading" description="还没有从 GitHub 仓库导入过 skill">
          <template #extra>
            <span class="empty-hint">
              到「添加 Skill」里选「从 GitHub 仓库」导入一次，之后就能在这里快捷添加。
            </span>
          </template>
        </NEmpty>
      </NSpin>
    </template>

    <!-- 仓库里的 skill -->
    <template v-else>
      <div class="repo-bar">
        <NButton size="tiny" quaternary @click="back">← 仓库列表</NButton>
        <NInput
          v-model:value="keyword"
          class="search"
          size="tiny"
          clearable
          placeholder="搜索 skill"
        >
          <template #prefix>
            <NIcon :size="13">
              <Search />
            </NIcon>
          </template>
        </NInput>
      </div>

      <NSpin :show="discovering">
        <div v-if="visible.length" class="skill-list">
          <div class="list-head">
            <NCheckbox
              :checked="allPicked"
              :indeterminate="somePicked"
              aria-label="全选"
              @update:checked="toggleAll"
            />
            <span class="list-title">{{ visible.length }} 个 skill</span>
          </div>
          <label v-for="item in visible" :key="item.path" class="skill-item">
            <NCheckbox
              :checked="isPicked(item.path)"
              @update:checked="(checked: boolean) => toggle(item.path, checked)"
            />
            <span class="skill-text">
              <span class="skill-name">
                {{ item.name }}
                <span v-if="installedNames.has(item.name)" class="skill-tag">已添加</span>
              </span>
              <span class="skill-desc">{{ item.description || '（没有描述）' }}</span>
            </span>
          </label>
        </div>
        <NEmpty v-else-if="!discovering" description="这个仓库里没找到 skill" />
      </NSpin>
    </template>

    <template #footer>
      <div class="footer">
        <NButton size="small" @click="emit('update:show', false)">取消</NButton>
        <NButton
          size="small"
          type="primary"
          :disabled="!picked.length"
          :loading="importing"
          @click="doImport"
        >
          <template #icon>
            <NIcon :size="14">
              <RefreshCw />
            </NIcon>
          </template>
          导入{{ picked.length ? `（${picked.length}）` : '' }}
        </NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.repo-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.repo-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--c-text-2);
  text-align: left;
  cursor: pointer;
}

.repo-item:hover {
  background: var(--c-surface-sunken);
  color: var(--c-text);
}

.repo-icon {
  display: grid;
  place-items: center;
  flex: none;
  color: var(--c-text-3);
}

.repo-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.repo-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--c-text-4);
  font-size: 11px;
}

.repo-ref {
  padding: 0 5px;
  border-radius: 3px;
  background: var(--c-surface-sunken);
  color: var(--c-text-3);
  font-family: var(--font-mono);
}

.empty-hint {
  color: var(--c-text-4);
  font-size: 12px;
}

.repo-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.search {
  flex: 1;
}

.skill-list {
  display: flex;
  flex-direction: column;
}

.list-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 4px 8px;
  border-bottom: 1px solid var(--c-border);
}

.list-title {
  color: var(--c-text-3);
  font-size: 12px;
}

.skill-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 7px 4px;
  cursor: pointer;
}

.skill-item:hover {
  background: var(--c-surface-sunken);
}

.skill-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.skill-name {
  font-size: 13px;
  color: var(--c-text-2);
}

.skill-tag {
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 3px;
  background: var(--c-surface-sunken);
  color: var(--c-text-4);
  font-size: 11px;
}

.skill-desc {
  color: var(--c-text-4);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.error-text {
  color: var(--c-danger);
  font-size: 12px;
}
</style>
