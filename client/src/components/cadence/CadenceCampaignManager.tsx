import React, { useEffect, useState, useCallback } from 'react';
import {
  Sliders,
  Radio,
  RefreshCw,
  Save,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import {
  INotificationCadence,
  IEmailWave,
  ICadenceStage,
  ICadenceThrottling,
  CadenceCampaignManagerProps
} from '../../types/cadence';
import { cadenceApi } from '../../services/api';
import { RollingCadenceTimelineBuilder } from './RollingCadenceTimelineBuilder';
import { BatchThrottlingConfigCard } from './BatchThrottlingConfigCard';
import { RecipientEligibilityPreviewCard } from './RecipientEligibilityPreviewCard';
import { LiveWaveTelemetryConsole } from './LiveWaveTelemetryConsole';

type SubTabId = 'designer' | 'telemetry';
const SUB_TAB_ORDER: SubTabId[] = ['designer', 'telemetry'];

export const CadenceCampaignManager: React.FC<CadenceCampaignManagerProps> = ({
  caseId,
  settlementCase,
  onRefreshCase,
  initialSubTab = 'designer'
}) => {
  const [activeSubTab, setActiveSubTab] = useState<SubTabId>(initialSubTab);
  const [cadence, setCadence] = useState<INotificationCadence | null>(null);
  const [waves, setWaves] = useState<IEmailWave[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState<boolean>(true);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // In-flight wave detection
  const inFlightWaves = waves.filter((w) => w.status === 'in_progress');
  const hasActiveWaves = inFlightWaves.length > 0;

  const loadAllData = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setErrorMsg(null);

    try {
      const [cadenceRes, wavesRes] = await Promise.all([
        cadenceApi.getCadence(caseId),
        cadenceApi.getWaves(caseId)
      ]);

      setCadence(cadenceRes.data);
      setWaves(wavesRes.data || []);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load notification cadence data');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [caseId]);

  useEffect(() => {
    loadAllData(false);
  }, [loadAllData]);

  // Polling loop for active rolling waves
  useEffect(() => {
    let intervalId: any = null;
    if (autoRefreshEnabled && hasActiveWaves) {
      intervalId = setInterval(async () => {
        try {
          const res = await cadenceApi.getWaves(caseId);
          setWaves(res.data || []);
        } catch {
          // Non-critical background polling failure
        }
      }, 5000); // 5-second interval during live in-progress wave dispatch
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [autoRefreshEnabled, hasActiveWaves, caseId]);

  // Save Cadence Configuration
  const handleSaveCadence = async () => {
    if (!cadence) return;
    setIsSaving(true);
    setSaveSuccessMsg(null);
    setErrorMsg(null);

    try {
      const res = await cadenceApi.saveCadence(caseId, {
        stages: cadence.stages,
        throttling: cadence.throttling,
        suppression: cadence.suppression
      });
      setCadence(res.data);
      setSaveSuccessMsg('Settlement notification cadence & throttling saved successfully.');
      if (onRefreshCase) onRefreshCase();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save cadence configuration');
    } finally {
      setIsSaving(false);
    }
  };

  // Stage changes from RollingCadenceTimelineBuilder
  const handleStagesChange = (updatedStages: ICadenceStage[]) => {
    if (!cadence) return;
    setCadence({
      ...cadence,
      stages: updatedStages
    });
  };

  // Throttling changes from BatchThrottlingConfigCard
  const handleThrottlingChange = (updatedThrottling: Partial<ICadenceThrottling>) => {
    if (!cadence) return;
    setCadence({
      ...cadence,
      throttling: {
        ...cadence.throttling,
        ...updatedThrottling
      }
    });
  };

  // Wave Action Handlers
  const handlePauseWave = async (waveId: string, reason?: string) => {
    const res = await cadenceApi.pauseWave(waveId, reason);
    setWaves((prev) => prev.map((w) => (w.waveId === waveId ? res.data : w)));
  };

  const handleResumeWave = async (waveId: string, options?: any) => {
    const res = await cadenceApi.resumeWave(waveId, options);
    setWaves((prev) => prev.map((w) => (w.waveId === waveId ? res.data : w)));
  };

  const handleRescheduleWave = async (waveId: string, newDate: Date, reason?: string) => {
    const res = await cadenceApi.rescheduleWave(waveId, newDate, reason);
    setWaves((prev) => prev.map((w) => (w.waveId === waveId ? res.data : w)));
  };

  const handleCancelWave = async (waveId: string, reason: string) => {
    const res = await cadenceApi.cancelWave(waveId, reason);
    setWaves((prev) => prev.map((w) => (w.waveId === waveId ? res.data : w)));
  };

  // Keyboard navigation for sub-tabs
  const handleSubTabKeyDown = (e: React.KeyboardEvent, currentTab: SubTabId) => {
    const currentIndex = SUB_TAB_ORDER.indexOf(currentTab);
    let nextIndex = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % SUB_TAB_ORDER.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + SUB_TAB_ORDER.length) % SUB_TAB_ORDER.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = SUB_TAB_ORDER.length - 1;
    }

    if (nextIndex >= 0) {
      const nextTab = SUB_TAB_ORDER[nextIndex];
      setActiveSubTab(nextTab);
      setTimeout(() => {
        document.getElementById(`subtab-${nextTab}`)?.focus();
      }, 0);
    }
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
        Loading notification cadence & wave telemetry...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Header & Operational Action Bar */}
      <div
        className="fintech-card"
        style={{
          padding: '20px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
          flexWrap: 'wrap',
          backgroundColor: '#ffffff',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-card)'
        }}
      >
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>
            Rolling Notification Cadence & Wave Engine
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            Configure multi-stage settlement email notifications, staggered batch windows, and monitor live waves.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Auto-Refresh Toggle */}
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              userSelect: 'none',
              minHeight: '44px'
            }}
          >
            <input
              type="checkbox"
              checked={autoRefreshEnabled}
              onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: 'var(--color-primary)' }}
            />
            <span>Auto-refresh (5s)</span>
          </label>

          {/* Manual Refresh Trigger */}
          <button
            type="button"
            onClick={() => loadAllData(true)}
            disabled={isRefreshing}
            aria-label="Refresh cadence and waves"
            className="btn-secondary"
            style={{ minHeight: '44px', padding: '0 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} aria-hidden={true} />
            <span>Refresh</span>
          </button>

          {/* Save Configuration Trigger */}
          <button
            type="button"
            onClick={handleSaveCadence}
            disabled={isSaving || !cadence}
            className="btn-primary"
            style={{ minHeight: '44px', padding: '0 18px', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Save size={16} aria-hidden={true} />
            <span>{isSaving ? 'Saving...' : 'Save Configuration'}</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {saveSuccessMsg && (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: '12px 16px',
            backgroundColor: 'var(--color-success-bg)',
            border: '1px solid var(--color-success-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-success-text)',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <CheckCircle2 size={16} color="var(--color-success)" aria-hidden={true} />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          aria-live="assertive"
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
          <AlertCircle size={16} color="var(--color-danger)" aria-hidden={true} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Sub-Tab Navigation Bar */}
      <div
        role="tablist"
        aria-label="Cadence Management Sub-Tabs"
        className="fintech-tab-strip"
      >
        <button
          type="button"
          role="tab"
          id="subtab-designer"
          aria-selected={activeSubTab === 'designer'}
          aria-controls="subpanel-designer"
          tabIndex={activeSubTab === 'designer' ? 0 : -1}
          onClick={() => setActiveSubTab('designer')}
          onKeyDown={(e) => handleSubTabKeyDown(e, 'designer')}
          className={`fintech-tab-item ${activeSubTab === 'designer' ? 'active' : ''}`}
        >
          <Sliders size={16} aria-hidden={true} />
          <span>Campaign & Throttling Designer</span>
        </button>

        <button
          type="button"
          role="tab"
          id="subtab-telemetry"
          aria-selected={activeSubTab === 'telemetry'}
          aria-controls="subpanel-telemetry"
          tabIndex={activeSubTab === 'telemetry' ? 0 : -1}
          onClick={() => setActiveSubTab('telemetry')}
          onKeyDown={(e) => handleSubTabKeyDown(e, 'telemetry')}
          className={`fintech-tab-item ${activeSubTab === 'telemetry' ? 'active' : ''}`}
        >
          <Radio size={16} aria-hidden={true} />
          <span>Live Wave Telemetry & Controls</span>
          {inFlightWaves.length > 0 ? (
            <span
              className="status-pill status-pill-active animate-pulse"
              style={{ fontSize: '10px', padding: '1px 6px', lineHeight: '14px' }}
            >
              {inFlightWaves.length} LIVE
            </span>
          ) : waves.length > 0 ? (
            <span
              style={{
                fontSize: '11px',
                padding: '2px 7px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: activeSubTab === 'telemetry' ? 'var(--color-primary)' : 'var(--bg-card-subtle)',
                color: activeSubTab === 'telemetry' ? '#ffffff' : 'var(--text-muted)',
                fontWeight: 700
              }}
            >
              {waves.length}
            </span>
          ) : null}
        </button>
      </div>

      {/* Sub-Tab 1: Designer View */}
      {activeSubTab === 'designer' && cadence && (
        <div
          role="tabpanel"
          id="subpanel-designer"
          aria-labelledby="subtab-designer"
          style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
        >
          {/* 5-Stage Timeline Visualizer & Localized Quill WYSIWYG Editor */}
          <RollingCadenceTimelineBuilder
            stages={cadence.stages}
            onChange={handleStagesChange}
            deadlineDate={settlementCase.disbursementDeadline}
            caseName={settlementCase.name}
            caseId={caseId}
            supportedLanguages={settlementCase.supportedLanguages || ['en', 'es', 'zh', 'vi']}
          />

          {/* Lower Grid: Throttling Configuration & Eligibility Breakdown */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
              gap: '24px'
            }}
          >
            <BatchThrottlingConfigCard
              throttling={cadence.throttling}
              onChange={handleThrottlingChange}
              totalEligibleRecipients={settlementCase.settlementFundTotal ? 1250 : 0}
              deadlineDate={settlementCase.disbursementDeadline}
              onSave={handleSaveCadence}
              isSaving={isSaving}
            />

            <RecipientEligibilityPreviewCard
              caseId={caseId}
              suppressionRules={cadence.suppression}
              stageName={cadence.stages?.[0]?.stageName || 'Initial Court-Approved Notice'}
            />
          </div>
        </div>
      )}

      {/* Sub-Tab 2: Telemetry & Wave Controls View */}
      {activeSubTab === 'telemetry' && (
        <div
          role="tabpanel"
          id="subpanel-telemetry"
          aria-labelledby="subtab-telemetry"
        >
          <LiveWaveTelemetryConsole
            waves={waves}
            caseId={caseId}
            deadlineDate={settlementCase.disbursementDeadline}
            onPause={handlePauseWave}
            onResume={handleResumeWave}
            onReschedule={handleRescheduleWave}
            onCancel={handleCancelWave}
            isRefreshing={isRefreshing}
            onRefresh={() => loadAllData(true)}
          />
        </div>
      )}
    </div>
  );
};

export default CadenceCampaignManager;
