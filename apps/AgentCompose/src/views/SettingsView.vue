<script setup lang="ts">
import { NButton, NIcon, useMessage } from 'naive-ui'
import { Blocks, Download } from 'lucide-vue-next'

const message = useMessage()

const currentVersion = '4.0.22'
const latestVersion = '4.0.25'
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">系统设置</h1>
        <p class="page-sub">应用信息与版本更新</p>
      </div>
    </header>

    <div class="card">
      <div class="row">
        <div class="identity">
          <span class="mark" aria-hidden="true">
            <NIcon :size="16">
              <Blocks />
            </NIcon>
          </span>
          <span class="identity-text">
            <span class="identity-name">AgentSpace</span>
            <span class="identity-version tnum">版本 {{ currentVersion }}</span>
          </span>
        </div>

        <NButton type="primary" size="small" @click="message.info(`开始更新到 ${latestVersion}`)">
          <template #icon>
            <NIcon :size="13">
              <Download />
            </NIcon>
          </template>
          更新到 {{ latestVersion }}
        </NButton>
      </div>

      <div class="row row-note">
        <span class="note-text">检测到新版本</span>
        <span class="note-version tnum">{{ latestVersion }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page {
  padding: 20px 24px 32px;
}

.page-head {
  margin-bottom: 16px;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.page-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-text-3);
}

.card {
  width: 100%;
  overflow: hidden;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
}

.row-note {
  padding: 12px 16px;
  border-top: 1px solid var(--c-border);
  background: var(--c-surface-sunken);
}

.identity {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius);
  color: #fff;
  background: var(--c-accent);
}

.identity-text {
  display: flex;
  flex-direction: column;
}

.identity-name {
  font-size: 14px;
  font-weight: 600;
}

.identity-version {
  font-size: 12px;
  color: var(--c-text-3);
}

.note-text {
  font-size: 12px;
  color: var(--c-text-3);
}

.note-version {
  font-size: 12px;
  font-weight: 600;
}
</style>
