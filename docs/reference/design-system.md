# Design system

Synapse uses a **token-driven design system** for developer-tool surfaces: neutral workspace chrome, chromatic CTAs, and a flat, sharp separation model.

Canonical human-facing frontend guide is `docs/design.md`.
Canonical source of truth for live token values is `web/src/app/globals.css`, with this reference doc as the normative token mapping.
If any value conflicts with `docs/DESIGN_STYLE_GUIDE.md`, follow `web/src/app/globals.css` + this file.

Token source is `web/src/app/globals.css`:
- `@theme` registers Tailwind token names.
- `:root` defines light mode.
- `.dark` defines dark mode.

---

## Core principles

- Use semantic tokens (`background`, `foreground`, `border`, `focus`) instead of hardcoded colors.
- Keep light/dark parity by changing variables, not component class structure.
- Preserve Synapse's dense product UI with border-led separation and small radii.
- Use chroma intentionally: `primary` for actions, `secondary` for cool support surfaces, `accent` for hover/highlight.
- Keep font licensing clean: use bundled `Geist`/`Noto Sans` assets plus system fallbacks, not proprietary fonts.

---

## Radius scale

| Token | Value | Tailwind class | Use |
|-------|-------|----------------|-----|
| `--radius-sm` | 0.125rem (2px) | `rounded-sm` | Tiny indicators |
| `--radius-md` | 0.25rem (4px) | `rounded-md` | Buttons, chips, badges |
| `--radius-lg` | 0.375rem (6px) | `rounded-lg` | Inputs, form controls |
| `--radius-xl` | 0.5rem (8px) | `rounded-xl` | Cards, panels, popovers |
| `--radius-2xl` | 0.625rem (10px) | `rounded-2xl` | Exceptional large surfaces |

---

## Color tokens

### Light mode semantic mapping

| Role | Token | Value | Intent |
|------|-------|-------|-----------------|
| App background | `--color-background` | `#FFFFFF` | `backgroundPrimary` |
| CTA/action fill | `--color-primary` | `#2563EB` | primary interactive fill |
| CTA text | `--color-primary-foreground` | `#F8FAFC` | text on primary actions |
| Cool support bg | `--color-secondary` | `#EEF4FF` | low-chroma support surface |
| Support surface text | `--color-secondary-foreground` | `#102244` | text on tinted support surfaces |
| Dense neutral bg | `--color-muted` | `#F4F7FB` | quiet product surface |
| Main text | `--color-foreground` | `#000000` | `contentPrimary` |
| Muted text | `--color-muted-foreground` | `#5B6573` | `contentTertiary` |
| Border | `--color-border` | `#E4E6EB` | gray scale border |
| Strong border | `--color-border-strong` | `#C7CEDA` | emphasized border |
| Active border | `--color-border-active` | `#7F8A9B` | strong neutral border |
| Input border | `--color-input` | `#E4E6EB` | text-entry controls |
| Hover/highlight surface | `--color-accent` | `#F7FAFF` | interactive hover surface |
| Focus ring | `--color-focus`, `--color-ring` | `#3B82F6` | action blue |
| Positive | `--color-accent-emerald` | `#0E8345` | positive track |
| Warning | `--color-accent-amber` | `#9F6402` | warning track |
| Negative | `--color-accent-rose`, `--color-destructive` | `#DE1135` | negative track |
| Overlay scrim | `--color-overlay` | `rgba(0, 0, 0, 0.5)` | `backgroundOverlay` |

### Dark mode semantic mapping

| Role | Token | Value | Intent |
|------|-------|-------|-------------------------|
| App background | `--color-background` | `#101114` | `gray50Dark` |
| CTA/action fill | `--color-primary` | `#5B8CFF` | primary interactive fill |
| CTA text | `--color-primary-foreground` | `#081120` | text on primary actions |
| Cool support bg | `--color-secondary` | `#172033` | low-chroma support surface |
| Support surface text | `--color-secondary-foreground` | `#E6EEFF` | text on tinted support surfaces |
| Dense neutral bg | `--color-muted` | `#1A1F2B` | quiet product surface |
| Surface bg | `--color-card`, `--color-popover` | `#181A1E` | neutral elevated surface |
| Border | `--color-border` | `#2A2D33` | default border |
| Border strong | `--color-border-strong` | `#3A404B` | emphasized border |
| Active border | `--color-border-active` | `#6F7A8D` | active border |
| Input border | `--color-input` | `#2A2D33` | text-entry controls |
| Main text | `--color-foreground` | `#FFFFFF` | high-contrast content |
| Muted text | `--color-muted-foreground` | `#B1B9C7` | secondary content |
| Hover/highlight surface | `--color-accent` | `#1D2432` | interactive hover surface |
| Focus ring | `--color-focus`, `--color-ring` | `#7AA2FF` | action blue |
| Positive | `--color-accent-emerald` | `#5C9D70` | `green600Dark` |
| Warning | `--color-accent-amber` | `#AE8523` | `yellow600Dark` |
| Negative | `--color-accent-rose`, `--color-destructive` | `#DE5B5D` | `red600Dark` |

### Product-specific derived tokens

