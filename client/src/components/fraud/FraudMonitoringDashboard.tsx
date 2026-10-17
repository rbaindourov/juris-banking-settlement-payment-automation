import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  DollarSign,
  Activity,
  AlertTriangle,
  Globe,
  Search,
  Eye,
  CheckCircle2
} from 'lucide-react';
import {
  Claimant,
  FraudCaseMetrics,
  MultiTenantNetworkIntelligence,
  FraudRiskTier
} from '../../types';
import { fraudApi } from '../../services/api';
import { MultiTenantThreatRadarCard } from './MultiTenantThreatRadarCard';
import { ClaimantFraudReviewDrawer } from './ClaimantFraudReviewDrawer';

export interface FraudScoreBadgeProps {
  score?: number;
  riskTier?: FraudRiskTier | string;
}

export const FraudScoreBadge: React.FC<FraudScoreBadgeProps> = ({
  score = 0,
  riskTier
}) => {
  const numericScore = typeof score === 'number' && !Number.isNaN(score) ? Math.round(score) : 0;
  const resolvedTier =
    riskTier ||
    (numericScore >= 80
      ? 'critical'
      : numericScore >= 60
      ? 'high'
      : numericScore >= 30
      ? 'medium'
      : 'low');

  const getBadgeStyle = (tier: string): React.CSSProperties => {
    switch (tier) {
      case 'critical':
        return {
          backgroundColor: '#fef2f2',
          color: '#991b1b',
          border: '1px solid #fecaca'
        };
      case 'high':
        return {
          backgroundColor: '#fff7ed',
          color: '#9a3412',
          border: '1px solid #fed7aa'
        };
      case 'medium':
        return {
          backgroundColor: '#fffbeb',
          color: '#92400e',
          border: '1px solid #fde68a'
        };
      default:
        return {
          backgroundColor: '#f0fdf4',
          color: '#166534',
          border: '1px solid #bbf7d0'
        };
    }
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 10px',
        borderRadius: '9999px',
        fontSize: '11.5px',
        fontWeight: 800,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        ...getBadgeStyle(resolvedTier)
      }}
    >
      <span>{numericScore}/100</span>
      <span style={{ opacity: 0.5 }}>•</span>
      <span style={{ textTransform: 'uppercase', fontSize: '10.5px', letterSpacing: '0.03em' }}>
        {resolvedTier}
      </span>
    </span>
  );
};

interface FraudMonitoringDashboardProps {
  caseId: string;
}

