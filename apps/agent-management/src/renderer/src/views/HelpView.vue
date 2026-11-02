<script setup lang="ts">
import { ref } from 'vue'
import { ElButton, ElCard, ElCollapse, ElCollapseItem, ElInput } from 'element-plus'
import { ChatDotRound, Connection, Document, Search } from '@element-plus/icons-vue'
import { useToast } from '../composables/useToast'

const { push } = useToast()

const keyword = ref('')

const GUIDE_LINKS = [
  {
    icon: Document,
    title: 'Skills 使用指南',
    desc: '创建并配置智能体能力，覆盖名称、描述、分类与权限范围。',
    toast: '已打开 Skills 使用指南',
  },
  {
    icon: Connection,
    title: 'MCP 连接文档',
    desc: '通过 HTTP、SSE 或本地 stdio 方式连接外部服务并完成连通性测试。',
    toast: '已打开 MCP 连接文档',
  },
  {
    icon: ChatDotRound,
    title: '联系技术支持',
    desc: '提交工单后，技术支持团队通常在一个工作日内回复。',
    toast: '已提交联系支持请求',
  },
]

const FAQ_LIST = [
  {
    title: '为什么 Skill 会显示「已停用」？',
    body: '该能力依赖外部服务的账号授权（如数据库、代码仓库），完成一次登录或配置后即可恢复为「运行中」状态。',
  },
  {
    title: '本地 CLI 扫描不到怎么办？',
    body: '扫描范围仅覆盖当前设备的 PATH 与常用安装目录，请确认 CLI 已被全局安装，或将其所在目录加入 PATH 后重新扫描。',
  },
  {
    title: '删除能力会影响正在运行的智能体吗？',
    body: '删除后所有关联智能体将无法继续调用此能力，已产生的历史调用记录仍会保留。此操作无法撤销。',
  },
]
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <div class="eyebrow">HELP CENTER</div>
        <h1 class="title">帮助中心</h1>
        <p>搜索使用指南和常见问题，快速找到 Skills 与 MCP 服务的配置说明。</p>
      </div>
    </header>

    <section class="help-page">
      <ElInput
        v-model="keyword"
        class="help-page-search"
        placeholder="搜索使用指南和常见问题"
        clearable
      >
        <template #prefix>
          <Search />
        </template>
      </ElInput>

      <div class="help-page-grid">
        <ElCard v-for="link in GUIDE_LINKS" :key="link.title" shadow="never" class="help-page-card">
          <span class="help-card-icon">
            <component :is="link.icon" />
          </span>
          <strong>{{ link.title }}</strong>
          <p>{{ link.desc }}</p>
          <ElButton text type="primary" @click="push(link.toast)">查看文档</ElButton>
        </ElCard>
      </div>

      <section class="faq-section">
        <span class="section-label">常见问题</span>
        <ElCollapse>
          <ElCollapseItem
            v-for="item in FAQ_LIST"
            :key="item.title"
            :title="item.title"
            :name="item.title"
          >
            {{ item.body }}
          </ElCollapseItem>
        </ElCollapse>
      </section>
    </section>
  </div>
</template>
