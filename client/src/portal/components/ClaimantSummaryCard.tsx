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
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        padding: '24px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
        marginBottom: '24px'
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '20px',
          alignItems: 'center'
        }}
      >
        {/* Claimant Name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              backgroundColor: '#eff6ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#1d4ed8'
            }}
          >
            <UserCheck size={22} />
          </div>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
              {t('claimantName')}
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
              {claim.firstName} {claim.lastName}
            </div>
          </div>
        </div>

        {/* Claim ID */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              backgroundColor: '#f8fafc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#475569'
            }}
          >
            <FileText size={22} />
          </div>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
              {t('claimId')}
            </div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: '#1e293b', fontFamily: 'monospace' }}>
              {claim.claimId}
            </div>
          </div>
        </div>

        {/* Settlement Award Amount */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              backgroundColor: '#ecfdf5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#059669'
            }}
          >
            <Award size={22} />
          </div>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#059669', textTransform: 'uppercase' }}>
              {t('awardAmount')}
            </div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#047857' }}>
              {claim.formattedAwardAmount || `$${claim.settlementAmount.toFixed(2)}`}
            </div>
          </div>
        </div>

        {/* Status Badge */}
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>
            {t('status')}
          </div>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '20px',
              fontSize: '13px',
              fontWeight: 600,
              backgroundColor: isSelected ? '#ecfdf5' : claim.isExpired ? '#fef2f2' : '#eff6ff',
              color: isSelected ? '#065f46' : claim.isExpired ? '#991b1b' : '#1e40af',
              border: `1px solid ${isSelected ? '#a7f3d0' : claim.isExpired ? '#fecaca' : '#bfdbfe'}`
            }}
          >
            {isSelected ? (
              <>
                <CheckCircle2 size={16} />
                {t('statusSelected')}
              </>
            ) : claim.isExpired ? (
              t('statusExpired')
            ) : (
              <>
                <Clock size={16} />
                {t('statusPending')}
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
};
