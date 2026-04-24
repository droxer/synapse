[English](../DESIGN_STYLE_GUIDE.md) | **简体中文**

# Synapse 设计风格指南

> 简洁、精准、以内容为中心的 AI 界面，拥有充裕的留白和技术清晰感。

本指南定义设计原则与组件使用规范。
令牌真实数值以 `web/src/app/globals.css` 与 `docs/reference/design-system.md` 为准。

---

## 核心原则

1. **内容即界面** — UI 应尽可能隐形。去除多余装饰、厚重边框和视觉噪音，让用户数据和 AI 输出成为焦点。

2. **键盘优先导航** — 每个主要操作都可通过快捷键触达。界面应感觉像用户思维过程的自然延伸。

3. **模块化与区块化** — 系统生成的所有内容（摘要、代码片段、交互节点）都是独立区块，可复制或修改。

4. **可预测的透明度** — AI 系统容易给人"黑盒"感。UI 必须持续传达状态（例如 `Scanning documents... Extracting concepts...`）以建立用户信任。

5. **令牌驱动样式** — 所有颜色、尺寸和间距必须引用设计令牌。禁止使用硬编码的十六进制值、原始 Tailwind 调色板类名（如 `emerald-500`）或任意像素值（在令牌存在时）。此规则同样适用于 Tailwind 类名和内联 `style` 属性（包括 Framer Motion 的 `style`/`animate` 对象 — 始终使用 `var(--color-*)`）。

6. **现代与专业** — 视觉风格应当精准且富有能力感，符合 AI 开发者工具的定位。优先使用冷色 slate 中性色调、柔和圆角、细微阴影和简洁表面，避免暖色土调和花哨的发光效果。

---

## 色彩系统

### 设计理念

调色板基于**冷色技术中性色**构建，并叠加**蓝色交互层**与克制的 AI 紫色信号。该策略在保持专业感的同时，确保主操作与状态反馈清晰可辨。

### 核心调色板（亮色模式 — 默认）

| 令牌 | Hex | 用途 |
|------|-----|------|
| `background` | `#FFFFFF` | 页面画布 — 纯白色 |
| `foreground` | `#000000` | 主文字 — 深色墨水 |
| `primary` | `#2563EB` | 操作按钮、交互填充 |
| `primary-foreground` | `#F8FAFC` | 主色表面上的文字 |
| `secondary` | `#EEF4FF` | 冷色辅助表面、支持性区域 |
| `secondary-foreground` | `#102244` | 次色表面上的文字 |
| `muted` | `#F4F7FB` | 非活跃/低强调背景 |
| `muted-foreground` | `#71717A` | 次要文字、提示、时间戳 |
| `muted-foreground-dim` | `#94A3B8` | 三级文字，符合 WCAG AA 对比度（替代 `/60` 和 `/40` 透明度修饰符） |
| `card` | `#FFFFFF` | 卡片/抬升表面（冷色背景上的白色形成自然对比） |
| `card-foreground` | `#0F172A` | 卡片上的文字 |
| `popover` | `#FFFFFF` | 下拉菜单/弹出框背景 |
| `popover-foreground` | `#0F172A` | 弹出框中的文字 |
| `destructive` | `#DE1135` | 错误状态、删除操作 |

### 核心调色板（暗色模式）

| 令牌 | Hex | 用途 |
|------|-----|------|
| `background` | `#101114` | 页面画布 — 深锌色（极致极简的开发者工具风格） |
| `foreground` | `#FFFFFF` | 主文字 — 清晰纯白 |
| `primary` | `#5B8CFF` | 操作按钮、交互填充 |
| `primary-foreground` | `#081120` | 主色表面上的文字 |
| `secondary` | `#172033` | 冷色辅助表面 |
| `secondary-foreground` | `#E6EEFF` | 次色表面上的文字 |
| `muted` | `#1A1D27` | 非活跃/禁用背景 |
| `muted-foreground` | `#B1B9C7` | 次要文字 (slate-400) |
| `muted-foreground-dim` | `#64748B` | 三级文字，符合 WCAG 3:1 对比度（替代 `/60` 和 `/40` 透明度修饰符） |
| `card` | `#181A1E` | 卡片/抬升表面 |
| `card-foreground` | `#FFFFFF` | 卡片上的文字 |
| `popover` | `#181A1E` | 下拉菜单/弹出框背景 |
| `popover-foreground` | `#FFFFFF` | 弹出框中的文字 |
| `destructive` | `#DE5B5D` | 错误状态、删除操作 |

