# Design system

Synapse uses a **Sharp & Focused** design language — tight radii, dense chrome, Geist Mono in UI labels, and a single blue accent. Think Cursor / VS Code aesthetic, not rounded-app aesthetic.

All tokens live in `web/src/app/globals.css` (`@theme` block for Tailwind registration, `:root` for light mode, `.dark` for dark mode overrides).

---

## Border radii

Five distinct steps. No two share a value.

| Token | Value | Tailwind class | Use |
|-------|-------|---------------|-----|
| `--radius-sm` | 0.25rem (4px) | `rounded-sm` | Dot indicators, tiny accents |
| `--radius-md` | 0.375rem (6px) | `rounded-md` | Buttons, badges, `<kbd>`, chips |
| `--radius-lg` | 0.5rem (8px) | `rounded-lg` | Inputs, textareas, dropdowns |
| `--radius-xl` | 0.75rem (12px) | `rounded-xl` | Cards, panels, dialogs |
| `--radius-2xl` | 1rem (16px) | `rounded-2xl` | Large modals, onboarding surfaces |

**Rule:** panels/surfaces → `rounded-xl`; controls → `rounded-md` or `rounded-lg`; never mix xl and 2xl by accident (they differ).

---

## Color tokens

### Surface hierarchy

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `background` | `#FFFFFF` | `#1E1E1E` | Page background |
| `secondary` / `muted` / `card` | `#F4F4F5` | `#252526` | Lifted panels, input bg, cards |
| `popover` | `#FFFFFF` | `#252526` | Popover/dropdown bg |
| `sidebar-bg` | `#F5F5F6` | `#252526` | Sidebar chrome (slightly lifted from bg) |
| `sidebar-active` | `#E4E4E7` | `#3E3E45` | Active sidebar nav item background |
| `sidebar-hover` | `#EBEBEC` | `#35353C` | Hovered sidebar nav item |

### Text

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `foreground` | `#09090B` | `#FAFAFA` | Primary text |
| `primary` / `primary-foreground` | `#18181B` / `#FAFAFA` | `#FAFAFA` / `#18181B` | Primary actions and their text (inverted in dark) |
| `muted-foreground` | `#71717A` | `#A1A1AA` | Secondary / helper text |
| `muted-foreground-dim` | `#A1A1AA` | `#71717A` | Tertiary, labels, timestamps |
| `placeholder` | `#A1A1AA` | `#71717A` | Input placeholder text |
| `sidebar-foreground-muted` | `#71717A` | `#A1A1AA` | Sidebar secondary text |

### Borders — all zinc family (no slate)

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `border` | `#E4E4E7` zinc-200 | `#3E3E42` | Default borders, dividers |
| `border-strong` | `#DDDEE4` | `#47474C` | Hover state borders, emphasis |
| `border-active` | `#A1A1AA` zinc-400 | `#71717A` zinc-500 | Active/focused input borders |
| `overlay-border` | `#DDDEE4` | `color-mix(…)` | Overlay/popover borders |

> All border tokens are zinc-derived. Never use slate (`#CBD5E1`, `#94A3B8`) for borders — it introduces an unintended blue tint.

### Focus & accent

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `focus` | `#1B7EF2` | `#3B8EF5` | Focus rings, active borders, interactive accents |
| `ring` | `#1B7EF2` | `#3B8EF5` | Same as focus — `ring-ring` = blue in both modes |
| `accent-emerald` | `#10B981` | `#34D399` | Success states, connected indicators |
| `accent-amber` | `#B45309` | `#D97706` | Warnings, highlights |
| `accent-rose` / `destructive` | `#EF4444` | `#F87171` | Errors, delete actions |
| `accent-blue` | `#3B82F6` | `#3B82F6` | Blue accent (distinct from focus) |

> `accent-purple` is an alias for `focus` (blue). It exists for historical reasons — prefer `focus` in new code.

### AI-specific surfaces

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `ai-surface` | `rgba(27,126,242,.05)` | `rgba(59,142,245,.04)` | AI message background tint |
| `ai-border` | `rgba(27,126,242,.12)` | `rgba(59,142,245,.12)` | AI message border |
| `ai-glow` | `= focus` | `= focus` | Streaming cursor, AI indicators |

### User accent

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `user-accent` | `#18181B` | `#FAFAFA` | User message accent |
| `user-accent-dim` | `rgba(24,24,27,.04)` | `rgba(250,250,250,.06)` | User message tint |

### Input & overlay

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `input-glow` | `rgba(27,126,242,.08)` | `rgba(59,142,245,.12)` | Input focus glow |
| `overlay` | `rgba(24,24,27,.45)` | `rgba(0,0,0,.5)` | Modal backdrop scrim |

### Profile ring

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `profile-ring` | `rgba(27,126,242,.2)` | `rgba(59,142,245,.25)` | Avatar ring |
| `profile-ring-hover` | `rgba(27,126,242,.35)` | `rgba(59,142,245,.45)` | Avatar ring on hover |

