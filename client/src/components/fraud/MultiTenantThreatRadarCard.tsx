import React from 'react';
import { Globe, ShieldAlert, MailWarning, Cpu, Network, CheckCircle2 } from 'lucide-react';
import { MultiTenantNetworkIntelligence } from '../../types';

interface MultiTenantThreatRadarCardProps {
  intelligence: MultiTenantNetworkIntelligence | null;
  isLoading?: boolean;
}

export const MultiTenantThreatRadarCard: React.FC<MultiTenantThreatRadarCardProps> = ({
  intelligence,
  isLoading = false
}) => {
  const payoutCollisions =
    intelligence?.crossDocketPayoutCollisions ??
    intelligence?.duplicatePayoutEndpointsBlocked ??
    intelligence?.byType?.payout_hash ??
    0;

  const spamDomains =
    intelligence?.disposableEmailDomainsBlocked ??
    intelligence?.spamDomainsIntercepted ??
    intelligence?.byType?.email_domain ??
    0;

  const ipSubnets =
    intelligence?.highVelocityIpSubnets ??
    intelligence?.byType?.ip_subnet ??
    0;

  const deviceCollisions =
    intelligence?.deviceFingerprintCollisions ??
    intelligence?.byType?.device_fingerprint ??
    0;

  const indicators = intelligence?.topIndicators || intelligence?.indicators || [];

  return (
    <div
      className="fintech-card"
      role="region"
      aria-label="Multi-Tenant Internet Spam and Fraud Threat Radar"
      style={{
        padding: '24px',
        marginBottom: '24px',
        border: '1px solid var(--border-subtle)'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '16px',
          flexWrap: 'wrap',
          marginBottom: '20px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              backgroundColor: '#eff6ff',
              color: '#1d4ed8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #bfdbfe',
              flexShrink: 0
            }}
          >
            <Globe size={20} aria-hidden="true" />
          </div>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              Multi-Tenant Threat Intelligence Radar (Cross-Docket &amp; Internet Spam Visibility)
            </h3>
            <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
              Privacy-preserving HMAC-SHA256 correlation across all law firms, settlement dockets, and registered internet domains
            </p>
          </div>
        </div>

        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 12px',
            borderRadius: '9999px',
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#15803d',
            fontSize: '11px',
            fontWeight: 700
          }}
        >
          <CheckCircle2 size={13} aria-hidden="true" />
          <span>GLOBAL TELEMETRY SYNCED</span>
        </span>
      </div>

      {/* 4 Multi-Tenant Radar Metrics */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '16px'
        }}
      >
        <div
          style={{
            padding: '16px',
            borderRadius: '10px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Cross-Docket Duplicate Payouts
            </span>
            <ShieldAlert size={16} color="#dc2626" aria-hidden="true" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#7f1d1d', fontVariantNumeric: 'tabular-nums' }}>
            {isLoading ? '—' : payoutCollisions}
          </div>
          <div style={{ fontSize: '11.5px', color: '#991b1b', marginTop: '4px' }}>
            Identical ACH, Venmo, PayPal, Zelle, or BTC endpoints across distinct claimants/matters
          </div>
        </div>

        <div
          style={{
            padding: '16px',
            borderRadius: '10px',
            backgroundColor: '#fffbeb',
            border: '1px solid #fde68a'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Disposable / Spam Domains
            </span>
            <MailWarning size={16} color="#d97706" aria-hidden="true" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#78350f', fontVariantNumeric: 'tabular-nums' }}>
            {isLoading ? '—' : spamDomains}
          </div>
          <div style={{ fontSize: '11.5px', color: '#92400e', marginTop: '4px' }}>
            Burner email domains, botnet MX relays, and suppressed spam-trap addresses intercepted
          </div>
        </div>

        <div
          style={{
            padding: '16px',
            borderRadius: '10px',
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              High-Velocity IP Subnets
            </span>
            <Network size={16} color="#2563eb" aria-hidden="true" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#1e3a8a', fontVariantNumeric: 'tabular-nums' }}>
            {isLoading ? '—' : ipSubnets}
          </div>
          <div style={{ fontSize: '11.5px', color: '#1e40af', marginTop: '4px' }}>
            /24 network subnets &amp; proxy clusters triggering multi-claim burst thresholds
          </div>
        </div>

        <div
          style={{
            padding: '16px',
            borderRadius: '10px',
            backgroundColor: '#f5f3ff',
            border: '1px solid #ddd6fe'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#5b21b6', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Device Fingerprint Collisions
            </span>
            <Cpu size={16} color="#7c3aed" aria-hidden="true" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#4c1d95', fontVariantNumeric: 'tabular-nums' }}>
            {isLoading ? '—' : deviceCollisions}
          </div>
          <div style={{ fontSize: '11.5px', color: '#5b21b6', marginTop: '4px' }}>
            Headless browser signatures &amp; hardware hashes reused across multiple claimant identities
          </div>
        </div>
      </div>

      {/* Optional Top Active Multi-Tenant Threat Indicators */}
      {indicators.length > 0 && (
        <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Active Cross-Tenant Threat Signatures ({indicators.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {indicators.slice(0, 6).map((ind, idx) => (
              <div
                key={ind.id || ind._id || idx}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-body)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '12px'
                }}
              >
                <span style={{ fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', fontSize: '10px' }}>
                  {ind.indicatorType.replace('_', ' ')}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', fontSize: '11px' }}>
                  {ind.indicatorValue.length > 18 ? `${ind.indicatorValue.slice(0, 16)}…` : ind.indicatorValue}
                </span>
                <span
                  style={{
                    padding: '2px 6px',
                    borderRadius: '9999px',
                    backgroundColor: '#fee2e2',
                    color: '#991b1b',
                    fontWeight: 700,
                    fontSize: '10px'
                  }}
                >
                  {ind.hitCount} hits • {ind.distinctCasesCount || 1} case(s)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
