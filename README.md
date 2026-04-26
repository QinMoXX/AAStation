<p align="center">
  <img src="src-tauri/icons/logo.png" alt="AAStation Logo" width="128" height="128" />
</p>

<h1 align="center">AAStation</h1>

<p align="center">
  <strong>可视化 AI API 代理管理器</strong>
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

AAStation 是一个桌面软件，让你**通过画图的方式来管理 AI 请求**。

不用写配置文件，也不用记复杂的命令行参数。你只需在画布上拖拽几个方块、连上线，就能决定哪个 AI 服务来处理你的请求。设置好后，在本地开个代理就能直接用。

<p align="center">
  <img src="public/Snipaste_2026-04-26_21-36-04.png" alt="AAStation 主界面" />
</p>

## 能做什么？

- **图形化配置** — 不用写代码，拖拽连线就能搭建请求链路
- **智能分配** — 根据供应商的健康状况和额度余量，自动切换可用服务
- **原生桌面体验** — 系统托盘后台运行，支持开机自启
- **一键配置客户端** — 自动写入 Claude Code、OpenCode、Codex CLI 的代理配置
- **自带监控面板** — 实时查看请求量、成功率、耗时等统计

## 适用场景

- 你需要同时用多个 AI 服务（如 DeepSeek、智谱、MiniMax 等）
- 你不想在多个客户端工具里反复修改配置
- 你希望某个 AI 服务挂了后能自动切到另一个
- 你有一个客户端工具（如 Claude Code），想让它用上其他供应商的模型

## 主要特性

### 可视化画布

- 拖拽添加节点，连线决定请求流向
- 自动保存，也可按 `Ctrl+S` 手动保存
- 不合法的连接会自动阻止并提示原因
- 小地图辅助，画布再大也能看清全貌

### 四种节点

| 节点 | 大白话说明 |
|------|-----------|
| **应用 (Application)** | 用来发送请求的客户端工具，每个应用分配一个独立端口 |
| **路由器 (Switcher)** | 按条件（如模型名称、路径）把请求发给不同的 AI 服务 |
| **分配器 (Poller)** | 在多个 AI 服务之间自动挑选一个来转发（按权重、健康状态或剩余额度） |
| **供应商 (Provider)** | 代表一个 AI 服务商，配置好 API Key 就能用 |

### 内置供应商预设

开箱即用，填上 API Key 就行：

| 供应商 | 预配置模型 |
|--------|----------|
| **DeepSeek** | DeepSeek Chat, DeepSeek Reasoner |
| **智谱 AI** | GLM-5.1, GLM-5 Turbo, GLM-5, GLM-4.7, GLM-4.7 Flash, GLM-4.6, GLM-4.5 Air |
| **阿里云百炼** | Qwen 3.6 Plus, Qwen 3 Max, Qwen Plus, Qwen Flash, Qwen Turbo, Qwen Long, QwQ Plus, Qwen 3 Coder Plus, Qwen VL Plus, Qwen Omni Turbo, Text Embedding V4 |
| **MiniMax** | MiniMax M2.7, M2.7 Highspeed, M2.5, M2.5 Highspeed, M2.1, M2.1 Highspeed, M2 |
| **Kimi** | Kimi K2.6, K2.5, K2 0905 Preview, K2 Thinking, K2 Thinking Turbo, K2 Turbo Preview, Moonshot V1 8K/32K/128K, Moonshot V1 Vision 8K/32K/128K |
| **火山方舟** | Doubao Seed 2.0 Pro/Lite/Mini/Code Preview, Doubao Seed Character, GLM-4.7, DeepSeek Chat, DeepSeek V3.1 |
| **OpenRouter** | GPT-5.2, Claude Sonnet 4, Claude 3.5 Sonnet, GPT-4o, Gemini Pro 1.5, Llama 3.1 405B |
| **腾讯云** | Hy3 preview, HY 2.0 Think, HY 2.0 Instruct, Hunyuan-role, DeepSeek-V4-Flash, DeepSeek-V4-Pro, Deepseek-v3.2, Deepseek-v3.1, Deepseek-r1-0528, Deepseek-v3-0324, GLM-5.1, GLM-5V-Turbo, GLM-5-Turbo, GLM-5, Kimi-K2.6, Kimi-K2.5, MiniMax-M2.7, MiniMax-M2.5 |

### 常用客户端一键配置

| | Claude Code | OpenCode | Codex CLI |
| - | ----------- | -------- | --------- |
| DeepSeek | ✅ | ✅ | ❌ |
| 智谱 AI | ✅ | ✅ | ❌ |
| 阿里云百炼 | ✅ | ✅ | qwen3.6-plus |
| MiniMax | ✅ | ✅ | ❌ |
| Kimi | ✅ | ✅ | ❌ |
| 火山方舟 | ✅ | ✅ | ❌ |
| OpenRouter | ✅ | ✅ | ✅ |
| 腾讯云 | ✅ | ✅ | ❌ |

