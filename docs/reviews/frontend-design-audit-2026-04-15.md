# Frontend Design Audit Report (Synapse + Web Guidelines)

Date: 2026-04-15
Scope: `web/src` (routes, feature UIs, shared components, shared UI primitives)
Standards: `docs/reference/design-system.md` + Web Interface Guidelines

## Coverage Summary

Reviewed subsystems:
- App shell and routing surfaces (`app/(main)`, layout, top-level pages)
- High-risk product surfaces (conversation, agent computer, channels, library, preferences)
- Shared components and primitives (`shared/components`, `shared/components/ui`)

Review dimensions:
- Token and visual-system compliance
- Accessibility and keyboard/focus behavior
- Interaction patterns and feedback quality
- Content/i18n consistency
- Cross-surface consistency and primitive reuse

## Prioritized Findings

### P1

1. Telegram settings modal is not using accessible dialog semantics
- Evidence: [TelegramLinkCard.tsx](/Users/feihe/Workspace/Synapse/web/src/features/channels/components/TelegramLinkCard.tsx:119), [TelegramLinkCard.tsx](/Users/feihe/Workspace/Synapse/web/src/features/channels/components/TelegramLinkCard.tsx:124), [TelegramLinkCard.tsx](/Users/feihe/Workspace/Synapse/web/src/features/channels/components/TelegramLinkCard.tsx:134)
- Impact: Focus is not trapped, modal semantics are not explicit (`role="dialog"` + `aria-modal`), and close control has no accessible name. This is a keyboard/screen-reader regression risk on a critical admin flow.
- Fix direction: Replace custom modal container with shared Radix dialog primitive (`Dialog`, `DialogContent`, `DialogTitle`, `DialogDescription`, `DialogClose`) and wire translated labels.

2. Text-entry focus visibility is weak/missing in key inputs
- Evidence: [ChatInput.tsx](/Users/feihe/Workspace/Synapse/web/src/features/conversation/components/ChatInput.tsx:216), [SearchInput.tsx](/Users/feihe/Workspace/Synapse/web/src/shared/components/SearchInput.tsx:17), [SearchInput.tsx](/Users/feihe/Workspace/Synapse/web/src/shared/components/SearchInput.tsx:25), [SearchInput.tsx](/Users/feihe/Workspace/Synapse/web/src/shared/components/SearchInput.tsx:32)
- Impact: Keyboard users can lose focus context in high-frequency controls (main chat composer and search), reducing usability and violating guideline expectations for visible focus.
- Fix direction: Add `focus-visible` or `focus-within` ring treatment to wrappers, and ensure clear-button focus styling is equivalent to other interactive controls.

3. Channels surface has extensive hardcoded English copy despite active i18n system
- Evidence: [ChannelConversationList.tsx](/Users/feihe/Workspace/Synapse/web/src/features/channels/components/ChannelConversationList.tsx:16), [ChannelConversationList.tsx](/Users/feihe/Workspace/Synapse/web/src/features/channels/components/ChannelConversationList.tsx:113), [ChannelPageHeader.tsx](/Users/feihe/Workspace/Synapse/web/src/features/channels/components/ChannelPageHeader.tsx:25), [ChannelsOnboarding.tsx](/Users/feihe/Workspace/Synapse/web/src/features/channels/components/ChannelsOnboarding.tsx:41), [TelegramLinkCard.tsx](/Users/feihe/Workspace/Synapse/web/src/features/channels/components/TelegramLinkCard.tsx:129)
- Impact: Mixed localized/non-localized UI causes inconsistent UX and translation regressions in non-English locales.
- Fix direction: Migrate all user-visible strings in `features/channels` to i18n keys, including status text, button labels, helper content, confirmation/error copy, and aria/title attributes.

### P2

4. Destructive flows still use native `confirm`/`alert` instead of product dialogs/toasts
- Evidence: [ChannelConversationList.tsx](/Users/feihe/Workspace/Synapse/web/src/features/channels/components/ChannelConversationList.tsx:65), [ChannelConversationList.tsx](/Users/feihe/Workspace/Synapse/web/src/features/channels/components/ChannelConversationList.tsx:80)
- Impact: Browser-native dialogs break visual consistency, are hard to localize/stylize, and provide weaker UX control.
- Fix direction: Replace with shared alert dialog + toast/error banner patterns already present in the design system.

5. Icon-only settings action lacks explicit accessible name
- Evidence: [ChannelPageHeader.tsx](/Users/feihe/Workspace/Synapse/web/src/features/channels/components/ChannelPageHeader.tsx:41)
- Impact: Tooltip text is not a reliable substitute for button accessible naming in all assistive tech paths.
- Fix direction: Add `aria-label` (localized) to the icon-only settings button.

