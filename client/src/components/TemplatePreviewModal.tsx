import React, { useState, useRef, useEffect } from 'react';
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

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const modalEl = modalRef.current;
    if (!modalEl) return;

    const focusables = modalEl.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusables.length > 0) {
      focusables[0].focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const currentFocusables = Array.from(modalEl.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter((el) => el.offsetParent !== null);

        if (currentFocusables.length === 0) return;
        const first = currentFocusables[0];
        const last = currentFocusables[currentFocusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-modal-title"
      style={{
        zIndex: 9999
      }}
    >
      <div
        className="modal-container"
        style={{
          maxWidth: '920px',
          height: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--bg-body)',
            flexWrap: 'wrap',
            gap: '12px'
          }}
        >
          <div>
            <h3 id="preview-modal-title" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
              Live Template Preview
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              {caseName} — Real-time dynamic merge tag evaluation
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {/* Language Switcher */}
            {supportedLanguages.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Globe size={16} color="var(--text-muted)" aria-hidden="true" />
                <select
                  aria-label="Select preview language"
                  value={currentLanguage}
                  onChange={(e) => onLanguageChange?.(e.target.value)}
                  className="fintech-select"
                  style={{
                    padding: '6px 10px',
                    fontSize: '13px'
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
                backgroundColor: 'var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '3px'
              }}
            >
              <button
                type="button"
                onClick={() => setViewport('desktop')}
                aria-pressed={viewport === 'desktop'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  minHeight: '38px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                  backgroundColor: viewport === 'desktop' ? '#ffffff' : 'transparent',
                  color: viewport === 'desktop' ? 'var(--text-primary)' : 'var(--text-muted)',
                  boxShadow: viewport === 'desktop' ? 'var(--shadow-xs)' : 'none'
                }}
              >
                <Monitor size={16} aria-hidden="true" />
                Desktop
              </button>
              <button
                type="button"
                onClick={() => setViewport('mobile')}
                aria-pressed={viewport === 'mobile'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  minHeight: '38px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                  backgroundColor: viewport === 'mobile' ? '#ffffff' : 'transparent',
                  color: viewport === 'mobile' ? 'var(--text-primary)' : 'var(--text-muted)',
                  boxShadow: viewport === 'mobile' ? 'var(--shadow-xs)' : 'none'
                }}
              >
                <Smartphone size={16} aria-hidden="true" />
                Mobile
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                width: '44px',
                height: '44px',
                minWidth: '44px',
                minHeight: '44px',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <X size={20} aria-hidden="true" />
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
