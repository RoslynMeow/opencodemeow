# OpenCode MeowStudio

一个基于 **Electron + React + TypeScript** 的 OpenCode 桌面客户端，也是可以直接继续二次开发的工程模板。

它没有重新实现模型层，而是把官方 `opencode serve` 作为本地 sidecar 后端，通过官方 `@opencode-ai/sdk` 通信。因此 **models.dev 上的 200+ provider、OpenAI 兼容端点、本地 Ollama、MCP、LSP、插件、会话存储、权限系统** 都直接复用 opencode 的能力。

---

## 功能

### 会话与模型

- 项目级会话列表、创建 / 重命名 / 删除
- SSE 实时流式输出（文本、reasoning、工具调用）
- 工具调用卡片：输入、输出、耗时、错误、附件
- 权限请求弹窗（once / always / reject）
- 中断生成、会话 diff、token / cost 统计
- 模型选择器：provider + model 搜索
- Agent 选择器（build / plan / 自定义 primary agent）
- 自动记住每个项目上次使用的模型与 agent
- 自动恢复上次项目、会话、主题、语言、窗口位置与大小
- **多代理任务树**：总控会话 → 子代理层级、实时状态、agent/模型、耗时、tokens 与费用
- **费用统计**：按会话汇总 assistant cost / tokens，任务树显示整棵任务的总费用
- 深色 / 浅色 / 跟随系统主题，可在侧边栏快速切换
- 界面语言：跟随系统 / English / 简体中文（覆盖主要界面与市场内容）

### 多代理任务树

OpenCode 原生支持 primary agent 通过 `task` 工具派生子代理会话。本应用把这种父子关系可视化：

- 聊天头部打开 **Task tree** 面板
- 树形展示总控会话（Coordinator）与所有子代理，支持多层嵌套
- 每个节点显示：运行状态（运行中 / 重试 / 完成 / 错误）、agent、模型、耗时、tokens、费用
- 顶部汇总整棵任务树的总费用、总 tokens、运行中子代理数量
- 点击节点打开运行详情，可查看 token 明细并直接跳转到该子代理的对话
- 空状态提供 **Copy coordinator prompt** 和 **Create coordinator agent**，一键生成总控 Agent
- 子代理处于不同会话时，聊天头部提供 “Back to parent”
- 用量按 4 秒轮询刷新；历史任务重新打开后仍会显示

费用来自 opencode 的 assistant message 中记录的 `cost` 与 `tokens`，不会额外估算。若需要更深层的子代理嵌套，可在 `opencode.json` 中设置：

```json
{
  "subagent_depth": 2
}
```

默认值为 `1`：primary agent 可以派生 subagent，但 subagent 不能再派生下一层。

### Provider

- 复用 opencode 的完整 provider 目录（实测 232 个）
- API Key 写入 opencode 的 auth store
- Provider OAuth（`auto` / `code` 两种模式）
- **Ollama**：自动探测 `http://127.0.0.1:11434`、列出本地模型、一键写入 `ollama-local` provider
- 任意 OpenAI 兼容端点（LM Studio、llama.cpp、vLLM 等）可通过配置编辑器接入

### MCP

- **MCP 市场**：20 个精选 server，按文件 / 搜索 / 开发 / 数据 / 效率 / 云服务分类
- 一键安装；需要 API Key 或目录的条目会弹出精简配置表单
- 可视化增删改查 MCP server（local stdio / remote HTTP）
- 启用 / 禁用开关、连接状态、失败原因
- MCP OAuth 认证入口
- 支持项目级 / 全局配置，继承来的条目可一键 Override

### LSP

- **LSP 市场**：32 个内置语言服务器，按 Web / 系统级 / 后端 / 移动端 / 数据配置分类
- 一键启用 LSP；自动安装型服务器无需额外操作
- 外部服务器显示安装命令，可一键复制，并可预填自定义配置
- 总开关（默认关闭，与 opencode 一致）
- 内置语言服务器目录与状态展示
- 单个 server 启用 / 禁用
- 自定义 LSP：命令、扩展名、环境变量、initialization options
- 运行中 server 状态（connected / error / root）

