# Frontend Design Audit

Date: 2026-05-05

Framework: `frontend-design` whole-app review for a dense, professional, flat developer-tool UI aligned to `docs/design.md`.

## Summary

No P0 blocking issue was found. The previous high-impact accessibility issues remain fixed: the login skip link has a main target, compact icon controls have mobile hit-target coverage, and readable semantic text tokens meet AA contrast. This pass tightened `docs/design.md` alignment further by removing standard-surface `shadow-card` usage, replacing decorative artifact gradients/blur with flat token-led previews, localizing mobile navigation labels, adding an automated WCAG contrast audit, and migrating high-traffic page headers/toggles to shared product primitives.

## Resolution Status

- Fixed: `/login` now exposes `<main id="main">` for the global skip link.
- Fixed: compact icon buttons now have responsive 44x44px hit targets on mobile through shared button sizing and the `touch-target` utility.
- Fixed: `--color-muted-foreground-dim` now contrasts at 4.76:1 in light mode and 5.43:1 in dark mode against the app backgrounds.
- Fixed: shared progress motion now uses `duration-200`.
- Fixed: development builds now expose `/design-review`, a local authenticated-state visual fixture with both light and dark previews that bypasses OAuth only outside production.
- Fixed: standard product surfaces no longer use `shadow-card`; the design-token audit now blocks future `shadow-card` utility usage outside `globals.css`.
- Fixed: artifact and theme preview surfaces no longer use decorative blur or gradient overlays where flat token-led structure is sufficient.
- Fixed: mobile navigation drawer and hamburger controls use localized accessible labels.
- Added: `npm run audit:wcag` verifies contrast for key semantic text, status, and action-token pairs in light and dark themes.
- Added: shared `ProductPageHeader`, `ProductSectionHeader`, `ProductStatCard`, and `SegmentedControl` primitives now cover Skills, MCP, Library, preferences, artifact panel toggles, and the design-review fixture.
- Added: the design-token audit now blocks arbitrary font-size/letter-spacing utilities and decorative Tailwind gradient/blur utilities in product UI.

## Review Coverage

- Static checks: design-token guardrail, WCAG contrast audit, lint, typecheck, focused `SegmentedControl` contract test, targeted searches for raw palette usage, non-overlay shadows, decorative blur/gradients, arbitrary typography drift, small controls, and reduced-motion support.
- Visual/browser status: previous pass inspected `/login` and `/design-review` in-browser. In this pass, the in-app browser backend was unavailable, so `/design-review`, `/design-review/preview/light`, and `/design-review/preview/dark` were verified by local HTTP route checks against the running dev server.
- Static-code review: authenticated surfaces are gated by NextAuth, so skills, MCP, library, channels, command palette, sidebar, preferences, and additional artifact views were reviewed from source rather than live authenticated screenshots.
- Baseline: flat design, semantic tokens, minimal shadow, Lucide/Radix primitives, visible focus states, keyboard and screen-reader support, responsive layouts at 375/768/1024/1440.

## Automated Checks

- `npm run audit:design-tokens`: passed.
- `npm run audit:wcag`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: passed, 64 suites / 404 tests.
- Route checks: `/design-review`, `/design-review/preview/light`, and `/design-review/preview/dark` returned 200 OK on the local dev server.
- Shell startup emitted local `thefuck` and `starship` permission warnings before commands; the project commands completed successfully.

## Findings

### P1 - Skip Link Has No Target On Login

Affected surface: global layout and login.

Evidence: [web/src/app/layout.tsx](../web/src/app/layout.tsx) defines a global skip link to `#main`. [web/src/app/login/page.tsx](../web/src/app/login/page.tsx) now wraps the login screen in `<main id="main">`, matching the authenticated app shell landmark pattern.

Impact: Keyboard and screen-reader users landing on `/login` previously got a skip link that moved nowhere. This violated the top-priority accessibility checklist item for skip links and landmark navigation.

Remediation: Completed by wrapping the login screen content in `<main id="main">` while keeping the visual layout unchanged.

Suggested verification: Open `/login`, tab to "Skip to main content", activate it, and confirm focus moves to the login main region. Check the DOM snapshot shows a `main` landmark.

### P1 - Mobile Touch Targets Are Too Small For Repeated Icon Controls

Affected surfaces: shared buttons, attachment chips, artifact explorer, channel and MCP icon actions.

Evidence: shared button icon variants in [web/src/shared/components/ui/button.tsx](../web/src/shared/components/ui/button.tsx) now expand to 44px on mobile. The same mobile hit-target pattern is applied to compact product actions through `touch-target` in attachment chips, artifact explorer controls, MCP toggles, channel delete actions, and shared tooling status toggles.

