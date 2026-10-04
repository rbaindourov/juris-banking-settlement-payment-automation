import React, { useState } from 'react';
import { Monitor, Smartphone, X, Globe } from 'lucide-react';

interface TemplatePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  renderedHtml: string;
  caseName: string;
  defaultViewport?: 'desktop' | 'mobile';
  supportedLanguages?: string[];
  currentLanguage?: string;
  onLanguageChange?: (lang: string) => void;
}

export const TemplatePreviewModal: React.FC<TemplatePreviewModalProps> = ({
  isOpen,
  onClose,
  renderedHtml,
  caseName,
  defaultViewport = 'desktop',
  supportedLanguages = ['en'],
  currentLanguage = 'en',
  onLanguageChange
}) => {
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>(defaultViewport);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px'
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '900px',
          height: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#f8fafc'
          }}
        >
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#0f172a' }}>
              Live Template Preview
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b' }}>
              {caseName} — Real-time dynamic merge tag evaluation
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Language Switcher */}
            {supportedLanguages.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Globe size={16} color="#64748b" />
                <select
                  value={currentLanguage}
                  onChange={(e) => onLanguageChange?.(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    backgroundColor: '#ffffff'
                  }}
                >
                  {supportedLanguages.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Viewport Toggle */}
            <div
              style={{
                display: 'flex',
                backgroundColor: '#e2e8f0',
                borderRadius: '8px',
                padding: '3px'
              }}
            >
              <button
                type="button"
                onClick={() => setViewport('desktop')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 500,
                  backgroundColor: viewport === 'desktop' ? '#ffffff' : 'transparent',
                  color: viewport === 'desktop' ? '#0f172a' : '#64748b',
                  boxShadow: viewport === 'desktop' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                <Monitor size={16} />
                Desktop
              </button>
              <button
                type="button"
                onClick={() => setViewport('mobile')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 500,
                  backgroundColor: viewport === 'mobile' ? '#ffffff' : 'transparent',
                  color: viewport === 'mobile' ? '#0f172a' : '#64748b',
                  boxShadow: viewport === 'mobile' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                <Smartphone size={16} />
                Mobile
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                padding: '4px',
                borderRadius: '6px'
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Preview Frame Container */}
        <div
          style={{
            flex: 1,
            backgroundColor: '#f1f5f9',
            overflowY: 'auto',
            padding: '24px',
            display: 'flex',
            justifyContent: 'center'
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: viewport === 'mobile' ? '375px' : '680px',
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              padding: viewport === 'mobile' ? '20px' : '32px',
              border: '1px solid #e2e8f0',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
              transition: 'max-width 0.25s ease'
            }}
          >
            <div
              className="rendered-email-content"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
