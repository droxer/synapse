import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  fetchConversations,
  deleteConversation as apiDeleteConversation,
  type ConversationListItem,
} from "@/shared/api/conversation-list-api";

export interface ConversationHistoryItem {
  readonly id: string;
  readonly title: string;
  readonly timestamp: number;
}

function toHistoryItem(item: ConversationListItem): ConversationHistoryItem {
  return {
    id: item.id,
    title: item.title ?? "Untitled",
    timestamp: new Date(item.created_at).getTime(),
  };
}

interface AppState {
  // Conversation
  readonly conversationId: string | null;
  readonly isLiveConversation: boolean;
  readonly conversationHistory: readonly ConversationHistoryItem[];
  readonly totalConversations: number;
  readonly isLoadingHistory: boolean;

  // UI
  readonly sidebarCollapsed: boolean;
  readonly sidebarWidth: number;
  readonly sidebarOpen: boolean;

  // Actions
  readonly startConversation: (conversationId: string, title: string) => void;
  readonly updateConversationTitle: (conversationId: string, title: string) => void;
  readonly switchConversation: (conversationId: string) => void;
  readonly resumeConversation: () => void;
  readonly resetConversation: () => void;
  readonly toggleSidebar: () => void;
  readonly setSidebarWidth: (width: number) => void;
  readonly openSidebar: () => void;
  readonly closeSidebar: () => void;
  readonly loadConversations: () => Promise<void>;
  readonly loadMore: () => Promise<void>;
  readonly deleteConversation: (conversationId: string) => Promise<void>;
}

const PAGE_SIZE = 20;

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      conversationId: null,
      isLiveConversation: false,
      conversationHistory: [],
      totalConversations: 0,
      isLoadingHistory: false,
      sidebarCollapsed: false,
      sidebarWidth: 256,
      sidebarOpen: false,

      startConversation: (conversationId, title) =>
        set((state) => ({
          conversationId,
          isLiveConversation: true,
          conversationHistory: [
            { id: conversationId, title: title.slice(0, 80), timestamp: Date.now() },
            ...state.conversationHistory.filter((c) => c.id !== conversationId),
          ],
          totalConversations: state.conversationHistory.some((c) => c.id === conversationId)
            ? state.totalConversations
            : state.totalConversations + 1,
        })),

      updateConversationTitle: (conversationId, title) =>
        set((state) => ({
          conversationHistory: state.conversationHistory.map((c) =>
            c.id === conversationId ? { ...c, title } : c
          ),
        })),

      switchConversation: (conversationId) =>
        set({ conversationId, isLiveConversation: false }),

      resumeConversation: () => set({ isLiveConversation: true }),

      resetConversation: () => set({ conversationId: null, isLiveConversation: false }),

      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      setSidebarWidth: (width) =>
        set({ sidebarWidth: Math.max(200, Math.min(480, width)) }),

      openSidebar: () => set({ sidebarOpen: true }),

      closeSidebar: () => set({ sidebarOpen: false }),

      loadConversations: async () => {
        set({ isLoadingHistory: true });
        try {
          const { items, total } = await fetchConversations(
            PAGE_SIZE,
            0,
          );
          set({
            conversationHistory: items.map(toHistoryItem),
            totalConversations: total,
          });
        } catch (err) {
          console.error("[loadConversations] FAILED:", err);
        } finally {
          set({ isLoadingHistory: false });
        }
      },

      loadMore: async () => {
        const { conversationHistory, totalConversations, isLoadingHistory } = get();
        if (isLoadingHistory || conversationHistory.length >= totalConversations) return;

        set({ isLoadingHistory: true });
        try {
          const { items, total } = await fetchConversations(
            PAGE_SIZE,
            conversationHistory.length,
          );
          set((state) => ({
            conversationHistory: [
              ...state.conversationHistory,
              ...items.map(toHistoryItem).filter(
                (item) => !state.conversationHistory.some((c) => c.id === item.id),
              ),
            ],
            totalConversations: total,
          }));
        } catch (err) {
          console.error("Failed to load more conversations:", err);
        } finally {
          set({ isLoadingHistory: false });
        }
      },

      deleteConversation: async (conversationId) => {
        try {
          await apiDeleteConversation(conversationId);
          const { conversationId: activeId } = get();
          set((state) => ({
            conversationHistory: state.conversationHistory.filter(
              (c) => c.id !== conversationId,
            ),
            totalConversations: Math.max(0, state.totalConversations - 1),
          }));
          if (activeId === conversationId) {
            get().resetConversation();
          }
        } catch (err) {
          console.error("Failed to delete conversation:", err);
        }
      },
    }),
    {
      name: "synapse-app-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        conversationId: state.conversationId,
        isLiveConversation: state.isLiveConversation,
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarWidth: state.sidebarWidth,
      }),
    },
  ),
);
