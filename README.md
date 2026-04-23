<p align="center">
  <img src="src-tauri/icons/logo.png" alt="AAStation Logo" width="128" height="128" />
</p>

<h1 align="center">AAStation</h1>

<p align="center">
  <strong>可视化的 AI API 代理管理器</strong>
</p>

<p align="center">
  <a href="https://github.com/nicepkg/AAStation/releases">
    <img src="https://img.shields.io/badge/version-0.5.5-blue" alt="Version" />
  </a>
  <img src="https://img.shields.io/badge/platform-Windows-green" alt="Platform" />
  <img src="https://img.shields.io/badge/Tauri-2.0-orange" alt="Tauri" />
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License" />
</p>

---

**简体中文** | [English](#english)

## AAStation 是什么？

AAStation 是一个桌面应用，让你可以**通过可视化方式构建 AI API 路由管道**。无需手动编写复杂的代理配置，只需在画布上拖拽节点，就能定义 API 请求如何从应用程序经过智能路由规则到达 AI 服务提供商。

无论你是需要根据模型名称、路径前缀还是 HTTP 请求头来路由请求，AAStation 都提供了直观的节点式界面来配置一切——然后在本地运行代理服务器，实时执行你的路由逻辑。

## 主要特性

### 可视化管道构建器

- **节点画布** — 拖拽、连接、配置，一切可视化
- **自动保存**，同时支持 `Ctrl+S` 手动保存
- **连接校验** — 即时反馈，防止无效路由
- **小地图** — 大型管道也能轻松导航

### 三种节点类型

| 节点 | 说明 |
|------|------|
| **Application** | 代表发送请求到代理的客户端应用或工具，支持多节点并分配独立端口 |
| **Switcher** | 根据路径前缀、HTTP 请求头或模型名称路由请求，支持默认回退 |
| **Provider** | AI 服务端点，提供按模型和统一的输入端口 |

### 内置服务商预设

预配置主流 AI 服务，添加 API Key 即可使用：

| 服务商 | 支持模型 |
|--------|----------|
| **DeepSeek** | DeepSeek Chat, DeepSeek Reasoner |
| **智谱 AI (Zhipu AI)** | GLM-5.1, GLM-5 Turbo, GLM-5, GLM-4.7, GLM-4.7 Flash, GLM-4.6, GLM-4.5 Air |
| **阿里云百炼 (Bailian)** | Qwen 3.6 Plus, Qwen 3 Max, Qwen Plus, Qwen Flash, Qwen Turbo, Qwen Long, QwQ Plus, Qwen 3 Coder Plus, Qwen VL Plus, Qwen Omni Turbo, Text Embedding V4 |
| **MiniMax** | MiniMax M2.7, M2.7 Highspeed, M2.5, M2.5 Highspeed, M2.1, M2.1 Highspeed, M2 |
| **Kimi (Moonshot)** | Kimi K2.6, K2.5, K2 0905 Preview, K2 Thinking, K2 Thinking Turbo, K2 Turbo Preview, Moonshot V1 8K/32K/128K, Moonshot V1 Vision 8K/32K/128K |
| **火山方舟 (Ark)** | Doubao Seed 2.0 Pro/Lite/Mini/Code Preview, Doubao Seed Character, GLM-4.7, DeepSeek Chat, DeepSeek V3.1 |
| **腾讯云 (Tencent)** | GLM-5, HY 2.0 Think, HY 2.0 Instruct, Hunyuan Role, Deepseek-v3.2, Deepseek-v3.1, Deepseek-r1-0528, Deepseek-v3-0324, Kimi K2.5, Kimi K2 Thinking Turbo, Kimi K2 Turbo Preview, MiniMax M2.5, MiniMax M2.7 |

### 深度集成 Claude Code

- **自动配置** — 检测到 Claude Code 节点时，可一键将代理 URL 和认证令牌注入到 `~/.claude/settings.json`
- **开箱即用** — 可直接配合 Claude Code 使用本地代理

### 本地代理服务器

- 在本机运行 HTTP 代理
- 按照画布中的路由规则转发请求
- 同时支持 OpenAI 和 Anthropic API 格式
- 兼容浏览器端客户端
- 请求监控与指标采集
- 指标持久化与路由自动恢复

### 桌面体验

- 原生桌面应用体验 — 轻量、快速
- 系统托盘集成 — 后台静默运行
- 自定义标题栏，深色主题 UI
- 实时状态监控和请求统计（Monitor 页面）

## 截图



## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://www.rust-lang.org/tools/install)（最新稳定版）
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（Windows 桌面开发工作负载）

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/nicepkg/AAStation.git
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



你可以在画布上构建路由管道，并让本地代理服务器按照这些规则转发 API 请求。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19, TypeScript, Vite 7 |
| 画布 | React Flow 11 |
| 状态管理 | Zustand 5 |
| 后端 | Rust, Tauri 2 |
| 代理服务器 | Axum, Reqwest |
| 图标 | @lobehub/icons |

## 路由工作原理

1. **Application 节点**将请求发送到管道
2. **Switcher 节点**根据路由规则匹配每个请求：
   - **路径前缀** — 按 URL 路径匹配（如 `/v1/messages`）
   - **请求头** — 按 HTTP 请求头匹配（如 `Authorization: Bearer sk-...`）
   - **模型名称** — 按请求的模型名称匹配（如 `claude-sonnet-4`）
3. 未匹配的请求走 Switcher 的默认路由（如果配置了的话）
4. **Provider 节点**将请求转发到对应的 AI 服务

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

Whether you need to route requests based on model names, path prefixes, or HTTP headers, AAStation provides an intuitive node-based interface to configure it all — then runs a local proxy server that executes your routing logic in real time.

### Features

- **Visual Pipeline Builder** — Node-based canvas with auto-save, connection validation, and mini-map
- **Three Node Types** — Application (supports multiple nodes with dedicated ports), Switcher (smart routing), Provider (AI service endpoint)
- **Claude Code Integration** — One-click configuration to inject local proxy settings into `~/.claude/settings.json`
- **Built-in Provider Presets** — DeepSeek, Zhipu AI, Alibaba Bailian, MiniMax, Kimi (Moonshot), Volcengine Ark, OpenRouter, Tencent Cloud
- **Proxy Observability** — Request monitoring, metric collection, and monitor dashboard
- **State Persistence** — Persisted metrics and automatic route restoration after restart
- **Local Proxy Server** — Local proxy supporting both OpenAI and Anthropic API formats
- **Desktop Experience** — Native desktop app with system tray integration and dark theme UI

### Quick Start

```bash
git clone https://github.com/nicepkg/AAStation.git
cd AAStation
npm install
npm run tauri dev
```

### How Routing Works

1. **Application nodes** emit requests into the pipeline
2. **Switcher nodes** evaluate routing rules against each request (path prefix / header / model name)
3. Unmatched requests follow the Switcher's default route (if configured)
4. **Provider nodes** forward the request to the corresponding AI service

### License

MIT License
