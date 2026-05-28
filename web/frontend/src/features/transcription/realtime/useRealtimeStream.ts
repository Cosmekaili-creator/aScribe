/**
 * useRealtimeStream — orchestrates the real-time transcription pipeline:
 *
 *   1. POST /realtime/start  → job_id, session_id, ws_url
 *   2. Open WS + AudioContext → stream PCM-16 frames via AudioWorklet
 *   3. Receive SSE events for the job → update live segments / partial
 *   4. stop() → send stop control msg, disconnect audio, close WS
 *   5. finalize(blob) → POST multipart audio to /realtime/:id/finalize
 */
import { useState, useRef, useCallback } from 'react';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useQueryClient } from '@tanstack/react-query';
import { useJobEvents } from '../hooks/useJobEvents';
import type { RealtimeSegment } from '../hooks/useJobEvents';

export interface LiveSegment {
  index: number;
  start: number;
  end: number;
  text: string;
  speaker: string;
}

export type StreamStatus =
  | 'idle'
  | 'starting'
  | 'streaming'
  | 'stopping'
  | 'ended'
  | 'error';

export interface RealtimeStreamOptions {
  provider: 'assemblyai' | 'deepgram';
  language?: string;
  diarize?: boolean;
  title?: string;
  apiKey?: string;
}

export interface UseRealtimeStreamResult {
  status: StreamStatus;
  jobId: string | null;
  sessionId: string | null;
  segments: LiveSegment[];
  partial: string;
  speakers: string[]; // first-seen normalised labels
  error: string | null;
  start: (mediaStream: MediaStream, options: RealtimeStreamOptions) => Promise<void>;
  stop: () => Promise<void>;
  finalize: (audioBlob: Blob) => Promise<unknown>;
}

