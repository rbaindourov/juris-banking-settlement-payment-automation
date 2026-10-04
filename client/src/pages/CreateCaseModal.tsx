import React, { useState } from 'react';
import { X, Briefcase, DollarSign, Calendar, ShieldCheck } from 'lucide-react';
import { Case, FallbackPaymentMethod } from '../types';
import { caseApi } from '../services/api';

interface CreateCaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCaseCreated: (newCase: Case) => void;
}

export const CreateCaseModal: React.FC<CreateCaseModalProps> = ({
  isOpen,
  onClose,
  onCaseCreated
}) => {
  const [name, setName] = useState('');
  const [docketNumber, setDocketNumber] = useState('');
  const [lawFirmId, setLawFirmId] = useState('');
  const [settlementFundTotal, setSettlementFundTotal] = useState('');
  const [disbursementDeadline, setDisbursementDeadline] = useState('');
  const [fallbackPaymentMethod, setFallbackPaymentMethod] = useState<FallbackPaymentMethod>('physical_check');
  const [defaultLanguage, setDefaultLanguage] = useState('en');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const total = parseFloat(settlementFundTotal);
    if (isNaN(total) || total < 0) {
      setErrorMsg('Settlement fund total must be a non-negative number');
      return;
    }

    if (!disbursementDeadline) {
      setErrorMsg('Disbursement deadline is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await caseApi.createCase({
        name,
        docketNumber,
        lawFirmId: lawFirmId.trim() || undefined,
        settlementFundTotal: total,
        disbursementDeadline,
        fallbackPaymentMethod,
        defaultLanguage,
        emailTemplate: {
          subject: `Important Notice Regarding ${name}`,
          bodyHtml: `<h2>Official Notice: {{case_name}}</h2><p>Dear {{claimant_first_name}}, you are eligible for {{settlement_amount}}.</p><p><a href="{{payment_selection_link}}">Select Your Payment Method</a></p><p>Election Deadline: {{selection_deadline}}</p>`
        },
        landingPageText: {
          headline: `Welcome to the ${name} Settlement Election Portal`,
          introHtml: `<p>Please confirm your identity and select your preferred payment disbursement method.</p>`,
          faqAccordion: [
            { question: 'When is the deadline?', answer: 'Please review the case election deadline displayed on your notice.' },
            { question: 'What if I take no action?', answer: 'A physical check will be dispatched to your address on file.' }
          ],
          supportContact: 'support@juris-banking.com'
        }
      });

      onCaseCreated(res.case);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create settlement case');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px'
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '560px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#f8fafc'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Briefcase size={20} color="#1e3a8a" />
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#0f172a' }}>
              Create Settlement Case
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#64748b' }}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {errorMsg && (
            <div
              style={{
                padding: '12px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '6px',
                color: '#991b1b',
                fontSize: '13px'
              }}
            >
              {errorMsg}
            </div>
          )}

          <div>
            <label style={labelStyle}>Case / Litigation Name</label>
            <input
              type="text"
              required
              placeholder="e.g. In re Nexus Consumer Privacy Settlement"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={labelStyle}>Docket / Matter Number</label>
              <input
                type="text"
                required
                placeholder="e.g. 3:24-cv-09821"
                value={docketNumber}
                onChange={(e) => setDocketNumber(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Law Firm ID</label>
              <input
                type="text"
                placeholder="firm-law-01"
                value={lawFirmId}
                onChange={(e) => setLawFirmId(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={labelStyle}>Approved Settlement Fund ($)</label>
              <div style={{ position: 'relative' }}>
                <DollarSign
                  size={16}
                  color="#64748b"
                  style={{ position: 'absolute', left: '10px', top: '10px' }}
                />
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="250000.00"
                  value={settlementFundTotal}
                  onChange={(e) => setSettlementFundTotal(e.target.value)}
                  style={{ ...inputStyle, paddingLeft: '32px' }}
                />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Disbursement Deadline</label>
              <div style={{ position: 'relative' }}>
                <Calendar
                  size={16}
                  color="#64748b"
                  style={{ position: 'absolute', left: '10px', top: '10px' }}
                />
                <input
                  type="datetime-local"
                  required
                  value={disbursementDeadline}
                  onChange={(e) => setDisbursementDeadline(e.target.value)}
                  style={{ ...inputStyle, paddingLeft: '32px' }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={labelStyle}>Fallback Payment Rail</label>
              <select
                value={fallbackPaymentMethod}
                onChange={(e) => setFallbackPaymentMethod(e.target.value as FallbackPaymentMethod)}
                style={inputStyle}
              >
                <option value="physical_check">Mailed Physical Check</option>
                <option value="direct_deposit">Direct Deposit (ACH)</option>
                <option value="digital_card">Digital Prepaid Card</option>
                <option value="debit_card">Push to Debit Card</option>
                <option value="paypal">PayPal</option>
                <option value="venmo">Venmo</option>
                <option value="zelle">Zelle</option>
                <option value="bitcoin">Bitcoin</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Default Portal Language</label>
              <select
                value={defaultLanguage}
                onChange={(e) => setDefaultLanguage(e.target.value)}
                style={inputStyle}
              >
                <option value="en">English (en)</option>
                <option value="es">Spanish (es)</option>
                <option value="zh">Chinese (zh)</option>
                <option value="vi">Vietnamese (vi)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: '#475569',
                fontSize: '14px',
                fontWeight: 500
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 20px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: '#1e3a8a',
                color: '#ffffff',
                fontSize: '14px',
                fontWeight: 600
              }}
            >
              <ShieldCheck size={16} />
              {isSubmitting ? 'Creating Case...' : 'Register Case'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  color: '#334155',
  marginBottom: '4px'
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: '6px',
  border: '1px solid #cbd5e1',
  fontSize: '14px',
  color: '#0f172a',
  backgroundColor: '#ffffff'
};
