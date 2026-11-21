# `dsh-plugin/` — DeepSeek Harness 插件

npm 包对外暴露的全部内容：插件入口、客户端产物、bundle 补丁。

## 目录

```
dsh-plugin/
├─ index.js          插件宿主半边（Node）：Cordis 服务、会话存储路由、面板注册
├─ cordis.patch.yml  bundle 补丁，向 DSH 组合注入本插件
└─ dist/client.js    [生成，git 忽略] 客户端产物，由 pnpm build 写出
```

## 边界

**允许改**：宿主半边、补丁、以及产物路径约定。
**禁止改**：`dist/` 下任何内容——那是 `scripts/build.mjs` 的输出。

## 与 `web/` 的分工

| 层 | 负责 |
|---|---|
| `dsh-plugin/index.js` | Cordis 服务注册、`/my-deepseek/api/*` 会话路由、槽位注册 |
| `web/src/entries/dsh.tsx` | 面板内的界面挂载，React 由宿主提供 |
| `web/src/shared/store-api.ts` | 浏览器侧存储抽象，命中宿主路由时写磁盘 |

界面代码不写在 `index.js` 里；宿主能力不写在 `web/` 里。

## 产物约定

`package.json` 的 `exports` 只指向本目录：

```
"."          -> ./dsh-plugin/index.js
"./client"   -> ./dsh-plugin/dist/client.js
dsh.bundle.patch -> ./dsh-plugin/cordis.patch.yml
```

`files` 是白名单，只收录插件本体与它运行时需要的静态资源（`dsh-plugin/*`、`locale/*`、
`icon.svg`、`README*`、`NOTICE`、`vendor/LICENSE`、`docs/screenshots/*`），
因此 `android/`、`harmony/`、`website/`、`web/`、`vendor/chat-demo-src` 的源码都不会进入 npm 包。
