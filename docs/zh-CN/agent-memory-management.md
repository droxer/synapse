[English](../agent-memory-management.md) | **简体中文** · [文档索引](../README.md)

# Synapse 智能体内存管理

本文说明 Synapse 在广义上如何处理**内存**：哪些内容留在 LLM 上下文窗口中、哪些持久化到数据库，以及在一次运行、断线重连和通道（如 Telegram）流程中这些部分如何协作。

## 概念模型：三个相关子系统

| 层级 | 作用 | 主要位置 |
| --- | --- | --- |
| **工作上下文** | 当前轮次的消息、工具 I/O 与系统提示 | 进程内 `AgentState.messages` + 组装的 system prompt |
| **上下文压缩** | 通过摘要或截断将估算 token 控制在预算内 | `agent/context/compaction.py`（`Observer`）+ `agent/context/profiles.py` |
| **持久化内存** | 用户可跨会话读写的长期数据 | 经 `PersistentMemoryStore`（`agent/memory/store.py`）访问 PostgreSQL/SQLite |

此外，**已验证事实**（`memory_facts`）是独立于 KV 的结构化存储，在**通道**场景中用于检索增强的提示片段以及可选的后台抽取。

---

## 1. 持久化键值内存（`memory_entries`）

### 行为

- **`PersistentMemoryStore`**（`agent/memory/store.py`）为面向智能体的 **memory_store**、**memory_search**（recall）、**memory_list** 工具提供后端（`agent/tools/local/memory_*.py`）。
- 条目按**已认证用户**（`user_id`）划分作用域。每行可选的 `conversation_id` 仅作**来源标注**；列表与搜索**不会**按会话过滤——用户在其所有对话中看到的是同一批数据。
- 若无认证用户，`is_available` 为 false，工具在可行时会退回到进程内内存行为。

### 系统提示注入

在会话开始（以及从数据库重建会话）时，后端通过 `load_all()` 加载最多 100 条近期条目，并在 `api/builders.py` 的 `build_agent_system_prompt()` 中追加 `<personal_memory>` 段落。智能体被告知可用 `memory_store` 更新记忆。

### HTTP API

- **`GET /api/memory`** — 分页浏览（`api/routes/memory.py`）。
- 同一路由下支持按条目删除。

### 数据库结构

在 `agent/memory/models.py` 中定义为 `MemoryEntry`（表 `memory_entries`）。迁移自 `005_add_memory_entries_table.py` 起，后续增加了 `user_id` 与外键约束。

---

## 2. 已验证事实（`memory_facts`）

这是与 `memory_entries` **分离**的表，面向带**置信度**、状态（`active` / `stale`）与来源元数据的**结构化事实**。

### 允许的命名空间与校验

`agent/memory/facts.py` 约定：

- 自动写入接受的**命名空间**：`profile`、`preferences`、`constraints`、`decisions`。
- **拒绝规则**：置信度过低、键/值为空、疑似**敏感信息**（如 password、API key 等模式）、以及**瞬时**表述（如 “today”、“right now”）。
- **`normalize_fact_key`**：规范化键名并加上命名空间前缀。

### 事实如何写入

1. **通道（Telegram 等）** — 处理通道消息后，流水线可执行事实抽取并 `upsert_fact`（见 `api/routes/channels.py`）。按轮次幂等依赖 `MemoryFactIngestion`（`mark_fact_ingestion_seen`），避免同一服务商消息被处理两次。
2. **压缩前的启发式刷盘（可选）** — 若启用 `COMPACT_MEMORY_FLUSH`，编排器在压缩**之前**调用 `flush_heuristic_facts_from_messages()`（`agent/memory/compaction_flush.py`）。它对**用户**消息正文运行 `extract_fact_candidates()`（`agent/memory/heuristic_extract.py`）——当前为基于规则（如 “timezone is …”、“I prefer …”、“my language is …”）——并对通过校验的候选执行 upsert。

### 事实如何使用

- 在通道轮次中，`retrieve_relevant_facts()` 用入站消息文本（子串匹配）检索活跃事实，再由 `format_verified_facts_prompt_section()` 追加有上限的 `<verified_user_facts>` 块（`MEMORY_FACT_TOP_K`、`MEMORY_FACT_PROMPT_TOKEN_CAP`）。

`memory_entries` 的提示注入与 `memory_facts` 段落**相互独立**；通道场景可同时使用 `load_all()` 的个人记忆与针对当前消息的事实检索。

