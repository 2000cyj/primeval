<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NIcon, NInput, NModal, NSpace, NSwitch, useMessage } from 'naive-ui'
import { Plus, Search, User } from 'lucide-vue-next'
import { skills, type Skill } from '@/data/skills'
import SkillRowMenu, { type SkillMenuAction } from '@/components/SkillRowMenu.vue'
import SkillDetailDrawer from '@/components/SkillDetailDrawer.vue'
import SkillCreateModal, { type CreateMethod } from '@/components/SkillCreateModal.vue'

const message = useMessage()
const query = ref('')

/** 页面自有副本：切换开关不污染 data 模块的共享状态 */
const skillList = ref(skills.map((skill) => ({ ...skill })))

const visibleSkills = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return skillList.value
  return skillList.value.filter((skill) =>
    `${skill.name}${skill.description}`.toLowerCase().includes(keyword),
  )
})

const toggleSkill = (skill: Skill) => {
  skill.enabled = !skill.enabled
}

/** 当前打开详情抽屉的 skill */
const detailSkill = ref<Skill | null>(null)
/** 新建 skill 弹窗 */
const showCreate = ref(false)
/** 待删除的 skill（删除前二次确认） */
const deleteTarget = ref<Skill | null>(null)

const openDetail = (skillName: string) => {
  detailSkill.value = skillList.value.find((skill) => skill.name === skillName) ?? null
}

const onRowAction = (action: SkillMenuAction, skillName: string) => {
  if (action === 'detail') {
    openDetail(skillName)
    return
  }
  if (action === 'delete') {
    deleteTarget.value = skillList.value.find((skill) => skill.name === skillName) ?? null
    return
  }
  if (action === 'duplicate') {
    message.success(`已创建副本：${skillName}`)
    return
  }
  message.info(`编辑：${skillName}`)
}

const confirmDelete = () => {
  const target = deleteTarget.value
  if (!target) return
  skillList.value = skillList.value.filter((skill) => skill.name !== target.name)
  if (detailSkill.value?.name === target.name) detailSkill.value = null
  deleteTarget.value = null
  message.success(`已删除：${target.name}`)
}

