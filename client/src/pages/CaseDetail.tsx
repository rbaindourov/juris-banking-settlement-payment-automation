import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  DollarSign,
  Users,
  Mail,
  Settings,
  Save,
  CheckCircle2,
  AlertCircle,
  BarChart3
} from 'lucide-react';
import { Case, Claimant } from '../types';
import { caseApi } from '../services/api';
import { ClaimantIngestion } from './ClaimantIngestion';
import { QuillTemplateEditor } from '../components/QuillTemplateEditor';
import { CaseAnalyticsDashboard } from '../components/analytics';

interface CaseDetailProps {
  caseId: string;
  onBack: () => void;
  initialTab?: 'analytics' | 'ingestion' | 'claimants' | 'templates' | 'settings';
}

export const CaseDetail: React.FC<CaseDetailProps> = ({ caseId, onBack, initialTab }) => {
  const [settlementCase, setSettlementCase] = useState<Case | null>(null);
  const [activeTab, setActiveTab] = useState<'analytics' | 'ingestion' | 'claimants' | 'templates' | 'settings'>(
    initialTab || 'analytics'
  );
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Claimants list state
  const [claimants, setClaimants] = useState<Claimant[]>([]);
  const [claimantSearch, setClaimantSearch] = useState('');
  const [claimantTotal, setClaimantTotal] = useState(0);

  // Template editing state
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBodyHtml, setEmailBodyHtml] = useState('');
  const [landingIntroHtml, setLandingIntroHtml] = useState('');
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Deadline editing state
  const [editDeadline, setEditDeadline] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const fetchCase = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await caseApi.getCase(caseId);
      const c = res.case;
      setSettlementCase(c);
      setEmailSubject(c.emailTemplate?.subject || '');
      setEmailBodyHtml(c.emailTemplate?.bodyHtml || '');
      setLandingIntroHtml(c.landingPageText?.introHtml || '');
      setEditDeadline(c.disbursementDeadline ? new Date(c.disbursementDeadline).toISOString().slice(0, 16) : '');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load case');
    } finally {
      setLoading(false);
    }
  };

  const fetchClaimants = async () => {
    try {
      const res = await caseApi.listClaimants(caseId, {
        search: claimantSearch || undefined,
        limit: 50
      });
      setClaimants(res.claimants);
      setClaimantTotal(res.total);
    } catch {
      // Non-critical if list fails
    }
  };

  useEffect(() => {
    fetchCase();
  }, [caseId]);

  useEffect(() => {
    if (activeTab === 'claimants') {
      fetchClaimants();
    }
  }, [activeTab, claimantSearch]);

  const handleSaveTemplates = async () => {
    if (!settlementCase) return;
    setIsSavingTemplate(true);
    setSaveSuccessMsg(null);
    try {
      const res = await caseApi.updateCase(settlementCase.id || settlementCase._id!, {
        emailTemplate: {
          subject: emailSubject,
          bodyHtml: emailBodyHtml
        },
        landingPageText: {
          ...settlementCase.landingPageText,
          introHtml: landingIntroHtml
        }
      });
      setSettlementCase(res.case);
      setSaveSuccessMsg('Templates saved and sanitized successfully.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update templates');
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleSaveDeadline = async () => {
    if (!settlementCase) return;
    setIsSavingSettings(true);
    try {
      const res = await caseApi.updateCase(settlementCase.id || settlementCase._id!, {
        disbursementDeadline: editDeadline
      });
      setSettlementCase(res.case);
      setSaveSuccessMsg('Case deadline updated successfully.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update deadline');
    } finally {
      setIsSavingSettings(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>Loading case details...</div>;
  }

  if (!settlementCase) {
    return (
      <div style={{ padding: '32px', textAlign: 'center' }}>
        <p style={{ color: '#dc2626' }}>Case not found</p>
        <button type="button" onClick={onBack} className="btn-secondary" style={{ marginTop: '16px', minHeight: '44px' }}>Back to cases</button>
      </div>
    );
  }

  type CaseTabId = 'analytics' | 'ingestion' | 'claimants' | 'templates' | 'settings';
  const TAB_ORDER: CaseTabId[] = ['analytics', 'ingestion', 'claimants', 'templates', 'settings'];

  const handleTabKeyDown = (e: React.KeyboardEvent, currentTab: CaseTabId) => {
    const currentIndex = TAB_ORDER.indexOf(currentTab);
    let nextIndex = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % TAB_ORDER.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = TAB_ORDER.length - 1;
    }

    if (nextIndex >= 0) {
      const nextTab = TAB_ORDER[nextIndex];
      setActiveTab(nextTab);
      setTimeout(() => {
        document.getElementById(`tab-${nextTab}`)?.focus();
      }, 0);
    }
  };

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '32px 24px' }}>
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        aria-label="Return to Settlement Case Registry"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          fontSize: '14px',
          fontWeight: 600,
          marginBottom: '20px',
          minHeight: '44px',
          padding: '8px 14px',
          borderRadius: 'var(--radius-sm)',
          transition: 'color 0.15s ease'
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-primary)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        <span>Back to Cases</span>
      </button>

      {/* Case Header Banner */}
      <div
        className="fintech-card"
        style={{
          padding: '24px 28px',
          marginBottom: '28px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '20px',
          flexWrap: 'wrap'
        }}
      >
        <div style={{ minWidth: '300px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              {settlementCase.name}
            </h1>
            <span
              className={`status-pill ${
                settlementCase.status === 'active'
                  ? 'status-pill-active'
                  : settlementCase.status === 'disbursed'
                  ? 'status-pill-disbursed'
                  : 'status-pill-neutral'
              }`}
            >
              {settlementCase.status.toUpperCase()}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '20px', fontSize: '13px', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
            <span>Docket: <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{settlementCase.docketNumber}</strong></span>
            <span>Law Firm: <strong style={{ color: 'var(--text-secondary)' }}>{settlementCase.lawFirmId}</strong></span>
            <span>Fallback Method: <strong style={{ color: 'var(--text-secondary)' }}>{settlementCase.fallbackPaymentMethod}</strong></span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '32px', textAlign: 'right', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Settlement Pool
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              ${settlementCase.settlementFundTotal?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div style={{ minWidth: '120px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Election Deadline
            </div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-secondary)' }}>
              {new Date(settlementCase.disbursementDeadline).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Bar */}
      <div
        role="tablist"
        aria-label="Case Detail Navigation Tabs"
        className="fintech-tab-strip"
        style={{ marginBottom: '28px' }}
      >
        <button
          type="button"
          role="tab"
          id="tab-analytics"
          aria-selected={activeTab === 'analytics'}
          aria-controls="panel-analytics"
          tabIndex={activeTab === 'analytics' ? 0 : -1}
          onClick={() => setActiveTab('analytics')}
          onKeyDown={(e) => handleTabKeyDown(e, 'analytics')}
          className={`fintech-tab-item ${activeTab === 'analytics' ? 'active' : ''}`}
        >
          <BarChart3 size={16} aria-hidden="true" />
          <span>Analytics & Exceptions</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-ingestion"
          aria-selected={activeTab === 'ingestion'}
          aria-controls="panel-ingestion"
          tabIndex={activeTab === 'ingestion' ? 0 : -1}
          onClick={() => setActiveTab('ingestion')}
          onKeyDown={(e) => handleTabKeyDown(e, 'ingestion')}
          className={`fintech-tab-item ${activeTab === 'ingestion' ? 'active' : ''}`}
        >
          <DollarSign size={16} aria-hidden="true" />
          <span>Roster Ingestion</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-claimants"
          aria-selected={activeTab === 'claimants'}
          aria-controls="panel-claimants"
          tabIndex={activeTab === 'claimants' ? 0 : -1}
          onClick={() => setActiveTab('claimants')}
          onKeyDown={(e) => handleTabKeyDown(e, 'claimants')}
          className={`fintech-tab-item ${activeTab === 'claimants' ? 'active' : ''}`}
        >
          <Users size={16} aria-hidden="true" />
          <span>Claimant Records</span>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 7px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: activeTab === 'claimants' ? 'var(--color-primary)' : 'var(--bg-card-subtle)',
              color: activeTab === 'claimants' ? '#ffffff' : 'var(--text-muted)',
              fontWeight: 700
            }}
          >
            {claimantTotal}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-templates"
          aria-selected={activeTab === 'templates'}
          aria-controls="panel-templates"
          tabIndex={activeTab === 'templates' ? 0 : -1}
          onClick={() => setActiveTab('templates')}
          onKeyDown={(e) => handleTabKeyDown(e, 'templates')}
          className={`fintech-tab-item ${activeTab === 'templates' ? 'active' : ''}`}
        >
          <Mail size={16} aria-hidden="true" />
          <span>Quill Template Designer</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-settings"
          aria-selected={activeTab === 'settings'}
          aria-controls="panel-settings"
          tabIndex={activeTab === 'settings' ? 0 : -1}
          onClick={() => setActiveTab('settings')}
          onKeyDown={(e) => handleTabKeyDown(e, 'settings')}
          className={`fintech-tab-item ${activeTab === 'settings' ? 'active' : ''}`}
        >
          <Settings size={16} aria-hidden="true" />
          <span>Deadline & Settings</span>
        </button>
      </div>

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
            gap: '8px',
            marginBottom: '20px'
          }}
        >
          <CheckCircle2 size={16} color="var(--color-success)" aria-hidden="true" />
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
            gap: '8px',
            marginBottom: '20px'
          }}
        >
          <AlertCircle size={16} color="var(--color-danger)" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Tab 0: Analytics Dashboard & Exception Ledger */}
      {activeTab === 'analytics' && (
        <div role="tabpanel" id="panel-analytics" aria-labelledby="tab-analytics">
          <CaseAnalyticsDashboard
            caseId={caseId}
            settlementCase={settlementCase}
            onRefreshCase={fetchCase}
          />
        </div>
      )}

      {/* Tab 1: Ingestion */}
      {activeTab === 'ingestion' && (
        <div
          role="tabpanel"
          id="panel-ingestion"
          aria-labelledby="tab-ingestion"
          className="fintech-card"
          style={{ padding: '24px' }}
        >
          <ClaimantIngestion
            settlementCase={settlementCase}
            onCommitSuccess={() => {
              fetchCase();
              fetchClaimants();
            }}
          />
        </div>
      )}

      {/* Tab 2: Claimant Records Directory */}
      {activeTab === 'claimants' && (
        <div
          role="tabpanel"
          id="panel-claimants"
          aria-labelledby="tab-claimants"
          className="fintech-card"
          style={{ padding: '24px' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Enrolled Claimants ({claimantTotal})
            </h3>
            <input
              id="claimantDirectorySearch"
              type="text"
              aria-label="Search by name, email, claim ID"
              placeholder="Search by name, email, claim ID..."
              value={claimantSearch}
              onChange={(e) => setClaimantSearch(e.target.value)}
              className="fintech-input"
              style={{ width: '280px' }}
            />
          </div>

          {claimants.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
              No claimants committed yet. Use the Roster Ingestion tab to upload records.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-body)', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                    <th style={{ padding: '10px 16px' }}>Claim ID</th>
                    <th style={{ padding: '10px 16px' }}>Claimant Name</th>
                    <th style={{ padding: '10px 16px' }}>Email</th>
                    <th style={{ padding: '10px 16px' }}>Settlement Amount</th>
                    <th style={{ padding: '10px 16px' }}>Status</th>
                    <th style={{ padding: '10px 16px' }}>Selected Rail</th>
                    <th style={{ padding: '10px 16px' }}>Magic Link Token</th>
                  </tr>
                </thead>
                <tbody>
                  {claimants.map((cl) => (
                    <tr key={cl.id || cl._id!} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '10px 16px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{cl.claimId}</td>
                      <td style={{ padding: '10px 16px' }}>{`${cl.firstName} ${cl.lastName}`}</td>
                      <td style={{ padding: '10px 16px', color: 'var(--text-muted)' }}>{cl.email}</td>
                      <td style={{ padding: '10px 16px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>${cl.settlementAmount?.toFixed(2)}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <span
                          className={`status-pill ${cl.status === 'selected' ? 'status-pill-success' : 'status-pill-neutral'}`}
                        >
                          {cl.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        {cl.selectedPaymentMethod ? cl.selectedPaymentMethod.toUpperCase() : '—'}
                      </td>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
                        {cl.paymentSelectionToken ? `${cl.paymentSelectionToken.slice(0, 12)}...` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Quill Template Designer */}
      {activeTab === 'templates' && (
        <div
          role="tabpanel"
          id="panel-templates"
          aria-labelledby="tab-templates"
          style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
        >
          <div className="fintech-card" style={{ padding: '24px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>
              Notice Email Subject & Body
            </h3>

            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="emailSubject" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Email Subject Line
              </label>
              <input
                id="emailSubject"
                type="text"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="fintech-input"
              />
            </div>

            <QuillTemplateEditor
              caseId={settlementCase.id || settlementCase._id!}
              caseName={settlementCase.name}
              initialHtml={emailBodyHtml}
              onChange={setEmailBodyHtml}
              label="Notification Email Body (Quill WYSIWYG)"
              supportedLanguages={settlementCase.supportedLanguages || ['en']}
            />
          </div>

          <div className="fintech-card" style={{ padding: '24px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>
              Claimant Portal Landing Page Copy
            </h3>

            <QuillTemplateEditor
              caseId={settlementCase.id || settlementCase._id!}
              caseName={settlementCase.name}
              initialHtml={landingIntroHtml}
              onChange={setLandingIntroHtml}
              label="Portal Introduction & FAQ Banner"
              supportedLanguages={settlementCase.supportedLanguages || ['en']}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleSaveTemplates}
              disabled={isSavingTemplate}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 24px' }}
            >
              <Save size={16} aria-hidden="true" />
              {isSavingTemplate ? 'Saving & Sanitizing...' : 'Save Templates'}
            </button>
          </div>
        </div>
      )}

      {/* Tab 4: Deadline & Settings */}
      {activeTab === 'settings' && (
        <div
          role="tabpanel"
          id="panel-settings"
          aria-labelledby="tab-settings"
          className="fintech-card"
          style={{ padding: '24px' }}
        >
          <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>
            Case Deadline & Administration
          </h3>

          <div style={{ maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label htmlFor="caseDeadlineSetting" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Disbursement & Election Deadline
              </label>
              <input
                id="caseDeadlineSetting"
                type="datetime-local"
                value={editDeadline}
                onChange={(e) => setEditDeadline(e.target.value)}
                className="fintech-input"
              />
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                Upon deadline expiration, unselected claimants are transitioned to the fallback payment rail.
              </span>
            </div>

            <button
              type="button"
              onClick={handleSaveDeadline}
              disabled={isSavingSettings}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px 18px' }}
            >
              <Save size={16} aria-hidden="true" />
              {isSavingSettings ? 'Updating...' : 'Update Deadline'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
