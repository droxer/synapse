# Design system

Synapse now uses a **cool technical token system** for developer-tool surfaces: neutral workspace chrome, chromatic CTAs, and restrained blue-tinted support layers.

Token source is `web/src/app/globals.css`:
- `@theme` registers Tailwind token names.
- `:root` defines light mode.
- `.dark` defines dark mode.

---

## Core principles

- Use semantic tokens (`background`, `foreground`, `border`, `focus`) instead of hardcoded colors.
- Keep light/dark parity by changing variables, not component class structure.
- Preserve Synapse's dense product UI with restrained shadows and small radii.
- Use chroma intentionally: `primary` for actions, `secondary` for cool support surfaces, `accent` for hover/highlight.
- Keep font licensing clean: use `Geist` + system/CJK fallbacks, not proprietary fonts.

---

## Radius scale

| Token | Value | Tailwind class | Use |
|-------|-------|----------------|-----|
| `--radius-sm` | 0.25rem (4px) | `rounded-sm` | Tiny indicators |
| `--radius-md` | 0.375rem (6px) | `rounded-md` | Buttons, chips, badges |
| `--radius-lg` | 0.5rem (8px) | `rounded-lg` | Inputs, form controls |
| `--radius-xl` | 0.75rem (12px) | `rounded-xl` | Cards, panels, popovers |
| `--radius-2xl` | 1rem (16px) | `rounded-2xl` | Large modals only |

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
| Border | `--color-border` | `#2A2D33` | `gray200Dark` |
| Border strong | `--color-border-strong` | `#3A404B` | `gray300Dark` |
| Active border | `--color-border-active` | `#6F7A8D` | `gray500Dark` |
| Main text | `--color-foreground` | `#FFFFFF` | high-contrast content |
| Muted text | `--color-muted-foreground` | `#B1B9C7` | `gray700Dark` |
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

---

## Typography

### Font stacks

Defined in `web/src/app/fonts.ts` and injected via `web/src/app/layout.tsx`.

- `--font-sans`: `Geist`, Noto SC/TC, system stack.
- `--font-mono`: `Geist Mono`.
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
- `chip-muted`: compact neutral chip.
- `status-pill`: compact mono status UI.
- `label-mono`: uppercase mono labels.
- `brand-wordmark`: product mark typography treatment.

---

## Focus and interaction

Standard focus ring:

`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`

`--color-ring` intentionally aliases `--color-focus` so all focus states use the action-blue focus token in both themes.

---

## Shadows

Shadows stay subtle and neutral, with borders doing most of the separation work:

- `--shadow-card` is mostly border-led and nearly flat.
- `--shadow-card-hover` adds minimal lift on interaction.
- `--shadow-elevated` is reserved for overlays/dialogs and premium entry surfaces.

This keeps the UI closer to professional IDE products (Cursor/Manus style) where contrast and rhythm come from structure, not decorative depth.

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

---

## Related files

- `web/src/app/globals.css`
- `web/src/app/fonts.ts`
- `web/src/app/layout.tsx`
