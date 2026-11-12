<script setup lang="ts">
import { computed, ref } from 'vue'
import { NIcon, NInput } from 'naive-ui'
import { Plus, Wrench } from 'lucide-vue-next'
import SkillPickerModal from '@/components/SkillPickerModal.vue'
import McpPickerModal from '@/components/McpPickerModal.vue'
import ExtensionPickerModal from '@/components/ExtensionPickerModal.vue'

/**
 * 智能体配置表单（身份 + 行为与能力）。
 *
 * 新建向导的第二步与编辑页共用这一份 —— 两边字段一样，就不该抄两遍。
 */
const name = defineModel<string>('name', { required: true })
const description = defineModel<string>('description', { required: true })
const instruction = defineModel<string>('instruction', { required: true })
const skills = defineModel<string[]>('skills', { required: true })
const mcpServers = defineModel<string[]>('mcpServers', { required: true })
/** 绑定的 Pi 扩展（相对引用，如 `extensions/npm/pi-mcp-adapter`） */
const extensions = defineModel<string[]>('extensions', { required: true })

const showSkillPicker = ref(false)
const showMcpPicker = ref(false)
const showExtensionPicker = ref(false)

const descriptionLength = computed(() => description.value.length)
const descriptionMax = 255
</script>

<template>
  <section class="card">
    <h3 class="card-title">身份</h3>

    <div class="field">
      <label class="field-label" for="agent-name">名称</label>
      <NInput id="agent-name" v-model:value="name" size="small" placeholder="给智能体起个名字" />
    </div>

    <div class="field">
      <label class="field-label" for="agent-desc">描述</label>
      <div class="desc-wrap">
        <NInput
          id="agent-desc"
          v-model:value="description"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 8 }"
          placeholder="这个智能体负责什么、擅长什么"
        />
        <span class="counter tnum">{{ descriptionLength }} / {{ descriptionMax }}</span>
      </div>
    </div>
  </section>

  <section class="card">
    <h3 class="card-title">行为与能力</h3>

    <div class="field">
      <label class="field-label" for="agent-instruction">指令</label>
      <NInput
        id="agent-instruction"
        v-model:value="instruction"
        type="textarea"
        :autosize="{ minRows: 6, maxRows: 14 }"
        placeholder="写下这个智能体该做什么、关注什么、要避开什么…"
      />
    </div>

    <div class="field">
      <div class="field-label">SKILLS</div>
      <button type="button" class="skills-toggle" @click="showSkillPicker = true">
        <NIcon :size="13" color="var(--c-text-3)">
          <Plus />
        </NIcon>
        <span>已选 {{ skills.length }} 个 —— 点击修改</span>
      </button>
    </div>

    <div class="field">
      <div class="field-label">MCP</div>
      <button type="button" class="skills-toggle mcp-toggle" @click="showMcpPicker = true">
        <NIcon :size="13" color="var(--c-text-3)">
          <Plus />
        </NIcon>
        <span>已选 {{ mcpServers.length }} 个 —— 点击修改</span>
      </button>
    </div>

    <div class="field">
      <div class="field-label">
        PI 扩展
        <span class="field-hint">Pi 自带的扩展运行时自动加载，这里只管工具箱里的。</span>
      </div>
      <button type="button" class="skills-toggle" @click="showExtensionPicker = true">
        <NIcon :size="13" color="var(--c-text-3)">
          <Wrench />
        </NIcon>
        <span>已选 {{ extensions.length }} 个 —— 点击修改</span>
      </button>
    </div>
  </section>

  <SkillPickerModal
    :show="showSkillPicker"
    :selected="skills"
    @update:selected="skills = $event"
    @close="showSkillPicker = false"
  />

  <McpPickerModal
    :show="showMcpPicker"
    :selected="mcpServers"
    @update:selected="mcpServers = $event"
    @close="showMcpPicker = false"
  />

  <ExtensionPickerModal
    :show="showExtensionPicker"
    :selected="extensions"
    @update:selected="extensions = $event"
    @close="showExtensionPicker = false"
  />
</template>

<style scoped>
/* 表单卡片 */
.card {
  max-width: 720px;
  margin: 0 auto 16px;
  padding: 16px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
}

.card-title {
  margin: 0 0 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}

.field {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  align-items: start;
  gap: 16px;
  padding: 12px 0;
}

.field + .field {
  border-top: 1px solid var(--c-border);
}

.field-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  color: var(--c-text-2);
}

.field-hint {
  font-size: 11px;
  color: var(--c-text-4);
}

.desc-wrap {
  position: relative;
}

.counter {
  position: absolute;
  right: 10px;
  bottom: 8px;
  font-size: 11px;
  color: var(--c-text-4);
}

.skills-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface);
  font-size: 12px;
  color: var(--c-text-2);
  text-align: left;
}

.skills-toggle:hover {
  border-color: var(--c-border-strong);
}
</style>
