<script setup lang="ts">
/**
 * 帮助中心弹窗。
 *
 * 三大块：命令行操作、界面说明、版本与更新。前两块内容来自 `@/data/help` ——
 * 数据驱动，搜索与筛选都靠它；版本那块是应用自己的状态。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NButton, NIcon, NInput, NModal, NProgress, NTabPane, NTabs, useMessage } from 'naive-ui'
import {
  Search,
  Terminal,
  LayoutPanelTop,
  Package,
  RefreshCw,
  Download,
  ExternalLink,
} from 'lucide-vue-next'
import { commandConventions, commandGroups, helpTopics, pageConventions, pages } from '@/data/help'
import {
  checkAppUpdate,
  installUpdateAndRestart,
  onUpdateDownloadProgress,
  type AppUpdateInfo,
  type UpdateDownloadProgress,
} from '@/api/updater'
import { openExternal } from '@/api/extensions'
import { getAppVersion } from '@/api/app'
import { formatDateTime } from '@/utils/datetime'
import { APP_VERSION } from '@/utils/appVersion'
import MarkdownView from '@/components/MarkdownView.vue'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [value: boolean] }>()

/** 搜索词 */
const keyword = ref('')
/** 当前页签 */
const tab = ref('command')

const needle = computed(() => keyword.value.trim().toLowerCase())

/** 命令分组（按搜索词过滤） */
const filteredGroups = computed(() => {
  if (!needle.value) return commandGroups
  return commandGroups
    .map((group) => {
      // 分组名或分组说明命中 → 该组命令全部保留；
      // 否则逐条看命令本身和说明。
      const groupHit =
        group.title.toLowerCase().includes(needle.value) ||
        (group.hint?.toLowerCase().includes(needle.value) ?? false)
      const commands = groupHit
        ? group.commands
        : group.commands.filter(
            (item) =>
              item.cmd.toLowerCase().includes(needle.value) ||
              item.desc.toLowerCase().includes(needle.value) ||
              (item.example?.toLowerCase().includes(needle.value) ?? false),
          )
      return { ...group, commands }
    })
    .filter((group) => group.commands.length > 0)
})

/** 界面说明（按搜索词过滤） */
const filteredPages = computed(() => {
  if (!needle.value) return pages
  return pages.filter(
    (page) =>
      page.title.toLowerCase().includes(needle.value) ||
      page.desc.toLowerCase().includes(needle.value) ||
      page.points.some((point) => point.toLowerCase().includes(needle.value)),
  )
})

/** 命中的条数 */
const hitCount = computed(() => {
  if (tab.value === 'command') {
    return filteredGroups.value.reduce((sum, group) => sum + group.commands.length, 0)
  }
  if (tab.value === 'page') return filteredPages.value.length
  return 0
})

// ── 版本与更新 ────────────────────────────────────────────────

/**
 * 应用版本。
 *
 * 默认用编译期常量（见 `@/utils/appVersion`）；打开弹窗时再问一次后端，
 * 拿后端说的为准（后端跟安装包是同一个版本）。
 */
const currentVersion = ref(APP_VERSION)

/** 问后端要版本号 —— 问不到就留着编译期常量 */
const loadCurrentVersion = async (): Promise<void> => {
  try {
    const version = await getAppVersion()
    // 后端没给准话就别改 —— 宁可留着编译期常量，也别把版本号显示成空
    if (typeof version === 'string' && version) currentVersion.value = version
  } catch {
    currentVersion.value = APP_VERSION
  }
}

/**
 * 版本检测。
 *
 * 检测逻辑在 Rust 侧（`src-tauri/src/updater.rs`）—— 版本号怎么比、
 * 哪个附件是安装包，那边说了算。这边只负责按钮状态和提示。
 *
 * 注意：**打开弹窗不自动检查** —— 那是网络请求，等用户点了再查。
 */
type UpdateState = 'idle' | 'checking' | 'latest' | 'update'

const updateState = ref<UpdateState>('idle')
/** 检测结果 */
const updateInfo = ref<AppUpdateInfo | null>(null)
/** 检查失败时的提示（页面里也显示一份，不依赖全局消息） */
const checkError = ref('')
/** 发布说明是不是展开的 */
const notesExpanded = ref(false)

