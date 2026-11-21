# `harmony/` — 鸿蒙原生壳

ArkTS + ArkWeb 加载与 Android 相同的整页产物（`entry/src/main/resources/rawfile/www`）。

## 目录

```
harmony/
├─ AppScope/                 应用级配置与资源（bundleName、版本、应用图标与名称）
│  ├─ app.json5
│  └─ resources/base/{element,media}
├─ build-profile.json5      构建配置（compatibleSdkVersion 5.0.0(12)）
├─ hvigorfile.ts            构建入口
├─ hvigor/hvigor-config.json5  hvigor 版本与执行参数，缺它 hvigorw 无法启动
├─ make-harmony-assets.mjs  图标生成 + 整页产物同步进 rawfile/www
└─ entry/src/main/
   ├─ module.json5
   ├─ ets/
   │   ├─ pages/Index.ets         ArkWeb 容器
   │   ├─ AccountBridge.ets       账号登录桥（对应 Android 的插件）
   │   └─ entryability/EntryAbility.ets
   └─ resources/base/             模块级资源（element 值必须是数组）
```

`hvigor/hvigor-config.json5` 的 `modelVersion` 与 `oh-package.json5` 保持一致；
它由 DevEco 首次打开工程时生成，这里直接入库，避免克隆后缺少该文件而无法构建。

## 边界

**允许改**：ArkTS 页面与桥、模块配置、图标与资源、资源脚本。
**禁止改**：业务界面（在 `web/`）、会话存储逻辑（在 `web/`）。

## 与 Android 的差异

| 项 | Android | 鸿蒙 |
|---|---|---|
| 登录桥 | Capacitor 插件（Java） | ArkTS 代理（`AccountBridge.ets`） |
| 授权页 | App 内 WebView 导航 | 系统浏览器（`startAbility`） |
| 回调 | WebViewClient 拦截回环导航 | 真实回环 TCP 服务 |
| 令牌存储 | Android Keystore AES-GCM | 系统 preferences |
| 导出落盘 | 原生 `saveFile`（MediaStore） | **未实现**：导出会明确报「暂不支持」 |

两侧桥对 `web/src/shared/account.ts` 暴露同一组方法，网页层不区分宿主。
`saveFile` 在桥上是可选能力，未实现时由 `web/src/shared/save-file.ts` 报错，
不会谎报下载成功。

## 已知缺口

- 导出到本地文件未实现：ArkWeb 不响应 `blob:` 下载链接，需要在 ArkTS 侧补一个
  `saveFile` 代理方法（加入 `Index.ets` 的 `methodList`），用文件选择器或下载管理写入。
- 流式输出未实现：`AccountBridge.ets` 的 `fetch` 只返回完整响应，长回答会一次性出现。
  对齐 Android 的 `fetchStream` 需要额外的事件通道。
- 未在本机构建验证：本机没有 DevEco 与 HarmonyOS SDK，HAP 由华为云 CodeArts 产出。

## 构建

DevEco Studio 需华为账号下载 SDK，托管 CI 无法安装，因此 HAP 由华为云 CodeArts
的 HarmonyOS 构建环境产出，再回传 GitHub Release。

```
node make-harmony-assets.mjs    # 生成图标并把 build/mobile/www 同步进 rawfile
hvigorw assembleHap --mode module -p product=default -p buildMode=release
```
