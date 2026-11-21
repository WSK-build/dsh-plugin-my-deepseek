# `website/` — GitHub Pages 体验站

## 目录

```
website/
├─ app/              [生成，git 忽略] 体验版整页产物
└─ BOUNDARY.md
```

## 形态

与官方 demo 同款「用完即走」：

| 数据 | 处理 |
|---|---|
| 会话 | 内存，刷新即清空 |
| API Key | 内存，刷新即清空 |
| 附件 | 内存，刷新丢失 |
| 账号登录 | 不可用（无原生桥，入口自动隐藏） |
| 界面偏好 | 内存，刷新回到默认 |
| 导入历史 | 不提供（导入的数据刷新即丢，且会写入浏览器存储） |
| 导出历史 | 可用（导出的是本页内存中的对话） |

页面顶部有一条可关闭提示：`仅供体验 · 请使用你自己的 API Key · 对话不保存，刷新即清空`。

内存模式由构建期常量 `__CHAT_MEMORY_ONLY__` 打开，关闭三处落盘：
- `vendor/chat-demo-src/services/settings.ts` 的 `localStorage` 读写；
- `web/src/shared/store-api.ts` 的会话存储（强制 `memory` 后端）；
- `vendor/chat-demo-src/services/chat/db.ts` 的附件原件存储。

## 边界

**允许放**：无。业务界面与逻辑都在 `web/`，本目录只承接构建产物。

**禁止放**：任何手写代码、任何凭据、任何构建产物提交。

## 构建与部署

```
pnpm build:web    # = node scripts/build-mobile.mjs --out website/app --memory-only
```

GitHub Actions：`build:web` → `actions/upload-pages-artifact`（`website/app`）→ `actions/deploy-pages`。
仓库 Settings → Pages → Source 选 **GitHub Actions**（一次性配置）。
URL 形如 `https://<owner>.github.io/<repo>/`，产物使用相对路径，适配子路径。
