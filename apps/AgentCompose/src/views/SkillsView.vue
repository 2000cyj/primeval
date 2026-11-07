<script setup lang="ts">
import { computed, ref } from 'vue'
import { Bot, MoreHorizontal, Plus, Search, X } from 'lucide-vue-next'
import { skills } from '@/data/skills'
import { useToast } from '@/composables/useToast'

const query = ref('')
const { notify } = useToast()

/** 页面自有副本：避免直接改动 data/skills.ts 的共享模块状态 */
const skillList = ref(skills.map((skill) => ({ ...skill })))

const visibleSkills = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return skillList.value
  return skillList.value.filter((skill) =>
    `${skill.name}${skill.description}`.toLowerCase().includes(keyword),
  )
})

const toggleSkill = (skill: (typeof skillList.value)[number]) => {
  skill.enabled = !skill.enabled
}
</script>

<template>
  <section class="panel">
    <div class="toolbar">
      <div class="search">
        <Search :size="17" aria-hidden="true" />
        <input v-model="query" aria-label="按名称搜索" placeholder="按名称搜索" />
        <button
          v-if="query"
          type="button"
          class="search-clear"
          aria-label="清空搜索"
          @click="query = ''"
        >
          <X :size="14" aria-hidden="true" />
        </button>
      </div>
      <span class="total">共 {{ visibleSkills.length }} skills</span>
      <span class="spacer" />
      <button type="button" class="primary-button" @click="notify('添加 Skill 面板开发中')">
        <Plus :size="17" aria-hidden="true" />添加skills
      </button>
    </div>

    <div class="table" role="table" aria-label="Skills 列表">
      <div class="table-head table-grid" role="row">
        <span role="columnheader">名称</span>
        <span role="columnheader">使用者</span>
        <span role="columnheader">更新时间</span>
        <span role="columnheader">状态</span>
        <span role="columnheader"><span class="sr-only">操作</span></span>
      </div>

      <div
        v-for="skill in visibleSkills"
        :key="skill.name"
        class="skill-row table-grid"
        :class="{ muted: !skill.enabled }"
        role="row"
      >
        <div class="skill-info" role="cell">
          <span class="skill-icon" :style="{ background: skill.iconBg, color: skill.iconColor }">
            <component :is="skill.icon" :size="20" aria-hidden="true" />
          </span>
          <span class="skill-copy">
            <strong>{{ skill.name }}</strong>
            <small>{{ skill.description }}</small>
          </span>
        </div>

        <div class="users" role="cell">
          <span class="avatars">
            <i
              v-for="(avatar, avatarIndex) in skill.avatars"
              :key="avatar.bg + avatarIndex"
              class="avatar"
              :style="{ background: avatar.bg, color: avatar.fg }"
              aria-hidden="true"
            >
              <Bot :size="13" aria-hidden="true" />
            </i>
            <i v-if="skill.overflow !== null" class="avatar overflow">+{{ skill.overflow }}</i>
          </span>
          <span class="user-count">{{ skill.users }}</span>
        </div>

        <div class="updated" role="cell">{{ skill.updated }}</div>

        <div role="cell">
          <button
            class="switch"
            :class="{ on: skill.enabled }"
            role="switch"
            :aria-checked="skill.enabled"
            :aria-label="'切换 ' + skill.name + ' 状态'"
            type="button"
            @click="toggleSkill(skill)"
          >
            <span />
          </button>
        </div>

        <button
          class="more"
          type="button"
          role="cell"
          :aria-label="skill.name + ' 更多操作'"
          @click="notify(skill.name + ' 设置')"
        >
          <MoreHorizontal :size="18" aria-hidden="true" />
        </button>
      </div>

      <div v-if="!visibleSkills.length" class="empty">没有找到匹配的 Skill</div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  min-height: calc(100vh - 64px);
  background: #fff;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 68px;
  padding: 0 20px;
  border-bottom: 1px solid var(--color-border);
}

.search {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 340px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-text-muted);
}

.search:focus-within {
  border-color: #8c81f6;
  box-shadow: 0 0 0 3px rgba(113, 97, 237, 0.07);
}

.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--color-text);
  font-size: 11px;
}

.search input::placeholder {
  color: var(--color-text-muted);
}

.search-clear {
  display: grid;
  place-items: center;
  padding: 2px;
  border: 0;
  background: none;
  color: var(--color-text-muted);
}

.total {
  font-size: 10px;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.spacer {
  flex: 1;
}

.primary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  padding: 0 16px;
  border: 0;
  border-radius: 8px;
  background: var(--color-primary);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 5px 14px rgba(91, 76, 240, 0.2);
}

.primary-button:hover {
  background: var(--color-primary-hover);
}

/* 设计稿栅格：393.42 / 183.59 / 209.83 / 131.14 / 38，gap 12，左右内边距 20 */
.table-grid {
  display: grid;
  grid-template-columns: 393.42fr 183.59fr 209.83fr 131.14fr 38fr;
  align-items: center;
  column-gap: 12px;
  padding: 0 20px;
}

.table-head {
  height: 41px;
  background: #fbfbfc;
  border-bottom: 1px solid var(--color-divider);
  color: var(--color-text-muted);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.skill-row {
  min-height: 76px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-divider);
  transition: background 0.15s;
}

.skill-row:hover {
  background: var(--color-surface-muted);
}

.skill-row.muted {
  background: var(--color-surface-muted);
}

.skill-info {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.skill-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 9px;
}

.skill-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.skill-copy strong {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--color-text);
}

.skill-copy small {
  font-size: 9px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.users {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.avatars {
  display: flex;
  align-items: center;
  padding-left: 5px;
  flex: none;
}

.avatar {
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  margin-left: -5px;
  border: 2px solid #fff;
  border-radius: 50%;
}

.avatar.overflow {
  background: var(--color-divider);
  color: #555c6d;
  font-size: 8px;
  font-style: normal;
}

.user-count {
  font-size: 9px;
  color: var(--color-text-weak);
  white-space: nowrap;
}

.updated {
  font-family: 'Cousine', 'Courier New', monospace;
  font-size: 8.7px;
  color: #555c6d;
  white-space: nowrap;
}

.switch {
  display: flex;
  align-items: center;
  width: 32px;
  height: 18px;
  padding: 2px;
  border: 0;
  border-radius: 10px;
  background: var(--color-text-disabled);
  transition: background 0.18s;
}

.switch span {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  transition: transform 0.18s;
}

.switch.on {
  background: var(--color-primary);
}

.switch.on span {
  transform: translateX(14px);
}

.more {
  display: grid;
  place-items: center;
  justify-self: end;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
}

.more:hover {
  background: #f1f0ff;
  color: #6555e9;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.empty {
  display: grid;
  place-items: center;
  height: 160px;
  color: #a0a5b0;
  font-size: 12px;
}

@media (max-width: 1080px) {
  .table-grid {
    grid-template-columns: minmax(220px, 2fr) minmax(130px, 1fr) minmax(150px, 1.1fr) 70px 30px;
  }
}

@media (max-width: 860px) {
  .toolbar {
    padding: 0 12px;
  }

  .search {
    width: min(48vw, 300px);
  }
}
</style>
