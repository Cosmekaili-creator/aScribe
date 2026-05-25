import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Youtube, Download, AlertCircle, CheckCircle } from "lucide-react";
import { useYouTubeDownload } from "@/features/transcription/hooks/useAudioFiles";
import { useTranslation } from "@/i18n";

interface YouTubeDownloadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onDownloadComplete?: () => void;
}

export function YouTubeDownloadDialog({
  isOpen,
  onClose,
  onDownloadComplete
}: YouTubeDownloadDialogProps) {
  const { mutateAsync: downloadYouTube, isPending: isDownloading } = useYouTubeDownload();
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const validateYouTubeUrl = (url: string): boolean => {
    return url.includes('youtube.com') || url.includes('youtu.be');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!url.trim()) {
      setError(t('transcription.youtube.errorEmpty'));
      return;
    }

    if (!validateYouTubeUrl(url)) {
      setError(t('transcription.youtube.errorInvalid'));
      return;
    }

    setError(null);

    try {
      await downloadYouTube({ url, title });
      setSuccess(true);
      setTimeout(() => {
        handleClose();
        onDownloadComplete?.();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('transcription.youtube.errorNetwork'));
    }
  };

  const handleClose = () => {
    setTitle("");
    setError(null);
    setSuccess(false);
    onClose();
  };

  const getYouTubeVideoId = (url: string): string | null => {
    const regex = /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  };

  const videoId = getYouTubeVideoId(url);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Youtube className="h-5 w-5 text-[var(--error)]" />
            {t('transcription.youtube.title')}
          </DialogTitle>
          <DialogDescription>
            {t('transcription.youtube.description')}
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-center">
              <CheckCircle className="h-12 w-12 text-[var(--success)]" />
            </div>
            <div className="text-center">
              <h3 className="font-medium text-[var(--text-primary)] mb-2">
                {t('transcription.youtube.complete')}
              </h3>
              <p className="text-sm text-[var(--text-secondary)]">
                {t('transcription.youtube.completeDesc')}
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="youtube-url">{t('transcription.youtube.urlLabel')}</Label>
              <Input
                id="youtube-url"
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isDownloading}
              />

              {/* YouTube thumbnail preview */}
              {videoId && (
                <div className="mt-2">
                  <img
                    src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
                    alt="YouTube thumbnail"
                    className="w-full h-32 object-cover rounded-md border"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom-title">{t('transcription.youtube.titleLabel')}</Label>
              <Input
                id="custom-title"
                type="text"
                placeholder={t('transcription.youtube.titlePlaceholder')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isDownloading}
              />
              <p className="text-xs text-[var(--text-tertiary)]">
                {t('transcription.youtube.titleHint')}
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-[var(--error)]/10 border border-[var(--error)]/20 rounded-[var(--radius-input)]">
                <AlertCircle className="h-4 w-4 text-[var(--error)]" />
                <p className="text-sm text-[var(--error)]">{error}</p>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isDownloading}
              >
                {t('transcription.youtube.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={isDownloading || !url.trim()}
                className="min-w-24"
              >
                {isDownloading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    {t('transcription.youtube.downloading')}
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    {t('transcription.youtube.download')}
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}