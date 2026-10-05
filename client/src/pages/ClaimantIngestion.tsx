import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  DollarSign,
  Users,
  AlertTriangle,
  ArrowRight,
  Database
} from 'lucide-react';
import { Case, StageUploadResult } from '../types';
import { caseApi } from '../services/api';

interface ClaimantIngestionProps {
  settlementCase: Case;
  onCommitSuccess?: () => void;
}

export const ClaimantIngestion: React.FC<ClaimantIngestionProps> = ({
  settlementCase,
  onCommitSuccess
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [stageResult, setStageResult] = useState<StageUploadResult | null>(null);
  const [commitMessage, setCommitMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setStageResult(null);
      setCommitMessage(null);
      setErrorMsg(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      setStageResult(null);
      setCommitMessage(null);
      setErrorMsg(null);
    }
  };

  const handleStageUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setErrorMsg(null);
    setCommitMessage(null);

    try {
      const result = await caseApi.stageClaimantUpload(settlementCase.id || settlementCase._id!, selectedFile);
      setStageResult(result);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to parse and stage upload roster.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleCommit = async () => {
    if (!stageResult || !stageResult.canCommit) return;

    setIsCommitting(true);
    setErrorMsg(null);

    try {
      const res = await caseApi.commitClaimantUpload(
        settlementCase.id || settlementCase._id!,
        stageResult.stagedClaimants || stageResult.preview
      );
      setCommitMessage(`Successfully committed ${res.insertedCount} claimants. Magic link tokens generated.`);
      setStageResult(null);
      setSelectedFile(null);
      onCommitSuccess?.();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to commit staged claimants to database.');
    } finally {
      setIsCommitting(false);
    }
  };

  const isOverAllocated = stageResult && stageResult.fundVariance > 0.001;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div>
        <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>
          Batch Claimant Ingestion
        </h2>
        <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '4px' }}>
          Upload CSV or Excel (.xlsx) roster files. Two-phase staging validates schemas, duplicates, and fund variance before database commit.
        </p>
      </div>

      {/* Success Notification */}
      {commitMessage && (
        <div
          role="status"
          style={{
            padding: '16px',
            backgroundColor: 'var(--color-success-bg)',
            border: '1px solid var(--color-success-border)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            color: 'var(--color-success-text)'
          }}
        >
          <CheckCircle2 size={20} color="var(--color-success)" aria-hidden="true" />
          <span style={{ fontSize: '14px', fontWeight: 600 }}>{commitMessage}</span>
        </div>
      )}

      {/* Error Notification */}
      {errorMsg && (
        <div
          role="alert"
          style={{
            padding: '16px',
            backgroundColor: 'var(--color-danger-bg)',
            border: '1px solid var(--color-danger-border)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            color: 'var(--color-danger-text)'
          }}
        >
          <AlertCircle size={20} color="var(--color-danger)" aria-hidden="true" />
          <span style={{ fontSize: '14px', fontWeight: 600 }}>{errorMsg}</span>
        </div>
      )}

      {/* Drag & Drop Upload Zone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
        aria-label="Upload claimant roster file"
        className="fintech-card"
        style={{
          border: '2px dashed var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: '44px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '14px',
          backgroundColor: '#ffffff',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          boxShadow: 'var(--shadow-xs)'
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleFileChange}
          style={{ display: 'none' }}
          aria-hidden="true"
        />

        <div
          style={{
            width: '60px',
            height: '60px',
            borderRadius: 'var(--radius-full)',
            backgroundColor: 'var(--bg-active)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-indigo)',
            boxShadow: '0 2px 6px rgba(37, 99, 235, 0.15)'
          }}
        >
          <UploadCloud size={30} aria-hidden="true" />
        </div>

        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
            {selectedFile ? selectedFile.name : 'Click or drag claimant roster file to stage'}
          </p>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Supported formats: CSV, Excel (.xlsx, .xls) up to 50MB
          </p>
        </div>

        {selectedFile && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              backgroundColor: '#f1f5f9',
              borderRadius: '20px',
              fontSize: '13px',
              color: '#334155'
            }}
          >
            <FileSpreadsheet size={16} />
            <span>{(selectedFile.size / 1024).toFixed(1)} KB</span>
          </div>
        )}
      </div>

      {/* Stage Upload Action Button */}
      {selectedFile && !stageResult && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={handleStageUpload}
            disabled={isUploading}
            className="btn-primary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 20px',
              fontSize: '14px'
            }}
          >
            {isUploading ? 'Parsing & Staging...' : 'Phase 1: Stage & Validate Roster'}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Staged Report Screen */}
      {stageResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Summary Metric Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
              gap: '16px'
            }}
          >
            <div style={metricCardStyle}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>Total Records</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <Users size={18} color="#2563eb" />
                <span style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
                  {stageResult.totalRows}
                </span>
              </div>
            </div>

            <div style={metricCardStyle}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>Valid Records</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <CheckCircle2 size={18} color="#16a34a" />
                <span style={{ fontSize: '20px', fontWeight: 700, color: '#16a34a' }}>
                  {stageResult.validCount}
                </span>
              </div>
            </div>

            <div style={metricCardStyle}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>Invalid Records</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <AlertCircle size={18} color={stageResult.invalidCount > 0 ? '#dc2626' : '#64748b'} />
                <span
                  style={{
                    fontSize: '20px',
                    fontWeight: 700,
                    color: stageResult.invalidCount > 0 ? '#dc2626' : '#64748b'
                  }}
                >
                  {stageResult.invalidCount}
                </span>
              </div>
            </div>

            <div style={metricCardStyle}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>Total Allocation</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <DollarSign size={18} color="#0284c7" />
                <span style={{ fontSize: '20px', fontWeight: 700, color: '#0284c7' }}>
                  ${stageResult.totalAllocation.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <div style={metricCardStyle}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>Settlement Fund Pool</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <Database size={18} color="#475569" />
                <span style={{ fontSize: '20px', fontWeight: 700, color: '#475569' }}>
                  ${stageResult.settlementFundTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          {/* Fund Allocation Variance Warning */}
          {isOverAllocated ? (
            <div
              style={{
                padding: '16px',
                backgroundColor: '#fff1f2',
                border: '1px solid #fecdd3',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                color: '#9f1239'
              }}
            >
              <AlertTriangle size={20} color="#e11d48" style={{ marginTop: '2px' }} />
              <div>
                <strong style={{ display: 'block', fontSize: '14px', marginBottom: '2px' }}>
                  Fund Over-Allocation Detected (Commit Blocked)
                </strong>
                <span style={{ fontSize: '13px' }}>
                  Total allocations exceed approved case settlement fund by ${stageResult.fundVariance.toFixed(2)}.
                  Adjust individual amounts or expand authorized settlement total before committing.
                </span>
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: '14px 16px',
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                color: '#166534',
                fontSize: '13px'
              }}
            >
              <CheckCircle2 size={18} color="#16a34a" />
              <span>
                Fund allocation balanced (${stageResult.totalAllocation.toFixed(2)} / ${stageResult.settlementFundTotal.toFixed(2)}).
                Ready for cryptographic token generation.
              </span>
            </div>
          )}

          {/* Validation Errors Table if any */}
          {stageResult.errors && stageResult.errors.length > 0 && (
            <div
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  padding: '12px 16px',
                  backgroundColor: '#fef2f2',
                  borderBottom: '1px solid #fee2e2',
                  fontWeight: 600,
                  fontSize: '14px',
                  color: '#991b1b'
                }}
              >
                Validation Issues ({stageResult.errors.length})
              </div>
              <div className="overflow-x-auto" style={{ maxHeight: '200px', overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-body)', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                      <th style={{ padding: '8px 16px' }}>Row</th>
                      <th style={{ padding: '8px 16px' }}>Claim ID</th>
                      <th style={{ padding: '8px 16px' }}>Error Code</th>
                      <th style={{ padding: '8px 16px' }}>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stageResult.errors.map((err, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '8px 16px', fontWeight: 500 }}>{err.row > 0 ? err.row : 'Header'}</td>
                        <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono)' }}>{err.claimId || '—'}</td>
                        <td style={{ padding: '8px 16px', color: 'var(--color-danger)', fontWeight: 600 }}>{err.code}</td>
                        <td style={{ padding: '8px 16px', color: 'var(--text-muted)' }}>{err.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Staged Preview Table */}
          {stageResult.preview && stageResult.preview.length > 0 && (
            <div
              className="fintech-card"
              style={{
                padding: 0,
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  padding: '12px 16px',
                  backgroundColor: 'var(--bg-body)',
                  borderBottom: '1px solid var(--border-subtle)',
                  fontWeight: 700,
                  fontSize: '14px',
                  color: 'var(--text-primary)'
                }}
              >
                Staged Roster Preview (First {stageResult.preview.length} Valid Records)
              </div>
              <div className="overflow-x-auto" style={{ maxHeight: '260px', overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8fafc', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '8px 16px' }}>Claim ID</th>
                      <th style={{ padding: '8px 16px' }}>Name</th>
                      <th style={{ padding: '8px 16px' }}>Email</th>
                      <th style={{ padding: '8px 16px' }}>Phone</th>
                      <th style={{ padding: '8px 16px' }}>Amount</th>
                      <th style={{ padding: '8px 16px' }}>Method</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stageResult.preview.map((claimant, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 16px', fontWeight: 500 }}>{claimant.claimId}</td>
                        <td style={{ padding: '8px 16px' }}>{`${claimant.firstName} ${claimant.lastName}`}</td>
                        <td style={{ padding: '8px 16px', color: '#64748b' }}>{claimant.email}</td>
                        <td style={{ padding: '8px 16px', color: '#64748b' }}>{claimant.phone || '—'}</td>
                        <td style={{ padding: '8px 16px', fontWeight: 600, color: '#0f172a' }}>
                          ${claimant.settlementAmount?.toFixed(2)}
                        </td>
                        <td style={{ padding: '8px 16px' }}>
                          {claimant.selectedPaymentMethod ? (
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: '12px',
                                fontSize: '11px',
                                backgroundColor: '#e0f2fe',
                                color: '#0369a1',
                                fontWeight: 500
                              }}
                            >
                              {claimant.selectedPaymentMethod.toUpperCase()}
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>Pending Selection</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Commit Action Button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => {
                setStageResult(null);
                setSelectedFile(null);
              }}
              className="btn-secondary"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleCommit}
              disabled={!stageResult.canCommit || isCommitting}
              className="btn-primary"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 24px',
                minHeight: '44px',
                backgroundColor: stageResult.canCommit ? 'var(--color-success)' : 'var(--border-strong)',
                cursor: stageResult.canCommit && !isCommitting ? 'pointer' : 'not-allowed'
              }}
            >
              <Database size={16} aria-hidden="true" />
              {isCommitting ? 'Committing to Database...' : `Phase 2: Commit ${stageResult.validCount} Claimants`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const metricCardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-card)',
  padding: '16px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)',
  boxShadow: 'var(--shadow-xs)'
};
