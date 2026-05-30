# Synapse Frontend Design Guide

This document is the canonical product UI style guide for Synapse. The visual system is a **full brand pivot** to the Meta-inspired commerce/hardware-showcase aesthetic defined in [`/DESIGN.md`](../DESIGN.md): stark white canvas, cobalt commerce CTAs, pill buttons, 32-pt photographic cards, and a Montserrat type stack standing in for the proprietary Optimistic VF.

## 1) Scope and Precedence

### Scope
- Applies to all product UI in `web/src/**` — app shell, conversation, agent-computer, skills, MCP, channels, login, design-system gallery, and shared primitives.
- Applies to marketing surfaces (`/login`, hero, footer) under the same system; there is no separate "marketing" track.

### Canonical precedence
1. [`/DESIGN.md`](../DESIGN.md) — system spec (colors, type roles, radii, component definitions)
2. `web/src/app/globals.css` — live token values and `@utility` contracts
3. This `design.md` — rules, do/don't, and usage guidance
4. `docs/reference/design-system.md` — reference shard of tokens and components
5. Audit reports / archived guides

If guidance conflicts, follow this order.

## 2) Design Principles

- **Photography-first merchandising voice.** Product imagery and copy hierarchy carry the surface; chrome stays restrained.
- **Cobalt is reserved for action.** `--color-cobalt` (`#0064E0`) belongs on Send / Run / Submit / Continue. Black pills (`--color-ink-button`) belong on marketing/landing primaries. Nothing else takes the cobalt fill.
- **Every interactive element is pill-shaped.** Buttons, badges, pill-tabs all use `--radius-full` (100px). Squared corners signal "third-party widget".
- **Token-first, role-first.** Use canonical color tokens (`bg-canvas`, `text-ink-deep`) and typography role utilities (`text-heading-lg`, `text-body-md`). Avoid raw hex and avoid raw `text-[14px] font-bold leading-[1.43]` chains where a role exists.
- **Flat by default.** Elevation is a commerce-flow signal; only sticky purchase/action rails carry a shadow.
- **Accessibility-first.** WCAG AAA 44px touch targets, keyboard-visible focus on `--color-fb-blue`, reduced-motion respect, CJK-safe layouts.

## 3) Foundations

### 3.1 Token architecture

Token contract lives in `web/src/app/globals.css`:
- `@theme` — registers Tailwind v4 token names (auto-generates `bg-X / text-X / border-X / ring-X` utilities)
- `:root` — light-mode runtime values
- `.dark` — dark-mode runtime overrides (synthesised; DESIGN.md does not publish dark tokens)

Every token change must be mirrored in all three blocks.

### 3.2 Color token groups

- **Brand / action**: `cobalt`, `cobalt-deep`, `cobalt-soft`, `cobalt-selected`, `ink-button`, `on-ink-button`, `on-cobalt`
- **Surface**: `canvas`, `surface-soft`
- **Text**: `ink-deep`, `ink`, `charcoal`, `slate`, `steel`, `stone`, `disabled-text`
- **Hairline**: `hairline`, `hairline-soft`
- **Accent**: `fb-blue` (focus + form-control activation), `meta-link`, `oculus-purple`
- **Semantic**: `success`, `attention`, `warning`, `critical`, `critical-strong`
- **Product-specific**: `sidebar-*`, `terminal-*`, `profile-ring*`, `ai-*` (all resolve to canonical tokens via `color-mix` or aliasing)
- **Legacy aliases**: `background`, `foreground`, `primary`, `secondary`, `muted`, `border`, `input`, `ring`, `destructive`, `accent`, `card`, `popover` — **kept** so existing component classes continue to compile, but each remaps to a canonical token. New code should consume canonical names directly.

### 3.3 Radius contract

