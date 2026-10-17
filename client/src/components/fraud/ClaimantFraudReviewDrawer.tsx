import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  Clock
} from 'lucide-react';
import { Claimant } from '../../types';
import { fraudApi } from '../../services/api';

interface ClaimantFraudReviewDrawerProps {
  caseId: string;
  claimant: Claimant | null;
  onClose: () => void;
  onReviewSuccess: (updatedClaimant: Claimant) => void;
}

export const ClaimantFraudReviewDrawer: React.FC<ClaimantFraudReviewDrawerProps> = ({
  caseId,
  claimant,
  onClose,
  onReviewSuccess
}) => {
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (claimant) {
      setNotes(claimant.fraudReviewNotes || '');
      setErrorMsg(null);
    }
  }, [claimant]);

  if (!claimant) {
    return null;
  }

  const score = claimant.fraudScore ?? 0;
  const tier = claimant.fraudRiskTier || 'low';
  const signals = claimant.fraudSignals || [];
  const claimantId = claimant.id || claimant._id || claimant.claimId;

  const getTierBadgeStyle = (riskTier: string): React.CSSProperties => {
    switch (riskTier) {
      case 'critical':
        return { backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' };
      case 'high':
        return { backgroundColor: '#fff7ed', color: '#9a3412', border: '1px solid #fed7aa' };
      case 'medium':
        return { backgroundColor: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' };
      default:
        return { backgroundColor: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' };
    }
  };

  const handleAdjudicate = async (action: 'approve' | 'reject') => {
    const trimmedNotes = notes.trim();
    if (trimmedNotes.length < 3) {
      setErrorMsg('Please enter mandatory compliance audit notes (minimum 3 characters) before adjudicating.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fraudApi.reviewClaimantFraud(caseId, claimantId, {
        action,
        notes: trimmedNotes
      });
      onReviewSuccess(res.claimant || {
        ...claimant,
        fraudReviewStatus: action === 'approve' ? 'manually_approved' : 'manually_rejected',
        fraudReviewNotes: trimmedNotes,
        fraudReviewedAt: new Date().toISOString()
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to record fraud review adjudication.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fraud-review-drawer-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        justifyContent: 'flex-end',
        backdropFilter: 'blur(2px)'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '580px',
          height: '100%',
          backgroundColor: '#ffffff',
          boxShadow: '-8px 0 28px rgba(15, 23, 42, 0.18)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto'
        }}
      >
        {/* Drawer Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#f8fafc'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                ...getTierBadgeStyle(tier)
              }}
            >
              <ShieldAlert size={20} aria-hidden="true" />
            </div>
            <div>
              <h2
                id="fraud-review-drawer-title"
                style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}
              >
                JurisShield™ Forensic Claim Inspection
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Claim ID: {claimant.claimId} • {claimant.firstName} {claimant.lastName}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Fraud Review Drawer"
            style={{
              minWidth: '44px',
              minHeight: '44px',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: '#ffffff',
              color: 'var(--text-secondary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Drawer Body */}
        <div style={{ padding: '24px', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Score & Claimant Summary */}
          <div
            style={{
              padding: '18px',
              borderRadius: '12px',
              backgroundColor: '#f8fafc',
              border: '1px solid var(--border-subtle)',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: '16px'
            }}
          >
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Quantitative Fraud Score
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                <span style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                  {score}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>/ 100</span>
                <span
                  style={{
                    padding: '3px 9px',
                    borderRadius: '9999px',
                    fontSize: '11px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    ...getTierBadgeStyle(tier)
                  }}
                >
                  {tier}
                </span>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Settlement Award
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '6px', fontVariantNumeric: 'tabular-nums' }}>
                ${(claimant.settlementAmount || 0).toFixed(2)}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Rail: {(claimant.selectedPaymentMethod || 'Unselected').toUpperCase()}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Claimant Contact
              </div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '6px', wordBreak: 'break-all' }}>
                {claimant.email}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Gate Status: <strong>{(claimant.fraudReviewStatus || 'unscanned').replace(/_/g, ' ').toUpperCase()}</strong>
              </div>
            </div>
          </div>

          {/* Signal Breakdown List */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Triggered Risk Signal Vector Breakdown ({signals.length})
              </h3>
              {claimant.fraudScannedAt && (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={12} aria-hidden="true" />
                  Scanned {new Date(claimant.fraudScannedAt).toLocaleString('en-US')}
                </span>
              )}
            </div>

            {signals.length === 0 ? (
              <div
                style={{
                  padding: '20px',
                  borderRadius: '10px',
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  color: '#166534',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}
              >
                <CheckCircle2 size={18} color="#15803d" aria-hidden="true" />
                <span>Zero adverse heuristic or cross-tenant collision signals triggered on this claim.</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {signals.map((sig, idx) => (
                  <div
                    key={`${sig.code}-${idx}`}
                    style={{
                      padding: '14px 16px',
                      borderRadius: '10px',
                      border: '1px solid var(--border-subtle)',
                      backgroundColor: '#ffffff',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <AlertTriangle size={15} color="#d97706" aria-hidden="true" />
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 800, color: 'var(--text-primary)' }}>
                          {sig.code}
                        </span>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: '6px',
                            backgroundColor: '#f1f5f9',
                            color: '#475569',
                            textTransform: 'uppercase'
                          }}
                        >
                          {sig.category.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '12px',
                          fontWeight: 800,
                          padding: '2px 8px',
                          borderRadius: '9999px',
                          backgroundColor: '#fef2f2',
                          color: '#991b1b',
                          border: '1px solid #fecaca'
                        }}
                      >
                        +{sig.scoreContribution} pts
                      </span>
                    </div>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                      {sig.description}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Prior Review History if present */}
          {claimant.fraudReviewedAt && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                fontSize: '12px',
                color: '#1e3a8a'
              }}
            >
              <strong>Prior Compliance Adjudication:</strong> Reviewed by{' '}
              <code>{claimant.fraudReviewedBy || 'Administrator'}</code> on{' '}
              {new Date(claimant.fraudReviewedAt).toLocaleString('en-US')}
              {claimant.fraudReviewNotes ? ` — "${claimant.fraudReviewNotes}"` : ''}
            </div>
          )}

          {/* Administrative Adjudication Form */}
          <div
            style={{
              marginTop: 'auto',
              paddingTop: '16px',
              borderTop: '1px solid var(--border-subtle)'
            }}
          >
            <label
              htmlFor="fraudReviewAuditNotes"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                fontWeight: 700,
                color: 'var(--text-primary)',
                marginBottom: '6px'
              }}
            >
              <FileText size={15} aria-hidden="true" />
              <span>Mandatory Compliance Audit Justification Notes</span>
            </label>
            <textarea
              id="fraudReviewAuditNotes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Document verification evidence (e.g., W-9/ID verified with class member, or confirmed synthetic bot-farm duplicate payout endpoint)..."
              className="fintech-input"
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '13px',
                resize: 'vertical',
                marginBottom: '12px',
                boxSizing: 'border-box'
              }}
            />

            {errorMsg && (
              <div
                role="alert"
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#991b1b',
                  fontSize: '12.5px',
                  marginBottom: '12px'
                }}
              >
                {errorMsg}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleAdjudicate('approve')}
                style={{
                  flex: '1 1 200px',
                  minHeight: '44px',
                  padding: '10px 16px',
                  borderRadius: '8px',
                  backgroundColor: '#15803d',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <CheckCircle2 size={16} aria-hidden="true" />
                <span>Approve &amp; Release to SFTP</span>
              </button>

              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleAdjudicate('reject')}
                style={{
                  flex: '1 1 200px',
                  minHeight: '44px',
                  padding: '10px 16px',
                  borderRadius: '8px',
                  backgroundColor: '#b91c1c',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <XCircle size={16} aria-hidden="true" />
                <span>Quarantine &amp; Reject Claim</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
