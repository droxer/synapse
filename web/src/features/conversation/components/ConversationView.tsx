"use client";

import { AnimatePresence, motion } from "framer-motion";
import { WelcomeScreen } from "./WelcomeScreen";
import { ConversationWorkspace } from "./ConversationWorkspace";
import { useConversationContext } from "../hooks/use-conversation-context";

export function ConversationView() {
  const {
    conversationId,
    events,
    allMessages,
    toolCalls,
    agentStatuses,
    taskState,
    thinkingContent,
    reasoningSteps,
    currentIteration,
    isConnected,
    handleSendMessage,
    handleCreateConversation,
    handleNewConversation,
  } = useConversationContext();

  const isActive = conversationId !== null;

  return (
    <AnimatePresence mode="wait">
      {!isActive ? (
        <motion.div
          key="welcome"
          className="h-full"
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.25 }}
        >
          <WelcomeScreen onSubmitTask={handleCreateConversation} />
        </motion.div>
      ) : (
        <motion.div
          key="taskview"
          className="h-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <ConversationWorkspace
            events={events}
            messages={allMessages}
            toolCalls={toolCalls}
            agentStatuses={agentStatuses}
            taskState={taskState}
            thinkingContent={thinkingContent}
            reasoningSteps={reasoningSteps}
            currentIteration={currentIteration}
            isConnected={isConnected}
            onSendMessage={handleSendMessage}
            onNavigateHome={handleNewConversation}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
