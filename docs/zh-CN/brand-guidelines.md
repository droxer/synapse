[English](../brand-guidelines.md) | **简体中文**

# HiAgent 品牌指南

## 品牌定位

HiAgent 是一个智能 AI Agent 平台。品牌传达**能力感**、**温暖感**和**亲和自信**——通过暖米色为主的视觉美学，辅以有机的柔和感、充裕的留白和专业的打磨。

## 语气与风格

- **直接**：简短、自信的表达。使用"我能帮你构建什么？"而非"请描述您希望获得帮助的内容。"
- **拟人但不啰嗦**："HiAgent's Computer"是品牌专属界面名称。Agent 有存在感，但不过度亲切。
- **技术自信**：假设用户具备能力，不过度解释。

## 色彩

### 设计方向

调色板温暖且亲和，基于**石色中性色调**构建——奶油色背景、暖灰色文字以及暖紫罗兰强调色。避免使用冷灰色（zinc、slate）、纯白/纯黑背景以及冷靛蓝强调色。

### 核心色板

| Token | 深色模式 | 浅色模式 | 用途 |
|-------|---------|---------|------|
| `background` | `#1C1917` | `#FAF9F6` | 页面背景（暖色深底 / 暖奶油色） |
| `foreground` | `#EDEDED` | `#1C1917` | 主要文字 |
| `card` | `#292524` | `#FFFFFF` | 卡片表面 |
| `border` | `#44403C` | `#E8E5E0` | 默认边框（暖石色） |
| `muted-foreground` | `#A8A29E` | `#78716C` | 次要文字（stone-400 / stone-500） |

### 强调色

| Token | 深色模式 | 浅色模式 | 用途 |
|-------|---------|---------|------|
| `ai-glow` | `#8B5CF6` (Violet 500) | `#8B5CF6` | AI 活动指示器，主要品牌信号 |
| `accent-purple` | `#8B5CF6` | `#8B5CF6` | AI 强调色，工具执行 |
| `user-accent` | `#3B82F6` (Blue 500) | `#3B82F6` | 用户消息，输入焦点 |
| `accent-emerald` | `#34D399` | `#10B981` | 成功、完成 |
| `accent-amber` | `#D97706` | `#B45309` | 警告、注意 |
| `accent-rose` | `#F87171` | `#EF4444` | 错误、危险操作 |

### AI 强调色使用规范

暖紫罗兰色 `accent-purple` / `ai-glow`（`#8B5CF6`）是品牌标志色。适用于：
- 脉冲活动圆点（Agent 运行中）——通过透明度动画实现，而非发光效果
- 进度条渐变
- 活跃侧边栏指示器（实心条，无发光效果）
- AI 活动状态指示器

`ai-glow` 不适用于：
- 静态装饰元素
- 用户发起的操作
- 错误状态
- 发光/光晕 box-shadow 效果（已从设计系统中移除）

## 字体排版

### 字体栈

| 系列 | 字体 | 用途 |
|------|------|------|
| `--font-sans` | Montserrat | 正文、UI 标签、按钮——温暖的几何无衬线体 |
| `--font-serif` | Instrument Serif | 首页大标题（WelcomeScreen） |
| `--font-mono` | JetBrains Mono | 代码、终端输出、技术数值 |

### 字号规范

| Token | 大小 | Tailwind | 用途 |
|-------|------|----------|------|
| `hero` | 3.75rem | `text-6xl` | 欢迎页标题 |
| `h1` | 1.5rem | `text-2xl` | 页面标题 |
| `h2` / `heading` | 1rem | `text-base` | 板块标题 |
| `body` | 0.875rem | `text-sm` | 正文、消息 |
| `caption` | 0.75rem | `text-xs` | 标签、时间戳、元数据 |
| `micro` | 0.625rem | `text-[10px]` | 键盘快捷键、徽标 |

### 层级规则

- 首页大标题：`font-serif` + `text-6xl`
- 页面标题：`font-sans` + `text-base font-semibold`
- 板块标题：`font-sans` + `text-sm font-medium text-muted-foreground`
- 正文：`font-sans` + `text-sm`

## 间距与圆角

### 圆角

圆角设计慷慨且柔和，营造亲和感：

