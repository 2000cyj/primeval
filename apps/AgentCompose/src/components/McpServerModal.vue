<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NButton,
  NFormItem,
  NIcon,
  NInput,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSpace,
} from 'naive-ui'
import { Plug, Plus, Trash2 } from 'lucide-vue-next'
import { useMessage } from 'naive-ui'
import type { McpAuthKind, McpServerDef, McpTransportKind } from '@remote/agent-compose-mcp/types'
import { openUrl, probeServerDef } from '@/api/mcp'

const message = useMessage()

const props = defineProps<{
  show: boolean
  /** 传入即为编辑，null 为新增 */
  server: McpServerDef | null
}>()

const emit = defineEmits<{
  close: []
  save: [server: McpServerDef]
}>()

/** env / headers 的键值行 */
type KvRow = { key: string; value: string }

type ServerForm = {
  name: string
  id: string
  transport: McpTransportKind
  auth: McpAuthKind
  command: string
  args: string
  env: KvRow[]
  url: string
  headers: KvRow[]
  /**
   * 手动配置的令牌（oauth 模式用）。
   *
   * 字面量（用户贴的）或 `${ENV:NAME}` 占位（令牌在环境变量里）都支持。
   */
  token: string
}

const blankForm = (): ServerForm => ({
  name: '',
  id: '',
  transport: 'stdio',
  auth: 'none',
  command: '',
  args: '',
  env: [],
  url: '',
  headers: [],
  token: '',
})

const form = ref<ServerForm>(blankForm())

function rowsOf(record: Record<string, string> | undefined): KvRow[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value }))
}

function recordOf(rows: KvRow[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (key) record[key] = row.value
  }
  return record
}

function reset(): void {
  const server = props.server
  if (!server) {
    form.value = blankForm()
    return
  }
  form.value = {
    name: server.name,
    id: server.id,
    transport: server.transport,
    auth: server.auth ?? 'none',
    command: server.command ?? '',
    args: (server.args ?? []).join(' '),
    env: rowsOf(server.env),
    url: server.url ?? '',
    headers: rowsOf(server.headers),
    token: server.token ?? '',
  }
}

watch(
  () => [props.show, props.server] as const,
  ([show]) => {
    if (show) reset()
  },
  { immediate: true },
)

const isEditing = computed(() => props.server !== null)

// OAuth 只适用于远程（http）上游；切回 stdio 时把认证方式退回到 none
watch(
  () => form.value.transport,
  (transport) => {
    if (transport === 'stdio' && form.value.auth === 'oauth') form.value.auth = 'none'
  },
)

/**
 * 当前认证方式需要填什么。
 *
 * 这是用户最常问的：「这个 server 要什么认证？令牌填哪儿？」
 * 所以每种方式都说清楚「填在哪个字段、怎么写」。
 */
const authHint = computed(() => {
  if (form.value.auth === 'oauth') {
    return form.value.transport === 'http'
      ? '远程服务要求 OAuth 授权（figma、notion 这类）。' +
          '点「测试」会拉起浏览器，你登录并同意后令牌自动保存，不用手填。' +
          '如果你手里有长期令牌（PAT），也可以直接在下面的「令牌」里贴，' +
          '写 ${ENV:NAME} 则从环境变量读 —— 这样就跳过浏览器。'
      : 'OAuth 只适用于远程（http）上游，本地进程用不了。'
  }
  if (form.value.auth === 'static') {
    return form.value.transport === 'http'
      ? '在「请求头」里填固定令牌，例如 Authorization: Bearer <令牌>。' +
          '令牌值两种写法都行：直接贴，或者写 ${ENV:NAME} 从环境变量读' +
          '（推荐 —— 令牌不进配置文件）。'
      : '在「env」里填令牌，例如 API_KEY: <令牌>。' +
          '值两种写法都行：直接贴，或者写 ${ENV:NAME} 从环境变量读' +
          '（推荐 —— 令牌不进配置文件）。'
  }
  return (
    '不带任何认证信息。若连上后报 401，说明这个 server 其实要认证 ——' +
    '改成「固定令牌」或「OAuth 授权」。'
  )
})