### 边框

| 令牌 | 亮色 | 暗色 | 用途 |
|------|------|------|------|
| `border` | `#E4E6EB` | `#2A2D33` | 默认边框、分隔线（1px，扁平纯色） |
| `border-strong` | `#C7CEDA` | `#3A404B` | 强调边框 |
| `border-active` | `#7F8A9B` | `#6F7A8D` | 聚焦状态、活跃输入框边框 |
| `input` | `#E4E6EB` | `#2A2D33` | 输入框边框 |

### 强调色与语义色

仅少量用于状态指示器和语义表达，切勿作为主导表面颜色。

| 令牌 | Hex（亮色 / 暗色） | 语义 |
|------|-----|------|
| `user-accent` | `#000000` / `#DEDEDE` | 用户消息强调色 |
| `accent-emerald` | `#0E8345` / `#5C9D70` | 成功、运行中、进度 |
| `accent-amber` | `#9F6402` / `#AE8523` | 警告、思考中 |
| `accent-rose` | `#DE1135` / `#DE5B5D` | 错误、失败 |
| `color-focus` | `#3B82F6` / `#7AA2FF` | 规范化交互蓝色令牌 |
| `accent-purple` | `#6366F1` / `#8B8FFF` | AI 专用信号色 |
| `ai-glow` | `#6366F1` / `#8B8FFF` | AI 活跃状态提示色 |

### 侧边栏

| 令牌 | 亮色 | 暗色 |
|------|------|------|
| `sidebar-bg` | `#F8FAFD` | `#12151B` |
| `sidebar-active` | `#E6EEFF` | `#1D2840` |
| `sidebar-hover` | `#F1F5FF` | `#162033` |

`sidebar-bg` 与 `background`（`#FFFFFF` / `#09090B`）刻意保持差异，以创造侧边栏与主内容区域之间可见的层次分离。导航项必须使用 `bg-sidebar-active`（而非 `bg-secondary`）表示活跃状态，使用 `hover:bg-sidebar-hover`（而非 `hover:bg-secondary`）表示悬停状态 — 在侧边栏中使用通用的 secondary 令牌会导致亮色模式下对比度几乎不可见。

### 终端面板（深色面板）

| 令牌 | 亮色 | 暗色 | 用途 |
|------|------|------|------|
| `terminal-bg` | `#F8FAFC` | `#0F1117` | 面板背景 |
| `terminal-surface` | `#F1F5F9` | `#1A1D27` | 面板内的抬升表面 |
| `terminal-border` | `#E4E6EB` | `#2A2D33` | 面板边框 |
| `terminal-text` | `#252A33` | `#E3E8F1` | 终端主文字 |
| `terminal-dim` | `#717C8E` | `#8D96A5` | 终端中的弱化图标、次要文字 |

### 令牌规则

- **始终使用语义令牌** — 禁止使用原始 Tailwind 调色板类名如 `text-emerald-500`。应使用 `text-accent-emerald`。
- **Framer Motion `style`/`animate` 属性** — 始终使用 `var(--color-*)` CSS 自定义属性引用，禁止硬编码 hex/rgba 值。示例：`background: "linear-gradient(90deg, var(--color-accent-purple), var(--color-accent-emerald))"`。
- **破坏性表面上的文字** — 使用 `text-primary-foreground`，而非 `text-white`。
- **细微分隔线** — 使用 `bg-border/40`，而非 `bg-white/[0.04]`（在亮色模式下不可见）。
- **行内代码背景** — 使用 `bg-muted` 或依赖 `.markdown-body` CSS 规则。禁止使用 `bg-black/5`（在暗色模式下失效）。
- **使用冷色 slate 中性色** — 全面使用 slate 系灰色。禁止使用暖 stone/sand/琥珀色调灰色令牌。
- **禁止透明度修饰的边框** — 使用 `border-border`（默认）、`border-border-strong`（悬停）或 `border-border-active`（聚焦）。禁止使用 `border-border/60`、`bg-border/60` 或其他边框透明度修饰符。
- **禁止透明度修饰的文字对比度** — 使用 `text-muted-foreground-dim` 替代 `text-muted-foreground/60` 或 `text-muted-foreground/40`。dim 令牌可确保 WCAG AA 对比度。
- **Iframe 隔离内容** — 对于 iframe 内的 HTML 内容（如文档预览），使用带后备值的 CSS 自定义属性：`color: var(--color-foreground, #0f172a)`。
- **品牌例外（允许）** — 在渠道提供商身份识别 UI（如 Telegram/Discord/Slack 图标或徽章）中，可为识别度使用官方品牌色。此类颜色必须仅限于提供商身份组件，不能作为通用产品语义色复用。
- **隔离预览例外（允许）** — 无法继承应用 CSS 变量的嵌入式预览文档可使用本地后备色。后备色必须映射到语义令牌意图，并在 `globals.css` 令牌更新时同步维护。