export function useRealtimeStream(): UseRealtimeStreamResult {
  const { token } = useAuthStore();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<StreamStatus>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [partial, setPartial] = useState('');
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Refs for mutable resources that should not trigger re-renders.
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  // Silent gain node keeps the audio graph active even without a speaker output.
  const silentGainRef = useRef<GainNode | null>(null);

  // SSE event handlers — wired up once jobId is known.
  useJobEvents(jobId, {
    onRealtimePartial: (ev) => setPartial(ev.text),
    onRealtimeSegment: (ev: RealtimeSegment) => {
      setSegments((prev) => {
        // Upsert by segment_index so we never create sparse array holes.
        // A sparse array would cause React to try to render `undefined` entries
        // and crash when accessing .start on them.
        const newSeg: LiveSegment = {
          index: ev.segment_index,
          start: ev.start,
          end: ev.end,
          text: ev.text,
          speaker: ev.speaker,
        };
        const existingIdx = prev.findIndex((s) => s.index === ev.segment_index);
        if (existingIdx >= 0) {
          // Replace in-place (e.g. provider revision of a committed segment).
          const next = [...prev];
          next[existingIdx] = newSeg;
          return next;
        }
        // Append and keep sorted by segment index so out-of-order arrivals land
        // in the right position (rare but possible when SSE reconnects mid-session).
        return [...prev, newSeg].sort((a, b) => a.index - b.index);
      });
      setPartial('');
    },
    onRealtimeSpeaker: (ev) => {
      setSpeakers((prev) => {
        if (prev.includes(ev.original_speaker)) return prev;
        return [...prev, ev.original_speaker];
      });
    },
    onRealtimeError: (ev) => {
      setError(ev.error);
      if (!ev.recoverable) setStatus('error');
    },
    onRealtimeEnded: () => {
      setStatus('ended');
    },
    onJobUpdate: (ev) => {
      if (ev.status === 'completed') setStatus('ended');
      if (ev.status === 'failed') {
        setError(ev.error ?? 'Transcription failed');
        setStatus('error');
      }
    },
  });

  const start = useCallback(
    async (mediaStream: MediaStream, options: RealtimeStreamOptions) => {
      setStatus('starting');
      setSegments([]);
      setPartial('');
      setSpeakers([]);
      setError(null);

      try {
        // 1. Create a job + upstream WS session.
        const resp = await fetch('/api/v1/transcription/realtime/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            provider: options.provider,
            language: options.language ?? '',
            diarize: options.diarize ?? true,
            title: options.title ?? null,
            api_key: options.apiKey ?? '',
          }),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error ?? 'Failed to start session');
        }

        const data = (await resp.json()) as {
          job_id: string;
          session_id: string;
          ws_url: string;
        };

        setJobId(data.job_id);
        setSessionId(data.session_id);

        // 2. Open the binary audio WebSocket.
        const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsURL = `${wsProto}//${window.location.host}${data.ws_url}&token=${encodeURIComponent(token ?? '')}`;

        const ws = new WebSocket(wsURL);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        // Wait for WS to open before attaching audio.
        // Clear error/close handlers once open to prevent stale reject closures.
        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => {
            ws.onerror = null;
            ws.onclose = null;
            resolve();
          };
          ws.onerror = () => reject(new Error('WebSocket connection failed'));
          ws.onclose = (ev) => {
            if (!ev.wasClean) reject(new Error('WebSocket closed unexpectedly'));
          };
        });

        // 3. Set up AudioContext + AudioWorklet.
        const audioCtx = new AudioContext({ sampleRate: 48000 });
        audioCtxRef.current = audioCtx;

        // Chrome may create the context in a suspended state (autoplay policy).
        // Explicitly resuming here ensures audio processing starts immediately.
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }

        // Load the worklet from /public — served as application/javascript with
        // no bundling/MIME-type issues.  See public/audioWorklet.js for details.
        await audioCtx.audioWorklet.addModule('/audioWorklet.js');

        const source = audioCtx.createMediaStreamSource(mediaStream);
        sourceNodeRef.current = source;

        const workletNode = new AudioWorkletNode(audioCtx, 'pcm-downsampler');
        workletNodeRef.current = workletNode;

        // Forward PCM chunks to the WS.
        workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(e.data);
          }
        };

        // IMPORTANT: connect through a silent GainNode (gain=0) to the
        // destination.  Chrome prunes audio nodes that don't contribute to any
        // output; without this connection the worklet's process() receives no
        // input frames and no PCM data is ever forwarded to the server.
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;
        silentGainRef.current = silentGain;

        source.connect(workletNode);
        workletNode.connect(silentGain);
        silentGain.connect(audioCtx.destination);

        setStatus('streaming');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(msg);
        setStatus('error');
      }
    },
    [token]
  );

  const stop = useCallback(async () => {
    setStatus('stopping');

    // Disconnect audio pipeline.
    workletNodeRef.current?.port.close();
    sourceNodeRef.current?.disconnect();
    workletNodeRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    silentGainRef.current = null;
    await audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    workletNodeRef.current = null;
    sourceNodeRef.current = null;

    // Signal stop to the server.
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop' }));
      ws.close(1000, 'recording stopped');
    }
    wsRef.current = null;
  }, []);

  const finalize = useCallback(
    async (audioBlob: Blob) => {
      if (!jobId) throw new Error('No active job to finalize');

      const form = new FormData();
      const ext = audioBlob.type.includes('mp4')
        ? 'mp4'
        : audioBlob.type.includes('ogg')
        ? 'ogg'
        : 'webm';
      form.append('audio', audioBlob, `recording.${ext}`);

      const resp = await fetch(`/api/v1/transcription/realtime/${jobId}/finalize`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? 'Finalize failed');
      }

      // Invalidate the audio file list so the dashboard refreshes.
      queryClient.invalidateQueries({ queryKey: ['audioFiles'] });

      return resp.json();
    },
    [jobId, token, queryClient]
  );

  return {
    status,
    jobId,
    sessionId,
    segments,
    partial,
    speakers,
    error,
    start,
    stop,
    finalize,
  };
}
