<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{
  /** 12 天调用量 */
  values: number[]
  /** 强调色（渐变起始色） */
  color?: string
  /** 渐变结束色 */
  colorFade?: string
}>()

const host = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null

const buildOption = (): echarts.EChartsCoreOption => {
  const from = props.color ?? '#7768f4'
  const to = props.colorFade ?? '#c8c2ff'
  const values = props.values.length ? props.values : [0]

  return {
    animation: true,
    animationDuration: 320,
    grid: { left: 0, right: 0, top: 2, bottom: 0 },
    xAxis: {
      type: 'category',
      data: values.map((_, index) => `${index + 1}`),
      show: false,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
    },
    yAxis: {
      type: 'value',
      show: false,
      max: Math.max(...values) * 1.02,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'none' },
      formatter: (params: unknown) => {
        const list = params as { value: number; dataIndex: number }[]
        const first = list[0]
        if (!first) return ''
        const daysAgo = values.length - first.dataIndex
        const label = daysAgo === 1 ? '昨天' : `${daysAgo} 天前`
        return `${label}<br/>${first.value} 次调用`
      },
    },
    series: [
      {
        type: 'bar',
        data: values,
        barMaxWidth: 27,
        barCategoryGap: '18%',
        itemStyle: {
          borderRadius: [2, 2, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: from },
            { offset: 1, color: to },
          ]),
        },
        emphasis: { itemStyle: { opacity: 0.85 } },
      },
    ],
  }
}

/** 环境是否支持 canvas（SSR / jsdom 下没有 2d context，ECharts 无法初始化） */
const canRender = (): boolean => {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return typeof canvas.getContext === 'function' && canvas.getContext('2d') !== null
  } catch {
    return false
  }
}

const render = () => {
  if (!host.value || !canRender()) return
  try {
    if (!chart) {
      chart = echarts.init(host.value, undefined, { renderer: 'canvas' })
    }
    chart.setOption(buildOption())
  } catch {
    // 渲染失败时保留空容器，不影响页面其它部分
    chart = null
  }
}

onMounted(render)

watch(() => props.values, render, { deep: true })

function handleResize() {
  chart?.resize()
}

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div ref="host" class="chart" role="img" aria-label="过去 12 天调用量柱状图" />
</template>

<style scoped>
.chart {
  width: 100%;
  height: 72px;
}
</style>
