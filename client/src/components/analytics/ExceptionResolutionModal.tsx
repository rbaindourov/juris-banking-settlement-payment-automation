import React, { useState } from 'react';
import {
  X,
  AlertTriangle,
  Mail,
  Send,
  Building2,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import { ExceptionItem, ResolveExceptionPayload } from '../../types';
import { analyticsApi } from '../../services/api';

interface ExceptionResolutionModalProps {
  caseId: string;
  exception: ExceptionItem | null;
  isOpen: boolean;
  onClose: () => void;
  onResolved: () => void;
}

export const ExceptionResolutionModal: React.FC<ExceptionResolutionModalProps> = ({
  caseId,
  exception,
  isOpen,
  onClose,
  onResolved
}) => {
  if (!isOpen || !exception) return null;

  const [action, setAction] = useState<
    'switch_to_check' | 'resend_email' | 'requeue_sftp' | 'mark_resolved'
  >('switch_to_check');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Address fields for switch_to_check
  const [street1, setStreet1] = useState('');
  const [street2, setStreet2] = useState('');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('CA');
  const [zip, setZip] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const payload: ResolveExceptionPayload = {
        action,
        reason: reason.trim() || undefined
      };

      if (action === 'switch_to_check') {
        if (!street1.trim() || !city.trim() || !stateCode.trim() || !zip.trim()) {
          throw new Error('Please fill out all required address fields (Street, City, State, ZIP)');
        }
        if (!/^\d{5}(-\d{4})?$/.test(zip.trim())) {
          throw new Error('Please enter a valid 5-digit US ZIP code');
        }

        payload.updatedAddress = {
          street1: street1.trim(),
          street2: street2.trim() || undefined,
          city: city.trim(),
          state: stateCode.trim().toUpperCase(),
          zip: zip.trim()
        };
      }

      await analyticsApi.resolveException(
        caseId,
        exception.id || exception._id!,
        payload
      );

      onResolved();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to resolve exception');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 id="modal-title" className="text-base font-bold text-slate-900">
                Resolve Exception: {exception.claimId}
              </h2>
              <p className="text-xs text-slate-500">
                Return Code: {exception.returnCode || exception.errorCode || 'UNKNOWN'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Exception Context */}
          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1">
            <div className="flex justify-between text-slate-600">
              <span>Claimant:</span>
              <span className="font-semibold text-slate-900">{exception.claimantName || 'N/A'}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Amount:</span>
              <span className="font-semibold text-slate-900">${(exception.amount || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Reason:</span>
              <span className="text-slate-700 font-medium">{exception.returnReason || exception.errorMessage || 'Banking exception'}</span>
            </div>
          </div>

          {/* Action Selector */}
          <div>
            <label className="block text-xs font-bold uppercase text-slate-700 mb-2">
              Select Resolution Action
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAction('switch_to_check')}
                className={`p-3 rounded-lg border text-left flex flex-col gap-1 transition-all ${
                  action === 'switch_to_check'
                    ? 'border-blue-600 bg-blue-50/50 text-blue-900 shadow-sm ring-1 ring-blue-600'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <Building2 className="w-3.5 h-3.5 text-blue-600" />
                  <span>Switch to Check</span>
                </div>
                <span className="text-[11px] text-slate-500">
                  Mail physical check to address
                </span>
              </button>

              <button
                type="button"
                onClick={() => setAction('resend_email')}
                className={`p-3 rounded-lg border text-left flex flex-col gap-1 transition-all ${
                  action === 'resend_email'
                    ? 'border-blue-600 bg-blue-50/50 text-blue-900 shadow-sm ring-1 ring-blue-600'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <Mail className="w-3.5 h-3.5 text-blue-600" />
                  <span>Resend Email</span>
                </div>
                <span className="text-[11px] text-slate-500">
                  Issue fresh magic link portal token
                </span>
              </button>

              <button
                type="button"
                onClick={() => setAction('requeue_sftp')}
                className={`p-3 rounded-lg border text-left flex flex-col gap-1 transition-all ${
                  action === 'requeue_sftp'
                    ? 'border-blue-600 bg-blue-50/50 text-blue-900 shadow-sm ring-1 ring-blue-600'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <Send className="w-3.5 h-3.5 text-blue-600" />
                  <span>Requeue SFTP</span>
                </div>
                <span className="text-[11px] text-slate-500">
                  Re-queue for next batch payout
                </span>
              </button>

              <button
                type="button"
                onClick={() => setAction('mark_resolved')}
                className={`p-3 rounded-lg border text-left flex flex-col gap-1 transition-all ${
                  action === 'mark_resolved'
                    ? 'border-blue-600 bg-blue-50/50 text-blue-900 shadow-sm ring-1 ring-blue-600'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Mark Resolved</span>
                </div>
                <span className="text-[11px] text-slate-500">
                  Manual escrow or offline payment
                </span>
              </button>
            </div>
          </div>

          {/* Conditional Physical Address Fields */}
          {action === 'switch_to_check' && (
            <div className="space-y-3 p-4 bg-slate-50 border border-slate-200 rounded-lg">
              <h4 className="text-xs font-bold uppercase text-slate-700">
                Mailing Address for Physical Check
              </h4>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Street Address 1 *
                </label>
                <input
                  type="text"
                  required
                  value={street1}
                  onChange={(e) => setStreet1(e.target.value)}
                  placeholder="123 Main Street"
                  className="w-full text-xs p-2 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Street Address 2 (Apt / Suite)
                </label>
                <input
                  type="text"
                  value={street2}
                  onChange={(e) => setStreet2(e.target.value)}
                  placeholder="Apt 4B"
                  className="w-full text-xs p-2 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-6 gap-2">
                <div className="col-span-3">
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    City *
                  </label>
                  <input
                    type="text"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="San Francisco"
                    className="w-full text-xs p-2 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="col-span-1">
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    State *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    value={stateCode}
                    onChange={(e) => setStateCode(e.target.value.toUpperCase())}
                    placeholder="CA"
                    className="w-full text-xs p-2 bg-white border border-slate-300 rounded text-center focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    ZIP *
                  </label>
                  <input
                    type="text"
                    required
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                    placeholder="94105"
                    className="w-full text-xs p-2 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Audit Reason Textarea */}
          <div>
            <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
              Resolution Audit Notes / Reason
            </label>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Account closed by claimant; verified new mailing address for physical check."
              className="w-full text-xs p-2.5 bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <span>Confirm Resolution</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
