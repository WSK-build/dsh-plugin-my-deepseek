# `web/` — 共享网页层

一份源码，四个产物共用：DSH 插件、Android 壳、鸿蒙壳、GitHub Pages 体验站。

## 目录

```
web/
├─ src/
│  ├─ entries/              各壳的入口，一个入口一种宿主
│  │   ├─ dsh.tsx          挂进 DSH 面板（React 由宿主提供）
│  │   ├─ mobile.tsx       独立整页（React 自带，Android / 鸿蒙 / 体验站共用）
│  │   └─ mobile.html      整页模板
│  ├─ components/           跨壳复用的界面片段
│  │   ├─ AccountField.tsx     设置里的账号登录行
│  │   └─ ExperienceNotice.tsx 体验模式的数据说明条
│  ├─ shared/               壳无关的实现
│  │   ├─ account.ts           账号状态机与请求头接缝
│  │   ├─ account-bridge.ts    Capacitor / ArkWeb 桥注册
│  │   ├─ account-plugin.ts    Capacitor 插件声明
│  │   ├─ account-routing.ts   请求归属判定（账号令牌 vs 显式凭据）
│  │   ├─ api-auth.ts          API 客户端与账号模块之间的稳定接缝
│  │   ├─ model.ts             模型标识与上下文预算的单一来源
│  │   ├─ store-api.ts         会话存储（宿主路由 / IndexedDB / 内存）
│  │   ├─ save-file.ts         导出落盘（原生写入优先，浏览器下载回退）
│  │   ├─ fork.ts              会话分叉
│  │   ├─ compact-history.ts   压缩层接线与按会话熔断
│  │   ├─ summarize.ts         摘要请求
│  │   ├─ context/             上下文压缩（契约、策略、熔断表、测试）
│  │   └─ brand-wordmark.tsx   官方字标（由 scripts/extract-brand.mjs 生成，勿手改）
│  └─ styles/               壳无关样式
│      ├─ root.css          DSH 面板内定位
│      └─ mobile.css        整页基础布局
└─ BOUNDARY.md
```

## 边界

**允许放**：渲染逻辑、存储抽象、账号流程、上下文压缩、会话分叉——即“跑在浏览器里、与宿主无关”的代码。

**禁止放**：
- 直接 `import` DSH 的 Cordis 服务（`ctx.slots` 等）——那是 `dsh-plugin/index.js` 的职责；
- 直接调用 Capacitor / ArkTS API——必须经过 `shared/` 的桥接抽象，壳侧实现；
- 任何构建产物。

## 依赖方向

```
web/shared  ←  web/entries  ←  各壳
web/*       →  vendor/chat-demo-src   （通过接缝引用；改动逐条登记在 NOTICE）
```

`web/` 不依赖 `dsh-plugin/`、`android/`、`harmony/`、`website/`。

`vendor/` 是上游代码，对它的改动只有两类，都必须登记在 `NOTICE`：
1. 改相对 import 路径，指向 `web/` 的模块；
2. 在既有结构里插入少量调用点，把功能实现在 `web/`。

功能实现不写在 `vendor/` 里。升级上游时按 `NOTICE` 的手工清单重放这些接缝。

## 产物

不产出独立入口文件，由两个构建消费：
- `scripts/build.mjs` → DSH 插件客户端产物；
- `scripts/build-mobile.mjs` → 整页产物，`--memory-only` 供体验站。

中间产物落在 `build/` 与各壳的忽略目录。
