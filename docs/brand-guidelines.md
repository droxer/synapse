**English** | [简体中文](zh-CN/brand-guidelines.md)

# Synapse Brand Guidelines

> Product UI note: the live application color system is defined by `docs/DESIGN_STYLE_GUIDE.md` and `docs/reference/design-system.md`. This file records the brand layer and must stay aligned with the app token contract.

## Brand Identity

Synapse is an intelligent AI agent platform. The brand communicates **capability**, **clarity**, and **technical confidence** through precise product surfaces, restrained chrome, sharp separation, and a calm developer-tool tone.

## Voice & Tone

- **Direct**: Short, confident statements. "What can I help you build?" not "Please describe what you'd like assistance with."
- **Anthropomorphic but not chatty**: "Synapse's Computer" is a branded surface name. The agent has presence but isn't overly friendly.
- **Technical confidence**: Assume the user is capable. Don't over-explain.

## Colors

### Design Direction

The product palette is built on **cool technical neutrals** with a blue action layer and a restrained AI signal. Use semantic tokens from `web/src/app/globals.css`; avoid warm stone/sand neutrals, decorative gradients, and hardcoded palette colors.

### Core Palette

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `background` | `#101114` | `#FFFFFF` | App canvas |
| `foreground` | `#FFFFFF` | `#000000` | Primary text |
| `card` | `#181A1E` | `#FFFFFF` | Card and panel surfaces |
| `border` | `#2A2D33` | `#E4E6EB` | Default borders and dividers |
| `muted-foreground` | `#B1B9C7` | `#5B6573` | Secondary text |

### Accent Colors

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `primary` | `#5B8CFF` | `#2563EB` | Primary CTA and action fill |
| `accent-purple` | `#8B8FFF` | `#6366F1` | AI-only signal |
| `accent-emerald` | `#5C9D70` | `#0E8345` | Success, completion |
| `accent-amber` | `#AE8523` | `#9F6402` | Warnings, caution |
| `accent-rose` | `#DE5B5D` | `#DE1135` | Errors, destructive actions |

### AI Accent Usage

The AI signal is restrained and secondary to the primary action color. Use `accent-purple` / `ai-glow` only for:
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
| `--font-sans` | Geist Sans + Noto Sans SC/TC | Body text, UI labels, buttons, headings |
| `--font-brand-family` | Geist Sans | Product wordmark treatment |
| `--font-mono` | Geist Mono | Code, terminal output, technical values |

### Type Scale

| Token | Size | Tailwind | Usage |
|-------|------|----------|-------|
| `h1` | 1.5rem | `text-2xl` | Page titles |
| `h2` / `heading` | 1rem | `text-base` | Section headers |
| `body` | 0.875rem | `text-sm` | Body text, messages |
| `caption` | 0.75rem | `text-xs` | Labels, timestamps, metadata |
| `micro` | 0.625rem | `text-micro` | Keyboard shortcuts, badges |

### Hierarchy Rules

- Page titles: `font-sans` + `text-base font-semibold`
- Section headers: `font-sans` + `text-sm font-medium text-muted-foreground`
- Body: `font-sans` + `text-sm`

## Spacing & Radius

### Border Radius

Radii are sharp and compact:

| Element Type | Radius | Tailwind |
|-------------|--------|----------|
| Tiny indicators | 2px | `rounded-sm` |
| Buttons, chips, badges | 4px | `rounded-md` |
| Inputs and standard controls | 6px | `rounded-lg` |
| Panels and overlays | 8px | `rounded-xl` |
| Exceptional large surfaces | 10px | `rounded-2xl` |

### Padding Convention

| Context | Padding | Tailwind |
|---------|---------|----------|
| Page containers | 24px | `px-6` |
| Sections, cards | 16px | `px-4` |
| Compact elements (sidebar items, chips) | 12px | `px-3` |
| Inline elements | 8px | `px-2` |

## Shadows

Shadows are minimal and border-led. Use shadows only where they clarify overlay stacking.

| Token | Usage |
|-------|-------|
| `shadow-sm` / `shadow-card` | Card resting state, content elements |
| `shadow-md` / `shadow-card-hover` | Rare hover emphasis through border-like separation |
| `shadow-elevated` | Floating overlays ONLY (modals, command palette, dropdowns) |

Card/content depth uses subtle shadow + border:
- Rest: `border border-border`
- Hover: `hover:border-border-strong`
- Focus/active: `border-border-active` plus the standard focus ring

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

Standardize focus indicators: `focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background`

### Touch Targets

All interactive elements must have a minimum 44px touch target (WCAG). Use padding or `min-w`/`min-h` to achieve this for small icon buttons. Touch target sizing is enforced via CSS `@media (hover: none) and (pointer: coarse)` rules in `globals.css`.

### Cards

All card-like containers use:
- `rounded-xl` (8px radius) for panels, or `rounded-lg` (6px) for tighter controls
- `border border-border`
- no default shadow
- `hover:border-border-strong` on hover
- Solid `bg-card` background (no glassmorphism)

### Inputs

- `rounded-lg` (6px) border radius
- Solid `bg-card` background
- Focus: canonical focus ring plus active border (no glow)
- No `backdrop-blur` or transparency

## Logo & Favicon

- Master logo assets: `web/public/logo.svg`, `web/public/logo.png`
- Favicon variants:
  - `web/public/favicon-light.svg`, `web/public/favicon-dark.svg`
  - `web/public/favicon-16.png`, `web/public/favicon-32.png`, `web/public/favicon.ico`
  - `web/public/apple-touch-icon.png`, `web/public/apple-touch-icon-dark.png`
  - `web/public/icon-192.png`, `web/public/icon-512.png`
- PWA manifest colors: `theme_color: "#0A0A0A"`, `background_color: "#FFFFFF"`
- Monochrome lockups, clear space, and misuse rules: `docs/logo-monochrome-spec.md`