---

## 字体排版

### 字体栈

| 角色 | 字体 | 变量 | 回退字体 | 使用范围 |
|------|------|------|----------|----------|
| 正文 (sans) | Geist Sans | `--font-geist-sans` | Noto Sans SC/TC, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Arial, sans-serif | 所有正文文本、UI 装饰、标签、标题、面板标题，包括 WelcomeScreen 主视觉。通过 `next/font/local` 以内置资源加载，确保渲染稳定。 |
| 中日韩 (sans) | Noto Sans SC / Noto Sans TC | `--font-noto-sans-sc`, `--font-noto-sans-tc` | PingFang SC/TC, Microsoft YaHei/JhengHei, Noto Sans CJK SC/TC, sans-serif | 简体中文和繁体中文文本。以内置本地字体资源加载，以实现跨平台一致渲染。 |
| 代码 (mono) | Geist Mono | `--font-geist-mono` | ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace | 代码块、原始数据、终端日志、键盘快捷键标签 |

### 字号比例

| 名称 | 大小 | CSS 令牌 | Tailwind | 行高 | 用途 |
|------|------|----------|----------|------|------|
| 2xl（页面标题） | `1.5rem` (24px) | `--text-2xl` | `text-2xl` | `--lh-tight` (1.2) | 页面/画布标题 |
| xl（卡片标题） | `1.25rem` (20px) | `--text-xl` | `text-xl` | `--lh-tight` (1.2) | 卡片标题 |
| lg | `1.125rem` (18px) | `--text-lg` | `text-lg` | `--lh-normal` (1.5) | 大号正文 |
| base（段落标题） | `1rem` (16px) | `--text-base` | `text-base` | `--lh-normal` (1.5) | 段落标题（半粗、柔和色调） |
| sm（正文） | `0.875rem` (14px) | `--text-sm` | `text-sm` | `--lh-normal` (1.5) | 聊天消息、UI 文字、按钮标签 |
| xs（注释） | `0.75rem` (12px) | `--text-xs` | `text-xs` | `--lh-normal` (1.5) | 时间戳、元数据、提示（柔和颜色） |
| Micro | `0.625rem` (10px) | `--font-size-micro` | `text-micro` | 1.4 | 行内徽章、`<kbd>` 标签、细则 |

### 行高

| 令牌 | 值 | 用途 |
|------|------|------|
| `--lh-tight` | 1.2 | 标题、题目 |
| `--lh-normal` | 1.5 | 正文文字、UI 标签 |
| `--lh-relaxed` | 1.625 | 长文内容、Markdown 散文 |

**禁止使用任意尺寸。** 不得使用 `text-[11px]`、`text-[13px]`、`text-[0.8125rem]`、`text-[15px]` 或 `text-[0.9375rem]`。若所需值不在此表中，请选择最接近的比例令牌。

**注意：** `text-[10px]` 可接受，因为它对应 Micro 尺寸（`--font-size-micro: 0.625rem`），但优先使用 `text-micro` 工具类（如果可用）。

### 字重与字距

- 标题：**Semi-Bold (600)**，字距 `-1%` 至 `-2%`。禁止在标题中使用 `font-bold` (700)。
- 正文：Regular (400)
- 交互元素：Medium (500)
- 等宽字体用于：代码、原始数据、终端/处理日志、键盘快捷键标签
- 终端/处理日志文字应使用注释尺寸（`text-xs`，12px）以增加信息密度

### 代码元素默认值

`pre` 和 `code` 元素的基础样式：

```css
pre, code {
  font-family: var(--font-mono);   /* Geist Mono → 系统等宽字体回退 */
  font-size: var(--text-sm);       /* 14px — 禁止使用 0.8125rem 或 13px */
  line-height: var(--lh-relaxed);  /* 1.625 */
}
```

### 渲染

```css
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
text-rendering: optimizeLegibility;
```

字体文件位于 `web/src/app/font-assets/`，由 `web/src/app/fonts.ts` 加载，并通过 Git LFS 跟踪。

---

## 阴影

