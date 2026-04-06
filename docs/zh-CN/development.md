[English](../development.md) | **简体中文** · [文档索引](../README.md) · [AGENTS.md](../../AGENTS.md)

# 开发指南

## 命令

```bash
make dev              # 同时启动后端（端口 8000）和前端（端口 3000）
make backend          # 仅后端: cd backend && uv run python -m api.main
make web              # 仅前端: cd web && npm run dev
make install          # 安装所有依赖（后端 + 前端）
make install-backend  # cd backend && uv sync
make install-web      # cd web && npm install
make build-web        # cd web && npm run build
make build-sandbox    # 构建 Boxlite 沙箱 Docker 镜像
make clean            # 清除 .venv、node_modules、.next
make pre-commit       # 安装 pre-commit 钩子
make pre-commit-all   # 对所有文件运行 pre-commit
make lint-web         # 前端代码检查: cd web && npx eslint src/
make desktop          # 启动 Tauri 桌面应用（开发模式）
make build-desktop    # 构建 Tauri 桌面应用（生产包）
```

### 后端测试与代码检查

在 `backend/` 目录下运行：

```bash
uv run pytest                          # 运行所有测试
uv run pytest path/to/test.py::test_fn # 重要：运行单个测试函数
uv run pytest --cov                    # 附带覆盖率
uv run ruff check .                    # 代码检查
uv run ruff format .                   # 代码格式化
```

### 智能体评测

在项目根目录运行：

```bash
make evals                                              # 运行所有评测（mock 后端）
make evals EVAL_ARGS="--backend live"                   # 使用真实 Claude API 运行
make evals EVAL_ARGS="--case web_search_basic"          # 按 id 运行单个用例
make evals EVAL_ARGS="--tags agent"                     # 按标签过滤（agent、skill、handoff 等）
make evals EVAL_ARGS="--output report.json"             # 输出 JSON 报告
make evals EVAL_ARGS="--judge-model claude-sonnet-4-20250514"  # 自定义 LLM 评判模型
```

或通过 uv 直接运行：

```bash
cd backend && uv run python -m evals --help
```

### 数据库迁移

在 `backend/` 目录下运行：

```bash
uv run alembic upgrade head                              # 执行迁移
uv run alembic revision --autogenerate -m "description"  # 创建迁移
```

---

## 代码规范与约定

**Python（后端）**
- **导入顺序**：标准库优先，第三方次之，本地导入最后。使用 `ruff check . --fix` 验证。
- **格式化**：使用 `ruff format`（默认 88 字符行宽限制）。
- **类型注解**：严格的 Python 3.12+ 类型注解。模型/DTO 使用 `pydantic`，内部状态使用 `dataclasses(frozen=True)` 确保不可变性。
- **命名规范**：文件、函数、变量使用 `snake_case`；类名使用 `PascalCase`。
- **错误处理**：使用 `try/except`。在 API 路由中抛出 FastAPI `HTTPException`。使用 `loguru` 记录错误（`from loguru import logger`）。

**TypeScript（前端）**
- **导入**：对相关的导入进行分组。优先使用绝对路径别名（如 `@/features/...`、`@/shared/...`）。
- **格式化/代码检查**：通过 `npx eslint src/` 配合标准 Next.js 规则执行。
- **类型**：严格类型（`tsc --noEmit`）。避免使用 `any`。共享类型集中放在 `src/shared/types/`。
- **命名规范**：
  - **文件**：React 组件使用 `PascalCase.tsx`；hooks、工具函数、API 使用 `kebab-case.ts`。
  - **实体**：变量/函数使用 `camelCase`；组件、类型、接口使用 `PascalCase`。
- **错误处理**：使用 async/await 配合 `try/catch`。React 组件应实现加载/错误状态。

---

## 架构

