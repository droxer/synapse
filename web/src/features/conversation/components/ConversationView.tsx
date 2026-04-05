"use client";

import { AnimatePresence, motion } from "framer-motion";
import { HomeScreen } from "./HomeScreen";
import { ConversationWorkspace } from "./ConversationWorkspace";
import { useConversationContext } from "../hooks/use-conversation-context";
import { ErrorBoundary } from "@/shared/components";
import { useAppStore } from "@/shared/stores";

export function ConversationView() {
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

  const isActive = conversationId !== null;

  return (
    <AnimatePresence mode="wait">
      {!isActive ? (
        <motion.div
          key="welcome"
          className="h-full"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
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
          transition={{ duration: 0.12, delay: 0.05 }}
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