阴影策略已调整为**边框优先、整体扁平**。优先通过边框强度与背景变化表达层级，而非悬浮抬升感。

### 亮色模式

| 名称 | 值 | 用途 |
|------|------|------|
| `shadow-card` | `0 0 0 1px color-mix(in srgb, var(--color-border), transparent 35%)` | 表面静止分层 |
| `shadow-card-hover` | `0 0 0 1px color-mix(in srgb, var(--color-border-strong), transparent 20%)` | 悬停时边框增强 |
| `shadow-elevated` | `0 0 0 1px color-mix(in srgb, var(--color-border-strong), transparent 18%), 0 12px 30px rgba(0, 0, 0, 0.08)` | 浮层（模态/命令面板） |

### 暗色模式

暗色模式下的阴影更多依赖边框对比度（通过 `#09090B` 背景上的 `#27272A` 边框改善）而非重阴影。

| 名称 | 值 | 用途 |
|------|------|------|
| `shadow-card` | `0 0 0 1px color-mix(in srgb, var(--color-border), transparent 25%)` | 表面静止分层 |
| `shadow-card-hover` | `0 0 0 1px color-mix(in srgb, var(--color-border-strong), transparent 10%)` | 悬停时边框增强 |
| `shadow-elevated` | `0 0 0 1px color-mix(in srgb, var(--color-border-strong), transparent 6%), 0 16px 36px rgba(0, 0, 0, 0.45)` | 浮层 |

### 阴影使用方式

**卡片和内容元素** 默认应保持扁平：
- 静止：`border border-border`
- 悬停：`hover:border-border-strong hover:bg-muted/40`
- 活跃/聚焦：`border-border-active` + 聚焦环

**浮动覆盖层**（模态框、命令面板、下拉菜单）使用 `shadow-elevated`。

**输入框和表单控件** 静止时使用扁平边框，聚焦时使用统一聚焦环（不使用阴影抬升）。

### 聚焦环

```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
```

使用带 offset 的 2px 聚焦环，视觉更接近编辑器风格。

**必须** 在每个交互元素上添加：按钮、链接、输入框、标签页、侧边栏项、工具栏操作，以及任何带 `onClick` 的元素。这包括自定义交互元素 — 不仅限于基础 UI 原语。

---

## 核心 UI 组件

### 命令面板 (Cmd+K / Ctrl+K)

应用程序的中枢神经系统。也可通过顶栏搜索触发器访问。

- **视觉效果**：浮动、屏幕居中的模态框，带模糊背景遮罩
- **行为**：即时聚焦搜索栏。下方显示：快捷 AI 操作、导航（技能、MCP、新任务）、最近对话（来自应用存储，限制 5 条）和设置
- **样式**：`bg-card border border-border rounded-lg shadow-elevated` — 纯色背景，对话框本身不使用毛玻璃效果。背景遮罩使用 `backdrop-blur-sm`。
- **动画**：仅透明度淡入淡出（0.12s） — 进入/退出时无缩放或位移
- **选中项**：仅使用 `bg-secondary` 高亮 — 无 `border-l` 强调
- **快捷键**：在项目右侧使用 `<kbd>` 元素显示键盘提示（`⌘N`、`ESC`）
- **全局快捷键**：`Cmd+N` / `Ctrl+N` 创建新任务（导航到首页）

### 聊天消息

**用户消息**：右对齐气泡卡片。使用 `bg-card border border-border rounded-md`。最大宽度 80%。

**助手消息**：左对齐，纯文本配合 Markdown 渲染。无气泡、无边框 — `text-sm leading-[1.5] text-foreground`。最大宽度 85%。AI 标识："HIAGENT" 标签使用 `text-xs font-medium tracking-wide text-accent-purple/70 uppercase`。操作按钮（复制、重试）使用悬停显示模式：`opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150`。

**AI 活跃状态**：AI 处理中优先使用中性样式（`bg-muted border-border`），仅在强语义状态（成功/错误/警告）中使用高饱和颜色。

### 交互数据区块

当 AI 生成结构化内容时，渲染为独立区块：
- 1px 细微边框（`border-border`）配合扁平表面样式
- 微弱背景填充（`bg-card`）
- 悬停状态在右上角显示工具图标（复制、编辑、删除、重新生成）

### 处理日志（终端风格）

对于复杂任务，以注释尺寸（`text-xs font-mono`）显示**可折叠**的等宽终端风格日志：
```
[✓] Ingesting document...
[✓] Chunking text into chapters...
[⟳] Generating contextual flashcards...
```

