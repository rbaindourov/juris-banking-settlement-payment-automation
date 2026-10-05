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
      className="fintech-card break-words"
      role="region"
      aria-label="Official Settlement Payment Receipt"
      style={{
        padding: 'clamp(20px, 4vw, 36px)',
        maxWidth: '780px',
        margin: '0 auto',
        boxShadow: 'var(--shadow-md)'
      }}
    >
      {/* Top Banner */}
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <div
          style={{
            width: '60px',
            height: '60px',
            borderRadius: 'var(--radius-full)',
            backgroundColor: 'var(--color-success-bg)',
            color: 'var(--color-success)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '14px',
            boxShadow: '0 2px 6px rgba(5, 150, 105, 0.2)'
          }}
        >
          <CheckCircle2 size={32} aria-hidden="true" />
        </div>
        <h2 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>
          {t('receiptTitle')}
        </h2>
        <div
          style={{
            display: 'inline-block',
            padding: '6px 16px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--bg-active)',
            border: '1px solid #bfdbfe',
            fontFamily: 'var(--font-mono)',
            fontSize: '16px',
            fontWeight: 800,
            color: 'var(--color-indigo)'
          }}
        >
          Confirmation: {receipt.confirmationNumber}
        </div>
      </div>

      {/* Grid of Confirmed Data */}
      <div
        style={{
          borderTop: '1px solid var(--border-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '24px 0',
          marginBottom: '24px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
          gap: '20px'
        }}
      >
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Claimant Name</div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>{receipt.claimantName}</div>
        </div>

        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Claim ID</div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
            {receipt.claimId}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Case Matter</div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>{receipt.caseName}</div>
        </div>

        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Court Docket</div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>{receipt.docketNumber}</div>
        </div>

        <div>
          <div style={{ fontSize: '11px', color: 'var(--color-success-text)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Confirmed Settlement Award</div>
          <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-success-text)', fontVariantNumeric: 'tabular-nums', marginTop: '2px' }}>
            {receipt.formattedAmount || `$${receipt.amount.toFixed(2)}`}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Selected Payment Method</div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-indigo)', marginTop: '2px' }}>
            {receipt.selectedMethod.toUpperCase()}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Submission Timestamp</div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '2px' }}>
            {new Date(receipt.timestamp).toLocaleString('en-US')}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Digital Signature</div>
          <div style={{ fontSize: '15px', fontWeight: 600, fontStyle: 'italic', fontFamily: 'Georgia, serif', color: 'var(--text-primary)', marginTop: '2px' }}>
            {receipt.digitalSignature}
          </div>
        </div>
      </div>

      {/* Forensic Audit Note */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          backgroundColor: 'var(--bg-card-subtle)',
          padding: '14px 18px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)',
          fontSize: '12px',
          color: 'var(--text-muted)',
          marginBottom: '28px'
        }}
      >
        <ShieldCheck size={20} color="var(--color-success)" style={{ flexShrink: 0 }} aria-hidden="true" />
        <div>
          Forensic Audit Record: Captured from client IP <strong>{receipt.ipAddress}</strong> under penalty of perjury pursuant to 28 U.S.C. § 1746. Verified and recorded by Juris Banking Settlement Platform.
        </div>
      </div>

      {/* Action Buttons */}
      <div className="no-print" style={{ display: 'flex', gap: '14px', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handlePrint}
          aria-label="Print official receipt"
          className="btn-primary"
          style={{ padding: '10px 20px' }}
        >
          <Printer size={16} aria-hidden="true" />
          <span>{t('printReceipt')}</span>
        </button>

        <button
          type="button"
          onClick={handleDownload}
          aria-label="Download official receipt as HTML"
          className="btn-secondary"
          style={{ padding: '10px 20px' }}
        >
          <Download size={16} aria-hidden="true" />
          <span>{t('downloadReceipt')}</span>
        </button>

        {onBackToPortal && (
          <button
            type="button"
            onClick={onBackToPortal}
            style={{
              padding: '10px 20px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'transparent',
              color: 'var(--text-muted)',
              border: 'none',
              fontSize: '14px',
              fontWeight: 600,
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