const hasUpdate = computed(() => updateState.value === 'update')
const isLatest = computed(() => updateState.value === 'latest')
/** 最新版本号（没查到就空着） */
const latestVersion = computed(() => updateInfo.value?.latestVersion ?? '')
/** 新版本发布说明 */
const updateNotes = computed(() => updateInfo.value?.notes ?? '')
/** 新版本发布日期（转成能读的本地时间） */
const updatePublishedAt = computed(() => formatDateTime(updateInfo.value?.publishedAt ?? ''))

/** 正在下载安装（进度条阶段） */
const installing = ref(false)
/** 下载进度（null = 还没开始或已结束） */
const downloadProgress = ref<UpdateDownloadProgress | null>(null)
/** 进度监听的取消函数 */
let unlistenProgress: (() => void) | undefined = undefined

/** 断开下载进度监听 —— 别在弹窗关了之后还收事件 */
const cleanupProgress = (): void => {
  unlistenProgress?.()
  unlistenProgress = undefined
}

/** 下载百分比（服务端没给总量就不知道，显示不确定态） */
const downloadPercent = computed(() => {
  const progress = downloadProgress.value
  if (!progress || progress.total <= 0) return null
  return Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
})

/** 已下载多少 MB */
const downloadedMb = computed(() => {
  const progress = downloadProgress.value
  if (!progress) return '0.0'
  return (progress.downloaded / 1024 / 1024).toFixed(1)
})

/** 总共多少 MB */
const totalMb = computed(() => {
  const progress = downloadProgress.value
  if (!progress || progress.total <= 0) return ''
  return (progress.total / 1024 / 1024).toFixed(1)
})

/**
 * 消息提示。
 *
 * 弹窗正常挂在 `<n-message-provider>` 下面；但组件也可能被单独挂载
 * （比如单测），那时 useMessage 会抛错 —— 兜住，提示就退回到页签里的行内文字。
 */
const message = (() => {
  try {
    return useMessage()
  } catch {
    return null
  }
})()

/** 检查最新版本 */
const checkLatestVersion = async (): Promise<void> => {
  updateState.value = 'checking'
  checkError.value = ''
  try {
    const info = await checkAppUpdate()
    updateInfo.value = info
    currentVersion.value = info.currentVersion || currentVersion.value
    updateState.value = info.hasUpdate ? 'update' : 'latest'
    if (updateState.value === 'latest') {
      message?.success(`当前已是最新版本 ${currentVersion.value}`)
    }
  } catch (error) {
    updateState.value = 'idle'
    const text = `检查版本失败：${error instanceof Error ? error.message : String(error)}`
    checkError.value = text
    message?.error(text)
  }
}

