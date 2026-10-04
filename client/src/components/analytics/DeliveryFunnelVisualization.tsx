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
      <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm mb-6 animate-pulse">
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
      label: '1. Uploaded Claimants',
      count: stages.uploaded,
      pctOfTotal: Math.round(((stages.uploaded || 0) / baseline) * 100),
      color: 'bg-slate-700',
      icon: Users,
      description: 'Initial roster ingested from CSV/Excel'
    },
    {
      key: 'dispatched',
      label: '2. Notifications Dispatched',
      count: stages.dispatched,
      pctOfTotal: Math.round(((stages.dispatched || 0) / baseline) * 100),
      color: 'bg-blue-600',
      icon: Send,
      dropOff: dropOff.dispatchToDelivery,
      dropOffNote: 'Pending delivery or throttled',
      description: 'Personalized emails queued or sent'
    },
    {
      key: 'delivered',
      label: '3. Emails Delivered',
      count: stages.delivered,
      pctOfTotal: Math.round(((stages.delivered || 0) / baseline) * 100),
      color: 'bg-indigo-600',
      icon: MailCheck,
      dropOff: dropOff.deliveryToVisit,
      dropOffNote: 'Unopened / Claimant inertia',
      description: 'Confirmed delivered (zero bounce)'
    },
    {
      key: 'visited',
      label: '4. Portal Visited',
      count: stages.visited,
      pctOfTotal: Math.round(((stages.visited || 0) / baseline) * 100),
      color: 'bg-purple-600',
      icon: Eye,
      dropOff: dropOff.visitToSelect,
      dropOffNote: 'Portal exit prior to sign',
      description: 'Claimants clicked secure magic link'
    },
    {
      key: 'selected',
      label: '5. Payment Selected',
      count: stages.selected,
      pctOfTotal: Math.round(((stages.selected || 0) / baseline) * 100),
      color: 'bg-teal-600',
      icon: CheckCircle2,
      dropOff: dropOff.selectToDisburse,
      dropOffNote: 'Batch processing in flight',
      description: 'Payment preference affirmed & signed'
    },
    {
      key: 'disbursed',
      label: '6. Funds Disbursed',
      count: stages.disbursed,
      pctOfTotal: Math.round(((stages.disbursed || 0) / baseline) * 100),
      color: 'bg-emerald-600',
      icon: DollarSign,
      description: 'Settlement confirmed via Dash SFTP'
    }
  ];

  return (
    <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 mb-6 gap-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">
            Delivery & Conversion Funnel
          </h3>
          <p className="text-sm text-slate-500">
            Lifecycle tracking from roster ingestion to completed disbursement
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-medium">
          <span className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full border border-blue-200">
            Delivery: {rates.deliveryRate}%
          </span>
          <span className="px-2.5 py-1 bg-purple-50 text-purple-700 rounded-full border border-purple-200">
            Click: {rates.clickRate}%
          </span>
          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-200">
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
            <div key={stage.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <div className="flex items-center gap-2 font-medium text-slate-800">
                  <Icon className="w-4 h-4 text-slate-600" />
                  <span>{stage.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900">
                    {stage.count.toLocaleString()}
                  </span>
                  <span className="text-xs text-slate-500">
                    ({stage.pctOfTotal}%)
                  </span>
                </div>
              </div>

              {/* Progress bar container */}
              <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden flex">
                <div
                  className={`h-full ${stage.color} rounded-full transition-all duration-500 ease-out`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>

              {/* Drop-off indicator between stages */}
              {stage.dropOff !== undefined && stage.dropOff > 0 && idx < stageDefinitions.length - 1 && (
                <div className="flex items-center gap-1.5 text-xs text-amber-700 pt-0.5 pb-1 pl-6">
                  <ArrowRight className="w-3 h-3 text-amber-500" />
                  <span>
                    Drop-off: <strong>{stage.dropOff}%</strong> ({stage.dropOffNote})
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Screen-reader accessible table for WCAG 2.1 AA */}
      <div className="sr-only">
        <table>
          <caption>Delivery Funnel Statistics Table</caption>
          <thead>
            <tr>
              <th scope="col">Stage</th>
              <th scope="col">Count</th>
              <th scope="col">Percentage</th>
            </tr>
          </thead>
          <tbody>
            {stageDefinitions.map((s) => (
              <tr key={s.key}>
                <td>{s.label}</td>
                <td>{s.count}</td>
                <td>{s.pctOfTotal}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