### 插件

- npm 插件：写入 `plugin[]`，重启后由 opencode 自动安装
- 本地插件：扫描 `.opencode/plugins` 与全局插件目录
- 即插即用开关（禁用时重命名为 `.disabled`）
- 新建本地插件模板
- 插件变更后自动重启后端

### 项目与配置

- 多项目管理：添加、切换、移除、在文件管理器中显示
- 项目级 / 全局 `opencode.json` / `opencode.jsonc` 可视化编辑
- JSONC 保留注释的结构化修改（MCP / LSP / plugin / provider）
- 配置写入后自动 dispose 实例或重启后端
- 全局 / 隔离双 Profile
- 外观设置：主题预览卡片、语言切换
- Theme、runtime 版本、日志、后端状态

---

## 架构

```text
┌──────────────────────────────────────────────────────────────┐
│ Renderer (React + Tailwind + Zustand)                        │
│  Chat / Projects / Models / MCP / LSP / Plugins / Settings   │
└──────────────────────────┬───────────────────────────────────┘
                           │ contextBridge: window.studio.rpc()
┌──────────────────────────▼───────────────────────────────────┐
│ Preload (contextIsolation) → ipcRenderer.invoke("studio:rpc")│
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│ Main process                                                 │
│  handlers.ts   RPC 路由 + SDK 调用                            │
│  sidecar.ts    spawn opencode serve / Basic Auth / SSE       │
│  runtime.ts    从 npm 自动下载对应平台 opencode 二进制         │
│  config-service.ts  JSONC 读写与结构化 patch                  │
│  store.ts      项目列表、设置、profile                        │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTP + SSE (127.0.0.1, random port)
┌──────────────────────────▼───────────────────────────────────┐
│ opencode serve                                               │
│  providers / sessions / tools / MCP / LSP / plugins          │
└──────────────────────────────────────────────────────────────┘
```

关键设计：

- **一个后端服务，多个项目**：`createOpencodeClient({ directory })` 会把目录写入 `x-opencode-directory` / `?directory=`，因此不需要每个项目启动一个 server。
- **后端密码**：每次启动生成随机密码，通过 `OPENCODE_SERVER_PASSWORD` 传给 sidecar，渲染层永远拿不到密码。
- **事件订阅**：主进程为当前激活项目订阅 `/event` SSE，然后通过 `studio:event` 转发给渲染层；切换项目时自动重新订阅。
- **配置变更**：MCP / LSP / provider 修改后 dispose 当前实例；插件修改后完整重启后端。
- **Profile 隔离**：隔离模式通过 `XDG_CONFIG_HOME` / `XDG_DATA_HOME` / `XDG_CACHE_HOME` 把配置、auth、数据全部限制在应用目录内。

---

## 快速开始

环境要求：

- Node.js >= 22.12（建议 24）
- npm >= 10
- Windows / macOS / Linux

```bash
npm install
npm run dev
```

首次启动会自动从 npm registry 下载当前平台的 opencode 二进制（约 60MB 压缩 / 180MB 解压），并缓存到：

```text
<userData>/runtime/opencode/<version>/bin/opencode(.exe)
```

Windows 下通常是：

```text
%APPDATA%\opencode-meowstudio\runtime\opencode\1.19.3\bin\opencode.exe
```