```
Synapse/
├── backend/
│   ├── api/                  # FastAPI 应用
│   │   ├── main.py           # 应用工厂、启动流程、共享状态初始化
│   │   ├── routes/           # 端点处理器
│   │   │   ├── conversations.py  # 对话增删改查 + SSE 流式传输
│   │   │   ├── artifacts.py      # 产物下载与预览
│   │   │   ├── skills.py         # 技能发现、安装与卸载
│   │   │   ├── skill_files.py    # 技能文件浏览（目录树 + 文件内容）
│   │   │   ├── mcp.py            # MCP 服务器管理
│   │   │   ├── auth.py           # 认证端点（用户同步、个人资料、偏好设置）
│   │   │   ├── library.py        # 资料库（按对话分组的产物）
│   │   │   └── channels.py       # Telegram 频道集成、webhook 入口
│   │   ├── channels/          # 频道集成模块
│   │   │   ├── __init__.py
│   │   │   ├── schemas.py     # 冻结 DTO（ChannelConversationRecord、ChannelSessionRecord 等）
│   │   │   ├── repository.py  # 频道账户、会话、对话的数据访问
│   │   │   ├── provider.py    # ChannelProvider 协议、TelegramProvider 实现
│   │   │   ├── responder.py   # ChannelResponder — 订阅事件、发送到 Telegram
│   │   │   └── router.py      # ChannelRouter — 处理入站消息、链接令牌
│   │   ├── auth/              # 认证中间件
│   │   │   ├── __init__.py
│   │   │   └── middleware.py  # 代理密钥验证、速率限制、NextAuth 请求头
│   │   ├── builders.py       # 工厂函数（编排器、沙箱提供者）
│   │   ├── dependencies.py   # FastAPI 依赖注入（AppState）
│   │   ├── events.py         # EventEmitter 发布/订阅系统
│   │   ├── models.py         # 请求/响应 Pydantic 模型
│   │   ├── sse.py            # SSE 流式传输工具
│   │   └── db_subscriber.py  # 将事件持久化到数据库
│   ├── agent/
│   │   ├── runtime/          # 智能体编排引擎
│   │   │   ├── orchestrator.py       # AgentOrchestrator — 单智能体 ReAct 循环
│   │   │   ├── planner.py           # PlannerOrchestrator — 任务分解
│   │   │   ├── sub_agent_manager.py # SubAgentManager — 并发智能体协调
│   │   │   ├── task_runner.py       # TaskAgentRunner — 专注子任务执行
│   │   │   ├── skill_selector.py    # 共享的 LLM 驱动技能选择器（显式 > 模型 > 关键词）
│   │   │   ├── helpers.py           # apply_response_to_state、process_tool_calls
│   │   │   └── observer.py          # 分层的上下文压缩
│   │   ├── llm/
│   │   │   └── client.py    # ClaudeClient — 异步 Anthropic SDK 封装
│   │   ├── tools/
│   │   │   ├── base.py      # LocalTool、SandboxTool 抽象
│   │   │   ├── registry.py  # ToolRegistry — 不可变工具集合
│   │   │   ├── executor.py  # ToolExecutor — 路由本地与沙箱执行
│   │   │   ├── local/       # 宿主端工具
│   │   │   │   ├── activate_skill.py   # 加载技能系统提示
│   │   │   │   ├── ask_user.py         # 提示用户输入
│   │   │   │   ├── message_user.py     # 向用户发送文本
│   │   │   │   ├── web_search.py       # Tavily 网络搜索
│   │   │   │   ├── web_fetch.py        # 获取网页内容
│   │   │   │   ├── image_gen.py        # MiniMax 图像生成
│   │   │   │   ├── memory_store.py     # 持久化键值记忆
│   │   │   │   ├── memory_recall.py    # 检索记忆
│   │   │   │   ├── memory_list.py      # 列出记忆键
│   │   │   │   └── task_complete.py    # 标记任务完成 + 发送摘要
│   │   │   ├── sandbox/     # 沙箱执行工具
│   │   │   │   ├── code_interpret.py   # Python 代码执行
│   │   │   │   ├── code_run.py         # Shell 命令执行
│   │   │   │   ├── shell_exec.py       # Shell 脚本执行
│   │   │   │   ├── browser.py          # Playwright 浏览器自动化
│   │   │   │   ├── computer_use.py     # 视觉 + 鼠标/键盘控制
│   │   │   │   ├── file_ops.py         # 文件读写/删除
│   │   │   │   ├── code_search.py      # 沙箱内文件搜索
│   │   │   │   ├── database.py         # SQL 查询执行
│   │   │   │   ├── doc_gen.py          # 文档生成
│   │   │   │   ├── doc_read.py         # 读取文档文件
│   │   │   │   ├── package_install.py  # pip/npm 包安装
│   │   │   │   └── preview.py          # HTML/图像预览
│   │   │   └── meta/        # 智能体协调工具
│   │   │       ├── plan_create.py         # 声明计划步骤（规划模式）
│   │   │       ├── spawn_task_agent.py   # 生成子智能体（带智能体名称）
│   │   │       ├── wait_for_agents.py    # 等待子智能体完成
│   │   │       └── send_message.py       # 智能体间通信
│   │   ├── sandbox/          # 执行环境提供者
│   │   │   ├── base.py              # SandboxProvider/Session 协议与类型
│   │   │   ├── boxlite_provider.py  # Boxlite 微型虚拟机后端（主要）
│   │   │   ├── e2b_provider.py      # E2B 云沙箱
│   │   │   ├── e2b_pool.py          # E2B 会话池
│   │   │   └── local_provider.py    # 本地子进程沙箱（开发/测试）
│   │   ├── skills/           # 技能系统
│   │   │   ├── models.py        # SkillMetadata、SkillContent、SkillCatalogEntry
│   │   │   ├── parser.py        # SKILL.md frontmatter 解析
│   │   │   ├── discovery.py     # SkillDiscoverer — 在目录中发现技能
│   │   │   ├── loader.py        # SkillRegistry — 不可变集合 + 匹配
│   │   │   ├── installer.py     # SkillInstaller — 从 GitHub 克隆
│   │   │   └── registry_client.py  # 外部技能注册表 API 客户端
│   │   ├── memory/           # 持久化智能体记忆
│   │   │   ├── models.py    # MemoryEntry SQLAlchemy 模型
│   │   │   └── store.py     # PersistentMemoryStore（按对话隔离）
│   │   ├── state/            # 对话持久化
│   │   │   ├── database.py      # SQLAlchemy 异步引擎/会话工厂
│   │   │   ├── models.py        # ORM 模型（Conversation、Message、Event、Artifact、AgentRun、User）
│   │   │   ├── repository.py    # ConversationRepository — 数据访问
│   │   │   └── schemas.py       # 公开 API 的 Pydantic DTO
│   │   ├── artifacts/        # 产物管理
│   │   │   ├── manager.py   # ArtifactManager — 下载/追踪沙箱文件
│   │   │   └── storage.py   # StorageBackend 抽象（local/R2）
│   │   ├── mcp/              # Model Context Protocol
│   │   │   ├── client.py    # MCPStdioClient — 基于 stdio 的通信
│   │   │   ├── bridge.py    # MCP 桥接，用于工具注册
│   │   │   └── config.py    # MCP 服务器配置
│   │   └── logging.py       # Loguru 日志配置
│   ├── config/
│   │   └── settings.py      # Pydantic Settings（加载后不可变）
│   ├── evals/                # 智能体评测系统
│   │   ├── models.py         # 冻结数据类（EvalCase、EvalResult、EvalMetrics 等）
│   │   ├── loader.py         # YAML 评测用例解析与验证
│   │   ├── collector.py      # EventEmitter 订阅者 — 采集工具调用、token 用量、错误
│   │   ├── runner.py         # EvalRunner — 连接编排器、运行用例、收集结果
│   │   ├── grader.py         # 编程式评分（tool_used、skill_activated、agent_spawned 等）
│   │   ├── llm_judge.py      # 基于 LLM 的评判评分（通过 Claude API）
│   │   ├── reporter.py       # 控制台 + JSON 报告输出
│   │   ├── mock_client.py    # ScriptedLLMClient — 确定性/快速评测
│   │   ├── __main__.py       # CLI: uv run python -m evals
│   │   └── cases/            # YAML 评测用例定义
│   ├── migrations/           # Alembic 迁移脚本
│   └── tests/                # 50+ 测试文件
├── web/
│   ├── src/
│   │   ├── app/              # Next.js App Router
│   │   │   └── (main)/      # 主布局分组
│   │   │       ├── page.tsx          # 对话页面
│   │   │       ├── channels/page.tsx # 频道对话（分割面板：列表 + 聊天）
│   │   │       ├── skills/page.tsx   # 技能浏览器
│   │   │       ├── mcp/page.tsx      # MCP 配置
│   │   │       └── library/page.tsx  # 产物资料库
│   │   │   └── login/page.tsx        # Google OAuth 登录
│   │   ├── features/
│   │   │   ├── conversation/         # 聊天界面
│   │   │   │   ├── api/              # conversation-api.ts、history-api.ts
│   │   │   │   ├── components/       # ConversationView、ChatInput、WelcomeScreen 等
│   │   │   │   └── hooks/            # use-conversation、use-pending-ask
│   │   │   ├── agent-computer/       # 智能体执行展示
│   │   │   │   ├── components/       # AgentComputerPanel、AgentProgressCard、ToolOutputRenderer
│   │   │   │   ├── hooks/            # use-agent-state
│   │   │   │   └── lib/              # format-tools、tool-constants
│   │   │   ├── channels/             # 频道集成（Telegram、未来：WhatsApp、Discord 等）
│   │   │   │   ├── api/              # channel-api.ts（列出对话、管理机器人配置、链接令牌）
│   │   │   │   ├── components/       # ChannelProviderIcon、ChannelConversationList、ChannelChatView、TelegramLinkCard
│   │   │   │   └── lib/              # 提供商颜色/标签工具函数
│   │   │   ├── skills/               # 技能浏览器与选择器
│   │   │   │   ├── api/              # skills-api.ts
│   │   │   │   ├── components/       # SkillsPage、SkillSelector、SkillCard
│   │   │   │   └── hooks/            # use-skills-cache
│   │   │   ├── mcp/                  # MCP 配置
│   │   │   │   ├── api/              # mcp-api.ts
│   │   │   │   └── components/       # MCPPage、MCPDialog、TransportToggle
│   │   │   └── library/              # 产物资料库
│   │   │       ├── api/              # library-api.ts
│   │   │       ├── components/       # LibraryPage、LibraryArtifactCard、ConversationGroup
│   │   │       └── hooks/            # use-library、use-view-mode
│   │   ├── shared/
│   │   │   ├── components/           # Sidebar、TopBar、CommandPalette、MarkdownRenderer
│   │   │   │   └── ui/              # Radix UI 组件库（30+ 组件）
│   │   │   ├── hooks/               # use-sse、use-media-query
│   │   │   ├── stores/              # app-store（Zustand）
│   │   │   ├── types/               # events.ts（AgentEvent、EventType、TaskState）
│   │   │   └── lib/                 # utils、a11y
│   │   └── i18n/                    # 国际化（en、zh-CN）
│   ├── next.config.ts               # 将 API 代理到后端
│   ├── tailwind.config.ts
│   └── package.json
├── container/                # 沙箱 Docker 镜像
│   ├── Dockerfile.default        # 标准工具（node、python、git）
│   ├── Dockerfile.data_science   # 机器学习工具（pandas、numpy、matplotlib）
│   ├── Dockerfile.browser        # Playwright + 浏览器
│   └── doc_templates/            # 文档生成模板
├── docs/                     # 文档
└── Makefile
```

