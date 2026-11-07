<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NDrawer, NDrawerContent, NIcon, NSwitch } from 'naive-ui'
import { Pencil, Trash2 } from 'lucide-vue-next'
import { detailOf, type Skill } from '@/data/skills'
import SkillCallsChart from '@/components/SkillCallsChart.vue'

const props = defineProps<{ skill: Skill | null }>()
const emit = defineEmits<{
  close: []
  toggle: [skillName: string, enabled: boolean]
  edit: [skillName: string]
  delete: [skillName: string]
}>()

const detail = computed(() => (props.skill ? detailOf(props.skill) : null))

const onToggle = (value: boolean) => {
  if (props.skill) emit('toggle', props.skill.name, value)
}
</script>

<template>
  <NDrawer
    :show="skill !== null"
    :width="430"
    placement="right"
    :trap-focus="false"
    @update:show="(show: boolean) => !show && emit('close')"
  >
    <NDrawerContent closable :native-scrollbar="false" body-content-style="padding: 0">
      <template #header>
        <span class="drawer-title">能力详情</span>
      </template>

      <div v-if="skill && detail" class="body">
        <section class="identity">
          <span
            class="identity-icon"
            :style="{ background: skill.iconBg, color: skill.iconColor }"
            aria-hidden="true"
          >
            <component :is="skill.icon" :size="18" />
          </span>
          <div class="identity-text">
            <span class="identity-name">{{ skill.name }}</span>
            <span class="identity-category">{{ skill.category }}</span>
          </div>
          <NSwitch
            :value="skill.enabled"
            size="small"
            :aria-label="`${skill.name} 状态`"
            @update:value="onToggle"
          />
        </section>

        <section class="section">
          <h3 class="section-label">能力描述</h3>
          <p class="section-text">{{ skill.description }}</p>
        </section>

        <section class="section">
          <dl class="meta">
            <div class="meta-row">
              <dt>当前状态</dt>
              <dd :class="{ running: detail.status === '运行中' }">{{ detail.status }}</dd>
            </div>
            <div class="meta-row">
              <dt>能力类型</dt>
              <dd>{{ detail.type }}</dd>
            </div>
            <div class="meta-row">
              <dt>最近更新</dt>
              <dd>{{ detail.lastUpdated }}</dd>
            </div>
            <div class="meta-row">
              <dt>权限范围</dt>
              <dd>{{ detail.scope }}</dd>
            </div>
          </dl>
        </section>

        <section class="section">
          <h3 class="section-label">最近调用</h3>
          <SkillCallsChart :values="detail.calls" />
          <div class="chart-foot">
            <span>过去 12 天</span>
            <span class="tnum">{{ detail.callsTotal.toLocaleString('en-US') }} 次调用</span>
          </div>
        </section>
      </div>

      <template #footer>
        <div v-if="skill" class="actions">
          <NButton class="danger-button" secondary size="small" @click="emit('delete', skill.name)">
            <template #icon>
              <NIcon :size="14">
                <Trash2 />
              </NIcon>
            </template>
            删除
          </NButton>
          <NButton type="primary" size="small" @click="emit('edit', skill.name)">
            <template #icon>
              <NIcon :size="14">
                <Pencil />
              </NIcon>
            </template>
            编辑配置
          </NButton>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
.drawer-title {
  font-size: 12px;
  color: var(--c-text-3);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px 20px;
}

.identity {
  display: flex;
  align-items: center;
  gap: 12px;
}

.identity-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: var(--radius);
}

.identity-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.identity-name {
  font-size: 16px;
  font-weight: 600;
}

.identity-category {
  font-size: 12px;
  color: var(--c-text-3);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid var(--c-border);
}

.section-label {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--c-text-3);
}

.section-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--c-text-2);
}

.meta {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
}

.meta-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}

.meta-row dt {
  font-size: 12px;
  color: var(--c-text-3);
}

.meta-row dd {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--c-text-2);
}

.meta-row dd.running {
  color: var(--c-success);
}

.chart-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--c-text-3);
}

.chart-foot .tnum {
  font-weight: 600;
  color: var(--c-text-2);
}

.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.danger-button {
  color: var(--c-danger);
}

.danger-button:hover {
  color: var(--c-danger);
  border-color: var(--c-danger);
}
</style>
