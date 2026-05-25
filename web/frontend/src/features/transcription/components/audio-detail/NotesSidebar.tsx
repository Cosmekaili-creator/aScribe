import type { Note } from "@/features/transcription/hooks/useTranscriptionNotes";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Trash2, Save, ExternalLink, Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation, useLocale } from "@/i18n";

interface NotesSidebarProps {
  notes: Note[];
  onEdit: (id: string, newContent: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onJumpTo: (time: number) => void;
}

export function NotesSidebar({ notes, onEdit, onDelete, onJumpTo }: NotesSidebarProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleEdit = (note: Note) => {
    setEditingId(note.id);
    setDraft(note.content);
  };

  const handleSave = async (id: string) => {
    if (!draft.trim()) return;
    await onEdit(id, draft);
    setEditingId(null);
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (notes.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-4 text-carbon-500 dark:text-carbon-400">
        <p>{t('detail.notes.sidebar.empty')}</p>
        <p className="text-sm mt-2">{t('detail.notes.sidebar.emptyHint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {notes.map((n) => (
        <Card key={n.id} className="p-3 bg-white dark:bg-carbon-800 border-carbon-200 dark:border-carbon-700 shadow-sm transition-all hover:shadow-md group">
          <div className="flex justify-between items-start mb-2">
            <button
              className="text-xs font-mono text-primary hover:underline flex items-center gap-1 bg-primary/10 px-1.5 py-0.5 rounded cursor-pointer transition-colors hover:bg-primary/20"
              onClick={() => onJumpTo(n.start_time)}
              title={t('detail.notes.sidebar.jumpToTimestamp')}
            >
              <ExternalLink className="inline h-3 w-3 mr-1" /> {formatTime(n.start_time)} - {formatTime(n.end_time)}
            </button>
            <span className="text-[10px] text-carbon-400">
              {n.created_at ? new Date(n.created_at).toLocaleString(locale) : ''}
            </span>
          </div>

          <blockquote className="border-l-2 border-carbon-300 dark:border-carbon-600 pl-2 mb-2 italic text-xs text-carbon-500 dark:text-carbon-400 line-clamp-2">
            "{n.quote}"
          </blockquote>
          {editingId === n.id ? (
            <div className="mt-1">
              <Textarea value={draft} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)} rows={3} />
              <div className="flex justify-end gap-2 mt-2">
                <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} className="h-7 px-2 text-xs">{t('detail.notes.sidebar.cancel')}</Button>
                <Button size="sm" onClick={() => handleSave(n.id)} className="h-7 px-2 text-xs gap-1">
                  <Save className="h-3.5 w-3.5" /> {t('detail.notes.sidebar.save')}
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-sm text-carbon-800 dark:text-carbon-100 whitespace-pre-wrap">
              {n.content}
            </p>
          )}

          {editingId !== n.id && (
            <div className="flex justify-end gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => handleCopy(n.content, n.id)} className="text-carbon-400 hover:text-carbon-600 dark:hover:text-carbon-300 transition-colors" title={t('detail.notes.sidebar.copy')}>
                {copiedId === n.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              <button onClick={() => handleEdit(n)} className="text-carbon-400 hover:text-primary transition-colors" title={t('detail.notes.sidebar.edit')}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => onDelete(n.id)} className="text-carbon-400 hover:text-red-500 transition-colors" title={t('detail.notes.sidebar.delete')}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
