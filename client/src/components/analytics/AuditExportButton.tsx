import React, { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { analyticsApi } from '../../services/api';

interface AuditExportButtonProps {
  caseId: string;
  docketNumber?: string;
  className?: string;
}

export const AuditExportButton: React.FC<AuditExportButtonProps> = ({
  caseId,
  docketNumber = 'case',
  className = ''
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    setErrorMsg(null);
    try {
      await analyticsApi.downloadAuditExport(caseId, docketNumber);
    } catch (err: any) {
      setErrorMsg(err.message || 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-end">
      <button
        onClick={handleExport}
        disabled={isExporting}
        title="Download streaming RFC 4180 audit and disbursement ledger CSV"
        className={`px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-50 ${className}`}
      >
        {isExporting ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Exporting CSV...</span>
          </>
        ) : (
          <>
            <Download className="w-3.5 h-3.5" />
            <span>Export Audit Ledger (CSV)</span>
          </>
        )}
      </button>
      {errorMsg && (
        <span className="text-[10px] text-rose-600 mt-1 font-medium">{errorMsg}</span>
      )}
    </div>
  );
};
