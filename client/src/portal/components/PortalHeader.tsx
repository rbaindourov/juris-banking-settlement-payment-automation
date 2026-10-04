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
      style={{
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        padding: '16px 24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
      }}
    >
      <div
        style={{
          maxWidth: '1000px',
          margin: '0 auto',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px'
        }}
      >
        {/* Left: Branding & Case Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              backgroundColor: '#1e3a8a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              flexShrink: 0
            }}
          >
            <ShieldCheck size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                {caseData.name || caseData.caseName || 'Settlement Administration'}
              </span>
              {caseData.docketNumber && (
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    backgroundColor: '#f1f5f9',
                    color: '#475569',
                    border: '1px solid #cbd5e1'
                  }}
                >
                  Docket: {caseData.docketNumber}
                </span>
              )}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
              Official Court-Authorized Settlement Payment Portal &bull; Juris Banking
            </div>
          </div>
        </div>

        {/* Right: Controls & Timer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
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
