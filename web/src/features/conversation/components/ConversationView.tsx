"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { HomeScreen } from "./HomeScreen";
import { ConversationWorkspace } from "./ConversationWorkspace";
import { useConversationContext } from "../hooks/use-conversation-context";
import { ErrorBoundary } from "@/shared/components";
import { useAppStore } from "@/shared/stores";
import {
  shouldAutoStartPendingTask,
  shouldShowConversationWorkspace,
} from "./conversation-view-state";

export function ConversationView() {
  const pathname = usePathname();
  const {
    conversationId,
    events,
    allMessages,
    toolCalls,
    agentStatuses,
    planSteps,
    artifacts,
    taskState,
    currentThinkingEntries,
    isStreaming,
    assistantPhase,
    isConnected,
    handleSendMessage,
    handleCreateConversation,
    handleNewConversation,
    handleCancel,
    handleRetry,
    isWaitingForAgent,
    userCancelled,
    createError,
    isLoadingHistory,
  } = useConversationContext();

  const conversationTitle = useAppStore((s) =>
    s.conversationHistory.find((c) => c.id === conversationId)?.title,
  );
  const pendingNewTask = useAppStore((s) => s.pendingNewTask);
  const clearPendingNewTask = useAppStore((s) => s.clearPendingNewTask);

  const isActive = shouldShowConversationWorkspace(conversationId, isWaitingForAgent);

  useEffect(() => {
    if (!pendingNewTask) {
      return;
    }
    if (
      !shouldAutoStartPendingTask({
        pathname,
        pendingNewTask,
        isActive,
      })
    ) {
      return;
    }

    clearPendingNewTask();
    handleCreateConversation(
      pendingNewTask.prompt,
      undefined,
      pendingNewTask.skills ? [...pendingNewTask.skills] : undefined,
      pendingNewTask.usePlanner,
    );
  }, [
    pathname,
    pendingNewTask,
    isActive,
    clearPendingNewTask,
    handleCreateConversation,
  ]);

  return (
    <AnimatePresence initial={false}>
      {!isActive ? (
        <motion.div
          key="welcome"
          className="h-full"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.08 }}
        >
          <HomeScreen
            onSubmitTask={handleCreateConversation}
            error={createError}
            isLoading={isWaitingForAgent}
          />
        </motion.div>
      ) : (
        <motion.div
          key="taskview"
          className="h-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.08 }}
        >
          <ErrorBoundary>
            <ConversationWorkspace
              conversationId={conversationId}
              conversationTitle={conversationTitle}
              events={events}
              messages={allMessages}
              toolCalls={toolCalls}
              agentStatuses={agentStatuses}
              planSteps={planSteps}
              artifacts={artifacts}
              taskState={taskState}
              currentThinkingEntries={currentThinkingEntries}
              isStreaming={isStreaming}
              assistantPhase={assistantPhase}
              isConnected={isConnected}
              onSendMessage={handleSendMessage}
              onNavigateHome={handleNewConversation}
              isWaitingForAgent={isWaitingForAgent}
              userCancelled={userCancelled}
              onCancel={handleCancel}
              onRetry={handleRetry}
              isLoadingHistory={isLoadingHistory}
            />
          </ErrorBoundary>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
