[English](../brand-guidelines.md) | **简体中文**

# Synapse 品牌指南

> 产品 UI 说明：实时应用色彩系统由 `docs/DESIGN_STYLE_GUIDE.md` 和 `docs/reference/design-system.md` 定义。本文件记录品牌层，并必须与应用 token 契约保持一致。

## 品牌定位

Synapse 是一个智能 AI Agent 平台。品牌传达**能力感**、**清晰感**和**技术自信**——通过精确的产品表面、克制的界面外壳、锐利的分隔和沉稳的开发者工具气质来表达。

## 语气与风格

- **直接**：简短、自信的表达。使用"我能帮你构建什么？"而非"请描述您希望获得帮助的内容。"
- **拟人但不啰嗦**："Synapse's Computer"是品牌专属界面名称。Agent 有存在感，但不过度亲切。
- **技术自信**：假设用户具备能力，不过度解释。

## 色彩

### 设计方向

产品调色板基于**冷色技术中性色**，辅以蓝色操作层和克制的 AI 信号。使用 `web/src/app/globals.css` 中的语义 token；避免暖 stone/sand 中性色、装饰性渐变和硬编码色板颜色。

### 核心色板

| Token | 深色模式 | 浅色模式 | 用途 |
|-------|---------|---------|------|
| `background` | `#101114` | `#FFFFFF` | 应用画布 |
| `foreground` | `#FFFFFF` | `#000000` | 主要文字 |
| `card` | `#181A1E` | `#FFFFFF` | 卡片和面板表面 |
| `border` | `#2A2D33` | `#E4E6EB` | 默认边框与分隔线 |
| `muted-foreground` | `#B1B9C7` | `#5B6573` | 次要文字 |

### 强调色

| Token | 深色模式 | 浅色模式 | 用途 |
|-------|---------|---------|------|
| `primary` | `#5B8CFF` | `#2563EB` | 主要 CTA 和操作填充 |
| `accent-purple` | `#8B8FFF` | `#6366F1` | 仅用于 AI 信号 |
| `accent-emerald` | `#5C9D70` | `#0E8345` | 成功、完成 |
| `accent-amber` | `#AE8523` | `#9F6402` | 警告、注意 |
| `accent-rose` | `#DE5B5D` | `#DE1135` | 错误、危险操作 |

### AI 强调色使用规范

AI 信号应克制，且从属于主要操作色。`accent-purple` / `ai-glow` 仅适用于：
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
| `--font-sans` | Geist Sans + Noto Sans SC/TC | 正文、UI 标签、按钮、标题 |
| `--font-brand-family` | Geist Sans | 产品字标处理 |
| `--font-mono` | Geist Mono | 代码、终端输出、技术数值 |

### 字号规范

| Token | 大小 | Tailwind | 用途 |
|-------|------|----------|------|
| `h1` | 1.5rem | `text-2xl` | 页面标题 |
| `h2` / `heading` | 1rem | `text-base` | 板块标题 |
| `body` | 0.875rem | `text-sm` | 正文、消息 |
| `caption` | 0.75rem | `text-xs` | 标签、时间戳、元数据 |
| `micro` | 0.625rem | `text-micro` | 键盘快捷键、徽标 |

### 层级规则

- 页面标题：`font-sans` + `text-base font-semibold`
- 板块标题：`font-sans` + `text-sm font-medium text-muted-foreground`
- 正文：`font-sans` + `text-sm`

## 间距与圆角

### 圆角

圆角锐利且紧凑：

| 元素类型 | 圆角值 | Tailwind |
|---------|--------|----------|
| 微型指示器 | 2px | `rounded-sm` |
| 按钮、芯片、徽标 | 4px | `rounded-md` |
| 输入框和标准控件 | 6px | `rounded-lg` |
| 面板和浮层 | 8px | `rounded-xl` |
| 特殊大型表面 | 10px | `rounded-2xl` |

### 内边距规范

| 场景 | 内边距 | Tailwind |
|------|--------|----------|
| 页面容器 | 24px | `px-6` |
| 板块、卡片 | 16px | `px-4` |
| 紧凑元素（侧边栏项、芯片） | 12px | `px-3` |
| 行内元素 | 8px | `px-2` |

## 阴影

阴影应保持最小化，并以边框表达层级。仅在需要明确浮层堆叠时使用阴影。

| Token | 用途 |
|-------|------|
| `shadow-sm` / `shadow-card` | 卡片静止状态、内容元素 |
| `shadow-md` / `shadow-card-hover` | 少量悬停强调，通过接近边框的分隔表达 |
| `shadow-elevated` | 仅用于浮动覆盖层（模态框、命令面板、下拉菜单） |

卡片/内容层次使用细微阴影 + 边框：
- 静止态：`border border-border`
- 悬停态：`hover:border-border-strong`
- 焦点/激活态：`border-border-active` 加标准焦点环

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

统一所有焦点指示器：`focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background`

### 触摸目标

所有交互元素必须具有最小 44px 的触摸目标（WCAG 标准）。对于小型图标按钮，使用 padding 或 `min-w`/`min-h` 来实现。触摸目标尺寸通过 `globals.css` 中的 CSS `@media (hover: none) and (pointer: coarse)` 规则强制执行。

### 卡片

所有卡片类容器使用：
- 面板使用 `rounded-xl`（8px 圆角），更紧凑的控件使用 `rounded-lg`（6px）
- `border border-border`
- 无默认阴影
- 悬停态 `hover:border-border-strong`
- 纯色 `bg-card` 背景（不使用玻璃拟态效果）

### 输入框

- `rounded-lg`（6px）圆角
- 纯色 `bg-card` 背景
- 焦点态：标准焦点环加激活边框（无发光效果）
- 不使用 `backdrop-blur` 或透明效果

## Logo 与 Favicon

- 主 Logo 资源：`web/public/logo.svg`、`web/public/logo.png`
- Favicon 变体：
  - `web/public/favicon-light.svg`、`web/public/favicon-dark.svg`
  - `web/public/favicon-16.png`、`web/public/favicon-32.png`、`web/public/favicon.ico`
  - `web/public/apple-touch-icon.png`、`web/public/apple-touch-icon-dark.png`
  - `web/public/icon-192.png`、`web/public/icon-512.png`
- PWA manifest 颜色：`theme_color: "#0A0A0A"`、`background_color: "#FFFFFF"`