const onCreateMethod = (method: CreateMethod) => {
  showCreate.value = false
  const labels: Record<CreateMethod, string> = {
    manual: '手动创建',
    local: '从本地导入',
    url: '从 URL 导入',
    runtime: '从运行时复制',
  }
  message.info(`${labels[method]}：即将支持`)
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">Skills</h1>
        <p class="page-sub">{{ skillList.length }} 个能力包，可被 agents 引用</p>
      </div>
      <NSpace :size="8">
        <NInput
          v-model:value="query"
          class="search"
          size="small"
          clearable
          placeholder="搜索名称或描述"
        >
          <template #prefix>
            <NIcon :size="14">
              <Search />
            </NIcon>
          </template>
        </NInput>
        <NButton size="small" type="primary" @click="showCreate = true">
          <template #icon>
            <NIcon :size="14">
              <Plus />
            </NIcon>
          </template>
          添加 Skill
        </NButton>
      </NSpace>
    </header>

    <div class="card">
      <!-- 表头独立于表格体，固定不滚动 -->
      <div class="table-head table-grid" role="row">
        <span role="columnheader">名称</span>
        <span role="columnheader">使用者</span>
        <span role="columnheader">更新时间</span>
        <span role="columnheader">状态</span>
        <span role="columnheader"><span class="sr-only">操作</span></span>
      </div>

      <!-- 只有表格体滚动 -->
      <div class="table-scroll">
        <div
          v-for="skill in visibleSkills"
          :key="skill.name"
          class="skill-row table-grid"
          :class="{ muted: !skill.enabled }"
          role="row"
        >
          <div class="cell-name" role="cell">
            <span
              class="cell-icon"
              :style="{ background: skill.iconBg, color: skill.iconColor }"
              aria-hidden="true"
            >
              <component :is="skill.icon" :size="15" />
            </span>
            <span class="cell-text">
              <span class="cell-title">{{ skill.name }}</span>
              <span class="cell-desc">{{ skill.description }}</span>
            </span>
          </div>

          <div class="cell-users" role="cell">
            <span class="cell-avatars">
              <span
                v-for="(avatar, avatarIndex) in skill.avatars"
                :key="avatar.bg + avatarIndex"
                class="cell-avatar"
                :style="{ background: avatar.bg, color: avatar.fg }"
                aria-hidden="true"
              >
                <User :size="12" />
              </span>
              <span v-if="skill.overflow !== null" class="cell-avatar cell-avatar-more">
                +{{ skill.overflow }}
              </span>
            </span>
            <span class="cell-muted">{{ skill.users }}</span>
          </div>

          <div class="cell-muted tnum" role="cell">{{ skill.updated }}</div>

          <div role="cell">
            <NSwitch
              :value="skill.enabled"
              size="small"
              :aria-label="`${skill.name} 状态`"
              @update:value="toggleSkill(skill)"
            />
          </div>

          <div class="cell-actions" role="cell">
            <SkillRowMenu
              :skill-name="skill.name"
              @action="(action: SkillMenuAction, name: string) => onRowAction(action, name)"
            />
          </div>
        </div>

        <p v-if="!visibleSkills.length" class="empty">没有匹配的 Skill</p>
      </div>
    </div>

    <SkillCreateModal :show="showCreate" @close="showCreate = false" @pick="onCreateMethod" />

    <SkillDetailDrawer
      :skill="detailSkill"
      @close="detailSkill = null"
      @toggle="
        (name: string, enabled: boolean) => {
          const skill = skillList.find((item) => item.name === name)
          if (skill) skill.enabled = enabled
        }
      "
      @edit="(name: string) => message.info('编辑配置：' + name)"
      @delete="
        (name: string) => {
          deleteTarget = skillList.find((item) => item.name === name) ?? null
        }
      "
    />

    <NModal
      :show="deleteTarget !== null"
      preset="card"
      class="confirm-modal"
      style="width: 360px"
      :bordered="false"
      title="删除 skill"
      @update:show="(show: boolean) => !show && (deleteTarget = null)"
    >
      <p class="confirm-text">
        确定要删除 <strong>{{ deleteTarget?.name }}</strong> 吗？该操作不可撤销。
      </p>
      <div class="confirm-actions">
        <NButton size="small" @click="deleteTarget = null">取消</NButton>
        <NButton size="small" type="error" @click="confirmDelete">删除</NButton>
      </div>
    </NModal>
  </section>
</template>

<style scoped>
.page {
  /* 整页不滚动：页面头部与表头固定，只有表格体滚动 */
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
  padding: 20px 24px 24px;
  overflow: hidden;
}

.page-head {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
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

.search {
  width: 240px;
}

.card {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
}

/* 表头与数据行共用同一套列宽定义，保证纵向对齐 */
.table-grid {
  display: grid;
  grid-template-columns: 38fr 19fr 15fr 9fr 6fr;
  align-items: center;
  column-gap: 12px;
  padding: 0 20px;
}

.table-head {
  flex: none;
  height: 39px;
  background: var(--c-surface-sunken);
  border-bottom: 1px solid var(--c-border);
  color: var(--c-text-3);
  font-size: 13px;
  font-weight: 500;
}

.table-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.skill-row {
  min-height: 51px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--c-border);
  transition: background 0.15s;
}

.skill-row:hover {
  background: var(--c-surface-sunken);
}

.skill-row.muted {
  background: var(--c-surface-sunken);
}

.cell-name {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.cell-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
}

.cell-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.cell-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text);
}

.cell-desc {
  overflow: hidden;
  font-size: 12px;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-users {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.cell-avatars {
  display: flex;
  align-items: center;
  flex: none;
}

.cell-avatar {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-left: -5px;
  border: 1.5px solid #fff;
  border-radius: 50%;
}

.cell-avatar:first-child {
  margin-left: 0;
}

.cell-avatar-more {
  background: #f3f4f6;
  color: var(--c-text-3);
  font-size: 9px;
}

.cell-muted {
  font-size: 12px;
  color: var(--c-text-3);
  white-space: nowrap;
}

.cell-actions {
  display: flex;
  justify-content: flex-end;
}

.empty {
  margin: 0;
  padding: 48px 0;
  text-align: center;
  font-size: 13px;
  color: var(--c-text-3);
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

.confirm-text {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--c-text-2);
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
