import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import zh from '@/locales/zh/common.json';
import en from '@/locales/en/common.json';

/**
 * i18n bootstrap.  Default zh; fallback en.  Detection order:
 *   1. `localStorage['ccweb_lang']` (set eagerly when server returns user pref)
 *   2. `navigator.language` (new-user bootstrap before server round-trip)
 *
 * Server-side per-user pref lives in `~/.ccweb/user-prefs.json` under key
 * `language`; `App.tsx` fetches it on login and writes to `localStorage` so
 * detection happens synchronously on next load.  Keep the allow-list in sync
 * with `backend/src/routes/user-prefs.ts`.
 */

export const SUPPORTED_LANGUAGES = ['zh', 'en'] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

export const LANGUAGE_STORAGE_KEY = 'ccweb_lang';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      zh: { common: zh },
      en: { common: en },
    },
    fallbackLng: 'zh',
    defaultNS: 'common',
    ns: ['common'],
    // Keep i18next escaping on even though React auto-escapes — defence in
    // depth against future callers that might pipe translated strings through
    // `dangerouslySetInnerHTML`, markdown, or rich toast libs.  Interpolation
    // values like backend error reasons can contain attacker-controlled
    // content.  Cost is negligible at this catalog size.
    interpolation: { escapeValue: true },
    // Surface missing-key / missing-namespace issues during dev so the Phase 2
    // migration doesn't silently ship key-strings as UI text.
    debug: import.meta.env.DEV,
    saveMissing: import.meta.env.DEV,
    missingKeyHandler: (lngs, ns, key) => {
      console.warn(`[i18n] missing key: ${key} (ns=${ns}, lngs=${lngs.join(',')})`);
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
      convertDetectedLanguage: (lang: string): string => {
        // navigator.language returns e.g. "zh-CN" / "en-US" — collapse to
        // 2-letter.  For unsupported locales we fall back to `en` (not `zh`)
        // because en is the international lingua franca; zh is the house
        // default only for users who explicitly ship from a zh locale.
        const short = lang.slice(0, 2).toLowerCase();
        return SUPPORTED_LANGUAGES.includes(short as SupportedLanguage) ? short : 'en';
      },
    },
  });

export default i18n;
