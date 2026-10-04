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
        <button onClick={onBack} style={{ marginTop: '16px', padding: '8px 16px' }}>Back to cases</button>
      </div>
    );
  }

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
          padding: '4px 8px',
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
          className={`fintech-tab-item ${activeTab === 'settings' ? 'active' : ''}`}
        >
          <Settings size={16} aria-hidden="true" />
          <span>Deadline & Settings</span>
        </button>
      </div>

      {saveSuccessMsg && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '8px',
            color: '#166534',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '20px'
          }}
        >
          <CheckCircle2 size={16} color="#16a34a" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            color: '#991b1b',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '20px'
          }}
        >
          <AlertCircle size={16} color="#dc2626" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Tab 0: Analytics Dashboard & Exception Ledger */}
      {activeTab === 'analytics' && (
        <CaseAnalyticsDashboard
          caseId={caseId}
          settlementCase={settlementCase}
          onRefreshCase={fetchCase}
        />
      )}

      {/* Tab 1: Ingestion */}
      {activeTab === 'ingestion' && (
        <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', border: '1px solid #e2e8f0' }}>
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
        <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#0f172a' }}>
              Enrolled Claimants ({claimantTotal})
            </h3>
            <input
              type="text"
              placeholder="Search by name, email, claim ID..."
              value={claimantSearch}
              onChange={(e) => setClaimantSearch(e.target.value)}
              style={{
                padding: '8px 14px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                width: '280px'
              }}
            />
          </div>

          {claimants.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
              No claimants committed yet. Use the Roster Ingestion tab to upload records.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
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
                    <tr key={cl.id || cl._id!} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 16px', fontWeight: 600 }}>{cl.claimId}</td>
                      <td style={{ padding: '10px 16px' }}>{`${cl.firstName} ${cl.lastName}`}</td>
                      <td style={{ padding: '10px 16px', color: '#64748b' }}>{cl.email}</td>
                      <td style={{ padding: '10px 16px', fontWeight: 600 }}>${cl.settlementAmount?.toFixed(2)}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 600,
                            backgroundColor: cl.status === 'selected' ? '#dcfce7' : '#f1f5f9',
                            color: cl.status === 'selected' ? '#166534' : '#475569'
                          }}
                        >
                          {cl.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        {cl.selectedPaymentMethod ? cl.selectedPaymentMethod.toUpperCase() : '—'}
                      </td>
                      <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: '11px', color: '#64748b' }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', border: '1px solid #e2e8f0' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#0f172a', marginBottom: '16px' }}>
              Notice Email Subject & Body
            </h3>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Email Subject Line
              </label>
              <input
                type="text"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px'
                }}
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

          <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', border: '1px solid #e2e8f0' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#0f172a', marginBottom: '16px' }}>
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
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 24px',
                backgroundColor: '#1e3a8a',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600
              }}
            >
              <Save size={16} />
              {isSavingTemplate ? 'Saving & Sanitizing...' : 'Save Templates'}
            </button>
          </div>
        </div>
      )}

      {/* Tab 4: Deadline & Settings */}
      {activeTab === 'settings' && (
        <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', border: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#0f172a', marginBottom: '16px' }}>
            Case Deadline & Administration
          </h3>

          <div style={{ maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Disbursement & Election Deadline
              </label>
              <input
                type="datetime-local"
                value={editDeadline}
                onChange={(e) => setEditDeadline(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px'
                }}
              />
              <span style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', display: 'block' }}>
                Upon deadline expiration, unselected claimants are transitioned to the fallback payment rail.
              </span>
            </div>

            <button
              type="button"
              onClick={handleSaveDeadline}
              disabled={isSavingSettings}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '10px 18px',
                backgroundColor: '#1e3a8a',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600
              }}
            >
              <Save size={16} />
              {isSavingSettings ? 'Updating...' : 'Update Deadline'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