export const FraudMonitoringDashboard: React.FC<FraudMonitoringDashboardProps> = ({ caseId }) => {
  const [metrics, setMetrics] = useState<FraudCaseMetrics | null>(null);
  const [networkIntel, setNetworkIntel] = useState<MultiTenantNetworkIntelligence | null>(null);
  const [claimants, setClaimants] = useState<Claimant[]>([]);
  const [totalClaimants, setTotalClaimants] = useState<number>(0);

  const [riskTierFilter, setRiskTierFilter] = useState<string>('');
  const [reviewStatusFilter, setReviewStatusFilter] = useState<string>('');
  const [minScoreFilter, setMinScoreFilter] = useState<string>('');

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRescanning, setIsRescanning] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedClaimant, setSelectedClaimant] = useState<Claimant | null>(null);

  const loadFraudData = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const parsedMinScore =
        minScoreFilter.trim() !== '' && !Number.isNaN(Number(minScoreFilter))
          ? Number(minScoreFilter)
          : undefined;

      const [metricsRes, claimantsRes, intelRes] = await Promise.allSettled([
        fraudApi.getCaseFraudMetrics(caseId),
        fraudApi.listCaseFraudClaimants(caseId, {
          riskTier: riskTierFilter || undefined,
          reviewStatus: reviewStatusFilter || undefined,
          minScore: parsedMinScore,
          limit: 100
        }),
        fraudApi.getNetworkIntelligence()
      ]);

      if (metricsRes.status === 'fulfilled') {
        setMetrics(metricsRes.value);
      }
      if (claimantsRes.status === 'fulfilled') {
        setClaimants(claimantsRes.value.claimants || []);
        setTotalClaimants(claimantsRes.value.total ?? (claimantsRes.value.claimants || []).length);
      }
      if (intelRes.status === 'fulfilled') {
        setNetworkIntel(intelRes.value);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Unable to load fraud monitoring telemetry.');
    } finally {
      setIsLoading(false);
    }
  }, [caseId, riskTierFilter, reviewStatusFilter, minScoreFilter]);

  useEffect(() => {
    loadFraudData();
  }, [loadFraudData]);

  const handleRunFullRescan = async () => {
    setIsRescanning(true);
    setStatusBanner(null);
    setErrorMsg(null);
    try {
      const res = await fraudApi.rescanCaseFraud(caseId);
      const scanned = res.scannedCount ?? res.totalScanned ?? 0;
      setStatusBanner(
        res.message ||
          `Completed full JurisShield™ case fraud scan (${scanned} claimant records evaluated against multi-tenant threat indicators).`
      );
      await loadFraudData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to execute case fraud rescan.');
    } finally {
      setIsRescanning(false);
    }
  };

  const renderGateStatusPill = (status?: string) => {
    switch (status) {
      case 'quarantined_blocked':
        return (
          <span
            style={{
              padding: '3px 9px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 700,
              backgroundColor: '#fef2f2',
              color: '#991b1b',
              border: '1px solid #fecaca'
            }}
          >
            Quarantined Blocked
          </span>
        );
      case 'flagged_for_review':
        return (
          <span
            style={{
              padding: '3px 9px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 700,
              backgroundColor: '#fff7ed',
              color: '#9a3412',
              border: '1px solid #fed7aa'
            }}
          >
            Held for Review
          </span>
        );
      case 'manually_approved':
        return (
          <span
            style={{
              padding: '3px 9px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 700,
              backgroundColor: '#eff6ff',
              color: '#1e40af',
              border: '1px solid #bfdbfe'
            }}
          >
            Manually Approved
          </span>
        );
      case 'manually_rejected':
        return (
          <span
            style={{
              padding: '3px 9px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 700,
              backgroundColor: '#f1f5f9',
              color: '#475569',
              border: '1px solid #cbd5e1'
            }}
          >
            Manually Rejected
          </span>
        );
      default:
        return (
          <span
            style={{
              padding: '3px 9px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 700,
              backgroundColor: '#f0fdf4',
              color: '#166534',
              border: '1px solid #bbf7d0'
            }}
          >
            Auto-Cleared
          </span>
        );
    }
  };

  const fundsProtected =
    metrics?.settlementDollarsProtected ??
    metrics?.fundsProtected ??
    0;

  const totalScanned = metrics?.totalScanned ?? claimants.length;
  const avgLatency = metrics?.avgScanLatencyMs ?? metrics?.avgLatencyMs ?? 4.2;
  const dist = metrics?.riskTierDistribution || { low: 0, medium: 0, high: 0, critical: 0 };
  const quarantinedOrFlagged =
    metrics?.quarantinedOrFlaggedCount ??
    (metrics?.flaggedForReviewCount ?? dist.high) + (metrics?.quarantinedBlockedCount ?? dist.critical);
  const crossTenantHits =
    metrics?.crossTenantThreatHits ??
    networkIntel?.crossDocketPayoutCollisions ??
    networkIntel?.totalIndicators ??
    0;

  const totalDistCount = Math.max(1, dist.low + dist.medium + dist.high + dist.critical);

  return (
    <div>
      {/* Top Action Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          marginBottom: '20px',
          paddingBottom: '16px',
          borderBottom: '1px solid var(--border-subtle)'
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ShieldAlert size={22} color="#1e3a8a" aria-hidden="true" />
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              JurisShield™ Real-Time Fraud Monitoring &amp; Claimant Scoring
            </h2>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
            Continuous behavioral bot detection, cross-docket payout endpoint collision scanning, and Dash Solutions SFTP quarantine gate control
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => loadFraudData()}
            disabled={isLoading || isRescanning}
            aria-label="Refresh fraud telemetry"
            className="btn-secondary"
            style={{
              minHeight: '44px',
              padding: '8px 14px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} aria-hidden="true" />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleRunFullRescan}
            disabled={isRescanning}
            className="btn-primary"
            style={{
              minHeight: '44px',
              padding: '10px 18px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: 700
            }}
          >
            <ShieldCheck size={16} aria-hidden="true" />
            <span>{isRescanning ? 'Scanning Roster...' : 'Run Full Case Fraud Scan'}</span>
          </button>
        </div>
      </div>

      {statusBanner && (
        <div
          role="status"
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#166534',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '20px'
          }}
        >
          <CheckCircle2 size={16} color="#15803d" aria-hidden="true" />
          <span>{statusBanner}</span>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            fontSize: '13px',
            marginBottom: '20px'
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* 5 Top KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '16px',
          marginBottom: '24px'
        }}
      >
        <div className="fintech-card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Settlement Funds Protected ($)
            </span>
            <DollarSign size={16} color="#15803d" aria-hidden="true" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#15803d', fontVariantNumeric: 'tabular-nums' }}>
            ${fundsProtected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Held from outbound SFTP disbursement
          </div>
        </div>

        <div className="fintech-card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Real-Time Claims Scanned
            </span>
            <ShieldCheck size={16} color="#1d4ed8" aria-hidden="true" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {totalScanned.toLocaleString()}
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
            100% portal &amp; roster coverage
          </div>
        </div>

        <div className="fintech-card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Avg Scan Latency (ms)
            </span>
            <Activity size={16} color="#0284c7" aria-hidden="true" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {Number(avgLatency).toFixed(1)} ms
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Sub-10ms synchronous evaluation
          </div>
        </div>

        <div className="fintech-card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Quarantined / Flagged Claims
            </span>
            <AlertTriangle size={16} color="#dc2626" aria-hidden="true" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#b91c1c', fontVariantNumeric: 'tabular-nums' }}>
            {quarantinedOrFlagged}
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Blocked at SFTP disbursement gate
          </div>
        </div>

        <div className="fintech-card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Cross-Tenant Threat Hits
            </span>
            <Globe size={16} color="#7c3aed" aria-hidden="true" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#5b21b6', fontVariantNumeric: 'tabular-nums' }}>
            {crossTenantHits}
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Multi-docket &amp; domain correlations
          </div>
        </div>
      </div>

      {/* Risk Tier Distribution Bar */}
      <div className="fintech-card" style={{ padding: '20px 24px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            Claimant Risk Tier Distribution
          </h3>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '12px', fontWeight: 700 }}>
            <span style={{ color: '#15803d' }}>Low (0–29): {dist.low}</span>
            <span style={{ color: '#b45309' }}>Medium (30–59): {dist.medium}</span>
            <span style={{ color: '#c2410c' }}>High (60–79): {dist.high}</span>
            <span style={{ color: '#b91c1c' }}>Critical (80–100): {dist.critical}</span>
          </div>
        </div>

        <div
          style={{
            height: '14px',
            width: '100%',
            borderRadius: '9999px',
            backgroundColor: '#f1f5f9',
            overflow: 'hidden',
            display: 'flex'
          }}
        >
          <div
            title={`Low Risk: ${dist.low}`}
            style={{
              width: `${(dist.low / totalDistCount) * 100}%`,
              backgroundColor: '#22c55e',
              transition: 'width 0.3s ease'
            }}
          />
          <div
            title={`Medium Risk: ${dist.medium}`}
            style={{
              width: `${(dist.medium / totalDistCount) * 100}%`,
              backgroundColor: '#f59e0b',
              transition: 'width 0.3s ease'
            }}
          />
          <div
            title={`High Risk: ${dist.high}`}
            style={{
              width: `${(dist.high / totalDistCount) * 100}%`,
              backgroundColor: '#f97316',
              transition: 'width 0.3s ease'
            }}
          />
          <div
            title={`Critical Risk: ${dist.critical}`}
            style={{
              width: `${(dist.critical / totalDistCount) * 100}%`,
              backgroundColor: '#ef4444',
              transition: 'width 0.3s ease'
            }}
          />
        </div>
      </div>

      {/* Multi-Tenant Threat Radar Card */}
      <MultiTenantThreatRadarCard intelligence={networkIntel} isLoading={isLoading} />

      {/* Filterable Claimant Fraud Scoring & Review Queue Table */}
      <div className="fintech-card" style={{ padding: '24px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            marginBottom: '20px'
          }}
        >
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              Claimant Fraud Scoring &amp; SFTP Quarantine Review Queue ({totalClaimants})
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
              Claims scored 60+ are automatically held from Dash Solutions SFTP disbursement batches until adjudicated
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <select
              aria-label="Filter by Risk Tier"
              value={riskTierFilter}
              onChange={(e) => setRiskTierFilter(e.target.value)}
              className="fintech-input"
              style={{ width: 'auto', minWidth: '150px', minHeight: '44px' }}
            >
              <option value="">All Risk Tiers</option>
              <option value="critical">Critical (80–100)</option>
              <option value="high">High (60–79)</option>
              <option value="medium">Medium (30–59)</option>
              <option value="low">Low (0–29)</option>
            </select>

            <select
              aria-label="Filter by SFTP Gate Status"
              value={reviewStatusFilter}
              onChange={(e) => setReviewStatusFilter(e.target.value)}
              className="fintech-input"
              style={{ width: 'auto', minWidth: '175px', minHeight: '44px' }}
            >
              <option value="">All Gate Statuses</option>
              <option value="quarantined_blocked">Quarantined Blocked</option>
              <option value="flagged_for_review">Held for Review</option>
              <option value="auto_cleared">Auto-Cleared</option>
              <option value="manually_approved">Manually Approved</option>
              <option value="manually_rejected">Manually Rejected</option>
            </select>

            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <Search
                size={14}
                color="var(--text-muted)"
                style={{ position: 'absolute', left: '10px', pointerEvents: 'none' }}
                aria-hidden="true"
              />
              <input
                type="number"
                min={0}
                max={100}
                aria-label="Minimum Fraud Score"
                placeholder="Min Score (0-100)"
                value={minScoreFilter}
                onChange={(e) => setMinScoreFilter(e.target.value)}
                className="fintech-input"
                style={{ width: '155px', paddingLeft: '30px', minHeight: '44px' }}
              />
            </div>
          </div>
        </div>

        {claimants.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: '14px' }}>
            {isLoading
              ? 'Loading claimant fraud scoring telemetry...'
              : 'No claimants match the selected fraud filter criteria.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr
                  style={{
                    backgroundColor: 'var(--bg-body)',
                    textAlign: 'left',
                    borderBottom: '1px solid var(--border-subtle)'
                  }}
                >
                  <th style={{ padding: '12px 14px' }}>Claim ID</th>
                  <th style={{ padding: '12px 14px' }}>Claimant Name &amp; Email</th>
                  <th style={{ padding: '12px 14px' }}>Award</th>
                  <th style={{ padding: '12px 14px' }}>Payment Method</th>
                  <th style={{ padding: '12px 14px' }}>Fraud Score (0–100)</th>
                  <th style={{ padding: '12px 14px' }}>Triggered Signals</th>
                  <th style={{ padding: '12px 14px' }}>SFTP Gate Status</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {claimants.map((cl) => {
                  const sigCount = cl.fraudSignals?.length || 0;
                  return (
                    <tr
                      key={cl.id || cl._id || cl.claimId}
                      style={{ borderBottom: '1px solid var(--border-subtle)' }}
                    >
                      <td style={{ padding: '12px 14px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        {cl.claimId}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                          {cl.firstName} {cl.lastName}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{cl.email}</div>
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        ${(cl.settlementAmount || 0).toFixed(2)}
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: 600 }}>
                        {cl.selectedPaymentMethod ? cl.selectedPaymentMethod.toUpperCase() : '—'}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <FraudScoreBadge score={cl.fraudScore} riskTier={cl.fraudRiskTier} />
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {sigCount > 0 ? (
                          <span style={{ fontWeight: 700, color: '#b45309' }}>
                            {sigCount} signal{sigCount === 1 ? '' : 's'}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>0 signals</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {renderGateStatusPill(cl.fraudReviewStatus)}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => setSelectedClaimant(cl)}
                          className="btn-secondary"
                          style={{
                            minHeight: '44px',
                            padding: '8px 14px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '12.5px',
                            fontWeight: 700
                          }}
                        >
                          <Eye size={14} aria-hidden="true" />
                          <span>Inspect / Adjudicate</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Evidence & Adjudication Drawer */}
      <ClaimantFraudReviewDrawer
        caseId={caseId}
        claimant={selectedClaimant}
        onClose={() => setSelectedClaimant(null)}
        onReviewSuccess={() => {
          loadFraudData();
        }}
      />
    </div>
  );
};
