<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NCheckbox, NIcon, NInput, NModal, NSelect, NSpin } from 'naive-ui'
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  Download,
  FileArchive,
  FilePlus2,
  FolderOpen,
  Github,
  Globe,
  HardDrive,
  Loader2,
  Search,
} from 'lucide-vue-next'
import {
  createManualSkill,
  discoverRepoSkills,
  importRepoSkills,
  importRuntimeSkill,
  importSkillFromLocal,
  importSkillFromUrl,
  listRepoBranches,
  listRuntimeSkills,
  parseRepoUrl,
  pickSource,
  type DiscoveredSkill,
  type RuntimeSkillInfo,
  type SkillInfo,
} from '@/api/skills'

export type CreateMethod = 'manual' | 'local' | 'url' | 'runtime' | 'github'

const props = defineProps<{
  /** 直接打开某种方式；不传则先显示方式选择 */
  initialMethod?: CreateMethod | null
}>()

/** 弹窗显隐由父组件控制（v-model:show） */
const visible = defineModel<boolean>('show', { default: false })

const emit = defineEmits<{
  close: []
  created: [skill: SkillInfo]
}>()

/** 弹窗内的步骤：chooser 是方式选择，其余四种是具体表单 */
type Step = 'chooser' | CreateMethod

const step = ref<Step>('chooser')
const error = ref('')
const busy = ref(false)

/** 手动创建表单 */
const name = ref('')
const description = ref('')
/** URL 导入表单 */
const url = ref('')
/** 本地导入：已选中的路径 */
const localPath = ref('')
/** 运行时复制：候选列表与勾选结果 */
const runtimeSkills = ref<RuntimeSkillInfo[]>([])
const runtimeLoading = ref(false)
const selectedPaths = ref<string[]>([])
/** 运行时列表的搜索词 */
const runtimeQuery = ref('')

/** ── 从 GitHub 仓库导入 ── */

/** 仓库地址 */
const repoUrl = ref('')
/** 选中的分支 */
const repoBranch = ref('')
/** 仓库里的分支列表 */
const repoBranches = ref<string[]>([])
/** 读分支中 */
const branchesLoading = ref(false)
/** 仓库里发现的 skill */
const repoSkills = ref<DiscoveredSkill[]>([])
/** 发现中 */
const discovering = ref(false)
/** 勾选的 skill（存仓库里的相对路径） */
const selectedRepoSkills = ref<string[]>([])
/** 仓库里 skill 的搜索词 */
const repoQuery = ref('')
/** 地址解析失败时的提示 */
const repoUrlError = ref('')

/** 按搜索词过滤仓库里的 skill */
const visibleRepoSkills = computed(() => {
  const keyword = repoQuery.value.trim().toLowerCase()
  if (!keyword) return repoSkills.value
  return repoSkills.value.filter((item) =>
    `${item.name}${item.description}`.toLowerCase().includes(keyword),
  )
})

/** 填好地址后：解析仓库 → 拉分支列表 */
const loadRepoBranches = async () => {
  const trimmed = repoUrl.value.trim()
  repoUrlError.value = ''
  repoBranch.value = ''
  repoSkills.value = []
  selectedRepoSkills.value = []
  if (!trimmed) return
  try {
    const parsed = await parseRepoUrl(trimmed)
    if (!parsed) {
      repoUrlError.value = '看不出仓库地址 —— 应该是 https://github.com/owner/repo'
      return
    }
    branchesLoading.value = true
    repoBranches.value = (await listRepoBranches(trimmed)).map((item) => item.name)
    if (repoBranches.value.length > 0) {
      repoBranch.value = repoBranches.value.includes('main') ? 'main' : repoBranches.value[0]!
    }
  } catch (err) {
    repoUrlError.value = err instanceof Error ? err.message : String(err)
  } finally {
    branchesLoading.value = false
  }
}

