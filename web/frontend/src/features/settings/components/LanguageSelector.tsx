import { Globe } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation, SUPPORTED, type SupportedLanguage } from "@/i18n";

const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: "English",
  fr: "Français",
};

export function LanguageSelector() {
  const { language, setLanguage, t } = useTranslation();

  return (
    <div className="bg-[var(--bg-main)]/50 border border-[var(--border-subtle)] rounded-[var(--radius-card)] p-4 sm:p-6 shadow-sm">
      <div className="mb-4">
        <div className="flex items-center space-x-2 mb-2">
          <Globe className="h-5 w-5 text-[var(--brand-solid)]" />
          <h3 className="text-lg font-medium text-[var(--text-primary)]">
            {t("settings.language.title")}
          </h3>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">
          {t("settings.language.description")}
        </p>
      </div>
      <Select
        value={language}
        onValueChange={(v) => setLanguage(v as SupportedLanguage)}
      >
        <SelectTrigger className="h-11 rounded-[var(--radius-btn)] bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:ring-[var(--brand-light)] focus:border-[var(--brand-solid)] shadow-none w-full sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="glass-card rounded-[var(--radius-btn)] border border-[var(--border-subtle)] shadow-[var(--shadow-float)]">
          {SUPPORTED.map((lang) => (
            <SelectItem
              key={lang}
              value={lang}
              className="text-[var(--text-primary)] focus:bg-[var(--brand-light)] focus:text-[var(--brand-solid)] rounded-[8px] my-1 mx-1 cursor-pointer"
            >
              {LANGUAGE_NAMES[lang]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
