[English](README.md) | **简体中文**

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="web/public/favicon-dark.svg" />
    <img src="web/public/favicon-light.svg" width="80" height="80" alt="HiAgent logo" />
  </picture>
</p>

<h1 align="center">HiAgent</h1>

一个替你完成工作的开源 AI 智能体平台。用自然语言描述任何任务——HiAgent 自动规划、编码、浏览并在安全沙盒中交付结果，全程实时展示每一步进展。

## 功能概览

**对话驱动的任务执行** — 用户用自然语言描述任务，HiAgent 的 ReAct 引擎会自动拆解任务、选择合适的工具，并逐步执行，同时实时展示进度。

**沙盒化代码执行** — 每个任务都在隔离的微型虚拟机（Boxlite）中运行。智能体可以编写和运行代码、安装软件包、查询数据库、自动化浏览器操作以及生成文件——完全不影响你的主机环境。

**多智能体规划** — 复杂任务会被自动分解为子任务，支持显式的计划声明。规划智能体协调多个并发运行的工作智能体，每个工作智能体拥有独立的沙盒环境。规划步骤实时跟踪和显示。

**可扩展的技能系统** — 技能是可移植的 YAML 定义文件，用于教授智能体新的方法论。技能可以定义指令、可用工具和沙盒需求。从 GitHub 导入的功能即将推出。

**MCP 集成** — 通过 Model Context Protocol 连接外部工具。添加 MCP 服务器即可使用第三方 API 和服务扩展智能体能力。

**频道集成** — 连接 Telegram 等消息平台，直接在你常用的应用中与 HiAgent 聊天。支持机器人配置、账户关联和无缝对话同步。

**实时流式输出** — 前端实时渲染每一个步骤：LLM 推理、工具执行、代码输出、生成的产物以及子智能体进度——全部通过 Server-Sent Events 实现。

## 界面截图

| 多智能体规划 | 技能系统 | MCP 集成 |
|:---:|:---:|:---:|
| ![多智能体规划](images/multi-agents.png) | ![技能系统](images/skills.png) | ![MCP 集成](images/mcp.png) |

## 特性

- **Google OAuth 认证**，支持按用户隔离的技能和 MCP 服务器配置
- **对话式界面**，支持文件上传、技能选择和后续消息
- **20+ 内置工具** — 网页搜索、代码执行、浏览器自动化（步骤跟踪）、计算机操作（动作元数据）、文件操作、数据库查询、图片生成、文档生成
- **规划模式** — 显式的任务分解，包含步骤名称、描述和进度跟踪（通过清单面板）
- **产物管理** — 沙盒中生成的文件可供下载和预览，并提供专用的资料库页面浏览所有产物
- **扩展思考** — 可配置的思考预算，用于复杂任务的深度推理
- **持久化记忆** — 智能体可跨对话轮次记住上下文
- **对话历史** — 基于 PostgreSQL 的完整持久化存储
- **智能体评测系统** — 基于 YAML 定义的评测用例，支持编程式和 LLM 评判两种评分模式，覆盖工具调用、技能激活、子智能体生成和智能体交接
- **频道集成** — 连接消息平台（Telegram），在你常用的应用中与 HiAgent 聊天
- **用户偏好** — 按用户持久化的主题（深色/浅色/系统）和语言设置
- **深色/浅色主题**，支持国际化（英文、中文）
- **键盘优先的交互体验** — 命令面板（Cmd+K）、响应式布局

## 快速开始

### 前置要求

- Python 3.12+、Node.js（含 npm）、[`uv`](https://docs.astral.sh/uv/)
- PostgreSQL（可选，用于对话持久化）
- Rust 1.77+（可选，用于桌面应用）

### Web 应用

```bash
make install

# 创建 backend/.env（参考 backend/.env.example）
# ANTHROPIC_API_KEY=...
# TAVILY_API_KEY=...

make dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可使用。

### 桌面应用

HiAgent 同时提供基于 [Tauri v2](https://v2.tauri.app/) 的原生桌面应用。它将 Web UI 封装在原生窗口中，自动管理后端和前端进程。

```bash
# 开发模式
make desktop

# 生产构建（.app / .msi / .deb）
make build-desktop
```

桌面应用将后端和前端作为子进程管理——如果它们已在运行（例如通过 `make dev`），则直接连接现有服务。Google OAuth 在系统浏览器中打开，认证完成后自动将会话传递回桌面窗口。

详见 [桌面应用指南](docs/desktop-app.md)。

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.12+, FastAPI, Anthropic SDK, SQLAlchemy (async), Alembic |
| 前端 | Next.js 15, React 19, Tailwind CSS 4, Zustand, Framer Motion, Radix UI |
| 桌面 | Tauri v2, Rust, WKWebView (macOS) / WebView2 (Windows) |
| 沙盒 | Boxlite micro-VMs, E2B (cloud), Docker |
| 数据库 | PostgreSQL, Redis（可选） |
| 包管理 | uv（后端）, npm（前端） |

## 文档

- [本地部署指南](docs/zh-CN/setup.md) — 从零开始在本地运行 HiAgent 的完整步骤
- [开发指南](docs/zh-CN/development.md) — 命令、架构、API 参考、环境变量及贡献流程
- [桌面应用指南](docs/desktop-app.md) — Tauri 桌面应用配置、OAuth 流程及故障排除
- [设计风格指南](docs/zh-CN/DESIGN_STYLE_GUIDE.md) — UI 组件规范、色彩系统、排版与无障碍设计
- [品牌指南](docs/zh-CN/brand-guidelines.md) — 品牌标识、色彩方案与视觉设计语言

## 许可证

[Apache-2.0](LICENSE)
