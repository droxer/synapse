import { create } from "zustand";

export interface ConversationHistoryItem {
  readonly id: string;
  readonly title: string;
  readonly status: "running" | "complete" | "error";
  readonly timestamp: number;
}

interface AppState {
  // Conversation
  readonly conversationId: string | null;
  readonly conversationHistory: readonly ConversationHistoryItem[];

  // UI
  readonly sidebarCollapsed: boolean;

  // Actions
  readonly startConversation: (conversationId: string, title: string) => void;
  readonly updateConversationStatus: (conversationId: string, status: ConversationHistoryItem["status"]) => void;
  readonly resetConversation: () => void;
  readonly toggleSidebar: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  conversationId: null,
  conversationHistory: [],
  sidebarCollapsed: false,

  startConversation: (conversationId, title) =>
    set((state) => ({
      conversationId,
      conversationHistory: [
        { id: conversationId, title: title.slice(0, 80), status: "running" as const, timestamp: Date.now() },
        ...state.conversationHistory,
      ],
    })),

  updateConversationStatus: (conversationId, status) =>
    set((state) => ({
      conversationHistory: state.conversationHistory.map((c) =>
        c.id === conversationId ? { ...c, status } : c
      ),
    })),

  resetConversation: () => set({ conversationId: null }),

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
