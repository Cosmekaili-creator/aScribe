/**
 * SpeakerWizardModal — lets users give human names to detected speakers.
 *
 * Opens with a card per speaker showing up to 3 sample quotes so the user
 * can identify who said what.  Auto-pops after transcription completion when
 * there are multiple unnamed speakers (via useSpeakerWizardAutoOpen).
 */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useTranslation } from '@/i18n';

interface SpeakerSample {
  start: number;
  text: string;
}

interface SpeakerMapping {
  id: number;
  original_speaker: string;
  custom_name: string;
}

interface SpeakersWithSamples {
  mappings: SpeakerMapping[];
  samples: Record<string, SpeakerSample[]>;
}

interface SpeakerWizardModalProps {
  jobId: string;
  open: boolean;
  onClose: () => void;
  onSaved?: (mappings: Record<string, string>) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function SpeakerWizardModal({
  jobId,
  open,
  onClose,
  onSaved,
}: SpeakerWizardModalProps) {
  const { t } = useTranslation();
  const { getAuthHeaders } = useAuth();
  const queryClient = useQueryClient();

  // Local names per speaker: original_speaker → custom name input
  const [names, setNames] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery<SpeakersWithSamples>({
    queryKey: ['speakersWithSamples', jobId],
    queryFn: async () => {
      const resp = await fetch(
        `/api/v1/transcription/${jobId}/speakers?include_samples=true`,
        { headers: getAuthHeaders() }
      );
      if (!resp.ok) throw new Error('Failed to load speakers');
      return resp.json();
    },
    enabled: open && !!jobId,
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: async (mappings: { original_speaker: string; custom_name: string }[]) => {
      const resp = await fetch(`/api/v1/transcription/${jobId}/speakers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ mappings }),
      });
      if (!resp.ok) throw new Error('Failed to save speaker names');
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['speakers', jobId] });
      queryClient.invalidateQueries({ queryKey: ['speakersWithSamples', jobId] });
      queryClient.invalidateQueries({ queryKey: ['transcript', jobId] });
    },
  });

  const speakers = data?.mappings ?? [];

  // Initialize names from existing mappings when data first arrives.
  // This must live in a useEffect — calling setNames during render causes an
  // infinite loop when there are no custom names yet (the modal's primary use
  // case): names stays {}, condition stays true, re-renders forever.
  useEffect(() => {
    if (!data || speakers.length === 0) return;
    setNames((prev) => {
      // Don't clobber anything the user has already typed.
      if (Object.keys(prev).length > 0) return prev;
      const init: Record<string, string> = {};
      for (const m of speakers) {
        if (m.custom_name) init[m.original_speaker] = m.custom_name;
      }
      return init;
    });
  }, [data, speakers]);

  const handleSave = async () => {
    const toSave = speakers
      .filter((s) => names[s.original_speaker]?.trim())
      .map((s) => ({
        original_speaker: s.original_speaker,
        custom_name: names[s.original_speaker].trim(),
      }));

    if (toSave.length > 0) {
      await saveMutation.mutateAsync(toSave);
      const result: Record<string, string> = {};
      for (const m of toSave) result[m.original_speaker] = m.custom_name;
      onSaved?.(result);
    }
    onClose();
  };

  const speakerCount = speakers.length;
  const isSaving = saveMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg glass-card border-[var(--border-subtle)] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('speakerWizard.title')}</DialogTitle>
          <DialogDescription>
            {t('speakerWizard.description').replace('{count}', String(speakerCount))}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto flex flex-col gap-4 pr-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--brand-solid)]" />
            </div>
          ) : speakers.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)] text-center py-4">
              No speakers found
            </p>
          ) : (
            speakers.map((speaker, idx) => {
              const samples = data?.samples?.[speaker.original_speaker] ?? [];
              return (
                <div
                  key={speaker.original_speaker}
                  className="rounded-xl border border-[var(--border-subtle)] p-4 bg-[var(--bg-main)] flex flex-col gap-3"
                >
                  {/* Speaker header */}
                  <div className="flex items-center gap-3">
                    <span className="w-7 h-7 rounded-full bg-[var(--brand-light)] text-[var(--brand-solid)] flex items-center justify-center text-xs font-bold shrink-0">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-medium text-[var(--text-secondary)]">
                      {t('speakerWizard.speakerLabel').replace('{n}', String(idx + 1))}
                    </span>
                  </div>

                  {/* Sample quotes */}
                  {samples.length > 0 && (
                    <ul className="flex flex-col gap-1.5">
                      {samples.map((sample, si) => (
                        <li key={si} className="flex items-start gap-2 text-sm">
                          <span className="text-xs text-[var(--text-tertiary)] shrink-0 mt-0.5 tabular-nums">
                            {formatTime(sample.start)}
                          </span>
                          <span className="italic text-[var(--text-secondary)]">
                            "{sample.text}"
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Name input */}
                  <Input
                    placeholder={t('speakerWizard.namePlaceholder')}
                    value={names[speaker.original_speaker] ?? ''}
                    onChange={(e) =>
                      setNames((prev) => ({
                        ...prev,
                        [speaker.original_speaker]: e.target.value,
                      }))
                    }
                  />
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            {t('speakerWizard.skip')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || isLoading || speakers.length === 0}
            className="bg-[var(--brand-solid)] text-white hover:opacity-90"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('speakerWizard.saving')}
              </>
            ) : (
              t('speakerWizard.save')
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