日志区域必须有折叠/展开控件（箭头标题）。折叠时可隐藏已完成的条目。

---

## 动效与状态

### 时间

专业开发者工具使用近乎即时的过渡。除连续循环外，任何动画不应超过 200ms。

| 速度 | 时长 | 用途 |
|------|------|------|
| 即时 | `100ms – 120ms` | 内容进入动画、消息出现、网格交错项 |
| 快速 | `150ms – 200ms` | 微交互、悬停状态、展开/折叠 |
| 慢速 | `1.5s – 3s` | 连续循环（脉冲、微光） |

### 加载状态

- **禁止使用传统旋转加载器**（`Loader2` + `animate-spin` 被禁止）
- 使用快速从左到右的微光渐变覆盖在文本块骨架上（使用 globals.css 中的 `--animate-shimmer`）
- 文字流式传输：逐字符
- 加载期间的阶段标签应使用 `text-accent-purple/70`，而非 `text-muted-foreground`

### 核心模式

1. **淡入 + 上滑**：`initial={{ opacity: 0, y: 4 }}` → `animate={{ opacity: 1, y: 0 }}`，`duration: 0.12`
2. **子元素交错**：`staggerChildren: 0.02, delayChildren: 0` — 快速、近乎即时的网格填充
3. **展开/折叠**：`duration: 0.15, ease: "easeOut"` — UI 装饰不使用弹簧物理
4. **悬停强调**：卡片通过 `hover:border-border-strong hover:bg-muted/40` 表达状态，避免阴影抬升
5. **透明度脉冲（状态指示器）**：使用 CSS `@keyframes` 实现脉冲圆点（globals.css 中的 `pulsingDotFade`、`pulsingDotRing`）。简单连续循环优先使用 CSS 动画而非 framer-motion。

### 反模式

- **禁止对内容元素使用 `scale`** — 消息、卡片、状态指示器、圆点、进入动画。缩放仅用于按钮。包括圆点上的 `scale: [1, 1.4, 1]` 脉冲和进入动画中的 `scale: 0.98` — 应使用透明度 + translateY 代替。
- **禁止发光效果** — `box-shadow: 0 0 Xpx` 光晕、`aiGlow` 关键帧、`orbitalPulse` 动画和锥形渐变旋转边框均被禁止。使用细微阴影抬升和透明度脉冲代替。
- **禁止渐变网格背景** — 移除动态多重渐变背景（`meshDrift`）。最多使用单一细微径向渐变。
- **禁止毛玻璃效果** — 在输入框、卡片、状态徽章和对话框上使用 `backdrop-blur-sm bg-card/80` 被禁止。应使用纯色 `bg-card` 或 `bg-secondary`。`backdrop-blur-sm` **仅**允许用于模态框遮罩背景（对话框后方的暗化层）。
- **禁止多余的进入动画** — 动效仅用于状态变化。禁止在静态标题文字上使用装饰性 `filter: blur()`。
- **尊重 `prefers-reduced-motion`** — 用 `<MotionConfig reducedMotion="user">` 包裹应用（Framer Motion）。globals.css 中的 CSS `prefers-reduced-motion` 媒体查询不会影响 JS 驱动的 Framer Motion 动画。

### 减弱动效

在应用根部添加此 provider，使所有 Framer Motion 动画尊重操作系统的无障碍设置：

```tsx
import { MotionConfig } from "framer-motion";

<MotionConfig reducedMotion="user">
  {children}
</MotionConfig>
```

---

## 布局

### 主布局

- 左侧：对话区域（有面板时 50%，无面板时 100%）
- 右侧：Agent Computer 面板（50%，从右侧滑入）

### 侧边栏

- 展开：`w-64`（256px）— 默认宽度必须为 256px，而非 280px
- 折叠：`w-12`（48px）
- 背景：`bg-sidebar-bg` 令牌 — 与 `bg-background` 刻意保持差异以创造层次分离
- 右侧边框：`border-r border-border`（纯色，无透明度修饰符）
- 内部间距：展开时 `px-4`，折叠时 `px-2` — 所有区域（头部、搜索、任务列表）保持一致
- 导航项间距：`gap-2`（图标 + 标签）— 而非 `gap-2.5`
- 活跃指示器：中性指示条 `bg-border-strong`（3px 宽 × 16px 高：`w-[3px] h-4`），绝对定位于 `left-0`
- 活跃项背景：`bg-sidebar-active` — 而非 `bg-secondary`
- 悬停项背景：`hover:bg-sidebar-hover` — 而非 `hover:bg-secondary`
- 导航图标：纯色 `h-4 w-4` Lucide 图标 — 不使用彩色气泡容器（详见图标章节）

