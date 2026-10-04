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
        <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm h-80 animate-pulse">
          <div className="h-5 bg-slate-200 rounded w-1/3 mb-4"></div>
          <div className="h-60 bg-slate-100 rounded"></div>
        </div>
        <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm h-80 animate-pulse">
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
      <div className="bg-white rounded-lg p-8 border border-slate-200 shadow-sm mb-6 text-center">
        <h3 className="text-lg font-semibold text-slate-800 mb-1">
          Payment Method Distribution (All 9 Rails)
        </h3>
        <p className="text-sm text-slate-500 mb-4">
          No claimants have elected payment methods or transitioned to fallback yet.
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-2 mt-4 text-xs text-slate-600">
          {methods.map((m) => (
            <div key={m.method} className="p-2 bg-slate-50 rounded border border-slate-200 flex flex-col items-center">
              <span className="w-3 h-3 rounded-full mb-1" style={{ backgroundColor: m.color }}></span>
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
        <div className="bg-slate-900 text-white p-2.5 rounded shadow-lg text-xs">
          <p className="font-bold text-sm">{item.name}</p>
          <p className="text-slate-300 mt-1">Amount: {item.totalAmountFormatted || `$${item.totalAmount.toLocaleString()}`}</p>
          <p className="text-slate-300">Volume: {item.count.toLocaleString()} claimants ({item.percentage}%)</p>
        </div>
      );
    }
    return null;
  };

  const renderDonutTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      return (
        <div className="bg-slate-900 text-white p-2.5 rounded shadow-lg text-xs">
          <p className="font-bold text-sm">{item.name}</p>
          <p className="text-slate-300 mt-1">Claimants: {item.count.toLocaleString()}</p>
          <p className="text-slate-300">Share: {item.percentage}%</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      {/* 1. Volume Share Donut Chart */}
      <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm flex flex-col justify-between">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Payment Rail Share (%)
            </h3>
            <p className="text-xs text-slate-500">
              Claimant volume distribution across 9 rails
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded">
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
            <div key={m.method} className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: m.color }} />
              <span className="font-medium text-slate-700">{m.name}:</span>
              <span className="font-bold text-slate-900">{m.percentage}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Dollar Allocation Bar Chart */}
      <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm flex flex-col justify-between">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Disbursement Dollar Allocation ($)
            </h3>
            <p className="text-xs text-slate-500">
              Total funds routed per payment rail
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-700 bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-1 rounded">
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
                tick={{ fontSize: 11 }}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={100}
                tick={{ fontSize: 11 }}
              />
              <Tooltip content={renderDollarTooltip} />
              <Bar dataKey="totalAmount" radius={[0, 4, 4, 0]}>
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

      {/* Screen-reader accessible table for WCAG 2.1 AA */}
      <div className="sr-only">
        <table>
          <caption>Payment Rail Metrics Breakdown</caption>
          <thead>
            <tr>
              <th scope="col">Payment Rail</th>
              <th scope="col">Count</th>
              <th scope="col">Percentage</th>
              <th scope="col">Total Dollars</th>
            </tr>
          </thead>
          <tbody>
            {methods.map((m) => (
              <tr key={m.method}>
                <td>{m.name}</td>
                <td>{m.count}</td>
                <td>{m.percentage}%</td>
                <td>${m.totalAmount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
