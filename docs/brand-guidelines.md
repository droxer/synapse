**English** | [简体中文](zh-CN/brand-guidelines.md)

# Synapse Brand Guidelines

> Product UI note: the live application color system is defined by `docs/DESIGN_STYLE_GUIDE.md` and `docs/reference/design-system.md`. This file remains brand and voice reference and should not override the app token contract.

## Brand Identity

Synapse is an intelligent AI agent platform. The brand communicates **capability**, **warmth**, and **approachable confidence** through a warm cream-first aesthetic with organic softness, generous whitespace, and professional polish.

## Voice & Tone

- **Direct**: Short, confident statements. "What can I help you build?" not "Please describe what you'd like assistance with."
- **Anthropomorphic but not chatty**: "Synapse's Computer" is a branded surface name. The agent has presence but isn't overly friendly.
- **Technical confidence**: Assume the user is capable. Don't over-explain.

## Colors

### Design Direction

The palette is warm and approachable, built on **stone neutrals** — cream backgrounds, warm gray text, and a warm violet accent. Avoid cold grays (zinc, slate), pure white/black backgrounds, and cold indigo accents.

### Core Palette

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `background` | `#1C1917` | `#FAF9F6` | Page background (warm dark / warm cream) |
| `foreground` | `#EDEDED` | `#1C1917` | Primary text |
| `card` | `#292524` | `#FFFFFF` | Card surfaces |
| `border` | `#44403C` | `#E8E5E0` | Default borders (warm stone) |
| `muted-foreground` | `#A8A29E` | `#78716C` | Secondary text (stone-400 / stone-500) |

### Accent Colors

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `ai-glow` | `#8B5CF6` (Violet 500) | `#8B5CF6` | AI activity indicator, primary brand signal |
| `accent-purple` | `#8B5CF6` | `#8B5CF6` | AI accent, tool execution |
| `user-accent` | `#3B82F6` (Blue 500) | `#3B82F6` | User messages, input focus |
| `accent-emerald` | `#34D399` | `#10B981` | Success, completion |
| `accent-amber` | `#D97706` | `#B45309` | Warnings, caution |
| `accent-rose` | `#F87171` | `#EF4444` | Errors, destructive actions |

### AI Accent Usage

The warm violet `accent-purple` / `ai-glow` (`#8B5CF6`) is the signature brand color. Use it for:
- Pulsing activity dots (agent running) — via opacity animation, not glow
- Progress bar gradients
- Active sidebar indicators (solid bar, no glow)
- Status indicators for AI activity

Do NOT use `ai-glow` for:
- Static decorative elements
- User-initiated actions
- Error states
- Glow/halo box-shadow effects (removed from design system)

## Typography

### Font Stack

| Family | Font | Usage |
|--------|------|-------|
| `--font-sans` | Montserrat | Body text, UI labels, buttons — warm geometric sans |
| `--font-serif` | Instrument Serif | Hero headings (WelcomeScreen) |
| `--font-mono` | JetBrains Mono | Code, terminal output, technical values |

### Type Scale

| Token | Size | Tailwind | Usage |
|-------|------|----------|-------|
| `hero` | 3.75rem | `text-6xl` | Welcome screen heading |
| `h1` | 1.5rem | `text-2xl` | Page titles |
| `h2` / `heading` | 1rem | `text-base` | Section headers |
| `body` | 0.875rem | `text-sm` | Body text, messages |
| `caption` | 0.75rem | `text-xs` | Labels, timestamps, metadata |
| `micro` | 0.625rem | `text-[10px]` | Keyboard shortcuts, badges |

### Hierarchy Rules

- Hero pages: `font-serif` + `text-6xl`
- Page titles: `font-sans` + `text-base font-semibold`
- Section headers: `font-sans` + `text-sm font-medium text-muted-foreground`
- Body: `font-sans` + `text-sm`

## Spacing & Radius

### Border Radius

Radii are generous and soft, creating an approachable feel:

| Element Type | Radius | Tailwind |
|-------------|--------|----------|
| Sidebar items, small buttons | 8px | `rounded-md` |
| Cards, inputs, containers | 12px | `rounded-lg` |
| Dialogs, command palette | 16px | `rounded-xl` |
| Pills, tags, chips | 9999px | `rounded-full` |
| User message bubble (bottom-right) | 8px | `rounded-br-md` |

### Padding Convention

| Context | Padding | Tailwind |
|---------|---------|----------|
| Page containers | 24px | `px-6` |
| Sections, cards | 16px | `px-4` |
| Compact elements (sidebar items, chips) | 12px | `px-3` |
| Inline elements | 8px | `px-2` |

## Shadows

**Warm shadows:** All shadows use warm stone rgba values, never pure black.

| Token | Usage |
|-------|-------|
| `shadow-sm` / `shadow-card` | Card resting state, content elements |
| `shadow-md` / `shadow-card-hover` | Card hover, input focus |
| `shadow-elevated` | Floating overlays ONLY (modals, command palette, dropdowns) |

Card/content depth uses subtle shadow + border:
- Rest: `border border-border shadow-sm`
- Hover: `hover:border-border-strong hover:shadow-md`
- Focus/active: `border-border-active shadow-md`

**Glow effects are prohibited.** No `box-shadow: 0 0 Xpx` halos, no `aiGlow` keyframes, no `orbitalPulse` animations.

## Animations

### Principles

- Always respect `prefers-reduced-motion`
- Use spring physics for interactive elements
- Use `ease-out` for enter animations, `ease-in` for exits
- Standard duration: 200ms for micro-interactions, 300ms for reveals
- Keep animations minimal and restrained — the interface should feel calm

### Standard Animations

| Name | Duration | Usage |
|------|----------|-------|
| `shimmer` | 2s | Loading skeleton placeholders |
| `fadeIn` | 0.3s | General element entry |
| `slideUp` | 0.4s | Bottom-up reveal |
| `gradientShift` | 3s | Subtle gradient animation |

### Removed Animations

The following have been removed from the design system:
- `aiGlow` — replaced by opacity pulse via framer-motion
- `orbitalPulse` — replaced by framer-motion scale animation in `<PulsingDot>`
- `conicSpin` — conic-gradient spinning borders removed
- `meshDrift` — animated gradient mesh backgrounds removed

### AI Pulsing Dot

Use the shared `<PulsingDot>` component for all AI activity indicators. Uses framer-motion for both opacity pulse and scale animation. Available sizes: `sm` (1.5px) and `md` (2px). Always use 2s duration for consistency.

## Components

### Buttons

Always use the `<Button>` component from `shared/components/ui/button`. Never use raw `<button>` elements with manual styling. Available variants: `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`.

### Focus Rings

Standardize all focus indicators: `focus-visible:ring-[3px] focus-visible:ring-ring/50`

### Touch Targets

All interactive elements must have a minimum 44px touch target (WCAG). Use padding or `min-w`/`min-h` to achieve this for small icon buttons. Touch target sizing is enforced via CSS `@media (hover: none) and (pointer: coarse)` rules in `globals.css`.

### Cards

All card-like containers use:
- `rounded-lg` (12px radius)
- `border border-border`
- `shadow-sm` at rest
- `hover:border-border-strong hover:shadow-md` on hover
- Solid `bg-card` background (no glassmorphism)

### Inputs

- `rounded-lg` border radius
- Solid `bg-card` background
- Focus: `border-border-active shadow-md` (no glow)
- No `backdrop-blur` or transparency

## Logo & Favicon

- Master logo: `public/logo.png`
- Favicon variants:
  - `web/public/favicon-light.svg`, `web/public/favicon-dark.svg`
  - `web/public/favicon-16.png`, `web/public/favicon-32.png`, `web/public/favicon.ico`
  - `web/public/apple-touch-icon.png`, `web/public/apple-touch-icon-dark.png`
  - `web/public/icon-192.png`, `web/public/icon-512.png`
- PWA manifest colors: `theme_color: "#0A0A0A"`, `background_color: "#FFFFFF"`
- Monochrome lockups, clear space, and misuse rules: `docs/logo-monochrome-spec.md`
