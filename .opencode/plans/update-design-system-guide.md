# Plan: Update Design System Style Guide

## Goal
Update `docs/reference/design-system.md` to match actual CSS implementation, add missing documentation, and document known tech debt.

## Review Summary

A comprehensive review of the entire frontend (globals.css, 33 shadcn/ui components, 13 shared components, 13 feature components) found:
- **3 factually wrong values** in the current design-system.md
- **16 component-level radius violations**
- **10 deprecated `accent-purple` usages** across 3 files
- **3 missing `label-mono` utility usages**
- **4 shadow mismatches**
- **Zero hardcoded hex colors** in className strings (good)
- **Zero slate Tailwind utilities** in components (good)

---

## Step 1: Fix border radii table (HIGH)

**File:** `docs/reference/design-system.md` lines 13-19

The documentation lists wrong values. Update to match `globals.css` `@theme` block (lines 25-29):

| Token | OLD (wrong) | NEW (correct) |
|-------|------------|---------------|
| `--radius-sm` | 2px | 0.25rem (4px) |
| `--radius-md` | 3px | 0.375rem (6px) |
| `--radius-lg` | 4px | 0.5rem (8px) |
| `--radius-xl` | 6px | 0.75rem (12px) |
| `--radius-2xl` | 8px | 1rem (16px) |

Also fix Do/Don't table: "Use `--radius-xl` (6px)" → "Use `--radius-xl` (12px)"

## Step 2: Fix surface hierarchy table (HIGH)

**File:** `docs/reference/design-system.md` line 33

`sidebar-bg` dark value is wrong: `#2D2D30` → `#252526` (matches globals.css line 274)

## Step 3: Fix borders table (HIGH)

**File:** `docs/reference/design-system.md` lines 48-50

- `border-strong` light: `#D4D4D8` → `#DDDEE4` (matches globals.css line 194/31)
- `border-strong` dark: `#4E4E52` → `#47474C` (matches globals.css line 255)

## Step 4: Add missing color token sections (MEDIUM)

Add documentation for these token groups that exist in globals.css but are undocumented:

- **Overlay/chrome:** `overlay-border`, `overlay`, `input-glow`
- **User accent:** `user-accent`, `user-accent-dim`
- **Profile ring:** `profile-ring`, `profile-ring-hover`
- **Terminal:** `terminal-bg`, `terminal-surface`, `terminal-border`, `terminal-text`, `terminal-dim`
- **Logo:** `logo-bg`, `logo-glyph` (inverts between modes)

## Step 5: Add custom utilities section (MEDIUM)

Document all `@utility` classes defined in globals.css:

**Typography:** `text-micro`, `text-caption`, `label-mono`, `heading-display`, `brand-wordmark`
**Surfaces:** `surface-panel`, `surface-overlay`, `chip-muted`, `status-pill`
**Effects:** `skeleton-shimmer`, `dot-grid-bg`, `pb-safe`, `pb-safe-4`

## Step 6: Add font stacks and brand font (MEDIUM)

Document:
- Full `--font-sans` stack (Geist + CJK fallbacks)
- Full `--font-mono` stack (Geist Mono)
- `--font-brand-family` (Orbitron) and `brand-wordmark` usage
- CJK support via Noto Sans SC/TC
- Line height tokens (`--lh-tight`, `--lh-display`, `--lh-normal`, `--lh-relaxed`)

## Step 7: Add tech debt section (MEDIUM)

Document all component-level violations found:

### Radius violations (10 components)
- `button.tsx`: `rounded-lg` → `rounded-md`
- `dialog.tsx`: `rounded-lg` → `rounded-xl`
- `textarea.tsx`: `rounded-md` → `rounded-lg`
- `ThinkingBlock.tsx`: `rounded-lg` → `rounded-xl`
- `CommandPalette.tsx`: `rounded-lg` → `rounded-xl`
- `MarkdownRenderer.tsx`: `rounded-2xl` → `rounded-xl`
- `SkillCard.tsx`: `rounded-lg` → `surface-panel`
- `Sidebar.tsx`: nav rows `rounded-lg` → `rounded-md`
- `ChannelsOnboarding.tsx`: `rounded-2xl` → `rounded-xl`
- `ChannelsListening.tsx`: `rounded-2xl` → `rounded-xl`

### Deprecated accent-purple (3 files, 10 instances)
- `PulsingDot.tsx`: 2 instances
- `ChannelsOnboarding.tsx`: 6 instances
- `ChannelsListening.tsx`: 2 instances

### Missing label-mono (3 files)
- `MemoryTab.tsx` line 70
- `TokenUsageTab.tsx` line 115
- `AgentComputerPanel.tsx` line 232

### Shadow mismatches (3 components)
- `ThemeToggle.tsx` dropdown: `shadow-card` → `shadow-elevated`
- `CommandPalette.tsx`: `shadow-card` → `shadow-elevated`
- `SkillCard.tsx`: missing `shadow-card`

### Other
- `dropdown-menu.tsx` DropdownMenuShortcut: `text-xs tracking-widest` → `font-mono text-micro`
- `ChannelProviderIcon.tsx`: hardcoded slate `#64748B`/`#475569` → zinc equivalents
- `globals.css:66`: `--color-terminal-dim: #94A3B8` (slate) → consider zinc alternative

## Step 8: Add supplementary sections (LOW)

- **Code syntax highlighting:** document the hljs token mapping
- **Conversation/markdown styling:** document `.conversation-markdown`, `.markdown-reasoning`, streaming cursor
- **Scrollbar styling:** 4px thin scrollbars with rounded thumbs
- **Touch targets:** WCAG 2.5.8 compliance on coarse pointers (44px min)

---

## Execution

All changes are to a single file: `docs/reference/design-system.md`. The updated content is a comprehensive rewrite that:
1. Fixes all 3 factual errors
2. Adds 8 new sections
3. Includes a complete tech debt inventory
4. Maintains the same structure and tone

The full replacement content is ready to write when plan mode is exited.