---

## 数据流

```
用户消息
  │
  ▼
POST /conversations ──────────────────► 后端创建对话
  │                                     构建编排器 + 事件发射器
  │                                     返回 { conversation_id }
  │
  ▼
GET /conversations/{id}/events ───────► 打开 SSE 流
  │
  ▼
ReAct 循环（后端）
  ├─ LLM 请求（Claude API）
  │   └─ 发射: llm_request、text_delta、llm_response
  ├─ 工具执行（ToolExecutor）
  │   ├─ 本地工具 → 进程内运行
  │   └─ 沙箱工具 → 在 Boxlite 微型虚拟机中运行
  │   └─ 发射: tool_call、tool_result、sandbox_stdout/stderr
  ├─ 子智能体生成（规划模式下）
  │   └─ 发射: agent_spawn、agent_complete
  └─ 重复直到 end_turn 或达到最大迭代次数
  │
  ▼
task_complete 事件 ──────────────────► 前端渲染最终结果
                                       产物可供下载
```

---

## API 参考

### 对话

| 方法 | 路径 | 描述 |
|------|------|------|
| `POST` | `/conversations` | 创建对话。接受 JSON 或 FormData（含文件）。请求体: `message`、`files[]`、`skills[]`、`use_planner` |
| `POST` | `/conversations/{id}/messages` | 发送后续消息。请求体格式与创建相同 |
| `GET` | `/conversations/{id}/events` | `AgentEvent` 对象的 SSE 事件流 |
| `POST` | `/conversations/{id}/cancel` | 取消当前智能体轮次 |
| `POST` | `/conversations/{id}/respond` | 提交用户对 `ask_user` 提示的回复。请求体: `response` |
| `GET` | `/conversations/{id}/metrics` | 返回汇总指标：token 用量、工具调用次数、各子智能体指标 |

