/**
 * useJobEvents — subscribes to the SSE stream for a specific job and dispatches
 * events to typed handler callbacks.
 *
 * Opens EventSource('/api/v1/events/?job_id=<id>') with JWT cookie carrying auth.
 * Cleans up on unmount or when jobId changes.
 */
import { useEffect, useRef } from 'react';

export interface JobUpdate {
  job_id: string;
  status: string;
  streaming?: boolean;
  error?: string;
}

export interface RealtimePartial {
  session_id: string;
  job_id: string;
  text: string;
  start_ms?: number;
  end_ms?: number;
}

export interface RealtimeSegment {
  session_id: string;
  job_id: string;
  segment_index: number;
  start: number;
  end: number;
  text: string;
  speaker: string;
}

export interface RealtimeSpeaker {
  session_id: string;
  job_id: string;
  original_speaker: string;
  first_seen_at: number;
}

export interface RealtimeError {
  session_id: string;
  job_id: string;
  error: string;
  recoverable: boolean;
}

export interface RealtimeEnded {
  session_id: string;
  job_id: string;
  segment_count: number;
}

interface UseJobEventsHandlers {
  onJobUpdate?: (e: JobUpdate) => void;
  onRealtimePartial?: (e: RealtimePartial) => void;
  onRealtimeSegment?: (e: RealtimeSegment) => void;
  onRealtimeSpeaker?: (e: RealtimeSpeaker) => void;
  onRealtimeError?: (e: RealtimeError) => void;
  onRealtimeEnded?: (e: RealtimeEnded) => void;
}

export function useJobEvents(
  jobId: string | null,
  handlers: UseJobEventsHandlers
): void {
  // Keep handlers in a ref so we don't re-subscribe on every render.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!jobId) return;

    const es = new EventSource(`/api/v1/events/?job_id=${encodeURIComponent(jobId)}`);

    const dispatch = (raw: MessageEvent) => {
      let parsed: { type: string; payload: unknown };
      try {
        parsed = JSON.parse(raw.data);
      } catch {
        return;
      }

      const h = handlersRef.current;
      switch (parsed.type) {
        case 'job_update':
          h.onJobUpdate?.(parsed.payload as JobUpdate);
          break;
        case 'realtime_partial':
          h.onRealtimePartial?.(parsed.payload as RealtimePartial);
          break;
        case 'realtime_segment':
          h.onRealtimeSegment?.(parsed.payload as RealtimeSegment);
          break;
        case 'realtime_speaker':
          h.onRealtimeSpeaker?.(parsed.payload as RealtimeSpeaker);
          break;
        case 'realtime_error':
          h.onRealtimeError?.(parsed.payload as RealtimeError);
          break;
        case 'realtime_session_ended':
          h.onRealtimeEnded?.(parsed.payload as RealtimeEnded);
          break;
      }
    };

    es.addEventListener('message', dispatch);

    return () => {
      es.removeEventListener('message', dispatch);
      es.close();
    };
  }, [jobId]);
}