### Terminal

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `terminal-bg` | `#FFFFFF` | `#1E1E1E` | Terminal background |
| `terminal-surface` | `#F4F4F5` | `#252526` | Terminal raised surface |
| `terminal-border` | `#E4E4E7` | `#3E3E42` | Terminal borders |
| `terminal-text` | `#27272A` | `#CBD5E1` | Terminal primary text |
| `terminal-dim` | `#A1A1AA` | `#71717A` | Terminal dim text |

### Logo

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `logo-bg` | `= logo-black (#0A0A0A)` | `= logo-white (#FFFFFF)` | Logo background (inverts in dark) |
| `logo-glyph` | `= logo-white (#FFFFFF)` | `= logo-black (#0A0A0A)` | Logo glyph (inverts in dark) |

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

**Brand font:** Orbitron (`--font-brand-family`). Used exclusively for the brand wordmark via the `brand-wordmark` utility.

**CJK support:** Noto Sans SC and Noto Sans TC are loaded as fallback fonts for Simplified and Traditional Chinese.

### Font stacks

```
--font-sans:  Geist, Noto Sans SC, Noto Sans TC, "Inter", "SF Pro Text", …, sans-serif
--font-mono:  Geist Mono, ui-monospace, SFMono-Regular, "SF Mono", Menlo, …, monospace
--font-brand: Orbitron, "Eurostile", "Bank Gothic", "Rajdhani", <sans stack>
```

### Mono in UI chrome

The following elements use Geist Mono, not Geist Sans:
- Section labels in sidebar (`label-mono` utility)
- Source type badges on skill cards (`font-mono`)
- Token count badges in TopBar (`font-mono text-micro`)
- `<kbd>` shortcuts (`font-mono text-micro`)
- Skill name slugs in card footers (`font-mono text-micro`)
- Status pills (`status-pill` utility)

### Type scale

| Utility | Size | Use |
|---------|------|-----|
| `text-micro` | 10px (0.625rem) | Labels, timestamps, badges, `<kbd>` |
| `text-caption` / `text-xs` | 12px (0.75rem) | Secondary info, descriptions |
| `text-sm` | 14px (0.875rem) | Body — default for all prose |
| `text-base` | 16px (1rem) | Larger body where needed |
| `text-lg` | 18px (1.125rem) | Section headings |
| `text-xl` | 20px (1.25rem) | Page sub-headings |
| `text-2xl` | 24px (1.5rem) | Page titles, hero headings |
| `heading-display` | clamp(1.5rem, 1.1rem + 2vw, 2.25rem) | Responsive hero/display text |

### Line heights

| Token | Value | Use |
|-------|-------|-----|
| `--lh-tight` | 1.2 | Compact headings |
| `--lh-display` | 1.1 | Display/hero text |
| `--lh-normal` | 1.5 | Body text (default) |
| `--lh-relaxed` | 1.625 | Code blocks, markdown prose |

---

## Custom utilities

Defined via `@utility` in `globals.css`. Prefer these over assembling equivalent classes manually.

### Typography utilities

| Class | Definition | Use |
|-------|-----------|-----|
| `text-micro` | 10px / lh 1.4 | Tiny labels, timestamps |
| `text-caption` | 12px / lh 1.5 | Caption text |
| `label-mono` | Geist Mono, 10px, weight 600, uppercase, tracking 0.08em | Sidebar section labels, table headers |
| `heading-display` | Geist Sans, clamp() responsive size, weight 600, lh 1.1, tracking -0.03em | Hero/display headings |
| `brand-wordmark` | Orbitron, 0.8rem, weight 600, uppercase, tracking 0.06em, blue-tinted color | Brand wordmark only |

### Surface utilities

| Class | Definition | Use |
|-------|-----------|-----|
| `surface-panel` | `border-border` + `rounded-xl` + `bg-card` + `shadow-card` | Cards, panels — use instead of assembling manually |
| `surface-overlay` | `border-overlay-border` + `rounded-xl` + `bg-popover` + `shadow-elevated` | Popovers, dropdowns, floating panels |
| `chip-muted` | `border-border` + `rounded-md` + `bg-muted` + `text-muted-foreground` | Muted chip/tag elements |
| `status-pill` | inline-flex + gap + `rounded-md` + mono 10px + weight 500 | Status indicators |

### Effect utilities

| Class | Definition | Use |
|-------|-----------|-----|
| `skeleton-shimmer` | Gradient shimmer animation on secondary/border colors | Skeleton loading states |
| `dot-grid-bg` | Radial gradient dot pattern (20px grid) | Texture backgrounds |
| `pb-safe` | `env(safe-area-inset-bottom)` padding | Mobile safe area |
| `pb-safe-4` | `1rem + env(safe-area-inset-bottom)` padding | Mobile safe area with extra spacing |