---

## 3. 上下文压缩（`Observer`）

**文件：** `agent/context/compaction.py`、`agent/context/profiles.py`

### 何时触发

- **`should_compact`**：当对 `json.dumps(messages)` 与系统提示的**快速启发式** token 估算超过 **`COMPACT_TOKEN_BUDGET`** 时为 true。
- **Token 估算策略**：`COMPACT_TOKEN_COUNTER` — `weighted`（CJK 感知）或 `legacy`（约 chars/4）。

### 做了什么

压缩返回**新的**消息元组，**从不**原地修改输入。

1. 尽可能保留**首条用户消息**（原始任务）原文。
2. **工具密集线程**：近期工具交互对完整保留（**热层**）；更旧区间经小型 LLM 调用摘要（**温层**，`COMPACT_SUMMARY_MODEL` 或 `LITE_MODEL`），失败则对工具结果做结构化截断（`COMPACT_FALLBACK_PREVIEW_CHARS`、`COMPACT_FALLBACK_RESULT_CHARS`）。
3. **纯对话**（例如无 tool 块的 DB 回放）：更旧轮次摘要为以 `## Earlier conversation` 或 `## Previous work` 开头的合成 assistant 消息；若摘要不可用则按 `COMPACT_DIALOGUE_FALLBACK_CHARS` 截断。

### 运行时 profile

压缩算法本身在所有运行时之间共享，但策略输入现在通过 `agent/context/profiles.py` 中的运行时 profile 解析。

- `web_conversation` — 默认 Web / SSE 会话
- `channel_conversation` — Telegram 等通道会话
- `planner` — 规划模式
- `task_agent` — 子智能体

每个 profile 解析同一组参数：token 预算、token 估算策略、热层大小、回退截断长度、摘要模型、滚动 `context_summary` 上限、重建尾部消息数，以及压缩前的 memory flush 开关。

解析顺序为：

1. 先使用全局 `COMPACT_*` 默认值。
2. 若存在运行时覆盖项，例如 `COMPACT_CHANNEL_TOKEN_BUDGET` 或 `COMPACT_TASK_AGENT_DIALOGUE_FALLBACK_CHARS`，则覆盖对应字段。
3. 若 profile 未显式配置摘要模型，则运行时回退到 `LITE_MODEL`。

### 调用位置

- **`AgentOrchestrator`** — 主 ReAct 循环（`agent/runtime/orchestrator.py`）。当 `COMPACT_MEMORY_FLUSH` 为 true 且存在 `PersistentMemoryStore` 时，可在压缩前执行**启发式事实刷盘**。
- **`TaskRunner`** — 子智能体（`agent/runtime/task_runner.py`）。
- **`Planner`** — 规划模式（`agent/runtime/planner.py`）。
- **`_reconstruct_conversation`** — SSE 客户端重连且会话已从内存淘汰时（`api/routes/conversations.py`）：重建的消息在编排器运行前可能再次压缩，并使用所属运行时的 compaction profile。

### 事件与指标

- 每次压缩发出 **`CONTEXT_COMPACTED`**，在存在对话式摘要时元数据含 `summary_text`（`compaction_summary_for_persistence()`），并带上 `summary_scope` 与 `compaction_profile`。
- 子智能体运行指标中含 **`context_compaction_count`**。

---

## 4. 会话上的滚动 `context_summary`

**字段：** `conversations.context_summary`（迁移 `020_add_conversation_context_summary.py`）

### 持久化路径

当 DB 订阅者处理 **`CONTEXT_COMPACTED`**（`api/db_subscriber.py`）时，若存在 `summary_text` 且 `summary_scope` 属于顶层会话，则调用 **`merge_conversation_context_summary`**：用 `---` 分隔符追加新片段，再按对应 profile 的滚动上限保留尾部字符数（默认 `COMPACT_CONTEXT_SUMMARY_MAX_CHARS`，也可被如 `COMPACT_PLANNER_CONTEXT_SUMMARY_MAX_CHARS` 这样的覆盖项替换）。

### 重连 / 冷启动

从数据库重建（`api/routes/conversations.py` 中的 `_reconstruct_conversation`）时：

