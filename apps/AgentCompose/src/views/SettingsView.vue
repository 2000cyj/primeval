<script setup lang="ts">
import { Boxes, Download } from 'lucide-vue-next'
import { useToast } from '@/composables/useToast'

const { notify } = useToast()

const currentVersion = 'v4.0.22'
const latestVersion = 'v4.0.25'

const startUpdate = () => {
  notify(`开始更新到 ${latestVersion}`)
}
</script>

<template>
  <section class="settings">
    <div class="settings-card">
      <div class="card-main">
        <div class="app">
          <span class="app-mark"><Boxes :size="23" aria-hidden="true" /></span>
          <span class="app-copy">
            <strong class="app-name">AgentSpace</strong>
            <small class="app-version">版本 {{ currentVersion }}</small>
          </span>
        </div>

        <button type="button" class="update-button" @click="startUpdate">
          <Download :size="15" aria-hidden="true" />
          <span>更新到 {{ latestVersion }}</span>
        </button>
      </div>

      <div class="card-foot">
        <span class="foot-text">检测到新版本：</span>
        <strong class="foot-version">4.0.25</strong>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: calc(100vh - 64px);
  padding: 42px 38px 60px;
  background: var(--color-bg);
}

/* 设计稿：内容区 1044px 宽，卡片 760px 水平居中（(1044-760)/2=142） */

.settings-card {
  width: 100%;
  max-width: 760px;
  border: 1px solid var(--color-border);
  border-radius: 11px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(17, 19, 24, 0.04);
  overflow: hidden;
}

.card-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  height: 82px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-divider);
}

.app {
  display: flex;
  align-items: center;
  gap: 13px;
  min-width: 0;
}

.app-mark {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  color: #fff;
  background: var(--color-brand-gradient);
  box-shadow: 0 6px 18px rgba(91, 76, 240, 0.2);
}

.app-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.app-name {
  font-size: 13px;
  font-weight: 600;
  line-height: 19.5px;
  color: var(--color-text-strong);
}

.app-version {
  font-size: 9px;
  line-height: 13.5px;
  color: var(--color-text-weak);
}

.update-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: none;
  height: 34px;
  padding: 0 13px;
  border: 0;
  border-radius: 7px;
  background: var(--color-primary);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 15px;
  white-space: nowrap;
  box-shadow: 0 5px 14px rgba(91, 76, 240, 0.16);
}

.update-button:hover {
  background: var(--color-primary-hover);
}

.card-foot {
  display: flex;
  align-items: center;
  height: 58px;
  padding: 0 20px;
  background: var(--color-surface-muted);
  font-size: 10px;
  line-height: 15px;
  color: #555c6d;
}

.foot-version {
  font-weight: 700;
  color: var(--color-text-strong);
}

@media (max-width: 860px) {
  .settings {
    padding: 24px 16px 40px;
  }
}
</style>
