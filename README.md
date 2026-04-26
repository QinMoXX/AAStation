<p align="center">
  <img src="src-tauri/icons/logo.png" alt="AAStation Logo" width="128" height="128" />
</p>

<h1 align="center">AAStation</h1>

<p align="center">
  <strong>可视化的 AI API 代理管理器</strong>
</p>

<p align="center">
  <a href="https://github.com/QinMoXX/AAStation/releases">
    <img src="https://img.shields.io/badge/version-0.7.0-blue" alt="Version" />
  </a>
  <img src="https://img.shields.io/badge/platform-Windows-green" alt="Platform" />
  <img src="https://img.shields.io/badge/Tauri-2.0-orange" alt="Tauri" />
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License" />
</p>

---

**简体中文** | [English](#english)

## AAStation 是什么？

AAStation 是一个桌面应用，让你可以**通过可视化方式构建 AI API 路由管道**。无需手动编写复杂的代理配置，只需在画布上拖拽节点，就能定义 API 请求如何从应用程序经过智能路由规则到达 AI 服务提供商。

无论你是需要根据模型名称、路径前缀还是 HTTP 请求头来路由请求，还是按供应商健康状态与 token 预算做动态分流，AAStation 都提供了直观的节点式界面来配置一切——然后在本地运行代理服务器，实时执行你的路由逻辑。

<p align="center">
  <img src="public/Snipaste_2026-04-26_21-36-04.png" alt="AAStation 主界面" />
</p>

## AAStation 能做什么？

- **可视化路由配置** — 在画布上拖拽节点，定义 API 请求的完整路由链路
- **动态分流** — 基于供应商健康状态与 token 预算，实时调整请求流量
- **多节点支持** — 支持多个 Application、Switcher、Poller、Provider 节点
- **一键客户端配置** — 将代理配置写入 Claude Code、OpenCode、Codex CLI
- **本地代理服务器** — 在本机运行 HTTP 代理，按画布路由规则转发请求

当需要频繁配置 Agent 工具时，AAStation 只需一次配置，运行时即可自由切换。
当有多个供应商时，AAStation 可以帮你灵活调度，充分利用每个供应商的资源。

## 主要特性

### 可视化管道构建器

- **节点画布** — 拖拽、连接、配置，一切可视化
- **自动保存**，同时支持 `Ctrl+S` 手动保存
- **连接校验** — 即时反馈，防止无效路由
- **小地图** — 大型管道也能轻松导航
- **节点标签筛选** — 按 `ANY / Claude Code / OpenCode / Codex CLI` 快速筛选可用节点

### 四种节点类型

| 节点 | 说明 |
|------|------|
| **Application** | 代表发送请求到代理的客户端应用或工具，支持多节点并分配独立端口 |
| **Switcher** | 根据路径前缀、HTTP 请求头或模型名称路由请求，支持默认回退 |
| **Poller** | 在多个上游之间动态选择目标，支持加权轮询、网络状态优先、剩余额度优先策略 |
| **Provider** | AI 服务端点，提供按模型和统一的输入端口 |

### 内置服务商预设

预配置主流 AI 服务，添加 API Key 即可使用：

| 服务商 | 预配置模型 |
|--------|----------|
| **DeepSeek** | DeepSeek Chat, DeepSeek Reasoner |
| **智谱 AI (Zhipu AI)** | GLM-5.1, GLM-5 Turbo, GLM-5, GLM-4.7, GLM-4.7 Flash, GLM-4.6, GLM-4.5 Air |
| **阿里云百炼 (Bailian)** | Qwen 3.6 Plus, Qwen 3 Max, Qwen Plus, Qwen Flash, Qwen Turbo, Qwen Long, QwQ Plus, Qwen 3 Coder Plus, Qwen VL Plus, Qwen Omni Turbo, Text Embedding V4 |
| **MiniMax** | MiniMax M2.7, M2.7 Highspeed, M2.5, M2.5 Highspeed, M2.1, M2.1 Highspeed, M2 |
| **Kimi (Moonshot)** | Kimi K2.6, K2.5, K2 0905 Preview, K2 Thinking, K2 Thinking Turbo, K2 Turbo Preview, Moonshot V1 8K/32K/128K, Moonshot V1 Vision 8K/32K/128K |
| **火山方舟 (Ark)** | Doubao Seed 2.0 Pro/Lite/Mini/Code Preview, Doubao Seed Character, GLM-4.7, DeepSeek Chat, DeepSeek V3.1 |
| **OpenRouter** | GPT-5.2, Claude Sonnet 4, Claude 3.5 Sonnet, GPT-4o, Gemini Pro 1.5, Llama 3.1 405B |
| **腾讯云 (Tencent)** | Hy3 preview, HY 2.0 Think, HY 2.0 Instruct, Hunyuan-role, DeepSeek-V4-Flash, DeepSeek-V4-Pro, Deepseek-v3.2, Deepseek-v3.1, Deepseek-r1-0528, Deepseek-v3-0324, GLM-5.1, GLM-5V-Turbo, GLM-5-Turbo, GLM-5, Kimi-K2.6, Kimi-K2.5, MiniMax-M2.7, MiniMax-M2.5 |

### 深度集成常用 AI 客户端

- **Claude Code** — 一键写入 `~/.claude/settings.json`
- **OpenCode** — 一键写入 `~/.config/opencode/opencode.json`
- **Codex CLI** — 一键写入 `~/.codex/config.toml` 与认证配置
- **备份恢复** — 写入前自动备份，支持恢复与移除托管配置
- **应用配置引导** — 发布后自动弹出配置引导，提示前往设置页完成客户端配置

### 供应商与客户端兼容性

|            | Claude Code | OpenCode | Codex CLI    |
| ---------- | ----------- | -------- | ------------ |
| DeepSeek   | ✅           | ✅        | ❌            |
| Zhipu AI   | ✅           | ✅        | ❌            |
| 阿里云百炼  | ✅           | ✅        | qwen3.6-plus |
| MiniMax    | ✅           | ✅        | ❌            |
| Kimi       | ✅           | ✅        | ❌            |
| 火山方舟   | ✅           | ✅        | ❌            |
| OpenRouter | ✅           | ✅        | ✅            |
| 腾讯云     | ✅           | ✅        | ❌            |

> **Codex CLI 注意**：AAStation 不支持修改旧版本 Codex 配置，而新版 Codex 采用 Responses API，兼容性较差。建议优先使用 **Claude Code** 或 **OpenCode** 等兼容性更好的 CLI 工具。如需继续使用 Codex，请安装 **0.80.0 及以下**支持 Chat/Completions API 的旧版本（详见 [Codex 官方说明](https://github.com/openai/codex/discussions/7782)）。

### 本地代理服务器

- 在本机运行 HTTP 代理
- 按照画布中的 Switcher + Poller 工作流转发请求
- 同时支持 OpenAI 和 Anthropic API 格式
- 兼容浏览器端客户端
- 请求监控与指标采集（请求数 / Token / 延迟 / 成功率）
- Provider 运行时状态与健康探测（Healthy / Degraded / Circuit Open / Half Open）
- 指标持久化与路由自动恢复

### 桌面体验

- 原生桌面应用体验 — 轻量、快速
- 系统托盘集成 — 后台静默运行
- Windows 开机自启动（可在设置页开关）
- 深色主题 UI，使用 shadcn/ui 组件库
- 实时状态监控和请求统计（Monitor 页面）
- 应用更新管理 — 启动时自动检查更新，支持手动检测与一键安装

## 新手操作步骤

以下是第一次使用 AAStation 的完整操作流程：

### 第一步：首次启动

1. **下载安装**：从 [Releases 页面](https://github.com/QinMoXX/AAStation/releases) 下载最新安装包并安装
2. **启动应用**：打开 AAStation，进入主界面

### 第二步：添加供应商（Provider）

1. 主页左侧的列表添加节点，选择 **Provider**
2. 从预设列表中选择一个供应商（如 DeepSeek、智谱 AI 等）
3. 填写该服务商的 **API Key**（密钥仅本地存储，不会上传）
4. 根据需要调整模型列表，每个模型会生成一个唯一的输入端口

### 第三步：添加应用（Application）

1. 添加一个 **Application** 节点
2. 选择应用类型：
   - **Claude Code** — 如果你在使用 Anthropic 的 CLI 工具
   - **OpenCode** — 如果你在使用 OpenCode
   - **Codex CLI** — 如果你在使用 OpenAI 的 Codex
   - **通用应用** — 其他兼容 OpenAI API 和 Anthropic API 的工具

### 第四步：连接节点构建管道

1. 按照 **Application → Provider** 的方向连接节点
2. 如果需要路由规则，中间添加 **Switcher** 节点：
   - 支持按**模型名称**、**路径前缀**、**请求头** 匹配
3. 如果需要多供应商动态分流，中间添加 **Poller** 节点：
   - 支持**加权轮询**、**网络状态优先**、**剩余额度优先**
4. 连接时从节点右侧的圆点拖向另一个节点左侧的圆点

> **提示**：无效连接会被自动阻止，并给出提示信息。

### 第五步：保存并启动代理

1. 点击顶部的 **保存** 按钮（或按 `Ctrl+S`）
2. 等待后端验证并编译路由管道
3. 点击 **开启代理** 按钮
4. 如果使用了 Application 节点，会自动弹出**应用配置引导**，提示前往设置页完成客户端配置

### 第六步：配置客户端工具

1. 进入左侧导航栏的 **设置 → 应用设置**
2. 选择对应的应用（Claude Code / OpenCode / Codex CLI）
3. 选择要关联的 Application 节点
4. 点击 **写入配置** — AAStation 会自动将代理地址写入客户端的配置文件
5. 如需还原，可使用 **恢复备份** 功能

### 第七步：验证运行

1. 进入 **监控** 页面，查看请求统计和 Provider 运行状态
2. 在客户端工具中正常使用 AI 服务，请求会经过 AAStation 代理转发
3. 监控页面会实时显示：
   - 请求总数、成功/失败数
   - Token 消耗统计
   - 各 Provider 的延迟和健康状态

### 常见场景示例

**场景一：单一供应商**
```
通用应用 → DeepSeek Provider
```
所有请求直接转发到 DeepSeek。

**场景二：多供应商按模型分流**
```
Claude Code → Switcher → DeepSeek Provider
                       → 智谱 AI Provider
```
Switcher 根据请求中的模型名称自动分配到对应的供应商。

**场景三：多供应商负载均衡**
```
OpenCode → Poller → DeepSeek Provider
                  → 腾讯云 Provider
                  → 火山方舟 Provider
```
Poller 根据权重或健康状态动态选择供应商。

---

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://www.rust-lang.org/tools/install)（最新稳定版）
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（Windows 桌面开发工作负载）

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/QinMoXX/AAStation.git
cd AAStation

# 安装前端依赖
npm install

# 开发模式运行
npm run tauri dev
```

### 生产构建

```bash
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19, TypeScript, Vite 7 |
| UI 组件 | shadcn/ui, Tailwind CSS 4 |
| 画布 | React Flow 11 |
| 状态管理 | Zustand 5 |
| 后端 | Rust, Tauri 2 |
| 代理服务器 | Axum, Reqwest |
| 图标 | @lobehub/icons, Lucide React |

## 路由工作原理

1. **Application 节点**将请求发送到管道
2. **Switcher 节点**根据路由规则匹配每个请求：
   - **路径前缀** — 按 URL 路径匹配（如 `/v1/messages`）
   - **请求头** — 按 HTTP 请求头匹配（如 `Authorization: Bearer sk-...`）
   - **模型名称** — 按请求的模型名称匹配（如 `claude-sonnet-4`）
3. 请求可进入 **Poller 节点**，在多个目标 Provider 间动态选择（加权轮询 / 网络状态优先 / 剩余额度优先）
4. 未匹配的请求走 Switcher/Poller 的默认回退（如果配置了）
5. **Provider 节点**将请求转发到对应的 AI 服务

## 参与贡献

欢迎贡献！你可以：

- 提交 Issue 报告问题或建议功能
- 提交 Pull Request 改进代码
- 帮助完善文档

## 许可证

MIT License

---

<a name="english"></a>

## English

### What is AAStation?

AAStation is a desktop application that lets you **build AI API routing pipelines visually**. Instead of writing complex proxy configurations by hand, you drag and drop nodes on a canvas to define how API requests flow from your applications through intelligent routing rules to AI service providers.

Whether you need to route requests based on model names, path prefixes, or HTTP headers, or dynamically pick providers by health status and token budget, AAStation provides an intuitive node-based interface to configure it all — then runs a local proxy server that executes your routing logic in real time.

### Features

- **Visual Pipeline Builder** — Node-based canvas with auto-save, connection validation, mini-map, and node-tag filtering
- **Four Node Types** — Application, Switcher, Poller (weighted / health-first / token-remaining), and Provider
- **Client Integration** — One-click configuration for Claude Code, OpenCode, and Codex CLI with backup/restore
- **Built-in Provider Presets** — DeepSeek, Zhipu AI, Alibaba Bailian, MiniMax, Kimi (Moonshot), Volcengine Ark, OpenRouter, Tencent Cloud
- **Proxy Observability** — Request monitoring, runtime provider status, metric collection, and monitor dashboard
- **State Persistence** — Persisted metrics and automatic route restoration after restart
- **Update Management** — Startup update check with manual trigger and one-click install
- **Local Proxy Server** — Local proxy supporting both OpenAI and Anthropic API formats with Switcher + Poller workflow
- **Desktop Experience** — Native desktop app with system tray integration, Windows launch-at-startup option, and dark theme UI powered by shadcn/ui

### Beginner's Guide

1. **Add Provider nodes** — Choose from built-in presets (DeepSeek, Zhipu AI, etc.) and enter your API key
2. **Add Application nodes** — Select your client type (Claude Code, OpenCode, Codex CLI, or generic)
3. **Connect nodes** — Link Application → Switcher/Poller → Provider to build your routing pipeline
4. **Save & Start Proxy** — Click Save, then Start Proxy to run the local proxy server
5. **Configure Client** — Go to Settings > Applications to write proxy config to your client tools
6. **Monitor** — Check the Monitor page for real-time request stats and provider health

### Built-in Provider Presets

Preconfigured mainstream AI providers. Add your API key and start using them immediately:

| Provider | Preconfigured Models |
|----------|----------------------|
| **DeepSeek** | DeepSeek Chat, DeepSeek Reasoner |
| **Zhipu AI** | GLM-5.1, GLM-5 Turbo, GLM-5, GLM-4.7, GLM-4.7 Flash, GLM-4.6, GLM-4.5 Air |
| **Alibaba Bailian** | Qwen 3.6 Plus, Qwen 3 Max, Qwen Plus, Qwen Flash, Qwen Turbo, Qwen Long, QwQ Plus, Qwen 3 Coder Plus, Qwen VL Plus, Qwen Omni Turbo, Text Embedding V4 |
| **MiniMax** | MiniMax M2.7, M2.7 Highspeed, M2.5, M2.5 Highspeed, M2.1, M2.1 Highspeed, M2 |
| **Kimi (Moonshot)** | Kimi K2.6, K2.5, K2 0905 Preview, K2 Thinking, K2 Thinking Turbo, K2 Turbo Preview, Moonshot V1 8K/32K/128K, Moonshot V1 Vision 8K/32K/128K |
| **Volcengine Ark** | Doubao Seed 2.0 Pro/Lite/Mini/Code Preview, Doubao Seed Character, GLM-4.7, DeepSeek Chat, DeepSeek V3.1 |
| **OpenRouter** | GPT-5.2, Claude Sonnet 4, Claude 3.5 Sonnet, GPT-4o, Gemini Pro 1.5, Llama 3.1 405B |
| **Tencent Cloud** | Hy3 preview, HY 2.0 Think, HY 2.0 Instruct, Hunyuan-role, DeepSeek-V4-Flash, DeepSeek-V4-Pro, Deepseek-v3.2, Deepseek-v3.1, Deepseek-r1-0528, Deepseek-v3-0324, GLM-5.1, GLM-5V-Turbo, GLM-5-Turbo, GLM-5, Kimi-K2.6, Kimi-K2.5, MiniMax-M2.7, MiniMax-M2.5 |

### Provider-Client Compatibility

|            | Claude Code | OpenCode | Codex CLI    |
| ---------- | ----------- | -------- | ------------ |
| DeepSeek   | ✅           | ✅        | ❌            |
| Zhipu AI   | ✅           | ✅        | ❌            |
| Bailian    | ✅           | ✅        | qwen3.6-plus |
| MiniMax    | ✅           | ✅        | ❌            |
| Kimi       | ✅           | ✅        | ❌            |
| Ark        | ✅           | ✅        | ❌            |
| OpenRouter | ✅           | ✅        | ✅            |
| Tencent    | ✅           | ✅        | ❌            |

> **Codex CLI Note**: AAStation cannot modify older Codex configurations, and newer Codex versions use the Responses API with limited compatibility. We recommend using **Claude Code** or **OpenCode** for better compatibility. If you must use Codex, install **v0.80.0 or below** which supports the Chat/Completions API (see [Codex announcement](https://github.com/openai/codex/discussions/7782)).

### How Routing Works

1. **Application nodes** emit requests into the pipeline
2. **Switcher nodes** evaluate routing rules against each request (path prefix / header / model name)
3. **Poller nodes** can dynamically choose among multiple provider targets
4. Unmatched requests follow the Switcher/Poller default route (if configured)
5. **Provider nodes** forward the request to the corresponding AI service

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite 7 |
| UI Components | shadcn/ui, Tailwind CSS 4 |
| Canvas | React Flow 11 |
| State | Zustand 5 |
| Backend | Rust, Tauri 2 |
| Proxy Server | Axum, Reqwest |
| Icons | @lobehub/icons, Lucide React |

### License

MIT License
