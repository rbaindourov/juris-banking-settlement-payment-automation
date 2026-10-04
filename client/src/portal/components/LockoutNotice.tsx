import React from 'react';
import { Mail, ShieldAlert } from 'lucide-react';
import { PaymentRail } from '../types/portal.types';

interface LockoutNoticeProps {
  deadline: string;
  fallbackMethod: PaymentRail;
  supportContact?: string | { email?: string; phone?: string };
  t: (key: string) => string;
}

const RAIL_LABELS: Record<string, string> = {
  physical_check: 'Mailed Physical Check (USPS)',
  direct_deposit: 'Direct Deposit (ACH)',
  ach: 'Direct Deposit (ACH)',
  digital_card: 'Digital Prepaid Card',
  debit_card: 'Push to Debit Card',
  paypal: 'PayPal',
  venmo: 'Venmo',
  zelle: 'Zelle',
  bitcoin: 'Bitcoin (BTC)'
};

export const LockoutNotice: React.FC<LockoutNoticeProps> = ({
  deadline,
  fallbackMethod,
  supportContact,
  t
}) => {
  const fallbackLabel = RAIL_LABELS[fallbackMethod] || fallbackMethod;

  return (
    <div
      style={{
        backgroundColor: '#fffbeb',
        borderRadius: '12px',
        border: '1px solid #fde68a',
        padding: '24px',
        marginBottom: '24px'
      }}
    >
      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '8px',
            backgroundColor: '#fef3c7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#b45309',
            flexShrink: 0
          }}
        >
          <ShieldAlert size={24} />
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#92400e', margin: '0 0 8px 0' }}>
            {t('deadlinePassed')}
          </h3>
          <p style={{ fontSize: '14px', color: '#78350f', lineHeight: 1.6, margin: '0 0 12px 0' }}>
            The court-ordered disbursement election deadline closed on{' '}
            <strong>{new Date(deadline).toLocaleString('en-US')}</strong>. In accordance with the settlement agreement approved by the Court, payment preference submissions are no longer accepted.
          </p>
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              border: '1px solid #fcd34d',
              padding: '16px',
              marginBottom: '16px'
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#92400e', marginBottom: '4px' }}>
              {t('fallbackCourtAssigned')}
            </div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#1e3a8a' }}>
              &rarr; {fallbackLabel}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>
              Your settlement award will be automatically processed and disbursed via this court-approved default method to your address or credentials on record.
            </div>
          </div>

          {supportContact && (
            <div style={{ fontSize: '13px', color: '#92400e', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Mail size={16} />
              <span>
                {t('supportContact')}{' '}
                <strong>
                  {typeof supportContact === 'string'
                    ? supportContact
                    : `${supportContact.email || ''} ${supportContact.phone ? `(${supportContact.phone})` : ''}`}
                </strong>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
