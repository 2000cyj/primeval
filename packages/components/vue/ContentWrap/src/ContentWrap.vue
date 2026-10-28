<template>
  <el-card :body-style="bodyStyle" class="content-wrap mb-15px" shadow="never">
    <template v-if="title" #header>
      <div class="content-wrap-header">
        <span class="content-wrap-title">{{ title }}</span>
        <el-tooltip v-if="message" effect="dark" placement="right">
          <template #content>
            <div style="max-width: 200px">{{ message }}</div>
          </template>
          <el-icon class="content-wrap-tip"><QuestionFilled /></el-icon>
        </el-tooltip>
        <div class="content-wrap-header-slot">
          <slot name="header"></slot>
        </div>
      </div>
    </template>
    <slot></slot>
  </el-card>
</template>

<script setup lang="ts" name="ContentWrap">
// 迁自 app，显式 import 以脱离 app 的 unplugin-auto-import 独立编译。
// 模板里的 el-card / el-tooltip / el-icon 由消费方（app）全局注册 ElementPlus 解析。
import { QuestionFilled } from '@element-plus/icons-vue'

defineProps({
  title: { type: String, default: '' },
  message: { type: String, default: '' },
  bodyStyle: {
    type: Object,
    default: () => ({ padding: '10px', overflow: 'hidden' }),
  },
})
</script>

<style lang="scss" scoped>
.content-wrap-header {
  display: flex;
  align-items: center;
}
.content-wrap-title {
  font-size: 16px;
  font-weight: 700;
}
.content-wrap-tip {
  margin-left: 5px;
  font-size: 14px;
}
.content-wrap-header-slot {
  display: flex;
  flex-grow: 1;
  padding-left: 20px;
}
</style>
