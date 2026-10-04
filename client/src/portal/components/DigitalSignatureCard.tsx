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
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        padding: '24px',
        marginBottom: '24px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.04)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '6px',
            backgroundColor: '#eff6ff',
            color: '#1d4ed8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <PenTool size={20} />
        </div>
        <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', margin: 0 }}>
          {t('step2Title')}
        </h3>
      </div>

      {/* Perjury Affirmation Checkbox */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          alignItems: 'flex-start',
          backgroundColor: '#f8fafc',
          padding: '16px',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
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
            cursor: disabled ? 'not-allowed' : 'pointer'
          }}
        />
        <label
          htmlFor="perjuryCheckbox"
          style={{
            fontSize: '13px',
            lineHeight: 1.6,
            color: '#334155',
            cursor: disabled ? 'not-allowed' : 'pointer'
          }}
        >
          {t('perjuryCheckbox')}
        </label>
      </div>

      {/* Signature Name Input */}
      <div style={{ marginBottom: '20px' }}>
        <label
          htmlFor="typedSignature"
          style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1e293b', marginBottom: '6px' }}
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
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: '6px',
            border: '1px solid #cbd5e1',
            fontSize: '15px',
            fontFamily: 'serif',
            fontStyle: 'italic',
            outline: 'none',
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
          color: '#64748b',
          marginBottom: '24px'
        }}
      >
        <ShieldCheck size={16} color="#059669" style={{ flexShrink: 0 }} />
        <span>{t('auditNotice')}</span>
      </div>

      {/* Submit Button */}
      <button
        type="button"
        disabled={disabled || !canSubmit || isSubmitting}
        onClick={onSubmit}
        style={{
          width: '100%',
          padding: '14px 20px',
          borderRadius: '8px',
          backgroundColor: canSubmit && !disabled ? '#1e3a8a' : '#94a3b8',
          color: '#ffffff',
          fontSize: '16px',
          fontWeight: 700,
          border: 'none',
          cursor: canSubmit && !disabled && !isSubmitting ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          transition: 'background-color 0.2s ease',
          boxShadow: canSubmit && !disabled ? '0 4px 6px rgba(30, 58, 138, 0.25)' : 'none'
        }}
      >
        {isSubmitting ? (
          <span>{t('submitting')}</span>
        ) : (
          <>
            <CheckCircle2 size={20} />
            <span>
              {t('submitButton')} {settlementAmountFormatted ? `(${settlementAmountFormatted})` : ''}
            </span>
          </>
        )}
      </button>
    </div>
  );
};
