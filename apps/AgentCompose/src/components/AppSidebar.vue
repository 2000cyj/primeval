<script setup lang="ts">
import { computed } from 'vue'
import { NTooltip } from 'naive-ui'
import { Blocks, ChevronLeft, ChevronRight, Cpu, Network, Server, Settings } from 'lucide-vue-next'
import { agentScan } from '@/api/agents'
import { useSidebar } from '@/composables/useSidebar'
import PiGlyph from '@/components/PiGlyph.vue'
import agentspaceLogo from '@/assets/agentspace-logo.png'

export type ViewKey =
  | 'skills'
  | 'mcp'
  | 'agents'
  | 'extensions'
  | 'agentRuns'
  | 'agentCreate'
  | 'agentEdit'
  | 'settings'

defineProps<{ active: ViewKey }>()
const emit = defineEmits<{ navigate: [key: ViewKey] }>()

/** 侧边栏收起 / 展开 */
const { collapsed, toggle } = useSidebar()

const navItems = [
  { key: 'skills' as const, label: 'Skills', icon: Blocks },
  { key: 'mcp' as const, label: 'MCP', icon: Server },
  { key: 'agents' as const, label: 'Agents', icon: Network },
  { key: 'extensions' as const, label: 'Pi 扩展', icon: PiGlyph },
  { key: 'agentRuns' as const, label: '智能体', icon: Cpu },
]

/** Agents 的计数：本机真实装好的 CLI 数量（探测结果在模块级共享） */
const detectedCount = computed(() => agentScan.value.filter((agent) => agent.installed).length)
</script>

<template>
  <aside class="rail" :class="{ collapsed }">
    <!--
      品牌行同时是窗口标题栏的一部分（Windows 上没有系统标题栏）：
      高度跟右侧顶栏一致，分隔线连成一条，拖这里可以拖动窗口。
    -->
    <div class="brand" data-tauri-drag-region="deep">
      <span class="brand-mark" aria-hidden="true">
        <img class="brand-logo" :src="agentspaceLogo" width="28" height="28" alt="" />
      </span>
      <span v-if="!collapsed" class="brand-name">AgentSpace</span>
    </div>

    <!--
      收起 / 展开：圆形按钮，骑在侧边栏右边缝的中间（一半在侧栏内、一半在主区）。
      放在品牌行里会被 logo 挤到边上，放在中间更好按。
    -->
    <NTooltip trigger="hover" placement="right" :disabled="!collapsed">
      <template #trigger>
        <button
          type="button"
          class="rail-toggle"
          :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'"
          :aria-expanded="!collapsed"
          @click="toggle"
        >
          <ChevronRight v-if="collapsed" :size="13" />
          <ChevronLeft v-else :size="13" />
        </button>
      </template>
      {{ collapsed ? '展开侧边栏' : '收起侧边栏' }}
    </NTooltip>

    <nav class="nav" aria-label="主导航">
      <NTooltip
        v-for="item in navItems"
        :key="item.key"
        trigger="hover"
        placement="right"
        :disabled="!collapsed"
      >
        <template #trigger>
          <button
            type="button"
            class="nav-item"
            :class="{ active: active === item.key }"
            :aria-current="active === item.key ? 'page' : undefined"
            @click="emit('navigate', item.key)"
          >
            <component :is="item.icon" :size="15" aria-hidden="true" />
            <span v-if="!collapsed" class="nav-label">{{ item.label }}</span>
            <span
              v-if="!collapsed && item.key === 'agents' && detectedCount"
              class="nav-count tnum"
            >
              {{ detectedCount }}
            </span>
          </button>
        </template>
        {{ item.label }}
      </NTooltip>
    </nav>

    <div class="rail-foot">
      <NTooltip trigger="hover" placement="right" :disabled="!collapsed">
        <template #trigger>
          <button
            type="button"
            class="nav-item"
            :class="{ active: active === 'settings' }"
            :aria-current="active === 'settings' ? 'page' : undefined"
            @click="emit('navigate', 'settings')"
          >
            <Settings :size="15" aria-hidden="true" />
            <span v-if="!collapsed" class="nav-label">系统设置</span>
          </button>
        </template>
        系统设置
      </NTooltip>
    </div>
  </aside>
</template>

<style scoped>
.rail {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  flex: none;
  width: 208px;
  height: 100vh;
  padding: 0 8px 12px;
  background: var(--c-rail);
}

/*
 * 品牌行 = 窗口标题栏的左半边。
 * 高度、上下分隔线跟右侧顶栏（--h-header）对齐，
 * 这样窗口顶部是一条完整的横线，而不是两截。
 */
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--h-header);
  margin: 0 -8px;
  padding: 0 16px;
  border-bottom: 1px solid var(--c-border);
}

.brand-mark {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  overflow: hidden;
  border-radius: 6px;
}

/* 应用图标：跟 exe 图标同一张，铺满 */
.brand-logo {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.brand-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-rail-text-active);
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 12px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--c-rail-text);
  font-size: 13px;
  text-align: left;
}

.nav-item:hover {
  background: var(--c-rail-hover);
  color: var(--c-rail-text-active);
}

.nav-item.active {
  background: var(--c-rail-active);
  color: var(--c-rail-text-active);
  font-weight: 500;
}

.nav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-count {
  font-size: 11px;
  color: #93938d;
}

.nav-item.active .nav-count {
  color: #5c5c58;
}

.rail-foot {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid rgba(28, 28, 26, 0.1);
}

/*
 * 收起 / 展开按钮：圆形，骑在侧边栏右边缝的中间。
 * 一半在侧栏内、一半在主区（在主区那半是悬在内容上方的，所以要 z-index）。
 */
.rail-toggle {
  position: absolute;
  right: -11px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 6;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--c-rail-text);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(28, 28, 26, 0.1);
}

.rail-toggle:hover {
  color: var(--c-text-strong);
  border-color: var(--c-border-strong);
  box-shadow: 0 1px 4px rgba(28, 28, 26, 0.16);
}

/* 收起：只剩图标列 */
.rail.collapsed {
  width: 56px;
}

.rail.collapsed .brand {
  justify-content: center;
  padding: 0;
}

.rail.collapsed .nav-item {
  justify-content: center;
  padding: 0;
}

@media (max-width: 760px) {
  .rail {
    width: 56px;
  }

  .brand-name,
  .nav-label,
  .nav-count {
    display: none;
  }

  .brand {
    justify-content: center;
    padding: 0;
  }

  /* 窄屏没有展开的空间，按钮直接不显示 */
  .rail-toggle {
    display: none;
  }

  .nav-item {
    justify-content: center;
    padding: 0;
  }
}
</style>