| Token | Value | Use |
|---|---|---|
| `rounded-xs` | 2 | Inline checkbox marks. |
| `rounded-sm` | 4 | Tags, micro-controls. |
| `rounded-md` | 6 | Square thumbnails. |
| `rounded-lg` | 8 | Form inputs (44px height), radio cards. |
| `rounded-xl` | 16 | Icon-feature cards, FAQ items, checkout summary. |
| `rounded-xxl` | 24 | Warranty / accessory tiles. |
| `rounded-xxxl` | 32 | **Photographic feature cards**, promo strips, hero bands. |
| `rounded-feature` | 40 | Accessory hero panels. |
| `rounded-full` | 100 | **All** buttons, tab chips, badges, search-pill. |
| `rounded-circle` | 9999 | Color swatches, circular icon buttons. |

The pair `rounded-full` (interactive) and `rounded-xxxl` (photographic) is the brand's geometric signature.

### 3.4 Focus contract

Default interactive focus pattern:
- `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas`

`--color-focus` resolves to `--color-fb-blue` (`#1876f2`). Text-inputs additionally swap to a **2px solid `border-fb-blue`** on focus (compensating padding so layout doesn't shift). This is the DESIGN.md `text-input-focused` contract.

Use `ring-1` only inside dense product chrome where a thinner ring is intentional.

### 3.5 Typography contract

- **Sans stack** (`--font-sans`): Montserrat (`next/font/google`, weights 300/400/500/700) → Noto Sans CJK SC/TC → system fallbacks. Substitutes for the proprietary Optimistic VF; the `ss01, ss02` stylistic-set declarations on headings are harmless on Montserrat and future-proof an Optimistic swap.
- **Mono stack** (`--font-mono`): Geist Mono → system mono. Reserved for code blocks and tabular numerics.

#### Type roles

Every role is exposed as a single `@utility` class — use these instead of raw size/weight/tracking chains:

| Utility | Size | Weight | LH | Tracking |
|---|---|---|---|---|
| `text-hero-display` | 64 | 500 | 1.16 | 0 |
| `text-display-lg` | 48 | 500 | 1.17 | 0 |
| `text-heading-lg` | 36 | 500 | 1.28 | 0 |
| `text-heading-md` | 28 | **300** (editorial light) | 1.21 | 0 |
| `text-heading-sm` | 24 | 500 | 1.25 | 0 |
| `text-subtitle-lg` | 18 | 700 | 1.44 | 0 |
| `text-subtitle-md` | 18 | 400 | 1.44 | 0 |
| `text-body-md` | 16 | 400 | 1.5 | -0.16px |
| `text-body-md-bold` | 16 | 700 | 1.5 | -0.16px |
| `text-body-sm` | 14 | 400 | 1.43 | -0.14px |
| `text-body-sm-bold` | 14 | 700 | 1.43 | -0.14px |
| `text-caption-bold` | 12 | 700 | 1.33 | 0 |
| `text-button-md` | 14 | 700 | 1.43 | -0.14px |
| `text-link-md` | 16 | 700 | 1.5 | -0.16px |

Bare `<h1>`–`<h6>` tags inherit `font-feature-settings: "ss01", "ss02"` and `font-weight: 500` (700 for h3–h6) but **deliberately have no tag-level `font-size`** — pick a role utility per element. The 300-weight `text-heading-md` is the system's editorial signature.

### 3.6 Spacing contract

4px-based scale with named steps: `xxs 4 / xs 8 / sm 10 / md 12 / base 16 / lg 20 / xl 24 / xxl 32 / xxxl 40 / section-sm 48 / section 64 / section-lg 80 / hero 120`. Marketing sections separate at `section-lg`; product sections at `section`; FAQ stacks compress to `xxl`.

### 3.7 Elevation contract

Three levels only:

| Token | Use |
|---|---|
| `--shadow-card` (none) | Default product cards, why-buy tiles — flat. |
| `--shadow-elevated` | Subtle separation for floating overlays. |
| `--shadow-sticky-rail` | **Level 2** — sticky purchase summary, sticky bottom action bar. Only commerce-flow signal. |

Do not add diffuse atmosphere shadows to marketing or product cards.

### 3.8 CJK safety

Chinese (`zh-CN`/`zh-TW`) typography:
- Letter-spacing on Latin body roles (`-0.14px`/`-0.16px`) is zeroed for CJK selectors at the bottom of `globals.css`.
- **Layout rule**: centered CJK copy must use **block flow + `text-align: center`** (`cjk-safe-centered` / `cjk-safe-centered-constrained` utilities). Do **not** use `flex items-center` or `grid justify-items: center` on the text container — both shrink cross-axis size to min-content (~1 glyph for CJK), causing vertical text. In horizontal rows, **`flex-1 min-w-0` and `grid-cols-[minmax(0,1fr)_…]` also collapse CJK** — the `minmax(0, …)` / `min-w-0` minimum allows tracks to shrink below glyph width. Use plain `1fr` columns, or flex rows **without** `min-w-0` on the label (push trailing icons with `ml-auto`).

## 4) Usage Rules (Do / Don't)

### Do
- Use canonical color shortnames (`bg-canvas`, `text-ink-deep`, `border-hairline-soft`).
- Use typography role utilities (`text-heading-lg`, `text-body-md`).
- Use `Card variant="…"` for the eight DESIGN.md card chromes; reach for `product-feature` (32 px radius) by default for photographic surfaces.
- Reuse `Button` variants — `default` (cobalt) for action, `marketing` (black) for landing, `secondary`/`outline` (2px ink outline) for paired CTAs, `ghost` for tertiary, `pill-tab`/`pill-tab-active` for category nav.
- Reuse signature components: `PromoBanner`, `HeroBand`, `FeatureIconRow`, `FooterRegion`, `ColorSwatch`.
- Use `search-pill` utility for any top-nav search trigger.
- Mirror every token change in `@theme`, `:root`, and `.dark`.
- Use `cjk-safe-centered` / `cjk-safe-centered-constrained` for centered CJK copy (block flow — not flex/grid centering).

### Don't
- Don't use `cobalt` for marketing-surface primaries — that's the black pill's job.
- Don't soften pill buttons below `rounded-full`.
- Don't apply `rounded-md`/`rounded-lg` to photographic cards — `rounded-xxxl` is the minimum.
- Don't introduce accent colors beyond cobalt + Oculus purple. The hardware brand is deliberately monochromatic outside product photography.
- Don't write raw `text-[14px] font-bold leading-[1.43] tracking-[-0.14px]` chains where `text-button-md` / `text-body-sm-bold` already encodes the role.
- Don't write `bg-[color:var(--color-X)]` — Tailwind v4 auto-generates `bg-X` from `@theme`. Use the shortname.
- Don't apply heavy shadows to marketing cards. Elevation is a commerce-flow signal.
- Don't reintroduce `backdrop-blur`, `glass-surface`, `gradient-heading`, or diffuse atmosphere layers.
- Don't set `font-size` on the bare `<h1>`–`<h6>` tag selectors — opt in via role utilities per element.

## 5) Surfaces and Overlay Conventions

### Surface types
- **Default photographic card**: `Card variant="product-feature"` (32px radius, 32px pad, hairline-soft border).
- **Edge-to-edge image card**: `Card variant="feature-photo"` (32px radius, no chrome).
- **Dark promo block**: `Card variant="promo-strip"` (ink-deep bg, 32px radius, 64px pad).
- **Compact reassurance tile**: `Card variant="icon-feature"` (16px radius, 24px pad).
- **Sticky action/checkout rail**: `Card variant="checkout-summary"` (16px radius, level-2 shadow).
- **Surface-soft warranty/promo callout**: `Card variant="warranty"` (24px radius).
- **Dense in-app panel (bridge variant)**: `Card variant="panel"` — 24px radius, hairline-soft border, canvas fill. Use for in-product surfaces that haven't been re-imagined as photographic cards.

### Overlay contract
- Dialogs, popovers, menus, hover cards consume `surface-overlay` chrome (24px radius, hairline border, `--shadow-elevated`).
- The PDP-style sticky rail is the only surface that carries `--shadow-sticky-rail`.

## 6) Component and Layout Conventions

### 6.1 Shared primitive layer

Authoritative implementations:
- `web/src/shared/components/ui/button.tsx` — pill button (cobalt / black / ghost / pill-tab)
- `web/src/shared/components/ui/card.tsx` — 8 variants
- `web/src/shared/components/ui/input.tsx` — 44px, hairline border, 2px fb-blue focus
- `web/src/shared/components/ui/badge.tsx` — pill badges (success/promo-yellow/attention/critical/…)
- `web/src/shared/components/ui/tabs.tsx` — adds `variant="pill"` for the DESIGN.md category nav
- `web/src/shared/components/ui/dialog.tsx`, `dropdown-menu.tsx`, `select.tsx`, `popover.tsx`, `hover-card.tsx` — overlay chrome
- `web/src/shared/components/ui/tooltip.tsx`

### 6.2 Signature components

Marketing surfaces (`web/src/shared/components/marketing/`):
- `PromoBanner` — sticky strip above the top nav (`tone="ink"` or `"yellow"`).
- `HeroBand` — full-bleed photographic hero, overlaid copy, dual-CTA pair (`marketing` + `secondary`).
- `FeatureIconRow` — 4-up reassurance grid with `card-icon-feature` chrome.
- `FooterRegion` — dense multi-column footer.
- `ColorSwatch` — 32px circle with a 2px canvas selection ring over an ink-deep outer ring.

### 6.3 App shell

- Sidebar: `web/src/shared/components/Sidebar.tsx` — `bg-sidebar-bg` (surface-soft) with `bg-sidebar-active`/`bg-sidebar-hover` derived via `color-mix(cobalt N%, surface-soft)`.
- Top bar: `web/src/shared/components/TopBar.tsx` — canvas background, hairline-soft bottom border. Right slot uses the DESIGN.md `search-pill` (surface-soft pill, 40px tall, `text-body-sm` in steel).

### 6.4 Conversation and input surfaces

Reference implementations:
- `web/src/features/conversation/components/HomeScreen.tsx` — uses `cjk-safe-centered` headline + `cjk-safe-centered-constrained` subtitle, `rounded-full` pill-tab suggestion chips with `min-h-11` AAA touch target.
- `web/src/features/conversation/components/ConversationWorkspace.tsx`
- `web/src/features/conversation/components/ChatInput.tsx`
- `web/src/shared/components/SearchInput.tsx`

Rule: raw HTML controls (`input`, `textarea`, `button`) used directly must still follow token, focus, and accessibility contracts. The `search-pill` utility is the canonical surface for any nav-level search trigger.

### 6.5 Live gallery

The dev-only `/design-system` route renders the full token + primitive + signature-component gallery sourced from the live tokens. Use it as the visual regression surface when token values change.

## 7) Status and Feedback Patterns

- Status chips use `Badge` (pill, `text-caption-bold`):
  - `success` (default) — "In stock", "Verified", "Free shipping"
  - `promo-yellow` — "Limited time", "Sale" (warning yellow on ink-deep)
  - `attention` — "Almost gone", "Selling fast"
  - `critical` — "Out of stock", validation labels
  - `destructive` — `critical-strong` fill for urgent affordances
- Legacy `status-pill` + `status-*` utilities remain for dense product surfaces; for new code prefer `Badge`.
- Loading: skeleton shimmer over spinners for content surfaces; spinners stay reserved for momentary action states (button submit, inline retry).

## 8) Accessibility and Interaction Standards

- Semantic controls (`button`, `a`, form elements) over clickable wrappers.
- Touch targets: 44px floor for pill buttons (`min-h-11`) and inputs; 40×40 for `icon-circular` buttons (`min-h-11` on coarse pointers via the global override in `globals.css`).
- Focus uses `--color-fb-blue`, 2px ring with 2px offset on canvas.
- Color swatches carry a 12px clear hit zone via `p-1.5` to clear AAA.
- Reduced motion: respect `prefers-reduced-motion` and Framer Motion's `useReducedMotion`.
- CJK: see §3.8 — use `cjk-safe-centered` utilities; never flex/grid centering on CJK text containers.

## 9) Exception Policy

Narrow, explicit exceptions only:

1. **Provider brand identity UI** may use official provider colors for recognition.
   - Reference: `web/src/features/channels/components/ChannelProviderIcon.tsx`.
2. **Isolated embedded previews** (iframe content, sandboxed renders) may use local fallback colors when app CSS vars are unavailable.
3. **Pastel decorative tints** behind product cutouts (per DESIGN.md) are treated as photographic content, not system colors. Do not formalize them as tokens.

Exceptions must not be reused as general product-semantic colors.

## 10) Implementation Drift and Migration Notes

Known drift, to be normalised in subsequent passes:

1. **Overlay primitives** (`Popover`, `HoverCard`, `Select`) still use the prior `surface-overlay` chrome at 24px radius — leave as-is for now; product-feature card variants are reserved for content cards, not menus.
2. **Dark mode** values are synthesised, not from DESIGN.md. Spot-validate cobalt/critical contrast on dark canvases before shipping new dark surfaces.
3. **Optimistic VF** licensing: if/when acquired, swap `--font-montserrat` for the Optimistic loader and the `ss01, ss02` stylistic sets activate automatically.
4. **Animation timings** are not extracted from spec — current defaults: 150ms ease-out for surface transitions, 300ms ease-in-out for accordions. Codify if/when DESIGN.md adds a motion contract.
5. **Legacy dense utilities** (`status-pill`, `chip-muted`) remain for unmigrated dense product surfaces; prefer `Badge` for new code.

## 11) Governance and Update Workflow

When changing design tokens or visual standards:

1. Update [`/DESIGN.md`](../DESIGN.md) if the **spec** changes (new color role, new component, new radius tier).
2. Update token values in `web/src/app/globals.css` (`@theme`, `:root`, `.dark`) — keep parity across all three blocks.
3. Update this `design.md` for rule/contract changes (not for every value tweak).
4. Update `docs/reference/design-system.md` for token table changes.
5. Validate impacted shared primitives + the `/design-system` gallery; spot-check both light and dark themes.
6. Run `npm run build` + `npm test` from `web/`; refresh affected snapshots only after visually reviewing the diff.

## 12) Canonical Reference Map

### Spec + tokens
- [`/DESIGN.md`](../DESIGN.md) — canonical Meta-aligned spec
- `web/src/app/globals.css` — live tokens, role utilities, card chrome utilities, search-pill utility
- `web/src/app/fonts.ts` — Montserrat + Geist Mono + Noto Sans loaders
- `docs/reference/design-system.md` — token tables

### Shared shell / components
- `web/src/shared/components/Sidebar.tsx`
- `web/src/shared/components/TopBar.tsx`
- `web/src/shared/components/SearchInput.tsx`
- `web/src/shared/components/CommandPalette.tsx`

### Shared UI primitives
- `web/src/shared/components/ui/button.tsx`
- `web/src/shared/components/ui/card.tsx`
- `web/src/shared/components/ui/input.tsx`
- `web/src/shared/components/ui/badge.tsx`
- `web/src/shared/components/ui/tabs.tsx`
- `web/src/shared/components/ui/dialog.tsx`, `alert-dialog.tsx`, `dropdown-menu.tsx`, `select.tsx`, `popover.tsx`, `hover-card.tsx`

### Signature components
- `web/src/shared/components/marketing/promo-banner.tsx`
- `web/src/shared/components/marketing/hero-band.tsx`
- `web/src/shared/components/marketing/feature-icon-row.tsx`
- `web/src/shared/components/marketing/footer-region.tsx`
- `web/src/shared/components/marketing/color-swatch.tsx`

### Feature exemplars
- `web/src/app/design-system/page.tsx` — live gallery (dev-only)
- `web/src/features/conversation/components/HomeScreen.tsx` — CJK-safe centered hero (`cjk-safe-centered*`) + pill-tab chips
- `web/src/features/conversation/components/ConversationWorkspace.tsx`
- `web/src/features/conversation/components/ChatInput.tsx`
- `web/src/features/agent-computer/components/AgentProgressCard.tsx`
- `web/src/features/agent-computer/components/ArtifactFilesPanel.tsx`
- `web/src/features/skills/components/SkillsPage.tsx`
- `web/src/features/mcp/components/MCPPage.tsx`
- `web/src/features/channels/components/ChannelPageHeader.tsx`
- `web/src/features/channels/components/ChannelProviderIcon.tsx`