### 产物

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/artifacts/{id}` | 下载生成的产物文件 |
| `GET` | `/artifacts/{id}/preview` | 预览产物（HTML 在 iframe 中渲染，图像内联显示） |

### 技能

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/skills` | 列出所有可用技能（内置 + 已安装） |
| `GET` | `/skills/{name}` | 获取技能详情 |
| `GET` | `/skills/{name}/files` | 以 JSON 格式返回技能目录树 |
| `GET` | `/skills/{name}/files/{path}` | 获取单个文件的文本内容 |
| `POST` | `/skills/install` | 从 GitHub URL 安装技能。请求体: `url` |
| `DELETE` | `/skills/{name}` | 卸载技能 |

### MCP

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/mcp/servers` | 列出已连接的 MCP 服务器 |
| `POST` | `/mcp/servers` | 连接 MCP 服务器。请求体: 传输配置 |
| `DELETE` | `/mcp/servers/{name}` | 断开 MCP 服务器连接 |

### 认证

| 方法 | 路径 | 描述 |
|------|------|------|
| `POST` | `/auth/me` | Google OAuth 登录后同步用户记录 |
| `GET` | `/user/me` | 获取当前用户个人资料（包含偏好设置） |
| `PATCH` | `/user/me/preferences` | 更新主题和/或语言。请求体: `theme`、`locale` |

### 资料库

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/library` | 按对话分组列出产物。查询参数: `limit`、`offset` |

