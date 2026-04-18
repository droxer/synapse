"use client";

import { useMemo, useRef } from "react";
import { useAgentState } from "@/features/agent-computer";
import type { AgentEvent, ChatMessage } from "@/shared/types";
import { getEventKey, mergeUniqueEvents } from "../lib/merge-unique-events";
import { mergeHistoryWithEventDerivedMessages } from "../lib/merge-transcript-messages";
import { mergeHistoryWithEventDerivedArtifacts } from "../lib/merge-transcript-artifacts";
import type { ArtifactInfo } from "@/shared/types";

interface IncrementalMergeState {
  seenKeys: Set<string>;
  merged: AgentEvent[];
  historyLen: number;
  liveProcessed: number;
  historyRef: readonly AgentEvent[] | null;
}

interface ConversationTranscriptState {
  readonly effectiveEvents: AgentEvent[];
  readonly messages: ChatMessage[];
  readonly agentState: ReturnType<typeof useAgentState>;
  readonly artifacts: ArtifactInfo[];
}

function useIncrementalMerge(
  historyEvents: readonly AgentEvent[],
  liveEvents: readonly AgentEvent[],
  isLive: boolean,
): readonly AgentEvent[] {
  const stateRef = useRef<IncrementalMergeState>({
    seenKeys: new Set(),
    merged: [],
    historyLen: 0,
    liveProcessed: 0,
    historyRef: null,
  });

  return useMemo(() => {
    if (!isLive) {
      return historyEvents;
    }

    const current = stateRef.current;
    const historyChanged =
      current.historyRef !== historyEvents || current.historyLen !== historyEvents.length;

    if (historyChanged) {
      const merged = mergeUniqueEvents(historyEvents, liveEvents);
      stateRef.current = {
        seenKeys: new Set(merged.map((event) => getEventKey(event))),
        merged,
        historyLen: historyEvents.length,
        liveProcessed: liveEvents.length,
        historyRef: historyEvents,
      };
      return merged;
    }

    if (liveEvents.length <= current.liveProcessed) {
      if (liveEvents.length < current.liveProcessed) {
        const merged = mergeUniqueEvents(historyEvents, liveEvents);
        stateRef.current = {
          seenKeys: new Set(merged.map((event) => getEventKey(event))),
          merged,
          historyLen: historyEvents.length,
          liveProcessed: liveEvents.length,
          historyRef: historyEvents,
        };
        return merged;
      }

      return current.merged;
    }

    let added = false;
    for (let i = current.liveProcessed; i < liveEvents.length; i++) {
      const event = liveEvents[i];
      const key = getEventKey(event);
      if (!current.seenKeys.has(key)) {
        current.seenKeys.add(key);
        current.merged.push(event);
        added = true;
      }
    }
    current.liveProcessed = liveEvents.length;

    if (added) {
      current.merged = [...current.merged];
    }

    return current.merged;
  }, [historyEvents, isLive, liveEvents]);
}

export function useConversationTranscript(
  historyMessages: readonly ChatMessage[],
  historyEvents: readonly AgentEvent[],
  historyArtifacts: readonly ArtifactInfo[],
  liveEvents: readonly AgentEvent[],
  isLive: boolean,
): ConversationTranscriptState {
  const effectiveEvents = useIncrementalMerge(historyEvents, liveEvents, isLive);
  const agentState = useAgentState(effectiveEvents as AgentEvent[]);
  const messages = useMemo<ChatMessage[]>(() => {
    return mergeHistoryWithEventDerivedMessages(historyMessages, agentState.messages);
  }, [agentState.messages, historyMessages]);
  const artifacts = useMemo<ArtifactInfo[]>(() => {
    return mergeHistoryWithEventDerivedArtifacts(historyArtifacts, agentState.artifacts);
  }, [agentState.artifacts, historyArtifacts]);

  return {
    effectiveEvents: effectiveEvents as AgentEvent[],
    messages,
    agentState,
    artifacts,
  };
}