/** 开始更新：应用内下载 → 验签 → 安装器接手 → 重启 */
const startUpdate = async (): Promise<void> => {
  if (installing.value) return
  installing.value = true
  downloadProgress.value = null
  unlistenProgress = await onUpdateDownloadProgress((progress) => {
    downloadProgress.value = progress
  })
  try {
    const started = await installUpdateAndRestart()
    // Windows 上安装器起来后进程就退出了，走到这里说明没有更新可装
    if (!started) {
      message?.info('当前已是最新版本')
      updateState.value = 'latest'
    }
  } catch (error) {
    message?.error(`更新失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    installing.value = false
    cleanupProgress()
  }
}

/** 打开 Release 页面看完整发布说明 */
const openReleaseNotes = async (): Promise<void> => {
  const url = updateInfo.value?.releaseUrl
  if (!url) return
  try {
    await openExternal(url)
  } catch (error) {
    const text = `打不开发布说明：${error instanceof Error ? error.message : String(error)}`
    checkError.value = text
    message?.error(text)
  }
}

onBeforeUnmount(cleanupProgress)

// 打开时清掉上次的搜索 —— 免得带着旧词进来看到空结果
watch(
  () => props.show,
  (open) => {
    if (open) {
      keyword.value = ''
      // 版本号：先问后端（准），问不到就用编译期常量
      void loadCurrentVersion()
    } else {
      // 弹窗关了就不收下载进度事件
      cleanupProgress()
      checkError.value = ''
    }
  },
)
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    class="help-modal"
    :style="{ width: 'min(880px, calc(100vw - 48px))' }"
    :bordered="false"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <template #header>
      <div class="modal-head">
        <span class="modal-title">帮助</span>
        <NInput
          v-model:value="keyword"
          class="search"
          size="small"
          clearable
          placeholder="搜命令或功能"
        >
          <template #prefix>
            <NIcon :size="13">
              <Search />
            </NIcon>
          </template>
        </NInput>
      </div>
    </template>

    <NTabs v-model:value="tab" type="line" size="small" class="tabs">
      <NTabPane name="command">
        <template #tab>
          <span class="tab-label">
            <NIcon :size="13">
              <Terminal />
            </NIcon>
            命令行
          </span>
        </template>

        <div class="body">
          <div v-if="filteredGroups.length" class="groups">
            <section v-for="group in filteredGroups" :key="group.title" class="group">
              <header class="group-head">
                <span class="group-title">{{ group.title }}</span>
                <span v-if="group.hint" class="group-hint">{{ group.hint }}</span>
              </header>
              <dl class="cmds">
                <div v-for="item in group.commands" :key="item.cmd" class="cmd">
                  <dt>
                    <code class="cmd-code">{{ item.cmd }}</code>
                  </dt>
                  <dd>
                    <span class="cmd-desc">{{ item.desc }}</span>
                    <code v-if="item.example" class="cmd-example">{{ item.example }}</code>
                  </dd>
                </div>
              </dl>
            </section>

            <section class="group">
              <header class="group-head">
                <span class="group-title">约定</span>
              </header>
              <ul class="points">
                <li v-for="item in commandConventions" :key="item">{{ item }}</li>
              </ul>
            </section>
          </div>
          <p v-else class="empty">没有匹配的命令</p>
        </div>
      </NTabPane>

      <NTabPane name="page">
        <template #tab>
          <span class="tab-label">
            <NIcon :size="13">
              <LayoutPanelTop />
            </NIcon>
            界面
          </span>
        </template>

        <div class="body">
          <div v-if="filteredPages.length" class="groups">
            <section v-for="page in filteredPages" :key="page.title" class="group">
              <header class="group-head">
                <span class="group-title">{{ page.title }}</span>
                <span class="group-hint">{{ page.desc }}</span>
              </header>
              <ul class="points">
                <li v-for="point in page.points" :key="point">{{ point }}</li>
              </ul>
            </section>

            <section class="group">
              <header class="group-head">
                <span class="group-title">通用约定</span>
              </header>
              <ul class="points">
                <li v-for="item in pageConventions" :key="item">{{ item }}</li>
              </ul>
            </section>
          </div>
          <p v-else class="empty">没有匹配的功能</p>
        </div>
      </NTabPane>

      <NTabPane name="version">
        <template #tab>
          <span class="tab-label">
            <NIcon :size="13">
              <Package />
            </NIcon>
            版本
          </span>
        </template>

        <div class="body">
          <div class="groups">
            <section class="group">
              <header class="group-head">
                <span class="group-title">当前版本</span>
                <span class="group-hint">AgentSpace 桌面端</span>
              </header>
              <ul class="points">
                <li>
                  已安装版本：<code class="cmd-code">{{ currentVersion }}</code>
                </li>
                <li>更新在应用内完成 —— 下载、验签、装完自动重启，不用你手动操作。</li>
              </ul>

              <!--
                按钮三态：
                - 未检查   → 「检查最新版本」
                - 有新版本 → 「更新到 X.Y.Z」
                - 已是最新 → 「已是最新版本」，禁用
              -->
              <div class="version-actions">
                <NButton
                  v-if="!hasUpdate"
                  type="primary"
                  size="small"
                  :loading="updateState === 'checking'"
                  :disabled="isLatest"
                  @click="checkLatestVersion"
                >
                  <template #icon>
                    <NIcon :size="13">
                      <RefreshCw />
                    </NIcon>
                  </template>
                  {{ isLatest ? '已是最新版本' : '检查最新版本' }}
                </NButton>

                <NButton
                  v-else
                  type="primary"
                  size="small"
                  :loading="installing"
                  @click="startUpdate"
                >
                  <template #icon>
                    <NIcon :size="13">
                      <Download />
                    </NIcon>
                  </template>
                  {{ installing ? '正在下载…' : `更新到 ${latestVersion}` }}
                </NButton>
              </div>

              <p v-if="checkError" class="version-error">{{ checkError }}</p>
            </section>

            <!-- 下载中：进度条（下载在应用内完成，不跳出浏览器） -->
            <section v-if="installing" class="group">
              <header class="group-head">
                <span class="group-title">正在下载</span>
                <span class="group-hint">
                  <template v-if="downloadPercent !== null">{{ downloadPercent }}%</template>
                  <template v-else>大小未知</template>
                </span>
              </header>
              <NProgress
                type="line"
                :percentage="downloadPercent ?? undefined"
                :indeterminate="downloadPercent === null"
                :height="4"
                :show-indicator="false"
                processing
              />
              <ul class="points">
                <li>
                  已下载 {{ downloadedMb }}<template v-if="totalMb"> / {{ totalMb }}</template> MB
                </li>
                <li>下载完会自动安装并重启。</li>
              </ul>
            </section>

            <!-- 有新版本：说清楚是什么版本、什么时候发的、改了什么 -->
            <section v-if="hasUpdate" class="group">
              <header class="group-head">
                <span class="group-title">有新版本</span>
                <span class="group-hint">
                  {{ latestVersion }}
                  <template v-if="updatePublishedAt">· 发布于 {{ updatePublishedAt }}</template>
                </span>
              </header>

              <div v-if="updateNotes" class="notes" :class="{ expanded: notesExpanded }">
                <MarkdownView class="notes-body" :source="updateNotes" />
              </div>

              <div class="version-actions">
                <NButton text size="tiny" @click="openReleaseNotes">
                  <template #icon>
                    <NIcon :size="12">
                      <ExternalLink />
                    </NIcon>
                  </template>
                  查看发布说明
                </NButton>
                <NButton
                  v-if="updateNotes.length > 200"
                  text
                  size="tiny"
                  @click="notesExpanded = !notesExpanded"
                >
                  {{ notesExpanded ? '收起' : '展开全部' }}
                </NButton>
              </div>
            </section>
          </div>
        </div>
      </NTabPane>
    </NTabs>

    <template #footer>
      <div class="footer">
        <span v-if="needle && tab !== 'version'" class="hit">找到 {{ hitCount }} 条</span>
        <span v-else class="hit">{{ helpTopics.map((item) => item.label).join(' · ') }}</span>
        <button type="button" class="close" @click="emit('update:show', false)">关闭</button>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.modal-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.modal-title {
  flex: none;
  font-size: 15px;
  font-weight: 600;
}

.search {
  flex: 1;
  max-width: 320px;
}

.tabs {
  --n-tab-font-size: 13px;
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.body {
  /* 自己滚动 —— 内容多时不把弹窗撑爆。
     用原生 overflow 而不是 NScrollbar：后者要固定 height 才会滚，
     给 max-height 的话内容直接溢出。 */
  max-height: min(56vh, 480px);
  overflow-y: auto;
  overflow-x: hidden;
  /* 滚动条留固定位置：出现/消失时内容宽度不跳 */
  scrollbar-gutter: stable vertical;
}

.groups {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 4px 2px 8px;
}

.group-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 7px;
}

.group-title {
  flex: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}

.group-hint {
  font-size: 11px;
  color: var(--c-text-4);
}

.cmds {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
}

.cmd {
  display: grid;
  grid-template-columns: minmax(180px, 260px) 1fr;
  gap: 12px;
  align-items: baseline;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
}

.cmd:hover {
  background: var(--c-surface-sunken);
}

.cmd-code {
  font-family: 'SFMono-Regular', 'Cascadia Mono', Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  color: var(--c-accent);
  word-break: break-word;
}

.cmd-desc {
  display: block;
  font-size: 12px;
  color: var(--c-text-2);
}

.cmd-example {
  display: block;
  margin-top: 2px;
  font-family: 'SFMono-Regular', 'Cascadia Mono', Consolas, 'Liberation Mono', monospace;
  font-size: 11px;
  color: var(--c-text-4);
  word-break: break-word;
}

.points {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
}

.points li {
  font-size: 12px;
  color: var(--c-text-2);
  line-height: 1.6;
}

.empty {
  margin: 0;
  padding: 40px 0;
  font-size: 12px;
  color: var(--c-text-4);
  text-align: center;
}

/* 版本页签里的按钮行 —— 贴着内容排，不另起一整套卡片 */
.version-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

/* 发布说明：默认只露一屏，看不下去再展开 */
.notes {
  max-height: 160px;
  overflow: hidden;
}

.notes.expanded {
  max-height: none;
}

.notes-body {
  font-size: 12px;
}

.version-error {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--c-danger);
}

.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hit {
  font-size: 11px;
  color: var(--c-text-4);
}

.close {
  padding: 5px 14px;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  color: var(--c-text-2);
  font-size: 13px;
  cursor: pointer;
}

.close:hover {
  background: var(--c-surface-sunken);
  color: var(--c-text);
}
</style>
