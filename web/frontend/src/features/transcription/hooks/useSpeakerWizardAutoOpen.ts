/**
 * useSpeakerWizardAutoOpen — listens on the global SSE stream for job_update
 * events with status=completed, checks if the job has >1 speaker with no
 * custom names, and if so sets pendingJobId to trigger the SpeakerWizardModal.
 *
 * Dismissed jobs are persisted in localStorage to prevent re-popping.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/features/auth/hooks/useAuth';

const DISMISSED_KEY = 'ascribe_wizard_dismissed';

function getDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // ignore
  }
  return new Set<string>();
}

function addDismissed(jobId: string): void {
  const current = getDismissed();
  current.add(jobId);
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...current]));
  } catch {
    // ignore
  }
}

export function useSpeakerWizardAutoOpen(): {
  pendingJobId: string | null;
  dismiss: () => void;
} {
  const { getAuthHeaders, isAuthenticated } = useAuth();
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const processingRef = useRef<Set<string>>(new Set());

  const checkJob = useCallback(
    async (jobId: string) => {
      if (processingRef.current.has(jobId)) return;
      if (getDismissed().has(jobId)) return;
      processingRef.current.add(jobId);

      try {
        const resp = await fetch(
          `/api/v1/transcription/${jobId}/speakers?include_samples=true`,
          { headers: getAuthHeaders() }
        );
        if (!resp.ok) return;

        const data = (await resp.json()) as {
          mappings?: { original_speaker: string; custom_name: string }[];
          samples?: Record<string, unknown[]>;
        };

        const mappings = data.mappings ?? [];
        const unnamedCount = mappings.filter((m) => !m.custom_name).length;
        const totalSpeakers = Object.keys(data.samples ?? {}).length;

        if (totalSpeakers > 1 && unnamedCount > 0) {
          setPendingJobId(jobId);
        }
      } catch {
        // ignore
      } finally {
        processingRef.current.delete(jobId);
      }
    },
    [getAuthHeaders]
  );

  useEffect(() => {
    if (!isAuthenticated) return;

    // Subscribe to the global wildcard SSE channel.
    const es = new EventSource('/api/v1/events/?job_id=*');

    const handleMessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data) as {
          type?: string;
          payload?: { job_id?: string; status?: string };
        };
        if (
          msg.type === 'job_update' &&
          msg.payload?.status === 'completed' &&
          msg.payload?.job_id
        ) {
          checkJob(msg.payload.job_id);
        }
      } catch {
        // ignore
      }
    };

    es.addEventListener('message', handleMessage);
    return () => {
      es.removeEventListener('message', handleMessage);
      es.close();
    };
  }, [isAuthenticated, checkJob]);

  const dismiss = useCallback(() => {
    if (pendingJobId) addDismissed(pendingJobId);
    setPendingJobId(null);
  }, [pendingJobId]);

  return { pendingJobId, dismiss };
}
