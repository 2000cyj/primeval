<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton, NIcon, NInput, NModal, NProgress, NSelect, NTooltip, useMessage } from 'naive-ui'
import {
  Copy,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Info,
  RotateCcw,
  Save,
  Search,
  TestTube2,
  Trash2,
  Upload,
  X,
} from 'lucide-vue-next'
import {
  getProxy,
  scanProxies,
  setProxy,
  testProxy,
  type DetectedProxy,
  type ProxyInfo,
} from '@/api/proxy'
import { getCliStatus, type CliStatus } from '@/api/cli'
import {
  createAutoBackup,
  deleteAutoBackup,
  getBackupSettings,
  listAutoBackups,
  openBackupFolder,
  restoreAutoBackup,
  setBackupSettings,
  type BackupEntry,
  type BackupSettings,
} from '@/api/backup'
import { useAppUpdate } from '@/composables/useAppUpdate'
import { formatDateTime } from '@/utils/datetime'
import agentspaceLogo from '@/assets/agentspace-logo.png'
import MarkdownView from '@/components/MarkdownView.vue'
import BackupExportModal from '@/components/BackupExportModal.vue'
import BackupImportModal from '@/components/BackupImportModal.vue'

const message = useMessage()

/**
 * 应用更新状态。
 *
 * **全应用共享一份**（见 `@/composables/useAppUpdate`）——
 * 这个页面是视图，切走时会被卸载，局部 state 会跟着没；
 * 帮助中心那边也一样。两处共享，切来切去都还在。
 */
const {
  updateState,
  notesExpanded,
  installing,
  hasUpdate,
  isLatest,
  latestVersion,
  updateNotes,
  updatePublishedAt,
  downloadPercent,
  downloadedMb,
  totalMb,
  currentVersion,
  checkLatestVersion,
  startUpdate,
  openReleaseNotes,
  loadCurrentVersion,
} = useAppUpdate()

// ── 备份与恢复 ──

/** 备份列表（新的在前）。 */
const backups = ref<BackupEntry[]>([])
/** 备份设置（后端给的全集）。 */
const backupSettings = ref<BackupSettings | null>(null)
/** 正在备份。 */
const backingUp = ref(false)
/** 正在恢复哪个备份（文件名）。 */
const restoring = ref('')
/** 恢复确认弹窗开着没。 */
const restoreOpen = ref(false)
/** 要恢复到哪个备份。 */
const restoreTarget = ref<BackupEntry | null>(null)
/** 恢复确认的结果（谁 resolve 谁）。 */
let restoreResolve: ((ok: boolean) => void) | null = null

/** 自动备份间隔（选中的值，单位小时）。 */
const backupInterval = ref(24)
/** 保留多少个备份。 */
const backupKeepCount = ref(10)

/** 间隔下拉的选项。 */
const intervalOptions = computed(() =>
  (backupSettings.value?.intervalOptions ?? []).map((hours) => ({
    label: hours === 0 ? '关闭' : hours >= 168 ? `${hours / 24} 天` : `${hours} 小时`,
    value: hours,
  })),
)

/** 保留数量的选项。 */
const keepOptions = computed(() =>
  (backupSettings.value?.keepOptions ?? []).map((value) => ({ label: `${value} 个`, value })),
)

