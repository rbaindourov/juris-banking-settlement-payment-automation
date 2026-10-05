import React from 'react';
import { Globe } from 'lucide-react';
import { LanguageCode } from '../types/portal.types';

interface LanguageSwitcherProps {
  currentLang: LanguageCode;
  supportedLanguages?: string[];
  onChangeLang: (lang: LanguageCode) => void;
}

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English (EN)',
  es: 'Español (ES)',
  zh: '中文 (ZH)',
  vi: 'Tiếng Việt (VI)'
};

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  currentLang,
  supportedLanguages = ['en', 'es', 'zh', 'vi'],
  onChangeLang
}) => {
  const availableLangs = ['en', 'es', 'zh', 'vi'].filter(
    (code) => supportedLanguages.includes(code) || code === 'en'
  );

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <Globe size={16} color="#475569" aria-hidden="true" />
      <select
        value={currentLang}
        onChange={(e) => onChangeLang(e.target.value as LanguageCode)}
        aria-label="Select portal language"
        className="fintech-select"
        style={{
          minHeight: '44px',
          padding: '8px 26px 8px 10px',
          fontSize: '13px',
          cursor: 'pointer',
          fontWeight: 600
        }}
      >
        {availableLangs.map((code) => (
          <option key={code} value={code}>
            {LANGUAGE_LABELS[code] || code.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
  );
};
