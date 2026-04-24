# Frontend directory layout (`web/`)

## Stack

**Next.js 16** (App Router), **React 19**, **Tailwind CSS 4**, **Turbopack**.

## App and features

| Path | Role |
| --- | --- |
| `src/app/` | App Router routes: conversation, skills, MCP, library, channels, login |
| `src/app/font-assets/` | Bundled local font assets loaded through `next/font/local` |
| `src/features/conversation/` | Chat composer, SSE wiring, message rendering, upload flow, reconnect handling |
| `src/features/agent-computer/` | Derived agent state, progress cards, tool output renderers, artifact panels, browser/computer-use output |
| `src/features/skills/` | Installed/bundled skills UI, search/filtering, install/upload/toggle/detail pages, file browser |
| `src/features/mcp/` | MCP server list, add/edit dialog, JSON config parsing, enable/disable/remove flows |
| `src/features/channels/` | Channel UI and API |
| `src/i18n/` | Locale provider and dictionaries for `en`, `zh-CN`, and `zh-TW` |
| `src/shared/stores/app-store.ts` | Zustand persistent store |

## Agent-computer surface (detail)

| Path | Role |
| --- | --- |
| `features/agent-computer/hooks/use-agent-state.ts` | Derives messages, tool calls, plan steps, thinking blocks, task state, and artifacts from raw SSE events |
| `features/agent-computer/components/AgentProgressCard.tsx` | Timeline/progress UI for task state, skills, tools, and spawned agents |
| `features/agent-computer/components/ToolOutputRenderer.tsx` | Tool-result rendering, including rich output for browser/computer-use tools |
| `features/agent-computer/components/ArtifactFilesPanel.tsx` | Artifact browsing and preview orchestration |
| `features/agent-computer/lib/optimistic-skill-tool-calls.ts` | Optimistic UI for skill-activation tool calls before final events arrive |

## Channels feature (detail)

| Path | Role |
| --- | --- |
| `api/channel-api.ts` | List conversations, Telegram bot config, link tokens |
| `components/ChannelProviderIcon.tsx` | Provider icons (Telegram, WhatsApp, Discord, Slack, WeChat) |
| `components/ChannelConversationList.tsx` | Split list: avatar, preview, session |
| `components/ChannelChatView.tsx` | Isolated SSE chat (no global store dependency) |
| `components/TelegramLinkCard.tsx` | Bot linking UI |

## Proxy

`next.config.ts` rewrites `/api/*` → `http://localhost:8000/*` in development.

## Fonts and locale bootstrapping

`src/app/fonts.ts` loads local Geist and Noto Sans SC/TC assets from `src/app/font-assets/`. `src/app/layout.tsx` applies the font variables and uses a `beforeInteractive` script to sync the persisted locale onto `<html lang>` before hydration.

## Related

- [Chat data flow](data-flow-chat.md)
- [Channels data flow](data-flow-channels.md)
- [TypeScript style](style-typescript.md)
