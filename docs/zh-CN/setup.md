[English](../setup.md) | **简体中文**

# 本地部署指南

按照以下步骤在本地运行 Synapse。

---

## 前置要求

| 工具 | 版本 | 安装地址 |
|------|------|---------|
| Python | 3.12+ | [python.org](https://www.python.org/downloads/) |
| Node.js | 18+（含 npm） | [nodejs.org](https://nodejs.org/) |
| uv | 最新版 | [docs.astral.sh/uv](https://docs.astral.sh/uv/) |
| PostgreSQL | 14+（可选） | [postgresql.org](https://www.postgresql.org/download/) |
| Docker | 最新版（可选） | [docker.com](https://www.docker.com/get-started/) |

> **PostgreSQL** 为可选项 — 不安装的话，对话记录不会在服务重启后保留。
> **Docker** 仅在需要通过 Boxlite 进行沙盒代码执行时才需要。

### 验证前置要求

```bash
python3 --version   # 3.12+
node --version       # 18+
uv --version         # 任意近期版本
```

---

## 1. 克隆仓库

```bash
git clone https://github.com/droxer/Synapse.git
cd Synapse
```

---

## 2. 安装依赖

```bash
make install
```

该命令会为后端执行 `uv sync`，为前端执行 `npm install`。

也可以分别安装：

```bash
make install-backend   # cd backend && uv sync
make install-web       # cd web && npm install
```

---

## 3. 配置环境变量

复制示例文件并填入你的 API 密钥：

```bash
cp backend/.env.example backend/.env
```

编辑 `backend/.env`：

```bash
# 必填 — 必须设置
ANTHROPIC_API_KEY=sk-ant-...
TAVILY_API_KEY=tvly-...

# 可选 — 使用任何 Anthropic 兼容的 LLM 提供者
# ANTHROPIC_BASE_URL=https://api.anthropic.com   # 默认（Anthropic）
# ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1  # OpenRouter 示例

# 可选 — 沙盒提供者（默认：boxlite，自动拉取预构建镜像）
# SANDBOX_PROVIDER=boxlite      # 推荐 — 需要 Docker
# SANDBOX_PROVIDER=local        # 未安装 Docker 时使用

# 可选 — 数据库（留空或删除则跳过持久化）
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/synapse
```

### LLM 提供者

Synapse 支持任何提供 Anthropic 兼容 API 的 LLM 提供者。设置 `ANTHROPIC_BASE_URL` 指向你的提供者地址，`ANTHROPIC_API_KEY` 设置为对应的密钥即可。

| 提供者 | `ANTHROPIC_BASE_URL` | 说明 |
|--------|---------------------|------|
| Anthropic（默认） | `https://api.anthropic.com` | 直连 Claude API |
| OpenRouter | `https://openrouter.ai/api/v1` | 可访问多种模型 |
| Amazon Bedrock | 使用 Bedrock 端点 URL | 通过 Anthropic SDK |
| 其他兼容代理 | 你的代理地址 | 需支持 Anthropic messages API |

你还可以自定义不同任务使用的模型：

```bash
PLANNING_MODEL=claude-sonnet-4-20250514    # 任务规划模型
TASK_MODEL=claude-sonnet-4-20250514        # 任务执行模型
LITE_MODEL=claude-haiku-4-5-20251001       # 简单子任务模型
```

### API 密钥

| 密钥 | 获取地址 | 是否必填 |
|------|---------|---------|
| `ANTHROPIC_API_KEY` | 你的 LLM 提供者 | 是 |
| `TAVILY_API_KEY` | [tavily.com](https://tavily.com/) | 是 |
| `MINIMAX_API_KEY` | [minimaxi.com](https://www.minimaxi.com/) | 否（启用图片生成） |
| `E2B_API_KEY` | [e2b.dev](https://e2b.dev/) | 否（仅 `SANDBOX_PROVIDER=e2b` 时需要） |

### 频道集成

如需启用 Telegram 频道集成：

```bash
# 启用频道功能
CHANNELS_ENABLED=true

# Webhook 基础 URL（Telegram 需要用于发送 webhook）
# 必须是公网可访问的地址
CHANNELS_WEBHOOK_BASE_URL=https://your-domain.com
```

Webhook URL 格式为：`{CHANNELS_WEBHOOK_BASE_URL}/api/channels/telegram/webhook`

**设置 Telegram：**
1. 在 Telegram 上通过 [@BotFather](https://t.me/botfather) 创建机器人
2. 复制机器人令牌并在频道页面进行配置
3. Synapse 将自动设置 webhook

### 沙盒提供者

| 提供者 | 适用场景 | 依赖 |
|--------|---------|------|
| `local` | 开发环境 — 以本地子进程运行代码（无隔离） | 无 |
| `boxlite` | 推荐 — 隔离的微型虚拟机，提供预构建镜像 | Docker |
| `e2b` | 云端沙盒 | `E2B_API_KEY` |

推荐使用 `SANDBOX_PROVIDER=boxlite`（默认值）。预构建镜像已发布到 GHCR，Docker 会在首次运行时自动拉取，无需手动构建。

如果未安装 Docker，可设置 `SANDBOX_PROVIDER=local`，以本地子进程运行代码（无隔离）。

---

## 4. 配置数据库（可选）

如需对话持久化，先创建 PostgreSQL 数据库：

```bash
createdb synapse
```

确保 `backend/.env` 中的 `DATABASE_URL` 指向该数据库：

```
DATABASE_URL=postgresql+asyncpg://localhost:5432/synapse
```

然后执行迁移：

```bash
cd backend && uv run alembic upgrade head
```

> 如果不需要持久化，可跳过此步骤。应用在没有数据库的情况下也能正常运行。

---

## 5. 启动开发服务器

```bash
make dev
```

该命令会同时启动两个服务：
- **后端** (FastAPI)：http://localhost:8000
- **前端** (Next.js)：http://localhost:3000

在浏览器中打开 http://localhost:3000。

如需分别启动（便于调试）：

```bash
# 终端 1
make backend    # cd backend && uv run python -m api.main

# 终端 2
make web        # cd web && npm run dev
```

---

## 6. 沙盒镜像（可选）

Boxlite 沙盒镜像已发布到 GHCR，Docker 会在需要时自动拉取——**无需手动构建**。

如需自定义镜像或从源码构建：

```bash
make build-sandbox
```

将构建三个镜像：
- `synapse-sandbox-default` — Python、Node.js、git
- `synapse-sandbox-data-science` — pandas、numpy、matplotlib
- `synapse-sandbox-browser` — Playwright + Chromium

---

## 7. 桌面应用（可选）

Synapse 还提供基于 Tauri v2 的原生桌面应用。它将 Web UI 封装在原生窗口中。

```bash
# 开发模式 — 打开 Tauri 窗口并支持热重载
make desktop

# 生产构建 — 创建 .app 应用包
make build-desktop
```

详见 [桌面应用指南](../desktop-app.md)。

---

## 项目结构

```
Synapse/
├── backend/           # Python/FastAPI 后端
│   ├── api/           # 路由、中间件、认证、应用工厂
│   ├── agent/         # 智能体运行时、工具、沙盒、技能、记忆
│   ├── config/        # 配置（Pydantic）
│   ├── evals/         # 智能体评测系统（YAML 用例、评分、报告）
│   ├── migrations/    # Alembic 数据库迁移
│   └── tests/         # pytest 测试套件
├── web/               # Next.js 前端
│   └── src/
│       ├── app/       # 页面（App Router）
│       │   └── font-assets/ # 内置本地 Geist/Noto 字体资源
│       ├── features/  # 功能模块（对话、智能体面板、技能、MCP、资料库、频道）
│       ├── shared/    # 共享组件、hooks、状态管理、类型定义
│       └── i18n/      # 国际化（en、zh-CN、zh-TW）
├── container/         # 沙盒 Dockerfiles
├── docs/              # 文档
└── Makefile           # 开发命令
```

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `make dev` | 启动后端 + 前端 |
| `make backend` | 仅启动后端 |
| `make web` | 仅启动前端 |
| `make install` | 安装所有依赖 |
| `make build-web` | 生产环境构建前端 |
| `make build-sandbox` | 构建沙盒 Docker 镜像 |
| `make migrate` | 执行数据库迁移 |
| `make desktop` | 启动 Tauri 桌面应用（开发模式） |
| `make build-desktop` | 构建 Tauri 桌面应用（生产包） |
| `make pre-commit` | 安装 pre-commit 钩子 |
| `make pre-commit-all` | 对所有文件运行 pre-commit |
| `make lint-web` | 前端代码检查 |
| `make test-web` | 运行前端测试 |
| `make audit-design-tokens` | 审核前端 token、颜色和阴影规则 |
| `make clean` | 删除 `.venv`、`node_modules`、`.next` |

### 后端测试与代码检查

在 `backend/` 目录下运行：

```bash
uv run pytest                          # 运行所有测试
uv run pytest path/to/test.py::test_fn # 重要：运行单个测试函数
uv run pytest --cov                    # 带覆盖率报告
uv run ruff check .                    # 代码检查
uv run ruff format .                   # 自动格式化
```

---

## 常见问题

### 端口被占用

```bash
# 查找并终止占用端口 8000 或 3000 的进程
lsof -ti:8000 | xargs kill -9
lsof -ti:3000 | xargs kill -9
```

### 找不到 `uv`

安装 uv：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 数据库连接被拒绝

- 检查 PostgreSQL 是否在运行：`pg_isready`
- 确认 `backend/.env` 中的 `DATABASE_URL` 与本地配置一致
- 如不需要持久化，删除或注释掉 `DATABASE_URL` 即可

### Boxlite 沙盒报错

- 确保 Docker 正在运行：`docker info`
- 先构建镜像：`make build-sandbox`
- 或切换为 `SANDBOX_PROVIDER=local` 用于开发

### 前端无法连接后端

前端通过代理将 `/api/*` 请求转发到 `http://127.0.0.1:8000`。请确保后端运行在 8000 端口。如果更改了后端端口，需同步修改 `web/next.config.ts`。

---

## 下一步

- [开发指南](development.md) — 架构详解、API 参考、环境变量
- [设计风格指南](DESIGN_STYLE_GUIDE.md) — UI 组件规范、色彩系统、字体排版
- [品牌规范](brand-guidelines.md) — 品牌标识与视觉设计语言