/** 选好分支后：列出仓库里的 skill */
const discoverRepo = async () => {
  const trimmed = repoUrl.value.trim()
  const branch = repoBranch.value.trim()
  if (!trimmed || !branch) return
  discovering.value = true
  repoSkills.value = []
  selectedRepoSkills.value = []
  try {
    repoSkills.value = await discoverRepoSkills(trimmed, branch)
    error.value = ''
    if (repoSkills.value.length === 0) {
      error.value = '这个分支里没找到 skill（仓库根目录下需要有带 SKILL.md 的目录）'
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    discovering.value = false
  }
}

/** 勾选 / 取消勾选一个仓库里的 skill */
const toggleRepoSkill = (path: string, checked: boolean) => {
  selectedRepoSkills.value = checked
    ? [...selectedRepoSkills.value, path]
    : selectedRepoSkills.value.filter((item) => item !== path)
}

/** 导入勾选的 skill */
const submitRepo = async () => {
  if (selectedRepoSkills.value.length === 0) {
    error.value = '请至少选一个 skill'
    return
  }
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const items = await importRepoSkills(
      repoUrl.value.trim(),
      repoBranch.value.trim(),
      selectedRepoSkills.value,
    )
    if (items.length > 0) {
      emit('created', items[0]!)
      visible.value = false
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

/** 按搜索词过滤（名称 / 描述 / 运行时） */
const visibleRuntimeSkills = computed(() => {
  const keyword = runtimeQuery.value.trim().toLowerCase()
  if (!keyword) return runtimeSkills.value
  return runtimeSkills.value.filter((item) =>
    `${item.name}${item.description}${item.runtime}`.toLowerCase().includes(keyword),
  )
})

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
  {
    key: 'github' as const,
    title: '从 GitHub 仓库导入',
    desc: '填仓库地址和分支，挑里面的 skill 导入。',
    icon: Github,
  },
]

/** 各步骤的标题与说明 */
const stepMeta = computed<{ title: string; desc: string }>(() => {
  if (step.value === 'chooser') {
    return { title: '新建 skill', desc: '选择添加 skill 的方式。' }
  }
  const found = methods.find((item) => item.key === step.value)
  return { title: found?.title ?? '新建 skill', desc: found?.desc ?? '' }
})

/** 宽度：选择页窄一点，进入具体方式后放宽 */
const modalWidth = computed(() => {
  if (step.value === 'chooser') return '460px'
  if (step.value === 'runtime') return '640px'
  if (step.value === 'github') return '680px'
  return '560px'
})

const resetForms = () => {
  name.value = ''
  description.value = ''
  url.value = ''
  localPath.value = ''
  runtimeSkills.value = []
  selectedPaths.value = []
  runtimeQuery.value = ''
  repoUrl.value = ''
  repoBranch.value = ''
  repoBranches.value = []
  repoSkills.value = []
  selectedRepoSkills.value = []
  repoQuery.value = ''
  repoUrlError.value = ''
  error.value = ''
}

/** 进入运行时方式时拉一次候选列表 */
watch(step, (current) => {
  if (current === 'runtime' && runtimeSkills.value.length === 0) void loadRuntimeSkills()
})

const loadRuntimeSkills = async () => {
  runtimeLoading.value = true
  try {
    runtimeSkills.value = await listRuntimeSkills()
    error.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    runtimeLoading.value = false
  }
}

/** 打开时同步步骤：指定方式直接进入对应表单，否则先选方式 */
watch(
  () => visible.value,
  (show) => {
    if (!show) return
    resetForms()
    step.value = props.initialMethod ?? 'chooser'
    if (step.value === 'runtime') void loadRuntimeSkills()
  },
  { immediate: true },
)

const choose = (method: CreateMethod) => {
  step.value = method
  error.value = ''
  if (method === 'runtime') void loadRuntimeSkills()
}

const back = () => {
  step.value = 'chooser'
  error.value = ''
}

/** 统一的提交包装：处理 loading、错误提示与成功回调 */
const run = async (action: () => Promise<SkillInfo>) => {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const skill = await action()
    emit('created', skill)
    visible.value = false
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

const submitManual = () => {
  const trimmedName = name.value.trim()
  if (!trimmedName) {
    error.value = '请填写 skill 名称'
    return
  }
  void run(() => createManualSkill(trimmedName, description.value.trim()))
}

const submitUrl = () => {
  const trimmed = url.value.trim()
  if (!trimmed) {
    error.value = '请填写 skill 网址'
    return
  }
  void run(() => importSkillFromUrl(trimmed))
}

/** 选择本地目录或压缩包 */
const chooseLocal = async (kind: 'folder' | 'archive') => {
  try {
    const picked = await pickSource(kind)
    if (picked) {
      localPath.value = picked
      error.value = ''
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

const submitLocal = () => {
  if (!localPath.value) {
    error.value = '请先选择要导入的目录或压缩包'
    return
  }
  void run(() => importSkillFromLocal(localPath.value))
}

const toggleRuntime = (path: string, checked: boolean) => {
  const current = new Set(selectedPaths.value)
  if (checked) current.add(path)
  else current.delete(path)
  selectedPaths.value = [...current]
}

/** 批量从运行时复制：逐个导入，失败的单独提示 */
const submitRuntime = async () => {
  const paths = selectedPaths.value
  if (!paths.length) {
    error.value = '请先勾选要复制的 skill'
    return
  }
  if (busy.value) return
  busy.value = true
  error.value = ''
  const failed: string[] = []
  let last: SkillInfo | null = null
  for (const path of paths) {
    try {
      last = await importRuntimeSkill(path)
    } catch (err) {
      failed.push(err instanceof Error ? err.message : String(err))
    }
  }
  busy.value = false
  if (last) {
    emit('created', last)
    visible.value = false
  }
  if (failed.length) {
    error.value = `${failed.length} 个 skill 复制失败：${failed[0]}`
  }
}

/** 关闭时不要把错误带到下一次打开 */
watch(
  () => visible.value,
  (show) => {
    if (!show) error.value = ''
  },
)
</script>

<template>
  <NModal
    :show="visible"
    preset="card"
    class="create-modal"
    :style="{ width: modalWidth, maxHeight: 'calc(100vh - 64px)' }"
    content-style="max-height: calc(100vh - 170px); overflow-y: auto"
    :bordered="false"
    :mask-closable="!busy"
    @update:show="(show: boolean) => !show && emit('close')"
  >
    <!-- 标题走 header 插槽：关闭按钮用卡片自带的，不要再自己画一个 -->
    <template #header>
      <div class="head-main">
        <button
          v-if="step !== 'chooser'"
          class="back-button"
          type="button"
          aria-label="返回选择方式"
          @click="back"
        >
          <NIcon :size="16">
            <ArrowLeft />
          </NIcon>
        </button>
        <div class="head-text">
          <h2 class="modal-title">{{ stepMeta.title }}</h2>
          <p class="modal-sub">{{ stepMeta.desc }}</p>
        </div>
      </div>
    </template>

    <!-- 方式选择 -->
    <ul v-if="step === 'chooser'" class="method-list">
      <li v-for="method in methods" :key="method.key">
        <button type="button" class="method" @click="choose(method.key)">
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

    <!-- 手动创建 -->
    <form v-else-if="step === 'manual'" class="form" @submit.prevent="submitManual">
      <label class="field">
        <span class="field-label">名称</span>
        <NInput
          v-model:value="name"
          size="small"
          maxlength="64"
          show-count
          placeholder="例如：market-report-generator"
          @update:value="error = ''"
        />
        <small class="field-hint">
          规范上限 64 字符；同步到 Claude Code / Codex 时须为
          kebab-case（仅小写字母、数字、连字符）， 且与目录名一致。
        </small>
      </label>
      <label class="field">
        <span class="field-label">描述</span>
        <NInput
          v-model:value="description"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 6 }"
          maxlength="1024"
          show-count
          placeholder="简要描述该 skill 可以完成什么任务"
        />
        <small class="field-hint">规范上限 1024 字符，建议 100–200 词。</small>
      </label>
    </form>

    <!-- URL 导入 -->
    <form v-else-if="step === 'url'" class="form" @submit.prevent="submitUrl">
      <label class="field">
        <span class="field-label">skill 网址</span>
        <NInput
          v-model:value="url"
          size="small"
          placeholder="https://clawhub.ai/owner/skill"
          @update:value="error = ''"
        />
      </label>
      <div class="source-hints">
        <p class="hint-title">支持的来源</p>
        <div class="hint-grid">
          <div class="hint">
            <span class="hint-name">ClawHub</span>
            <span class="hint-host">clawhub.ai/owner/skill</span>
          </div>
          <div class="hint">
            <span class="hint-name">Skills.sh</span>
            <span class="hint-host">skills.sh/owner/repo/skill</span>
          </div>
          <div class="hint">
            <span class="hint-name">GitHub</span>
            <span class="hint-host">github.com/owner/repo</span>
          </div>
        </div>
      </div>
    </form>

    <!-- 本地导入 -->
    <div v-else-if="step === 'local'" class="form">
      <div class="pick-row">
        <NButton size="small" :disabled="busy" @click="chooseLocal('folder')">
          <template #icon>
            <NIcon :size="14">
              <FolderOpen />
            </NIcon>
          </template>
          选择文件夹
        </NButton>
        <NButton size="small" :disabled="busy" @click="chooseLocal('archive')">
          <template #icon>
            <NIcon :size="14">
              <FileArchive />
            </NIcon>
          </template>
          选择压缩包
        </NButton>
      </div>
      <p v-if="localPath" class="picked-path">{{ localPath }}</p>
      <p v-else class="picked-empty">还没有选择文件夹或压缩包。</p>
    </div>

    <!-- 从 GitHub 仓库导入 -->
    <div v-else-if="step === 'github'" class="form">
      <div class="repo-row">
        <NInput
          v-model:value="repoUrl"
          size="small"
          placeholder="https://github.com/owner/repo"
          :status="repoUrlError ? 'error' : undefined"
          @keyup.enter="loadRepoBranches"
        />
        <NButton size="small" :loading="branchesLoading" @click="loadRepoBranches">
          <template #icon>
            <NIcon :size="14">
              <Search />
            </NIcon>
          </template>
          读分支
        </NButton>
      </div>
      <p v-if="repoUrlError" class="repo-error">{{ repoUrlError }}</p>

      <div v-if="repoBranches.length" class="repo-row">
        <NSelect
          v-model:value="repoBranch"
          size="small"
          :options="repoBranches.map((name) => ({ label: name, value: name }))"
          placeholder="选分支"
        />
        <NButton size="small" :loading="discovering" @click="discoverRepo">
          <template #icon>
            <NIcon :size="14">
              <Github />
            </NIcon>
          </template>
          列出 skill
        </NButton>
      </div>

      <div v-if="discovering" class="repo-empty">
        <NSpin size="small" />
        <span>正在扫仓库里的 SKILL.md…</span>
      </div>

      <template v-else-if="repoSkills.length">
        <div class="repo-head">
          <NInput v-model:value="repoQuery" size="tiny" clearable placeholder="搜索名称或描述">
            <template #prefix>
              <NIcon :size="13">
                <Search />
              </NIcon>
            </template>
          </NInput>
          <span class="repo-count tnum">
            已选 {{ selectedRepoSkills.length }} / {{ repoSkills.length }}
          </span>
        </div>
        <ul class="repo-list">
          <li v-for="item in visibleRepoSkills" :key="item.path" class="repo-item">
            <NCheckbox
              :checked="selectedRepoSkills.includes(item.path)"
              @update:checked="(checked: boolean) => toggleRepoSkill(item.path, checked)"
            >
              {{ item.name }}
            </NCheckbox>
            <span class="repo-desc">{{ item.description || '（无描述）' }}</span>
          </li>
        </ul>
      </template>

      <p v-else-if="repoBranch" class="repo-empty">先选分支，再点「列出 skill」。</p>
    </div>

    <!-- 运行时复制 -->
    <div v-else class="form">
      <div class="runtime-head">
        <NInput
          v-model:value="runtimeQuery"
          class="runtime-search"
          size="tiny"
          clearable
          placeholder="搜索名称或运行时"
        >
          <template #prefix>
            <NIcon :size="13">
              <Search />
            </NIcon>
          </template>
        </NInput>
        <NButton size="tiny" :disabled="busy || runtimeLoading" @click="loadRuntimeSkills">
          <template #icon>
            <NIcon :size="13">
              <HardDrive />
            </NIcon>
          </template>
          重新扫描
        </NButton>
      </div>
      <NSpin :show="runtimeLoading">
        <div class="runtime-list">
          <label v-for="item in visibleRuntimeSkills" :key="item.path" class="runtime-item">
            <NCheckbox
              :checked="selectedPaths.includes(item.path)"
              :disabled="item.installed"
              @update:checked="(checked: boolean) => toggleRuntime(item.path, checked)"
            />
            <span class="runtime-text">
              <span class="runtime-name">
                {{ item.name }}
                <span class="runtime-tag">{{ item.runtime }}</span>
                <span v-if="item.installed" class="runtime-tag installed">已在工作区</span>
              </span>
              <span v-if="item.description" class="runtime-desc">{{ item.description }}</span>
            </span>
          </label>
          <p v-if="!runtimeSkills.length && !runtimeLoading" class="picked-empty">
            没有扫描到运行时里的 skill。
          </p>
          <p v-else-if="!visibleRuntimeSkills.length && !runtimeLoading" class="picked-empty">
            没有匹配的 skill。
          </p>
        </div>
      </NSpin>
    </div>

    <p v-if="error" class="error-text" role="alert">{{ error }}</p>

    <!-- 底部操作 -->
    <div class="modal-actions">
      <NButton size="small" :disabled="busy" @click="emit('close')">取消</NButton>
      <NButton
        v-if="step === 'manual'"
        size="small"
        type="primary"
        :disabled="busy || !name.trim()"
        :loading="busy"
        @click="submitManual"
      >
        <template #icon>
          <NIcon :size="14">
            <FilePlus2 />
          </NIcon>
        </template>
        创建 skill
      </NButton>
      <NButton
        v-else-if="step === 'url'"
        size="small"
        type="primary"
        :disabled="busy || !url.trim()"
        :loading="busy"
        @click="submitUrl"
      >
        <template #icon>
          <NIcon :size="14">
            <Download />
          </NIcon>
        </template>
        导入
      </NButton>
      <NButton
        v-else-if="step === 'local'"
        size="small"
        type="primary"
        :disabled="busy || !localPath"
        :loading="busy"
        @click="submitLocal"
      >
        <template #icon>
          <NIcon :size="14">
            <FolderOpen />
          </NIcon>
        </template>
        导入
      </NButton>
      <NButton
        v-else-if="step === 'github'"
        size="small"
        type="primary"
        :disabled="busy || !selectedRepoSkills.length"
        :loading="busy"
        @click="submitRepo"
      >
        <template #icon>
          <NIcon :size="14">
            <Download />
          </NIcon>
        </template>
        导入<span v-if="selectedRepoSkills.length">（{{ selectedRepoSkills.length }}）</span>
      </NButton>
      <NButton
        v-else
        size="small"
        type="primary"
        :disabled="busy || !selectedPaths.length"
        :loading="busy"
        @click="submitRuntime"
      >
        <template #icon>
          <NIcon :size="14">
            <Copy />
          </NIcon>
        </template>
        复制到工作区<span v-if="selectedPaths.length">（{{ selectedPaths.length }}）</span>
      </NButton>
    </div>

    <div v-if="busy" class="busy-tip">
      <NIcon :size="13">
        <Loader2 class="spin" />
      </NIcon>
      处理中…
    </div>
  </NModal>
</template>

<style scoped>
/* 卡片自带的关闭按钮绝对定位在右上角，标题要给右边让位 */
.head-main {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  padding-right: 28px;
}

.head-text {
  min-width: 0;
}

.back-button {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--c-text-3);
  cursor: pointer;
}

.back-button:hover {
  background: var(--c-surface-sunken);
  color: var(--c-text);
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
  cursor: pointer;
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

.field-hint {
  font-size: 11px;
  line-height: 1.5;
  color: var(--c-text-4);
}

.pick-row {
  display: flex;
  gap: 8px;
}

.picked-path {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
  font-family: var(--c-font-mono, monospace);
  font-size: 11px;
  line-height: 1.5;
  color: var(--c-text-2);
  word-break: break-all;
}

.picked-empty {
  margin: 0;
  font-size: 12px;
  color: var(--c-text-3);
}

/* ── GitHub 仓库导入 ── */

.repo-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.repo-row > :first-child {
  flex: 1;
  min-width: 0;
}

.repo-error {
  margin: 0;
  font-size: 11px;
  color: var(--c-danger);
}

.repo-head {
  display: flex;
  gap: 8px;
  align-items: center;
}

.repo-head > :first-child {
  flex: 1;
  min-width: 0;
}

.repo-count {
  flex: none;
  font-size: 11px;
  color: var(--c-text-3);
}

.repo-empty {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0;
  padding: 12px 0;
  font-size: 12px;
  color: var(--c-text-3);
}

.repo-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.repo-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
}

.repo-desc {
  padding-left: 22px;
  overflow: hidden;
  font-size: 11px;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-hints {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hint-title {
  margin: 0;
  font-size: 12px;
  color: var(--c-text-3);
}

.hint-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hint {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
}

.hint-name {
  flex: none;
  width: 72px;
  font-size: 12px;
  font-weight: 500;
  color: var(--c-text);
}

/* 链接占满整行 */
.hint-host {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--c-text-3);
  word-break: break-all;
}

.runtime-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.runtime-search {
  flex: 1;
  min-width: 0;
}

.runtime-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
}

.runtime-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
}

.runtime-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.runtime-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--c-text);
}

.runtime-tag {
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--c-surface-sunken);
  font-size: 10px;
  color: var(--c-text-3);
}

.runtime-tag.installed {
  color: #167d69;
}

.runtime-desc {
  font-size: 12px;
  color: var(--c-text-3);
}

.error-text {
  margin: 12px 0 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: rgb(190 18 60 / 10%);
  font-size: 12px;
  line-height: 1.5;
  color: #be123c;
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
