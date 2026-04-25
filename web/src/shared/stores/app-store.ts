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
  readonly isRunning: boolean;
  readonly orchestratorMode: "agent" | "planner" | null;
}

export interface PendingNewTask {
  readonly prompt: string;
  readonly skills?: readonly string[];
  readonly usePlanner?: boolean;
}

export function toHistoryItem(item: ConversationListItem): ConversationHistoryItem {
  return {
    id: item.id,
    title: item.title ?? "Untitled",
    timestamp: new Date(item.created_at).getTime(),
    isRunning: item.is_running === true,
    orchestratorMode:
      item.orchestrator_mode === "agent" || item.orchestrator_mode === "planner"
        ? item.orchestrator_mode
        : null,
  };
}

interface AppState {
  // Conversation
  readonly conversationId: string | null;
  readonly isLiveConversation: boolean;
  readonly pendingNewTask: PendingNewTask | null;
  readonly pendingConversationRouteId: string | null;
  readonly conversationHistory: readonly ConversationHistoryItem[];
  readonly totalConversations: number;
  readonly isLoadingHistory: boolean;

  // UI
  readonly sidebarCollapsed: boolean;
  readonly sidebarWidth: number;
  readonly sidebarOpen: boolean;

  // Actions
  readonly startConversation: (
    conversationId: string,
    title: string,
    orchestratorMode?: "agent" | "planner" | null,
  ) => void;
  readonly updateConversationTitle: (conversationId: string, title: string) => void;
  readonly updateConversationMode: (
    conversationId: string,
    orchestratorMode: "agent" | "planner",
  ) => void;
  readonly switchConversation: (conversationId: string) => void;
  readonly resumeConversation: () => void;
  readonly resetConversation: () => void;
  readonly queuePendingNewTask: (task: PendingNewTask) => void;
  readonly clearPendingNewTask: () => void;
  readonly setPendingConversationRoute: (conversationId: string) => void;
  readonly clearPendingConversationRoute: () => void;
  readonly toggleSidebar: () => void;
  readonly setSidebarWidth: (width: number) => void;
  readonly openSidebar: () => void;
  readonly closeSidebar: () => void;
  readonly loadConversations: () => Promise<void>;
  readonly loadMore: () => Promise<void>;
  readonly deleteConversation: (conversationId: string) => Promise<void>;
  /** Bumped when conversation list may be stale vs server (e.g. after delete). Library page refetches on change. */
  readonly libraryRefetchEpoch: number;
  readonly bumpLibraryRefetch: () => void;
  /**
   * Artifact IDs removed via API this session (library or computer panel).
   * Filters event-derived artifact lists so UI matches server; library refetches on each update.
   */
  readonly deletedArtifactIds: Readonly<Record<string, true>>;
  readonly recordArtifactsDeleted: (artifactIds: readonly string[]) => void;
}

const PAGE_SIZE = 20;

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      conversationId: null,
      isLiveConversation: false,
      pendingNewTask: null,
      pendingConversationRouteId: null,
      conversationHistory: [],
      totalConversations: 0,
      isLoadingHistory: false,
      sidebarCollapsed: false,
      sidebarWidth: 256,
      sidebarOpen: false,
      libraryRefetchEpoch: 0,
      deletedArtifactIds: {},

      bumpLibraryRefetch: () =>
        set((state) => ({ libraryRefetchEpoch: state.libraryRefetchEpoch + 1 })),

      recordArtifactsDeleted: (artifactIds) => {
        if (artifactIds.length === 0) return;
        set((state) => {
          const next = { ...state.deletedArtifactIds };
          for (const id of artifactIds) next[id] = true;
          return {
            deletedArtifactIds: next,
            libraryRefetchEpoch: state.libraryRefetchEpoch + 1,
          };
        });
      },

      startConversation: (conversationId, title, orchestratorMode = null) =>
        set((state) => ({
          conversationId,
          isLiveConversation: true,
          conversationHistory: [
            {
              id: conversationId,
              title: title.slice(0, 80),
              timestamp: Date.now(),
              isRunning: true,
              orchestratorMode,
            },
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

      updateConversationMode: (conversationId, orchestratorMode) =>
        set((state) => ({
          conversationHistory: state.conversationHistory.map((c) =>
            c.id === conversationId ? { ...c, orchestratorMode } : c
          ),
        })),

      switchConversation: (conversationId) =>
        set({ conversationId, isLiveConversation: false }),

      resumeConversation: () => set({ isLiveConversation: true }),

      resetConversation: () => set({ conversationId: null, isLiveConversation: false }),

      queuePendingNewTask: (task) => set({ pendingNewTask: task }),

      clearPendingNewTask: () => set({ pendingNewTask: null }),

      setPendingConversationRoute: (conversationId) =>
        set({ pendingConversationRouteId: conversationId }),

      clearPendingConversationRoute: () => set({ pendingConversationRouteId: null }),

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
        const wasInSidebar = get().conversationHistory.some(
          (c) => c.id === conversationId,
        );
        const previousHistory = get().conversationHistory;

        if (wasInSidebar) {
          set((state) => ({
            conversationHistory: state.conversationHistory.filter(
              (c) => c.id !== conversationId,
            ),
          }));
        }

        try {
          await apiDeleteConversation(conversationId);
          const { conversationId: activeId } = get();
          set((state) => ({
            conversationHistory: state.conversationHistory.filter(
              (c) => c.id !== conversationId,
            ),
            totalConversations: Math.max(0, state.totalConversations - 1),
            libraryRefetchEpoch: state.libraryRefetchEpoch + 1,
          }));
          if (activeId === conversationId) {
            get().resetConversation();
          }
        } catch (err) {
          console.error("Failed to delete conversation:", err);
          if (wasInSidebar) {
            set({ conversationHistory: previousHistory });
          }
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
