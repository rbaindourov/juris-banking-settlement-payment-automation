import { useState, useCallback } from 'react';
import { LanguageCode } from '../types/portal.types';
import { I18N_DICTIONARIES } from '../utils/i18nDictionaries';

export function usePortalI18n(initialLang: string = 'en') {
  const normalize = (code: string): LanguageCode => {
    const lower = (code || '').toLowerCase().trim();
    if (lower === 'es' || lower === 'zh' || lower === 'vi') return lower;
    return 'en';
  };

  const [currentLang, setCurrentLangState] = useState<LanguageCode>(() => normalize(initialLang));

  const setLang = useCallback((code: string) => {
    setCurrentLangState(normalize(code));
  }, []);

  const t = useCallback(
    (key: string): string => {
      const dict = I18N_DICTIONARIES[currentLang] || I18N_DICTIONARIES.en;
      return dict[key] || I18N_DICTIONARIES.en[key] || key;
    },
    [currentLang]
  );

  return {
    currentLang,
    setLang,
    t
  };
}
