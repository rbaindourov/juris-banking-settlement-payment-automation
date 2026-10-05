import React, { useState, useEffect } from 'react';
import {
  Building2,
  CreditCard,
  Send,
  Mail,
  Smartphone,
  Wallet,
  Bitcoin,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { PaymentRail } from '../types/portal.types';
import {
  isValidAbaRouting,
  isValidLuhn,
  isValidCardExpiration,
  isValidBitcoinAddress,
  US_STATES,
  EMAIL_REGEX,
  E164_PHONE_REGEX,
  US_PHONE_REGEX,
  ZIP_REGEX
} from '../utils/validation';

interface PaymentRailSelectorProps {
  selectedRail: PaymentRail;
  onSelectRail: (rail: PaymentRail) => void;
  details: Record<string, any>;
  onChangeDetails: (details: Record<string, any>, isValid: boolean) => void;
  disabled?: boolean;
  claimantName?: string;
  t: (key: string) => string;
}

const RAILS_CONFIG: Array<{
  id: PaymentRail;
  nameKey: string;
  speed: string;
  icon: React.ComponentType<{ size: number; color?: string }>;
}> = [
  { id: 'ach', nameKey: 'ach', speed: '1-2 Business Days', icon: Building2 },
  { id: 'digital_card', nameKey: 'digital_card', speed: 'Instant Email/SMS', icon: CreditCard },
  { id: 'debit_card', nameKey: 'debit_card', speed: 'Real-time (30 mins)', icon: CreditCard },
  { id: 'physical_check', nameKey: 'physical_check', speed: '5-7 Days (USPS)', icon: Mail },
  { id: 'paypal', nameKey: 'paypal', speed: 'Instant Wallet', icon: Wallet },
  { id: 'venmo', nameKey: 'venmo', speed: 'Instant Handle', icon: Send },
  { id: 'zelle', nameKey: 'zelle', speed: 'Instant Bank Pay', icon: Smartphone },
  { id: 'bitcoin', nameKey: 'bitcoin', speed: 'On-Chain BTC', icon: Bitcoin }
];

export const PaymentRailSelector: React.FC<PaymentRailSelectorProps> = ({
  selectedRail,
  onSelectRail,
  details,
  onChangeDetails,
  disabled = false,
  claimantName = '',
  t
}) => {
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Validate whenever rail or details change
  useEffect(() => {
    const errs: Record<string, string> = {};

    switch (selectedRail) {
      case 'ach': {
        const routing = String(details.routingNumber || '').trim();
        const account = String(details.accountNumber || '').trim();
        const confirm = String(details.confirmAccountNumber || '').trim();
        const type = details.accountType || 'checking';

        if (!routing) errs.routingNumber = 'Routing number is required';
        else if (routing.length < 9) errs.routingNumber = 'ABA Routing number must be 9 digits';
        else if (!isValidAbaRouting(routing)) errs.routingNumber = 'Invalid 9-digit ABA routing number';

        if (!account) errs.accountNumber = 'Account number is required';
        else if (!/^\d{4,17}$/.test(account)) errs.accountNumber = 'Account number must be 4-17 digits';

        if (confirm !== account) errs.confirmAccountNumber = 'Account numbers must match';
        if (!type) errs.accountType = 'Account type is required';
        break;
      }

      case 'digital_card': {
        const channel = details.deliveryChannel || 'EMAIL';
        if (channel === 'EMAIL') {
          const email = String(details.recipientEmail || '').trim();
          if (!email || !EMAIL_REGEX.test(email)) errs.recipientEmail = 'Valid email address is required';
        } else {
          const phone = String(details.recipientPhone || '').trim();
          if (!phone || (!E164_PHONE_REGEX.test(phone) && !US_PHONE_REGEX.test(phone))) {
            errs.recipientPhone = 'Valid 10-digit or E.164 phone number is required';
          }
        }
        break;
      }

      case 'debit_card': {
        const name = String(details.cardholderName || claimantName).trim();
        const pan = String(details.cardNumber || '').replace(/\D/g, '');
        const exp = String(details.expirationDate || '').trim();
        const cvv = String(details.cvv || '').trim();
        const zip = String(details.billingZip || '').trim();

        if (name.length < 2) errs.cardholderName = 'Cardholder name is required (min 2 chars)';
        if (!pan || !isValidLuhn(pan)) errs.cardNumber = 'Invalid card number (fails Luhn check)';
        if (!exp || !isValidCardExpiration(exp)) errs.expirationDate = 'Expiration must be future MM/YY';
        if (!/^\d{3,4}$/.test(cvv)) errs.cvv = 'CVV must be 3 or 4 digits';
        if (!ZIP_REGEX.test(zip)) errs.billingZip = 'Valid 5-digit US billing ZIP is required';
        break;
      }

      case 'physical_check': {
        const name = String(details.recipientName || claimantName).trim();
        const street1 = String(details.street1 || '').trim();
        const city = String(details.city || '').trim();
        const state = String(details.state || '').toUpperCase().trim();
        const zip = String(details.zip || '').trim();

        if (name.length < 2) errs.recipientName = 'Recipient name is required';
        if (street1.length < 3) errs.street1 = 'Street address line 1 is required';
        if (city.length < 2) errs.city = 'City is required';
        if (!US_STATES.has(state)) errs.state = 'Valid 2-letter US State abbreviation is required';
        if (!ZIP_REGEX.test(zip)) errs.zip = 'Valid 5 or 9 digit US ZIP is required';
        break;
      }

      case 'paypal': {
        const acc = String(details.paypalAccount || '').trim();
        const isEmail = EMAIL_REGEX.test(acc);
        const isPhone = E164_PHONE_REGEX.test(acc) || US_PHONE_REGEX.test(acc);
        if (!acc || (!isEmail && !isPhone)) {
          errs.paypalAccount = 'Valid PayPal email address or phone number is required';
        }
        break;
      }

      case 'venmo': {
        const venmo = String(details.venmoIdentifier || '').trim();
        const isHandle = /^@?[a-zA-Z0-9_-]{5,30}$/.test(venmo);
        const isPhone = E164_PHONE_REGEX.test(venmo) || US_PHONE_REGEX.test(venmo);
        if (!venmo || (!isHandle && !isPhone)) {
          errs.venmoIdentifier = 'Valid Venmo handle (@username, 5-30 chars) or mobile phone is required';
        }
        break;
      }

      case 'zelle': {
        const zelle = String(details.zelleRecipient || '').trim();
        const isEmail = EMAIL_REGEX.test(zelle);
        const isPhone = E164_PHONE_REGEX.test(zelle) || US_PHONE_REGEX.test(zelle);
        if (!zelle || (!isEmail && !isPhone)) {
          errs.zelleRecipient = 'Valid Zelle registered email or mobile phone is required';
        }
        break;
      }

      case 'bitcoin': {
        const btc = String(details.bitcoinAddress || '').trim();
        if (!btc || !isValidBitcoinAddress(btc)) {
          errs.bitcoinAddress = 'Valid Bitcoin mainnet address (Base58 or Bech32) is required';
        }
        break;
      }
    }

    setErrors(errs);
    onChangeDetails(details, Object.keys(errs).length === 0);
  }, [selectedRail, details, claimantName]);

  const updateField = (field: string, val: any) => {
    onChangeDetails({ ...details, [field]: val }, false);
  };

  const handleRailKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (index + 1) % RAILS_CONFIG.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (index - 1 + RAILS_CONFIG.length) % RAILS_CONFIG.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = RAILS_CONFIG.length - 1;
    }

    if (nextIndex >= 0) {
      const nextRail = RAILS_CONFIG[nextIndex];
      onSelectRail(nextRail.id);
      setTimeout(() => {
        document.getElementById(`rail-tab-${nextRail.id}`)?.focus();
      }, 0);
    }
  };

  return (
    <div
      className="fintech-card break-words"
      style={{
        padding: 'clamp(16px, 3.5vw, 24px)',
        marginBottom: '24px'
      }}
    >
      <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 16px 0', letterSpacing: '-0.01em' }}>
        {t('step1Title')}
      </h3>

      {/* 9 Rails Selector Grid */}
      <div
        role="tablist"
        aria-label="Payment rails selection"
        className="payment-rail-grid"
        style={{ marginBottom: '24px' }}
      >
        {RAILS_CONFIG.map((rail, index) => {
          const isCurrent = selectedRail === rail.id;
          const Icon = rail.icon;
          return (
            <button
              key={rail.id}
              type="button"
              role="tab"
              id={`rail-tab-${rail.id}`}
              aria-controls="rail-details-panel"
              aria-selected={isCurrent}
              tabIndex={isCurrent ? 0 : -1}
              aria-label={`${t(rail.nameKey)} (${rail.speed})`}
              disabled={disabled}
              onClick={() => onSelectRail(rail.id)}
              onKeyDown={(e) => handleRailKeyDown(e, index)}
              className={`payment-rail-card ${isCurrent ? 'selected' : ''}`}
            >
              <div className="payment-rail-icon-box">
                <Icon size={20} aria-hidden="true" />
              </div>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: isCurrent ? 'var(--color-indigo)' : 'var(--text-primary)' }}>
                  {t(rail.nameKey)}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', fontWeight: 500 }}>{rail.speed}</div>
              </div>
              {isCurrent && <CheckCircle size={18} color="var(--color-indigo)" style={{ flexShrink: 0 }} aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      {/* Rail Form Sub-Section */}
      <div
        id="rail-details-panel"
        role="tabpanel"
        aria-labelledby={`rail-tab-${selectedRail}`}
        style={{
          borderTop: '1px solid var(--border-subtle)',
          paddingTop: '20px'
        }}
      >
        {selectedRail === 'ach' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: '16px' }}>
            <div>
              <label htmlFor="achRouting" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t('routingNumber')}
              </label>
              <input
                id="achRouting"
                type="text"
                disabled={disabled}
                placeholder="021000021"
                maxLength={9}
                value={details.routingNumber || ''}
                onChange={(e) => updateField('routingNumber', e.target.value.replace(/\D/g, ''))}
                className="fintech-input"
                style={{
                  border: `1px solid ${errors.routingNumber ? 'var(--color-danger)' : 'var(--border-default)'}`
                }}
              />
              {/* Real-time ABA Check-digit Feedback */}
              {details.routingNumber && details.routingNumber.length === 9 && isValidAbaRouting(details.routingNumber) && (
                <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--color-success-text)', marginTop: '4px', fontWeight: 600 }}>
                  <CheckCircle size={14} color="var(--color-success-text)" aria-hidden="true" />
                  <span>
                    Valid Federal Reserve ABA Routing Number
                    {details.routingNumber === '021000021' ? ' (JPMorgan Chase NY)' : details.routingNumber === '121000358' ? ' (Bank of America CA)' : ''}
                  </span>
                </div>
              )}
              {errors.routingNumber && (
                <div role="alert" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px', fontWeight: 500 }}>
                  <AlertCircle size={14} color="var(--color-danger)" aria-hidden="true" />
                  <span>{errors.routingNumber}</span>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="achAccountNumber" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t('accountNumber')}
              </label>
              <input
                id="achAccountNumber"
                type="text"
                disabled={disabled}
                placeholder="123456789"
                maxLength={17}
                value={details.accountNumber || ''}
                onChange={(e) => updateField('accountNumber', e.target.value.replace(/\D/g, ''))}
                className="fintech-input"
                style={{
                  border: `1px solid ${errors.accountNumber ? 'var(--color-danger)' : 'var(--border-default)'}`
                }}
              />
              {errors.accountNumber && (
                <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.accountNumber}</div>
              )}
            </div>

            <div>
              <label htmlFor="achConfirmAccountNumber" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t('confirmAccountNumber')}
              </label>
              <input
                id="achConfirmAccountNumber"
                type="text"
                disabled={disabled}
                placeholder="123456789"
                maxLength={17}
                value={details.confirmAccountNumber || ''}
                onChange={(e) => updateField('confirmAccountNumber', e.target.value.replace(/\D/g, ''))}
                className="fintech-input"
                style={{
                  border: `1px solid ${errors.confirmAccountNumber ? 'var(--color-danger)' : 'var(--border-default)'}`
                }}
              />
              {errors.confirmAccountNumber && (
                <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.confirmAccountNumber}</div>
              )}
            </div>

            <div>
              <label htmlFor="achAccountType" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t('accountType')}
              </label>
              <select
                id="achAccountType"
                disabled={disabled}
                value={details.accountType || 'checking'}
                onChange={(e) => updateField('accountType', e.target.value)}
                className="fintech-select"
                style={{ width: '100%' }}
              >
                <option value="checking">{t('checking')}</option>
                <option value="savings">{t('savings')}</option>
              </select>
            </div>
          </div>
        )}

        {selectedRail === 'digital_card' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: '16px' }}>
            <div>
              <label htmlFor="cardDeliveryChannel" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t('deliveryChannel')}
              </label>
              <select
                id="cardDeliveryChannel"
                disabled={disabled}
                value={details.deliveryChannel || 'EMAIL'}
                onChange={(e) => updateField('deliveryChannel', e.target.value)}
                className="fintech-select"
                style={{ width: '100%' }}
              >
                <option value="EMAIL">{t('email')}</option>
                <option value="SMS">{t('sms')}</option>
              </select>
            </div>

            {(details.deliveryChannel || 'EMAIL') === 'EMAIL' ? (
              <div>
                <label htmlFor="cardRecipientEmail" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  {t('recipientEmail')}
                </label>
                <input
                  id="cardRecipientEmail"
                  type="email"
                  disabled={disabled}
                  placeholder="claimant@example.com"
                  value={details.recipientEmail || ''}
                  onChange={(e) => updateField('recipientEmail', e.target.value)}
                  className="fintech-input"
                  style={{
                    border: `1px solid ${errors.recipientEmail ? 'var(--color-danger)' : 'var(--border-default)'}`
                  }}
                />
                {errors.recipientEmail && (
                  <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.recipientEmail}</div>
                )}
              </div>
            ) : (
              <div>
                <label htmlFor="cardRecipientPhone" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  {t('recipientPhone')}
                </label>
                <input
                  id="cardRecipientPhone"
                  type="tel"
                  disabled={disabled}
                  placeholder="+12055550199"
                  value={details.recipientPhone || ''}
                  onChange={(e) => updateField('recipientPhone', e.target.value)}
                  className="fintech-input"
                  style={{
                    border: `1px solid ${errors.recipientPhone ? 'var(--color-danger)' : 'var(--border-default)'}`
                  }}
                />
                {errors.recipientPhone && (
                  <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.recipientPhone}</div>
                )}
              </div>
            )}

            <div>
              <label htmlFor="cardBrand" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t('cardBrand')}
              </label>
              <select
                id="cardBrand"
                disabled={disabled}
                value={details.cardBrand || 'MASTERCARD'}
                onChange={(e) => updateField('cardBrand', e.target.value)}
                className="fintech-select"
                style={{ width: '100%' }}
              >
                <option value="MASTERCARD">Mastercard Prepaid</option>
                <option value="VISA">Visa Prepaid</option>
              </select>
            </div>
          </div>
        )}

        {selectedRail === 'debit_card' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: '16px' }}>
            <div>
              <label htmlFor="debitCardholderName" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t('cardholderName')}
              </label>
              <input
                id="debitCardholderName"
                type="text"
                disabled={disabled}
                placeholder={claimantName || 'Full Name'}
                value={details.cardholderName || ''}
                onChange={(e) => updateField('cardholderName', e.target.value)}
                className="fintech-input"
                style={{
                  border: `1px solid ${errors.cardholderName ? 'var(--color-danger)' : 'var(--border-default)'}`
                }}
              />
              {errors.cardholderName && (
                <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.cardholderName}</div>
              )}
            </div>

            <div>
              <label htmlFor="debitCardNumber" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t('cardNumber')}
              </label>
              <input
                id="debitCardNumber"
                type="text"
                disabled={disabled}
                placeholder="4111 1111 1111 1111"
                maxLength={19}
                value={details.cardNumber || ''}
                onChange={(e) => updateField('cardNumber', e.target.value)}
                className="fintech-input font-mono"
                style={{
                  border: `1px solid ${errors.cardNumber ? 'var(--color-danger)' : 'var(--border-default)'}`
                }}
              />
              {errors.cardNumber && (
                <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.cardNumber}</div>
              )}
            </div>

            <div>
              <label htmlFor="debitExpirationDate" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t('expirationDate')}
              </label>
              <input
                id="debitExpirationDate"
                type="text"
                disabled={disabled}
                placeholder="12/28"
                maxLength={7}
                value={details.expirationDate || ''}
                onChange={(e) => updateField('expirationDate', e.target.value)}
                className="fintech-input"
                style={{
                  border: `1px solid ${errors.expirationDate ? 'var(--color-danger)' : 'var(--border-default)'}`
                }}
              />
              {errors.expirationDate && (
                <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.expirationDate}</div>
              )}
            </div>

            <div>
              <label htmlFor="debitCvv" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t('cvv')}
              </label>
              <input
                id="debitCvv"
                type="password"
                disabled={disabled}
                placeholder="123"
                maxLength={4}
                value={details.cvv || ''}
                onChange={(e) => updateField('cvv', e.target.value.replace(/\D/g, ''))}
                className="fintech-input"
                style={{
                  border: `1px solid ${errors.cvv ? 'var(--color-danger)' : 'var(--border-default)'}`
                }}
              />
              {errors.cvv && (
                <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.cvv}</div>
              )}
            </div>

            <div>
              <label htmlFor="debitBillingZip" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t('billingZip')}
              </label>
              <input
                id="debitBillingZip"
                type="text"
                disabled={disabled}
                placeholder="90210"
                maxLength={10}
                value={details.billingZip || ''}
                onChange={(e) => updateField('billingZip', e.target.value)}
                className="fintech-input"
                style={{
                  border: `1px solid ${errors.billingZip ? 'var(--color-danger)' : 'var(--border-default)'}`
                }}
              />
              {errors.billingZip && (
                <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.billingZip}</div>
              )}
            </div>
          </div>
        )}

        {selectedRail === 'physical_check' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: '16px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="checkRecipientName" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t('recipientName')}
              </label>
              <input
                id="checkRecipientName"
                type="text"
                disabled={disabled}
                placeholder={claimantName || 'Recipient Full Legal Name'}
                value={details.recipientName || ''}
                onChange={(e) => updateField('recipientName', e.target.value)}
                className="fintech-input"
                style={{
                  border: `1px solid ${errors.recipientName ? 'var(--color-danger)' : 'var(--border-default)'}`
                }}
              />
              {errors.recipientName && (
                <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.recipientName}</div>
              )}
            </div>

            <div>
              <label htmlFor="checkStreet1" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t('street1')}
              </label>
              <input
                id="checkStreet1"
                type="text"
                disabled={disabled}
                placeholder="100 Main Street"
                value={details.street1 || ''}
                onChange={(e) => updateField('street1', e.target.value)}
                className="fintech-input"
                style={{
                  border: `1px solid ${errors.street1 ? 'var(--color-danger)' : 'var(--border-default)'}`
                }}
              />
              {errors.street1 && (
                <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.street1}</div>
              )}
            </div>

            <div>
              <label htmlFor="checkStreet2" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t('street2')}
              </label>
              <input
                id="checkStreet2"
                type="text"
                disabled={disabled}
                placeholder="Apt 4B"
                value={details.street2 || ''}
                onChange={(e) => updateField('street2', e.target.value)}
                className="fintech-input"
                style={{
                  border: '1px solid var(--border-default)'
                }}
              />
            </div>

            <div>
              <label htmlFor="checkCity" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t('city')}
              </label>
              <input
                id="checkCity"
                type="text"
                disabled={disabled}
                placeholder="Boston"
                value={details.city || ''}
                onChange={(e) => updateField('city', e.target.value)}
                className="fintech-input"
                style={{
                  border: `1px solid ${errors.city ? 'var(--color-danger)' : 'var(--border-default)'}`
                }}
              />
              {errors.city && (
                <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.city}</div>
              )}
            </div>

            <div>
              <label htmlFor="checkState" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t('state')}
              </label>
              <input
                id="checkState"
                type="text"
                disabled={disabled}
                placeholder="MA"
                maxLength={2}
                value={details.state || ''}
                onChange={(e) => updateField('state', e.target.value.toUpperCase())}
                className="fintech-input"
                style={{
                  border: `1px solid ${errors.state ? 'var(--color-danger)' : 'var(--border-default)'}`
                }}
              />
              {errors.state && (
                <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.state}</div>
              )}
            </div>

            <div>
              <label htmlFor="checkZip" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t('zip')}
              </label>
              <input
                id="checkZip"
                type="text"
                disabled={disabled}
                placeholder="02108"
                maxLength={10}
                value={details.zip || ''}
                onChange={(e) => updateField('zip', e.target.value)}
                className="fintech-input"
                style={{
                  border: `1px solid ${errors.zip ? 'var(--color-danger)' : 'var(--border-default)'}`
                }}
              />
              {errors.zip && (
                <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.zip}</div>
              )}
            </div>
          </div>
        )}

        {selectedRail === 'paypal' && (
          <div>
            <label htmlFor="paypalAccount" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {t('paypalAccount')}
            </label>
            <input
              id="paypalAccount"
              type="text"
              disabled={disabled}
              placeholder="user@example.com or +12055550199"
              value={details.paypalAccount || ''}
              onChange={(e) => updateField('paypalAccount', e.target.value)}
              className="fintech-input"
              style={{
                border: `1px solid ${errors.paypalAccount ? 'var(--color-danger)' : 'var(--border-default)'}`
              }}
            />
            {errors.paypalAccount && (
              <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.paypalAccount}</div>
            )}
          </div>
        )}

        {selectedRail === 'venmo' && (
          <div>
            <label htmlFor="venmoIdentifier" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {t('venmoIdentifier')}
            </label>
            <input
              id="venmoIdentifier"
              type="text"
              disabled={disabled}
              placeholder="@username or +12055550199"
              value={details.venmoIdentifier || ''}
              onChange={(e) => updateField('venmoIdentifier', e.target.value)}
              className="fintech-input"
              style={{
                border: `1px solid ${errors.venmoIdentifier ? 'var(--color-danger)' : 'var(--border-default)'}`
              }}
            />
            {errors.venmoIdentifier && (
              <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.venmoIdentifier}</div>
            )}
          </div>
        )}

        {selectedRail === 'zelle' && (
          <div>
            <label htmlFor="zelleRecipient" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {t('zelleRecipient')}
            </label>
            <input
              id="zelleRecipient"
              type="text"
              disabled={disabled}
              placeholder="enrolled@example.com or +12055550199"
              value={details.zelleRecipient || ''}
              onChange={(e) => updateField('zelleRecipient', e.target.value)}
              className="fintech-input"
              style={{
                border: `1px solid ${errors.zelleRecipient ? 'var(--color-danger)' : 'var(--border-default)'}`
              }}
            />
            {errors.zelleRecipient && (
              <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.zelleRecipient}</div>
            )}
          </div>
        )}

        {selectedRail === 'bitcoin' && (
          <div>
            <label htmlFor="bitcoinAddress" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {t('bitcoinAddress')}
            </label>
            <input
              id="bitcoinAddress"
              type="text"
              disabled={disabled}
              placeholder="bc1q... or 1... or 3..."
              value={details.bitcoinAddress || ''}
              onChange={(e) => updateField('bitcoinAddress', e.target.value.trim())}
              className="fintech-input font-mono break-all"
              style={{
                border: `1px solid ${errors.bitcoinAddress ? 'var(--color-danger)' : 'var(--border-default)'}`
              }}
            />
            {errors.bitcoinAddress && (
              <div role="alert" aria-live="polite" style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '4px' }}>{errors.bitcoinAddress}</div>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginTop: '10px',
                fontSize: '12px',
                color: 'var(--color-warning-text)',
                backgroundColor: 'var(--color-warning-bg)',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-warning-border)'
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0 }} aria-hidden="true" />
              <span>{t('bitcoinWarning')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
