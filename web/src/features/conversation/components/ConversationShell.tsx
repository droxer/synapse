"use client";

import { ConversationProvider } from "./ConversationProvider";
import { ConversationSidebar } from "./ConversationSidebar";
import { ConversationView } from "./ConversationView";
import { PendingAskOverlay } from "./PendingAskOverlay";

export function ConversationShell() {
  return (
    <ConversationProvider>
      <div className="flex h-screen w-screen bg-background">
        <ConversationSidebar />
        <main className="flex-1 overflow-hidden">
          <ConversationView />
        </main>
        <PendingAskOverlay />
      </div>
    </ConversationProvider>
  );
}