These remain Synapse-specific and favor neutral product surfaces with a distinct AI signal:

- `--color-ai-surface`, `--color-ai-border`, `--color-ai-glow`
- `--color-input-glow`
- `--color-profile-ring`, `--color-profile-ring-hover`
- `--color-user-accent`, `--color-user-accent-dim`

`--color-ai-surface` / `--color-ai-border` should be used as subtle structural hints (badges, assistant surfaces), not as CTA colors. `--color-accent-purple` and `--color-ai-glow` are reserved for AI-specific signaling and should not replace `primary`.

Provider brand colors (Telegram/Discord/Slack/etc.) are allowed only as explicit brand exceptions in provider identity UI; they do not replace the semantic token system.

Embedded preview surfaces (e.g. `srcDoc`/iframe office previews) may use local fallback values when app CSS variables are unavailable, but those fallback values must mirror semantic token intent and stay aligned with `globals.css` during token updates.

---

## Typography

### Font stacks

Defined in `web/src/app/fonts.ts`, loaded from `web/src/app/font-assets/`, and injected via `web/src/app/layout.tsx`.

- `--font-sans`: local `Geist Sans`, local Noto SC/TC, system stack.
- `--font-mono`: local `Geist Mono`, system mono stack.
- `--font-brand-family`: Geist/system fallback for product wordmark treatment.

### Type scale

| Utility | Size | Use |
|---------|------|-----|
| `text-micro` | 10px | Metadata, status labels |
| `text-caption` / `text-xs` | 12px | Secondary labels |
| `text-sm` | 14px | Body text default |
| `text-base` | 16px | Larger body |
| `text-lg` | 18px | Section headings |
| `text-xl` | 20px | Sub-headings |
| `text-2xl` | 24px | Page titles |

---

## Utility classes (preferred)

Use these instead of rebuilding styles ad hoc:

- `surface-panel`: standard card/panel surface.
- `surface-overlay`: popover/dialog/dropdown surface.
- `chip-muted`: compact neutral chip (color base).
- `chip-xs` / `chip-sm` / `chip-md`: chip size rhythm (use alongside a color base).
- `status-pill`: compact mono status UI (size + display only).
- `status-neutral` / `status-info` / `status-ai` / `status-ok` / `status-warn` / `status-error`: semantic color variants applied alongside `status-pill`. Use these instead of ad-hoc `border-X/30 bg-X/10 text-X` fragments so all pills draw from one consistent palette.
- `label-mono`: uppercase mono labels.
- `brand-wordmark`: product mark typography treatment.

### Status pill variants — when to use

| Variant | Intent | Examples |
|---------|--------|----------|
| `status-neutral` | Quiet metadata, counts, identifiers | Agent role chip, item-count badges |
| `status-info` | In-progress / live signal | "Running", "Connected", live progress |
| `status-ai` | AI-specific signaling (planner, agent surface) | Auto-detected planner mode |
| `status-ok` | Success / complete | "Loaded", "Live channel", complete counts |
| `status-warn` | Attention but not failure | Planning, partial errors |
| `status-error` | Failure / destructive state | "Failed", task error |

---

## Focus and interaction

Standard focus ring:

`focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background`

`--color-ring` intentionally aliases `--color-focus` so all focus states use the action-blue focus token in both themes.

---

## Shadows

Shadows are intentionally minimal:

- `--shadow-card` and `--shadow-card-hover` are effectively disabled for standard surfaces.
- `--shadow-elevated` is reserved for overlays/dialogs only.
- Standard product UI should not use diffuse Tailwind shadows or custom card-lift effects.

This keeps the UI flat and sharp, with hierarchy coming from structure, borders, spacing, and active-state geometry.

---

## Implementation notes

- Do not treat `primary` as neutral ink. Body text should use `foreground` / `card-foreground`; links and CTAs may use `focus` / `primary` depending on intent.
- Do not hardcode CTA blues, legacy Base Web neutrals, or old opacity-derived hover fills in components.
- Prefer tokens from `globals.css` through Tailwind classes (`bg-background`, `border-border`, `text-muted-foreground`, `ring-ring`).
- If adding a new semantic color, define it in `@theme`, `:root`, and `.dark` together.

Token maintenance checklist:

- Add or update every semantic token in all three locations in `globals.css`: `@theme`, `:root`, and `.dark`.
- Keep fallback values for embedded content (iframes/previews) aligned with the same semantic token intent.
- Prefer semantic aliases (e.g. `ring` -> `focus`) over direct literal reuse when a role already exists.
- Keep font assets in `web/src/app/font-assets/`; binary font files are tracked through Git LFS.

Guardrail command:

- Run `make audit-design-tokens` from the repo root, or `npm run audit:design-tokens` in `web/`, to detect banned token patterns and hardcoded color literals (with approved exception allowlist).
- The audit also blocks `backdrop-blur`, `glass-surface`, `workspace-atmosphere`, `gradient-heading`, and non-overlay shadow patterns in product UI.

---

## Related files

- `docs/design.md`
- `web/src/app/globals.css`
- `web/src/app/fonts.ts`
- `web/src/app/layout.tsx`
