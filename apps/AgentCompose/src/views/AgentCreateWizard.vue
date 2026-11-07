<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NIcon, NInput, NRadio, useMessage } from 'naive-ui'
import { ArrowLeft, Monitor, Plus, Search, X } from 'lucide-vue-next'
import { harnesses, type Harness } from '@/data/runtimes'
import { skills } from '@/data/skills'
import SkillPickerModal from '@/components/SkillPickerModal.vue'

const emit = defineEmits<{ cancel: []; done: [name: string] }>()

const message = useMessage()

/** 当前步骤：1 选择运行时 / 2 配置 */
const step = ref<1 | 2>(1)

/** 选中的 harness */
const selectedHarness = ref<Harness | null>(null)

/** 搜索关键字 */
const keyword = ref('')

const filteredHarnesses = computed(() => {
  const word = keyword.value.trim().toLowerCase()
  if (!word) return harnesses
  return harnesses.filter((harness) =>
    `${harness.name}${harness.version}`.toLowerCase().includes(word),
  )
})

const selectHarness = (harness: Harness) => {
  selectedHarness.value = harness
}

/* ---------- 第二步：配置 ---------- */

const name = ref('')
const description = ref('')
const instruction = ref('')
const showSkillPicker = ref(false)
const selectedSkills = ref<string[]>(skills.slice(0, 8).map((skill) => skill.name))

const descriptionLength = computed(() => description.value.length)
const descriptionMax = 255

const goNext = () => {
  if (!selectedHarness.value) {
    message.warning('请先选择运行位置')
    return
  }
  step.value = 2
}

const submit = () => {
  if (!name.value.trim()) {
    message.warning('请填写智能体名称')
    return
  }
  emit('done', name.value.trim())
  message.success(`已创建智能体：${name.value.trim()}`)
}
</script>

<template>
  <section class="wizard">
    <header class="wizard-head">
      <div class="head-left">
        <NButton quaternary circle size="small" aria-label="关闭" @click="emit('cancel')">
          <template #icon>
            <NIcon :size="16">
              <ArrowLeft v-if="step === 2" />
              <X v-else />
            </NIcon>
          </template>
        </NButton>
        <div class="head-text">
          <span class="head-title">创建智能体</span>
          <span class="head-sub">{{ step === 1 ? '选择运行时' : '配置' }}</span>
        </div>
      </div>

      <ol class="steps">
        <li class="step" :class="{ done: step > 1, active: step === 1 }">
          <span class="step-dot">1</span>
          <span class="step-label">选择运行时</span>
        </li>
        <li class="step-line" />
        <li class="step" :class="{ active: step === 2 }">
          <span class="step-dot">2</span>
          <span class="step-label">配置</span>
        </li>
      </ol>
    </header>

    <!-- 第一步：选择运行时 -->
    <div v-if="step === 1" class="wizard-body">
      <div class="body-head">
        <h2 class="body-title">这个智能体在哪里运行？</h2>
        <NInput
          v-model:value="keyword"
          class="search"
          size="small"
          clearable
          placeholder="搜索 harness 或机器"
        >
          <template #prefix>
            <NIcon :size="14">
              <Search />
            </NIcon>
          </template>
        </NInput>
      </div>

      <div class="groups">
        <section class="group">
          <header class="group-head">
            <NIcon :size="14" color="var(--c-text-3)">
              <Monitor />
            </NIcon>
            <span class="group-title">智能体</span>
            <span class="group-count tnum">{{ filteredHarnesses.length }}</span>
          </header>

          <ul class="harness-list">
            <li v-for="harness in filteredHarnesses" :key="harness.id" class="harness-item">
              <NRadio
                :checked="selectedHarness?.id === harness.id"
                class="harness-radio"
                @update:checked="selectHarness(harness)"
              >
                <span class="harness-content">
                  <span class="harness-icon" :style="{ background: harness.iconBg }">
                    <img class="harness-icon-img" :src="harness.icon" alt="" />
                  </span>
                  <span class="harness-name">{{ harness.name }}</span>
                  <span class="harness-version mono">{{ harness.version }}</span>
                </span>
              </NRadio>
            </li>
          </ul>
        </section>
      </div>
    </div>

    <!-- 第二步：配置 -->
    <div v-else class="wizard-body">
      <div class="body-head">
        <h2 class="body-title">配置智能体</h2>
      </div>

      <section class="card">
        <h3 class="card-title">身份</h3>

        <div class="field">
          <label class="field-label" for="agent-name">名称</label>
          <NInput
            id="agent-name"
            v-model:value="name"
            size="small"
            placeholder="给智能体起个名字"
          />
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

        <div class="field">
          <div class="field-label">
            对话开场建议
            <span class="field-hint">可选，新建与这个智能体的对话时显示。</span>
          </div>
          <div class="suggest">
            <span class="suggest-text">正在使用 3 条内置建议</span>
            <NButton size="tiny" secondary @click="message.info('自定义开场建议')">
              <template #icon>
                <NIcon :size="12">
                  <Plus />
                </NIcon>
              </template>
              自定义
            </NButton>
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
            <span>已选 {{ selectedSkills.length }} 个 —— 点击修改</span>
          </button>
        </div>
      </section>
    </div>

    <SkillPickerModal
      :show="showSkillPicker"
      :selected="selectedSkills"
      @update:selected="selectedSkills = $event"
      @close="showSkillPicker = false"
    />

    <footer class="wizard-foot">
      <span class="foot-hint">
        <template v-if="step === 1">
          <template v-if="selectedHarness">已选：{{ selectedHarness.name }}</template>
        </template>
        <template v-else>创建后可在智能体列表中继续调整</template>
      </span>
      <div class="foot-actions">
        <NButton size="small" @click="step === 1 ? emit('cancel') : (step = 1)">
          {{ step === 1 ? '取消' : '返回' }}
        </NButton>
        <NButton v-if="step === 1" size="small" type="primary" @click="goNext">下一步</NButton>
        <NButton v-else size="small" type="primary" @click="submit">创建智能体</NButton>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.wizard {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
  background: var(--c-bg);
}

