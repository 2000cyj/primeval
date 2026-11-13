<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NIcon, NRadioButton, NRadioGroup, useMessage } from 'naive-ui'
import { Copy, Eye, EyeOff, RefreshCw } from 'lucide-vue-next'
import { buildMcpUrl } from '@remote/agent-compose-mcp/types'

const props = defineProps<{
  /** 基础地址，如 http://127.0.0.1:7801 */
  endpoint: string
  /** Bearer token */
  token: string
  /** 当前在线 MCP session 数 */
  sessions: number
  /** 刷新 token 中 */
  refreshing?: boolean
}>()

const emit = defineEmits<{ 'refresh-token': [] }>()

const message = useMessage()

/** 全部工具的接入地址（不带 token） */
const baseUrl = computed(() => buildMcpUrl(props.endpoint, { kind: 'all' }, ''))
/** 全部工具的完整接入地址（带 token） */
const fullUrl = computed(() => buildMcpUrl(props.endpoint, { kind: 'all' }, props.token))

type SnippetKey = 'claude' | 'cursor' | 'codex' | 'json'

const activeSnippet = ref<SnippetKey>('claude')
const revealToken = ref(false)

const snippets = computed(() => {
  const url = fullUrl.value
  const stringify = (value: unknown): string => JSON.stringify(value, null, 2)
  return {
    claude: {
      label: 'Claude Code',
      filename: '.mcp.json',
      content: stringify({ mcpServers: { agentspace: { type: 'http', url } } }),
    },
    cursor: {
      label: 'Cursor',
      filename: '.cursor/mcp.json',
      content: stringify({ mcpServers: { agentspace: { url } } }),
    },
    codex: {
      label: 'Codex',
      filename: '~/.codex/config.toml',
      content: `[mcp_servers.agentspace]\nurl = "${url}"\n`,
    },
    json: {
      label: '通用 JSON',
      filename: 'mcp.json',
      content: stringify({
        name: 'agentspace',
        transport: 'http',
        url,
        authorization: `Bearer ${props.token}`,
      }),
    },
  } satisfies Record<SnippetKey, { label: string; filename: string; content: string }>
})

const activeSnippetContent = computed(() => snippets.value[activeSnippet.value])

const copy = async (text: string, label: string): Promise<void> => {
  if (!navigator.clipboard) {
    message.warning('当前环境不支持剪贴板，请手动复制')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    message.success(`${label}已复制`)
  } catch {
    message.error('复制失败，请手动选择文本')
  }
}
</script>

<template>
  <section class="card">
    <header class="card-head">
      <div class="head-text">
        <span class="card-title">接入信息</span>
        <span class="card-sub">agent 通过这个地址连上 AgentSpace 的 MCP 代理</span>
      </div>
    </header>

    <dl class="kv-grid">
      <div class="kv">
        <dt class="kv-label">Endpoint</dt>
        <dd class="kv-value mono">{{ baseUrl }}</dd>
        <NButton size="tiny" secondary @click="copy(fullUrl, '接入地址')">
          <template #icon>
            <NIcon :size="13">
              <Copy />
            </NIcon>
          </template>
          复制
        </NButton>
      </div>

      <div class="kv">
        <dt class="kv-label">Token</dt>
        <dd class="kv-value mono">{{ revealToken ? token : '••••••••••••' }}</dd>
        <div class="kv-actions">
          <NButton size="tiny" quaternary @click="revealToken = !revealToken">
            <template #icon>
              <NIcon :size="13">
                <EyeOff v-if="revealToken" />
                <Eye v-else />
              </NIcon>
            </template>
            {{ revealToken ? '隐藏' : '显示' }}
          </NButton>
          <NButton size="tiny" secondary @click="copy(token, 'Token')">
            <template #icon>
              <NIcon :size="13">
                <Copy />
              </NIcon>
            </template>
            复制
          </NButton>
          <NButton
            size="tiny"
            quaternary
            :loading="props.refreshing"
            title="让运行中的 sidecar 立刻用上当前的 token"
            @click="emit('refresh-token')"
          >
            <template #icon>
              <NIcon :size="13">
                <RefreshCw />
              </NIcon>
            </template>
            刷新 token
          </NButton>
        </div>
      </div>

      <div class="kv">
        <dt class="kv-label">在线 Session</dt>
        <dd class="kv-value tnum">{{ sessions }} 个</dd>
      </div>
    </dl>

    <div class="snippet-block">
      <div class="snippet-head">
        <NRadioGroup v-model:value="activeSnippet" size="small">
          <NRadioButton v-for="(item, key) in snippets" :key="key" :value="key">
            {{ item.label }}
          </NRadioButton>
        </NRadioGroup>
        <NButton size="tiny" secondary @click="copy(activeSnippetContent.content, '配置片段')">
          <template #icon>
            <NIcon :size="13">
              <Copy />
            </NIcon>
          </template>
          复制配置片段
        </NButton>
      </div>

      <div class="snippet-body">
        <span class="snippet-file mono">{{ activeSnippetContent.filename }}</span>
        <pre class="snippet-code mono">{{ activeSnippetContent.content }}</pre>
      </div>

      <p class="snippet-hint">
        片段仅供你自行粘贴到 agent 的配置文件，本页不会自动改写任何 agent 配置。
      </p>
    </div>
  </section>
</template>

<style scoped>
.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--c-border);
}

.head-text {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.card-title {
  font-size: 13px;
  font-weight: 600;
}

.card-sub {
  font-size: 12px;
  color: var(--c-text-3);
}

.kv-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1.4fr) minmax(0, 0.8fr);
  gap: 12px;
  margin: 0;
  padding: 14px 16px;
}

.kv {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}

.kv-label {
  font-size: 11px;
  color: var(--c-text-3);
}

.kv-value {
  margin: 0;
  overflow: hidden;
  max-width: 100%;
  font-size: 12px;
  color: var(--c-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kv-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.snippet-block {
  padding: 0 16px 16px;
}

.snippet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.snippet-body {
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface-sunken);
}

.snippet-file {
  display: block;
  padding: 7px 12px;
  border-bottom: 1px solid var(--c-border);
  color: var(--c-text-3);
}

.snippet-code {
  margin: 0;
  padding: 12px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.6;
  color: var(--c-text-2);
}

.snippet-hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--c-text-3);
}

@media (max-width: 900px) {
  .kv-grid {
    grid-template-columns: 1fr;
  }
}
</style>