### 任务输入

WelcomeScreen 通过 `ChatInput` 的 `variant="welcome"` 渲染 — 单一组件拥有两种视觉模式。这消除了之前 WelcomeScreen 拥有自己的 textarea（不支持拖放或粘贴）的重复问题。

- **共享行为**：拖放、粘贴图片、文件附件、技能选择器、键盘提示
- **`variant="default"`**：单行自动扩展 textarea，外层间距 `shrink-0 px-4 pb-4 pt-2`
- **`variant="welcome"`**：三行 textarea，无外层间距（父级管理布局），启用 autoFocus，隐藏键盘提示
- 边框圆角：`rounded-lg`
- 背景：纯色 `bg-card`（无毛玻璃效果，无 `backdrop-blur`）
- 聚焦：`border-border-active` + `shadow-md`（无发光效果，无 `box-shadow: 0 0 20px`）
- 阴影：默认不使用；通过边框和聚焦环表达状态
- Textarea 水平间距：`px-4`

### 顶栏

顶栏（`h-14`）左侧显示面包屑导航，右侧显示命令面板触发器：
- **左侧**：首页按钮、任务面包屑（含步骤计数）、连接状态圆点
- **右侧**：搜索触发按钮（`Search...` + `⌘K` 提示）— 派发 `Cmd+K` 打开命令面板
- **背景**：纯色 `bg-background` — 无模糊或透明
- Props：`taskState`、`isConnected`、`currentIteration`、`onNavigateHome`、`taskTitle`

### Agent Computer 面板状态栏

Agent Computer 面板底部的单一整合状态栏：
- 进度条 + 状态指示器 (PulsingDot/CircleCheck/CircleX) + 标签 + 计数
- 替代之前的三层方案（进度条 + 实时圆点 + 任务摘要页脚）

### 边框圆角

| 令牌 | 值 | Tailwind | 用途 |
|------|------|----------|------|
| `--radius-sm` | 4px | `rounded-sm` | 小型药丸标签、行内代码 |
| `--radius-md` | 6px | `rounded-md` | 侧边栏项、小按钮、发送/取消按钮 |
| `--radius-lg` | 8px | `rounded-lg` | 卡片、输入框、容器、对话框、聊天输入 |
| `--radius-xl` | 12px | `rounded-xl` | 大型面板和抬升表面 |

### 滚动条

宽度始终为 **4px** — 包括 Radix `ScrollArea` 组件（使用 `w-[4px]`，而非默认的 `w-2.5`）。

```css
/* 亮色模式 */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: rgba(120, 113, 108, 0.2);
  border-radius: 9999px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(120, 113, 108, 0.35);
}

/* 暗色模式 */
.dark ::-webkit-scrollbar-thumb {
  background: rgba(214, 211, 209, 0.1);
}
.dark ::-webkit-scrollbar-thumb:hover {
  background: rgba(214, 211, 209, 0.2);
}
```

---

## 图标

### 图标库

Lucide React (`lucide-react`)

### 尺寸

| 类名 | 像素 | 场景 |
|------|------|------|
| `h-3 w-3` | 12px | 微型行内装饰（徽章内部、状态圆点） |
| `h-3.5 w-3.5` | 14px | 紧凑工具栏 chip、行内文字图标 |
| `h-4 w-4` | 16px | **标准** — 侧边栏导航、顶栏、按钮、菜单 |
| `h-5 w-5` | 20px | 状态指示器、突出独立图标 |

`h-4 w-4` 为默认尺寸。仅在紧凑 chip/badge 场景中使用 `h-3.5 w-3.5`。导航栏和工具栏中禁止使用 `h-3 w-3`。

### 颜色状态

| 状态 | 类名 |
|------|------|
| 默认 | `text-muted-foreground` |
| 悬停 | `hover:text-foreground` |
| 活跃（强调色） | `text-accent-purple`、`text-accent-emerald` 等 — 按区域使用 |
| 活跃（中性） | `text-foreground` |
| 成功 | `text-accent-emerald` |
| 错误 | `text-accent-rose` |
| AI 活跃 | `text-accent-purple` |

### 侧边栏导航图标

在导航链接中直接使用 `h-4 w-4` 的纯色 Lucide 图标 — **不使用彩色气泡容器**。活跃项上的彩色强调条（`w-[3px] h-4 bg-[color]`，绝对定位于 `left-0`）提供区域标识，无需装饰性图标背景。

