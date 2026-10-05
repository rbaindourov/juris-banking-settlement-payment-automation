import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  AlertTriangle,
  Mail,
  Send,
  Building2,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import { ExceptionItem, ResolveExceptionPayload } from '../../types';
import { analyticsApi } from '../../services/api';

interface ExceptionResolutionModalProps {
  caseId: string;
  exception: ExceptionItem | null;
  isOpen: boolean;
  onClose: () => void;
  onResolved: () => void;
}

export const ExceptionResolutionModal: React.FC<ExceptionResolutionModalProps> = ({
  caseId,
  exception,
  isOpen,
  onClose,
  onResolved
}) => {
  if (!isOpen || !exception) return null;

  const [action, setAction] = useState<
    'switch_to_check' | 'resend_email' | 'requeue_sftp' | 'mark_resolved'
  >('switch_to_check');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Address fields for switch_to_check
  const [street1, setStreet1] = useState('');
  const [street2, setStreet2] = useState('');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('CA');
  const [zip, setZip] = useState('');

  const modalRef = useRef<HTMLDivElement>(null);

  // Accessible Focus Trap & Escape Dismissal
  useEffect(() => {
    const modalEl = modalRef.current;
    if (!modalEl) return;

    // Auto-focus first focusable element
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
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const payload: ResolveExceptionPayload = {
        action,
        reason: reason.trim() || undefined
      };

      if (action === 'switch_to_check') {
        if (!street1.trim() || !city.trim() || !stateCode.trim() || !zip.trim()) {
          throw new Error('Please fill out all required address fields (Street, City, State, ZIP)');
        }
        if (!/^\d{5}(-\d{4})?$/.test(zip.trim())) {
          throw new Error('Please enter a valid 5-digit US ZIP code');
        }

        payload.updatedAddress = {
          street1: street1.trim(),
          street2: street2.trim() || undefined,
          city: city.trim(),
          state: stateCode.trim().toUpperCase(),
          zip: zip.trim()
        };
      }

      await analyticsApi.resolveException(
        caseId,
        exception.id || exception._id!,
        payload
      );

      onResolved();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to resolve exception');
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
      aria-labelledby="exception-modal-title"
      style={{ zIndex: 9999 }}
    >
      <div
        className="modal-container"
        style={{
          maxWidth: '560px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
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
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--color-warning-bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid var(--color-warning-border)'
              }}
            >
              <AlertTriangle size={18} color="var(--color-warning)" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="exception-modal-title"
                style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}
              >
                Resolve Exception: {exception.claimId}
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                Return Code: {exception.returnCode || exception.errorCode || 'UNKNOWN'}
              </p>
            </div>
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
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {errorMessage && (
            <div
              role="alert"
              aria-live="assertive"
              style={{
                padding: '12px 14px',
                backgroundColor: 'var(--color-danger-bg)',
                border: '1px solid var(--color-danger-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-danger-text)',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px'
              }}
            >
              <AlertTriangle size={16} color="var(--color-danger)" style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Exception Context */}
          <div
            style={{
              padding: '14px 16px',
              backgroundColor: 'var(--bg-card-subtle)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              fontSize: '13px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>Claimant:</span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{exception.claimantName || 'N/A'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>Amount:</span>
              <span style={{ fontWeight: 700, color: 'var(--color-indigo)', fontVariantNumeric: 'tabular-nums' }}>
                ${(exception.amount || 0).toFixed(2)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>Reason:</span>
              <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>
                {exception.returnReason || exception.errorMessage || 'Banking exception'}
              </span>
            </div>
          </div>

          {/* Action Selector */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--text-secondary)',
                marginBottom: '8px'
              }}
            >
              Select Resolution Action
            </label>
            <div
              role="radiogroup"
              aria-label="Resolution Action"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                gap: '10px'
              }}
            >
              <button
                type="button"
                role="radio"
                aria-checked={action === 'switch_to_check'}
                onClick={() => setAction('switch_to_check')}
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  cursor: 'pointer',
                  border: action === 'switch_to_check' ? '2px solid var(--color-indigo)' : '1px solid var(--border-subtle)',
                  backgroundColor: action === 'switch_to_check' ? 'var(--bg-active)' : 'var(--bg-card)',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '13px', color: action === 'switch_to_check' ? 'var(--color-indigo)' : 'var(--text-primary)' }}>
                  <Building2 size={16} aria-hidden="true" />
                  <span>Switch to Check</span>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Mail physical check to address
                </span>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={action === 'resend_email'}
                onClick={() => setAction('resend_email')}
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  cursor: 'pointer',
                  border: action === 'resend_email' ? '2px solid var(--color-indigo)' : '1px solid var(--border-subtle)',
                  backgroundColor: action === 'resend_email' ? 'var(--bg-active)' : 'var(--bg-card)',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '13px', color: action === 'resend_email' ? 'var(--color-indigo)' : 'var(--text-primary)' }}>
                  <Mail size={16} aria-hidden="true" />
                  <span>Resend Email</span>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Issue fresh magic link portal token
                </span>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={action === 'requeue_sftp'}
                onClick={() => setAction('requeue_sftp')}
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  cursor: 'pointer',
                  border: action === 'requeue_sftp' ? '2px solid var(--color-indigo)' : '1px solid var(--border-subtle)',
                  backgroundColor: action === 'requeue_sftp' ? 'var(--bg-active)' : 'var(--bg-card)',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '13px', color: action === 'requeue_sftp' ? 'var(--color-indigo)' : 'var(--text-primary)' }}>
                  <Send size={16} aria-hidden="true" />
                  <span>Requeue SFTP</span>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Re-queue for next batch payout
                </span>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={action === 'mark_resolved'}
                onClick={() => setAction('mark_resolved')}
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  cursor: 'pointer',
                  border: action === 'mark_resolved' ? '2px solid var(--color-indigo)' : '1px solid var(--border-subtle)',
                  backgroundColor: action === 'mark_resolved' ? 'var(--bg-active)' : 'var(--bg-card)',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '13px', color: action === 'mark_resolved' ? 'var(--color-indigo)' : 'var(--text-primary)' }}>
                  <CheckCircle2 size={16} color="var(--color-success)" aria-hidden="true" />
                  <span>Mark Resolved</span>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Manual escrow or offline payment
                </span>
              </button>
            </div>
          </div>

          {/* Conditional Physical Address Fields */}
          {action === 'switch_to_check' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                padding: '16px',
                backgroundColor: 'var(--bg-card-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)'
              }}
            >
              <h4
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--text-secondary)',
                  margin: 0
                }}
              >
                Mailing Address for Physical Check
              </h4>

              <div>
                <label
                  htmlFor="exStreet1"
                  style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}
                >
                  Street Address Line 1 *
                </label>
                <input
                  id="exStreet1"
                  type="text"
                  required
                  value={street1}
                  onChange={(e) => setStreet1(e.target.value)}
                  placeholder="123 Main Street"
                  className="fintech-input"
                  style={{ width: '100%', fontSize: '13px', padding: '8px 12px' }}
                />
              </div>

              <div>
                <label
                  htmlFor="exStreet2"
                  style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}
                >
                  Street Address Line 2 (Apt / Suite)
                </label>
                <input
                  id="exStreet2"
                  type="text"
                  value={street2}
                  onChange={(e) => setStreet2(e.target.value)}
                  placeholder="Apt 4B"
                  className="fintech-input"
                  style={{ width: '100%', fontSize: '13px', padding: '8px 12px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: '10px' }}>
                <div>
                  <label
                    htmlFor="exCity"
                    style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}
                  >
                    City *
                  </label>
                  <input
                    id="exCity"
                    type="text"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="San Francisco"
                    className="fintech-input"
                    style={{ width: '100%', fontSize: '13px', padding: '8px 12px' }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="exState"
                    style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}
                  >
                    State *
                  </label>
                  <input
                    id="exState"
                    type="text"
                    required
                    maxLength={2}
                    value={stateCode}
                    onChange={(e) => setStateCode(e.target.value.toUpperCase())}
                    placeholder="CA"
                    className="fintech-input"
                    style={{ width: '100%', fontSize: '13px', padding: '8px 12px', textAlign: 'center' }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="exZip"
                    style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}
                  >
                    ZIP Code *
                  </label>
                  <input
                    id="exZip"
                    type="text"
                    required
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                    placeholder="94105"
                    className="fintech-input"
                    style={{ width: '100%', fontSize: '13px', padding: '8px 12px' }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Audit Reason Textarea */}
          <div>
            <label
              htmlFor="exReason"
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--text-secondary)',
                marginBottom: '6px'
              }}
            >
              Resolution Audit Notes / Reason
            </label>
            <textarea
              id="exReason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Account closed by claimant; verified new mailing address for physical check."
              className="fintech-input"
              style={{ width: '100%', fontSize: '13px', padding: '10px 12px', resize: 'vertical' }}
            />
          </div>

          {/* Actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '12px',
              paddingTop: '16px',
              borderTop: '1px solid var(--border-subtle)'
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="btn-secondary"
              style={{ fontSize: '13px', padding: '8px 16px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary"
              style={{ fontSize: '13px', padding: '8px 18px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  <span>Processing...</span>
                </>
              ) : (
                <span>Confirm Resolution</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