### 频道

| 方法 | 路径 | 描述 |
|------|------|------|
| `POST` | `/channels/telegram/webhook` | Telegram 机器人 webhook 入口（通过 X-Telegram-Bot-API-Secret-Token 验证） |
| `POST` | `/channels/telegram/config` | 保存/更新 Telegram 机器人令牌和 webhook 配置。请求体: `bot_token` |
| `DELETE` | `/channels/telegram/config` | 禁用 Telegram 机器人并删除 webhook |
| `POST` | `/channels/link-token` | 创建一次性链接令牌用于账户配对。请求体: `provider` |
| `GET` | `/channels/accounts` | 列出当前用户的已链接频道账户 |
| `DELETE` | `/channels/accounts/{account_id}` | 取消链接频道账户 |
| `GET` | `/channels/conversations` | 列出频道对话及最后消息预览和会话状态 |
| `GET` | `/channels/status` | 获取频道功能状态（已启用的提供商、机器人配置、账户链接） |

### SSE 事件类型

| 事件 | 描述 |
|------|------|
| `task_start` | 对话已启动 |
| `task_complete` | 智能体已完成（包含摘要） |
| `task_error` | 智能体遇到错误 |
| `turn_start` / `turn_complete` | 后续轮次生命周期 |
| `iteration_start` / `iteration_complete` | ReAct 循环迭代 |
| `llm_request` / `llm_response` | LLM API 调用 |
| `text_delta` | 来自 LLM 的流式文本片段 |
| `thinking` | 扩展思考内容 |
| `tool_call` / `tool_result` | 工具调用与结果 |
| `sandbox_stdout` / `sandbox_stderr` | 沙箱控制台输出 |
| `code_result` | 代码执行结果 |
| `message_user` | 智能体向用户发送文本 |
| `ask_user` / `user_response` | 智能体请求用户输入 |
| `agent_spawn` / `agent_complete` | 子智能体生命周期 |
| `plan_created` | 规划模式：在生成智能体之前声明步骤 |
| `artifact_created` | 新产物可用 |
| `preview_available` / `preview_stopped` | HTML/图像预览生命周期 |
| `conversation_title` | 自动生成的对话标题 |

---

## 核心模块

### 运行时引擎 (`agent/runtime/`)

运行时引擎实现了 ReAct（推理 + 行动）循环：

- **`AgentOrchestrator`** — 单智能体循环。调用 LLM、执行工具调用、发射事件，重复直到 `end_turn` 或达到最大迭代次数（50）。使用 `AgentState`（冻结数据类）实现不可变状态 — 每次变更都返回新实例。