> **Codex CLI 注意**：AAStation 不支持修改旧版 Codex 配置；新版 Codex 改用 Responses API，兼容性有限。建议优先使用 **Claude Code** 或 **OpenCode**。如需使用 Codex，请安装 **0.80.0 及以下**版本（详见 [Codex 官方说明](https://github.com/openai/codex/discussions/7782)）。

### 本地代理

- 在本机跑一个 HTTP 代理
- 按照画布上的规则转发请求
- 同时支持 OpenAI 和 Anthropic 两种格式
- 代理开着的时候，客户端只管正常用，不需要关心走到哪个供应商

### 其他

- 请求实时监控（数量 / Token / 延迟 / 成功率）
- 供应商运行状态可视（正常 / 降级 / 熔断 / 半开）
- 深色主题界面
- 应用更新管理 — 启动时自动检查，支持手动检测与一键安装
- 统计和健康状态会持久化，重启后自动恢复

## 新手操作步骤

### 1. 首次启动

从 [Releases 页面](https://github.com/QinMoXX/AAStation/releases) 下载安装包，安装后打开即可。

### 2. 添加供应商

1. 点击左侧列表的加号，选择 **供应商 (Provider)**
2. 从预设中选择（如 DeepSeek、智谱 AI 等）
3. 填入你的 **API Key**（只存在本地，不会上传）
4. 每个模型会生成一个输入端口

### 3. 添加应用

1. 添加一个 **应用 (Application)** 节点
2. 选择你的客户端工具类型（Claude Code / OpenCode / Codex CLI / 通用应用）

### 4. 连线

1. 从应用节点的右侧圆点拖向供应商节点的左侧圆点
2. 中间可以加路由器或分配器来决定请求怎么走
3. 不合法的连接会被阻止，并有提示

### 5. 保存并启动

1. 点击 **保存**（或 `Ctrl+S`）
2. 点击 **开启代理**
3. 会弹出配置引导，提示前往设置页完成客户端配置

### 6. 配置客户端

1. 进入 **设置 → 应用设置**
2. 选择你的客户端（Claude Code / OpenCode / Codex CLI）
3. 选择关联的应用节点
4. 点击 **写入配置** — 代理地址会自动写入客户端配置文件
5. 想还原原来的配置，点 **恢复备份** 即可

### 7. 验证

1. 进入 **监控** 页面，查看请求统计和供应商状态
2. 在客户端工具中正常使用 AI 服务，请求会经过代理转发

### 常见搭配示例

**最简单的用法：一个供应商**
```
通用应用 → DeepSeek
```
所有请求直接发给 DeepSeek。

**按模型分流**
```
Claude Code → 路由器 → DeepSeek
                     → 智谱 AI
```
路由器根据请求的模型名自动分配到对应的供应商。

**多供应商自动切换**
```
OpenCode → 分配器 → DeepSeek
                  → 腾讯云
                  → 火山方舟
```
分配器按权重或健康状态自动选一个供应商来转发。

---

## 快速开始

### 环境要求（自构建时需要）

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://www.rust-lang.org/tools/install)（最新稳定版）
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（Windows 需安装"桌面开发"工作负载）

不想自己构建？直接去 [Releases 页面](https://github.com/QinMoXX/AAStation/releases) 下载安装包即可。

### 从源码运行

```bash
git clone https://github.com/QinMoXX/AAStation.git
cd AAStation
npm install
npm run tauri dev
```

### 构建发布版

```bash
npm run tauri build
```

构建产物在 `src-tauri/target/release/bundle/`。

## 请求是怎么走的

```
应用 → 路由器/分配器 → 供应商
```

1. **应用** 把请求发到管道
2. **路由器** 按条件（路径、请求头、模型名）匹配目的地
3. **分配器** 在多个供应商中挑选一个（按权重 / 健康度 / 额度）
4. 没匹配到的请求走默认路线（如果设置了的话）
5. **供应商** 把请求转发到真正的 AI 服务

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19, TypeScript, Vite 7 |
| UI | shadcn/ui, Tailwind CSS 4 |
| 画布 | React Flow 11 |
| 状态管理 | Zustand 5 |
| 后端 | Rust, Tauri 2 |
| 代理服务器 | Axum, Reqwest |
| 图标 | @lobehub/icons, Lucide React |

## 参与贡献

欢迎提交 Issue 或 Pull Request。

## 许可证

MIT License

---

<a name="english"></a>

## English

### What is AAStation?

AAStation is a desktop app that lets you **manage AI API requests by drawing a flowchart**.

No config files, no command-line tricks. Just drag boxes onto a canvas, connect them with lines, and decide which AI service handles your requests. Once set up, start a local proxy and you're good to go.

### Features

- **Visual configuration** — Drag, connect, and configure without writing code
- **Smart routing** — Automatically switches between AI providers based on health and quota
- **One-click client setup** — Auto-writes proxy config for Claude Code, OpenCode, and Codex CLI
- **Monitor dashboard** — Real-time request stats, success rate, latency, and token usage
- **Built-in provider presets** — DeepSeek, Zhipu AI, Alibaba Bailian, MiniMax, Kimi, Volcengine Ark, OpenRouter, Tencent Cloud
- **Desktop native** — System tray, autostart, dark theme, auto-updates

### Quick Start (Pre-built)

Download the installer from [Releases](https://github.com/QinMoXX/AAStation/releases) and run it.

### Build from Source

```bash
git clone https://github.com/QinMoXX/AAStation.git
cd AAStation
npm install
npm run tauri dev
```

### How It Works

```
App → Router/Switcher → AI Provider
```

1. An **Application** node sends requests into the pipeline
2. A **Switcher** node routes by model name, path, or HTTP header
3. A **Poller** node picks the best provider (by weight, health, or remaining quota)
4. A **Provider** node forwards the request to the actual AI service

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite 7 |
| UI | shadcn/ui, Tailwind CSS 4 |
| Canvas | React Flow 11 |
| State | Zustand 5 |
| Backend | Rust, Tauri 2 |
| Proxy Server | Axum, Reqwest |
| Icons | @lobehub/icons, Lucide React |

### License

MIT License
