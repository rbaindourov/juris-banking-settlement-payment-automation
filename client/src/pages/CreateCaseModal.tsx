import React, { useState, useRef, useEffect } from 'react';
import { X, Briefcase, DollarSign, Calendar, ShieldCheck } from 'lucide-react';
import { Case, FallbackPaymentMethod } from '../types';
import { caseApi } from '../services/api';

interface CreateCaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCaseCreated: (newCase: Case) => void;
}

export const CreateCaseModal: React.FC<CreateCaseModalProps> = ({
  isOpen,
  onClose,
  onCaseCreated
}) => {
  const [name, setName] = useState('');
  const [docketNumber, setDocketNumber] = useState('');
  const [lawFirmId, setLawFirmId] = useState('');
  const [settlementFundTotal, setSettlementFundTotal] = useState('');
  const [disbursementDeadline, setDisbursementDeadline] = useState('');
  const [fallbackPaymentMethod, setFallbackPaymentMethod] = useState<FallbackPaymentMethod>('physical_check');
  const [defaultLanguage, setDefaultLanguage] = useState('en');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const total = parseFloat(settlementFundTotal);
    if (isNaN(total) || total < 0) {
      setErrorMsg('Settlement fund total must be a non-negative number');
      return;
    }

    if (!disbursementDeadline) {
      setErrorMsg('Disbursement deadline is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await caseApi.createCase({
        name,
        docketNumber,
        lawFirmId: lawFirmId.trim() || undefined,
        settlementFundTotal: total,
        disbursementDeadline,
        fallbackPaymentMethod,
        defaultLanguage,
        emailTemplate: {
          subject: `Important Notice Regarding ${name}`,
          bodyHtml: `<h2>Official Notice: {{case_name}}</h2><p>Dear {{claimant_first_name}}, you are eligible for {{settlement_amount}}.</p><p><a href="{{payment_selection_link}}">Select Your Payment Method</a></p><p>Election Deadline: {{selection_deadline}}</p>`
        },
        landingPageText: {
          headline: `Welcome to the ${name} Settlement Election Portal`,
          introHtml: `<p>Please confirm your identity and select your preferred payment disbursement method.</p>`,
          faqAccordion: [
            { question: 'When is the deadline?', answer: 'Please review the case election deadline displayed on your notice.' },
            { question: 'What if I take no action?', answer: 'A physical check will be dispatched to your address on file.' }
          ],
          supportContact: 'support@juris-banking.com'
        }
      });

      onCaseCreated(res.case);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create settlement case');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      ref={modalRef}
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-case-title"
      style={{
        zIndex: 9999
      }}
    >
      <div
        className="modal-container"
        style={{
          maxWidth: '580px',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--bg-body)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Briefcase size={20} color="var(--color-primary)" aria-hidden="true" />
            <h3 id="create-case-title" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
              Create Settlement Case
            </h3>
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

        <form onSubmit={handleSubmit} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {errorMsg && (
            <div
              role="alert"
              aria-live="assertive"
              style={{
                padding: '12px 16px',
                backgroundColor: 'var(--color-danger-bg)',
                border: '1px solid var(--color-danger-border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-danger-text)',
                fontSize: '13px'
              }}
            >
              {errorMsg}
            </div>
          )}

          <div>
            <label htmlFor="caseName" style={labelStyle}>Case / Litigation Name</label>
            <input
              id="caseName"
              type="text"
              required
              placeholder="e.g. In re Nexus Consumer Privacy Settlement"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="fintech-input"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '16px' }}>
            <div>
              <label htmlFor="caseDocketNumber" style={labelStyle}>Docket / Matter Number</label>
              <input
                id="caseDocketNumber"
                type="text"
                required
                placeholder="e.g. 3:24-cv-09821"
                value={docketNumber}
                onChange={(e) => setDocketNumber(e.target.value)}
                className="fintech-input"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>

            <div>
              <label htmlFor="caseLawFirmId" style={labelStyle}>Law Firm ID</label>
              <input
                id="caseLawFirmId"
                type="text"
                placeholder="firm-law-01"
                value={lawFirmId}
                onChange={(e) => setLawFirmId(e.target.value)}
                className="fintech-input"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '16px' }}>
            <div>
              <label htmlFor="caseSettlementFundTotal" style={labelStyle}>Approved Settlement Fund ($)</label>
              <div style={{ position: 'relative' }}>
                <DollarSign
                  size={16}
                  color="var(--text-muted)"
                  aria-hidden="true"
                  style={{ position: 'absolute', left: '12px', top: '12px' }}
                />
                <input
                  id="caseSettlementFundTotal"
                  type="number"
                  step="0.01"
                  required
                  placeholder="250000.00"
                  value={settlementFundTotal}
                  onChange={(e) => setSettlementFundTotal(e.target.value)}
                  className="fintech-input"
                  style={{ paddingLeft: '34px', fontVariantNumeric: 'tabular-nums' }}
                />
              </div>
            </div>

            <div>
              <label htmlFor="caseDisbursementDeadline" style={labelStyle}>Disbursement Deadline</label>
              <div style={{ position: 'relative' }}>
                <Calendar
                  size={16}
                  color="var(--text-muted)"
                  aria-hidden="true"
                  style={{ position: 'absolute', left: '12px', top: '12px' }}
                />
                <input
                  id="caseDisbursementDeadline"
                  type="datetime-local"
                  required
                  value={disbursementDeadline}
                  onChange={(e) => setDisbursementDeadline(e.target.value)}
                  className="fintech-input"
                  style={{ paddingLeft: '34px' }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '16px' }}>
            <div>
              <label htmlFor="caseFallbackPaymentMethod" style={labelStyle}>Fallback Payment Rail</label>
              <select
                id="caseFallbackPaymentMethod"
                value={fallbackPaymentMethod}
                onChange={(e) => setFallbackPaymentMethod(e.target.value as FallbackPaymentMethod)}
                className="fintech-select"
              >
                <option value="physical_check">Mailed Physical Check</option>
                <option value="direct_deposit">Direct Deposit (ACH)</option>
                <option value="digital_card">Digital Prepaid Card</option>
                <option value="debit_card">Push to Debit Card</option>
                <option value="paypal">PayPal</option>
                <option value="venmo">Venmo</option>
                <option value="zelle">Zelle</option>
                <option value="bitcoin">Bitcoin</option>
              </select>
            </div>

            <div>
              <label htmlFor="caseDefaultLanguage" style={labelStyle}>Default Portal Language</label>
              <select
                id="caseDefaultLanguage"
                value={defaultLanguage}
                onChange={(e) => setDefaultLanguage(e.target.value)}
                className="fintech-select"
              >
                <option value="en">English (en)</option>
                <option value="es">Spanish (es)</option>
                <option value="zh">Chinese (zh)</option>
                <option value="vi">Vietnamese (vi)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <ShieldCheck size={16} aria-hidden="true" />
              {isSubmitting ? 'Creating Case...' : 'Register Case'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: '6px'
};
