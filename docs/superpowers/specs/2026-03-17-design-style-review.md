# Design Style Review — Synapse Frontend

> **Date:** 2026-03-17
> **Scope:** Consistency audit + quality/polish critique
> **Reviewed against:** `docs/DESIGN_STYLE_GUIDE.md`
> **Method:** 5 parallel specialist reviewers (Color & Token, Typography, Layout & Spacing, Animation & Motion, Component Polish)

---

## Executive Summary

The design system is well-architected: a comprehensive token system in `globals.css`, proper light/dark mode via CSS custom properties, and a clear style guide. However, **61 findings** across 5 review domains reveal three systemic issues that drive most violations:

1. **Token gaps** — Missing type scale tokens (H1/H2) force developers into arbitrary pixel values
2. **Framer Motion blind spot** — `style`/`animate` props bypass Tailwind's token abstraction
3. **Accessibility gaps** — No systematic focus ring enforcement or ARIA role coverage

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| HIGH | ~18 |
| MEDIUM | ~25 |
| LOW | ~16 |

---

## Critical Issues

### CR-1: Spinner violates "never use spinning wheels" rule

**File:** `AssistantLoadingSkeleton.tsx:56`
**Issue:** `<Loader2 className="h-4 w-4 animate-spin">` — the design guide explicitly prohibits spinning wheels for loading. Must use shimmer skeleton.
**Fix:** Replace with shimmer gradient skeleton using the existing `--animate-shimmer` keyframe.

### CR-2: User message bubble contradicts spec

**File:** `ConversationWorkspace.tsx:160–165`
**Issue:** Guide says user messages should be `"> User query"` — bold text prefix, no bubble, no border, no shadow. Implementation renders a right-aligned bubble card with `bg-[var(--color-user-accent-dim)]` and border.
**Fix:** Either align implementation to spec (remove bubble) or update the style guide to document the bubble as an intentional product decision.

---

## High Issues

### Color & Token (5 findings)

| ID | File | Issue | Fix |
|----|------|-------|-----|
| CT-H1 | `AgentProgressCard.tsx:191` | Hardcoded `#818CF8`, `#7C3AED` in progress gradient | Use `var(--color-ai-glow)`, `var(--color-accent-purple)` |
| CT-H2 | `StreamingCursor.tsx:10–19` | All gradient/shadow values are raw hex/rgba | Use `var(--color-*)` references |
| CT-H3 | `WelcomeScreen.tsx:75–77` | Hardcoded rgba in background mesh | Use `var(--color-ai-surface)` and `color-mix()` |
| CT-H4 | `ChatInput.tsx:114` | Magic `#fff` in conic-gradient mask | Use `white` keyword or extract to CSS class |
| CT-H5 | `ToolOutputRenderer.tsx:33–38,176` | Raw Tailwind palette (`emerald-500`, `violet-500`, etc.) | Replace with `accent-*` tokens |

### Typography (5 findings)

| ID | File | Issue | Fix |
|----|------|-------|-----|
| TY-H1 | `WelcomeScreen.tsx:90` | H1 at 44–52px, `font-normal` | Align to 24px `font-semibold` or document hero variant |
| TY-H2 | `ConversationWorkspace.tsx:162` | User msg `text-[15px]` — off-scale | Use `text-sm` (14px) |
| TY-H3 | `ConversationWorkspace.tsx:212` | Assistant msg `leading-[1.7]` — spec says 1.5 | Use `leading-[1.5]` |
| TY-H4 | `Sidebar.tsx:119` | Brand "Synapse" uses `font-bold` (700) | Use `font-semibold` (600) |
| TY-H5 | `global-error.tsx:11–23` | Missing font variables + hardcoded hex colors | Import fonts, use token classes |

### Layout & Spacing (4 findings)

| ID | File | Issue | Fix |
|----|------|-------|-----|
| LS-H1 | `Sidebar.tsx:49` | Default width 280px vs spec 256px (`w-64`) | Change to `width = 256` |
| LS-H2 | `Sidebar.tsx:101–106` | Mixed inline style vs Tailwind class for collapsed/expanded | Unify approach |
| LS-H3 | `Sidebar.tsx:143,172,195` | Internal padding mixes `px-2`/`px-3`/`px-4` | Standardize to `px-4` expanded, `px-2` collapsed |
| LS-H4 | `AgentComputerPanel.tsx:181` | `px-5` vs conversation pane `px-6` | Align to `px-6` |

### Animation & Motion (4 findings)

