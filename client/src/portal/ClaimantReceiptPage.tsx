import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PrintableReceipt } from './components/PrintableReceipt';
import { usePortalI18n } from './hooks/usePortalI18n';
import { portalApi } from './services/portalApi';
import { ReceiptData } from './types/portal.types';
import { AlertCircle } from 'lucide-react';

export const ClaimantReceiptPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const { t } = usePortalI18n('en');

  useEffect(() => {
    if (!token) {
      setErrorMsg('Missing settlement claim token.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    portalApi
      .getReceipt(token)
      .then((res) => {
        setReceipt(res.receipt);
      })
      .catch((err: any) => {
        setErrorMsg(err.message || 'No confirmed receipt found for this settlement claim.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f8fafc',
          fontFamily: 'sans-serif'
        }}
      >
        <div style={{ textAlign: 'center', color: '#64748b' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              border: '3px solid #cbd5e1',
              borderTopColor: '#1e3a8a',
              borderRadius: '50%',
              margin: '0 auto 16px',
              animation: 'spin 1s linear infinite'
            }}
          />
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          <p style={{ fontSize: '15px', fontWeight: 500 }}>Retrieving Official Confirmation Receipt...</p>
        </div>
      </div>
    );
  }

  if (errorMsg || !receipt) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f8fafc',
          padding: '24px',
          fontFamily: 'sans-serif'
        }}
      >
        <div
          style={{
            maxWidth: '480px',
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #fee2e2',
            padding: '32px',
            textAlign: 'center',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)'
          }}
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: '#fee2e2',
              color: '#dc2626',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px'
            }}
          >
            <AlertCircle size={32} />
          </div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#991b1b', margin: '0 0 10px 0' }}>
            Receipt Not Available
          </h2>
          <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6, margin: '0 0 20px 0' }}>
            {errorMsg || 'A confirmed payment election could not be located for this record.'}
          </p>
          <button
            type="button"
            onClick={() => (token ? navigate(`/claim/${token}`) : navigate('/'))}
            style={{
              padding: '10px 20px',
              backgroundColor: '#1e3a8a',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Go to Election Portal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        padding: '40px 20px',
        fontFamily: 'sans-serif'
      }}
    >
      <PrintableReceipt
        receipt={receipt}
        onBackToPortal={() => (token ? navigate(`/claim/${token}`) : navigate('/'))}
        t={t}
      />
    </div>
  );
};