```tsx
// 正确
<Radio className={cn(
  "h-4 w-4 shrink-0 transition-colors duration-200",
  isActive ? "text-[#2AABEE]" : "text-muted-foreground group-hover:text-foreground",
)} />

// 错误 — 删除纯图标，添加彩色气泡
<span className="flex h-5 w-5 items-center justify-center rounded-md bg-[#2AABEE]/10 text-[#2AABEE]">
  <Radio className="h-3 w-3" />
</span>
```

---

## 无障碍

### 聚焦环

每个交互元素都必须包含：
```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
```

包括：按钮（含图标按钮）、侧边栏项、标签页按钮、工具栏操作，以及任何带 `onClick` 的元素。来自 `@radix-ui` 的基础 UI 原语已包含此样式 — 自定义交互元素必须显式添加。

### 语义化 HTML

- 交互控件使用原生 `<button>` 元素。禁止使用 `<span role="button">` 或 `<div onClick>`。
- 类标签页界面必须使用 `role="tablist"`、`role="tab"` 和 `aria-selected`。
- 仅通过颜色传达含义的状态指示器（圆点、徽章）必须添加 `aria-label` 或 `title`。

### 悬停显示控件

任何使用 `opacity-0 group-hover:opacity-100` 在悬停时显示操作的模式，必须同时包含 `group-focus-within:opacity-100`，以便键盘用户也能发现这些操作。

### RWD 检查清单

- **断点策略**：移动端优先；仅在信息密度需要时使用 `sm/md/lg`。
- **宽度约束**：优先流式宽度（`w-full`、`max-w-*`），固定像素宽度仅用于明确受限的弹窗/面板。
- **触控目标**：粗指针设备最小 44x44（已由 `globals.css` 的 coarse-pointer 媒体查询兜底）。
- **溢出韧性**：长文件名/ID 必须 `truncate` 并提供 `title` 等回退。
- **分栏布局**：小屏下应堆叠布局，避免在 `lg` 以下强依赖 50/50 分栏。

### 无障碍复查清单

- 交互控件优先使用原生 button/link；重构时避免 `role="button"` 包装器。
- 所有可交互元素必须具备可见键盘焦点（遵循上方聚焦环规范）。
- 悬停显隐控件必须同步支持键盘焦点显隐（`group-focus-within`）。
- 颜色传递语义必须辅以图标或文字（`aria-label`、`title` 或可见文本）。
- 尊重 reduced motion（`MotionConfig reducedMotion="user"` + CSS `prefers-reduced-motion`）。

### 错误页面

`global-error.tsx` 组件渲染独立的 `<html>/<body>` 树。它必须：
1. 导入并注入字体 CSS 变量（`geist.variable`、`inter.variable`、`geistMono.variable`、`jetbrainsMono.variable`、`notoSansSC.variable`、`notoSansTC.variable`）
2. 使用设计令牌（`bg-background`、`text-foreground` 等）— 禁止硬编码十六进制值

---

## 依赖

| 包 | 用途 |
|------|------|
| `framer-motion` | 动画 |
| `lucide-react` | 图标 |
| `cmdk` | 命令面板 |
| `@radix-ui/*` | 无障碍 UI 原语 |
| `class-variance-authority` | 组件变体 |
| `tailwindcss` | 工具类 CSS |
| `react-markdown` | Markdown 渲染 |
| `rehype-highlight` | 代码语法高亮 |

---

## 工具函数：`cn()`

所有条件性类名合并使用来自 `@/shared/lib/utils` 的 `cn()`。

---

## 常见陷阱

以下模式曾在代码库中发现，必须避免：

