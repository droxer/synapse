# Design system

Synapse uses a **Sharp & Focused** design language — tight radii, dense chrome, Geist Mono in UI labels, and a single blue accent. Think Cursor / VS Code aesthetic, not rounded-app aesthetic.

All tokens live in `web/src/app/globals.css` (`@theme` block for Tailwind registration, `:root` for light mode, `.dark` for dark mode overrides).

---

## Border radii

Five distinct steps. No two share a value.

| Token | Value | Tailwind class | Use |
|-------|-------|---------------|-----|
| `--radius-sm` | 2px | `rounded-sm` | Dot indicators, tiny accents |
| `--radius-md` | 3px | `rounded-md` | Buttons, badges, `<kbd>`, chips |
| `--radius-lg` | 4px | `rounded-lg` | Inputs, textareas, dropdowns |
| `--radius-xl` | 6px | `rounded-xl` | Cards, panels, dialogs |
| `--radius-2xl` | 8px | `rounded-2xl` | Large modals, onboarding surfaces |

**Rule:** panels/surfaces → `rounded-xl`; controls → `rounded-md`; never mix xl and 2xl by accident (they differ).

---

## Color tokens

### Surface hierarchy

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `background` | `#FFFFFF` | `#1E1E1E` | Page background |
| `secondary` / `muted` / `card` | `#F4F4F5` | `#252526` | Lifted panels, input bg, cards |
| `sidebar-bg` | `#F5F5F6` | `#2D2D30` | Sidebar chrome (slightly lifted from bg) |

### Text

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `foreground` | `#09090B` | `#FAFAFA` | Primary text |
| `muted-foreground` | `#71717A` | `#A1A1AA` | Secondary / helper text |
| `muted-foreground-dim` | `#A1A1AA` | `#71717A` | Tertiary, labels, timestamps |
| `placeholder` | `#A1A1AA` | `#71717A` | Input placeholder text |

### Borders — all zinc family (no slate)

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `border` | `#E4E4E7` zinc-200 | `#3E3E42` zinc-700 | Default borders, dividers |
| `border-strong` | `#D4D4D8` zinc-300 | `#4E4E52` zinc-600 | Hover state borders, emphasis |
| `border-active` | `#A1A1AA` zinc-400 | `#71717A` zinc-500 | Active/focused input borders |

> All three are pure zinc. Never use slate (`#CBD5E1`, `#94A3B8`) for borders — it introduces an unintended blue tint.

### Focus & accent

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `focus` | `#1B7EF2` | `#3B8EF5` | Focus rings, active borders, interactive accents |
| `ring` | `#1B7EF2` | `#3B8EF5` | Same as focus — `ring-ring` = blue in both modes |
| `accent-emerald` | `#10B981` | `#34D399` | Success states, connected indicators |
| `accent-amber` | `#B45309` | `#D97706` | Warnings, highlights |
| `accent-rose` / `destructive` | `#EF4444` | `#F87171` | Errors, delete actions |

> `accent-purple` is an alias for `focus` (blue). It exists for historical reasons — prefer `focus` in new code.

### AI-specific surfaces

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `ai-surface` | `rgba(27,126,242,.05)` | `rgba(59,142,245,.04)` | AI message background tint |
| `ai-border` | `rgba(27,126,242,.12)` | `rgba(59,142,245,.12)` | AI message border |
| `ai-glow` | `= focus` | `= focus` | Streaming cursor, AI indicators |

---

## Focus rings

**All focusable elements use a blue ring.** `--color-ring` equals `--color-focus` in both light and dark mode.

Standard focus pattern (applied by shadcn/ui primitives):
```
focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
```

The chat input uses a tighter single-pixel ring (not the standard 2px):
```
border-focus ring-1 ring-focus/20
```

Do not use `ring-ring` with a black or white value — if you see `--color-ring: #18181B` or `--color-ring: #E2E8F0` somewhere it is a bug.

---

## Typography

**Body font:** Geist Sans (`--font-sans`). 14px base (`text-sm`), line-height 1.5, letter-spacing -0.011em.

**Code font:** Geist Mono (`--font-mono`). Used for code blocks, terminal output, and UI chrome (see below).

**Mono in UI chrome** — the following elements use Geist Mono, not Geist Sans:
- Section labels in sidebar (`label-mono` utility)
- Source type badges on skill cards (`font-mono`)
- Token count badges in TopBar (`font-mono text-micro`)
- `<kbd>` shortcuts (`font-mono text-micro`)
- Skill name slugs in card footers (`font-mono text-micro`)

### Type scale

| Utility | Size | Use |
|---------|------|-----|
| `text-micro` | 10px | Labels, timestamps, badges, `<kbd>` |
| `text-caption` / `text-xs` | 12px | Secondary info, descriptions |
| `text-sm` | 14px | Body — default for all prose |
| `text-base` | 16px | Larger body where needed |
| `text-lg` | 18px | Section headings |
| `text-xl` | 20px | Page sub-headings |
| `text-2xl` | 24px | Page titles, hero headings |

### Custom utilities

| Class | Definition | Use |
|-------|-----------|-----|
| `text-micro` | 10px / lh 1.4 | Tiny labels |
| `text-caption` | 12px / lh 1.5 | Caption text |
| `label-mono` | Geist Mono, 10px, weight 600, uppercase, tracking 0.08em | Sidebar section labels |

---

## Shadows

| Variable | Use |
|----------|-----|
| `--shadow-card` | Subtle border-shadow on card surfaces |
| `--shadow-card-hover` | Card hover lift |
| `--shadow-elevated` | Dialogs, popovers, dropdowns |

All shadows use `color-mix` against border tokens — they adapt to dark mode automatically.

---

## Layout chrome

| Element | Spec |
|---------|------|
| TopBar height | `h-10` (40px) |
| Sidebar width (expanded) | 256px default, user-resizable 180–400px |
| Sidebar width (collapsed) | `w-12` (48px) |
| Sidebar nav row | `px-2.5 py-1.5`, `rounded-md`, `text-sm font-medium` |
| Active nav state | `bg-sidebar-active` background only — no left-bar indicator |

---

## Animations

All animations respect `prefers-reduced-motion` via a global override in `globals.css`.

| Variable | Duration | Use |
|----------|----------|-----|
| `--animate-fade-in` | 300ms | Page-level content |
| `--animate-slide-up` | 400ms | Modal/panel entrance |
| `--animate-slide-in-right` | 300ms | Side panel entrance |
| `--animate-scale-in` | 150ms | Dropdown/popover open |
| `--animate-modal-in` | 150ms | Dialog entrance |
| `--animate-shimmer` | 2s loop | Skeleton loaders |
| `glowPulse` | 3s loop | Login card logo glow (blue, not purple) |

---

## Do / Don't

| Do | Don't |
|----|-------|
| Use `border-border` / `border-strong` / `border-active` | Hardcode `#CBD5E1`, `#94A3B8` (slate) for borders |
| Use `ring-ring` or `ring-focus` for focus states | Use `ring-ring` when it resolves to black |
| Use `--radius-xl` (6px) for cards | Use `rounded-2xl` on cards |
| Use `label-mono` for uppercase section labels | Use `font-semibold uppercase tracking-widest` without mono |
| Use `text-focus` / `border-focus` for interactive blue | Use `text-accent-purple` / `border-accent-purple` in new code |

---

## Related

- Token source: `web/src/app/globals.css`
- shadcn/ui primitives: `web/src/shared/components/ui/`
- TypeScript style: [`style-typescript.md`](style-typescript.md)
- Frontend layout: [`frontend-layout.md`](frontend-layout.md)
