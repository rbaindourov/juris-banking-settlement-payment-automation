import React, { useMemo } from 'react';
import {
  Sliders,
  Clock,
  AlertTriangle,
  Zap,
  Moon,
  Save,
  CheckCircle2
} from 'lucide-react';
import {
  ICadenceThrottling,
  BatchThrottlingConfigCardProps
} from '../../types/cadence';

export interface CampaignCalculationResult {
  totalBatches: number;
  activeDurationMinutes: number;
  quietHoursDelayMinutes: number;
  dailyCapRolloverDays: number;
  totalElapsedMinutes: number;
  projectedCompletionDate: Date;
  isAfterDeadline: boolean;
  batchesPerDay: number;
  dailyThroughputSummary: Array<{
    dayNumber: number;
    dateFormatted: string;
    batchesCount: number;
    recipientCount: number;
  }>;
}

export function calculateCampaignCompletion(
  totalRecipients: number,
  throttling: ICadenceThrottling,
  startTime: Date = new Date(),
  electionDeadline?: string | Date | null
): CampaignCalculationResult {
  const batchSize = Math.max(1, throttling.batchSize || 100);
  const intervalMinutes = Math.max(1, throttling.intervalMinutes || 15);
  const dailyCap = throttling.dailyCap && throttling.dailyCap > 0 ? throttling.dailyCap : Infinity;
  const totalBatches = totalRecipients > 0 ? Math.ceil(totalRecipients / batchSize) : 0;

  if (totalBatches === 0) {
    return {
      totalBatches: 0,
      activeDurationMinutes: 0,
      quietHoursDelayMinutes: 0,
      dailyCapRolloverDays: 0,
      totalElapsedMinutes: 0,
      projectedCompletionDate: startTime,
      isAfterDeadline: false,
      batchesPerDay: 0,
      dailyThroughputSummary: []
    };
  }

  let currentTime = new Date(startTime.getTime());
  let dailySentCount = 0;
  let quietHoursDelayTotalMs = 0;
  const dailySummary: Map<string, { batches: number; recipients: number }> = new Map();

  const [qhStartH, qhStartM] = (throttling.quietHoursStart || '22:00').split(':').map(Number);
  const [qhEndH, qhEndM] = (throttling.quietHoursEnd || '07:00').split(':').map(Number);

  function isQuiet(d: Date): boolean {
    if (!throttling.quietHoursEnabled) return false;
    const h = d.getHours();
    const m = d.getMinutes();
    const curM = h * 60 + m;
    const startM = qhStartH * 60 + qhStartM;
    const endM = qhEndH * 60 + qhEndM;
    if (startM > endM) {
      return curM >= startM || curM < endM;
    }
    return curM >= startM && curM < endM;
  }

  function advanceToNextSendWindow(d: Date): Date {
    const next = new Date(d.getTime());
    const h = next.getHours();
    const m = next.getMinutes();
    const curM = h * 60 + m;
    const startM = qhStartH * 60 + qhStartM;
    const endM = qhEndH * 60 + qhEndM;

    let daysToAdd = 0;
    if (startM > endM) {
      if (curM >= startM) daysToAdd = 1;
    } else {
      if (curM >= endM) daysToAdd = 1;
    }
    next.setDate(next.getDate() + daysToAdd);
    next.setHours(qhEndH, qhEndM, 0, 0);
    return next;
  }

  // Pre-check if start time falls inside quiet hours
  if (isQuiet(currentTime)) {
    const nextWindow = advanceToNextSendWindow(currentTime);
    quietHoursDelayTotalMs += (nextWindow.getTime() - currentTime.getTime());
    currentTime = nextWindow;
  }

  let currentDayKey = currentTime.toISOString().slice(0, 10);

  for (let b = 0; b < totalBatches; b++) {
    const recipientsInThisBatch = Math.min(batchSize, totalRecipients - b * batchSize);

    // Daily cap enforcement
    if (dailySentCount + recipientsInThisBatch > dailyCap) {
      const nextDay = new Date(currentTime.getTime());
      nextDay.setDate(nextDay.getDate() + 1);
      nextDay.setHours(throttling.quietHoursEnabled ? qhEndH : 8, throttling.quietHoursEnabled ? qhEndM : 0, 0, 0);
      currentTime = nextDay;
      dailySentCount = 0;
      currentDayKey = currentTime.toISOString().slice(0, 10);
    }

    // Quiet hours blackout check
    if (isQuiet(currentTime)) {
      const nextWindow = advanceToNextSendWindow(currentTime);
      quietHoursDelayTotalMs += (nextWindow.getTime() - currentTime.getTime());
      currentTime = nextWindow;
      currentDayKey = currentTime.toISOString().slice(0, 10);
      dailySentCount = 0;
    }

    // Record daily throughput
    const dayStat = dailySummary.get(currentDayKey) || { batches: 0, recipients: 0 };
    dayStat.batches += 1;
    dayStat.recipients += recipientsInThisBatch;
    dailySummary.set(currentDayKey, dayStat);
    dailySentCount += recipientsInThisBatch;

    // Increment time for next batch (except after the final batch)
    if (b < totalBatches - 1) {
      currentTime = new Date(currentTime.getTime() + intervalMinutes * 60 * 1000);
    }
  }

  const totalElapsedMs = currentTime.getTime() - startTime.getTime();
  const totalElapsedMinutes = Math.max(0, Math.round(totalElapsedMs / (60 * 1000)));
  const quietHoursDelayMinutes = Math.round(quietHoursDelayTotalMs / (60 * 1000));
  const activeDurationMinutes = (totalBatches - 1) * intervalMinutes;

  let isAfterDeadline = false;
  if (electionDeadline) {
    const deadlineDate = new Date(electionDeadline);
    isAfterDeadline = currentTime.getTime() > deadlineDate.getTime();
  }

  const dailyThroughputSummary = Array.from(dailySummary.entries()).map(([dateStr, stat], idx) => ({
    dayNumber: idx + 1,
    dateFormatted: new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    batchesCount: stat.batches,
    recipientCount: stat.recipients
  }));

  return {
    totalBatches,
    activeDurationMinutes,
    quietHoursDelayMinutes,
    dailyCapRolloverDays: Math.max(0, dailyThroughputSummary.length - 1),
    totalElapsedMinutes,
    projectedCompletionDate: currentTime,
    isAfterDeadline,
    batchesPerDay: Math.floor(dailyCap / batchSize),
    dailyThroughputSummary
  };
}

