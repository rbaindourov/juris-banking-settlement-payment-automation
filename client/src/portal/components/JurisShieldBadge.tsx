import React from 'react';
import { ShieldCheck, Lock, Activity } from 'lucide-react';

interface JurisShieldBadgeProps {
  compact?: boolean;
}

export const JurisShieldBadge: React.FC<JurisShieldBadgeProps> = ({ compact = false }) => {
  return (
    <div
      role="region"
      aria-label="JurisShield Multi-Tenant Fraud and Identity Verification Status"
      style={{
        backgroundColor: '#f0fdf4',
        border: '1px solid #bbf7d0',
        borderRadius: '12px',
        padding: compact ? '12px 16px' : '16px 20px',
        marginBottom: '24px',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '16px',
        flexWrap: 'wrap',
        boxShadow: '0 1px 3px rgba(5, 150, 105, 0.08)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', flex: '1 1 280px' }}>
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            backgroundColor: '#dcfce7',
            color: '#15803d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            border: '1px solid #86efac'
          }}
        >
          <ShieldCheck size={22} aria-hidden="true" />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
            <span
              style={{
                fontSize: '14px',
                fontWeight: 800,
                color: '#14532d',
                letterSpacing: '-0.01em'
              }}
            >
              Protected by JurisShield™ Multi-Tenant Fraud &amp; Identity Verification
            </span>
          </div>
          {!compact && (
            <p
              style={{
                fontSize: '12.5px',
                color: '#166534',
                lineHeight: 1.5,
                margin: 0
              }}
            >
              Real-time behavioral telemetry, cryptographic device fingerprinting, cross-docket payout endpoint collision checks, and automated bot-farm defense actively protect verified class members&apos; settlement funds.
            </p>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          borderRadius: '9999px',
          backgroundColor: '#dcfce7',
          border: '1px solid #86efac',
          color: '#14532d',
          fontSize: '11px',
          fontWeight: 800,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          alignSelf: 'center'
        }}
      >
        <Activity size={13} color="#15803d" aria-hidden="true" />
        <span>REAL-TIME SCAN ACTIVE</span>
        <Lock size={12} color="#15803d" aria-hidden="true" />
      </div>
    </div>
  );
};
