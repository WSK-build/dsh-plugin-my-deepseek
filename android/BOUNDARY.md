# `android/` — Android 原生壳

Capacitor 工程包一层 Android 系统 WebView，加载 `web/` 的整页产物。

## 目录

```
android/
├─ capacitor.config.json    Capacitor 配置（webDir、允许导航的域名）
├─ build-apk.cmd            构建入口（Windows 执行策略会拦 .ps1，由它代跑）
├─ build-apk.ps1            网页产物 → android/www → cap sync → gradle
├─ make-icons.mjs           生成启动图标（浅蓝鲸鱼 / 白底）
└─ android/                 Capacitor Android 工程
   ├─ gradlew / gradlew.bat  Gradle wrapper（gradle-wrapper.jar 必须入库）
   ├─ variables.gradle      minSdk 29 / compileSdk 36
   └─ app/src/main/
      ├─ AndroidManifest.xml
      ├─ java/com/wskbuild/mydeepseek/
      │   ├─ MainActivity.java            拦截回环重定向，完成授权回调
      │   ├─ WebViewGate.java             渲染引擎版本门槛
      │   └─ DeepSeekAccountPlugin.java   账号登录、原生代发请求、加密存储
      └─ res/                            图标与主题
```

`gradle/wrapper/gradle-wrapper.jar` 必须提交：`gradlew.bat` 用 `-jar` 启动它，
缺了会报 `Unable to access jarfile`。该 jar 的清单必须含
`Main-Class: org.gradle.wrapper.GradleWrapperMain`（Gradle 8.9 起由 wrapper 自带）。

## 边界

**允许改**：Capacitor 工程配置、原生插件、清单、图标与主题、构建脚本。
**禁止改**：业务界面（在 `web/`）、会话存储逻辑（在 `web/`）。

## 关键约束

| 项 | 值 | 原因 |
|---|---|---|
| minSdk | 29（Android 10） | 更低版本的系统 WebView 无法渲染平台登录页 |
| WebView 门槛 | 110 | 代码使用 Chromium 110 才有的运行时 API |
| 登录方式 | App 内 WebView | 授权页需要较新内核；导航由 `allowNavigation` 放行 |
| 回调 | 拦截 `127.0.0.1:49876/oauth/callback` | 平台不接受自定义 scheme |
| 令牌 | Android Keystore AES-GCM | IV 必须由 Keystore 生成 |

## 构建

```
pnpm build:mobile          # 仓库根，产出 build/mobile/www
.\android\build-apk.cmd    # 复制到 android/www → cap sync → assembleDebug
.\android\build-apk.cmd -Release   # 未签名 release
```

CI 由 `.github/workflows/release.yml` 的 `android` job 完成同一流程。