6. Focus-ring contract drift from documented standard
- Evidence: [design-system.md](/Users/feihe/Workspace/Synapse/docs/reference/design-system.md), [button.tsx](/Users/feihe/Workspace/Synapse/web/src/shared/components/ui/button.tsx:8), [dialog.tsx](/Users/feihe/Workspace/Synapse/web/src/shared/components/ui/dialog.tsx:74)
- Impact: Global primitives currently standardize `ring-1`/offset-1, while the design-system doc specifies a stronger ring style. This creates inconsistent and potentially low-salience focus states.
- Fix direction: Align shared primitive focus styles and update consumers to one canonical focus recipe.

7. Progress primitive defaults over-emphasize chroma
- Evidence: [progress.tsx](/Users/feihe/Workspace/Synapse/web/src/shared/components/ui/progress.tsx:18), [progress.tsx](/Users/feihe/Workspace/Synapse/web/src/shared/components/ui/progress.tsx:26)
- Impact: Default `bg-primary/20` + `bg-primary` makes generic progress bars read as CTA-level emphasis instead of neutral status infrastructure.
- Fix direction: Move base track to neutral token (`bg-muted` or equivalent) and keep semantic indicator colors opt-in by context.

8. Interactive card semantics are implemented with `div role="link"` + nested controls
- Evidence: [SkillCard.tsx](/Users/feihe/Workspace/Synapse/web/src/features/skills/components/SkillCard.tsx:31), [SkillCard.tsx](/Users/feihe/Workspace/Synapse/web/src/features/skills/components/SkillCard.tsx:130)
- Impact: This pattern increases event-handling complexity and raises risk of keyboard/screen-reader inconsistencies with nested actions.
- Fix direction: Use a semantic link/button root structure with explicit sub-action zones, or split clickable regions for simpler interaction contracts.

### P3

9. Shared dialog primitive has hardcoded English close labels
- Evidence: [dialog.tsx](/Users/feihe/Workspace/Synapse/web/src/shared/components/ui/dialog.tsx:73), [dialog.tsx](/Users/feihe/Workspace/Synapse/web/src/shared/components/ui/dialog.tsx:77), [dialog.tsx](/Users/feihe/Workspace/Synapse/web/src/shared/components/ui/dialog.tsx:98)
- Impact: Reused UI primitive leaks English strings across localized surfaces.
- Fix direction: Add translatable label props or i18n hookup at call sites.

10. Relative-time/date labels in channel list are locale-agnostic copy
- Evidence: [ChannelConversationList.tsx](/Users/feihe/Workspace/Synapse/web/src/features/channels/components/ChannelConversationList.tsx:16), [ChannelConversationList.tsx](/Users/feihe/Workspace/Synapse/web/src/features/channels/components/ChannelConversationList.tsx:22)
- Impact: Time strings (`now`, `m`, `h`, `d`) and fallback date format are not tied to i18n preferences.
- Fix direction: Move to localized formatter helpers and dictionary-backed relative labels.

11. Embedded preview palette duplicates token literals outside global token source
- Evidence: [FilePreview.tsx](/Users/feihe/Workspace/Synapse/web/src/shared/components/FilePreview.tsx:144), [FilePreview.tsx](/Users/feihe/Workspace/Synapse/web/src/shared/components/FilePreview.tsx:152)
- Impact: Local duplicated color literals can drift from `globals.css` token values over time.
- Fix direction: Derive iframe palette from semantic token values (or centralize literals in one token-exported source).

## Quick Wins (Low Effort, High Impact)

1. Add missing `aria-label` to icon-only settings button in channels header.
2. Add visible focus styles (`focus-within` on wrapper + focus style on clear action) to `SearchInput`.
3. Add translated `aria-label`/title strings for dialog close controls and markdown copy button text.
4. Replace channel list `confirm`/`alert` with shared confirmation dialog and error banner/toast.

## Structural Fixes (Higher Leverage)

1. Refactor `TelegramLinkCard` modal to shared `Dialog` primitives (semantics, focus trap, escape, close action, i18n).
2. Define one canonical focus style utility and adopt it across shared UI primitives.
3. Normalize progress primitive defaults to neutral tracks and semantic indicator overrides.
4. Complete channels i18n migration and enforce with lint/check rule for hardcoded user-facing strings in feature components.

## Closure Checklist (Recheck After Fixes)