- **`PlannerOrchestrator`** — 在 ReAct 循环基础上扩展了任务分解功能。要求智能体先调用 `plan_create` 声明步骤名称和描述，然后通过 `SubAgentManager` 生成工作智能体，并协调结果。发射 `plan_created` 事件。规划模式自动注册 `plan_create` 和 `spawn_task_agent` 工具。

- **`SubAgentManager`** — 管理并发智能体（最多 5 个并发，20 个总量）。处理依赖追踪（`depends_on`）、每个智能体的工具注册表，以及用于智能体间通信的异步消息总线。追踪智能体名称用于 UI 显示。通过 `AGENT_TIMEOUT_SECONDS`（默认 300 秒）强制执行每个智能体的超时，并以可配置的策略传播故障（取消剩余智能体、降级或重新规划）。

- **`TaskAgentRunner`** — 使用独立沙箱执行单个子任务。返回 `AgentResult`（冻结的），包含成功状态、摘要、产物以及每个智能体的指标（耗时、迭代次数、工具调用次数、token 用量）。指标在 `agent_complete` 事件中发射，并由 `GET /conversations/{id}/metrics` 接口汇总。

- **`Observer`** — 上下文压缩。通过加权启发式方法（ASCII 字符 ÷ 4，非 ASCII 字符 × 1.5 以提升 CJK 准确度）估算 token 用量，在超出预算（默认 150K token）时触发压缩。使用两层策略：**热层**保留最近 N 次工具交互的完整内容（默认 5 次），**暖层**对更早的交互采用分层降级处理 — LLM 结构化摘要（Haiku）→ 较大文本预览 → 最小标记。发射带有压缩前后消息数量的 `CONTEXT_COMPACTED` 事件。

- **`SkillSelector`** — 供 `AgentOrchestrator` 和 `TaskAgentRunner` 共用的 LLM 驱动技能选择器。实现三层优先级：（1）按名称显式选择，（2）LLM 从技能目录中选取（可通过 `SKILL_SELECTOR_MODEL` 配置），（3）关键词重叠兜底。替换了之前仅基于关键词的匹配方式。

### 工具系统 (`agent/tools/`)

- **`ToolRegistry`** — 不可变集合。`register()` 和 `merge()` 返回新实例。
- **`ToolExecutor`** — 路由执行：本地工具在进程内运行，沙箱工具获取按模板延迟创建的 `SandboxSession`。
- **`LocalTool` / `SandboxTool`** — 抽象基类。每个工具定义 `name`、`description`、`input_schema` 和一个异步 `execute()` 方法。

### 沙箱系统 (`agent/sandbox/`)

三个实现了 `SandboxSession` 协议的提供者：

| 提供者 | 使用场景 | 隔离级别 |
|--------|----------|----------|
| **Boxlite** | 生产环境 | 硬件隔离的微型虚拟机 |
| **E2B** | 云端 | 带连接池的云沙箱 |
| **Local** | 开发环境 | 子进程（无隔离） |

会话接口：`exec()`、`upload_file()`、`download_file()`、`interpret()`、`screenshot()`、`close()`

### 技能系统 (`agent/skills/`)

技能是带有 YAML frontmatter 的 SKILL.md 文件：

```yaml
---
name: data-analysis
description: Structured data analysis methodology
license: MIT
sandbox_template: data_science
allowed_tools:
  - code_run
  - database
---

## Instructions
...方法论内容...
```

- **发现** — 扫描 `~/.synapse/skills/`（内置）、`./skills/`（项目级）、`./synapse-skills/`（导入的）
- **匹配** — LLM 驱动的技能目录选择（显式名称 → LLM 选取 → 关键词重叠兜底）。可通过 `SKILL_SELECTOR_MODEL` 配置模型。
- **激活** — 最佳匹配的技能提示注入编排器；智能体被限制为允许的工具
- **安装** — 通过 `SkillInstaller` 从 GitHub 克隆

### 智能体评测系统 (`evals/`)

一套自包含的评测框架，通过订阅 `EventEmitter` 来测试智能体行为、度量质量并捕获回归。

- **YAML 评测用例** — 每个用例定义用户消息、评分标准、模拟 LLM 响应和预期行为。用例存储在 `evals/cases/` 中。

