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
          <div key={i} className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm animate-pulse">
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
      {/* 1. Settlement Fund */}
      <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-600 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Settlement Fund</span>
            <Building2 className="w-4 h-4 text-blue-800" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {metrics.settlementFundTotalFormatted || formatUsd(pool)}
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Court-approved docket fund
        </div>
      </div>

      {/* 2. Total Claimed */}
      <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-600 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Claimed</span>
            <CheckCircle2 className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {metrics.totalClaimedFormatted || formatUsd(claimed)}
          </div>
        </div>
        <div className="mt-2 text-xs text-blue-700 font-medium">
          {claimedPercent}% of total fund
        </div>
      </div>

      {/* 3. Total Disbursed */}
      <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-600 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Disbursed</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {metrics.totalDisbursedFormatted || formatUsd(disbursed)}
          </div>
        </div>
        <div className="mt-2 text-xs text-emerald-700 font-medium">
          {disbursedPercent}% settled via SFTP
        </div>
      </div>

      {/* 4. Outstanding Balance */}
      <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-600 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Outstanding</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {metrics.totalOutstandingFormatted || formatUsd(outstanding)}
          </div>
        </div>
        <div className="mt-2 text-xs text-amber-700 font-medium">
          Pending / Unsettled
        </div>
      </div>

      {/* 5. Fund Variance */}
      <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-600 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Fund Variance</span>
            <AlertTriangle className={`w-4 h-4 ${variance !== 0 ? 'text-amber-600' : 'text-slate-400'}`} />
          </div>
          <div className={`text-xl font-bold mt-1 ${variance < 0 ? 'text-rose-600' : variance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {metrics.fundVarianceFormatted || formatUsd(variance)}
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          {variance === 0 ? 'Exact balance match' : variance > 0 ? 'Surplus allocation' : 'Allocation deficit'}
        </div>
      </div>

      {/* 6. Claimant Election Rate */}
      <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-600 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Election Rate</span>
            <TrendingUp className="w-4 h-4 text-sky-600" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {claimantRate}%
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-600">
          {claimedClaimants.toLocaleString()} / {totalClaimants.toLocaleString()} claimants
        </div>
      </div>
    </div>
  );
};
