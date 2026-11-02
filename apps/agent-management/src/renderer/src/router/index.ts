import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

// 能力中心是首页（Skills / MCP 服务在同一页面内用页签切换）；
// 本地 CLI（侧栏「智能体」入口）、帮助中心、MCP 服务独立页、系统设置只保留路由，入口从主导航移除
// meta.crumb 用于顶栏面包屑，meta.crumbTail 用于面包屑第二段
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'workbench',
    component: () => import('../views/WorkbenchView.vue'),
    meta: { crumb: '能力中心' },
  },
  {
    path: '/cli',
    name: 'cli',
    component: () => import('../views/CliView.vue'),
    meta: { crumb: '智能体', crumbTail: '本地 CLI' },
  },
  {
    path: '/mcp',
    name: 'mcp',
    component: () => import('../views/McpView.vue'),
    meta: { crumb: 'MCP 服务' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SettingsView.vue'),
    meta: { crumb: '系统设置' },
  },
  {
    path: '/help',
    name: 'help',
    component: () => import('../views/HelpView.vue'),
    meta: { crumb: '帮助中心' },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
