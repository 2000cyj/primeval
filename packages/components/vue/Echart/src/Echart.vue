<template>
  <div ref="chartRef" :style="{ width, height }"></div>
</template>

<script setup lang="ts" name="Echart">
// 迁自 app，显式 import ref/watch/onMounted/onUnmounted + PropType 以脱离 unplugin-auto-import 独立编译。
import { ref, watch, onMounted, onUnmounted } from 'vue'
import type { PropType } from 'vue'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'

const props = defineProps({
  options: { type: Object as PropType<EChartsOption>, default: () => ({}) },
  width: { type: String, default: '100%' },
  height: { type: String, default: '300px' },
})

const chartRef = ref<HTMLElement | null>(null)
let chartInstance: echarts.ECharts | null = null

function initChart() {
  if (!chartRef.value) return
  chartInstance = echarts.init(chartRef.value)
  if (props.options) chartInstance.setOption(props.options as EChartsOption)
}

function resizeChart() {
  chartInstance?.resize()
}

onMounted(() => {
  initChart()
  window.addEventListener('resize', resizeChart)
})

onUnmounted(() => {
  window.removeEventListener('resize', resizeChart)
  chartInstance?.dispose()
  chartInstance = null
})

watch(
  () => props.options,
  (val: EChartsOption) => {
    chartInstance?.setOption(val as EChartsOption, true)
  },
  { deep: true },
)

defineExpose({
  getInstance: () => chartInstance,
  resize: resizeChart,
})
</script>