如果 Electron 自身下载失败（`Electron failed to install correctly`），可以切换镜像：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm install electron@44.9.2 --force
```

或手动下载对应 zip 解压到 `node_modules/electron/dist`，并写入 `node_modules/electron/path.txt`（内容为 `electron.exe`）。

---

## 常用命令

```bash
npm run dev          # 开发模式
npm run typecheck    # main / preload / renderer 类型检查
npm run build        # typecheck + electron-vite build
npm start            # 预览构建产物
npm run package:win  # 打包 Windows NSIS 安装包
npm run package:mac  # 打包 macOS dmg
npm run package:linux
```

已生成过一次免安装目录版本：

```text
release/win-unpacked/OpenCode MeowStudio.exe
```

> 当前未配置代码签名与应用图标，安装包会使用 Electron 默认图标，Windows SmartScreen 可能提示未知发布者。

---

## 分支与发布

- `main`：发布分支，只接受来自 `dev` 的 Pull Request
- `dev`：日常开发分支，所有 `fix` / `feat` 直接提交到这里

流程：

1. 在 `dev` 上完成开发并提交
2. 推送 `dev`，GitHub Actions 会执行 typecheck + build
3. 准备发布时，在 `dev` 上更新 `package.json` 的 `version` 并提交
4. 创建 `dev → main` 的 Pull Request
5. 合并到 `main` 后，Release workflow 会：
   - 在 Windows / macOS / Linux 上分别打包
   - 上传所有安装包
   - 创建或更新 `vX.Y.Z` 的 GitHub Release

工作流文件：

```text
.github/workflows/ci.yml       # dev push / PR 校验
.github/workflows/release.yml  # main push 打包全部平台并发布
```

建议在 GitHub 上为 `main` 开启分支保护：

- Require a pull request before merging
- Require status checks（CI）
- Do not allow bypassing the above settings
- 禁止直接 push 到 `main`

> 发布前记得提升版本号；如果版本号未变化，Release workflow 会用新产物覆盖同一个 `vX.Y.Z` Release 的资源。

---

## 目录结构

```text
src/
  shared/
    types.ts            # RPC 契约、AppState、所有共享类型
  main/
    index.ts            # app 启动、窗口、IPC、smoke/screenshot 调试模式
    handlers.ts         # 所有 RPC 实现
    sidecar.ts          # opencode serve 生命周期 + SSE 订阅
    runtime.ts          # 二进制自动下载、校验、系统兜底
    config-service.ts   # JSONC 读取 / patch / 插件扫描
    store.ts            # 项目列表与设置持久化
    paths.ts            # 全局/项目路径、profile 环境变量
    app-state.ts        # AppState 组装与广播
    backend-manager.ts  # ensure/restart backend
    events.ts           # 事件 sink
    logger.ts           # 文件日志 + 内存 ring buffer
  preload/
    index.ts            # contextBridge
  renderer/
    index.html
    src/
      App.tsx
      components/       # Chat、Sidebar、Message、ModelPicker、权限弹窗、UI
      views/            # Projects / Models / MCP / LSP / Plugins / Settings
      i18n/             # 中英文词典、Locale 解析、useT
      lib/              # rpc、格式化、配置表单、MCP/LSP 市场目录
      store/useStore.ts # Zustand + SSE 事件 reducer
      styles.css        # Tailwind v4 主题与 markdown 样式