| ID | File | Issue | Fix |
|----|------|-------|-----|
| AM-H1 | `AssistantLoadingSkeleton.tsx:56` | Spinner (duplicate of CR-1) | Shimmer skeleton |
| AM-H2 | `AgentProgressCard.tsx:183` | `y: -1` translate on hover — guide says shadow-only | Remove `y: -1` |
| AM-H3 | `AssistantStateIndicator.tsx:50` | `scale: [1, 1.15, 1]` on Brain icon | Replace with `opacity` pulse |
| AM-H4 | `TypingIndicator.tsx:25` | `scale: [1, 1.4, 1]` on dots | Remove scale, keep opacity |

### Component Polish (6 findings)

| ID | File | Issue | Fix |
|----|------|-------|-----|
| CP-H1 | `ChatInput.tsx:118` | `conicSpin` animation broken — `--conic-angle` not registered | Register `@property` or use `rotate` |
| CP-H2 | `AgentComputerPanel.tsx:195–241` | Processing logs not collapsible | Add collapse/expand affordance |
| CP-H3 | `Sidebar.tsx:135` | Collapse button missing `focus-visible` ring | Add ring classes |
| CP-H4 | `Sidebar.tsx:249–264` | `<span role="button">` instead of `<button>` | Use native `<button>` |
| CP-H5 | Multiple files | No `prefers-reduced-motion` for framer-motion | Add `<MotionConfig reducedMotion="user">` |
| CP-H6 | `Sidebar.tsx:234` | Task list items missing focus ring | Add `focus-visible` classes |

---

## Medium Issues

### Color & Token

| ID | File | Issue | Fix |
|----|------|-------|-----|
| CT-M1 | `MessageSeparator.tsx:6` | `bg-white/[0.04]` — invisible in light mode | `bg-border/40` |
| CT-M2 | `Sidebar.tsx:284` | `text-white` on destructive button | `text-primary-foreground` |
| CT-M3 | `MarkdownRenderer.tsx:24` | `bg-black/5` — wrong in dark mode | Remove (global CSS handles it) or use `bg-muted` |
| CT-M4 | `AssistantStateIndicator.tsx:17` | Writing phase uses `bg-primary/10` | Should use `ai-glow` tokens for AI active state |
| CT-M5 | `AgentStatusRow.tsx:34` | `text-white/20` | `text-terminal-dim` |

### Typography

| ID | File | Issue | Fix |
|----|------|-------|-----|
| TY-M1 | 8+ files | Pervasive `text-[11px]` — off-scale | Standardize to `text-xs` (12px) |
| TY-M2 | `AgentComputerPanel.tsx:98` | Panel title uses `font-serif` | UI chrome should use `font-semibold` (sans) |
| TY-M3 | `ArtifactFilesPanel.tsx:130` | Filename `text-[13px]` — off-scale | Use `text-sm` (14px) |
| TY-M4 | `WelcomeScreen.tsx:134` | Textarea `text-[0.9375rem]` (15px) | Use `text-sm` (14px) |
| TY-M5 | `globals.css:68` | `--font-size-heading` is 18px, spec says 16px | Correct to 1rem (16px), add H1/H2 tokens |
| TY-M6 | `AgentComputerPanel.tsx:195` | Terminal log `text-sm` (14px) | Should be `text-xs` (12px) for dense output |
| TY-M7 | `ToolOutputRenderer.tsx:185` | `[&_code]:text-[11px]` — off-scale, specificity fight | Use `text-xs` |
| TY-M8 | `WelcomeScreen.tsx:180` | Quick-action buttons `text-[0.8125rem]` (13px) | Use `text-sm` (14px) |

### Layout & Spacing

| ID | File | Issue | Fix |
|----|------|-------|-----|
| LS-M1 | `ChatInput.tsx:78` | Absolute-positioned action row + `pb-10` magic number | Use flex-column layout |
| LS-M2 | `WelcomeScreen.tsx:134` vs `ChatInput.tsx:72` | Textarea padding `px-5` vs `px-4` | Standardize |
| LS-M3 | `WelcomeScreen.tsx:111` vs `ChatInput.tsx:55` | `rounded-2xl` vs `rounded-xl` | Use `rounded-xl` consistently |
| LS-M4 | `AgentComputerPanel.tsx:114–144` | Tab buttons lack `focus-visible` ring | Add ring classes |
| LS-M5 | `AgentComputerPanel.tsx:97` | Header `pt-3 pb-0` asymmetric padding | Use `pt-3 pb-2` |
| LS-M6 | `scroll-area.tsx:43` | Radix scrollbar `w-2.5` (10px) vs spec 5px | Change to `w-[5px]` |
| LS-M7 | `CommandPalette.tsx:76` | `bg-card/95` vs spec `bg-card/90` | Change to `bg-card/90` |

