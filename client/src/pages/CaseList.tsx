import React, { useEffect, useState } from 'react';
import {
  Briefcase,
  Plus,
  Search,
  ChevronRight
} from 'lucide-react';
import { Case, CaseStatus } from '../types';
import { caseApi } from '../services/api';
import { CreateCaseModal } from './CreateCaseModal';

interface CaseListProps {
  onSelectCase: (caseId: string) => void;
}

export const CaseList: React.FC<CaseListProps> = ({ onSelectCase }) => {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchCases = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await caseApi.listCases({
        search: searchTerm || undefined,
        status: statusFilter || undefined
      });
      setCases(res.cases);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load cases');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
  }, [searchTerm, statusFilter]);

  const handleCaseCreated = (newCase: Case) => {
    setCases((prev) => [newCase, ...prev]);
  };

  const getStatusBadge = (status: CaseStatus) => {
    const map: Record<CaseStatus, { bg: string; color: string; label: string }> = {
      draft: { bg: '#f1f5f9', color: '#475569', label: 'Draft' },
      active: { bg: '#dcfce7', color: '#166534', label: 'Active' },
      deadline_passed: { bg: '#ffedd5', color: '#9a3412', label: 'Deadline Passed' },
      disbursed: { bg: '#e0e7ff', color: '#3730a3', label: 'Disbursed' },
      closed: { bg: '#f3f4f6', color: '#374151', label: 'Closed' }
    };
    const style = map[status] || map.draft;
    return (
      <span
        style={{
          padding: '4px 10px',
          borderRadius: '20px',
          fontSize: '12px',
          fontWeight: 600,
          backgroundColor: style.bg,
          color: style.color
        }}
      >
        {style.label}
      </span>
    );
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' }}>
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px'
        }}
      >
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
            Settlement Cases
          </h1>
          <p style={{ fontSize: '14px', color: '#64748b' }}>
            Manage legal settlements, batch claimant ingestion, and payout preferences.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#1e3a8a',
            color: '#ffffff',
            padding: '10px 18px',
            borderRadius: '8px',
            border: 'none',
            fontSize: '14px',
            fontWeight: 600
          }}
        >
          <Plus size={18} />
          Register New Case
        </button>
      </div>

      {/* Filter / Search Bar */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          marginBottom: '24px',
          backgroundColor: '#ffffff',
          padding: '16px',
          borderRadius: '8px',
          border: '1px solid #e2e8f0'
        }}
      >
        <div style={{ flex: 1, position: 'relative' }}>
          <Search
            size={18}
            color="#94a3b8"
            style={{ position: 'absolute', left: '12px', top: '11px' }}
          />
          <input
            type="text"
            placeholder="Search by case name, docket number, or ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px 8px 38px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '14px'
            }}
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: '8px 16px',
            borderRadius: '6px',
            border: '1px solid #cbd5e1',
            fontSize: '14px',
            backgroundColor: '#ffffff'
          }}
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="deadline_passed">Deadline Passed</option>
          <option value="disbursed">Disbursed</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {errorMsg && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            color: '#991b1b',
            marginBottom: '20px'
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Cases List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>
          Loading settlement cases...
        </div>
      ) : cases.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0'
          }}
        >
          <Briefcase size={40} color="#94a3b8" style={{ marginBottom: '12px' }} />
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#1e293b' }}>
            No settlement cases found
          </h3>
          <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
            Register your first class-action settlement case to get started.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {cases.map((c) => {
            const caseKey = c.id || c._id!;
            const deadlineDate = new Date(c.disbursementDeadline);
            return (
              <div
                key={caseKey}
                onClick={() => onSelectCase(caseKey)}
                style={{
                  backgroundColor: '#ffffff',
                  padding: '20px',
                  borderRadius: '10px',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>
                      {c.name}
                    </h3>
                    {getStatusBadge(c.status)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '13px', color: '#64748b' }}>
                    <span>Docket: <strong>{c.docketNumber}</strong></span>
                    <span>Firm: <strong>{c.lawFirmId}</strong></span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Settlement Pool</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                      ${c.settlementFundTotal?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Election Deadline</div>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: '#334155' }}>
                      {deadlineDate.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </div>
                  </div>

                  <ChevronRight size={20} color="#94a3b8" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Case Modal */}
      <CreateCaseModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCaseCreated={handleCaseCreated}
      />
    </div>
  );
};