- **评分标准** — 11 种编程式评判类型：

| 标准 | 检查项 |
|------|--------|
| `tool_used` / `tool_not_used` | 是否调用了（未调用）特定工具 |
| `output_regex` / `output_contains` | 最终输出是否匹配模式或包含子串 |
| `max_iterations` / `tool_call_count` | 执行是否在限制范围内 |
| `no_errors` | 执行期间是否发生错误 |
| `skill_activated` | 是否激活了特定技能 |
| `agent_spawned` | 是否生成了子智能体（按数量、任务子串或任意） |
| `agent_handoff` | 是否发生了智能体交接（可选指定目标角色） |
| `context_compaction` | 是否触发了上下文压缩（可选指定最低次数） |

- **LLM 评判模式** — 将任务上下文、实际输出和工具调用序列发送给 Claude 进行定性评分。默认使用 Haiku 以节省成本。

- **Mock 模式** — `ScriptedLLMClient` 返回预定义的 LLM 响应，用于确定性、快速、离线评测。

- **Live 模式** — 使用真实 Claude API 测试实际智能体行为。

- **内置评测用例** — 11 个场景，覆盖网络搜索、代码执行、多工具链式调用、技能激活、子智能体生成、智能体交接以及 CJK 上下文压缩（5 个用例）。

### 状态持久化 (`agent/state/`)

基于 SQLAlchemy 异步 ORM 的六个模型：

| 模型 | 用途 |
|------|------|
| `ConversationModel` | 顶层对话记录 |
| `MessageModel` | 单条消息（用户/助手/工具） |
| `EventModel` | 用于回放的原始事件流 |
| `ArtifactModel` | 生成文件的元数据 |
| `AgentRunModel` | 子智能体执行记录 |
| `UserModel` | 用户资料（Google OAuth）及偏好设置（主题、语言） |

通过 `ConversationRepository`（仓储模式）访问。公开 API 返回冻结的 Pydantic DTO。

---

## 环境变量

在 `backend/.env` 中配置（参见 `backend/.env.example`）：

### 必需

| 变量 | 描述 |
|------|------|
| `ANTHROPIC_API_KEY` | LLM 提供者的 API 密钥（Anthropic 或任何兼容提供者） |
| `TAVILY_API_KEY` | 用于网络搜索的 Tavily API 密钥 |

### LLM 提供者