Impact: These controls were acceptable for dense desktop pointer use, but they missed the 44px touch-target expectation used by `ui-ux-pro-max` and Apple HIG. On mobile and tablet, users could mistap destructive or high-frequency actions like remove, delete, download, and close.

Remediation: Completed with responsive `max-md:size-11` icon button sizing and a shared `touch-target` utility that preserves dense desktop sizing above `md`.

Suggested verification: Inspect 375px and 768px layouts and confirm every actionable icon-only control has a hit area of at least 44x44px without visual overlap.

### P1 - Dim Foreground Token Fails Text Contrast In Both Themes

Affected surfaces: metadata labels, captions, timestamps, keyboard hints, status metadata, artifact details, MCP/skills/library cards, login eyebrow text.

Evidence: `--color-muted-foreground-dim` in [web/src/app/globals.css](../web/src/app/globals.css) was raised from `#94A3B8` to `#64748B` in light mode and from `#505B6E` to `#7E8899` in dark mode. Computed contrast is now 4.76:1 on white and 5.43:1 on `#0B0D12`.

Impact: Small metadata and captions were hard to read, especially on lower-quality displays or with reduced vision. Because the token is widespread, the issue affected perceived polish and accessibility across the product.

Remediation: Completed by raising the dim foreground token above normal-text AA contrast against the app backgrounds.

Suggested verification: Recalculate contrast for light and dark tokens and scan `text-muted-foreground-dim` usages for readable text versus purely decorative glyphs.

### P2 - Shared Progress Motion Is Slower Than The UI Motion Standard

Affected surfaces: all shared Radix progress bars, including agent progress card and agent computer panel.

Evidence: [web/src/shared/components/ui/progress.tsx](../web/src/shared/components/ui/progress.tsx) now uses `transition-transform duration-200 ease-out`, matching the `ui-ux-pro-max` 150-300ms micro-interaction range. The global reduced-motion media query continues to clamp transitions for users who request reduced motion.

Impact: Agent progress updates could feel delayed relative to the otherwise fast, flat UI. It was especially visible once task progress and DONE state used primary color consistently.

Remediation: Completed by changing the shared progress indicator to `duration-200`.

Suggested verification: Run the agent progress card and computer panel through planning, running, complete, and error states and confirm progress feels responsive without snapping.

### P2 - Authenticated Visual Review Needs A Deterministic Harness

Affected surfaces: chat workspace, agent-computer, skills, MCP, library, channels, command palette, preferences, artifacts.

Evidence: local browser navigation to `http://localhost:3000` redirected to `/login?callbackUrl=%2F`. Authenticated pages are protected by NextAuth in [web/src/proxy.ts](../web/src/proxy.ts), but development builds now allow `/design-review` as a deterministic local fixture route with embedded light and dark previews for representative authenticated UI states.

Impact: Static review catches many design-system issues, but whole-app visual regressions can still ship because reviewers need a real authenticated session or a mock UI harness to inspect dense states consistently.

Remediation: Completed for the first pass with a development-only `/design-review` route that renders chat, agent-computer, progress, DONE state, artifacts, and token checks in both light and dark themes without Google OAuth. Skills, MCP, channels, preferences, and additional empty/error states remain useful future fixture expansions.

Suggested verification: A reviewer can open deterministic URLs locally and capture screenshots at 375/768/1024/1440 without third-party auth.

### P2 - Standard Product Surfaces Drifted Toward Elevated/Decorative Treatment

Affected surfaces: markdown code blocks, agent progress card, preferences tabs, artifact previews, theme previews, file thumbnails, and pending ask error feedback.

Evidence: Standard product surfaces now avoid `shadow-card`; `web/scripts/audit-design-tokens.sh` blocks future `shadow-card` utility usage outside `globals.css`. Artifact previews in [web/src/features/agent-computer/components/ArtifactFilesPanel.tsx](../web/src/features/agent-computer/components/ArtifactFilesPanel.tsx) and file thumbnails in [web/src/shared/components/ArtifactExplorer/ExplorerFileList.tsx](../web/src/shared/components/ArtifactExplorer/ExplorerFileList.tsx) now use flat token-led structure instead of decorative blur/gradient overlays.

Impact: The removed effects were subtle, but they conflicted with the canonical flat surface contract in `docs/design.md`, making dense tool panels feel less consistent across light and dark themes.

Remediation: Completed by reserving elevation for overlays, keeping standard surfaces border-led, and migrating ad-hoc "new"/section labels to `status-pill` and `label-mono` utilities.

Suggested verification: Run `npm run audit:design-tokens` and inspect artifact, markdown, preferences, and progress surfaces in light and dark previews.

### P2 - Repeated Page Headers And Toggles Had Local Layout Drift

Affected surfaces: Skills, MCP, Library, preferences, artifact panel controls, and design-review fixture.

