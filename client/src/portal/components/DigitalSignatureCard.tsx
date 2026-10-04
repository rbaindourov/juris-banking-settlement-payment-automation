import React from 'react';
import { PenTool, ShieldCheck, CheckCircle2 } from 'lucide-react';

interface DigitalSignatureCardProps {
  certificationAffirmed: boolean;
  onToggleCertification: (affirmed: boolean) => void;
  signature: string;
  onChangeSignature: (signature: string) => void;
  onSubmit: () => void;
  isSubmitting?: boolean;
  canSubmit?: boolean;
  settlementAmountFormatted?: string;
  disabled?: boolean;
  t: (key: string) => string;
}

export const DigitalSignatureCard: React.FC<DigitalSignatureCardProps> = ({
  certificationAffirmed,
  onToggleCertification,
  signature,
  onChangeSignature,
  onSubmit,
  isSubmitting = false,
  canSubmit = false,
  settlementAmountFormatted,
  disabled = false,
  t
}) => {
  return (
    <div
      className="fintech-card"
      role="region"
      aria-label="Digital Signature and Affirmation"
      style={{
        padding: '28px',
        marginBottom: '28px',
        background: 'linear-gradient(180deg, #ffffff 0%, #fafbfc 100%)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--bg-active)',
            color: 'var(--color-indigo)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 4px rgba(37, 99, 235, 0.15)'
          }}
        >
          <PenTool size={20} aria-hidden="true" />
        </div>
        <div>
          <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
            {t('step2Title')}
          </h3>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Under penalty of perjury pursuant to 28 U.S.C. § 1746
          </span>
        </div>
      </div>

      {/* Perjury Affirmation Checkbox */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          alignItems: 'flex-start',
          backgroundColor: 'var(--bg-card-subtle)',
          padding: '16px 18px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)',
          marginBottom: '20px'
        }}
      >
        <input
          type="checkbox"
          id="perjuryCheckbox"
          checked={certificationAffirmed}
          disabled={disabled}
          onChange={(e) => onToggleCertification(e.target.checked)}
          style={{
            width: '18px',
            height: '18px',
            marginTop: '3px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            accentColor: 'var(--color-indigo)'
          }}
        />
        <label
          htmlFor="perjuryCheckbox"
          style={{
            fontSize: '13px',
            lineHeight: 1.6,
            color: 'var(--text-secondary)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontWeight: 500
          }}
        >
          {t('perjuryCheckbox')}
        </label>
      </div>

      {/* Signature Name Input */}
      <div style={{ marginBottom: '20px' }}>
        <label
          htmlFor="typedSignature"
          style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}
        >
          Type Your Full Legal Name (Electronic Signature)
        </label>
        <input
          type="text"
          id="typedSignature"
          disabled={disabled}
          placeholder={t('signaturePlaceholder')}
          value={signature}
          onChange={(e) => onChangeSignature(e.target.value)}
          className="fintech-input"
          style={{
            padding: '12px 14px',
            fontSize: '16px',
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            letterSpacing: '0.02em',
            boxSizing: 'border-box'
          }}
        />
      </div>

      {/* Audit Notice */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '12px',
          color: 'var(--text-muted)',
          marginBottom: '24px'
        }}
      >
        <ShieldCheck size={16} color="var(--color-success)" style={{ flexShrink: 0 }} aria-hidden="true" />
        <span>{t('auditNotice')}</span>
      </div>

      {/* Submit Button */}
      <button
        type="button"
        disabled={disabled || !canSubmit || isSubmitting}
        onClick={onSubmit}
        aria-label="Submit Settlement Election"
        style={{
          width: '100%',
          padding: '14px 20px',
          borderRadius: 'var(--radius-md)',
          backgroundColor: canSubmit && !disabled ? 'var(--color-primary)' : '#94a3b8',
          color: '#ffffff',
          fontSize: '16px',
          fontWeight: 700,
          border: 'none',
          cursor: canSubmit && !disabled && !isSubmitting ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          transition: 'all 0.15s ease',
          boxShadow: canSubmit && !disabled ? '0 4px 10px rgba(30, 58, 138, 0.25)' : 'none'
        }}
      >
        {isSubmitting ? (
          <span>{t('submitting')}</span>
        ) : (
          <>
            <CheckCircle2 size={20} aria-hidden="true" />
            <span>
              {t('submitButton')} {settlementAmountFormatted ? `(${settlementAmountFormatted})` : ''}
            </span>
          </>
        )}
      </button>
    </div>
  );
};
