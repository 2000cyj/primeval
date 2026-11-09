<script setup lang="ts">
import { Blocks, Cpu, Network, Server, Settings, Workflow } from 'lucide-vue-next'
import { cliAgents } from '@/data/agents'

export type ViewKey =
  'skills' | 'workbench' | 'mcp' | 'agents' | 'agentRuns' | 'agentCreate' | 'settings'

defineProps<{ active: ViewKey }>()
const emit = defineEmits<{ navigate: [key: ViewKey] }>()

const navItems = [
  { key: 'skills' as const, label: 'Skills', icon: Blocks },
  { key: 'workbench' as const, label: '智能体工作台', icon: Workflow },
  { key: 'mcp' as const, label: 'MCP', icon: Server },
  { key: 'agents' as const, label: 'agents', icon: Network, count: cliAgents.length },
  { key: 'agentRuns' as const, label: '智能体', icon: Cpu },
]
</script>

<template>
  <aside class="rail">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">
        <Blocks :size="14" />
      </span>
      <span class="brand-name">AgentSpace</span>
    </div>

    <nav class="nav" aria-label="主导航">
      <button
        v-for="item in navItems"
        :key="item.key"
        type="button"
        class="nav-item"
        :class="{ active: active === item.key }"
        :aria-current="active === item.key ? 'page' : undefined"
        @click="emit('navigate', item.key)"
      >
        <component :is="item.icon" :size="15" aria-hidden="true" />
        <span class="nav-label">{{ item.label }}</span>
        <span v-if="item.count" class="nav-count tnum">{{ item.count }}</span>
      </button>
    </nav>

    <div class="rail-foot">
      <button
        type="button"
        class="nav-item"
        :class="{ active: active === 'settings' }"
        :aria-current="active === 'settings' ? 'page' : undefined"
        @click="emit('navigate', 'settings')"
      >
        <Settings :size="15" aria-hidden="true" />
        <span class="nav-label">系统设置</span>
      </button>
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
  padding: 12px 8px;
  background: var(--c-rail);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 16px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  color: #fff;
  background: var(--c-accent);
}

.brand-name {
  font-size: 13px;
  font-weight: 600;
  color: #f3f4f6;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
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
  color: #d1d5db;
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
  color: #6b7280;
}

.nav-item.active .nav-count {
  color: #9ca3af;
}

.rail-foot {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

@media (max-width: 760px) {
  .rail {
    width: 52px;
  }

  .brand-name,
  .nav-label,
  .nav-count {
    display: none;
  }

  .brand {
    justify-content: center;
    padding: 4px 0 16px;
  }

  .nav-item {
    justify-content: center;
    padding: 0;
  }
}
</style>
