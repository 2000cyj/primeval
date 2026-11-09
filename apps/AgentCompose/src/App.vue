<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  NConfigProvider,
  NGlobalStyle,
  NMessageProvider,
  type GlobalThemeOverrides,
} from 'naive-ui'
import AppSidebar, { type ViewKey } from '@/components/AppSidebar.vue'
import AppTopbar from '@/components/AppTopbar.vue'
import SkillsView from '@/views/SkillsView.vue'
import McpView from '@/views/McpView.vue'
import WorkbenchView from '@/views/WorkbenchView.vue'
import AgentsView from '@/views/AgentsView.vue'
import AgentRunsView from '@/views/AgentRunsView.vue'
import AgentCreateWizard from '@/views/AgentCreateWizard.vue'
import SettingsView from '@/views/SettingsView.vue'

/**
 * 主题覆盖：中性灰 + 单一靛蓝强调色，小圆角，无阴影堆砌。
 * 与 style.css 的 CSS 变量保持同一套色值。
 */
const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#4f46e5',
    primaryColorHover: '#4338ca',
    primaryColorPressed: '#3730a3',
    primaryColorSuppl: '#4f46e5',
    successColor: '#059669',
    warningColor: '#b45309',
    errorColor: '#dc2626',
    infoColor: '#6b7280',
    borderRadius: '6px',
    borderRadiusSmall: '4px',
    fontSize: '13px',
    fontFamily:
      "Inter, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
    textColorBase: '#111827',
    textColor1: '#111827',
    textColor2: '#374151',
    textColor3: '#6b7280',
    placeholderColor: '#9ca3af',
    bodyColor: '#ffffff',
    cardColor: '#ffffff',
    modalColor: '#ffffff',
    popoverColor: '#ffffff',
    tableHeaderColor: '#fafafa',
    borderColor: '#e5e7eb',
    dividerColor: '#efeff1',
    hoverColor: '#f3f4f6',
    scrollbarColor: '#d1d5db',
  },
  DataTable: {
    thColor: '#fafafa',
    thTextColor: '#6b7280',
    tdColorHover: '#f9fafb',
    borderColor: '#efeff1',
    thPadding: '8px 12px',
    tdPadding: '10px 12px',
  },
  Button: {
    fontWeight: '500',
    borderRadiusMedium: '6px',
    borderRadiusSmall: '5px',
  },
  Input: {
    borderRadius: '6px',
    borderHover: '1px solid #d1d5db',
    borderFocus: '1px solid #4f46e5',
    boxShadowFocus: '0 0 0 2px rgba(79, 70, 229, 0.12)',
  },
  Switch: {
    railColorActive: '#4f46e5',
    knobColorActive: '#ffffff',
  },
  Tag: {
    borderRadius: '4px',
  },
  Card: {
    borderRadius: '8px',
    paddingMedium: '16px',
  },
}

const views: ViewKey[] = [
  'skills',
  'workbench',
  'mcp',
  'agents',
  'agentRuns',
  'agentCreate',
  'settings',
]

const readHash = (): ViewKey => {
  const key = window.location.hash.replace('#', '')
  return views.includes(key as ViewKey) ? (key as ViewKey) : 'skills'
}

const activeView = ref<ViewKey>(readHash())

const navigate = (key: ViewKey) => {
  activeView.value = key
  window.location.hash = key
}

const onHashChange = () => {
  activeView.value = readHash()
}

onMounted(() => {
  window.addEventListener('hashchange', onHashChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onHashChange)
})
</script>

<template>
  <NConfigProvider :theme-overrides="themeOverrides">
    <NGlobalStyle />
    <NMessageProvider>
      <div class="shell">
        <AppSidebar :active="activeView" @navigate="navigate" />

        <main class="main">
          <AppTopbar />
          <SkillsView v-if="activeView === 'skills'" />
          <WorkbenchView v-else-if="activeView === 'workbench'" />
          <McpView v-else-if="activeView === 'mcp'" />
          <AgentsView v-else-if="activeView === 'agents'" />
          <AgentRunsView v-else-if="activeView === 'agentRuns'" @create="navigate('agentCreate')" />
          <AgentCreateWizard
            v-else-if="activeView === 'agentCreate'"
            @cancel="navigate('agentRuns')"
            @done="navigate('agentRuns')"
          />
          <SettingsView v-else />
        </main>
      </div>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
}

.main {
  flex: 1;
  min-width: 0;
  background: var(--c-bg);
}
</style>
