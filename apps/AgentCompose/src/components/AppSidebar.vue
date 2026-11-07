<script setup lang="ts">
import { Boxes, Layers, Network, Settings, Workflow } from 'lucide-vue-next'

export type ViewKey = 'skills' | 'workbench' | 'agents' | 'settings'

const props = defineProps<{ active: ViewKey }>()
const emit = defineEmits<{ navigate: [key: ViewKey] }>()

const navItems = [
  { key: 'skills' as const, label: 'skills', icon: Layers },
  { key: 'workbench' as const, label: '智能体工作台', icon: Workflow },
  { key: 'agents' as const, label: '智能体', icon: Network, count: 4 },
]
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-mark"><Boxes :size="22" aria-hidden="true" /></span>
      <span class="brand-name">AgentSpace</span>
    </div>

    <nav class="nav" aria-label="主导航">
      <button
        v-for="item in navItems"
        :key="item.key"
        class="nav-item"
        :class="{ active: props.active === item.key }"
        @click="emit('navigate', item.key)"
      >
        <component :is="item.icon" :size="19" />
        <span class="nav-label">{{ item.label }}</span>
        <span v-if="item.count" class="nav-count">{{ item.count }}</span>
      </button>
    </nav>

    <div class="sidebar-foot">
      <button
        class="nav-item"
        :class="{ active: props.active === 'settings' }"
        @click="emit('navigate', 'settings')"
      >
        <Settings :size="19" aria-hidden="true" />
        <span class="nav-label">系统设置</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 3;
  width: 236px;
  padding: 24px 14px 18px;
  display: flex;
  flex-direction: column;
  color: var(--color-sidebar-text);
  background:
    radial-gradient(circle at 10% 5%, rgba(103, 89, 255, 0.18) 0%, rgba(103, 89, 255, 0) 27%),
    var(--color-sidebar-bg);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
}

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 0 10px 24px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: #fff;
  background: var(--color-brand-gradient);
  box-shadow: 0 6px 20px rgba(91, 76, 240, 0.3);
}

.brand-name {
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.3px;
  color: #fff;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 10px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 42px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--color-sidebar-text);
  font-size: 13px;
  text-align: left;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.nav-item.active {
  background: var(--color-primary-soft);
  box-shadow: inset 2px 0 0 0 var(--color-primary-border);
  color: #fff;
}

.nav-label {
  flex: 1;
  min-width: 0;
}

.nav-count {
  margin-left: auto;
  padding: 2px 6px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  color: #828794;
  font-size: 10px;
}

.sidebar-foot {
  margin-top: auto;
  padding-bottom: 12px;
}

@media (max-width: 860px) {
  .sidebar {
    width: 64px;
    padding: 24px 8px 18px;
  }

  .brand {
    padding: 0 12px 24px;
  }

  .brand-name,
  .nav-label,
  .nav-count {
    display: none;
  }

  .nav-item {
    justify-content: center;
    padding: 0;
  }
}
</style>
