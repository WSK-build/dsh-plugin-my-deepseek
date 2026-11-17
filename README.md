# My DeepSeek

[![npm version](https://img.shields.io/npm/v/dsh-plugin-my-deepseek?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-plugin-my-deepseek)
[![ci](https://github.com/WSK-build/dsh-plugin-my-deepseek/actions/workflows/ci.yml/badge.svg)](https://github.com/WSK-build/dsh-plugin-my-deepseek/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/dsh-plugin-my-deepseek)](https://www.npmjs.com/package/dsh-plugin-my-deepseek)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**在 DeepSeek Harness（DSH）里原生复刻 DeepSeek 聊天 App 的面板。** 面板跑的是官方 `deepseek-ai/chat-demo`
前端本体，不是仿制界面；在此基础上把对话记录改存到本地磁盘，清浏览器缓存不再丢历史。

[English](README.en.md) · 简体中文

## 截图

| 桌面端 | 手机端 |
| --- | --- |
| ![欢迎页](docs/screenshots/desktop-welcome.png) | ![手机欢迎页](docs/screenshots/mobile-welcome.png) |
| ![设置与数据管理](docs/screenshots/desktop-settings.png) | ![手机设置](docs/screenshots/mobile-settings.png) |

## 安装

### 前置条件

| 项 | 要求 |
| --- | --- |
| DSH | `>= 0.2.2-rc.1`（声明在 `engines.dsh`；已在 0.2.2-rc.1 与 0.2.2-rc.3 上验证，更早版本会拒绝安装） |
| DeepSeek API Key | 必需，自己填写，不随插件分发 |
| Node.js | **不需要**，包内已带构建产物 |

### 方式一：插件管理器（推荐）

1. 打开 DSH 的 **插件** 页面；
2. 安装 `dsh-plugin-my-deepseek`；
3. 启用该 bundle，侧边栏出现 **My DeepSeek** 入口。

### 方式二：命令行

```bash
dsh plugin add dsh-plugin-my-deepseek
```

装完后仍需在 **插件** 页面启用 bundle。

### 方式三：从源码

```bash
git clone https://github.com/WSK-build/dsh-plugin-my-deepseek.git
cd dsh-plugin-my-deepseek
pnpm install
pnpm build
```

然后把这个目录作为 bundle 安装。

> **只能装一份。** Host 路由前缀是固定的 `/my-deepseek/api`，装第二份会以「路由重复」失败激活。
> 从本地目录切到 npm 版本时，若安装报 `EPERM`，先在插件页面卸载旧的一份。

## 首次运行

打开侧边栏的 **My DeepSeek**。首次进入面板会要求填 API Key（设置 → 粘贴 → 校验走 `GET /models`，不消耗额度）。
没有 Key 时面板的按钮都会跳到设置页——这是官方 App 本来的行为，不是坏了。

## 功能

- **官方前端本体**：多会话历史、自动标题、消息分支、重新生成、停止、继续、附件（上传 / 粘贴 / 拖拽）、语音输入与朗读。
- **深度思考与联网搜索**，带来源引用，流式输出在同一个界面里。
- **Markdown、代码高亮、KaTeX、Mermaid**。
- **ZIP 历史导入导出**，使用官方 App 导出的归档格式。
- **本地持久化**：每个会话一个 JSON 文件，浏览器只做缓存。

## 数据与隐私

| 数据 | 存放位置 | 关浏览器 | 清站点数据 |
| --- | --- | --- | --- |
| 对话（正文、思考、引用、搜索结果） | 本地磁盘 `sessions/<id>.json` | 保留 | **保留** |
| API Key | 本浏览器 `localStorage`（按源隔离） | 保留 | 丢失，需重填 |
| 面板设置（语言、主题、开关） | 同上 | 保留 | 恢复默认 |
| 附件原件 | 本浏览器 IndexedDB | 保留 | 丢失（消息文字仍在，文件打不开） |

数据目录（可用环境变量 `DSH_CHAT_DATA_DIR` 覆盖）：

| 平台 | 路径 |
| --- | --- |
| Windows | `%LOCALAPPDATA%\my-deepseek-panel\sessions` |
| macOS | `~/Library/Application Support/my-deepseek-panel/sessions` |
| Linux | `$XDG_DATA_HOME/my-deepseek-panel/sessions`（默认 `~/.local/share`） |

每个会话一个文件，写入是原子的（临时文件 + rename），崩溃不会留下半截会话。

`localStorage` 不是缓存：关浏览器、重启都还在；换浏览器、无痕窗口、换端口等于新源，需要重新填 Key。
**API Key 只在本机浏览器里，本插件不会把它写到磁盘**——面板直接调用 `api.deepseek.com`。

没有遥测、没有统计、没有账号体系。除你配置的 DeepSeek API 之外，插件不发起任何网络请求。

## 导入与导出

设置 → 数据管理：

- **导入历史**：接受官方 DeepSeek App 导出的 ZIP，导入会覆盖面板内现有对话；
- **导出**：生成同格式归档，本地有原件的图片会一起带上。

## 已知限制

- **对话不是 DSH 会话**：它们只是本插件自己的文件，不会出现在 DSH 侧边栏、会话搜索或会话日志里。这是刻意的——保留官方前端的完整保真度（思考签名、行内引用锚点、服务端搜索块），也让插件不依赖 DSH 的数据模型。
- **模型固定**为 `deepseek-flash`，即官方 demo 的默认值。
- **附件原件留在浏览器**：清站点数据后，旧消息的文字和文件名还在，但打开文件会失败。
- **一个 DSH profile 只能装一份。**

## 开发

```bash
pnpm install
pnpm build      # 令牌改名 -> rspack 打包 -> 包装成 DSH 客户端模块
pnpm run audit  # 校验模块 id、外部依赖、内联样式、隐私扫描
pnpm pack:check # 查看 npm 会发布哪些文件
```

```text
index.js                 宿主半：本地磁盘会话存储，一个路由前缀
dist/client.js           构建产物（生成，不入库）
icon.svg                 官方鲸鱼图标（生成）
src/entry.tsx            把 demo 的 <App /> 挂进面板，同步主题
src/brand-wordmark.tsx   官方字标（生成）
src/store-api.ts         存储接口客户端
src/root.css             面板根节点定位
vendor/chat-demo-src/    上游 demo 源码（改动清单见 NOTICE）
scripts/                 令牌改名、打包、包装、图标提取、审计
```

`dist/` 由 `prepack` 生成，因此 `npm publish` 永远发的是新构建。

## 发布

发布在 CI 里完成，本地不需要 `npm login`。

1. npmjs.com → Access Tokens → 新建 **Granular** token：`read and write`、*All packages*；
2. 存到仓库 secret `NPM_TOKEN`（Settings → Secrets and variables → Actions）；
3. 升版本并打 tag：

   ```bash
   npm version patch --no-git-tag-version
   git commit -am "release: v0.1.2"
   git tag v0.1.2
   git push origin main --tags
   ```

4. `release` workflow 会校验 tag 与 `package.json` 版本一致，然后构建、审计、`npm publish --provenance`。
   手动触发默认是 dry run。

provenance 只在公开仓库生成，且 `repository.url` 必须指向它。

## 与上游 demo 的差异

上游 demo 是一个独立的静态站点。本插件保留它的界面不动，只改管线：

- 设计令牌改名为私有的 `--dsc-*` 命名空间，页面级规则收进面板根节点——沿用官方配色，但不污染 DSH 自己的主题；
- 侧边栏标题换成官方字标；
- 会话持久化从 IndexedDB 移到宿主半，按会话写在平台数据目录下。

完整改动清单见 [NOTICE](NOTICE)。

## 商标与许可

DeepSeek 名称、鲸鱼图标和 `deepseek` 字标是 DeepSeek 的商标，此处仅用于标识被复刻的产品，不在 MIT 许可范围内。
**本项目为非官方项目，与 DeepSeek 无隶属、背书或支持关系。** 上游 demo 为 MIT 许可（见
[`vendor/LICENSE`](vendor/LICENSE)），本项目自有代码同样是 MIT（见 [`LICENSE`](LICENSE)）。
