# Dark Mode Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Synapse UI from warm-light editorial to a dark-mode-first, keyboard-driven interface per the new design guide.

**Architecture:** Update CSS theme tokens for dark palette, swap fonts to Inter + JetBrains Mono, add Command Palette (Cmd+K), replace chat bubbles with flowing text, replace all spinners with shimmer animations, add AI glow state, and convert processing logs to terminal-style monospace format.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS 4, Framer Motion, cmdk (new), Inter/JetBrains Mono (Google Fonts)

---

## Chunk 1: Foundation (Theme + Fonts)

### Task 1: Update Design Style Guide

**Files:**
- Modify: `docs/DESIGN_STYLE_GUIDE.md`

- [ ] **Step 1: Replace DESIGN_STYLE_GUIDE.md with new dark-mode design guide**
- [ ] **Step 2: Verify file renders correctly**

### Task 2: Update Color Palette to Dark Mode

**Files:**
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Replace all theme color tokens**

Key changes:
- `--color-background`: `#FAF9F7` → `#0A0A0A`
- `--color-foreground`: `#1C1917` → `#EDEDED`
- `--color-primary`: `#1C1917` → `#FFFFFF`
- `--color-primary-foreground`: `#FAFAF9` → `#0A0A0A`
- `--color-secondary`: `#F0EEEA` → `#1A1A1A`
- `--color-muted`: `#F0EEEA` → `#1A1A1A`
- `--color-muted-foreground`: `#78716C` → `#A1A1AA`
- `--color-card`: `#FFFFFF` → `#141414`
- `--color-border`: `#E7E5E4` → `#2A2A2A`
- Add `--color-ai-glow`: `#818CF8`
- Shadows: use `rgba(0,0,0,...)` instead of `rgba(28,25,23,...)`
- Scrollbar thumb: lighter for dark bg
- Import `highlight.js/styles/github-dark.min.css` instead of github

- [ ] **Step 2: Update markdown prose styles for dark mode**
- [ ] **Step 3: Verify build compiles**

Run: `cd /Users/feihe/Workspace/Synapse/web && npm run build`

### Task 3: Swap Fonts to Inter + JetBrains Mono

**Files:**
- Modify: `web/src/app/fonts.ts`
- Modify: `web/src/app/layout.tsx`
- Modify: `web/src/app/globals.css` (font-family vars)

- [ ] **Step 1: Update fonts.ts to use Inter + JetBrains Mono**
- [ ] **Step 2: Update layout.tsx font variables**
- [ ] **Step 3: Update globals.css font-family tokens**
- [ ] **Step 4: Verify build compiles**

---

## Chunk 2: Core Components Update

### Task 4: Update Sidebar for Dark Mode

**Files:**
- Modify: `web/src/shared/components/Sidebar.tsx`

- [ ] **Step 1: Update sidebar color tokens**

Replace `bg-card` → `bg-[#141414]`, sidebar tokens → dark equivalents.

### Task 5: Update TopBar for Dark Mode

**Files:**
- Modify: `web/src/shared/components/TopBar.tsx`

- [ ] **Step 1: Update backdrop and border colors**

### Task 6: Restyle Chat Messages (No Bubbles)

**Files:**
- Modify: `web/src/features/conversation/components/ConversationWorkspace.tsx`

- [ ] **Step 1: Replace user message bubble with flowing text**

User messages: `> User query` style — bold text, no bubble, no border, no shadow.
Assistant messages: already borderless, just verify contrast.

- [ ] **Step 2: Add AI glow indicator when streaming**

When AI is active, add subtle `#818CF8` glow border or text highlight.

### Task 7: Update Welcome Screen

**Files:**
- Modify: `web/src/features/conversation/components/WelcomeScreen.tsx`

- [ ] **Step 1: Update radial glow to dark palette**
- [ ] **Step 2: Update quick action pills to dark styling**
- [ ] **Step 3: Update input card to dark surface**

### Task 8: Update ChatInput for Dark Mode

**Files:**
- Modify: `web/src/features/conversation/components/ChatInput.tsx`

- [ ] **Step 1: Update input card to dark surface styling**
- [ ] **Step 2: Update send button to white-on-black primary action**

### Task 9: Replace Spinners with Shimmer

**Files:**
- Modify: `web/src/features/conversation/components/AssistantLoadingSkeleton.tsx`
- Modify: `web/src/features/agent-computer/components/AgentComputerPanel.tsx`
- Modify: `web/src/features/agent-computer/components/AgentProgressCard.tsx`

- [ ] **Step 1: Replace all Loader2 spinning icons with shimmer animation**
- [ ] **Step 2: Add shimmer gradient for skeleton states**
- [ ] **Step 3: Convert processing logs to terminal-style monospace format**

Tool call entries should display as:
```
[✓] web_search — "query text"
[⟳] code_execution — running...
```

---

## Chunk 3: Command Palette

### Task 10: Install cmdk Package

- [ ] **Step 1: Install cmdk**

Run: `cd /Users/feihe/Workspace/Synapse/web && npm install cmdk`

### Task 11: Create Command Palette Component

**Files:**
- Create: `web/src/shared/components/CommandPalette.tsx`

- [ ] **Step 1: Build CommandPalette with cmdk**

Features:
- Floating center-screen modal with heavy blur backdrop
- Instantly focused search bar
- Recent tasks list
- Quick AI actions ("Summarize", "Generate Timeline")
- Keyboard shortcut: Cmd+K / Ctrl+K

### Task 12: Wire Command Palette into Layout

**Files:**
- Modify: `web/src/features/conversation/components/ConversationView.tsx` or shell

- [ ] **Step 1: Add global Cmd+K listener**
- [ ] **Step 2: Render CommandPalette**
- [ ] **Step 3: Verify keyboard shortcut works**
- [ ] **Step 4: Verify build compiles**

Run: `cd /Users/feihe/Workspace/Synapse/web && npm run build`
