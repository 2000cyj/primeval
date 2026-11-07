<script setup lang="ts">
import { computed, ref } from 'vue'
import { Blocks, Check, ChevronRight, Plus, RefreshCw } from 'lucide-vue-next'
import { cliAgents } from '@/data/agents'
import { skills, type Skill } from '@/data/skills'
import { useToast } from '@/composables/useToast'

const { notify } = useToast()

/**
 * 每个智能体已绑定的 skills（顺序与设计稿一致）。
 * 设计稿只定义了 Claude Code 的绑定状态，其余智能体按 skillsCount 给出合理分配。
 */
const boundSkillNamesByAgent: Record<string, string[]> = {
  'claude-code': ['知识库检索', '代码解释器', '图像理解', '文件解析', '多语言翻译', '接口文档生成'],
  'openai-codex': [
    '知识库检索',
    '代码解释器',
    '图像理解',
    '文件解析',
    '多语言翻译',
    '日志异常诊断',
  ],
  'gemini-cli': ['知识库检索', '代码解释器', '图像理解', '文件解析', '多语言翻译'],
  'cursor-agent': ['知识库检索', '代码解释器', '图像理解', '文件解析', '多语言翻译'],
}

const isSkill = (skill: Skill | undefined): skill is Skill => skill !== undefined

const selectedId = ref(cliAgents[0].id)
const selectedAgent = computed(
  () => cliAgents.find((agent) => agent.id === selectedId.value) ?? cliAgents[0],
)

const boundSkills = computed(() => {
  const names = boundSkillNamesByAgent[selectedId.value] ?? []
  return names.map((name) => skills.find((skill) => skill.name === name)).filter(isSkill)
})

type PanelTab = 'skills' | 'mcp'
const activeTab = ref<PanelTab>('skills')

const selectAgent = (id: string) => {
  selectedId.value = id
}
</script>

<template>
  <section class="workbench">
    <div class="card">
      <!-- 左侧：本地 CLI 智能体列表 -->
      <aside class="agents">
        <header class="agents-head">
          <div class="agents-head-copy">
            <strong>智能体</strong>
            <small>{{ cliAgents.length }} 个本地 CLI</small>
          </div>
          <span class="online-dot" role="img" aria-label="本地 CLI 已就绪" />
        </header>

        <div class="agents-list">
          <button
            v-for="agent in cliAgents"
            :key="agent.id"
            type="button"
            class="agent-item"
            :class="{ active: agent.id === selectedId }"
            @click="selectAgent(agent.id)"
          >
            <span class="agent-icon" :style="{ background: agent.iconBg, color: agent.iconColor }">
              <component :is="agent.icon" :size="19" aria-hidden="true" />
            </span>
            <span class="agent-copy">
              <strong>{{ agent.name }}</strong>
              <small>{{ agent.skillsCount }} 个 skills</small>
            </span>
            <ChevronRight class="agent-arrow" :size="15" aria-hidden="true" />
          </button>
        </div>

        <footer class="agents-foot">
          <RefreshCw :size="14" aria-hidden="true" />
          <span>智能体列表与本地扫描同步</span>
        </footer>
      </aside>

      <!-- 右侧：当前智能体的能力配置 -->
      <div class="detail">
        <header class="detail-head">
          <span
            class="detail-icon"
            :style="{
              background: selectedAgent.iconBg,
              color: selectedAgent.iconColor,
            }"
          >
            <component :is="selectedAgent.icon" :size="22" aria-hidden="true" />
          </span>

          <div class="detail-meta">
            <span class="detail-badge">正在配置</span>
            <strong class="detail-name">{{ selectedAgent.name }}</strong>
            <small class="detail-path">{{ selectedAgent.path }}</small>
          </div>

          <div class="segment" role="tablist" aria-label="能力类型">
            <button
              id="tab-skills"
              type="button"
              class="segment-item"
              :class="{ active: activeTab === 'skills' }"
              role="tab"
              aria-controls="panel-skills"
              :aria-selected="activeTab === 'skills'"
              @click="activeTab = 'skills'"
            >
              Skills
            </button>
            <button
              id="tab-mcp"
              type="button"
              class="segment-item"
              :class="{ active: activeTab === 'mcp' }"
              role="tab"
              aria-controls="panel-mcp"
              :aria-selected="activeTab === 'mcp'"
              @click="activeTab = 'mcp'"
            >
              MCP
            </button>
          </div>
        </header>

        <template v-if="activeTab === 'skills'">
          <div id="panel-skills" role="tabpanel" aria-labelledby="tab-skills" class="tab-panel">
            <div class="section-bar">
              <div class="section-copy">
                <strong>已绑定 skills</strong>
                <small>当前智能体可以调用以下能力</small>
              </div>
              <div class="section-actions">
                <span class="total">共 {{ boundSkills.length }} skills</span>
                <button
                  type="button"
                  class="primary-button"
                  @click="notify('绑定 skills 面板开发中')"
                >
                  <Plus :size="15" aria-hidden="true" />绑定skills
                </button>
              </div>
            </div>

            <div class="skill-grid">
              <article v-for="skill in boundSkills" :key="skill.name" class="skill-card">
                <span
                  class="skill-icon"
                  :style="{ background: skill.iconBg, color: skill.iconColor }"
                >
                  <component :is="skill.icon" :size="18" aria-hidden="true" />
                </span>
                <span class="skill-copy">
                  <strong>{{ skill.name }}</strong>
                  <small>{{ skill.description }}</small>
                </span>
              </article>
            </div>
          </div>
        </template>

        <template v-else>
          <div id="panel-mcp" role="tabpanel" aria-labelledby="tab-mcp" class="tab-panel">
            <div class="section-bar">
              <div class="section-copy">
                <strong>已绑定 MCP</strong>
                <small>当前智能体可以连接以下服务</small>
              </div>
              <div class="section-actions">
                <span class="total">共 0 个 MCP</span>
                <button type="button" class="primary-button" @click="notify('绑定 MCP 面板开发中')">
                  <Plus :size="15" aria-hidden="true" />绑定MCP
                </button>
              </div>
            </div>

            <div class="empty">
              <Blocks :size="26" aria-hidden="true" />
              <p>该智能体尚未绑定 MCP 服务</p>
            </div>
          </div>
        </template>

        <footer class="detail-foot">
          <span class="saved"> <Check :size="13" aria-hidden="true" />绑定关系已自动保存 </span>
          <span class="hint">绑定变更会立即应用到智能体</span>
        </footer>
      </div>
    </div>
  </section>
