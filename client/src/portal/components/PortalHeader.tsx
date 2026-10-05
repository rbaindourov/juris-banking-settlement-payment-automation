import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { CasePortalData, LanguageCode } from '../types/portal.types';
import { LanguageSwitcher } from './LanguageSwitcher';
import { CountdownTimer } from './CountdownTimer';

interface PortalHeaderProps {
  caseData: CasePortalData;
  disbursementDeadline: string;
  currentLang: LanguageCode;
  onChangeLang: (lang: LanguageCode) => void;
  onExpire?: () => void;
}

export const PortalHeader: React.FC<PortalHeaderProps> = ({
  caseData,
  disbursementDeadline,
  currentLang,
  onChangeLang,
  onExpire
}) => {
  return (
    <header
      role="banner"
      style={{
        backgroundColor: '#ffffff',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '14px clamp(12px, 3vw, 24px)',
        boxShadow: 'var(--shadow-xs)',
        position: 'sticky',
        top: 0,
        zIndex: 40
      }}
    >
      <div
        style={{
          maxWidth: '1080px',
          margin: '0 auto',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px'
        }}
      >
        {/* Left: Branding & Case Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0, flex: '1 1 auto' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              boxShadow: '0 2px 6px rgba(30, 58, 138, 0.25)',
              flexShrink: 0
            }}
          >
            <ShieldCheck size={24} aria-hidden="true" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', wordBreak: 'break-word' }}>
                {caseData.name || caseData.caseName || 'Settlement Administration'}
              </span>
              {caseData.docketNumber && (
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-card-subtle)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-default)'
                  }}
                >
                  Docket: {caseData.docketNumber}
                </span>
              )}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: 'var(--color-success-text)', fontWeight: 600 }}>&bull; Verified Court-Authorized Portal</span>
              <span>&bull;</span>
              <span>Juris Banking Settlement Administration</span>
            </div>
          </div>
        </div>

        {/* Right: Countdown Timer & Language Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <CountdownTimer deadline={disbursementDeadline} onExpire={onExpire} />
          <LanguageSwitcher
            currentLang={currentLang}
            supportedLanguages={caseData.supportedLanguages}
            onChangeLang={onChangeLang}
          />
        </div>
      </div>
    </header>
  );
};