/* 顶栏 */
.wizard-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 56px;
  padding: 0 24px;
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
}

.head-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.head-text {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.head-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}

.head-sub {
  font-size: 11px;
  color: var(--c-text-3);
}

/* 步骤条 */
.steps {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.step {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--c-text-4);
}

.step.active {
  color: var(--c-text);
  font-weight: 500;
}

.step.done {
  color: var(--c-text-3);
}

.step-dot {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #eceef1;
  font-size: 10px;
  font-weight: 600;
  color: var(--c-text-3);
}

.step.active .step-dot {
  background: var(--c-accent);
  color: #fff;
}

.step.done .step-dot {
  background: #d8f3e6;
  color: var(--c-success);
}

.step-label {
  white-space: nowrap;
}

.step-line {
  width: 32px;
  height: 1px;
  background: var(--c-border);
}

/* 主体 */
.wizard-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px 28px;
}

.body-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  max-width: 720px;
  margin: 0 auto 16px;
}

.body-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.search {
  width: 240px;
}

/* 分组 */
.groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
  margin: 0 auto;
}

.group {
  overflow: hidden;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
}

.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 14px;
  border-bottom: 1px solid var(--c-border);
}

.group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}

.group-count {
  font-size: 11px;
  color: var(--c-text-4);
}

/* harness 列表 */
.harness-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--c-border);
}

.harness-item {
  border-left: 2px solid transparent;
}

.harness-item:has(.n-radio--checked) {
  border-left-color: var(--c-accent);
  background: #f5f6ff;
}

.harness-item:hover {
  background: var(--c-surface-sunken);
}

.harness-radio {
  width: 100%;
  padding: 9px 14px;
}

.harness-radio :deep(.n-radio__label) {
  width: 100%;
}

.harness-content {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
}

.harness-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-sunken);
}

.harness-icon-img {
  width: 14px;
  height: 14px;
  object-fit: contain;
}

.harness-name {
  font-size: 13px;
  color: var(--c-text);
}

.harness-version {
  font-size: 11px;
  color: var(--c-text-4);
}

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

.suggest {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  border: 1px dashed var(--c-border-strong);
  border-radius: var(--radius);
}

.suggest-text {
  font-size: 12px;
  color: var(--c-text-3);
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

/* 底栏 */
.wizard-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 56px;
  padding: 0 24px;
  background: var(--c-surface);
  border-top: 1px solid var(--c-border);
}

.foot-hint {
  font-size: 12px;
  color: var(--c-text-3);
}

.foot-actions {
  display: flex;
  gap: 8px;
}

@media (max-width: 760px) {
  .field {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}
</style>