const errors = computed(() => {
  const list: Partial<Record<'name' | 'id' | 'command' | 'url', string>> = {}
  const name = form.value.name.trim()
  const id = form.value.id.trim()
  if (!name) list.name = '名称不能为空'
  if (!id) {
    list.id = 'id 不能为空'
  } else if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    list.id = 'id 需以小写字母或数字开头，只能包含小写字母、数字、. _ -'
  }
  if (form.value.transport === 'stdio' && !form.value.command.trim()) {
    list.command = 'command 不能为空'
  }
  if (form.value.transport === 'http' && !form.value.url.trim()) {
    list.url = 'url 不能为空'
  }
  return list
})

const valid = computed(() => Object.keys(errors.value).length === 0)

/** 表单里的内容 → 上游定义（测试连接时用的就是这个，不落盘） */
const toDef = (): McpServerDef => {
  const def: McpServerDef = {
    id: form.value.id.trim(),
    name: form.value.name.trim(),
    transport: form.value.transport,
    enabled: props.server?.enabled ?? true,
    auth:
      form.value.transport === 'stdio' && form.value.auth === 'oauth' ? 'none' : form.value.auth,
  }
  if (def.transport === 'stdio') {
    def.command = form.value.command.trim()
    def.args = form.value.args.split(/\s+/).filter(Boolean)
    def.env = recordOf(form.value.env)
  } else {
    def.url = form.value.url.trim()
    def.headers = recordOf(form.value.headers)
    def.token = form.value.token.trim() || undefined
  }
  return def
}

/** 正在测试 */
const testing = ref(false)
/** 测试结果：成功/失败/需要授权 */
const testResult = ref<{ ok: boolean; text: string; authorizeUrl?: string } | null>(null)

/** 授权轮询：用户去浏览器授权是异步的，这里等着看结果 */
const OAUTH_POLL_INTERVAL_MS = 3000
const OAUTH_POLL_TIMEOUT_MS = 120_000
let pollTimer: number | null = null
let pollDeadline = 0

const stopPolling = (): void => {
  if (pollTimer !== null) {
    window.clearTimeout(pollTimer)
    pollTimer = null
  }
}

/**
 * 等用户完成浏览器授权。
 *
 * 授权是异步的：用户在浏览器里登录、同意，授权服务器回调本机，
 * 令牌才会出现。这里定期重测一次连接，看令牌好了没。
 */
const pollAuthorize = async (def: McpServerDef): Promise<void> => {
  if (Date.now() > pollDeadline) {
    stopPolling()
    testResult.value = { ok: false, text: '授权等待超时，请重新测试' }
    return
  }
  try {
    const result = await probeServerDef(def)
    if (result.ok) {
      stopPolling()
      testResult.value = { ok: true, text: `授权成功，${result.tools} 个工具` }
      return
    }
    if (result.authorizeUrl) {
      // 还在等 —— 继续等
    } else if (result.error) {
      stopPolling()
      testResult.value = { ok: false, text: result.error }
      return
    }
  } catch {
    // 轮询失败不报 —— 下一次再试
  }
  pollTimer = window.setTimeout(() => {
    void pollAuthorize(def)
  }, OAUTH_POLL_INTERVAL_MS)
}

/**
 * 测一下当前填的内容能不能连上。
 *
 * 测的是**表单里的值**，不是已保存的那个 —— 用户还没保存就想知道行不行。
 * oauth 上游没授权时，这里会给出授权地址，由界面打开浏览器。
 */