---

## Shadows

| Variable | Use |
|----------|-----|
| `--shadow-card` | Flat hairline treatment for cards and panels (1px outline via `color-mix`) |
| `--shadow-card-hover` | Stronger hairline for active/hover emphasis (no depth lift) |
| `--shadow-elevated` | Very soft lift for overlays (dialogs/popovers/dropdowns) |

Shadows are intentionally restrained for flat-first styling. Surfaces should read through border contrast first, with depth used sparingly. **Overlays always use `shadow-elevated`; cards/panels use `shadow-card`.**

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

All animations respect `prefers-reduced-motion` via a global override in `globals.css` that clamps all durations to 0.01ms. Framer-motion also respects the user's motion preference via `<MotionConfig reducedMotion="user">`.

### CSS animations

| Variable | Duration | Use |
|----------|----------|-----|
| `--animate-fade-in` | 300ms | Page-level content |
| `--animate-slide-up` | 400ms | Modal/panel entrance |
| `--animate-slide-in-right` | 300ms | Side panel entrance |
| `--animate-scale-in` | 150ms | Dropdown/popover open |
| `--animate-modal-in` | 150ms | Dialog entrance |
| `--animate-shimmer` | 2s loop | Skeleton loaders |
| `--animate-pulsing-dot-fade` | 2s loop | Status dot fade |
| `--animate-pulsing-dot-ring` | 2s loop | Status dot ring expansion |

### Framer-motion variants

Shared list animation variants live in `web/src/shared/lib/animations.ts`:
- `listContainer`: opacity fade with `staggerChildren: 0.02`
- `listItem`: opacity + 8px y-translate, 120ms ease-out

---

## Code syntax highlighting

The highlight.js theme is fully defined in `globals.css` using app design tokens — no external theme import is needed.

| Syntax element | Token |
|----------------|-------|
| Keywords, selectors, links | `accent-purple` (= focus blue) |
| Strings, titles, names, types, attributes | `accent-emerald` |
| Comments, quotes, meta | `muted-foreground` |
| Numbers, regex, built-ins, variables | `accent-amber` |
| Functions, classes, params | `foreground` (default text) |
| Background | `secondary` |

---

## Conversation & markdown styling

Conversation markdown uses dedicated CSS classes in `globals.css`:

- `.conversation-markdown`: line-height `--lh-relaxed`, custom margins for block elements, muted markers
- `.conversation-assistant-message`: left padding `0.875rem`
- `.markdown-reasoning`: muted color with 0.9 opacity for thinking blocks, custom heading/list/code styles
- `.streaming-active::after`: blinking cursor via `blink-cursor` keyframes with `ai-glow` color

---

## Scrollbar styling

Thin 4px scrollbars with rounded thumbs. Light mode uses warm gray (`rgba(120,113,108,.2)`), dark mode uses light gray (`rgba(214,211,209,.1)`). Standard Firefox `scrollbar-width: thin` is applied globally.

---

## Touch targets

On coarse pointer devices (`hover: none, pointer: coarse`), WCAG 2.5.8 compliance is enforced:
- Buttons: minimum 44×44px
- Checkboxes/radios: 24px hit area expansion via `::before` pseudo
- Switches: 44px min-height with 12px block padding
- Slider thumbs: 28px with 10px inset expansion
- Inputs/textareas/selects: 44px min-height

---

## Do / Don't

| Do | Don't |
|----|-------|
| Use `border-border` / `border-strong` / `border-active` | Hardcode `#CBD5E1`, `#94A3B8` (slate) for borders |
| Use `ring-ring` or `ring-focus` for focus states | Use `ring-ring` when it resolves to black |
| Use `rounded-xl` (12px) for cards/panels | Use `rounded-2xl` on cards; reserve 2xl for large modals |
| Use `surface-panel` for card surfaces | Manually assemble `border + rounded-xl + bg-card + shadow-card` |
| Use `surface-overlay` for floating panels | Use `shadow-card` on overlay/dropdown surfaces |
| Use `label-mono` for uppercase section labels | Use `font-semibold uppercase tracking-widest` without mono |
| Use `text-focus` / `border-focus` for interactive blue | Use `text-accent-purple` / `border-accent-purple` in new code |
| Use `text-micro` or `text-caption` for metadata | Use ad-hoc `text-[10px]` or `text-[12px]` |
| Use `status-pill` for status indicators | Manually assemble mono + micro + pill styling |

---

## Related

- Token source: `web/src/app/globals.css`
- shadcn/ui primitives: `web/src/shared/components/ui/`
- Shared animation variants: `web/src/shared/lib/animations.ts`
- Font declarations: `web/src/app/fonts.ts`
- TypeScript style: [`style-typescript.md`](style-typescript.md)
- Frontend layout: [`frontend-layout.md`](frontend-layout.md)
