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
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' }}>
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: 'none',
          border: 'none',
          color: '#64748b',
          fontSize: '14px',
          fontWeight: 500,
          marginBottom: '16px'
        }}
      >
        <ArrowLeft size={16} />
        Back to Cases
      </button>

      {/* Case Header Banner */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid #e2e8f0',
          marginBottom: '24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>
              {settlementCase.name}
            </h1>
            <span
              style={{
                padding: '4px 10px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: settlementCase.status === 'active' ? '#dcfce7' : '#f1f5f9',
                color: settlementCase.status === 'active' ? '#166534' : '#475569'
              }}
            >
              {settlementCase.status.toUpperCase()}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '20px', fontSize: '13px', color: '#64748b' }}>
            <span>Docket: <strong>{settlementCase.docketNumber}</strong></span>
            <span>Law Firm: <strong>{settlementCase.lawFirmId}</strong></span>
            <span>Fallback: <strong>{settlementCase.fallbackPaymentMethod}</strong></span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '32px', textAlign: 'right' }}>
          <div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>Settlement Pool</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
              ${settlementCase.settlementFundTotal?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>Election Deadline</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>
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
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid #e2e8f0',
          marginBottom: '24px'
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('analytics')}
          style={getTabStyle(activeTab === 'analytics')}
        >
          <BarChart3 size={16} />
          Analytics & Exceptions
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ingestion')}
          style={getTabStyle(activeTab === 'ingestion')}
        >
          <DollarSign size={16} />
          Roster Ingestion
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('claimants')}
          style={getTabStyle(activeTab === 'claimants')}
        >
          <Users size={16} />
          Claimant Records ({claimantTotal})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('templates')}
          style={getTabStyle(activeTab === 'templates')}
        >
          <Mail size={16} />
          Quill Template Designer
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          style={getTabStyle(activeTab === 'settings')}
        >
          <Settings size={16} />
          Deadline & Settings
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

function getTabStyle(isActive: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 18px',
    border: 'none',
    borderBottom: isActive ? '2px solid #1e3a8a' : '2px solid transparent',
    backgroundColor: 'transparent',
    color: isActive ? '#1e3a8a' : '#64748b',
    fontWeight: isActive ? 600 : 500,
    fontSize: '14px',
    cursor: 'pointer'
  };
}