const PRESETS = [
  {
    name: 'Conservative',
    batchSize: 100,
    intervalMinutes: 15,
    rateLimitPerSecond: 10,
    dailyCap: 5000,
    desc: '100 msgs / 15m spacing (ideal for warming ESP domain reputation)'
  },
  {
    name: 'Balanced Standard',
    batchSize: 250,
    intervalMinutes: 15,
    rateLimitPerSecond: 25,
    dailyCap: 10000,
    desc: '250 msgs / 15m spacing (standard class-action distribution)'
  },
  {
    name: 'High Throughput',
    batchSize: 500,
    intervalMinutes: 10,
    rateLimitPerSecond: 50,
    dailyCap: 25000,
    desc: '500 msgs / 10m spacing (urgent final notice acceleration)'
  }
];

export const BatchThrottlingConfigCard: React.FC<BatchThrottlingConfigCardProps> = ({
  throttling,
  onChange,
  totalEligibleRecipients,
  deadlineDate,
  readOnly = false,
  onSave,
  isSaving = false
}) => {
  const calculation = useMemo(() => {
    return calculateCampaignCompletion(
      totalEligibleRecipients,
      throttling,
      new Date(),
      deadlineDate
    );
  }, [totalEligibleRecipients, throttling, deadlineDate]);

  const applyPreset = (preset: typeof PRESETS[0]) => {
    if (readOnly) return;
    onChange({
      batchSize: preset.batchSize,
      intervalMinutes: preset.intervalMinutes,
      rateLimitPerSecond: preset.rateLimitPerSecond,
      dailyCap: preset.dailyCap
    });
  };

  const formatMinutes = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  };

  return (
    <div
      className="fintech-card"
      style={{
        padding: '24px',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-lg)',
        backgroundColor: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }}
    >
      {/* Card Header & Presets */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sliders size={18} color="var(--color-indigo)" aria-hidden={true} />
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Rolling Batch Throttling & Dispatch Schedule
            </h3>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
            Configure sub-batch chunk sizes, ESP delivery pacing, and quiet-hours send windows.
          </p>
        </div>

        {onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={readOnly || isSaving}
            className="btn-primary"
            style={{ minHeight: '44px', padding: '0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Save size={15} aria-hidden={true} />
            <span>{isSaving ? 'Saving...' : 'Save Throttling'}</span>
          </button>
        )}
      </div>

      {/* Preset Quick-Buttons */}
      <div>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
          Recommended Throttling Profiles:
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {PRESETS.map((p) => {
            const isSelected =
              throttling.batchSize === p.batchSize &&
              throttling.intervalMinutes === p.intervalMinutes &&
              throttling.rateLimitPerSecond === p.rateLimitPerSecond;

            return (
              <button
                key={p.name}
                type="button"
                disabled={readOnly}
                onClick={() => applyPreset(p)}
                style={{
                  padding: '8px 14px',
                  minHeight: '44px',
                  borderRadius: 'var(--radius-md)',
                  border: isSelected ? '2px solid var(--color-indigo)' : '1px solid var(--border-subtle)',
                  backgroundColor: isSelected ? 'var(--bg-active)' : '#ffffff',
                  color: isSelected ? 'var(--color-indigo)' : 'var(--text-primary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                title={p.desc}
              >
                <Zap size={13} aria-hidden={true} />
                <span>{p.name}</span>
                {isSelected && <CheckCircle2 size={13} color="var(--color-indigo)" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Configuration Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '16px'
        }}
      >
        {/* 1. Batch Size */}
        <div>
          <label
            htmlFor="throttle-batch-size"
            style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}
          >
            Sub-Batch Size
          </label>
          <input
            id="throttle-batch-size"
            type="number"
            min={1}
            max={10000}
            step={25}
            disabled={readOnly}
            value={throttling.batchSize || 100}
            onChange={(e) => onChange({ batchSize: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            className="fintech-input"
            style={{ width: '100%', minHeight: '44px' }}
          />
          <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
            {[50, 100, 250, 500].map((sz) => (
              <button
                key={sz}
                type="button"
                disabled={readOnly}
                onClick={() => onChange({ batchSize: sz })}
                style={{
                  padding: '4px 8px',
                  minHeight: '36px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: throttling.batchSize === sz ? 'var(--bg-active)' : 'transparent',
                  color: throttling.batchSize === sz ? 'var(--color-indigo)' : 'var(--text-muted)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {sz}
              </button>
            ))}
          </div>
        </div>

        {/* 2. Interval Minutes */}
        <div>
          <label
            htmlFor="throttle-interval"
            style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}
          >
            Interval Delay (Minutes)
          </label>
          <input
            id="throttle-interval"
            type="number"
            min={1}
            max={1440}
            step={5}
            disabled={readOnly}
            value={throttling.intervalMinutes || 15}
            onChange={(e) => onChange({ intervalMinutes: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            className="fintech-input"
            style={{ width: '100%', minHeight: '44px' }}
          />
          <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
            {[5, 10, 15, 30].map((m) => (
              <button
                key={m}
                type="button"
                disabled={readOnly}
                onClick={() => onChange({ intervalMinutes: m })}
                style={{
                  padding: '4px 8px',
                  minHeight: '36px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: throttling.intervalMinutes === m ? 'var(--bg-active)' : 'transparent',
                  color: throttling.intervalMinutes === m ? 'var(--color-indigo)' : 'var(--text-muted)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {m}m
              </button>
            ))}
          </div>
        </div>

        {/* 3. Rate Limit / Sec */}
        <div>
          <label
            htmlFor="throttle-ratelimit"
            style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}
          >
            Max Pacing (msgs/sec)
          </label>
          <input
            id="throttle-ratelimit"
            type="number"
            min={1}
            max={100}
            step={5}
            disabled={readOnly}
            value={throttling.rateLimitPerSecond || 25}
            onChange={(e) => onChange({ rateLimitPerSecond: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            className="fintech-input"
            style={{ width: '100%', minHeight: '44px' }}
          />
          <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
            {[10, 25, 50].map((r) => (
              <button
                key={r}
                type="button"
                disabled={readOnly}
                onClick={() => onChange({ rateLimitPerSecond: r })}
                style={{
                  padding: '4px 8px',
                  minHeight: '36px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: throttling.rateLimitPerSecond === r ? 'var(--bg-active)' : 'transparent',
                  color: throttling.rateLimitPerSecond === r ? 'var(--color-indigo)' : 'var(--text-muted)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {r}/s
              </button>
            ))}
          </div>
        </div>

        {/* 4. Daily Cap */}
        <div>
          <label
            htmlFor="throttle-daily-cap"
            style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}
          >
            Daily Cap (24h Limit)
          </label>
          <input
            id="throttle-daily-cap"
            type="number"
            min={0}
            step={500}
            placeholder="Unlimited (0)"
            disabled={readOnly}
            value={throttling.dailyCap ?? 0}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              onChange({ dailyCap: isNaN(val) || val <= 0 ? 0 : val });
            }}
            className="fintech-input"
            style={{ width: '100%', minHeight: '44px' }}
          />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '6px' }}>
            {throttling.dailyCap && throttling.dailyCap > 0 ? `${throttling.dailyCap.toLocaleString()} msgs/day` : 'No daily cap enforced'}
          </span>
        </div>
      </div>

      {/* Quiet Hours Configuration */}
      <div
        style={{
          padding: '16px',
          borderRadius: 'var(--radius-md)',
          backgroundColor: 'var(--bg-card-subtle)',
          border: '1px solid var(--border-subtle)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Moon size={16} color="var(--color-indigo)" aria-hidden={true} />
            <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Quiet Hours Blackout Window
            </span>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, minHeight: '44px' }}>
            <input
              type="checkbox"
              checked={throttling.quietHoursEnabled}
              disabled={readOnly}
              onChange={(e) => onChange({ quietHoursEnabled: e.target.checked })}
              style={{ width: '18px', height: '18px', accentColor: 'var(--color-indigo)', cursor: 'pointer' }}
            />
            <span>Enforce Quiet Hours Blackout</span>
          </label>
        </div>

        {throttling.quietHoursEnabled && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
            <div>
              <label htmlFor="qh-start" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Start Time
              </label>
              <input
                id="qh-start"
                type="time"
                disabled={readOnly}
                value={throttling.quietHoursStart || '22:00'}
                onChange={(e) => onChange({ quietHoursStart: e.target.value })}
                className="fintech-input"
                style={{ width: '100%', minHeight: '44px' }}
              />
            </div>

            <div>
              <label htmlFor="qh-end" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Resume Time
              </label>
              <input
                id="qh-end"
                type="time"
                disabled={readOnly}
                value={throttling.quietHoursEnd || '07:00'}
                onChange={(e) => onChange({ quietHoursEnd: e.target.value })}
                className="fintech-input"
                style={{ width: '100%', minHeight: '44px' }}
              />
            </div>

            <div>
              <label htmlFor="qh-tz" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Timezone
              </label>
              <select
                id="qh-tz"
                disabled={readOnly}
                value={throttling.timezone || 'UTC'}
                onChange={(e) => onChange({ timezone: e.target.value })}
                className="fintech-select"
                style={{ width: '100%', minHeight: '44px' }}
              >
                <option value="UTC">UTC (Coordinated Universal Time)</option>
                <option value="America/New_York">America/New_York (EST/EDT)</option>
                <option value="America/Chicago">America/Chicago (CST/CDT)</option>
                <option value="America/Denver">America/Denver (MST/MDT)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Dynamic Campaign Completion Calculator */}
      <div
        style={{
          padding: '18px',
          borderRadius: 'var(--radius-md)',
          backgroundColor: '#f8fafc',
          border: '1px solid var(--border-default)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <Clock size={16} color="var(--color-indigo)" aria-hidden={true} />
          <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Dynamic Campaign Completion Calculator
          </h4>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            (Simulated for {totalEligibleRecipients.toLocaleString()} eligible recipients)
          </span>
        </div>

        {/* 4-Stat Metric Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '12px',
            marginBottom: '14px'
          }}
        >
          <div style={{ padding: '10px 14px', backgroundColor: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Sub-Batches
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {calculation.totalBatches}
            </div>
          </div>

          <div style={{ padding: '10px 14px', backgroundColor: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Active Send Time
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {formatMinutes(calculation.activeDurationMinutes)}
            </div>
          </div>

          <div style={{ padding: '10px 14px', backgroundColor: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Quiet Hours Delay
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {calculation.quietHoursDelayMinutes > 0 ? `+${formatMinutes(calculation.quietHoursDelayMinutes)}` : '0m'}
            </div>
          </div>

          <div style={{ padding: '10px 14px', backgroundColor: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Projected Finish
            </div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: calculation.isAfterDeadline ? 'var(--color-danger)' : 'var(--color-indigo)', marginTop: '2px' }}>
              {calculation.projectedCompletionDate.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
              })}
            </div>
          </div>
        </div>

        {/* Deadline Collision Alert */}
        {calculation.isAfterDeadline && (
          <div
            role="alert"
            style={{
              padding: '10px 14px',
              backgroundColor: 'var(--color-warning-bg)',
              border: '1px solid var(--color-warning-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-warning-text)',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <AlertTriangle size={16} color="var(--color-warning)" aria-hidden={true} />
            <span>
              <strong>Warning:</strong> Projected completion exceeds the Court-Ordered Settlement Selection Deadline. Increase sub-batch size or reduce interval minutes to ensure all claimants are notified before portal closure.
            </span>
          </div>
        )}

        {/* Multi-Day Throughput Timeline */}
        {calculation.dailyThroughputSummary.length > 1 && (
          <div style={{ marginTop: '12px', fontSize: '12px' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Daily Throughput Breakdown:</span>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
              {calculation.dailyThroughputSummary.map((d) => (
                <span
                  key={d.dayNumber}
                  className="status-pill status-pill-neutral"
                  style={{ fontSize: '11px', padding: '4px 8px' }}
                >
                  Day {d.dayNumber} ({d.dateFormatted}): {d.batchesCount} batches ({d.recipientCount.toLocaleString()} claimants)
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BatchThrottlingConfigCard;
