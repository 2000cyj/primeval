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
import { Plus, Trash2 } from 'lucide-vue-next'
import type { McpServerDef, McpTransportKind } from '@remote/agent-compose-mcp/types'

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
  command: string
  args: string
  env: KvRow[]
  url: string
  headers: KvRow[]
}

const blankForm = (): ServerForm => ({
  name: '',
  id: '',
  transport: 'stdio',
  command: '',
  args: '',
  env: [],
  url: '',
  headers: [],
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
    command: server.command ?? '',
    args: (server.args ?? []).join(' '),
    env: rowsOf(server.env),
    url: server.url ?? '',
    headers: rowsOf(server.headers),
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

const addRow = (field: 'env' | 'headers'): void => {
  form.value[field] = [...form.value[field], { key: '', value: '' }]
}

const removeRow = (field: 'env' | 'headers', index: number): void => {
  form.value[field] = form.value[field].filter((_, rowIndex) => rowIndex !== index)
}

const submit = (): void => {
  if (!valid.value) return
  const def: McpServerDef = {
    id: form.value.id.trim(),
    name: form.value.name.trim(),
    transport: form.value.transport,
    enabled: props.server?.enabled ?? true,
  }
  if (def.transport === 'stdio') {
    def.command = form.value.command.trim()
    def.args = form.value.args.split(/\s+/).filter(Boolean)
    def.env = recordOf(form.value.env)
  } else {
    def.url = form.value.url.trim()
    def.headers = recordOf(form.value.headers)
  }
  emit('save', def)
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    class="server-modal"
    style="width: 540px"
    :bordered="false"
    :title="isEditing ? '编辑 MCP server' : '新增 MCP server'"
    @update:show="(value: boolean) => !value && emit('close')"
  >
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
          <NInput v-model:value="form.url" size="small" placeholder="https://mcp.example.com/sse" />
        </NFormItem>

        <NFormItem label="headers" class="form-item">
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
          </div>
        </NFormItem>
      </template>
    </div>

    <template #footer>
      <NSpace justify="end">
        <NButton size="small" @click="emit('close')">取消</NButton>
        <NButton size="small" type="primary" :disabled="!valid" @click="submit">保存</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
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
</style>
