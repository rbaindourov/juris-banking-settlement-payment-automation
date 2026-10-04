import React from 'react';
import { UserCheck, Award, FileText, CheckCircle2, Clock } from 'lucide-react';
import { ClaimPortalData } from '../types/portal.types';

interface ClaimantSummaryCardProps {
  claim: ClaimPortalData;
  t: (key: string) => string;
}

export const ClaimantSummaryCard: React.FC<ClaimantSummaryCardProps> = ({ claim, t }) => {
  const isSelected = claim.status === 'selected' || Boolean(claim.confirmationNumber);

  return (
    <div
      className="fintech-card"
      role="region"
      aria-label="Claimant Identity and Award Information"
      style={{
        padding: '24px 28px',
        marginBottom: '28px',
        background: 'linear-gradient(180deg, #ffffff 0%, #fafbfc 100%)'
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '20px',
          alignItems: 'center'
        }}
      >
        {/* 1. Verified Claimant Name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'var(--bg-active)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-indigo)',
              boxShadow: '0 2px 4px rgba(37, 99, 235, 0.15)',
              flexShrink: 0
            }}
          >
            <UserCheck size={24} aria-hidden="true" />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {t('claimantName')}
            </div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em', marginTop: '1px' }}>
              {claim.firstName} {claim.lastName}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-success-text)', fontWeight: 600 }}>
              &bull; Verified Class Member
            </div>
          </div>
        </div>

        {/* 2. Claim ID */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'var(--bg-card-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              flexShrink: 0
            }}
          >
            <FileText size={22} aria-hidden="true" />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {t('claimId')}
            </div>
            <div
              style={{
                fontSize: '15px',
                fontWeight: 700,
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                backgroundColor: 'var(--bg-card-subtle)',
                padding: '3px 8px',
                borderRadius: 'var(--radius-sm)',
                display: 'inline-block',
                marginTop: '2px',
                border: '1px solid var(--border-subtle)'
              }}
            >
              {claim.claimId}
            </div>
          </div>
        </div>

        {/* 3. Confirmed Settlement Award Amount */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'var(--color-success-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-success)',
              boxShadow: '0 2px 4px rgba(5, 150, 105, 0.15)',
              flexShrink: 0
            }}
          >
            <Award size={24} aria-hidden="true" />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-success)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {t('awardAmount')}
            </div>
            <div
              style={{
                fontSize: '26px',
                fontWeight: 800,
                color: 'var(--color-success-text)',
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
                marginTop: '2px'
              }}
            >
              {claim.formattedAwardAmount || `$${claim.settlementAmount.toFixed(2)}`}
            </div>
          </div>
        </div>

        {/* 4. Election Status */}
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
            {t('status')}
          </div>
          <span
            className={`status-pill ${
              isSelected
                ? 'status-pill-success'
                : claim.isExpired
                ? 'status-pill-danger'
                : 'status-pill-disbursed'
            }`}
            style={{ padding: '6px 14px', fontSize: '12px' }}
          >
            {isSelected ? (
              <>
                <CheckCircle2 size={16} aria-hidden="true" />
                <span>{t('statusSelected')}</span>
              </>
            ) : claim.isExpired ? (
              <span>{t('statusExpired')}</span>
            ) : (
              <>
                <Clock size={16} aria-hidden="true" />
                <span>{t('statusPending')}</span>
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
};