const onTest = async (): Promise<void> => {
  if (!valid.value) {
    message.warning('先把这几项填对再测')
    return
  }
  stopPolling()
  testing.value = true
  testResult.value = null
  const def = toDef()
  try {
    const result = await probeServerDef(def)
    if (result.ok) {
      const source =
        result.tokenSource === 'env'
          ? '（令牌来自环境变量）'
          : result.tokenSource === 'manual'
            ? '（手动配置的令牌）'
            : result.tokenSource === 'oauth'
              ? '（浏览器授权的令牌）'
              : ''
      testResult.value = {
        ok: true,
        text: `连接成功，${result.tools} 个工具${source}`,
      }
      return
    }
    if (result.authorizeUrl) {
      // 需要浏览器授权：打开浏览器，然后等用户授权完
      testResult.value = {
        ok: false,
        text: '已打开浏览器，请登录并同意授权（完成后这里会自动更新）',
        authorizeUrl: result.authorizeUrl,
      }
      await openUrl(result.authorizeUrl)
      pollDeadline = Date.now() + OAUTH_POLL_TIMEOUT_MS
      void pollAuthorize(def)
      return
    }
    testResult.value = { ok: false, text: result.error ?? '连接失败' }
  } catch (error) {
    testResult.value = {
      ok: false,
      text: error instanceof Error ? error.message : String(error),
    }
  } finally {
    testing.value = false
  }
}

const addRow = (field: 'env' | 'headers'): void => {
  form.value[field] = [...form.value[field], { key: '', value: '' }]
}

const removeRow = (field: 'env' | 'headers', index: number): void => {
  form.value[field] = form.value[field].filter((_, rowIndex) => rowIndex !== index)
}

