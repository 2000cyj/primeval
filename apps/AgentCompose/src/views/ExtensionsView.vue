<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  NButton,
  NCheckbox,
  NIcon,
  NInput,
  NModal,
  NSpin,
  NTabPane,
  NTabs,
  NTag,
  useMessage,
} from 'naive-ui'
import {
  ArrowUpRight,
  Blocks,
  Code2,
  Download,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-vue-next'
import PiGlyph from '@/components/PiGlyph.vue'
import {
  extensionTemplate,
  listExtensions,
  openExternal,
  readExtension,
  repoLink,
  removeExtension,
  saveExtension,
  searchMarketplace,
  setExtensionEnabled,
  type ExtensionInfo,
  type MarketplacePackage,
} from '@/api/extensions'
import { setExtensionDoneHandler, useExtensionOps } from '@/composables/useExtensionOps'

const message = useMessage()
const ops = useExtensionOps()

/** 页签：已安装 / 市场 / 自定义 */
type Tab = 'installed' | 'market' | 'custom'

const tab = ref<Tab>('installed')

/** 当前是不是在「Pi 扩展」这个视图（路由用的是 hash） */
const isExtensionsRoute = (): boolean => window.location.hash.replace('#', '') === 'extensions'

/**
 * 从别的页面切进「Pi 扩展」时查市场。
 *
 * 挂在 hashchange 上，而不是组件的 onMounted ——
 * 组件挂载只发生一次，之后每次点侧边栏菜单进来都是同一个组件实例，
 * 挂载钩子不会再触发。菜单切换才是「用户想看市场」的时机。
 *
 * `lastHash` 记着上一次的路由：**hash 真的变了才查**。
 * 不记的话，挂载时（onMounted）和紧接着的 hashchange 会各查一次 ——
 * 浏览器的 hashchange 是异步派发的，即便 hash 的值没变也会来一趟。
 */
let lastHash = ''

const onRouteChange = (): void => {
  const now = window.location.hash
  if (now === lastHash) return
  lastHash = now
  if (isExtensionsRoute()) void search(false)
}

// ── 已安装 ──

const installed = ref<ExtensionInfo[]>([])
const installedLoading = ref(false)
const installedError = ref('')

const loadInstalled = async (): Promise<void> => {
  installedLoading.value = true
  try {
    installed.value = await listExtensions()
    installedError.value = ''
  } catch (error) {
    installedError.value = error instanceof Error ? error.message : String(error)
  } finally {
    installedLoading.value = false
  }
}

/** 按来源分组（Pi 自带 / npm / 自定义） */
const grouped = computed(() => {
  const order = ['builtin', 'npm', 'custom']
  const groups = new Map<string, ExtensionInfo[]>()
  for (const item of installed.value) {
    const key = item.source
    const list = groups.get(key)
    if (list) list.push(item)
    else groups.set(key, [item])
  }
  return order
    .filter((key) => groups.has(key))
    .map((key) => ({
      key,
      label: sourceLabel(key as ExtensionInfo['source']),
      items: groups.get(key)!,
    }))
})

const sourceLabel = (source: ExtensionInfo['source']): string => {
  switch (source) {
    case 'builtin':
      return 'Pi 自带'
    case 'npm':
      return 'npm'
    case 'custom':
      return '自定义'
    default:
      return source
  }
}

/** pi 自带的扩展运行时自己会加载 —— 不能绑也不能删 */
const isBuiltin = (item: ExtensionInfo): boolean => item.source === 'builtin'

/** 停用 / 启用 */
const toggle = async (item: ExtensionInfo, enabled: boolean): Promise<void> => {
  try {
    const result = await setExtensionEnabled(item.path, enabled)
    if (!result.ok) {
      message.error(result.message)
      return
    }
    message.success(enabled ? '已启用' : '已停用')
    await loadInstalled()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

/** 删一个 */
const remove = async (item: ExtensionInfo): Promise<void> => {
  if (isBuiltin(item)) {
    message.warning('Pi 自带的扩展不能在这里删除')
    return
  }
  try {
    // 工具箱里的按来源删；pi 自带的按路径删（理论上不会走到）
    if (item.source === 'npm' || item.source === 'custom') {
      await ops.remove(item.source, item.name)
      return
    }
    const result = await removeExtension(item.path)
    if (!result.ok) {
      message.error(result.message)
      return
    }
    message.success('已删除')
    await loadInstalled()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

// ── 市场 ──

const marketQuery = ref('')
const marketLoading = ref(false)
const marketError = ref('')
const marketTotal = ref(0)
const packages = ref<MarketplacePackage[]>([])
/** 正在装的包 */
const installing = ref('')
/** 每页取多少 */
const PAGE_SIZE = 40

const search = async (append: boolean): Promise<void> => {
  // 已经在查了就别再查一遍。
  //
  // 进页面时两个入口可能连着触发：onMounted 看一眼当前路由，
  // hashchange 又通知一次「你到 Pi 扩展页了」—— 不挡的话市场会被查两遍。
  if (marketLoading.value && !append) return
  marketLoading.value = true
  try {
    const offset = append ? packages.value.length : 0
    const result = await searchMarketplace(marketQuery.value, PAGE_SIZE, offset)
    packages.value = append ? [...packages.value, ...result.packages] : result.packages
    marketTotal.value = result.total
    marketError.value = ''
  } catch (error) {
    marketError.value = error instanceof Error ? error.message : String(error)
    if (!append) packages.value = []
  } finally {
    marketLoading.value = false
  }
}

/** 还有没有更多 */
const hasMore = computed(
  () => packages.value.length > 0 && packages.value.length < marketTotal.value,
)

/** 已经装过的包名（工具箱的 npm 目录） */
const installedNames = computed(() => {
  const names = new Set<string>()
  for (const item of installed.value) {
    if (item.source === 'npm') names.add(item.name)
  }
  return names
})

const isInstalled = (name: string): boolean => installedNames.value.has(name)

/**
 * 打开包的仓库页。
 *
 * 走 Tauri 命令让系统浏览器打开 —— 桌面端的 webview 会拦掉普通链接，
 * 点 `<a target="_blank">` 什么反应都没有。
 */
const openRepo = async (item: MarketplacePackage): Promise<void> => {
  if (!item.repository) return
  try {
    await openExternal(repoLink(item.repository))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

const install = async (item: MarketplacePackage): Promise<void> => {
  installing.value = item.name
  try {
    // 进度在通知里 —— 装完会有一条「xx 已安装」
    await ops.install(item.name)
  } finally {
    installing.value = ''
  }
}

// ── 自定义扩展 ──

/** 编辑器弹窗 */
const editorOpen = ref(false)
const editorName = ref('')
const editorCode = ref('')
/** 编辑中的原路径（存在 = 改，否则 = 新建） */
const editorOriginalPath = ref('')
const editorLoading = ref(false)

const openEditor = async (item?: ExtensionInfo): Promise<void> => {
  editorLoading.value = true
  try {
    if (item) {
      editorName.value = item.name
      editorCode.value = await readExtension(item.path)
      editorOriginalPath.value = item.path
    } else {
      editorName.value = ''
      editorCode.value = await extensionTemplate()
      editorOriginalPath.value = ''
    }
    editorOpen.value = true
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    editorLoading.value = false
  }
}

const saveCustom = async (): Promise<void> => {
  const name = editorName.value.trim()
  if (!name) {
    message.warning('给扩展起个名字')
    return
  }
  try {
    const result = await saveExtension(name, editorCode.value)
    if (!result.ok) {
      message.error(result.message)
      return
    }
    message.success('已保存')
    editorOpen.value = false
    await loadInstalled()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

// ── 生命周期 ──

onMounted(async () => {
  await loadInstalled()
  // 装完 / 删完重新扫一遍
  setExtensionDoneHandler(loadInstalled)
  window.addEventListener('hashchange', onRouteChange)
  // 直接打开 #extensions 也要查
  // 先把 lastHash 记成当前值 —— 后面 hashchange 带着同一个值来时不重复查
  lastHash = window.location.hash
  if (isExtensionsRoute()) void search(false)
})

onUnmounted(() => {
  window.removeEventListener('hashchange', onRouteChange)
  setExtensionDoneHandler(null)
})
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div class="page-title-row">
        <PiGlyph class="page-icon" :size="22" />
        <div>
          <h1 class="page-title">Pi 扩展</h1>
          <p class="page-sub">扩展是 TypeScript 文件，导出默认工厂函数。Pi 启动时自动加载它们。</p>
        </div>
      </div>
      <NButton size="small" :loading="installedLoading" @click="loadInstalled">
        <template #icon>
          <NIcon :size="14">
            <RefreshCw />
          </NIcon>
        </template>
        刷新
      </NButton>
    </header>

    <NTabs v-model:value="tab" type="line" class="tabs">
      <!-- 已安装 -->
      <NTabPane name="installed">
        <template #tab>
          <span class="tab-label">
            已安装
            <span class="tab-count tnum">{{ installed.length }}</span>
          </span>
        </template>

        <p v-if="installedError" class="error-text" role="alert">{{ installedError }}</p>

        <NSpin :show="installedLoading">
          <div v-if="installed.length" class="groups">
            <section v-for="group in grouped" :key="group.key" class="card group">
              <header class="group-head">
                <span class="group-name">{{ group.label }}</span>
                <span class="group-count tnum">{{ group.items.length }}</span>
              </header>
              <ul class="ext-list">
                <li v-for="item in group.items" :key="item.path" class="ext">
                  <span class="ext-icon" aria-hidden="true">
                    <NIcon :size="14">
                      <Blocks />
                    </NIcon>
                  </span>
                  <div class="ext-text">
                    <span class="ext-name">
                      {{ item.name }}
                      <NTag v-if="isBuiltin(item)" size="small" :bordered="false"> Pi 自带 </NTag>
                    </span>
                    <code class="ext-path mono">{{ item.path }}</code>
                  </div>
                  <NButton v-if="!isBuiltin(item)" size="tiny" quaternary @click="openEditor(item)">
                    <template #icon>
                      <NIcon :size="12">
                        <Pencil />
                      </NIcon>
                    </template>
                    编辑
                  </NButton>
                  <NButton
                    v-if="!isBuiltin(item)"
                    size="tiny"
                    quaternary
                    :loading="ops.isBusy(item.name)"
                    @click="remove(item)"
                  >
                    <template #icon>
                      <NIcon :size="12">
                        <Trash2 />
                      </NIcon>
                    </template>
                  </NButton>
                  <NCheckbox
                    :checked="item.enabled"
                    @update:checked="(checked: boolean) => toggle(item, checked)"
                  >
                    <span class="sr-only">{{ item.name }} 启用</span>
                  </NCheckbox>
                </li>
              </ul>
            </section>
          </div>
          <p v-else-if="!installedLoading" class="empty">
            还没装扩展。到「市场」里挑一个，或自己写一个。
          </p>
        </NSpin>
      </NTabPane>

      <!-- 市场 -->
      <NTabPane name="market">
        <template #tab>
          <span class="tab-label">
            市场
            <span v-if="marketTotal" class="tab-count tnum">{{ marketTotal }}</span>
          </span>
        </template>

        <div class="market-bar">
          <NInput
            v-model:value="marketQuery"
            size="small"
            clearable
            placeholder="搜索扩展名或描述"
            @keyup.enter="search(false)"
          >
            <template #prefix>
              <NIcon :size="13">
                <Search />
              </NIcon>
            </template>
          </NInput>
          <NButton size="small" type="primary" :loading="marketLoading" @click="search(false)">
            搜索
          </NButton>
        </div>

        <p v-if="marketError" class="error-text" role="alert">{{ marketError }}</p>

        <NSpin :show="marketLoading">
          <div v-if="packages.length" class="pkg-grid">
            <article v-for="item in packages" :key="item.name" class="card pkg">
              <header class="pkg-head">
                <span class="pkg-name">{{ item.name }}</span>
                <span class="pkg-version tnum">v{{ item.version }}</span>
              </header>
              <p class="pkg-desc">{{ item.description || '（没有描述）' }}</p>
              <footer class="pkg-foot">
                <span class="pkg-meta tnum">
                  {{ item.weeklyDownloads ? `${item.weeklyDownloads} 次/周` : '' }}
                  <template v-if="item.author"> · {{ item.author }}</template>
                </span>
                <span class="pkg-actions">
                  <button
                    v-if="item.repository"
                    type="button"
                    class="pkg-link"
                    :title="`${item.name} 的仓库`"
                    :aria-label="`${item.name} 的仓库（用系统浏览器打开）`"
                    @click="openRepo(item)"
                  >
                    <NIcon :size="12">
                      <ArrowUpRight />
                    </NIcon>
                  </button>
                  <NButton v-if="isInstalled(item.name)" size="tiny" secondary disabled>
                    已安装
                  </NButton>
                  <NButton
                    v-else
                    size="tiny"
                    type="primary"
                    :loading="ops.isBusy(item.name)"
                    @click="install(item)"
                  >
                    <template #icon>
                      <NIcon :size="12">
                        <Download />
                      </NIcon>
                    </template>
                    {{ ops.busyLabel(item.name) || '安装' }}
                  </NButton>
                </span>
              </footer>
            </article>
          </div>
          <p v-else-if="!marketLoading" class="empty">
            搜点什么 —— 市场的数据源是 npm 上的
            <code class="mono">pi-package</code>
            标签。
          </p>

          <!-- 翻页：已加载多少 / 总共多少 -->
          <div v-if="packages.length" class="pager">
            <span class="pager-text tnum">
              已加载 {{ packages.length }} / {{ marketTotal }} 个
            </span>
            <NButton
              v-if="hasMore"
              size="small"
              secondary
              :loading="marketLoading"
              @click="search(true)"
            >
              加载更多
            </NButton>
          </div>
        </NSpin>
      </NTabPane>

      <!-- 自定义 -->
      <NTabPane name="custom">
        <template #tab>
          <span class="tab-label">自定义</span>
        </template>

        <div class="custom-bar">
          <p class="custom-hint">
            扩展是 TypeScript 文件，导出默认工厂函数
            <code class="mono">function (pi: ExtensionAPI)</code>
            。Pi 用 jiti 加载，不需要编译。
          </p>
          <NButton size="small" type="primary" @click="openEditor()">
            <template #icon>
              <NIcon :size="14">
                <Plus />
              </NIcon>
            </template>
            新建扩展
          </NButton>
        </div>

        <div class="card custom-card">
          <div class="custom-row">
            <span class="custom-icon" aria-hidden="true">
              <NIcon :size="14">
                <Code2 />
              </NIcon>
            </span>
            <div class="custom-text">
              <span class="custom-name">扩展放在项目里</span>
              <span class="custom-desc">
                新建的扩展写到 <code class="mono">.pi/extensions/</code>，跟着项目走，不污染全局。
              </span>
            </div>
          </div>
          <div class="custom-row">
            <span class="custom-icon" aria-hidden="true">
              <NIcon :size="14">
                <Package />
              </NIcon>
            </span>
            <div class="custom-text">
              <span class="custom-name">事件钩子</span>
              <span class="custom-desc">
                <code class="mono">session_start</code>、<code class="mono">tool_call</code>、
                <code class="mono">agent_settled</code> —— 用它们挂自己的逻辑。
              </span>
            </div>
          </div>
        </div>
      </NTabPane>
    </NTabs>

    <!-- 编辑器 -->
    <NModal
      :show="editorOpen"
      preset="card"
      style="width: 720px"
      :bordered="false"
      title="编辑扩展"
      @update:show="(show: boolean) => !show && (editorOpen = false)"
    >
      <div class="editor-row">
        <NInput v-model:value="editorName" size="small" placeholder="扩展名" />
      </div>
      <NInput
        v-model:value="editorCode"
        type="textarea"
        class="editor-code"
        :autosize="{ minRows: 16, maxRows: 28 }"
        :spellcheck="false"
      />
      <div class="editor-actions">
        <NButton size="small" @click="editorOpen = false">取消</NButton>
        <NButton size="small" type="primary" @click="saveCustom">保存</NButton>
      </div>
    </NModal>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 24px 32px;
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.page-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.page-icon {
  width: 22px;
  height: 22px;
  flex: none;
  color: var(--c-text-2);
}

.page-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-text-3);
}

.tabs :deep(.n-tabs-nav) {
  padding-bottom: 4px;
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.tab-count {
  padding: 0 5px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
  font-size: 11px;
  color: var(--c-text-3);
}

.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
}

/* ── 已安装 ── */

.groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.group {
  overflow: hidden;
}

.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--c-border);
  background: var(--c-surface-sunken);
}

.group-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-2);
}

.group-count {
  padding: 0 5px;
  border-radius: var(--radius-sm);
  background: var(--c-bg);
  font-size: 11px;
  color: var(--c-text-3);
}

.ext-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.ext {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
}

.ext + .ext {
  border-top: 1px solid var(--c-border);
}

.ext-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
  color: var(--c-text-3);
}

.ext-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.ext-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.ext-path {
  overflow: hidden;
  font-size: 11px;
  color: var(--c-text-4);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 市场 ── */

.market-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.market-bar > :first-child {
  flex: 1;
  min-width: 0;
}

.pkg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.pkg {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
}

.pkg-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.pkg-name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pkg-version {
  flex: none;
  font-size: 11px;
  color: var(--c-text-4);
}

.pkg-desc {
  flex: 1;
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.5;
  color: var(--c-text-3);
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.pkg-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pkg-meta {
  overflow: hidden;
  font-size: 11px;
  color: var(--c-text-4);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pkg-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
}

.pkg-link {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--c-text-4);
  cursor: pointer;
}

.pkg-link:hover {
  background: var(--c-surface-sunken);
  color: var(--c-text-2);
}

/* ── 自定义 ── */

.custom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.custom-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--c-text-3);
}

.custom-card {
  display: flex;
  flex-direction: column;
}

.custom-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
}

.custom-row + .custom-row {
  border-top: 1px solid var(--c-border);
}

.custom-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
  color: var(--c-text-3);
}

.custom-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.custom-name {
  font-size: 13px;
  font-weight: 500;
}

.custom-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--c-text-3);
}

/* ── 编辑器 ── */

.editor-row {
  margin-bottom: 10px;
}

.editor-code :deep(textarea) {
  font-family: var(--c-font-mono, monospace);
  font-size: 12px;
  line-height: 1.6;
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

/* ── 通用 ── */

.error-text {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--c-danger);
}

.empty {
  margin: 0;
  padding: 32px 0;
  font-size: 12px;
  text-align: center;
  color: var(--c-text-3);
}
</style>