/** 读设置 + 列表。 */
const loadBackups = async (): Promise<void> => {
  try {
    const [list, settings] = await Promise.all([listAutoBackups(), getBackupSettings()])
    // 后端返回意外的值（null / 非数组）也不能让整页崩掉 —— 当空列表处理。
    backups.value = Array.isArray(list) ? list : []
    backupSettings.value = settings
    backupInterval.value = settings?.autoBackupIntervalHours ?? 24
    backupKeepCount.value = settings?.keepCount ?? 10
  } catch (error) {
    message.error(`读取备份设置失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 改自动备份间隔。 */
const onIntervalChange = async (value: number): Promise<void> => {
  try {
    const settings = await setBackupSettings({ autoBackupIntervalHours: value })
    backupSettings.value = settings
    message.success('已更新自动备份间隔')
  } catch (error) {
    message.error(`设置失败：${error instanceof Error ? error.message : String(error)}`)
    // 改回原来的值
    backupInterval.value = backupSettings.value?.autoBackupIntervalHours ?? 24
  }
}

/** 改保留数量。 */
const onKeepCountChange = async (value: number): Promise<void> => {
  try {
    const settings = await setBackupSettings({ keepCount: value })
    backupSettings.value = settings
    // 改少了就立刻清理超出的
    await loadBackups()
    message.success('已更新备份保留数量')
  } catch (error) {
    message.error(`设置失败：${error instanceof Error ? error.message : String(error)}`)
    backupKeepCount.value = backupSettings.value?.keepCount ?? 10
  }
}

/** 立刻备份。 */
const backupNow = async (): Promise<void> => {
  if (backingUp.value) return
  backingUp.value = true
  try {
    const entry = await createAutoBackup()
    message.success(`已备份：${formatDateTime(entry.createdAt)}`)
    await loadBackups()
  } catch (error) {
    message.error(`备份失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    backingUp.value = false
  }
}

/** 删掉一个备份。 */
const deleteBackup = async (item: BackupEntry): Promise<void> => {
  try {
    await deleteAutoBackup(item.fileName)
    message.success('已删除')
    await loadBackups()
  } catch (error) {
    message.error(`删除失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 用一个备份恢复。 */
const restoreBackup = async (item: BackupEntry): Promise<void> => {
  const confirmed = await confirmRestore(item)
  if (!confirmed) return
  restoring.value = item.fileName
  try {
    const result = await restoreAutoBackup(item.fileName)
    // 恢复前存的那份底子 —— 告诉用户它在哪，需要时可以退回去。
    const safety = result.safetyBackup ? `（原数据已存为 ${result.safetyBackup}）` : ''
    if (result.failures.length) {
      message.warning(`已恢复 ${result.restored} 项，${result.failures.length} 项失败${safety}`)
    } else {
      message.success(`已恢复 ${result.restored} 项${safety}`)
    }
    await loadBackups()
  } catch (error) {
    message.error(`恢复失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    restoring.value = ''
  }
}

/** 恢复前的确认 —— 恢复是覆盖动作，得说清楚。 */
const confirmRestore = (item: BackupEntry): Promise<boolean> => {
  restoreTarget.value = item
  restoreOpen.value = true
  return new Promise((resolve) => {
    restoreResolve = resolve
  })
}

/** 确认恢复。 */
const confirmRestoreYes = (): void => {
  restoreOpen.value = false
  restoreResolve?.(true)
  restoreResolve = null
}

/** 取消恢复。 */
const confirmRestoreNo = (): void => {
  restoreOpen.value = false
  restoreResolve?.(false)
  restoreResolve = null
}

/** 打开备份文件所在的文件夹。 */
const showBackupPath = async (item: BackupEntry): Promise<void> => {
  try {
    await openBackupFolder(item.fileName)
  } catch (error) {
    message.error(`打不开：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 备份路径只显示文件名部分 —— 完整路径太长。 */
const formatBackupPath = (path: string): string => {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

/** 文件大小。 */
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ── 数据管理 ──

/** 导出弹窗是否打开 */
const exportModalOpen = ref(false)
/** 导入弹窗是否打开 */
const importModalOpen = ref(false)

// ── 全局出站代理 ──

/** 代理地址（不含认证信息） */
const proxyUrl = ref('')
/** 代理认证：用户名 / 密码（可选） */
const proxyUser = ref('')
const proxyPassword = ref('')
/** 是否显示密码 */
const showPassword = ref(false)
/** 改过但还没保存 */
const dirty = ref(false)
/** 当前代理状态 */
const proxyInfo = ref<ProxyInfo | null>(null)
/** 扫到的本地代理 */
const detected = ref<DetectedProxy[]>([])
const saving = ref(false)
const testing = ref(false)
const scanning = ref(false)

/** 命令行工具的安装状态 */
const cli = ref<CliStatus | null>(null)

/** 合成带认证的完整地址：reqwest 认 URL 里的 user:pass */
const fullUrl = computed(() => {
  const base = proxyUrl.value.trim()
  if (!base) return ''
  if (!proxyUser.value.trim()) return base
  const user = encodeURIComponent(proxyUser.value.trim())
  const pass = proxyPassword.value ? `:${encodeURIComponent(proxyPassword.value)}` : ''
  return base.replace(/^(\w+:\/\/)/, `$1${user}${pass}@`)
})

/** 当前生效的代理（界面直接显示） */
const effectiveText = computed(() => {
  const info = proxyInfo.value
  if (!info) return '—'
  if (info.source === 'unset') return '未配置（直连）'
  const source = info.source === 'settings' ? '全局设置' : '环境变量'
  return info.effectiveUrl ? `${info.effectiveUrl}（来源：${source}）` : `直连（来源：${source}）`
})

/** 从完整地址里拆出认证信息 */
const splitAuth = (raw: string): { base: string; user: string; pass: string } => {
  const trimmed = raw.trim()
  if (!trimmed) return { base: '', user: '', pass: '' }
  try {
    const parsed = new URL(trimmed)
    const user = decodeURIComponent(parsed.username || '')
    const pass = decodeURIComponent(parsed.password || '')
    parsed.username = ''
    parsed.password = ''
    return { base: parsed.toString(), user, pass }
  } catch {
    return { base: trimmed, user: '', pass: '' }
  }
}

const copyCliCommand = (): void => {
  void navigator.clipboard?.writeText('agentspace run <智能体名称>')
  message.success('已复制命令')
}

const load = async () => {
  // 当前版本（编译期常量 + 后端确认）
  await loadCurrentVersion()
  // 备份列表与设置
  await loadBackups()
  try {
    cli.value = await getCliStatus()
  } catch {
    cli.value = null
  }
  try {
    const info = await getProxy()
    proxyInfo.value = info
    const { base, user, pass } = splitAuth(info.savedUrl ?? '')
    proxyUrl.value = base
    proxyUser.value = user
    proxyPassword.value = pass
    dirty.value = false
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

const markDirty = () => {
  dirty.value = true
}

const save = async () => {
  saving.value = true
  try {
    proxyInfo.value = await setProxy(fullUrl.value)
    dirty.value = false
    message.success(fullUrl.value ? '代理已保存，出站请求会走它' : '已保存，当前直连')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    saving.value = false
  }
}

const test = async () => {
  if (!fullUrl.value) return
  testing.value = true
  try {
    const result = await testProxy(fullUrl.value)
    if (result.success) {
      message.success(`代理可用，耗时 ${result.latencyMs} ms`)
    } else {
      message.error(`代理不通：${result.error ?? '未知错误'}`)
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    testing.value = false
  }
}

const scan = async () => {
  scanning.value = true
  try {
    detected.value = await scanProxies()
    if (!detected.value.length) message.info('没扫到本机代理')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    scanning.value = false
  }
}

const clear = () => {
  proxyUrl.value = ''
  proxyUser.value = ''
  proxyPassword.value = ''
  detected.value = []
  markDirty()
}

/** 点扫到的代理：填进地址栏 */
const pick = (url: string) => {
  const { base, user, pass } = splitAuth(url)
  proxyUrl.value = base
  proxyUser.value = user
  proxyPassword.value = pass
  detected.value = []
  markDirty()
}

onMounted(load)
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">系统设置</h1>
        <p class="page-sub">应用信息与版本更新</p>
      </div>
    </header>

    <div class="card">
      <div class="row">
        <div class="identity">
          <span class="mark" aria-hidden="true">
            <img class="mark-logo" :src="agentspaceLogo" width="32" height="32" alt="" />
          </span>
          <span class="identity-text">
            <span class="identity-name">AgentSpace</span>
            <span class="identity-version tnum">版本 {{ currentVersion }}</span>
          </span>
        </div>

        <!--
          按钮三态：
          - 未检查   → 「检查最新版本」
          - 有新版本 → 「更新到 X.Y.Z」（跟现在一样）
          - 已是最新 → 「已是最新版本」，禁用
        -->
        <NButton
          v-if="!hasUpdate"
          type="primary"
          size="small"
          :loading="updateState === 'checking'"
          :disabled="isLatest"
          @click="checkLatestVersion(message)"
        >
          <template #icon>
            <NIcon :size="13">
              <Search />
            </NIcon>
          </template>
          {{ isLatest ? '已是最新版本' : '检查最新版本' }}
        </NButton>

        <NButton
          v-else
          type="primary"
          size="small"
          :loading="installing"
          @click="startUpdate(message)"
        >
          <template #icon>
            <NIcon :size="13">
              <Download />
            </NIcon>
          </template>
          {{ installing ? '正在下载…' : `更新到 ${latestVersion}` }}
        </NButton>
      </div>

      <!-- 下载中：进度条（下载在应用内完成，不跳出浏览器） -->
      <div v-if="installing" class="download-block">
        <div class="row row-note">
          <span class="note-text">正在下载新版本</span>
          <span v-if="downloadPercent !== null" class="note-version tnum"
            >{{ downloadPercent }}%</span
          >
          <span class="note-date tnum">
            {{ downloadedMb }}<template v-if="totalMb"> / {{ totalMb }}</template> MB
          </span>
        </div>
        <NProgress
          type="line"
          :percentage="downloadPercent ?? undefined"
          :indeterminate="downloadPercent === null"
          :height="4"
          :show-indicator="false"
          processing
        />
        <p class="note-hint">下载完会自动安装并重启，不用你手动操作。</p>
      </div>

      <!-- 有新版本：说清楚是什么版本、什么时候发的、改了什么 -->
      <div v-if="hasUpdate" class="update-block">
        <div class="row row-note">
          <span class="note-text">检测到新版本</span>
          <span class="note-version tnum">{{ latestVersion }}</span>
          <span v-if="updatePublishedAt" class="note-date">发布于 {{ updatePublishedAt }}</span>
          <NButton text size="tiny" @click="openReleaseNotes(message)">查看发布说明</NButton>
          <!-- 展开/收起靠右 -->
          <NButton
            v-if="updateNotes.length > 200"
            text
            size="tiny"
            class="notes-toggle"
            @click="notesExpanded = !notesExpanded"
          >
            {{ notesExpanded ? '收起' : '展开全部' }}
          </NButton>
        </div>

        <div v-if="updateNotes" class="notes" :class="{ expanded: notesExpanded }">
          <MarkdownView class="notes-body" :source="updateNotes" />
        </div>
      </div>
    </div>

    <section class="section">
      <header class="section-head">
        <h2 class="section-title">命令行</h2>
        <p class="section-sub">
          在终端里用 <code class="mono">agentspace run &lt;智能体名称&gt;</code> 启动智能体 ——
          会把绑定的 Skills、指令和 MCP 落到当前目录，然后用 Pi 打开。
        </p>
      </header>

      <div class="card">
        <div class="field">
          <div class="field-label">
            安装状态
            <span class="field-hint">
              {{
                cli?.installed
                  ? '已就绪，终端里可以直接敲 agentspace。'
                  : '还没装好 —— 重启一次桌面端会自动补上。'
              }}
            </span>
          </div>
          <div v-if="cli?.path" class="field-row">
            <code class="mono cli-path">{{ cli.path }}</code>
          </div>
        </div>

        <div class="field">
          <div class="field-label">用法</div>
          <div class="field-row">
            <code class="mono cli-cmd">agentspace run &lt;智能体名称&gt;</code>
            <NButton quaternary size="small" @click="copyCliCommand">
              <template #icon>
                <NIcon :size="14">
                  <Copy />
                </NIcon>
              </template>
              复制
            </NButton>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <header class="section-head">
        <h2 class="section-title">网络</h2>
        <p class="section-sub">
          全局出站代理：技能下载、版本检查、MCP 目录搜索等出站请求都经此代理。留空保存即直连。
        </p>
      </header>

      <div class="card">
        <div class="field">
          <label class="field-label" for="proxy-url">代理地址</label>
          <div class="field-row">
            <NInput
              id="proxy-url"
              v-model:value="proxyUrl"
              class="mono"
              placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
              @update:value="markDirty"
              @keyup.enter="dirty && save()"
            />
            <NButton quaternary size="small" :loading="scanning" @click="scan">
              <template #icon>
                <NIcon :size="14">
                  <Search />
                </NIcon>
              </template>
              扫描
            </NButton>
            <NButton quaternary size="small" :loading="testing" :disabled="!fullUrl" @click="test">
              <template #icon>
                <NIcon :size="14">
                  <TestTube2 />
                </NIcon>
              </template>
              测试
            </NButton>
            <NButton quaternary size="small" @click="clear">
              <template #icon>
                <NIcon :size="14">
                  <X />
                </NIcon>
              </template>
              清除
            </NButton>
            <NButton type="primary" size="small" :loading="saving" :disabled="!dirty" @click="save">
              保存
            </NButton>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="proxy-user">认证（可选）</label>
          <div class="field-row">
            <NInput
              id="proxy-user"
              v-model:value="proxyUser"
              class="mono"
              placeholder="用户名"
              @update:value="markDirty"
            />
            <NInput
              v-model:value="proxyPassword"
              class="mono"
              :type="showPassword ? 'text' : 'password'"
              placeholder="密码"
              @update:value="markDirty"
            >
              <template #suffix>
                <button
                  class="eye"
                  type="button"
                  :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                  @click="showPassword = !showPassword"
                >
                  <NIcon :size="14">
                    <EyeOff v-if="showPassword" />
                    <Eye v-else />
                  </NIcon>
                </button>
              </template>
            </NInput>
          </div>
        </div>

        <div class="row row-note">
          <span class="note-text">当前生效</span>
          <span class="note-value mono">{{ effectiveText }}</span>
        </div>

        <div v-if="detected.length" class="detected">
          <button
            v-for="item in detected"
            :key="item.url"
            type="button"
            class="chip mono"
            @click="pick(item.url)"
          >
            {{ item.url }}
          </button>
        </div>
      </div>
    </section>

    <section class="section">
      <header class="section-head">
        <h2 class="section-title">
          数据管理
          <NTooltip trigger="hover">
            <template #trigger>
              <NIcon :size="13" class="section-info">
                <Info />
              </NIcon>
            </template>
            导入和导出本地配置数据
          </NTooltip>
        </h2>
        <p class="section-sub">导入和导出智能体、Skills、MCP server 与 Pi 扩展</p>
      </header>

      <div class="card">
        <div class="row data-row">
          <NButton size="small" @click="exportModalOpen = true">
            <template #icon>
              <NIcon :size="14">
                <Download />
              </NIcon>
            </template>
            导出数据
          </NButton>
          <NButton size="small" @click="importModalOpen = true">
            <template #icon>
              <NIcon :size="14">
                <Upload />
              </NIcon>
            </template>
            导入数据
          </NButton>
        </div>
      </div>
    </section>

    <section class="section">
      <header class="section-head">
        <h2 class="section-title">
          备份与恢复
          <NTooltip trigger="hover">
            <template #trigger>
              <NIcon :size="13" class="section-info">
                <Info />
              </NIcon>
            </template>
            定期把本机数据存一份快照，出问题可以回滚
          </NTooltip>
        </h2>
        <p class="section-sub">自动备份的快照存在本机，可以随时恢复回去</p>
      </header>

      <div class="card">
        <div class="row backup-settings">
          <div class="backup-field">
            <span class="field-label">自动备份间隔</span>
            <NSelect
              v-model:value="backupInterval"
              :options="intervalOptions"
              size="small"
              @update:value="onIntervalChange"
            />
          </div>
          <div class="backup-field">
            <span class="field-label">备份保留数量</span>
            <NSelect
              v-model:value="backupKeepCount"
              :options="keepOptions"
              size="small"
              @update:value="onKeepCountChange"
            />
          </div>
        </div>

        <div class="row backup-actions">
          <span class="backup-sub">
            备份内容：智能体、Skills、MCP server、Pi 扩展与 Wiki 页面
          </span>
          <NButton size="small" :loading="backingUp" @click="backupNow">
            <template #icon>
              <NIcon :size="14">
                <Save />
              </NIcon>
            </template>
            立即备份
          </NButton>
        </div>

        <!-- 备份列表：新的在前 -->
        <div v-if="backups.length" class="backup-list">
          <div v-for="item in backups" :key="item.fileName" class="backup-item">
            <div class="backup-info">
              <span class="backup-time tnum">{{ formatDateTime(item.createdAt) }}</span>
              <span class="backup-path mono">
                {{ formatBackupPath(item.path) }} - {{ formatSize(item.size) }}
              </span>
            </div>
            <div class="backup-buttons">
              <NTooltip trigger="hover">
                <template #trigger>
                  <NButton quaternary circle size="tiny" @click="showBackupPath(item)">
                    <template #icon>
                      <NIcon :size="13">
                        <FolderOpen />
                      </NIcon>
                    </template>
                  </NButton>
                </template>
                打开所在文件夹
              </NTooltip>
              <NTooltip trigger="hover">
                <template #trigger>
                  <NButton
                    quaternary
                    circle
                    size="tiny"
                    :disabled="restoring === item.fileName"
                    @click="restoreBackup(item)"
                  >
                    <template #icon>
                      <NIcon :size="13">
                        <RotateCcw />
                      </NIcon>
                    </template>
                  </NButton>
                </template>
                用这个备份恢复
              </NTooltip>
              <NTooltip trigger="hover">
                <template #trigger>
                  <NButton quaternary circle size="tiny" @click="deleteBackup(item)">
                    <template #icon>
                      <NIcon :size="13">
                        <Trash2 />
                      </NIcon>
                    </template>
                  </NButton>
                </template>
                删掉这个备份
              </NTooltip>
            </div>
          </div>
        </div>
        <p v-else class="backup-empty">还没有备份 —— 点「立即备份」存一份。</p>
      </div>
    </section>

    <BackupExportModal :show="exportModalOpen" @close="exportModalOpen = false" />
    <BackupImportModal :show="importModalOpen" @close="importModalOpen = false" />

    <!-- 恢复是覆盖动作 —— 先说清楚会覆盖什么 -->
    <NModal
      :show="restoreOpen"
      preset="card"
      class="restore-modal"
      :style="{ width: 'min(420px, calc(100vw - 48px))' }"
      :bordered="false"
      @update:show="(value: boolean) => !value && confirmRestoreNo()"
    >
      <template #header>
        <span class="modal-title">用备份恢复</span>
      </template>
      <p class="restore-text">
        恢复会用
        <code class="mono">{{ restoreTarget ? formatDateTime(restoreTarget.createdAt) : '' }}</code>
        这个备份<strong>覆盖</strong>本机现有的智能体、Skills、MCP server、Pi 扩展与 Wiki 页面。
      </p>
      <p class="restore-hint">
        当前数据会被替换掉 —— 想保留现状的话，先「立即备份」存一份。
        恢复前也会自动存一份底子，恢复完会告诉你它的名字。
      </p>
      <template #footer>
        <div class="row">
          <NButton size="small" @click="confirmRestoreNo">取消</NButton>
          <NButton size="small" type="primary" @click="confirmRestoreYes">恢复</NButton>
        </div>
      </template>
    </NModal>
  </section>
</template>

<style scoped>
.page {
  padding: 20px 24px 32px;
}

.page-head {
  margin-bottom: 16px;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.page-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-text-3);
}

.card {
  width: 100%;
  overflow: hidden;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
}

.row-note {
  /* 元素挤在左边，「展开/收起」靠 margin-left:auto 推到最右 */
  justify-content: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--c-border);
  background: var(--c-surface-sunken);
}

.identity {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  overflow: hidden;
  border-radius: var(--radius);
}

/* 应用图标：跟 exe 图标、侧边栏品牌行同一张，铺满容器 */
.mark-logo {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.identity-text {
  display: flex;
  flex-direction: column;
}

.identity-name {
  font-size: 14px;
  font-weight: 600;
}

.identity-version {
  font-size: 12px;
  color: var(--c-text-3);
}

.note-text {
  font-size: 12px;
  color: var(--c-text-3);
}

.note-version {
  font-size: 12px;
  font-weight: 600;
}

.note-date {
  font-size: 12px;
  color: var(--c-text-4);
}

/* 新版本的发布说明 —— 默认只露三行 */
.update-block {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--c-border);
}

/* 下载进度块 */
.download-block {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--c-border);
}

.note-hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--c-text-3);
}

.notes {
  position: relative;
}

.notes-body {
  margin: 0;
  padding: 10px 12px;
  max-height: 220px;
  overflow: hidden;
  background: var(--c-surface-sunken);
  border: 1px solid var(--c-border);
  border-radius: 6px;
}

.notes.expanded .notes-body {
  max-height: none;
}

.notes-toggle {
  margin-left: auto;
}

/* ── 网络 ── */

.section {
  margin-top: 24px;
}

.section-head {
  margin-bottom: 10px;
}

.section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.section-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-text-3);
}

/* 标题旁的说明图标 */
.section-info {
  margin-left: 4px;
  color: var(--c-text-3);
  cursor: help;
  vertical-align: -2px;
}

/* 数据管理卡片里的两个按钮 */
.data-row {
  justify-content: flex-start;
  gap: 10px;
}

/* 备份设置：两个下拉并排 */
.backup-settings {
  justify-content: flex-start;
  gap: 24px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--c-border);
}

.backup-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 180px;
}

.backup-field .field-label {
  font-size: 12px;
  color: var(--c-text-3);
}

/* 备份那行：左边说明，右边按钮 */
.backup-actions {
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
}

.backup-sub {
  font-size: 12px;
  color: var(--c-text-3);
}

/* 备份列表 */
.backup-list {
  max-height: 260px;
  overflow-y: auto;
  border-top: 1px solid var(--c-border);
}

.backup-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--c-border);
}

.backup-item:last-child {
  border-bottom: none;
}

.backup-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.backup-time {
  font-size: 13px;
  color: var(--c-text);
}

.backup-path {
  overflow: hidden;
  font-size: 11px;
  color: var(--c-text-4);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.backup-buttons {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.backup-empty {
  padding: 16px;
  font-size: 12px;
  color: var(--c-text-4);
}

/* 恢复确认弹窗 */
.restore-text {
  font-size: 13px;
  line-height: 1.7;
}

.restore-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--c-text-3);
}

.field {
  padding: 14px 16px;
  border-bottom: 1px solid var(--c-border);
}

.field-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--c-text-2);
}

.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mono {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.note-value {
  font-size: 12px;
  color: var(--c-text-2);
  word-break: break-all;
}

.eye {
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--c-text-3);
  cursor: pointer;
  background: none;
  border: none;
}

.detected {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 12px 16px;
  border-top: 1px solid var(--c-border);
  background: var(--c-surface-sunken);
}

.chip {
  padding: 3px 8px;
  font-size: 12px;
  color: var(--c-text-2);
  cursor: pointer;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 4px;
}

.chip:hover {
  border-color: var(--c-accent);
  color: var(--c-accent);
}
.cli-path,
.cli-cmd {
  flex: 1;
  padding: 6px 9px;
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--c-text);
  word-break: break-all;
}
</style>
