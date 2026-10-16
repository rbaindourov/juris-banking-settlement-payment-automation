import React, { useState } from 'react';
import {
  Radio,
  PauseCircle,
  PlayCircle,
  CalendarClock,
  Ban,
  CheckCircle2,
  Calendar,
  Clock,
  FileText,
  RefreshCw,
  AlertTriangle,
  Eye,
  MousePointerClick
} from 'lucide-react';
import {
  IEmailWave,
  LiveWaveTelemetryConsoleProps
} from '../../types/cadence';
import { RescheduleWaveModal } from './RescheduleWaveModal';

export const LiveWaveTelemetryConsole: React.FC<LiveWaveTelemetryConsoleProps> = ({
  waves,
  deadlineDate,
  onPause,
  onResume,
  onReschedule,
  onCancel,
  isRefreshing = false,
  onRefresh
}) => {
  // Modal states
  const [rescheduleTargetWave, setRescheduleTargetWave] = useState<IEmailWave | null>(null);
  const [isRescheduling, setIsRescheduling] = useState<boolean>(false);

  const [pauseTargetWave, setPauseTargetWave] = useState<IEmailWave | null>(null);
  const [pauseReason, setPauseReason] = useState<string>('');
  const [isPausing, setIsPausing] = useState<boolean>(false);

  const [resumeTargetWave, setResumeTargetWave] = useState<IEmailWave | null>(null);
  const [isResuming, setIsResuming] = useState<boolean>(false);

  const [cancelTargetWave, setCancelTargetWave] = useState<IEmailWave | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [isCancelling, setIsCancelling] = useState<boolean>(false);

  const [actionError, setActionError] = useState<string | null>(null);

  // Status badge helper
  const renderStatusPill = (status: IEmailWave['status']) => {
    switch (status) {
      case 'in_progress':
        return (
          <span className="status-pill status-pill-active" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Radio size={12} className="animate-pulse" color="var(--color-success)" aria-hidden={true} />
            <span>In Progress</span>
          </span>
        );
      case 'paused':
        return (
          <span className="status-pill status-pill-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <PauseCircle size={12} color="var(--color-warning)" aria-hidden={true} />
            <span>Paused</span>
          </span>
        );
      case 'scheduled':
        return (
          <span className="status-pill status-pill-indigo" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Calendar size={12} color="var(--color-indigo)" aria-hidden={true} />
            <span>Scheduled</span>
          </span>
        );
      case 'rescheduled':
        return (
          <span className="status-pill status-pill-indigo" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Clock size={12} color="var(--color-indigo)" aria-hidden={true} />
            <span>Rescheduled</span>
          </span>
        );
      case 'completed':
        return (
          <span className="status-pill status-pill-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <CheckCircle2 size={12} color="var(--color-success)" aria-hidden={true} />
            <span>Completed</span>
          </span>
        );
      case 'cancelled':
        return (
          <span className="status-pill status-pill-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Ban size={12} color="var(--color-danger)" aria-hidden={true} />
            <span>Cancelled</span>
          </span>
        );
      case 'draft':
      default:
        return (
          <span className="status-pill status-pill-draft" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <FileText size={12} color="var(--text-muted)" aria-hidden={true} />
            <span>Draft</span>
          </span>
        );
    }
  };

  const handleConfirmPause = async () => {
    if (!pauseTargetWave) return;
    setIsPausing(true);
    setActionError(null);
    try {
      await onPause(pauseTargetWave.waveId, pauseReason.trim() || undefined);
      setPauseTargetWave(null);
      setPauseReason('');
    } catch (err: any) {
      setActionError(err.message || 'Failed to pause wave');
    } finally {
      setIsPausing(false);
    }
  };

  const handleConfirmResume = async () => {
    if (!resumeTargetWave) return;
    setIsResuming(true);
    setActionError(null);
    try {
      await onResume(resumeTargetWave.waveId);
      setResumeTargetWave(null);
    } catch (err: any) {
      setActionError(err.message || 'Failed to resume wave');
    } finally {
      setIsResuming(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancelTargetWave) return;
    if (!cancelReason.trim()) {
      setActionError('A cancellation reason is required for judicial audit logs.');
      return;
    }
    setIsCancelling(true);
    setActionError(null);
    try {
      await onCancel(cancelTargetWave.waveId, cancelReason.trim());
      setCancelTargetWave(null);
      setCancelReason('');
    } catch (err: any) {
      setActionError(err.message || 'Failed to cancel wave');
    } finally {
      setIsCancelling(false);
    }
  };

  const activeWaveCount = waves.filter((w) => w.status === 'in_progress').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Control Console Header */}
      <div
        className="fintech-card"
        style={{
          padding: '20px 24px',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          backgroundColor: '#ffffff',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Radio size={18} color="var(--color-indigo)" aria-hidden={true} />
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Live Rolling Wave Telemetry & Operational Controls
            </h3>
            {activeWaveCount > 0 && (
              <span className="status-pill status-pill-active" style={{ fontSize: '10px', padding: '2px 6px' }}>
                {activeWaveCount} IN FLIGHT
              </span>
            )}
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
            Real-time delivery funnels, sub-batch completion meters, and operational Pause/Resume/Reschedule/Cancel actions.
          </p>
        </div>

        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="btn-secondary"
            style={{ minHeight: '44px', padding: '0 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
            aria-label="Refresh wave telemetry"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} aria-hidden={true} />
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh Telemetry'}</span>
          </button>
        )}
      </div>

      {actionError && (
        <div
          role="alert"
          style={{
            padding: '12px 16px',
            backgroundColor: 'var(--color-danger-bg)',
            border: '1px solid var(--color-danger-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-danger-text)',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <AlertTriangle size={16} color="var(--color-danger)" aria-hidden={true} />
          <span>{actionError}</span>
        </div>
      )}

      {/* Wave List / Empty State */}
      {waves.length === 0 ? (
        <div
          className="fintech-card"
          style={{
            padding: '48px 24px',
            textAlign: 'center',
            backgroundColor: '#ffffff',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-card)',
            color: 'var(--text-muted)'
          }}
        >
          <FileText size={32} color="var(--text-muted)" style={{ margin: '0 auto 12px auto' }} aria-hidden={true} />
          <h4 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>
            No Notification Waves Generated Yet
          </h4>
          <p style={{ fontSize: '13px', margin: 0 }}>
            Configure and save your cadence schedule in the <strong>Campaign & Throttling Designer</strong> tab to instantiate rolling waves.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {waves.map((wave) => {
            const completed = wave.completedSubBatches || 0;
            const total = wave.totalSubBatches || 0;
            const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

            const isTerminal = wave.status === 'completed' || wave.status === 'cancelled';
            const isPaused = wave.status === 'paused';
            const isInProgress = wave.status === 'in_progress';
            const isScheduled = wave.status === 'scheduled' || wave.status === 'rescheduled';

            const openRate =
              wave.telemetry?.dispatched > 0
                ? Math.round(((wave.telemetry.opened || 0) / wave.telemetry.dispatched) * 100)
                : 0;
            const clickRate =
              wave.telemetry?.dispatched > 0
                ? Math.round(((wave.telemetry.clicked || 0) / wave.telemetry.dispatched) * 100)
                : 0;

            return (
              <div
                key={wave.waveId}
                className="fintech-card"
                style={{
                  padding: '20px 24px',
                  backgroundColor: '#ffffff',
                  border: isInProgress
                    ? '2px solid var(--color-indigo)'
                    : '1px solid var(--border-card)',
                  borderRadius: 'var(--radius-lg)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  boxShadow: isInProgress ? 'var(--shadow-sm)' : 'none'
                }}
              >
                {/* Wave Header Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {wave.stageName || wave.stage}
                      </span>
                      {renderStatusPill(wave.status)}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Wave ID: <code style={{ fontFamily: 'var(--font-mono)' }}>{wave.waveId}</code> • Target Date:{' '}
                      <strong>{wave.scheduledDate ? new Date(wave.scheduledDate).toLocaleString() : 'TBD'}</strong>
                    </div>
                  </div>

                  {/* Operational Action Buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {/* Pause Button */}
                    {(isInProgress || isScheduled) && (
                      <button
                        type="button"
                        onClick={() => {
                          setPauseTargetWave(wave);
                          setActionError(null);
                        }}
                        className="btn-secondary"
                        style={{ minHeight: '44px', padding: '0 12px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                        aria-label={`Pause wave ${wave.stageName || wave.stage}`}
                      >
                        <PauseCircle size={14} color="var(--color-warning)" aria-hidden={true} />
                        <span>Pause Wave</span>
                      </button>
                    )}

                    {/* Resume Button */}
                    {(isPaused || wave.status === 'rescheduled') && (
                      <button
                        type="button"
                        onClick={() => {
                          setResumeTargetWave(wave);
                          setActionError(null);
                        }}
                        className="btn-primary"
                        style={{ minHeight: '44px', padding: '0 12px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                        aria-label={`Resume wave ${wave.stageName || wave.stage}`}
                      >
                        <PlayCircle size={14} aria-hidden={true} />
                        <span>Resume Wave</span>
                      </button>
                    )}

                    {/* Reschedule Button */}
                    {!isTerminal && (
                      <button
                        type="button"
                        onClick={() => {
                          setRescheduleTargetWave(wave);
                          setActionError(null);
                        }}
                        className="btn-secondary"
                        style={{ minHeight: '44px', padding: '0 12px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                        aria-label={`Reschedule wave ${wave.stageName || wave.stage}`}
                      >
                        <CalendarClock size={14} color="var(--color-indigo)" aria-hidden={true} />
                        <span>Reschedule</span>
                      </button>
                    )}

                    {/* Cancel Button */}
                    {!isTerminal && (
                      <button
                        type="button"
                        onClick={() => {
                          setCancelTargetWave(wave);
                          setActionError(null);
                        }}
                        className="btn-secondary"
                        style={{
                          minHeight: '44px',
                          padding: '0 12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '12px',
                          color: 'var(--color-danger)'
                        }}
                        aria-label={`Cancel wave ${wave.stageName || wave.stage}`}
                      >
                        <Ban size={14} color="var(--color-danger)" aria-hidden={true} />
                        <span>Cancel Wave</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Sub-Batch Progress Bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    <span>Sub-Batch Progress: {completed} of {total} batches ({progressPercent}%)</span>
                    <span>{wave.throttlingConfig ? `${wave.throttlingConfig.batchSize} msgs/batch every ${wave.throttlingConfig.intervalMinutes}m` : ''}</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={progressPercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    style={{
                      height: '10px',
                      borderRadius: 'var(--radius-full)',
                      backgroundColor: '#e2e8f0',
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${progressPercent}%`,
                        backgroundColor: isPaused
                          ? 'var(--color-warning)'
                          : isTerminal && wave.status === 'completed'
                          ? 'var(--color-success)'
                          : 'var(--color-indigo)',
                        transition: 'width 0.4s ease'
                      }}
                    />
                  </div>
                </div>

                {/* Telemetry Counter Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                    gap: '10px',
                    padding: '12px 14px',
                    backgroundColor: 'var(--bg-card-subtle)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Eligible</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {wave.telemetry?.eligible?.toLocaleString() ?? 0}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Queued</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-indigo)', fontVariantNumeric: 'tabular-nums' }}>
                      {wave.telemetry?.queued?.toLocaleString() ?? 0}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Dispatched</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {wave.telemetry?.dispatched?.toLocaleString() ?? 0}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Skipped (Done)</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-success)', fontVariantNumeric: 'tabular-nums' }}>
                      {wave.telemetry?.skipped_completed?.toLocaleString() ?? 0}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Suppressed</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-warning)', fontVariantNumeric: 'tabular-nums' }}>
                      {wave.telemetry?.suppressed_bounced?.toLocaleString() ?? 0}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Failed</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-danger)', fontVariantNumeric: 'tabular-nums' }}>
                      {wave.telemetry?.failed?.toLocaleString() ?? 0}
                    </div>
                  </div>

                  {/* Open & Click Engagement */}
                  <div style={{ borderLeft: '1px solid var(--border-default)', paddingLeft: '10px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Eye size={12} aria-hidden={true} /> Opened
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                      {wave.telemetry?.opened ?? 0} ({openRate}%)
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <MousePointerClick size={12} aria-hidden={true} /> Clicked
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                      {wave.telemetry?.clicked ?? 0} ({clickRate}%)
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reschedule Modal */}
      <RescheduleWaveModal
        isOpen={Boolean(rescheduleTargetWave)}
        onClose={() => setRescheduleTargetWave(null)}
        wave={rescheduleTargetWave}
        deadlineDate={deadlineDate}
        isSubmitting={isRescheduling}
        onConfirmReschedule={async (waveId, newDate, reason) => {
          setIsRescheduling(true);
          try {
            await onReschedule(waveId, newDate, reason);
            setRescheduleTargetWave(null);
          } finally {
            setIsRescheduling(false);
          }
        }}
      />

      {/* Pause Confirmation Modal */}
      {pauseTargetWave && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          style={{ zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setPauseTargetWave(null);
          }}
        >
          <div
            className="modal-container"
            style={{
              maxWidth: '480px',
              width: '90%',
              backgroundColor: '#ffffff',
              borderRadius: 'var(--radius-lg)',
              padding: '24px',
              border: '1px solid var(--border-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <PauseCircle size={20} color="var(--color-warning)" aria-hidden={true} />
              <h3 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Pause Wave Dispatch?
              </h3>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
              Pausing <strong>{pauseTargetWave.stageName || pauseTargetWave.stage}</strong> immediately halts all pending sub-batches in Agenda. No further notifications will be sent until resumed.
            </p>
            <div>
              <label htmlFor="pause-reason-input" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Pause Reason (Optional):
              </label>
              <input
                id="pause-reason-input"
                type="text"
                placeholder="e.g. Temporary investigation of bounce rate..."
                value={pauseReason}
                onChange={(e) => setPauseReason(e.target.value)}
                className="fintech-input"
                style={{ width: '100%', minHeight: '44px' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setPauseTargetWave(null)}
                disabled={isPausing}
                className="btn-secondary"
                style={{ minHeight: '44px', padding: '0 16px' }}
              >
                Keep Active
              </button>
              <button
                type="button"
                onClick={handleConfirmPause}
                disabled={isPausing}
                className="btn-primary"
                style={{ minHeight: '44px', padding: '0 16px', backgroundColor: 'var(--color-warning)', borderColor: 'var(--color-warning)' }}
              >
                {isPausing ? 'Pausing...' : 'Confirm Pause'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resume Confirmation Modal */}
      {resumeTargetWave && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          style={{ zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setResumeTargetWave(null);
          }}
        >
          <div
            className="modal-container"
            style={{
              maxWidth: '480px',
              width: '90%',
              backgroundColor: '#ffffff',
              borderRadius: 'var(--radius-lg)',
              padding: '24px',
              border: '1px solid var(--border-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <PlayCircle size={20} color="var(--color-indigo)" aria-hidden={true} />
              <h3 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Resume Wave Dispatch?
              </h3>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
              Resuming <strong>{resumeTargetWave.stageName || resumeTargetWave.stage}</strong> will schedule the next pending sub-batch immediately, followed by the remaining batches at the configured interval.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setResumeTargetWave(null)}
                disabled={isResuming}
                className="btn-secondary"
                style={{ minHeight: '44px', padding: '0 16px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmResume}
                disabled={isResuming}
                className="btn-primary"
                style={{ minHeight: '44px', padding: '0 16px' }}
              >
                {isResuming ? 'Resuming...' : 'Confirm Resume'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {cancelTargetWave && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          style={{ zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setCancelTargetWave(null);
          }}
        >
          <div
            className="modal-container"
            style={{
              maxWidth: '480px',
              width: '90%',
              backgroundColor: '#ffffff',
              borderRadius: 'var(--radius-lg)',
              padding: '24px',
              border: '1px solid var(--border-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Ban size={20} color="var(--color-danger)" aria-hidden={true} />
              <h3 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: 'var(--color-danger)' }}>
                Cancel Notification Wave?
              </h3>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
              Cancelling <strong>{cancelTargetWave.stageName || cancelTargetWave.stage}</strong> permanently purges all remaining sub-batches from the Agenda dispatch queue. This action cannot be reversed.
            </p>
            <div>
              <label htmlFor="cancel-reason-input" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Cancellation Reason (Required for Audit Record):
              </label>
              <textarea
                id="cancel-reason-input"
                rows={3}
                required
                placeholder="e.g. Settlement terms renegotiated per court order..."
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="fintech-input"
                style={{ width: '100%', padding: '8px 12px', resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setCancelTargetWave(null)}
                disabled={isCancelling}
                className="btn-secondary"
                style={{ minHeight: '44px', padding: '0 16px' }}
              >
                Abort
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={isCancelling || !cancelReason.trim()}
                className="btn-primary"
                style={{ minHeight: '44px', padding: '0 16px', backgroundColor: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
              >
                {isCancelling ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveWaveTelemetryConsole;
