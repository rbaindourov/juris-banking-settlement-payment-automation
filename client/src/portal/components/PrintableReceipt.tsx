import React from 'react';
import { Printer, Download, CheckCircle2, ShieldCheck } from 'lucide-react';
import { ReceiptData } from '../types/portal.types';

interface PrintableReceiptProps {
  receipt: ReceiptData;
  onBackToPortal?: () => void;
  t: (key: string) => string;
}

export const PrintableReceipt: React.FC<PrintableReceiptProps> = ({
  receipt,
  onBackToPortal,
  t
}) => {
  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Settlement Receipt - ${receipt.confirmationNumber}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #1e293b; max-width: 700px; margin: 40px auto; padding: 20px; border: 1px solid #cbd5e1; border-radius: 8px; }
    h1 { font-size: 20px; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 4px; background-color: #ecfdf5; color: #065f46; font-weight: bold; font-size: 14px; margin-bottom: 20px; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
    .label { font-weight: 600; color: #64748b; }
    .value { font-weight: 700; color: #0f172a; }
    .audit { margin-top: 24px; padding: 12px; background: #f8fafc; border-radius: 6px; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <h1>Official Settlement Payment Receipt</h1>
  <div class="badge">Confirmation: ${receipt.confirmationNumber}</div>
  <div class="row"><span class="label">Claimant Name</span><span class="value">${receipt.claimantName}</span></div>
  <div class="row"><span class="label">Claim ID</span><span class="value">${receipt.claimId}</span></div>
  <div class="row"><span class="label">Case Name</span><span class="value">${receipt.caseName}</span></div>
  <div class="row"><span class="label">Court Docket</span><span class="value">${receipt.docketNumber}</span></div>
  <div class="row"><span class="label">Settlement Award</span><span class="value">${receipt.formattedAmount || `$${receipt.amount.toFixed(2)}`}</span></div>
  <div class="row"><span class="label">Payment Method</span><span class="value">${receipt.selectedMethod.toUpperCase()}</span></div>
  <div class="row"><span class="label">Submission Timestamp</span><span class="value">${receipt.timestamp}</span></div>
  <div class="row"><span class="label">Digital Signature</span><span class="value">${receipt.digitalSignature}</span></div>
  <div class="audit">
    Forensic Audit Record: Captured IP ${receipt.ipAddress} under penalty of perjury under 28 U.S.C. § 1746. Verified and recorded by Juris Banking Settlement Platform.
  </div>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Settlement_Receipt_${receipt.confirmationNumber}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        padding: '32px',
        maxWidth: '760px',
        margin: '0 auto',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
      }}
    >
      {/* Top Banner */}
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            backgroundColor: '#ecfdf5',
            color: '#059669',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '12px'
          }}
        >
          <CheckCircle2 size={32} />
        </div>
        <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', margin: '0 0 8px 0' }}>
          {t('receiptTitle')}
        </h2>
        <div
          style={{
            display: 'inline-block',
            padding: '6px 14px',
            borderRadius: '6px',
            backgroundColor: '#f1f5f9',
            border: '1px solid #cbd5e1',
            fontFamily: 'monospace',
            fontSize: '16px',
            fontWeight: 700,
            color: '#1e3a8a'
          }}
        >
          {receipt.confirmationNumber}
        </div>
      </div>

      {/* Grid of Confirmed Data */}
      <div
        style={{
          borderTop: '1px solid #e2e8f0',
          borderBottom: '1px solid #e2e8f0',
          padding: '20px 0',
          marginBottom: '24px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '16px'
        }}
      >
        <div>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Claimant Name</div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{receipt.claimantName}</div>
        </div>

        <div>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Claim ID</div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
            {receipt.claimId}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Case Name</div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{receipt.caseName}</div>
        </div>

        <div>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Docket Number</div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{receipt.docketNumber}</div>
        </div>

        <div>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Confirmed Settlement Amount</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: '#047857' }}>
            {receipt.formattedAmount || `$${receipt.amount.toFixed(2)}`}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Selected Payment Method</div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#1e3a8a' }}>
            {receipt.selectedMethod.toUpperCase()}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Submission Timestamp</div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>
            {new Date(receipt.timestamp).toLocaleString('en-US')}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Digital Signature</div>
          <div style={{ fontSize: '15px', fontWeight: 600, fontStyle: 'italic', color: '#1e293b' }}>
            {receipt.digitalSignature}
          </div>
        </div>
      </div>

      {/* Forensic Audit Note */}
      <div
        style={{
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
          backgroundColor: '#f8fafc',
          padding: '12px 16px',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          fontSize: '12px',
          color: '#64748b',
          marginBottom: '28px'
        }}
      >
        <ShieldCheck size={18} color="#059669" style={{ flexShrink: 0 }} />
        <div>
          Forensic Audit Reference: Recorded from client IP <strong>{receipt.ipAddress}</strong>. Certified under 28 U.S.C. § 1746.
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handlePrint}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 18px',
            borderRadius: '6px',
            backgroundColor: '#1e3a8a',
            color: '#ffffff',
            border: 'none',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          <Printer size={16} />
          <span>{t('printReceipt')}</span>
        </button>

        <button
          type="button"
          onClick={handleDownload}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 18px',
            borderRadius: '6px',
            backgroundColor: '#f1f5f9',
            color: '#334155',
            border: '1px solid #cbd5e1',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          <Download size={16} />
          <span>{t('downloadReceipt')}</span>
        </button>

        {onBackToPortal && (
          <button
            type="button"
            onClick={onBackToPortal}
            style={{
              padding: '10px 18px',
              borderRadius: '6px',
              backgroundColor: 'transparent',
              color: '#64748b',
              border: 'none',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer'
            }}
          >
            {t('backToHome')}
          </button>
        )}
      </div>
    </div>
  );
};
