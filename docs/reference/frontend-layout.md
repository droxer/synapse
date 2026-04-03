# Frontend directory layout (`web/`)

## Stack

**Next.js 15** (App Router), **React 19**, **Tailwind CSS 4**, **Turbopack**.

## App and features

| Path | Role |
| --- | --- |
| `src/app/` | Routes: conversation, skills, MCP, library, channels, login |
| `src/features/conversation/` | Chat UI, API hooks, reconnecting SSE |
| `src/features/agent-computer/` | Tool output, timelines, sub-agent status |
| `src/features/channels/` | Channel UI and API |
| `src/shared/stores/app-store.ts` | Zustand persistent store |

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

## Related

- [Chat data flow](data-flow-chat.md)
- [Channels data flow](data-flow-channels.md)
- [TypeScript style](style-typescript.md)
