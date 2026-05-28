/**
 * LiveTranscriptPanel — real-time scrolling transcript view for the
 * RealtimeRecorderDialog.  Shows committed segments (by speaker, with
 * timestamps) and a faded "current partial" line at the bottom.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { LiveSegment } from './useRealtimeStream';
import { useTranslation } from '@/i18n';

interface LiveTranscriptPanelProps {
  segments: LiveSegment[];
  partial: string;
  speakers: string[];
  /** Custom display names keyed by original speaker label (e.g. SPEAKER_00 → "Alice"). */
  speakerNames?: Record<string, string>;
  className?: string;
}

const SPEAKER_COLORS = [
  'bg-amber-500/20 text-amber-700 dark:text-amber-400',
  'bg-sky-500/20 text-sky-700 dark:text-sky-400',
  'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400',
  'bg-violet-500/20 text-violet-700 dark:text-violet-400',
  'bg-rose-500/20 text-rose-700 dark:text-rose-400',
  'bg-orange-500/20 text-orange-700 dark:text-orange-400',
];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function LiveTranscriptPanel({
  segments,
  partial,
  speakers,
  speakerNames = {},
  className,
}: LiveTranscriptPanelProps) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  // Auto-scroll unless the user has scrolled up.
  useEffect(() => {
    if (pinnedToBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [segments, partial, pinnedToBottom]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setPinnedToBottom(atBottom);
  };

  // Speaker color helper (consistent per original label).
  const speakerColor = (label: string) => {
    const idx = speakers.indexOf(label);
    return SPEAKER_COLORS[idx % SPEAKER_COLORS.length] ?? SPEAKER_COLORS[0];
  };

  // Resolve display name: custom name if set, otherwise the original label.
  const displayName = (label: string) => speakerNames[label] || label;

  const isEmpty = segments.length === 0 && !partial;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={cn(
        'flex flex-col gap-2 overflow-y-auto p-3 rounded-xl',
        'bg-[var(--secondary)] border border-[var(--border-subtle)]',
        'text-sm text-[var(--text-primary)]',
        'min-h-[120px] max-h-[320px]',
        className
      )}
    >
      {isEmpty ? (
        <p className="text-[var(--text-tertiary)] italic self-center my-auto">
          {t('realtime.live.waiting')}
        </p>
      ) : (
        <>
          {segments.map((seg) => (
            <div key={seg.index} className="flex gap-2 items-start">
              {/* Timestamp */}
              <span className="text-xs text-[var(--text-tertiary)] shrink-0 mt-0.5 tabular-nums w-9 text-right">
                {formatTime(seg.start)}
              </span>
              {/* Speaker pill — shows custom name if the user has renamed it */}
              {seg.speaker && (
                <span
                  className={cn(
                    'text-xs font-medium px-1.5 py-0.5 rounded-full shrink-0',
                    speakerColor(seg.speaker)
                  )}
                >
                  {displayName(seg.speaker)}
                </span>
              )}
              {/* Text */}
              <span className="flex-1 leading-relaxed">{seg.text}</span>
            </div>
          ))}

          {/* Current partial — faded out */}
          {partial && (
            <div className="flex gap-2 items-start opacity-50">
              <span className="text-xs text-[var(--text-tertiary)] shrink-0 mt-0.5 w-9 text-right">
                …
              </span>
              <span className="flex-1 leading-relaxed italic">
                {partial}
                <span className="ml-1 text-xs text-[var(--text-tertiary)]">
                  {t('realtime.live.partialHint')}
                </span>
              </span>
            </div>
          )}
        </>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