```

---

## 二次开发指南

### 加一个 RPC

1. 在 `src/shared/types.ts` 的 `RpcMap` 中加方法签名：

```ts
"my.feature": { args: [id: string]; result: MyResult }
```

2. 在 `src/main/handlers.ts` 的 `handlers` 中实现：

```ts
"my.feature": async (id: string) => {
  return call<MyResult>(clientFor().someSdkMethod({ path: { id } }))
},
```

3. 渲染层直接调用，类型自动推导：

```ts
const result = await rpc("my.feature", "abc")
```

### 加一个页面

在 `src/renderer/src/views/` 新建组件，然后在 `App.tsx` 的 `VIEWS` 和 `Sidebar.tsx` 的 `NAV` 中注册。

### 订阅新事件

事件在 `src/renderer/src/store/useStore.ts` 的 `handleEvent` 中处理。opencode 的 SSE 事件既包含 v1 类型，也会出现 `message.part.delta`、`catalog.updated` 等扩展事件；未知事件会被安全忽略。

### 修改主题

`src/renderer/src/styles.css` 顶部 `@theme` 定义颜色，`[data-theme="light"]` 覆盖变量。Tailwind v4 会生成 `bg-canvas`、`text-muted` 等工具类。

---

## 持久化与记忆

应用会记住这些选择：

| 内容 | 存储位置 |
| --- | --- |
| 项目列表、当前项目、上次项目 | `<userData>/studio-state.json` |
| 每个项目上次使用的模型与 agent | `<userData>/studio-state.json` |
| 主题、语言、Profile、runtime 版本、自动下载 | `<userData>/studio-state.json` |
| 窗口位置、大小、最大化状态 | `<userData>/studio-state.json` |
| 上次打开的页面 | Renderer `localStorage` |
| 每个项目上次打开的会话 | Renderer `localStorage` |
| 会话内容、消息、token 统计 | opencode 自己的数据目录 |
| Provider 登录态 | opencode auth store（Profile 决定全局或隔离） |
| MCP / LSP / 插件配置 | 项目或全局 `opencode.json` / `.opencode/` |

Windows 下通常是：

```text
%APPDATA%\opencode-meowstudio\studio-state.json
```

说明：

- 从旧名称 `opencode-studio` 升级时，首次启动会自动迁移 runtime、profiles 和项目状态到新目录。
- 删除 `studio-state.json` 可以重置项目列表、窗口和外观选择，不影响已下载的 runtime。
- 会话与消息由 opencode 持久化，切换项目再回来仍会恢复。
- 选中模型/agent 后立即写入，不需要点击保存。

---

## Profile
| Profile | 配置目录 | auth / data | 适用场景 |
| --- | --- | --- | --- |
| Global | `~/.config/opencode/opencode.json(c)` | 与 opencode CLI 共享 | 日常使用，复用已有登录 |
| Isolated | `<userData>/profiles/isolated/config/opencode` | `<userData>/profiles/isolated/data/opencode` | 独立沙箱，不污染原环境 |

在 **Settings → Profile** 切换，切换过程会自动重启后端。

---

## 调试模式

构建后的应用支持几个隐藏环境变量，便于自动化验证：

```powershell
# 后端 smoke test（会写 <userData>/smoke-result.json）
$env:STUDIO_SMOKE = "1"
$env:STUDIO_SMOKE_PROJECT = "E:\path\to\project"
$env:STUDIO_RUNTIME_BIN = "E:\path\to\opencode.exe"   # 可选，跳过下载
npm start
```

```powershell
# 自动截图所有页面
$env:STUDIO_SCREENSHOT = "$env:TEMP\studio-shot"
npm start
```

```powershell
# UI 内自动发一条消息并截图
$env:STUDIO_SCREENSHOT = "$env:TEMP\studio-live"
$env:STUDIO_DEMO_LIVE = "1"
npm start
```

完整 smoke 还会验证会话创建、MCP 保存/删除、LSP 开关、Ollama provider 写入、插件创建/禁用、profile 隔离切换。

---

## 已知限制 / Roadmap

当前是可运行 MVP，以下能力尚未实现或只做了基础版本：

- 文件树、内置终端 / PTY、内嵌代码编辑器
- 内联逐行 diff（目前显示 before/after 与增删统计）
- 图片 / 文件附件上传
- 多窗口、多 session 并行展示
- 自动更新（electron-updater）
- 系统通知（session 完成 / 出错）
- 权限按 agent / 工具粒度配置的 UI
- MCP OAuth 的验证码回调 UI（自动回调由 opencode server 处理）
- Provider 余额 / 速率限制展示
- 市场条目是精选的社区项目，命令与远程地址可能随上游变化；安装前请查看配置，必要时手动修改
- Linux musl、Windows ARM64 实机验证（代码已做平台映射）
- 应用图标与签名

---

## 安全说明

- `contextIsolation: true`、`nodeIntegration: false`
- 渲染层只能通过白名单 RPC 访问主进程
- opencode server 仅监听 `127.0.0.1`，每次启动使用随机 Basic Auth 密码
- API Key 由 opencode 存储，不写入本应用的配置文件
- 打开外部链接会校验 `http(s)://`
- 会话、MCP、LSP、插件均以本地用户权限运行；请只安装可信插件与 MCP server

---

## 参考

- opencode 文档：https://opencode.ai/docs
- Server / SDK：https://opencode.ai/docs/server / https://opencode.ai/docs/sdk
- MCP：https://opencode.ai/docs/mcp-servers
- LSP：https://opencode.ai/docs/lsp
- Plugins：https://opencode.ai/docs/plugins
