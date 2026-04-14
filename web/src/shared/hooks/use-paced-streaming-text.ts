"use client";

import { useEffect, useRef, useState } from "react";

const STREAM_PACE_INTERVAL_MS = 48;
const STREAM_MIN_CHUNK = 12;
const STREAM_MAX_CHUNK = 48;

export function getPacedStreamingChunkSize(backlog: number): number {
  if (backlog <= STREAM_MIN_CHUNK) {
    return backlog;
  }

  const scaled = Math.ceil(backlog / 6);
  return Math.max(STREAM_MIN_CHUNK, Math.min(STREAM_MAX_CHUNK, scaled));
}

export function getNextPacedStreamingText(currentText: string, targetText: string): string {
  if (!targetText.startsWith(currentText)) {
    return targetText;
  }

  if (currentText.length >= targetText.length) {
    return currentText;
  }

  const backlog = targetText.length - currentText.length;
  const nextLength = currentText.length + getPacedStreamingChunkSize(backlog);
  return targetText.slice(0, nextLength);
}

export function usePacedStreamingText(targetText: string, isStreaming: boolean): string {
  const [displayText, setDisplayText] = useState(targetText);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setDisplayText(targetText);
      return;
    }

    setDisplayText((current) => {
      if (!targetText.startsWith(current)) {
        return targetText;
      }
      return current;
    });

    if (intervalRef.current !== null) {
      return;
    }

    intervalRef.current = setInterval(() => {
      setDisplayText((current) => {
        if (!isStreaming) {
          return targetText;
        }

        if (!targetText.startsWith(current)) {
          return targetText;
        }

        if (current.length >= targetText.length) {
          return current;
        }

        return getNextPacedStreamingText(current, targetText);
      });
    }, STREAM_PACE_INTERVAL_MS);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isStreaming, targetText]);

  useEffect(() => {
    if (!isStreaming) {
      return;
    }

    setDisplayText((current) => {
      if (!targetText.startsWith(current)) {
        return targetText;
      }
      return current;
    });
  }, [isStreaming, targetText]);

  return displayText;
}
