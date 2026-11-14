<script setup lang="ts">
/**
 * 帮助中心弹窗。
 *
 * 两大块：命令行操作与界面说明。内容来自 `@/data/help` —— 数据驱动，
 * 搜索与筛选都靠它。
 */
import { computed, ref, watch } from 'vue'
import { NIcon, NInput, NModal, NTabPane, NTabs } from 'naive-ui'
import { Search, Terminal, LayoutPanelTop } from 'lucide-vue-next'
import { commandConventions, commandGroups, helpTopics, pageConventions, pages } from '@/data/help'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [value: boolean] }>()

/** 搜索词 */
const keyword = ref('')
/** 当前页签 */
const tab = ref('command')

// 打开时清掉上次的搜索 —— 免得带着旧词进来看到空结果
watch(
  () => props.show,
  (open) => {
    if (open) keyword.value = ''
  },
)

const needle = computed(() => keyword.value.trim().toLowerCase())

/** 命令分组（按搜索词过滤） */
const filteredGroups = computed(() => {
  if (!needle.value) return commandGroups
  return commandGroups
    .map((group) => {
      // 分组名或分组说明命中 → 该组命令全部保留；
      // 否则逐条看命令本身和说明。
      const groupHit =
        group.title.toLowerCase().includes(needle.value) ||
        (group.hint?.toLowerCase().includes(needle.value) ?? false)
      const commands = groupHit
        ? group.commands
        : group.commands.filter(
            (item) =>
              item.cmd.toLowerCase().includes(needle.value) ||
              item.desc.toLowerCase().includes(needle.value) ||
              (item.example?.toLowerCase().includes(needle.value) ?? false),
          )
      return { ...group, commands }
    })
    .filter((group) => group.commands.length > 0)
})

/** 界面说明（按搜索词过滤） */
const filteredPages = computed(() => {
  if (!needle.value) return pages
  return pages.filter(
    (page) =>
      page.title.toLowerCase().includes(needle.value) ||
      page.desc.toLowerCase().includes(needle.value) ||
      page.points.some((point) => point.toLowerCase().includes(needle.value)),
  )
})

/** 命中的条数 */
const hitCount = computed(() => {
  if (tab.value === 'command') {
    return filteredGroups.value.reduce((sum, group) => sum + group.commands.length, 0)
  }
  return filteredPages.value.length
})
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    class="help-modal"
    :style="{ width: 'min(880px, calc(100vw - 48px))' }"
    :bordered="false"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <template #header>
      <div class="modal-head">
        <span class="modal-title">帮助</span>
        <NInput
          v-model:value="keyword"
          class="search"
          size="small"
          clearable
          placeholder="搜命令或功能"
        >
          <template #prefix>
            <NIcon :size="13">
              <Search />
            </NIcon>
          </template>
        </NInput>
      </div>
    </template>

    <NTabs v-model:value="tab" type="line" size="small" class="tabs">
      <NTabPane name="command">
        <template #tab>
          <span class="tab-label">
            <NIcon :size="13">
              <Terminal />
            </NIcon>
            命令行
          </span>
        </template>

        <div class="body">
          <div v-if="filteredGroups.length" class="groups">
            <section v-for="group in filteredGroups" :key="group.title" class="group">
              <header class="group-head">
                <span class="group-title">{{ group.title }}</span>
                <span v-if="group.hint" class="group-hint">{{ group.hint }}</span>
              </header>
              <dl class="cmds">
                <div v-for="item in group.commands" :key="item.cmd" class="cmd">
                  <dt>
                    <code class="cmd-code">{{ item.cmd }}</code>
                  </dt>
                  <dd>
                    <span class="cmd-desc">{{ item.desc }}</span>
                    <code v-if="item.example" class="cmd-example">{{ item.example }}</code>
                  </dd>
                </div>
              </dl>
            </section>

            <section class="group">
              <header class="group-head">
                <span class="group-title">约定</span>
              </header>
              <ul class="points">
                <li v-for="item in commandConventions" :key="item">{{ item }}</li>
              </ul>
            </section>
          </div>
          <p v-else class="empty">没有匹配的命令</p>
        </div>
      </NTabPane>

      <NTabPane name="page">
        <template #tab>
          <span class="tab-label">
            <NIcon :size="13">
              <LayoutPanelTop />
            </NIcon>
            界面
          </span>
        </template>

        <div class="body">
          <div v-if="filteredPages.length" class="groups">
            <section v-for="page in filteredPages" :key="page.title" class="group">
              <header class="group-head">
                <span class="group-title">{{ page.title }}</span>
                <span class="group-hint">{{ page.desc }}</span>
              </header>
              <ul class="points">
                <li v-for="point in page.points" :key="point">{{ point }}</li>
              </ul>
            </section>

            <section class="group">
              <header class="group-head">
                <span class="group-title">通用约定</span>
              </header>
              <ul class="points">
                <li v-for="item in pageConventions" :key="item">{{ item }}</li>
              </ul>
            </section>
          </div>
          <p v-else class="empty">没有匹配的功能</p>
        </div>
      </NTabPane>
    </NTabs>

    <template #footer>
      <div class="footer">
        <span v-if="needle" class="hit">找到 {{ hitCount }} 条</span>
        <span v-else class="hit">{{ helpTopics.map((item) => item.label).join(' · ') }}</span>
        <button type="button" class="close" @click="emit('update:show', false)">关闭</button>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.modal-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.modal-title {
  flex: none;
  font-size: 15px;
  font-weight: 600;
}

.search {
  flex: 1;
  max-width: 320px;
}

.tabs {
  --n-tab-font-size: 13px;
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.body {
  /* 自己滚动 —— 内容多时不把弹窗撑爆。
     用原生 overflow 而不是 NScrollbar：后者要固定 height 才会滚，
     给 max-height 的话内容直接溢出。 */
  max-height: min(56vh, 480px);
  overflow-y: auto;
  overflow-x: hidden;
}

.groups {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 4px 2px 8px;
}

.group-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 7px;
}

.group-title {
  flex: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}

.group-hint {
  font-size: 11px;
  color: var(--c-text-4);
}

.cmds {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
}

.cmd {
  display: grid;
  grid-template-columns: minmax(180px, 260px) 1fr;
  gap: 12px;
  align-items: baseline;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
}

.cmd:hover {
  background: var(--c-surface-sunken);
}

.cmd-code {
  font-family: 'SFMono-Regular', 'Cascadia Mono', Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  color: var(--c-accent);
  word-break: break-word;
}

.cmd-desc {
  display: block;
  font-size: 12px;
  color: var(--c-text-2);
}

.cmd-example {
  display: block;
  margin-top: 2px;
  font-family: 'SFMono-Regular', 'Cascadia Mono', Consolas, 'Liberation Mono', monospace;
  font-size: 11px;
  color: var(--c-text-4);
  word-break: break-word;
}

.points {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
}

.points li {
  font-size: 12px;
  color: var(--c-text-2);
  line-height: 1.6;
}

.empty {
  margin: 0;
  padding: 40px 0;
  font-size: 12px;
  color: var(--c-text-4);
  text-align: center;
}

.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hit {
  font-size: 11px;
  color: var(--c-text-4);
}

.close {
  padding: 5px 14px;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  color: var(--c-text-2);
  font-size: 13px;
  cursor: pointer;
}

.close:hover {
  background: var(--c-surface-sunken);
  color: var(--c-text);
}
</style>
