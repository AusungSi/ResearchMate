import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import type { RunEvent, RunEventsResponse, RunSummary } from "../types";

type Options = {
  taskId: string;
  runId: string;
  enabled: boolean;
  intervalMs?: number;
};

export function useRunEvents({ taskId, runId, enabled, intervalMs = 3000 }: Options) {
  const [items, setItems] = useState<RunEvent[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string>("");
  const latestSeqRef = useRef(0);

  useEffect(() => {
    setItems([]);
    setSummary(null);
    setError("");
    latestSeqRef.current = 0;
  }, [taskId, runId]);

  useEffect(() => {
    if (!enabled || !taskId || !runId) return;
    let canceled = false;

    async function sync() {
      try {
        const afterSeq = latestSeqRef.current || undefined;
        const suffix = afterSeq ? `?after_seq=${afterSeq}&limit=200` : "?limit=200";
        const data = await apiFetch<RunEventsResponse>(`/api/v1/research/tasks/${taskId}/runs/${runId}/events${suffix}`);
        if (canceled) return;
        setSummary(data.summary);
        if (!data.items.length) return;
        latestSeqRef.current = Math.max(latestSeqRef.current, data.summary?.latest_seq || 0, ...data.items.map((item) => item.seq));
        setItems((current) => {
          const merged = new Map<number, RunEvent>();
          for (const item of current) merged.set(item.seq, item);
          for (const item of data.items) merged.set(item.seq, item);
          return [...merged.values()].sort((a, b) => a.seq - b.seq);
        });
      } catch (cause) {
        if (canceled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }

    sync();
    const timer = window.setInterval(sync, intervalMs);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs, runId, taskId]);

  return useMemo(
    () => ({
      items,
      summary,
      error,
    }),
    [error, items, summary],
  );
}
