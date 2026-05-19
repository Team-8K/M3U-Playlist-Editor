import { useState, useCallback, useRef } from "react";
import { Channel } from "@/lib/m3u";

const MAX_HISTORY = 50;

export function useHistory(initial: Channel[]) {
  const [channels, setChannelsState] = useState<Channel[]>(initial);
  const past   = useRef<Channel[][]>([]);
  const future = useRef<Channel[][]>([]);

  /** Push a new state — clears redo stack */
  const setChannels = useCallback((
    updater: Channel[] | ((prev: Channel[]) => Channel[])
  ) => {
    setChannelsState(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // Don't push if nothing changed
      if (next === prev) return prev;
      past.current.push(prev);
      if (past.current.length > MAX_HISTORY) past.current.shift();
      future.current = [];
      return next;
    });
  }, []);

  /** Overwrite current state without touching history (used on initial load) */
  const resetChannels = useCallback((next: Channel[]) => {
    past.current   = [];
    future.current = [];
    setChannelsState(next);
  }, []);

  const canUndo = past.current.length > 0;
  const canRedo = future.current.length > 0;

  const undo = useCallback(() => {
    if (!past.current.length) return;
    setChannelsState(current => {
      const prev = past.current.pop()!;
      future.current.push(current);
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    if (!future.current.length) return;
    setChannelsState(current => {
      const next = future.current.pop()!;
      past.current.push(current);
      return next;
    });
  }, []);

  return { channels, setChannels, resetChannels, undo, redo, canUndo, canRedo };
}
