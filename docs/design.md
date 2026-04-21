# Synapse Frontend Design Guide

This document is the canonical product UI style guide for Synapse frontend implementation.

## 1) Scope and Precedence

### Scope
- Applies to product UI in `web/src/**` (app shell, conversation, agent-computer, skills, MCP, channels, shared UI primitives).
- Does not override marketing/brand collateral docs unless explicitly noted.

### Canonical precedence
1. `web/src/app/globals.css` (live token values and utility contracts)
2. This `design.md` (rules and usage guidance)
3. Reference docs and audits (`docs/reference/design-system.md`, `docs/DESIGN_STYLE_GUIDE.md`, review reports)

If guidance conflicts, follow this order.

## 2) Design Principles

- Content-first: keep chrome restrained so conversation and artifacts stay primary.
- Token-first: use semantic tokens/utilities; avoid hardcoded product colors.
- Accessibility-first: keyboard-visible focus, semantic controls, reduced-motion support.
- Professional developer-tool aesthetic: cool neutrals, low visual noise, flat separation.
- Consistency over novelty: prefer shared primitives and repeated layout patterns.

## 3) Foundations

### 3.1 Token architecture

Token contract lives in `web/src/app/globals.css`:
- `@theme`: registers Tailwind token names
- `:root`: light-mode runtime values
- `.dark`: dark-mode runtime overrides

Keep semantic token parity across all three sections for every token change.

### 3.2 Core token groups

- Semantic UI: `background`, `foreground`, `primary`, `secondary`, `muted`, `border`, `input`, `ring`, `destructive`, `accent`
- Product-specific: `ai-*`, `sidebar-*`, `terminal-*`, `profile-ring*`
- Typography and rhythm: `--font-*`, `--text-*`, `--lh-*`
- Separation/motion: `--shadow-*`, `--animate-*`

### 3.3 Radius contract

Canonical radius scale (from implementation):
- `--radius-sm` (2px): tiny indicators
- `--radius-md` (4px): compact controls/chips/buttons
- `--radius-lg` (6px): inputs and standard controls
- `--radius-xl` (8px): panels/surfaces/overlays
- `--radius-2xl` (10px): exceptional large surfaces only

### 3.4 Focus contract

Default interactive focus pattern:
- `focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background`

Use ring-2 only when stronger emphasis is intentionally required by a component interaction pattern.

### 3.5 Typography contract

- Sans stack: Geist + Noto CJK + system fallbacks
- Mono stack: Geist Mono + system mono fallbacks
- Primary product body: `text-sm`
- Metadata: `text-caption`/`text-xs` and `text-micro`
- Avoid ad-hoc text sizes if equivalent scale token exists

## 4) Usage Rules (Do / Don't)

### Do
- Use semantic utility classes (`bg-background`, `text-foreground`, `border-border`, `ring-ring`).
- Reuse shared utilities from `globals.css`:
  - `surface-panel`
  - `surface-overlay`
  - `status-pill` + status variants
  - `chip-*`, `label-mono`, `skeleton-shimmer`
- Prefer shared primitives in `web/src/shared/components/ui`.
- Keep sidebars on `sidebar-*` tokens, not generic secondary hover/active.

### Don't
- Don't use hardcoded product hex values for generic surfaces/states.
- Don't use opacity-modified border tokens as a default strategy.
- Don't introduce bespoke focus styles when canonical focus utilities apply.
- Don't add decorative glow, blur, glass, gradients, or atmosphere layers to standard surfaces.

## 5) Surfaces and Overlay Conventions

### Surface types
- Standard panels/cards: `surface-panel`
- Floating overlays (dialogs, menus, popovers): `surface-overlay` or equivalent token-consistent classes

### Flat surface contract
- Standard surfaces are opaque and border-led.
- Standard surfaces should not add diffuse card shadows.
- Overlays may use a single crisp separation shadow from `surface-overlay`.

### Current implementation note
- `DropdownMenu`, `Select`, `Dialog`, `Popover`, and `HoverCard` should all consume `surface-overlay` or an equivalent token-consistent overlay contract.

Guideline: new overlay components should default to `surface-overlay` unless a deliberate exception is documented.

## 6) Component and Layout Conventions

### 6.1 Shared primitive layer

Core primitives (authoritative style behavior):
- `web/src/shared/components/ui/button.tsx`
- `web/src/shared/components/ui/input.tsx`
- `web/src/shared/components/ui/textarea.tsx`
- `web/src/shared/components/ui/card.tsx`
- `web/src/shared/components/ui/dialog.tsx`
- `web/src/shared/components/ui/alert-dialog.tsx`
- `web/src/shared/components/ui/dropdown-menu.tsx`
- `web/src/shared/components/ui/select.tsx`
- `web/src/shared/components/ui/tooltip.tsx`

