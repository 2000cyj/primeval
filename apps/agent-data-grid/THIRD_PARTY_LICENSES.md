# Third-party licenses — `@remote/agent-data-grid`

本应用的渲染层移植自 [OpenIDEA](https://github.com/l0ng-ai/openidea)（Apache-2.0），
并沿用其打包的 IntelliJ 图标与字体。以下列出全部第三方资产与许可。

## OpenIDEA UI kit

`src/renderer/src/ui/**`（组件、图标索引、CSS Modules）与
`src/renderer/src/platform/**`（i18n / context / actions / keymap / platformInfo / ime）
移植自 https://github.com/l0ng-ai/openidea 的 `src/ui` 与 `src/platform`，按原样保留。

```
OpenIDEA
Copyright 2026 OpenIDEA contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```

本地改动仅限于：删除测试文件、把 `@/platform/ipc` 与 `@/platform/virtualDocs`
替换为指向本应用（Electron）的桩实现、`lib` 提升到 ES2023、补充 `vite/client` 类型。

## JetBrains IntelliJ Platform icons

`src/renderer/src/ui/expui/**` 为 IntelliJ Platform "new UI"（expui）图标集的 SVG，
随 OpenIDEA 一并移植（未修改）：

- [intellij-community](https://github.com/JetBrains/intellij-community)（Apache-2.0）
- [intellij-plugins](https://github.com/JetBrains/intellij-plugins)（各插件自带许可）

Copyright 2000-2026 JetBrains s.r.o. and contributors。Apache License 2.0。

本项目与 JetBrains 无隶属关系。IntelliJ、IntelliJ IDEA、DataGrip 是
JetBrains s.r.o. 的商标。

## Fonts

`@fontsource-variable/inter`、`@fontsource-variable/jetbrains-mono`
（Inter 与 JetBrains Mono 字体，SIL Open Font License 1.1），随产物本地打包，
不依赖任何 CDN。
