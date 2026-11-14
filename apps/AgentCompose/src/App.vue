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
import AgentsView from '@/views/AgentsView.vue'
import ExtensionsView from '@/views/ExtensionsView.vue'
import AgentRunsView from '@/views/AgentRunsView.vue'
import AgentCreateWizard from '@/views/AgentCreateWizard.vue'
import AgentEditView from '@/views/AgentEditView.vue'
import SettingsView from '@/views/SettingsView.vue'
import { useNotifications } from '@/composables/useNotifications'
import { useCliOps } from '@/composables/useCliOps'
import { useExtensionOps } from '@/composables/useExtensionOps'
import { useCreatedAgents } from '@/data/createdAgents'
import { useWindowChrome } from '@/composables/useWindowChrome'
import { useSidebar } from '@/composables/useSidebar'

const { init: initNotifications } = useNotifications()
const { bindRetryActions } = useCliOps()
const { bindRetryActions: bindExtensionRetry } = useExtensionOps()
const { load: loadAgents } = useCreatedAgents()
const { init: initWindowChrome } = useWindowChrome()
const { init: initSidebar } = useSidebar()
const { toggle: toggleSidebar } = useSidebar()

/** 新建智能体：向导已经落盘了，这里只负责跳到智能体页 */
const onAgentCreated = (): void => {
  navigate('agentRuns')
}

/** 正在编辑的智能体 id */
const editingAgentId = ref('')

/** 点数据行 → 进编辑页 */
const onAgentEdit = (id: string): void => {
  editingAgentId.value = id
  navigate('agentEdit')
}

/**
 * 主题覆盖：无彩石墨 —— 主色就是黑，颜色只留给状态；
 * 小圆角、无阴影堆砌。与 style.css 的 CSS 变量保持同一套色值。
 */
const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#2f2f2d',
    primaryColorHover: '#3a3a36',
    primaryColorPressed: '#232320',
    primaryColorSuppl: '#2f2f2d',
    successColor: '#2f7d5d',
    warningColor: '#a16207',
    errorColor: '#b42318',
    infoColor: '#5c5c58',
    borderRadius: '6px',
    borderRadiusSmall: '4px',
    fontSize: '13px',
    fontFamily:
      "Inter, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
    textColorBase: '#1c1c1a',
    textColor1: '#1c1c1a',
    textColor2: '#5c5c58',
    textColor3: '#93938d',
    placeholderColor: '#93938d',
    bodyColor: '#ffffff',
    cardColor: '#ffffff',
    modalColor: '#ffffff',
    popoverColor: '#ffffff',
    tableHeaderColor: '#fbfbfa',
    borderColor: '#eaeae6',
    dividerColor: '#f0f0ee',
    hoverColor: '#f5f5f3',
    scrollbarColor: '#dcdcd6',
  },
  Button: {
    fontWeight: '500',
    borderRadiusMedium: '6px',
    borderRadiusSmall: '5px',
  },
  Input: {
    borderRadius: '6px',
    borderHover: '1px solid #dcdcd6',
    borderFocus: '1px solid #2f2f2d',
    boxShadowFocus: '0 0 0 2px rgba(47, 47, 45, 0.12)',
  },
  Switch: {
    railColorActive: '#2f2f2d',
    knobColorActive: '#ffffff',
  },
  Tag: {
    borderRadius: '4px',
  },
  Card: {
    borderRadius: '6px',
    paddingMedium: '16px',
  },
}

const views: ViewKey[] = [
  'skills',
  'mcp',
  'agents',
  'extensions',
  'agentRuns',
  'agentCreate',
  'agentEdit',
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

/** 返回上一级：回到进入前的页面；没有可返回的历史记录时用 fallback */
const navigateBack = (fallback: ViewKey = 'skills') => {
  if (window.history.length > 1) {
    window.history.back()
    return
  }

  navigate(fallback)
}

const onHashChange = () => {
  activeView.value = readHash()
}

/** Ctrl+B：收起 / 展开侧边栏 */
const onKeydown = (event: KeyboardEvent) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'b') return
  // 输入框里打字时不抢快捷键
  const target = event.target as HTMLElement | null
  if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
  event.preventDefault()
  toggleSidebar()
}

onMounted(async () => {
  window.addEventListener('hashchange', onHashChange)
  // 侧边栏收起状态从 localStorage 读回来
  initSidebar()
  // Ctrl+B：收起 / 展开侧边栏
  window.addEventListener('keydown', onKeydown)
  // Windows 上关掉系统标题栏，改用应用内标题栏 —— 先问后端要不要画窗口按钮
  void initWindowChrome()
  // 升级历史从磁盘读回来（重启后还在），再给失败的那些绑上「重试」。
  await initNotifications()
  bindRetryActions()
  bindExtensionRetry()
  // 已创建的智能体也从磁盘读回来（重启后还在）。
  try {
    await loadAgents()
  } catch (error) {
    // 读不到就当没有：不让一个坏 JSON 把整个应用卡在启动阶段。
    console.error('读取智能体列表失败', error)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onHashChange)
  window.removeEventListener('keydown', onKeydown)
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
          <McpView v-else-if="activeView === 'mcp'" />
          <AgentsView v-else-if="activeView === 'agents'" />
          <ExtensionsView v-else-if="activeView === 'extensions'" />
          <AgentRunsView
            v-else-if="activeView === 'agentRuns'"
            @create="navigate('agentCreate')"
            @edit="onAgentEdit"
          />
          <AgentCreateWizard
            v-else-if="activeView === 'agentCreate'"
            @cancel="navigateBack()"
            @done="onAgentCreated"
          />
          <AgentEditView
            v-else-if="activeView === 'agentEdit'"
            :agent-id="editingAgentId"
            @cancel="navigateBack('agentRuns')"
            @saved="navigate('agentRuns')"
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
