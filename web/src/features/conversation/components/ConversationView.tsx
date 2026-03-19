"use client";

import { AnimatePresence, motion } from "framer-motion";
import { WelcomeScreen } from "./WelcomeScreen";
import { ConversationWorkspace } from "./ConversationWorkspace";
import { useConversationContext } from "../hooks/use-conversation-context";
import { useAppStore } from "@/shared/stores";

export function ConversationView() {
  const {
    conversationId,
    events,
    allMessages,
    toolCalls,
    agentStatuses,
    artifacts,
    taskState,
    thinkingContent,
    isStreaming,
    assistantPhase,
    reasoningSteps,
    currentIteration,
    isConnected,
    handleSendMessage,
    handleCreateConversation,
    handleNewConversation,
    handleCancel,
    handleRetry,
    isWaitingForAgent,
    userCancelled,
    createError,
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
          <WelcomeScreen
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
          <ConversationWorkspace
            conversationId={conversationId}
            conversationTitle={conversationTitle}
            events={events}
            messages={allMessages}
            toolCalls={toolCalls}
            agentStatuses={agentStatuses}
            artifacts={artifacts}
            taskState={taskState}
            thinkingContent={thinkingContent}
            isStreaming={isStreaming}
            assistantPhase={assistantPhase}
            reasoningSteps={reasoningSteps}
            currentIteration={currentIteration}
            isConnected={isConnected}
            onSendMessage={handleSendMessage}
            onNavigateHome={handleNewConversation}
            isWaitingForAgent={isWaitingForAgent}
            userCancelled={userCancelled}
            onCancel={handleCancel}
            onRetry={handleRetry}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
