import React from 'react';
import {
  Building2,
  CheckCircle2,
  DollarSign,
  Clock,
  TrendingUp,
  AlertTriangle
} from 'lucide-react';
import { FinancialSummaryMetrics } from '../../types';

interface MetricsSummaryCardsProps {
  metrics: FinancialSummaryMetrics | null;
  isLoading?: boolean;
}

export function formatUsd(amount?: number): string {
  if (amount === undefined || amount === null || isNaN(amount)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

export const MetricsSummaryCards: React.FC<MetricsSummaryCardsProps> = ({ metrics, isLoading }) => {
  if (isLoading || !metrics) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="fintech-stat-card animate-pulse">
            <div className="h-4 bg-slate-200 rounded w-2/3 mb-3"></div>
            <div className="h-6 bg-slate-200 rounded w-3/4 mb-2"></div>
            <div className="h-3 bg-slate-200 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  const pool = metrics.settlementFundTotal || 0;
  const claimed = metrics.totalClaimed || 0;
  const disbursed = metrics.totalDisbursed || 0;
  const outstanding = metrics.totalOutstanding || 0;
  const variance = metrics.fundVariance || 0;
  const totalClaimants = metrics.totalClaimants || 0;
  const claimedClaimants = metrics.claimedClaimants || 0;

  const claimedPercent = pool > 0 ? Math.round((claimed / pool) * 1000) / 10 : 0;
  const disbursedPercent = pool > 0 ? Math.round((disbursed / pool) * 1000) / 10 : 0;
  const claimantRate = totalClaimants > 0 ? Math.round((claimedClaimants / totalClaimants) * 1000) / 10 : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6" role="region" aria-label="Settlement Financial Metrics">
      {/* 1. Settlement Fund */}
      <div className="fintech-stat-card">
        <div>
          <div className="fintech-stat-label">
            <span>Settlement Fund</span>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-active)',
                color: 'var(--color-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Building2 className="w-4 h-4" aria-hidden="true" />
            </div>
          </div>
          <div className="fintech-stat-value">
            {metrics.settlementFundTotalFormatted || formatUsd(pool)}
          </div>
        </div>
        <div className="fintech-stat-subtext">
          Court-approved docket fund
        </div>
      </div>

      {/* 2. Total Claimed */}
      <div className="fintech-stat-card">
        <div>
          <div className="fintech-stat-label">
            <span>Total Claimed</span>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-active)',
                color: 'var(--color-indigo)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            </div>
          </div>
          <div className="fintech-stat-value">
            {metrics.totalClaimedFormatted || formatUsd(claimed)}
          </div>
        </div>
        <div className="fintech-stat-subtext" style={{ color: 'var(--color-indigo)', fontWeight: 600 }}>
          {claimedPercent}% of total fund
        </div>
      </div>

      {/* 3. Total Disbursed */}
      <div className="fintech-stat-card">
        <div>
          <div className="fintech-stat-label">
            <span>Total Disbursed</span>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--color-success-bg)',
                color: 'var(--color-success)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <DollarSign className="w-4 h-4" aria-hidden="true" />
            </div>
          </div>
          <div className="fintech-stat-value" style={{ color: 'var(--color-success-text)' }}>
            {metrics.totalDisbursedFormatted || formatUsd(disbursed)}
          </div>
        </div>
        <div className="fintech-stat-subtext" style={{ color: 'var(--color-success-text)', fontWeight: 600 }}>
          {disbursedPercent}% settled via SFTP
        </div>
      </div>

      {/* 4. Outstanding Reserves */}
      <div className="fintech-stat-card">
        <div>
          <div className="fintech-stat-label">
            <span>Outstanding</span>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--color-warning-bg)',
                color: 'var(--color-warning)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Clock className="w-4 h-4" aria-hidden="true" />
            </div>
          </div>
          <div className="fintech-stat-value">
            {metrics.totalOutstandingFormatted || formatUsd(outstanding)}
          </div>
        </div>
        <div className="fintech-stat-subtext" style={{ color: 'var(--color-warning-text)', fontWeight: 600 }}>
          Pending / Unsettled reserves
        </div>
      </div>

      {/* 5. Fund Variance */}
      <div className="fintech-stat-card">
        <div>
          <div className="fintech-stat-label">
            <span>Fund Variance</span>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: variance !== 0 ? 'var(--color-warning-bg)' : '#f1f5f9',
                color: variance !== 0 ? 'var(--color-warning)' : 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
            </div>
          </div>
          <div
            className="fintech-stat-value"
            style={{
              color: variance < 0 ? 'var(--color-danger-text)' : variance > 0 ? 'var(--color-warning-text)' : 'var(--color-success-text)'
            }}
          >
            {metrics.fundVarianceFormatted || formatUsd(variance)}
          </div>
        </div>
        <div className="fintech-stat-subtext">
          {variance === 0 ? 'Exact balance match' : variance > 0 ? 'Surplus allocation' : 'Allocation deficit'}
        </div>
      </div>

      {/* 6. Claimant Election Rate */}
      <div className="fintech-stat-card">
        <div>
          <div className="fintech-stat-label">
            <span>Election Rate</span>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--color-info-bg)',
                color: 'var(--color-info)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <TrendingUp className="w-4 h-4" aria-hidden="true" />
            </div>
          </div>
          <div className="fintech-stat-value">
            {claimantRate}%
          </div>
        </div>
        <div className="fintech-stat-subtext">
          {claimedClaimants.toLocaleString()} / {totalClaimants.toLocaleString()} claimants
        </div>
      </div>
    </div>
  );
};
