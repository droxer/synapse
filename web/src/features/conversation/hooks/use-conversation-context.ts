"use client";

import { useContext } from "react";
import {
  ConversationContext,
  ConversationStateContext,
  ConversationActionsContext,
  type ConversationContextValue,
  type ConversationStateValue,
  type ConversationActionsValue,
} from "../components/ConversationProvider";

export function useConversationContext(): ConversationContextValue {
  const context = useContext(ConversationContext);
  if (!context) {
    throw new Error(
      "useConversationContext must be used within a ConversationProvider",
    );
  }
  return context;
}

export function useConversationState(): ConversationStateValue {
  const context = useContext(ConversationStateContext);
  if (!context) {
    throw new Error(
      "useConversationState must be used within a ConversationProvider",
    );
  }
  return context;
}

export function useConversationActions(): ConversationActionsValue {
  const context = useContext(ConversationActionsContext);
  if (!context) {
    throw new Error(
      "useConversationActions must be used within a ConversationProvider",
    );
  }
  return context;
}