Synapse 支持任何提供 Anthropic 兼容 API 的 LLM 提供者。通过 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_API_KEY` 进行配置。

| 变量 | 默认值 | 描述 |
|------|--------|------|
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | LLM API 基础地址 — 修改此项以使用其他提供者（如 OpenRouter、Bedrock 或任何 Anthropic 兼容代理） |
| `PLANNING_MODEL` | `claude-sonnet-4-20250514` | 用于任务规划的模型 |
| `TASK_MODEL` | `claude-sonnet-4-20250514` | 用于任务执行的模型 |
| `LITE_MODEL` | `claude-haiku-4-5-20251001` | 用于简单子任务的模型 |
| `THINKING_BUDGET` | `10000` | 扩展思考的 token 预算（`0` = 禁用） |
| `COMPACT_TOKEN_BUDGET` | `150000` | 触发上下文压缩的估算 token 阈值 |
| `COMPACT_TOKEN_COUNTER` | `weighted` | Token 计数策略：`weighted`（CJK 感知）或 `legacy`（字符 ÷ 4） |
| `COMPACT_FULL_INTERACTIONS` | `5` | 热层：保留完整内容的最近交互次数 |
| `COMPACT_FALLBACK_PREVIEW_CHARS` | `500` | 分层压缩降级中文本预览的字符上限 |
| `COMPACT_FALLBACK_RESULT_CHARS` | `1000` | 分层压缩降级中结果预览的字符上限 |
| `COMPACT_SUMMARY_MODEL` | （使用 `LITE_MODEL`） | 暖层摘要使用的模型 |
| `SKILL_SELECTOR_MODEL` | （使用 `LITE_MODEL`） | LLM 驱动技能选择（第 2 层）使用的模型 |

### 可选

| 变量 | 默认值 | 描述 |
|------|--------|------|
| `DATABASE_URL` | — | PostgreSQL 连接字符串（`postgresql+asyncpg://...`） |
| `REDIS_URL` | — | 用于缓存的 Redis URL |
| `AGENT_TIMEOUT_SECONDS` | `300` | 每个子智能体的执行超时时间（秒） |
| `SANDBOX_PROVIDER` | `boxlite` | 沙盒后端：`boxlite`（GHCR 上有预构建镜像）、`e2b` 或 `local` |
| `E2B_API_KEY` | — | E2B API 密钥（使用 E2B 提供者时需要） |
| `MINIMAX_API_KEY` | — | MiniMax API 密钥（用于图像生成） |
| `STORAGE_PROVIDER` | `local` | 产物存储：`local` 或 `r2` |
| `STORAGE_DIR` | `./artifacts` | 本地产物存储目录 |
| `R2_ACCOUNT_ID` | — | Cloudflare R2 账户（使用 R2 存储时需要） |
| `R2_ACCESS_KEY_ID` | — | Cloudflare R2 访问密钥 |
| `R2_SECRET_ACCESS_KEY` | — | Cloudflare R2 密钥 |
| `R2_BUCKET_NAME` | — | Cloudflare R2 存储桶名称 |
| `SKILLS_ENABLED` | `true` | 启用技能系统 |
| `SKILLS_REGISTRY_URL` | `https://api.agentskills.io` | 外部技能注册表 URL |
| `SKILLS_TRUST_PROJECT` | `true` | 信任项目级技能 |
| `HOST` | `0.0.0.0` | 服务器绑定地址 |
| `PORT` | `8000` | 服务器端口 |
| `LOG_LEVEL` | `INFO` | 日志级别 |
| `CORS_ORIGINS` | `http://localhost:3000` | 允许的 CORS 来源 |
| `API_KEY` | — | API 认证密钥 |
| `RATE_LIMIT_PER_MINUTE` | `30` | 速率限制阈值（每 IP 每分钟） |
| `AUTH_REQUIRED` | `false` | 是否要求所有请求进行 Google 认证 |
| `PROXY_SECRET` | — | Next.js 代理与后端之间的共享密钥（生产环境必填） |
| `ENVIRONMENT` | `development` | 环境模式：`development` 或 `production` |
| `CHANNELS_ENABLED` | `false` | 启用 Telegram 频道集成 |
| `CHANNELS_WEBHOOK_BASE_URL` | — | 频道提供商的 Webhook 基础 URL（例如：`https://your-domain.com`） |
| `MEMORY_FACT_CONFIDENCE_THRESHOLD` | `0.85` | 自动保存提取记忆前所需的最小置信度 |
| `MEMORY_FACT_TOP_K` | `8` | 每轮注入提示词的活跃记忆上限 |
| `MEMORY_FACT_PROMPT_TOKEN_CAP` | `1200` | 已验证记忆提示段的字符上限 |

---

## 核心设计模式

### 不可变性

所有核心类型均为冻结数据类。变更方法返回新实例：

```python
@dataclass(frozen=True)
class AgentState:
    messages: tuple[dict, ...]
    iteration: int
    completed: bool

    def add_message(self, msg: dict) -> "AgentState":
        return AgentState(
            messages=self.messages + (msg,),
            iteration=self.iteration,
            completed=self.completed,
        )
```

适用于：`AgentState`、`ToolResult`、`ToolDefinition`、`SandboxConfig`、`SkillMetadata`、`LLMResponse`、`AgentEvent`、`TokenUsage`、`Artifact`、`EvalCase`、`EvalResult`、`EvalMetrics` 以及所有结果类型。

### 事件驱动架构

`EventEmitter`（异步发布/订阅）将智能体循环与消费者解耦：

- 向前端的 SSE 流式传输
- 通过 `db_subscriber` 持久化到数据库
- 日志记录

每个事件并发通知所有订阅者。

### 不可变注册表

`ToolRegistry` 和 `SkillRegistry` 遵循相同模式 — `register()` 和 `merge()` 返回新实例，原始实例保持不变。

### 仓储模式

`ConversationRepository` 封装了 SQLAlchemy 内部实现。公开方法返回冻结的 Pydantic DTO。内部 ORM 模型保持私有。

### 工厂函数

`api/builders.py` 包含用于创建编排器和沙箱提供者的工厂函数，简化了使用 mock 进行测试的流程，并保持路由处理器的简洁。
