import React from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip
} from 'recharts';
import { PaymentRailMetricsData } from '../../types';

interface PaymentRailDistributionProps {
  methodsData: PaymentRailMetricsData | null;
  isLoading?: boolean;
}

export const PaymentRailDistribution: React.FC<PaymentRailDistributionProps> = ({
  methodsData,
  isLoading
}) => {
  if (isLoading || !methodsData) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="fintech-card p-6 h-80 animate-pulse">
          <div className="h-5 bg-slate-200 rounded w-1/3 mb-4"></div>
          <div className="h-60 bg-slate-100 rounded"></div>
        </div>
        <div className="fintech-card p-6 h-80 animate-pulse">
          <div className="h-5 bg-slate-200 rounded w-1/3 mb-4"></div>
          <div className="h-60 bg-slate-100 rounded"></div>
        </div>
      </div>
    );
  }

  const { methods, totalSelected, totalAmount } = methodsData;
  const activeMethods = methods.filter((m) => m.count > 0);

  // If no claimants have selected payment rails yet
  if (totalSelected === 0) {
    return (
      <div className="fintech-card p-8 mb-6 text-center">
        <h3 className="text-lg font-bold text-slate-800 mb-1">
          Payment Method Distribution (All 9 Rails)
        </h3>
        <p className="text-sm text-slate-500 mb-4">
          No claimants have elected payment methods or transitioned to fallback yet.
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-2 mt-4 text-xs text-slate-600">
          {methods.map((m) => (
            <div key={m.method} className="p-2 bg-slate-50 rounded border border-slate-200 flex flex-col items-center">
              <span className="w-3 h-3 rounded-full mb-1" style={{ backgroundColor: m.color }} />
              <span className="truncate w-full text-center" title={m.name}>{m.name.split(' ')[0]}</span>
              <span className="font-bold text-slate-900 mt-1">0</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Format currency tooltip
  const renderDollarTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      return (
        <div style={{ backgroundColor: '#0f172a', color: '#ffffff', padding: '10px 14px', borderRadius: '8px', boxShadow: 'var(--shadow-lg)', fontSize: '12px' }}>
          <p style={{ fontWeight: 700, fontSize: '13px' }}>{item.name}</p>
          <p style={{ color: '#cbd5e1', marginTop: '4px' }}>Amount: <strong style={{ color: '#ffffff' }}>{item.totalAmountFormatted || `$${item.totalAmount.toLocaleString()}`}</strong></p>
          <p style={{ color: '#cbd5e1' }}>Volume: {item.count.toLocaleString()} claimants ({item.percentage}%)</p>
        </div>
      );
    }
    return null;
  };

  const renderDonutTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      return (
        <div style={{ backgroundColor: '#0f172a', color: '#ffffff', padding: '10px 14px', borderRadius: '8px', boxShadow: 'var(--shadow-lg)', fontSize: '12px' }}>
          <p style={{ fontWeight: 700, fontSize: '13px' }}>{item.name}</p>
          <p style={{ color: '#cbd5e1', marginTop: '4px' }}>Claimants: <strong style={{ color: '#ffffff' }}>{item.count.toLocaleString()}</strong></p>
          <p style={{ color: '#cbd5e1' }}>Share: <strong style={{ color: '#38bdf8' }}>{item.percentage}%</strong></p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6" role="region" aria-label="Payment Rails Distribution Charts">
      {/* 1. Volume Share Donut Chart */}
      <div className="fintech-card p-6 flex flex-col justify-between">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Payment Rail Share (%)
            </h3>
            <p className="text-xs text-slate-500">
              Claimant volume distribution across 9 rails
            </p>
          </div>
          <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200">
            {totalSelected.toLocaleString()} Selected
          </span>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={activeMethods}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={95}
                paddingAngle={3}
              >
                {activeMethods.map((entry) => (
                  <Cell key={`cell-${entry.method}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={renderDonutTooltip} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend pills */}
        <div className="flex flex-wrap gap-2 mt-4 text-xs">
          {activeMethods.map((m) => (
            <div key={m.method} className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: m.color }} />
              <span className="font-medium text-slate-700">{m.name}:</span>
              <span className="font-bold text-slate-900">{m.percentage}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Dollar Allocation Bar Chart */}
      <div className="fintech-card p-6 flex flex-col justify-between">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Disbursement Dollar Allocation ($)
            </h3>
            <p className="text-xs text-slate-500">
              Total funds routed per payment rail
            </p>
          </div>
          <span className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
            ${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={activeMethods}
              margin={{ top: 5, right: 20, left: 20, bottom: 5 }}
            >
              <XAxis
                type="number"
                tickFormatter={(v) => `$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`}
                tick={{ fontSize: 11, fill: '#64748b' }}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={110}
                tick={{ fontSize: 11, fill: '#334155' }}
              />
              <Tooltip content={renderDollarTooltip} />
              <Bar dataKey="totalAmount" radius={[0, 6, 6, 0]}>
                {activeMethods.map((entry) => (
                  <Cell key={`bar-${entry.method}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="text-xs text-slate-500 mt-4 text-center">
          Includes all 9 payment rails (Direct Deposit, Cards, Check, Crypto, Wallets, Court Fallback)
        </div>
      </div>
    </div>
  );
};
