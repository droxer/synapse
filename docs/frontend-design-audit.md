# Frontend Design Audit

Date: 2026-04-26

Framework: `ui-ux-pro-max` whole-app review for a dense, professional, flat SaaS/tool UI.

## Summary

No P0 blocking issue was found. The original high-impact findings were accessibility and interaction fundamentals: the global skip link did not work on the login route, several icon-only controls were below mobile touch-target guidance, and the dim foreground token did not meet contrast expectations where it is used as readable text. These issues have now been fixed. The agent progress and task-level DONE state use primary color, while the product logo remains a separate identity token.

## Resolution Status

- Fixed: `/login` now exposes `<main id="main">` for the global skip link.
- Fixed: compact icon buttons now have responsive 44x44px hit targets on mobile through shared button sizing and the `touch-target` utility.
- Fixed: `--color-muted-foreground-dim` now contrasts at 4.76:1 in light mode and 5.43:1 in dark mode against the app backgrounds.
- Fixed: shared progress motion now uses `duration-200`.
- Fixed: development builds now expose `/design-review`, a local authenticated-state visual fixture with both light and dark previews that bypasses OAuth only outside production.

## Review Coverage

- Static checks: design-token guardrail, lint, typecheck, targeted searches for raw palette usage, long transitions, arbitrary z-index, hardcoded color exceptions, small controls, and reduced-motion support.
- Visual browser check: `http://localhost:3000` redirected to `/login?callbackUrl=%2F`; login was inspected directly, and the new development-only `/design-review` fixture was inspected in the in-app browser for representative authenticated chat, agent-computer, DONE, progress, and artifact states in both light and dark themes.
- Static-code review: authenticated surfaces are gated by NextAuth, so skills, MCP, library, channels, command palette, sidebar, preferences, and additional artifact views were reviewed from source rather than live authenticated screenshots.
- Baseline: flat design, semantic tokens, minimal shadow, Lucide/Radix primitives, visible focus states, keyboard and screen-reader support, responsive layouts at 375/768/1024/1440.

## Automated Checks

- `npm run audit:design-tokens`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
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

## Positive Findings

- The design-token guardrail passed and already prevents raw palette classes, blur/glass regressions, diffuse shadows, hardcoded hex outside approved exceptions, and translucent shell surfaces.
- The app uses local fonts and `next/font`, avoiding web-font render blocking.
- Radix primitives are used for most complex controls, which helps keyboard and screen-reader behavior.
- Motion is largely wrapped in `MotionConfig reducedMotion="user"` and a global reduced-motion CSS rule.
- The recent task progress/DONE update is correct: task progress and task-level completion use `primary`; error stays destructive.
- Product logo colors should stay separate from task/status colors. [web/src/shared/components/Logo.tsx](../web/src/shared/components/Logo.tsx) explicitly models the logo as strict monochrome identity lockups, so it should continue using `--logo-bg` and `--logo-glyph`.

## Fix Plan

1. Done: fix the login skip-link target by adding a `main` landmark with `id="main"` to the login page.
2. Done: add shared responsive hit targets for compact icon actions and apply them to destructive/remove/download controls in attachments, artifact explorer, MCP, channels, and tooling controls.
3. Done: rebalance `--color-muted-foreground-dim` for accessible contrast.
4. Done: reduce shared progress transition duration from 500ms to 200ms.
5. Done: add a deterministic authenticated visual review harness at `/design-review` so future design audits can inspect core app states in light and dark themes without Google OAuth.

## Verification Criteria

- `npm run audit:design-tokens`, `npm run lint`, and `npm run typecheck` all pass.
- `/login` exposes a working skip-link target and main landmark.
- At 375px, icon-only controls that remain visible have at least 44x44px hit areas.
- Light and dark dim text tokens meet the intended contrast threshold, with exceptions limited to decorative glyphs.
- Shared progress animation is no longer longer than 300ms.
- Representative authenticated surfaces can be visually inspected locally in light and dark themes without relying on third-party login.