</template>

<style scoped>
.workbench {
  min-height: calc(100vh - 64px);
  padding: 24px 38px;
}

.card {
  display: flex;
  overflow: hidden;
  min-height: calc(100vh - 112px);
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(17, 19, 24, 0.06);
}

/* ---------- 左侧智能体列表 ---------- */

.agents {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 237px;
  background: var(--color-surface-subtle);
  border-right: 1px solid var(--color-border);
}

.agents-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 68px;
  padding: 0 16px;
  border-bottom: 1px solid var(--color-border);
}

.agents-head-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.agents-head-copy strong {
  font-size: 12px;
  font-weight: 700;
  line-height: 18px;
  color: var(--color-text);
}

.agents-head-copy small {
  font-size: 8.5px;
  line-height: 12.75px;
  color: var(--color-text-muted);
}

.online-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #23b883;
}

.agents-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
}

.agent-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 58px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  text-align: left;
}

.agent-item:hover {
  background: #f3f2ff;
}

.agent-item.active {
  background: #fff;
  border-color: #d9d5ff;
  box-shadow: 0 1px 2px rgba(17, 19, 24, 0.06);
}

.agent-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 8px;
}

.agent-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.agent-copy strong {
  overflow: hidden;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 15.75px;
  color: var(--color-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-copy small {
  font-size: 8px;
  line-height: 12px;
  color: var(--color-text-muted);
}

.agent-arrow {
  flex: none;
  color: var(--color-text-disabled);
}

.agent-item.active .agent-arrow {
  color: var(--color-primary);
}

.agents-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding: 0 16px;
  height: 46px;
  border-top: 1px solid var(--color-divider);
  font-size: 8px;
  color: var(--color-text-muted);
}

/* ---------- 右侧能力配置 ---------- */

.detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.tab-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 88px;
  padding: 0 18px;
  border-bottom: 1px solid var(--color-divider);
}

.detail-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 10px;
}

.detail-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.detail-badge {
  font-size: 8px;
  font-weight: 600;
  line-height: 12px;
  letter-spacing: 0.4px;
  color: var(--color-primary);
}

.detail-name {
  font-size: 13px;
  font-weight: 700;
  line-height: 19.5px;
  color: var(--color-text-strong);
}

.detail-path {
  overflow: hidden;
  font-family: 'Cousine', 'Courier New', monospace;
  font-size: 8px;
  line-height: 12px;
  color: var(--color-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.segment {
  display: flex;
  gap: 3px;
  margin-left: auto;
  padding: 3px;
  background: var(--color-divider);
  border-radius: 8px;
}

.segment-item {
  width: 62px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-size: 9px;
  font-weight: 600;
  line-height: 13.5px;
  color: var(--color-text-weak);
}

.segment-item.active {
  background: #fff;
  color: var(--color-text);
  box-shadow: 0 1px 2px rgba(17, 19, 24, 0.08);
}

.section-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
  padding: 0 18px;
  border-bottom: 1px solid var(--color-divider);
}

.section-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.section-copy strong {
  font-size: 11px;
  font-weight: 700;
  line-height: 16.5px;
  color: var(--color-text);
}

.section-copy small {
  font-size: 8px;
  line-height: 12px;
  color: var(--color-text-muted);
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.total {
  font-size: 8px;
  line-height: 12px;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.primary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 32px;
  padding: 0 11px;
  border: 0;
  border-radius: 8px;
  background: var(--color-primary);
  font-size: 9px;
  font-weight: 600;
  line-height: 13.5px;
  color: #fff;
  box-shadow: 0 5px 14px rgba(91, 76, 240, 0.2);
}

.primary-button:hover {
  background: var(--color-primary-hover);
}

.skill-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 9px;
  flex: 1;
  padding: 14px 18px;
}

.skill-card {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 62px;
  padding: 10px 11px;
  border: 1px solid var(--color-divider);
  border-radius: 9px;
  background: #fff;
}

.skill-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 8px;
}

.skill-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.skill-copy strong {
  font-size: 10px;
  font-weight: 700;
  line-height: 15px;
  color: var(--color-text);
}

.skill-copy small {
  overflow: hidden;
  font-size: 8px;
  line-height: 12px;
  color: var(--color-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #a0a5b0;
}

.empty p {
  margin: 0;
  font-size: 11px;
}

.detail-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 18px;
  background: var(--color-surface-muted);
  border-top: 1px solid var(--color-divider);
  font-size: 8px;
  line-height: 12px;
}

.saved {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--color-success);
}

.hint {
  color: var(--color-text-muted);
}

@media (max-width: 1180px) {
  .workbench {
    padding: 16px 20px;
  }

  .skill-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
