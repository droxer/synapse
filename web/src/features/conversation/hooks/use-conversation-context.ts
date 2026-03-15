"use client";

import { useContext } from "react";
import {
  ConversationContext,
  type ConversationContextValue,
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
