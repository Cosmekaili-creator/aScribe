import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { FileText } from "lucide-react";
import { useLogs } from "@/features/transcription/hooks/useAudioDetail";
import { useTranslation } from "@/i18n";

interface LogsDialogProps {
    audioId: string;
    isOpen: boolean;
    onClose: (open: boolean) => void;
}

export function LogsDialog({ audioId, isOpen, onClose }: LogsDialogProps) {
    const { data: logsContent, isLoading } = useLogs(audioId);
    const { t } = useTranslation();

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-4xl w-[95vw] bg-[var(--bg-card)] border-[var(--border-subtle)] shadow-[var(--shadow-float)] max-h-[90vh] overflow-y-auto">
                <DialogHeader className="border-b border-[var(--border-subtle)] pb-4">
                    <DialogTitle className="text-[var(--text-primary)] flex items-center gap-2 text-xl font-bold tracking-tight">
                        <FileText className="h-5 w-5 text-[var(--brand-solid)]" />
                        {t('detail.logs.title')}
                    </DialogTitle>
                    <DialogDescription className="text-[var(--text-secondary)]">
                        {t('detail.logs.description')}
                    </DialogDescription>
                </DialogHeader>

                <div className="mt-4">
                    {isLoading ? (
                        <div className="py-12 flex flex-col items-center justify-center gap-4">
                            <div className="h-8 w-8 border-4 border-[var(--brand-solid)] border-t-transparent rounded-full animate-spin" />
                            <span className="text-[var(--text-tertiary)] animate-pulse">{t('detail.logs.loading')}</span>
                        </div>
                    ) : logsContent?.available === false ? (
                        <div className="py-12 text-center text-[var(--text-tertiary)]">
                            {t('detail.logs.noLogs')}
                        </div>
                    ) : (
                        <pre className="bg-[#0A0A0A] text-[#EDEDED] p-4 rounded-[var(--radius-card)] overflow-x-auto text-xs sm:text-sm font-mono leading-relaxed whitespace-pre-wrap max-h-[60vh] overflow-y-auto border border-white/10 shadow-inner">
                            {logsContent?.content || t('detail.logs.noLogsShort')}
                        </pre>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