### 6.2 App shell

- Sidebar and top bar are the canonical navigation chrome:
  - `web/src/shared/components/Sidebar.tsx`
  - `web/src/shared/components/TopBar.tsx`
- Keep shell surfaces solid and token-driven (`bg-background`, `bg-sidebar-bg`, `border-border`).
- Prefer hard dividers and active-state bars/fills over floating-card treatment.

### 6.3 Repeated page-shell pattern

Skills and MCP pages define the standard content shell:
- Header strip (icon chip + title + subtitle + status summary)
- Section heading row (title + search + primary action)
- Grid cards with empty/loading/error states

Reference implementations:
- `web/src/features/skills/components/SkillsPage.tsx`
- `web/src/features/mcp/components/MCPPage.tsx`

### 6.4 Conversation and input surfaces

Reference implementations:
- `web/src/features/conversation/components/ConversationWorkspace.tsx`
- `web/src/features/conversation/components/ChatInput.tsx`
- `web/src/shared/components/SearchInput.tsx`

Rule: if raw HTML controls (`input`, `textarea`, `button`) are used directly, they must still follow token, focus, and accessibility contracts.

## 7) Status and Feedback Patterns

- Use `status-pill` with semantic variants (`status-neutral`, `status-info`, `status-ai`, `status-ok`, `status-warn`, `status-error`).
- Use skeleton shimmer over spinner-heavy loading for content surfaces.
- Keep success/warn/error semantics consistent across pages and cards.

## 8) Accessibility and Interaction Standards

- Use semantic controls (`button`, `a`, form elements) over clickable non-semantic wrappers.
- Ensure keyboard-visible focus on all interactive elements.
- Preserve hover/focus parity for reveal-on-hover actions (`group-focus-within` with `group-hover`).
- Respect reduced motion (`prefers-reduced-motion` and Framer Motion reduced-motion integration).
- Maintain coarse-pointer minimum target guidance (44x44 behavior in global styles).

## 9) Exception Policy

Allowed exceptions must be narrow and explicit:

1. Provider brand identity UI (for recognition) may use official provider colors.
   - Current reference: `web/src/features/channels/components/ChannelProviderIcon.tsx`
2. Isolated embedded previews (e.g., iframe content) may use local fallback colors when app CSS vars are unavailable.

These exceptions must not be reused as general product-semantic colors.

## 10) Implementation Drift and Migration Notes

The following areas are known drift points and should be normalized in future UI cleanup:

1. Overlay primitive adoption: migrate `Popover`/`HoverCard` toward `surface-overlay` utility parity.
2. Focus consistency: keep ring-1 baseline consistent across custom controls and wrappers.
3. Radius consistency: avoid ad-hoc radius escalation in standard controls unless component intent requires it.
4. Utility reuse: convert repeated ad-hoc status/chip patterns to `status-pill`/`chip-*`.
5. Flat-system enforcement: do not reintroduce `backdrop-blur`, `glass-surface`, `workspace-atmosphere`, or `gradient-heading`.

## 11) Governance and Update Workflow

When changing design tokens or visual standards:

1. Update token values in `web/src/app/globals.css` (`@theme`, `:root`, `.dark`).
2. Update this `design.md` only for rule/contract changes (not for every small value tweak).
3. Validate impacted shared primitives and high-traffic feature pages.
4. Run frontend checks and visual QA in both themes.
5. Keep audits as supporting evidence, not canonical specification.

## 12) Canonical Reference Map

### Tokens and utilities
- `web/src/app/globals.css`

### Shared shell/components
- `web/src/shared/components/Sidebar.tsx`
- `web/src/shared/components/TopBar.tsx`
- `web/src/shared/components/SearchInput.tsx`
- `web/src/shared/components/CommandPalette.tsx`

### Shared UI primitives
- `web/src/shared/components/ui/button.tsx`
- `web/src/shared/components/ui/dialog.tsx`
- `web/src/shared/components/ui/alert-dialog.tsx`
- `web/src/shared/components/ui/dropdown-menu.tsx`
- `web/src/shared/components/ui/select.tsx`
- `web/src/shared/components/ui/popover.tsx`
- `web/src/shared/components/ui/hover-card.tsx`

### Feature exemplars
- `web/src/features/conversation/components/ConversationWorkspace.tsx`
- `web/src/features/conversation/components/ChatInput.tsx`
- `web/src/features/agent-computer/components/AgentProgressCard.tsx`
- `web/src/features/agent-computer/components/ArtifactFilesPanel.tsx`
- `web/src/features/skills/components/SkillsPage.tsx`
- `web/src/features/mcp/components/MCPPage.tsx`
- `web/src/features/channels/components/ChannelPageHeader.tsx`
- `web/src/features/channels/components/ChannelProviderIcon.tsx`
