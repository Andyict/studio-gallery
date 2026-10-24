"use client";
import { useEffect, useRef } from "react";

export type LiveEvent = { type: string; project_id?: string; photo_id?: string | null; author_role?: string; seq?: number; kind?: string };

// Subscribes to the backend's Server-Sent Events stream. Events only describe what changed;
// handlers refetch through the normal API. After a dropped connection the browser reconnects on
// its own, and handlers receive {type:"resync"} so they can catch up on anything missed.
export function useLiveEvents(path: string | null, onEvent: (event: LiveEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!path || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api${path}`);
    let dropped = false;
    source.onopen = () => { if (dropped) handler.current({ type: "resync" }); dropped = false; };
    source.onerror = () => { dropped = true; };
    source.onmessage = e => { try { handler.current(JSON.parse(e.data)); } catch { /* ignore malformed */ } };
    return () => source.close();
  }, [path]);
}
