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
      <Globe size={16} color="#475569" />
      <select
        value={currentLang}
        onChange={(e) => onChangeLang(e.target.value as LanguageCode)}
        aria-label="Select portal language"
        style={{
          padding: '4px 8px',
          fontSize: '13px',
          borderRadius: '6px',
          border: '1px solid #cbd5e1',
          backgroundColor: '#ffffff',
          color: '#1e293b',
          cursor: 'pointer',
          outline: 'none',
          fontWeight: 500
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
