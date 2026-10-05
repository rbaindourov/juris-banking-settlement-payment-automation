import React, { useEffect, useState } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import {
  Case,
  FinancialSummaryMetrics,
  FunnelAnalyticsData,
  PaymentRailMetricsData,
  ExceptionItem
} from '../../types';
import { analyticsApi } from '../../services/api';
import { MetricsSummaryCards } from './MetricsSummaryCards';
import { DeliveryFunnelVisualization } from './DeliveryFunnelVisualization';
import { PaymentRailDistribution } from './PaymentRailDistribution';
import { InteractiveExceptionLedger } from './InteractiveExceptionLedger';
import { AuditExportButton } from './AuditExportButton';
import { AgendashLinkButton } from './AgendashLinkButton';

interface CaseAnalyticsDashboardProps {
  caseId: string;
  settlementCase?: Case;
  onRefreshCase?: () => void;
}

export const CaseAnalyticsDashboard: React.FC<CaseAnalyticsDashboardProps> = ({
  caseId,
  settlementCase,
  onRefreshCase
}) => {
  const [summary, setSummary] = useState<FinancialSummaryMetrics | null>(null);
  const [funnel, setFunnel] = useState<FunnelAnalyticsData | null>(null);
  const [methods, setMethods] = useState<PaymentRailMetricsData | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadAllAnalytics = async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setErrorMsg(null);

    try {
      const [sumRes, funRes, methRes, exRes] = await Promise.allSettled([
        analyticsApi.getSummary(caseId),
        analyticsApi.getFunnel(caseId),
        analyticsApi.getMethods(caseId),
        analyticsApi.listExceptions(caseId, { limit: 100 })
      ]);

      if (sumRes.status === 'fulfilled') {
        setSummary(sumRes.value);
      }
      if (funRes.status === 'fulfilled') {
        setFunnel(funRes.value);
      }
      if (methRes.status === 'fulfilled') {
        setMethods(methRes.value);
      }
      if (exRes.status === 'fulfilled') {
        setExceptions(exRes.value.exceptions || []);
      }

      // Check if all failed
      if (
        sumRes.status === 'rejected' &&
        funRes.status === 'rejected' &&
        methRes.status === 'rejected'
      ) {
        throw new Error('Failed to load case analytics data');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error loading dashboard analytics');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadAllAnalytics(false);
  }, [caseId]);

  const handleRefresh = async () => {
    await loadAllAnalytics(true);
    if (onRefreshCase) {
      onRefreshCase();
    }
  };

  const docketNumber = settlementCase?.docketNumber || summary?.docketNumber || 'case';

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-200 gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Case Delivery & Disbursement Analytics
          </h2>
          <p className="text-xs text-slate-500">
            Real-time delivery progression, payment method allocations, and banking exceptions
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Manual Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            title="Refresh analytics data"
            className="p-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg shadow-sm transition-colors disabled:opacity-50"
            style={{ minWidth: '44px', minHeight: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            aria-label="Refresh analytics"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
          </button>

          {/* Agendash Scheduler Deep-link */}
          <AgendashLinkButton />

          {/* Audit Export CSV Button */}
          <AuditExportButton caseId={caseId} docketNumber={docketNumber} />
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 1. Top Metrics Summary KPI Cards */}
      <MetricsSummaryCards metrics={summary} isLoading={isLoading} />

      {/* 2. 6-Stage Delivery Funnel Visualization */}
      <DeliveryFunnelVisualization funnelData={funnel} isLoading={isLoading} />

      {/* 3. Payment Rail Distribution Breakdown (All 9 Rails) */}
      <PaymentRailDistribution methodsData={methods} isLoading={isLoading} />

      {/* 4. Interactive Exception Ledger & Resolution Desk */}
      <InteractiveExceptionLedger
        caseId={caseId}
        exceptions={exceptions}
        isLoading={isLoading}
        onRefresh={() => loadAllAnalytics(true)}
      />
    </div>
  );
};