Evidence: Shared primitives in [web/src/shared/components/ProductPage.tsx](../web/src/shared/components/ProductPage.tsx) and [web/src/shared/components/SegmentedControl.tsx](../web/src/shared/components/SegmentedControl.tsx) now define the product page header rhythm, section header rhythm, stat cards, and pressed segmented controls. Skills, MCP, Library, Theme preferences, artifact panel view toggles, preferences navigation, and the design-review harness now use those primitives instead of locally assembled variants.

Impact: The previous implementations were individually close to the design system, but their spacing, icon chips, stat text, and toggle behavior drifted across pages. That made the app feel less clear, especially on mobile where headers, searches, and view controls wrap differently.

Remediation: Completed by centralizing the page primitives and migrating the highest-drift product surfaces. The segmented control uses visible labels, `aria-pressed`, shared focus rings, and `touch-target` coverage for coarse pointers.

Suggested verification: Inspect Skills, MCP, Library, preferences, artifact panel, `/design-review`, and the light/dark preview routes at 375, 390, 768, 1024, and 1440px. Confirm headers wrap predictably and segmented controls remain usable on coarse pointers.

### P2 - Mobile Navigation Labels Were Not Localized

Affected surfaces: mobile app shell and mobile drawer.

Evidence: [web/src/app/(main)/_components/MainLayoutClient.tsx](../web/src/app/%28main%29/_components/MainLayoutClient.tsx) now uses `a11y.openNavigationMenu`, and [web/src/shared/components/MobileDrawer.tsx](../web/src/shared/components/MobileDrawer.tsx) now uses `a11y.navigation`.

Impact: Screen-reader labels remained understandable in English, but they bypassed the existing i18n contract for Chinese locales.

Remediation: Completed by adding localized labels in English, Simplified Chinese, and Traditional Chinese.

Suggested verification: Switch locales and inspect accessible names for the hamburger trigger and drawer dialog.

## Positive Findings

- The design-token guardrail passed and already prevents raw palette classes, blur/glass regressions, diffuse shadows, hardcoded hex outside approved exceptions, and translucent shell surfaces.
- The app uses local fonts and `next/font`, avoiding web-font render blocking.
- Radix primitives are used for most complex controls, which helps keyboard and screen-reader behavior.
- Motion is largely wrapped in `MotionConfig reducedMotion="user"` and a global reduced-motion CSS rule.
- A local WCAG contrast audit now gives repeatable evidence for the core readable token pairs in both themes.
- The recent task progress/DONE update is correct: task progress and task-level completion use `primary`; error stays destructive.
- Product logo colors should stay separate from task/status colors. [web/src/shared/components/Logo.tsx](../web/src/shared/components/Logo.tsx) explicitly models the logo as strict monochrome identity lockups, so it should continue using `--logo-bg` and `--logo-glyph`.

## Fix Plan

1. Done: fix the login skip-link target by adding a `main` landmark with `id="main"` to the login page.
2. Done: add shared responsive hit targets for compact icon actions and apply them to destructive/remove/download controls in attachments, artifact explorer, MCP, channels, and tooling controls.
3. Done: rebalance `--color-muted-foreground-dim` for accessible contrast.
4. Done: reduce shared progress transition duration from 500ms to 200ms.
5. Done: add a deterministic authenticated visual review harness at `/design-review` so future design audits can inspect core app states in light and dark themes without Google OAuth.
6. Done: remove standard-surface `shadow-card` usage and add a guardrail to prevent it from returning.
7. Done: flatten artifact/theme preview decoration and migrate visible metadata chips/headings to shared token utilities.
8. Done: localize mobile navigation accessible labels.
9. Done: add `npm run audit:wcag` for light/dark semantic contrast checks.
10. Done: add shared product page/header/stat and segmented-control primitives, then migrate the highest-drift product surfaces.
11. Done: extend `audit-design-tokens` to catch arbitrary typography and decorative gradient/blur utilities.

## Verification Criteria

- `npm run audit:design-tokens`, `npm run lint`, and `npm run typecheck` all pass.
- `npm run audit:wcag` passes and reports AA contrast for foreground, muted, dim, primary, destructive, success, and warning token pairs in both themes.
- `/login` exposes a working skip-link target and main landmark.
- At 375px, icon-only controls that remain visible have at least 44x44px hit areas.
- Light and dark dim text tokens meet the intended contrast threshold, with exceptions limited to decorative glyphs.
- Shared progress animation is no longer longer than 300ms.
- Representative authenticated surfaces can be visually inspected locally in light and dark themes without relying on third-party login.
- Standard surfaces remain flat and border-led; elevation is limited to overlays.
- Shared page headers, section headers, stat cards, and segmented controls remain the default for new product surfaces.
