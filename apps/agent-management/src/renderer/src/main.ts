import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
// Element Plus 全量样式（仓库没有 unplugin 自动引入，全量引入避免按需打包配置）
import 'element-plus/dist/index.css'
import './styles/main.css'
import './styles/element-plus.css'
import App from './App.vue'
import { router } from './router'

createApp(App).use(router).use(ElementPlus, { locale: zhCn }).mount('#app')
