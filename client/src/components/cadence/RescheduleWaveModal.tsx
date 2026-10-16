import React, { useState, useEffect, useRef } from 'react';
import {
  CalendarClock,
  X,
  AlertTriangle,
  Clock,
  Layers,
  Check
} from 'lucide-react';
import {
  RescheduleWaveModalProps
} from '../../types/cadence';

export const RescheduleWaveModal: React.FC<RescheduleWaveModalProps> = ({
  isOpen,
  onClose,
  wave,
  deadlineDate,
  onConfirmReschedule,
  isSubmitting = false
}) => {
  const [selectedDateTime, setSelectedDateTime] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // Initialize selectedDateTime to current scheduled date or now + 1 hour
  useEffect(() => {
    if (!isOpen || !wave) return;

    setErrorMsg(null);
    setReason('');

    const base = wave.scheduledDate ? new Date(wave.scheduledDate) : new Date();
    const defaultDate = base.getTime() > Date.now() ? base : new Date(Date.now() + 60 * 60 * 1000);

    // Format for datetime-local (YYYY-MM-DDTHH:mm)
    const localIso = new Date(defaultDate.getTime() - defaultDate.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setSelectedDateTime(localIso);
  }, [isOpen, wave]);

  // Accessibility: Focus trap & Escape listener
  useEffect(() => {
    if (!isOpen) return;

    if (dateInputRef.current) {
      dateInputRef.current.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const modalEl = modalRef.current;
        if (!modalEl) return;
        const focusables = Array.from(
          modalEl.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null);

        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !wave) return null;

  const minDateTime = new Date(Date.now() + 5 * 60 * 1000 - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  const selectedDateObj = selectedDateTime ? new Date(selectedDateTime) : null;
  const isPast = Boolean(selectedDateObj && selectedDateObj.getTime() <= Date.now());

  let isAfterDeadline = false;
  if (selectedDateObj && deadlineDate) {
    const d = new Date(deadlineDate);
    isAfterDeadline = selectedDateObj.getTime() > d.getTime();
  }

  const applyOffsetPreset = (hours: number) => {
    const target = new Date(Date.now() + hours * 3600 * 1000);
    const localIso = new Date(target.getTime() - target.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setSelectedDateTime(localIso);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDateObj || isPast) {
      setErrorMsg('Please select a future dispatch date and time.');
      return;
    }
    setErrorMsg(null);
    try {
      await onConfirmReschedule(wave.waveId, selectedDateObj, reason.trim() || undefined);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to reschedule wave');
    }
  };

  const remainingBatches = Math.max(0, (wave.totalSubBatches || 0) - (wave.completedSubBatches || 0));
  const intervalMinutes = wave.throttlingConfig?.intervalMinutes || 15;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-modal-title"
      style={{ zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="modal-container"
        style={{
          maxWidth: '560px',
          width: '95%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          backgroundColor: '#ffffff',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          border: '1px solid var(--border-card)'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CalendarClock size={20} color="var(--color-indigo)" aria-hidden={true} />
            <h3 id="reschedule-modal-title" style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Reschedule Notification Wave
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
            style={{ width: '36px', height: '36px', minHeight: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-full)' }}
            aria-label="Close dialog"
          >
            <X size={18} aria-hidden={true} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Wave Context Summary Box */}
          <div
            style={{
              padding: '14px 16px',
              backgroundColor: 'var(--bg-card-subtle)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              fontSize: '13px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Wave Target:</span>
              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{wave.stageName || wave.stage}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Current Schedule:</span>
              <span style={{ color: 'var(--text-muted)' }}>
                {wave.scheduledDate ? new Date(wave.scheduledDate).toLocaleString() : 'Not scheduled'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Sub-Batches to Re-Space:</span>
              <span style={{ fontWeight: 700, color: 'var(--color-indigo)' }}>
                {remainingBatches} batches remaining ({intervalMinutes}m interval)
              </span>
            </div>
          </div>

          {/* Quick Presets */}
          <div>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
              Quick Target Presets:
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {[
                { label: '+1 Hour', h: 1 },
                { label: '+4 Hours', h: 4 },
                { label: '+1 Day', h: 24 },
                { label: '+3 Days', h: 72 },
                { label: '+1 Week', h: 168 }
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyOffsetPreset(p.h)}
                  className="btn-secondary"
                  style={{ padding: '6px 12px', minHeight: '44px', fontSize: '12px' }}
                >
                  <Clock size={13} aria-hidden={true} />
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* New Target Date & Time Input */}
          <div>
            <label
              htmlFor="reschedule-datetime"
              style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}
            >
              New Scheduled Dispatch Date & Time:
            </label>
            <input
              id="reschedule-datetime"
              ref={dateInputRef}
              type="datetime-local"
              min={minDateTime}
              value={selectedDateTime}
              onChange={(e) => setSelectedDateTime(e.target.value)}
              className="fintech-input"
              style={{ width: '100%', minHeight: '44px' }}
              required
            />
            {isPast && (
              <span style={{ fontSize: '11px', color: 'var(--color-danger)', marginTop: '4px', display: 'block' }}>
                Dispatch timestamp must be set in the future.
              </span>
            )}
          </div>

          {/* Deadline Warning Callout */}
          {isAfterDeadline && (
            <div
              role="alert"
              style={{
                padding: '12px 14px',
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
              <AlertTriangle size={18} color="var(--color-warning)" style={{ flexShrink: 0 }} aria-hidden={true} />
              <span>
                <strong>Deadline Caution:</strong> The selected dispatch timestamp is scheduled after the Case Election Deadline (
                {deadlineDate ? new Date(deadlineDate).toLocaleDateString() : ''}). Claimants may be notified after election closes.
              </span>
            </div>
          )}

          {/* Reschedule Reason */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label htmlFor="reschedule-reason" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Reason for Rescheduling (Audit Trail):
              </label>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{reason.length}/500</span>
            </div>
            <textarea
              id="reschedule-reason"
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Deferred per court order approving revised notice language..."
              className="fintech-input"
              style={{ width: '100%', padding: '8px 12px', resize: 'vertical' }}
            />
          </div>

          {/* Sub-Batch Stagger Preview */}
          {selectedDateObj && !isPast && remainingBatches > 1 && (
            <div
              style={{
                padding: '12px 14px',
                backgroundColor: '#f8fafc',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                <Layers size={14} color="var(--color-indigo)" aria-hidden={true} />
                <span>Staggered Sub-Batch Timeline Preview:</span>
              </div>
              <div style={{ color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div>
                  • Batch {(wave.completedSubBatches || 0) + 1} of {wave.totalSubBatches}: <strong>{selectedDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                </div>
                <div>
                  • Batch {(wave.completedSubBatches || 0) + 2} of {wave.totalSubBatches}: <strong>{new Date(selectedDateObj.getTime() + intervalMinutes * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                </div>
                <div>
                  • Final Batch {wave.totalSubBatches}: <strong>{new Date(selectedDateObj.getTime() + (remainingBatches - 1) * intervalMinutes * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                </div>
              </div>
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              style={{
                padding: '10px 14px',
                backgroundColor: 'var(--color-danger-bg)',
                border: '1px solid var(--color-danger-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-danger-text)',
                fontSize: '12px'
              }}
            >
              {errorMsg}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="btn-secondary"
              style={{ minHeight: '44px', padding: '0 16px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isPast || !selectedDateTime}
              className="btn-primary"
              style={{ minHeight: '44px', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Check size={16} aria-hidden={true} />
              <span>{isSubmitting ? 'Rescheduling...' : 'Confirm Reschedule'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RescheduleWaveModal;