1. Keyboard-only navigation through channels setup flow, including modal open/close, tab order, and escape handling.
2. Screen reader pass for icon-only controls and modal announcements (title/description/close naming).
3. Locale switch regression pass (`en`, `zh-CN`, `zh-TW`) for channels and shared primitives.
4. Light/dark visual parity checks on chat input, search controls, progress bars, and modal surfaces.
5. Token-compliance pass to confirm no newly introduced hardcoded product colors in UI components.

---

## Design Token Compliance Addendum (Canonical: `docs/DESIGN_STYLE_GUIDE.md`)

Date: 2026-04-15
Scope: Entire `web/src` tree (`app`, `features`, `shared`)
Goal: Apply canonical design spec across docs and identify highest-impact implementation gaps.

### Severity: High (Shared primitives / shell-level impact)

1. Top bar uses disallowed translucent + blur navigation surface.
- File: `web/src/shared/components/TopBar.tsx`
- Evidence: `border-border/50`, `bg-background/95`, `backdrop-blur-sm`
- Canonical rule: top/navigation bars must use solid `bg-background` and solid borders.
- Fix direction: use `border-b border-border bg-background` and remove blur/translucency.

2. Shared dialog primitives still use opacity-modified border tokens.
- Files:
  - `web/src/shared/components/ui/dialog.tsx`
  - `web/src/shared/components/ui/alert-dialog.tsx`
  - `web/src/shared/components/ui/hover-card.tsx`
- Evidence: `border-border/80`
- Canonical rule: no opacity-modified borders.
- Fix direction: replace with `border-border` (or `border-border-strong` where intentionally emphasized).

3. Global token contract drift between implementation and canonical design guide.
- File: `web/src/app/globals.css`
- Evidence (examples): `foreground`, `border`, `destructive`, `sidebar`, dark `background` and radius scale differ from guide values.
- Impact: widespread visual drift even when components use semantic tokens.
- Fix direction: reconcile `@theme`, `:root`, `.dark` against canonical token tables.

### Severity: Medium (Feature-level consistency and accessibility)

4. Brand provider component uses hardcoded colors and inline gradients.
- File: `web/src/features/channels/components/ChannelProviderIcon.tsx`
- Evidence: `#2AABEE`, `#25D366`, `#5865F2`, inline `style={{ background: ... }}`
- Rule impact: violates strict token-only rule unless treated as explicit brand exceptions.
- Fix direction: document as approved brand exception OR define explicit provider brand tokens and consume `var(--color-*)`.

5. Focus-ring contract inconsistency in interactive controls.
- Files (examples):
  - `web/src/features/channels/components/ChannelsOnboarding.tsx`
  - `web/src/features/channels/components/TelegramLinkCard.tsx`
  - `web/src/features/channels/components/ChannelConversationList.tsx`
  - `web/src/features/agent-computer/components/AgentComputerPanel.tsx`
- Evidence: `ring-1` / `ring-offset-1` patterns, some controls missing full focus ring contract.
- Fix direction: standardize on:
  - `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`

6. Non-overlay surfaces still rely on translucent semantic fills in several high-traffic views.
- Files (examples):
  - `web/src/features/conversation/components/ThinkingBlock.tsx`
  - `web/src/features/conversation/components/ConversationWorkspace.tsx`
  - `web/src/features/preferences/PreferencesDialog.tsx`
- Evidence: token opacity blends used as primary surface strategy.
- Fix direction: prefer solid semantic surfaces (`bg-card`, `bg-background`, `bg-secondary`) and keep translucency for overlay/backdrop contexts only.

### Severity: Low (Polish)

7. Radius usage drift (`rounded-xl` / `rounded-2xl`) in places where guide prefers `rounded-lg`.
- Files (examples):
  - `web/src/shared/components/CommandPalette.tsx`
  - `web/src/shared/components/MarkdownRenderer.tsx`
  - `web/src/app/login/page.tsx`

8. Embedded preview fallback palette duplicates local color literals.
- File: `web/src/shared/components/FilePreview.tsx`
- Evidence: hardcoded preview CSS vars in iframe styles.
- Fix direction: keep as isolated fallback but align values with canonical tokens and document rationale.

## Recommended Remediation Order

1. Reconcile global tokens in `web/src/app/globals.css` to canonical guide.
2. Fix shared primitives (`dialog`, `alert-dialog`, `hover-card`) and shell (`TopBar`, sidebar border opacity).
3. Enforce focus ring contract across `features/*`.
4. Normalize high-traffic surfaces away from non-overlay blur/translucency.
5. Resolve provider-brand color strategy (tokenized brand exceptions vs strict semantic tokens).
