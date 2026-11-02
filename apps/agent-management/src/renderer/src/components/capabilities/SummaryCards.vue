<script setup lang="ts">
import AppIcon from '../icons/AppIcon.vue'

// 三张统计卡：与实测原型一致（Skills 总数 / MCP 服务 / 本月调用）
defineProps<{
  skillTotal: number
  skillDelta: string
  mcpTotal: number
  mcpRunning: number
  monthlyCalls: string
  monthlyCallsDelta: string
}>()
</script>

<template>
  <section class="summary-row">
    <div class="summary-card static">
      <span class="summary-icon"><AppIcon name="skill" :size="21" /></span>
      <span class="copy">
        <span>Skills 总数</span>
        <strong>{{ skillTotal }}</strong>
      </span>
      <em>{{ skillDelta }}</em>
    </div>
    <div class="summary-card static">
      <span class="summary-icon purple"><AppIcon name="server" :size="21" /></span>
      <span class="copy">
        <span>MCP 服务</span>
        <strong>{{ mcpTotal }}</strong>
      </span>
      <em>{{ mcpRunning }} 个运行中</em>
    </div>
    <div class="summary-card static">
      <span class="summary-icon green"><AppIcon name="workflow" :size="21" /></span>
      <span class="copy">
        <span>本月调用</span>
        <strong>{{ monthlyCalls }}</strong>
      </span>
      <em class="positive">{{ monthlyCallsDelta }}</em>
    </div>
  </section>
</template>