- 若 `context_summary` 非空，仅从 `messages` 加载**profile 对应的尾部消息数**，而非全量历史（默认 `COMPACT_RECONSTRUCT_TAIL_MESSAGES`，也可被如 `COMPACT_CHANNEL_RECONSTRUCT_TAIL_MESSAGES` 这样的覆盖项替换）。
- 在开头插入一条合成 assistant 消息：`## Earlier sessions (compressed)` + 已存储的摘要。

这样模型获得**压缩后的早期主干** + **近期原文消息**，无需重载整条线程。

---

## 5. 配置参考

全局 `COMPACT_*` 变量是所有运行时 profile 的兼容性基线。可选的运行时覆盖变量使用 `COMPACT_<PROFILE>_*` 形式，其中 `<PROFILE>` 为 `WEB`、`CHANNEL`、`PLANNER` 或 `TASK_AGENT`。

| 变量 | 作用 |
| --- | --- |
| `COMPACT_TOKEN_BUDGET` | 超过该估算 token 即触发压缩 |
| `COMPACT_TOKEN_COUNTER` | `weighted` 或 `legacy` 估算器 |
| `COMPACT_FULL_INTERACTIONS` | 工具交互热层规模 |
| `COMPACT_FULL_DIALOGUE_TURNS` | 对话式线程热层规模 |
| `COMPACT_SUMMARY_MODEL` | 温层摘要模型（默认：`LITE_MODEL`） |
| `COMPACT_FALLBACK_PREVIEW_CHARS` / `COMPACT_FALLBACK_RESULT_CHARS` | 工具结果回退截断 |
| `COMPACT_DIALOGUE_FALLBACK_CHARS` | 摘要器不可用时的对话回退 |
| `COMPACT_CONTEXT_SUMMARY_MAX_CHARS` | `context_summary` 滚动最大长度 |
| `COMPACT_RECONSTRUCT_TAIL_MESSAGES` | 存在 `context_summary` 时加载的近期 DB 消息条数 |
| `COMPACT_MEMORY_FLUSH` | 为 true 时在编排器压缩前对用户文本做启发式事实抽取 |
| `MEMORY_FACT_CONFIDENCE_THRESHOLD` | 接受事实候选的最低置信度 |
| `MEMORY_FACT_TOP_K` | 单条通道消息注入的事实条数上限 |
| `MEMORY_FACT_PROMPT_TOKEN_CAP` | 已验证事实提示段的字符上限 |

运行时覆盖变量示例：

- `COMPACT_CHANNEL_TOKEN_BUDGET`
- `COMPACT_CHANNEL_RECONSTRUCT_TAIL_MESSAGES`
- `COMPACT_PLANNER_FULL_INTERACTIONS`
- `COMPACT_TASK_AGENT_DIALOGUE_FALLBACK_CHARS`
- `COMPACT_WEB_SUMMARY_MODEL`

环境默认值在 `backend/config/settings.py`；环境变量名见 `backend/.env.example`。

---

## 6. 文件地图

| 模块 | 路径 |
| --- | --- |
| KV 存储 API | `agent/memory/store.py` |
| ORM 模型 | `agent/memory/models.py` |
| 事实校验 | `agent/memory/facts.py` |
| 启发式抽取 | `agent/memory/heuristic_extract.py` |
| 压缩前刷盘 | `agent/memory/compaction_flush.py` |
| 压缩逻辑 | `agent/context/compaction.py` |
| 压缩 profile | `agent/context/profiles.py` |
| 编排器集成 | `agent/runtime/orchestrator.py` |
| 系统提示与事实格式化 | `api/builders.py` |
| 摘要 DB 合并 | `agent/state/repository.py` → `merge_conversation_context_summary` |
| 事件持久化 | `api/db_subscriber.py` |
| 重建与内存加载 | `api/routes/conversations.py` |
| 通道事实检索 / 抽取 | `api/routes/channels.py` |
| Memory HTTP API | `api/routes/memory.py` |

---

## 7. 运维说明

- **匿名会话**：持久化内存需要用户 id；未认证部署下，KV 记忆与事实无法以相同方式经 `PersistentMemoryStore` 持久化。
- **压缩用 token 为启发式**：用于判断「是否该压缩」，不是计费级 token 统计。
- **事实 vs KV 记忆**：用**工具**做显式、由智能体控制的笔记（`memory_entries`）；**事实**面向带置信度与过时语义的、常见由通道驱动的档案/偏好类数据。

Telegram 侧长期记忆压缩的更多设计背景见 `docs/superpowers/specs/2026-04-02-telegram-long-term-memory-compression-design.md`。
