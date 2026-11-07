<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Check } from 'lucide-vue-next'
import AppSidebar, { type ViewKey } from '@/components/AppSidebar.vue'
import AppTopbar from '@/components/AppTopbar.vue'
import SkillsView from '@/views/SkillsView.vue'
import WorkbenchView from '@/views/WorkbenchView.vue'
import AgentsView from '@/views/AgentsView.vue'
import SettingsView from '@/views/SettingsView.vue'
import { useToast } from '@/composables/useToast'

const views: ViewKey[] = ['skills', 'workbench', 'agents', 'settings']

const readHash = (): ViewKey => {
  const key = window.location.hash.replace('#', '')
  return views.includes(key as ViewKey) ? (key as ViewKey) : 'skills'
}

const activeView = ref<ViewKey>(readHash())
const { toast, notify } = useToast()

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
  <div class="shell">
    <AppSidebar :active="activeView" @navigate="navigate" />

    <main class="main">
      <AppTopbar @notify="notify" />

      <SkillsView v-if="activeView === 'skills'" />
      <WorkbenchView v-else-if="activeView === 'workbench'" />
      <AgentsView v-else-if="activeView === 'agents'" />
      <SettingsView v-else />
    </main>

    <Transition>
      <div v-if="toast" class="toast"><Check :size="16" />{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
}

.main {
  margin-left: 236px;
  min-height: 100vh;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 25px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 15px;
  border-radius: 9px;
  background: #282c38;
  color: #fff;
  font-size: 11px;
  box-shadow: 0 8px 25px rgba(30, 34, 50, 0.22);
  transform: translateX(-50%);
}

.toast svg {
  color: #7cdda8;
}

.v-enter-active,
.v-leave-active {
  transition:
    opacity 0.18s,
    transform 0.18s;
}

.v-enter-from,
.v-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

@media (max-width: 860px) {
  .main {
    margin-left: 64px;
  }
}
</style>
