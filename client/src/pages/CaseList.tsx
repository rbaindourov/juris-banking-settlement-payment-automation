import React, { useEffect, useState } from 'react';
import {
  Briefcase,
  Plus,
  Search,
  ChevronRight,
  DollarSign,
  Clock,
  Layers,
  Filter
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

  // Portfolio overview metrics
  const activeCasesCount = cases.filter((c) => c.status === 'active').length;
  const totalFundCapital = cases.reduce((sum, c) => sum + (c.settlementFundTotal || 0), 0);
  const totalMatters = cases.length;
  const upcomingDeadlinesCount = cases.filter((c) => {
    if (!c.disbursementDeadline) return false;
    const diff = new Date(c.disbursementDeadline).getTime() - Date.now();
    return diff > 0 && diff <= 30 * 24 * 60 * 60 * 1000;
  }).length;

  const getStatusPill = (status: CaseStatus) => {
    switch (status) {
      case 'active':
        return <span className="status-pill status-pill-active">Active Matter</span>;
      case 'disbursed':
        return <span className="status-pill status-pill-disbursed">Disbursed</span>;
      case 'deadline_passed':
        return <span className="status-pill status-pill-warning">Deadline Passed</span>;
      case 'closed':
        return <span className="status-pill status-pill-neutral">Closed</span>;
      case 'draft':
      default:
        return <span className="status-pill status-pill-draft">Draft</span>;
    }
  };

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: 'clamp(20px, 4vw, 32px) clamp(16px, 3vw, 24px)' }}>
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '28px',
          gap: '16px',
          flexWrap: 'wrap'
        }}
      >
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Settlement Case Registry
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Enterprise legal settlement administration, automated claimant ingestion, and multi-rail payment distribution.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="btn-primary"
          aria-label="Register New Case"
          style={{
            padding: '10px 20px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-primary)',
            color: '#ffffff',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <Plus size={18} aria-hidden="true" />
          <span>Register New Case</span>
        </button>
      </div>

      {/* Elevated Stat Overview Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
          gap: '16px',
          marginBottom: '28px'
        }}
      >
        {/* Stat 1: Active Matters */}
        <div className="fintech-stat-card">
          <div className="fintech-stat-label">
            <span>Active Matters</span>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--bg-active)',
                color: 'var(--color-indigo)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Briefcase size={16} aria-hidden="true" />
            </div>
          </div>
          <div className="fintech-stat-value">{activeCasesCount}</div>
          <div className="fintech-stat-subtext" style={{ color: 'var(--color-indigo)' }}>
            {cases.length > 0 ? `${Math.round((activeCasesCount / cases.length) * 100)}% of total matters` : 'No active matters'}
          </div>
        </div>

        {/* Stat 2: Total Settlement Fund */}
        <div className="fintech-stat-card">
          <div className="fintech-stat-label">
            <span>Settlement Capital</span>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-success-bg)',
                color: 'var(--color-success)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <DollarSign size={16} aria-hidden="true" />
            </div>
          </div>
          <div className="fintech-stat-value">
            ${totalFundCapital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="fintech-stat-subtext" style={{ color: 'var(--color-success-text)' }}>
            Under automated administration
          </div>
        </div>

        {/* Stat 3: Total Registered Matters */}
        <div className="fintech-stat-card">
          <div className="fintech-stat-label">
            <span>Total Docket Matters</span>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: '#f1f5f9',
                color: '#334155',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Layers size={16} aria-hidden="true" />
            </div>
          </div>
          <div className="fintech-stat-value">{totalMatters}</div>
          <div className="fintech-stat-subtext">
            Class-action & mass-tort portfolios
          </div>
        </div>

        {/* Stat 4: Upcoming Deadlines */}
        <div className="fintech-stat-card">
          <div className="fintech-stat-label">
            <span>Expiring in 30 Days</span>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-warning-bg)',
                color: 'var(--color-warning)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Clock size={16} aria-hidden="true" />
            </div>
          </div>
          <div className="fintech-stat-value">{upcomingDeadlinesCount}</div>
          <div className="fintech-stat-subtext" style={{ color: 'var(--color-warning-text)' }}>
            Requires claimant outreach review
          </div>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div
        className="fintech-filter-bar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px'
        }}
      >
        <div style={{ flex: '1 1 320px', position: 'relative' }}>
          <Search
            size={18}
            color="var(--text-subtle)"
            style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder="Search by case title, court docket number, or matter ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="fintech-input"
            style={{ paddingLeft: '38px' }}
            aria-label="Search settlement cases"
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Filter size={16} color="var(--text-muted)" aria-hidden="true" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="fintech-select"
            aria-label="Filter cases by status"
          >
            <option value="">All Statuses ({cases.length})</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="deadline_passed">Deadline Passed</option>
            <option value="disbursed">Disbursed</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          style={{
            padding: '14px 18px',
            backgroundColor: 'var(--color-danger-bg)',
            border: '1px solid var(--color-danger-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-danger-text)',
            fontSize: '14px',
            marginBottom: '20px'
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Cases List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
          <div className="animate-spin" style={{ display: 'inline-block', width: '28px', height: '28px', border: '3px solid var(--border-default)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', marginBottom: '12px' }} />
          <p style={{ fontSize: '14px' }}>Loading settlement cases...</p>
        </div>
      ) : cases.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 24px',
            backgroundColor: '#ffffff',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-xs)'
          }}
        >
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: 'var(--radius-lg)',
              backgroundColor: 'var(--bg-card-subtle)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-subtle)',
              marginBottom: '16px'
            }}
          >
            <Briefcase size={26} aria-hidden="true" />
          </div>
          <h3 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>
            No settlement cases found
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '6px', maxWidth: '400px', margin: '6px auto 0' }}>
            {searchTerm || statusFilter
              ? 'No matters match your filter criteria. Try resetting search parameters.'
              : 'Register your first class-action settlement matter to initiate claimant roster ingestion and payout configuration.'}
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
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectCase(caseKey);
                  }
                }}
                className="fintech-card fintech-card-interactive"
                aria-label={`Open matter ${c.name}`}
                style={{
                  padding: 'clamp(16px, 3vw, 20px) clamp(16px, 3vw, 24px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px',
                  flexWrap: 'wrap'
                }}
              >
                {/* Left: Case Info */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, flex: '1 1 260px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em', wordBreak: 'break-word' }}>
                      {c.name}
                    </h3>
                    {getStatusPill(c.status)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '13px', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                    <span>Docket: <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{c.docketNumber}</strong></span>
                    <span>Firm: <strong style={{ color: 'var(--text-secondary)' }}>{c.lawFirmId}</strong></span>
                    <span>Fallback: <strong style={{ color: 'var(--text-secondary)' }}>{c.fallbackPaymentMethod}</strong></span>
                  </div>
                </div>

                {/* Right: Metrics & Action */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(16px, 3vw, 32px)', flexWrap: 'wrap' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Settlement Pool
                    </div>
                    <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      ${c.settlementFundTotal?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', minWidth: '110px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Election Deadline
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {deadlineDate.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </div>
                  </div>

                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: 'var(--radius-full)',
                      backgroundColor: 'var(--bg-card-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-muted)'
                    }}
                  >
                    <ChevronRight size={18} aria-hidden="true" />
                  </div>
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
