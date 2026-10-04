import React from 'react';
import {
  Users,
  Send,
  MailCheck,
  Eye,
  CheckCircle2,
  DollarSign,
  ArrowRight
} from 'lucide-react';
import { FunnelAnalyticsData } from '../../types';

interface DeliveryFunnelVisualizationProps {
  funnelData: FunnelAnalyticsData | null;
  isLoading?: boolean;
}

export const DeliveryFunnelVisualization: React.FC<DeliveryFunnelVisualizationProps> = ({
  funnelData,
  isLoading
}) => {
  if (isLoading || !funnelData) {
    return (
      <div className="fintech-card p-6 mb-6 animate-pulse">
        <div className="h-6 bg-slate-200 rounded w-1/4 mb-4"></div>
        <div className="space-y-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-10 bg-slate-100 rounded w-full"></div>
          ))}
        </div>
      </div>
    );
  }

  const { stages, rates, dropOff } = funnelData;
  const baseline = stages.uploaded || 1; // prevent zero division

  const stageDefinitions = [
    {
      key: 'uploaded',
      label: '1. Ingested Roster Claimants',
      count: stages.uploaded,
      pctOfTotal: Math.round(((stages.uploaded || 0) / baseline) * 100),
      color: '#334155',
      icon: Users,
      description: 'Initial roster ingested from CSV/Excel'
    },
    {
      key: 'dispatched',
      label: '2. Notifications Dispatched',
      count: stages.dispatched,
      pctOfTotal: Math.round(((stages.dispatched || 0) / baseline) * 100),
      color: '#2563eb',
      icon: Send,
      dropOff: dropOff.dispatchToDelivery,
      dropOffNote: 'Pending delivery or throttled',
      description: 'Personalized legal notices dispatched'
    },
    {
      key: 'delivered',
      label: '3. Emails Delivered',
      count: stages.delivered,
      pctOfTotal: Math.round(((stages.delivered || 0) / baseline) * 100),
      color: '#4f46e5',
      icon: MailCheck,
      dropOff: dropOff.deliveryToVisit,
      dropOffNote: 'Unopened / Claimant inertia',
      description: 'Confirmed delivered to recipient'
    },
    {
      key: 'visited',
      label: '4. Portal Visited',
      count: stages.visited,
      pctOfTotal: Math.round(((stages.visited || 0) / baseline) * 100),
      color: '#9333ea',
      icon: Eye,
      dropOff: dropOff.visitToSelect,
      dropOffNote: 'Portal exit prior to signature',
      description: 'Claimant authenticated via magic link'
    },
    {
      key: 'selected',
      label: '5. Payment Rail Affirmed',
      count: stages.selected,
      pctOfTotal: Math.round(((stages.selected || 0) / baseline) * 100),
      color: '#0d9488',
      icon: CheckCircle2,
      dropOff: dropOff.selectToDisburse,
      dropOffNote: 'Batch processing in flight',
      description: 'Payment preference affirmed & signed'
    },
    {
      key: 'disbursed',
      label: '6. Settlement Disbursed',
      count: stages.disbursed,
      pctOfTotal: Math.round(((stages.disbursed || 0) / baseline) * 100),
      color: '#059669',
      icon: DollarSign,
      description: 'Settlement confirmed via Dash SFTP'
    }
  ];

  return (
    <div className="fintech-card p-6 mb-6" role="region" aria-label="Delivery and Conversion Funnel">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 mb-6 gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-900">
            Delivery & Conversion Funnel
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            End-to-end lifecycle tracking from claimant roster ingestion to completed banking settlement
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs font-semibold">
          <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full border border-blue-200">
            Delivery: {rates.deliveryRate}%
          </span>
          <span className="px-3 py-1 bg-purple-50 text-purple-700 rounded-full border border-purple-200">
            Click: {rates.clickRate}%
          </span>
          <span className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-200">
            Conversion: {rates.conversionRate}%
          </span>
        </div>
      </div>

      {/* Visual Funnel Stack */}
      <div className="space-y-4">
        {stageDefinitions.map((stage, idx) => {
          const Icon = stage.icon;
          const barWidth = Math.max(stage.pctOfTotal, 2);

          return (
            <div key={stage.key} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <div className="flex items-center gap-2 font-semibold text-slate-800">
                  <div
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-card-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: stage.color
                    }}
                  >
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  </div>
                  <span>{stage.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {stage.count.toLocaleString()}
                  </span>
                  <span className="text-xs text-slate-500 font-medium">
                    ({stage.pctOfTotal}%)
                  </span>
                </div>
              </div>

              {/* Progress bar container */}
              <div
                style={{
                  width: '100%',
                  backgroundColor: '#f1f5f9',
                  borderRadius: 'var(--radius-full)',
                  height: '10px',
                  overflow: 'hidden',
                  display: 'flex'
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${barWidth}%`,
                    backgroundColor: stage.color,
                    borderRadius: 'var(--radius-full)',
                    transition: 'width 0.4s ease-out'
                  }}
                />
              </div>

              {/* Drop-off indicator between stages */}
              {stage.dropOff !== undefined && stage.dropOff > 0 && idx < stageDefinitions.length - 1 && (
                <div className="flex items-center gap-1.5 text-xs text-amber-700 pt-0.5 pb-1 pl-8">
                  <ArrowRight className="w-3 h-3 text-amber-500" aria-hidden="true" />
                  <span>
                    Drop-off: <strong>{stage.dropOff}%</strong> ({stage.dropOffNote})
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