| 元素类型 | 圆角值 | Tailwind |
|---------|--------|----------|
| 侧边栏项、小按钮 | 8px | `rounded-md` |
| 卡片、输入框、容器 | 12px | `rounded-lg` |
| 对话框、命令面板 | 16px | `rounded-xl` |
| 胶囊、标签、芯片 | 9999px | `rounded-full` |
| 用户消息气泡（右下角） | 8px | `rounded-br-md` |

### 内边距规范

| 场景 | 内边距 | Tailwind |
|------|--------|----------|
| 页面容器 | 24px | `px-6` |
| 板块、卡片 | 16px | `px-4` |
| 紧凑元素（侧边栏项、芯片） | 12px | `px-3` |
| 行内元素 | 8px | `px-2` |

## 阴影

**暖色调阴影：** 所有阴影使用暖石色 rgba 值，绝不使用纯黑色。

| Token | 用途 |
|-------|------|
| `shadow-sm` / `shadow-card` | 卡片静止状态、内容元素 |
| `shadow-md` / `shadow-card-hover` | 卡片悬停、输入焦点 |
| `shadow-elevated` | 仅用于浮动覆盖层（模态框、命令面板、下拉菜单） |

卡片/内容层次使用细微阴影 + 边框：
- 静止态：`border border-border shadow-sm`
- 悬停态：`hover:border-border-strong hover:shadow-md`
- 焦点/激活态：`border-border-active shadow-md`

**禁止使用发光效果。** 不使用 `box-shadow: 0 0 Xpx` 光晕、不使用 `aiGlow` 关键帧动画、不使用 `orbitalPulse` 动画。

## 动画

### 原则

- 始终尊重 `prefers-reduced-motion`
- 交互元素使用弹簧物理效果
- 进入动画使用 `ease-out`，退出动画使用 `ease-in`
- 标准时长：微交互 200ms，展现动画 300ms
- 保持动画最小化和克制——界面应给人平静的感觉

### 标准动画

| 名称 | 时长 | 用途 |
|------|------|------|
| `shimmer` | 2s | 加载骨架屏占位符 |
| `fadeIn` | 0.3s | 通用元素进入 |
| `slideUp` | 0.4s | 自下而上展现 |
| `gradientShift` | 3s | 细微渐变动画 |

### 已移除的动画

以下动画已从设计系统中移除：
- `aiGlow` —— 替换为通过 framer-motion 实现的透明度脉冲
- `orbitalPulse` —— 替换为 `<PulsingDot>` 中 framer-motion 的缩放动画
- `conicSpin` —— 锥形渐变旋转边框已移除
- `meshDrift` —— 动画渐变网格背景已移除

### AI 脉冲圆点

所有 AI 活动指示器统一使用共享的 `<PulsingDot>` 组件。该组件通过 framer-motion 实现透明度脉冲和缩放动画。可用尺寸：`sm`（1.5px）和 `md`（2px）。统一使用 2s 时长以保持一致性。

## 组件

### 按钮

始终使用 `shared/components/ui/button` 中的 `<Button>` 组件，不要使用手动样式的原生 `<button>` 元素。可用变体：`default`、`destructive`、`outline`、`secondary`、`ghost`、`link`。

### 焦点环

统一所有焦点指示器：`focus-visible:ring-[3px] focus-visible:ring-ring/50`

### 触摸目标

所有交互元素必须具有最小 44px 的触摸目标（WCAG 标准）。对于小型图标按钮，使用 padding 或 `min-w`/`min-h` 来实现。触摸目标尺寸通过 `globals.css` 中的 CSS `@media (hover: none) and (pointer: coarse)` 规则强制执行。

### 卡片

所有卡片类容器使用：
- `rounded-lg`（12px 圆角）
- `border border-border`
- 静止态 `shadow-sm`
- 悬停态 `hover:border-border-strong hover:shadow-md`
- 纯色 `bg-card` 背景（不使用玻璃拟态效果）

### 输入框

- `rounded-lg` 圆角
- 纯色 `bg-card` 背景
- 焦点态：`border-border-active shadow-md`（无发光效果）
- 不使用 `backdrop-blur` 或透明效果

## Logo 与 Favicon

- 主 Logo：`public/logo.png`
- 所有 Favicon 变体（`favicon.ico`、`favicon-16.png`、`favicon-32.png`、`icon-192.png`、`icon-512.png`、`apple-touch-icon.png`）应从主 Logo 生成
- PWA manifest 颜色：`theme_color: "#1C1917"`、`background_color: "#FAF9F6"`