const submit = (): void => {
  if (!valid.value) return
  emit('save', toDef())
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    class="server-modal"
    style="width: 460px"
    :bordered="false"
    :title="isEditing ? '编辑 MCP server' : '新增 MCP server'"
    @update:show="(value: boolean) => !value && emit('close')"
  >
    <div class="form-scroll">
      <div class="form">
        <div class="form-row">
          <NFormItem
            label="名称"
            :validation-status="errors.name ? 'error' : undefined"
            :feedback="errors.name"
            class="form-item"
          >
            <NInput
              v-model:value="form.name"
              size="small"
              placeholder="展示给用户的名称，如 GitHub"
            />
          </NFormItem>

          <NFormItem
            label="id"
            :validation-status="errors.id ? 'error' : undefined"
            :feedback="errors.id"
            class="form-item"
          >
            <NInput
              v-model:value="form.id"
              size="small"
              :disabled="isEditing"
              placeholder="唯一标识，用作工具名前缀"
            />
          </NFormItem>
        </div>

        <NFormItem label="传输方式" class="form-item">
          <NRadioGroup v-model:value="form.transport" size="small">
            <NRadioButton value="stdio">stdio</NRadioButton>
            <NRadioButton value="http">http</NRadioButton>
          </NRadioGroup>
        </NFormItem>

        <NFormItem label="认证方式" class="form-item">
          <div class="auth-box">
            <NRadioGroup v-model:value="form.auth" size="small">
              <NRadioButton value="none">不需要认证</NRadioButton>
              <NRadioButton value="static">固定令牌</NRadioButton>
              <NRadioButton value="oauth" :disabled="form.transport !== 'http'">
                OAuth 授权
              </NRadioButton>
            </NRadioGroup>
            <p class="field-hint">{{ authHint }}</p>
            <p v-if="form.transport !== 'http'" class="field-hint">
              OAuth 授权仅支持 http 传输的远程 server。
            </p>
          </div>
        </NFormItem>

        <template v-if="form.transport === 'stdio'">
          <NFormItem
            label="command"
            :validation-status="errors.command ? 'error' : undefined"
            :feedback="errors.command"
            class="form-item"
          >
            <NInput v-model:value="form.command" size="small" placeholder="npx" />
          </NFormItem>

          <NFormItem label="args" class="form-item">
            <NInput
              v-model:value="form.args"
              size="small"
              placeholder="多个参数用空格分隔，如 -y @modelcontextprotocol/server-github"
            />
          </NFormItem>

          <NFormItem label="env" class="form-item">
            <div class="kv-rows">
              <div v-for="(row, index) in form.env" :key="index" class="kv-row">
                <NInput v-model:value="row.key" size="small" placeholder="变量名" />
                <NInput v-model:value="row.value" size="small" placeholder="变量值" />
                <NButton size="tiny" quaternary @click="removeRow('env', index)">
                  <template #icon>
                    <NIcon :size="13">
                      <Trash2 />
                    </NIcon>
                  </template>
                </NButton>
              </div>
              <NButton size="tiny" dashed @click="addRow('env')">
                <template #icon>
                  <NIcon :size="13">
                    <Plus />
                  </NIcon>
                </template>
                添加变量
              </NButton>
              <p class="field-hint">
                值支持 <code class="mono">${ENV:NAME}</code> 占位，真实值在运行时从环境变量解析。
              </p>
            </div>
          </NFormItem>
        </template>

        <template v-else>
          <NFormItem
            label="url"
            :validation-status="errors.url ? 'error' : undefined"
            :feedback="errors.url"
            class="form-item"
          >
            <NInput
              v-model:value="form.url"
              size="small"
              placeholder="https://mcp.example.com/sse"
            />
          </NFormItem>

          <NFormItem v-if="form.auth !== 'oauth'" label="headers" class="form-item">
            <div class="kv-rows">
              <div v-for="(row, index) in form.headers" :key="index" class="kv-row">
                <NInput v-model:value="row.key" size="small" placeholder="头名称" />
                <NInput v-model:value="row.value" size="small" placeholder="头值" />
                <NButton size="tiny" quaternary @click="removeRow('headers', index)">
                  <template #icon>
                    <NIcon :size="13">
                      <Trash2 />
                    </NIcon>
                  </template>
                </NButton>
              </div>
              <NButton size="tiny" dashed @click="addRow('headers')">
                <template #icon>
                  <NIcon :size="13">
                    <Plus />
                  </NIcon>
                </template>
                添加请求头
              </NButton>
              <p class="field-hint">
                值支持 <code class="mono">${ENV:NAME}</code> 占位，真实值在运行时从环境变量解析。
              </p>
              <p v-if="form.auth === 'static'" class="field-hint">
                固定令牌就写在这里，令牌支持 <code class="mono">${ENV:NAME}</code> 占位。
              </p>
            </div>
          </NFormItem>

          <NFormItem v-else label="令牌（可选）" class="form-item">
            <div class="kv-rows">
              <NInput
                v-model:value="form.token"
                size="small"
                placeholder="手动贴的令牌，或 ${ENV:NAME}"
              />
              <p class="field-hint">
                两种都行：直接贴令牌（手动配置），或写
                <code class="mono">${ENV:NAME}</code> 让它从环境变量读。
              </p>
              <p class="field-hint">
                <strong>留空</strong>则走浏览器授权流程：点「测试」会拉起浏览器，
                你登录并同意后令牌自动保存到本地。
              </p>
            </div>
          </NFormItem>
        </template>
      </div>
    </div>

    <template #footer>
      <div class="foot">
        <div class="foot-left">
          <NButton size="small" secondary :loading="testing" :disabled="!valid" @click="onTest">
            <template #icon>
              <NIcon :size="13">
                <Plug />
              </NIcon>
            </template>
            测试连接
          </NButton>
          <span v-if="testResult" class="test-result" :class="{ bad: !testResult.ok }">
            {{ testResult.text }}
          </span>
        </div>
        <NSpace justify="end">
          <NButton size="small" @click="emit('close')">取消</NButton>
          <NButton size="small" type="primary" :disabled="!valid" @click="submit">保存</NButton>
        </NSpace>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
/*
 * 内容区限高滚动。
 *
 * 窗口最小高度是 700px，表单字段较多（名称/传输/认证/命令/参数/环境变量
 * 或地址/请求头），不限制高度会顶出可视区。
 */
.form-scroll {
  max-height: calc(100vh - 210px);
  overflow-y: auto;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.form-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}

.form-item {
  margin-bottom: 14px;
}

.auth-box {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
}

.kv-rows {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
}

.kv-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) 28px;
  gap: 8px;
  align-items: center;
  width: 100%;
}

.field-hint {
  margin: 0;
  font-size: 11px;
  color: var(--c-text-3);
}

.field-hint code {
  padding: 1px 4px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
  color: var(--c-text-2);
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
}

.foot-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.test-result {
  overflow: hidden;
  font-size: 12px;
  color: var(--c-success);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.test-result.bad {
  color: var(--c-danger);
}
</style>