### Animation & Motion

| ID | File | Issue | Fix |
|----|------|-------|-----|
| AM-M1 | `AgentComputerPanel.tsx:262` | Scale on live indicator dot | Replace with opacity-only |
| AM-M2 | `WelcomeScreen.tsx:35` | `delayChildren: 0.5` exceeds 300–400ms standard | Use `0.35` |
| AM-M3 | `WelcomeScreen.tsx:95` | Decorative `filter: blur(4px)` entrance | Remove blur, keep opacity+y |
| AM-M4 | `CommandPalette.tsx:71` | Decorative blur on modal entrance | Remove blur filter |
| AM-M5 | `globals.css:111` | `breathe` keyframe includes `scale` — dormant risk | Remove scale from keyframe |

### Component Polish

| ID | File | Issue | Fix |
|----|------|-------|-----|
| CP-M1 | `CommandPalette.tsx:104` | Selected item `border-l-2` clips inside `rounded-lg` | Use inset box-shadow |
| CP-M2 | `WelcomeScreen.tsx:25` | "More" quick action does nothing | Remove or add tooltip "Coming soon" |
| CP-M3 | `ConversationWorkspace.tsx:72` | Global `copied` state affects all copy buttons | Use per-message state |
| CP-M4 | `AssistantLoadingSkeleton.tsx:56` | Phase label color `text-muted-foreground` | Use `text-ai-glow/70` |
| CP-M5 | `TopBar.tsx:38` | Connection dot has no tooltip/ARIA label | Add `aria-label="Connected"` |
| CP-M6 | `ArtifactFilesPanel.tsx:138` | Action buttons `opacity-0` not keyboard accessible | Add `group-focus-within:opacity-100` |
| CP-M7 | `AgentComputerPanel.tsx:113–145` | Tabs lack `role="tab"` / `aria-selected` | Add ARIA tab semantics |
| CP-M8 | `AgentProgressCard.tsx:183` | `whileHover={{ y: -1 }}` — translate on content | Remove, keep shadow-only |

---

## Systemic Patterns

### 1. Token Gaps Drive Arbitrary Values

The type scale in `globals.css` is missing H1 (24px) and H2 (16px) tokens, and `--font-size-heading` is 18px instead of the spec's 16px. This forces developers to choose between mismatched Tailwind utilities or arbitrary `text-[Npx]` values. Result: 8+ components use `text-[11px]`, `text-[13px]`, or `text-[15px]` — none of which exist in the type scale.

**Root fix:** Complete the type scale tokens, then lint for arbitrary text-size values.

### 2. Framer Motion Bypasses Token System

Framer Motion `style` and `animate` props accept plain strings. Every gradient, boxShadow, and color value passed through these props is a hardcoded literal that ignores CSS custom properties. This affects 4+ components with gradients and shadows.

**Root fix:** Establish a convention of always using `var(--color-*)` in framer-motion style objects. Consider a lint rule or code review checklist.

### 3. Accessibility Not Systematically Enforced

Focus rings are present on some components (base UI primitives) but missing on custom interactive elements (sidebar buttons, agent panel tabs, artifact action buttons). Hover-only affordances hide functionality from keyboard users. ARIA roles are missing on tab-like interfaces.

**Root fix:** Add `focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50` as a shared utility class (e.g., `focus-ring`) and apply it to all interactive elements. Audit all `opacity-0 group-hover:opacity-100` patterns to include `group-focus-within`.

---

## Priority Fix Order

| Priority | Task | Effort | Impact |
|----------|------|--------|--------|
| P0 | Replace spinner with shimmer | Small | Highest-frequency loading indicator |
| P0 | Resolve user message style vs spec | Decision | Core UX surface |
| P1 | Add `<MotionConfig reducedMotion="user">` | 1 line | Accessibility for all animations |
| P1 | Fix type scale tokens in globals.css | Small | Prevents future drift |
| P1 | Standardize `text-[11px]` → `text-xs` | Small | 8+ files, consistency |
| P1 | Replace hardcoded hex in motion props | Small | 4 files, theme correctness |
| P1 | Replace raw Tailwind palette in ToolOutputRenderer | Small | Token consistency |
| P2 | Remove scale from content animations | Small | 3 files, guide compliance |
| P2 | Fix sidebar width + padding + a11y | Medium | Layout + accessibility |
| P2 | Typography corrections (font sizes, weights, families) | Medium | Multiple files |
| P3 | Remaining medium issues (color, layout, animation, a11y) | Medium | Polish and correctness |
