import React from 'react';
import { ExternalLink, ShieldCheck } from 'lucide-react';

interface AgendashLinkButtonProps {
  className?: string;
}

export const AgendashLinkButton: React.FC<AgendashLinkButtonProps> = ({ className = '' }) => {
  return (
    <a
      href="/agendash"
      target="_blank"
      rel="noopener noreferrer"
      title="Agendash Scheduler: Real-time background job monitor for Agenda 6.x. Inspect queues, trigger manual runs, and retry failed disbursement or reminder jobs."
      className={`px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-300 text-xs font-semibold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors ${className}`}
    >
      <ShieldCheck className="w-3.5 h-3.5 text-blue-700" />
      <span>Agendash Scheduler</span>
      <ExternalLink className="w-3 h-3 text-slate-400" />
    </a>
  );
};