| 陷阱 | 正确做法 |
|------|----------|
| `text-[11px]`、`text-[13px]`、`text-[15px]` | 使用 `text-xs` (12px)、`text-sm` (14px) 或 `text-[10px]` (Micro) |
| `text-emerald-500`、`border-l-violet-500` | 使用 `text-accent-emerald`、`border-l-accent-purple` |
| `bg-white/[0.04]`、`bg-black/5` | 使用 `bg-border/40`、`bg-muted` |
| `text-white` 用于彩色背景 | 使用 `text-primary-foreground` |
| `font-bold` 用于标题 | 使用 `font-semibold` (600) |
| `font-serif` 用于任何 UI 元素 | 未加载衬线字体 — 全部使用 `font-sans` |
| `scale: [1, 1.4, 1]` 用于圆点/图标 | 使用 `opacity: [0.4, 1, 0.4]` |
| `shadow-[0_0_6px_var(--color-ai-glow)]` | 移除发光 — 使用边框强调或不使用 |
| `backdrop-blur-sm bg-card/80` 用于输入框 | 使用纯色 `bg-card` |
| `box-shadow: 0 0 20px var(--color-input-glow)` | 聚焦时使用 `shadow-md` |
| `background: #FFFFFF` / `#0A0A0A` | 使用 `#F8FAFC`（冷白色）/ `#0F1117`（深墨色） |
| 硬编码 `#818CF8` / `#8B5CF6` 紫色 | 通过 `accent-purple` / `ai-glow` 别名使用 `var(--color-focus)` |
| `border-radius: 0–2px`（锐利） | 卡片使用 `rounded-lg` (6px)，项目使用 `rounded-md` (4px) |
| `animation: conicSpin`、`aiGlow`、`orbitalPulse` | 已移除 — 使用 CSS `@keyframes` 透明度脉冲 |
| `animation: meshDrift` 用于背景 | 已移除 — 使用静态径向渐变 |
| `<Loader2 className="animate-spin">` | 使用微光骨架屏 |
| `<span role="button" onClick>` | 使用原生 `<button>` |
| `opacity-0 group-hover:opacity-100`（单独使用） | 添加 `group-focus-within:opacity-100` |
| `style={{ background: "#818CF8" }}` | 使用 `var(--color-accent-purple)` |
| 暖灰色令牌（stone、sand、琥珀色调） | 使用冷色 slate 系中性色 |
| `Montserrat` 字体引用 | 使用 `Geist Sans`（`--font-geist-sans`） |
| `text-muted-foreground/60`、`/40` | 使用 `text-muted-foreground-dim`（WCAG AA） |
| `border-border/60`、`bg-border/60` | 使用 `border-border`（无透明度修饰符） |
| `backdrop-blur-sm` 用于 UI 元素 | 移除 — 仅使用纯色背景 |
| `border-[var(--color-border-active)]` | 使用 `border-border-active`（Tailwind 令牌） |
| `scale: 0.98` 用于进入动画 | 移除缩放 — 仅使用 `opacity` + `y` |
| 独立的 WelcomeScreen textarea | 使用 `ChatInput variant="welcome"` |
| framer-motion 用于简单 CSS 循环 | 使用 CSS `@keyframes`（如 PulsingDot） |
| `text-amber-500`、`text-indigo-400` | 使用 `text-accent-amber`、`text-accent-purple` |
| `border-red-200 bg-red-50` | 使用 `border-destructive/20 bg-destructive/5` |
| `rounded-full` 用于操作按钮 | 使用 `rounded-md` — 圆形按钮偏消费类应用风格 |
| `rounded-xl` 用于对话框/卡片 | 使用 `rounded-lg` (6px) — `rounded-xl` 为保留值 |
| `bg-background/80 backdrop-blur-sm` 用于顶栏 | 使用纯色 `bg-background` |
| `backdrop-blur-sm` 用于页面头部（ChannelPageHeader 等） | 移除 — 所有导航栏使用纯色 `bg-background` |
| `staggerChildren: 0.06` 或更高 | 使用最大 `0.02` — 网格项应近乎即时出现 |
| `duration: 0.25` 用于内容进入 | 使用 `0.12` — 内容动画应近乎即时 |
| Spring 物理用于 UI 装饰 | 使用 `duration + ease` — 弹簧仅用于拖拽/物理交互 |
| 逐词交错文字展示 | 整体标题单次淡入 — 逐词效果过于消费类应用风格 |
| 侧边栏导航中使用 `hover:bg-secondary` | 使用 `hover:bg-sidebar-hover` — 亮色模式下 `bg-secondary` 与 `sidebar-bg` 几乎不可见 |
| 侧边栏活跃状态使用 `bg-secondary` | 使用 `bg-sidebar-active` — 侧边栏有独立的令牌层级 |
| 侧边栏导航彩色图标气泡（`<span className="bg-[color]/10">`） | 使用纯色 `h-4 w-4` 图标，配合 `text-muted-foreground` → 活跃时 `text-[color]` |
| 侧边栏导航或顶栏中使用 `h-3 w-3` 图标 | 使用 `h-4 w-4` — 12px 图标仅用于徽章内部的行内装饰 |
| 侧边栏或顶栏中使用 `border-border/50` | 使用 `border-border`（纯色）— 透明度边框显得模糊 |
