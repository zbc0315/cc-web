import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { setLanguagePref } from '@/lib/api';
import { LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/lib/i18n';

/**
 * Dropdown that switches UI language (zh / en).  Applies instantly via
 * `i18n.changeLanguage`, writes to localStorage (so next load picks it up
 * synchronously), and persists to `~/.ccweb/user-prefs.json` so it follows
 * the user across devices.  Server persistence is best-effort — if it fails
 * the local change still sticks.
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  const handleChange = async (value: string) => {
    if (!SUPPORTED_LANGUAGES.includes(value as SupportedLanguage)) return;
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, value); } catch { /* */ }
    await i18n.changeLanguage(value);
    try {
      await setLanguagePref(value);
    } catch {
      toast.error(t('language.switch_failed'));
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Languages className="h-4 w-4 text-muted-foreground" />
      <Select value={i18n.language} onValueChange={handleChange}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="zh">{t('language.zh')}</SelectItem>
          <SelectItem value="en">{t('language.en')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
