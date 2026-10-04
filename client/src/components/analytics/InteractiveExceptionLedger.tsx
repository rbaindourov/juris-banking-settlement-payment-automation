import React, { useState } from 'react';
import {
  AlertTriangle,
  Search,
  Filter,
  CheckCircle2,
  ShieldAlert,
  MailWarning
} from 'lucide-react';
import { ExceptionItem } from '../../types';
import { ExceptionResolutionModal } from './ExceptionResolutionModal';

interface InteractiveExceptionLedgerProps {
  caseId: string;
  exceptions: ExceptionItem[];
  isLoading?: boolean;
  onRefresh: () => void;
}

export const InteractiveExceptionLedger: React.FC<InteractiveExceptionLedgerProps> = ({
  caseId,
  exceptions,
  isLoading,
  onRefresh
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedException, setSelectedException] = useState<ExceptionItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Filter exceptions in-memory
  const filteredExceptions = exceptions.filter((ex) => {
    // 1. Status filter
    if (selectedStatus === 'open' && ex.resolved) return false;
    if (selectedStatus === 'resolved' && !ex.resolved) return false;

    // 2. Type filter
    if (selectedType !== 'all') {
      if (selectedType === 'bounced_email' && ex.exceptionType !== 'bounced_email') return false;
      if (selectedType === 'ach_return' && ex.exceptionType !== 'ach_return') return false;
      if (selectedType === 'card_decline' && ex.exceptionType !== 'card_decline') return false;
      if (selectedType === 'check_returned' && ex.exceptionType !== 'check_returned') return false;
      if (selectedType === 'invalid_routing' && ex.exceptionType !== 'invalid_routing') return false;
      if (selectedType === 'unmatched_claim' && ex.exceptionType !== 'unmatched_claim') return false;
    }

    // 3. Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const claimMatch = ex.claimId?.toLowerCase().includes(q);
      const nameMatch = ex.claimantName?.toLowerCase().includes(q);
      const emailMatch = ex.claimantEmail?.toLowerCase().includes(q);
      const codeMatch = (ex.returnCode || ex.errorCode || '').toLowerCase().includes(q);
      const reasonMatch = (ex.returnReason || ex.errorMessage || '').toLowerCase().includes(q);
      const dashRefMatch = ex.dashReferenceId?.toLowerCase().includes(q);
      return claimMatch || nameMatch || emailMatch || codeMatch || reasonMatch || dashRefMatch;
    }

    return true;
  });

  const openCount = exceptions.filter((e) => !e.resolved).length;
  const resolvedCount = exceptions.filter((e) => e.resolved).length;

  const handleResolveClick = (ex: ExceptionItem) => {
    setSelectedException(ex);
    setIsModalOpen(true);
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden mb-8">
      {/* Header Bar */}
      <div className="p-6 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-900">
              Interactive Exception Ledger & Resolution Desk
            </h3>
            <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-slate-200 text-slate-800">
              {exceptions.length} Total
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time delivery bounces, NACHA returns, card declines, and SFTP reconciliation exceptions
          </p>
        </div>

        {/* Status Counter Badges */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-xs font-semibold text-rose-800">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
            <span>Open Exceptions: {openCount}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-semibold text-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Resolved: {resolvedCount}</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Toolbar */}
      <div className="p-4 border-b border-slate-200 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        {/* Search */}
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by Claim ID, Name, Return Code..."
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 text-xs"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          {/* Type Filter */}
          <div className="flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="p-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-700"
            >
              <option value="all">All Exception Types</option>
              <option value="ach_return">ACH NACHA Returns</option>
              <option value="card_decline">Card Declines</option>
              <option value="check_returned">Check Returns</option>
              <option value="invalid_routing">Invalid Routing</option>
              <option value="bounced_email">Email Bounces</option>
              <option value="unmatched_claim">Unmatched Claims</option>
            </select>
          </div>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="p-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-700"
          >
            <option value="all">All Statuses</option>
            <option value="open">Open / Action Required</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100 text-slate-700 uppercase font-bold tracking-wider border-b border-slate-200">
              <th scope="col" className="p-3.5">Claim ID</th>
              <th scope="col" className="p-3.5">Claimant</th>
              <th scope="col" className="p-3.5">Type & Rail</th>
              <th scope="col" className="p-3.5">Error Code & Details</th>
              <th scope="col" className="p-3.5">Amount</th>
              <th scope="col" className="p-3.5">Status</th>
              <th scope="col" className="p-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {isLoading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td colSpan={7} className="p-4 text-center text-slate-400">
                    Loading exceptions ledger...
                  </td>
                </tr>
              ))
            ) : filteredExceptions.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2" />
                    <p className="font-semibold text-slate-700">No exceptions found</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {exceptions.length === 0
                        ? 'All payments and emails for this case are in good standing.'
                        : 'No exceptions matching the current search filters.'}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredExceptions.map((ex) => {
                const isOpen = !ex.resolved;
                return (
                  <tr key={ex.id || ex._id || ex.claimId} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3.5 font-mono font-bold text-slate-900 whitespace-nowrap">
                      {ex.claimId}
                    </td>

                    <td className="p-3.5">
                      <div className="font-medium text-slate-900">
                        {ex.claimantName || (ex.claimantId ? `${ex.claimantId.firstName || ''} ${ex.claimantId.lastName || ''}`.trim() : 'Unknown')}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {ex.claimantEmail || ex.claimantId?.email || ''}
                      </div>
                    </td>

                    <td className="p-3.5">
                      <div className="flex items-center gap-1 font-medium text-slate-800 capitalize">
                        {ex.exceptionType === 'bounced_email' ? (
                          <MailWarning className="w-3.5 h-3.5 text-sky-600" />
                        ) : (
                          <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                        )}
                        <span>{ex.exceptionType.replace(/_/g, ' ')}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 uppercase">
                        Rail: {ex.paymentRail || 'N/A'}
                      </span>
                    </td>

                    <td className="p-3.5 max-w-xs">
                      <div className="font-mono font-semibold text-rose-700 text-[11px]">
                        {ex.returnCode || ex.errorCode || 'EXCEPTION'}
                      </div>
                      <div className="text-[11px] text-slate-600 truncate" title={ex.returnReason || ex.errorMessage}>
                        {ex.returnReason || ex.errorMessage || 'Banking return or delivery bounce'}
                      </div>
                    </td>

                    <td className="p-3.5 font-semibold text-slate-900 whitespace-nowrap">
                      ${(ex.amount || 0).toFixed(2)}
                    </td>

                    <td className="p-3.5 whitespace-nowrap">
                      {isOpen ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                          OPEN
                        </span>
                      ) : (
                        <div>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            RESOLVED
                          </span>
                          {ex.resolutionNotes && (
                            <div className="text-[10px] text-slate-500 truncate max-w-[120px]" title={ex.resolutionNotes}>
                              {ex.resolutionNotes}
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="p-3.5 text-right whitespace-nowrap">
                      {isOpen ? (
                        <button
                          onClick={() => handleResolveClick(ex)}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded text-xs shadow-sm transition-colors"
                        >
                          Resolve
                        </button>
                      ) : (
                        <button
                          onClick={() => handleResolveClick(ex)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded text-xs transition-colors"
                        >
                          Audit Log
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Resolution Modal */}
      <ExceptionResolutionModal
        caseId={caseId}
        exception={selectedException}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedException(null);
        }}
        onResolved={onRefresh}
      />
    </div>
  );
};
