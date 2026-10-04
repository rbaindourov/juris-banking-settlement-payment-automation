import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PortalHeader } from './components/PortalHeader';
import { ClaimantSummaryCard } from './components/ClaimantSummaryCard';
import { LockoutNotice } from './components/LockoutNotice';
import { PaymentRailSelector } from './components/PaymentRailSelector';
import { DigitalSignatureCard } from './components/DigitalSignatureCard';
import { PrintableReceipt } from './components/PrintableReceipt';
import { usePortalI18n } from './hooks/usePortalI18n';
import { portalApi } from './services/portalApi';
import {
  ClaimPortalData,
  CasePortalData,
  PaymentRail,
  ReceiptData,
  LanguageCode
} from './types/portal.types';
import { AlertCircle, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react';

export const ClaimantPortalPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [claim, setClaim] = useState<ClaimPortalData | null>(null);
  const [caseData, setCaseData] = useState<CasePortalData | null>(null);

  const { currentLang, setLang, t } = usePortalI18n('en');

  // Form State
  const [selectedRail, setSelectedRail] = useState<PaymentRail>('ach');
  const [details, setDetails] = useState<Record<string, any>>({});
  const [isDetailsValid, setIsDetailsValid] = useState<boolean>(false);
  const [certificationAffirmed, setCertificationAffirmed] = useState<boolean>(false);
  const [signature, setSignature] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  // FAQ Accordion expanded indices
  const [openFaqIndices, setOpenFaqIndices] = useState<number[]>([]);

  const fetchClaimData = useCallback(
    async (targetLang?: string) => {
      if (!token) {
        setErrorMsg('Invalid or missing settlement claim token.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await portalApi.getClaim(token, targetLang);
        setClaim(res.claim);
        setCaseData(res.case);
        if (res.claim.selectedPaymentMethod) {
          setSelectedRail(res.claim.selectedPaymentMethod);
        }
      } catch (err: any) {
        setErrorMsg(err.message || 'Unable to load claim information.');
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    fetchClaimData(currentLang);
  }, [fetchClaimData, currentLang]);

  const handleLanguageChange = (newLang: LanguageCode) => {
    setLang(newLang);
  };

  const handleDetailsChange = (newDetails: Record<string, any>, isValid: boolean) => {
    setDetails(newDetails);
    setIsDetailsValid(isValid);
  };

  const handleSubmitElection = async () => {
    if (!token || !isDetailsValid || !certificationAffirmed || signature.trim().length < 2) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await portalApi.selectPayment(token, {
        method: selectedRail,
        details,
        certificationAffirmed,
        signature: signature.trim()
      });

      if (res.success && res.receipt) {
        setReceipt(res.receipt);
      } else {
        // Refresh claim data
        await fetchClaimData(currentLang);
      }
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to submit payment election. Please check your inputs.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleFaq = (index: number) => {
    setOpenFaqIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

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
          <p style={{ fontSize: '15px', fontWeight: 500 }}>Loading Official Settlement Claim...</p>
        </div>
      </div>
    );
  }

  if (errorMsg || !claim || !caseData) {
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
            maxWidth: '500px',
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
            Claim Record Not Found
          </h2>
          <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6, margin: '0 0 20px 0' }}>
            {errorMsg || 'We were unable to locate an active settlement award matching this secure token.'}
          </p>
          <button
            type="button"
            onClick={() => navigate('/')}
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
            Return to Portal Home
          </button>
        </div>
      </div>
    );
  }

  // If already confirmed or receipt just created:
  if (receipt) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', fontFamily: 'sans-serif' }}>
        <PortalHeader
          caseData={caseData}
          disbursementDeadline={claim.disbursementDeadline}
          currentLang={currentLang}
          onChangeLang={handleLanguageChange}
        />
        <main style={{ maxWidth: '1000px', margin: '32px auto', padding: '0 20px' }}>
          <PrintableReceipt
            receipt={receipt}
            onBackToPortal={() => setReceipt(null)}
            t={t}
          />
        </main>
      </div>
    );
  }

  const isLocked = claim.isExpired;
  const canSubmit = isDetailsValid && certificationAffirmed && signature.trim().length >= 2;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', fontFamily: 'sans-serif' }}>
      <PortalHeader
        caseData={caseData}
        disbursementDeadline={claim.disbursementDeadline}
        currentLang={currentLang}
        onChangeLang={handleLanguageChange}
        onExpire={() => setClaim((prev) => (prev ? { ...prev, isExpired: true, status: 'expired' } : null))}
      />

      <main style={{ maxWidth: '1000px', margin: '32px auto', padding: '0 20px' }}>
        {/* Claimant Summary */}
        <ClaimantSummaryCard claim={claim} t={t} />

        {/* Lockout Notice if Expired */}
        {isLocked && (
          <LockoutNotice
            deadline={claim.disbursementDeadline}
            fallbackMethod={claim.assignedFallbackMethod}
            supportContact={caseData.landingPageText?.supportContact}
            t={t}
          />
        )}

        {/* Landing Page Headline & Intro Copy */}
        {caseData.landingPageText && (
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '24px',
              marginBottom: '24px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.04)'
            }}
          >
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', margin: '0 0 12px 0' }}>
              {caseData.landingPageText.headline || t('portalTitle')}
            </h2>
            <div
              style={{ fontSize: '14px', color: '#475569', lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{ __html: caseData.landingPageText.introHtml }}
            />
          </div>
        )}

        {/* Payment Election Form (Disabled/Hidden if Locked) */}
        {!isLocked && (
          <>
            {submitError && (
              <div
                style={{
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '14px 16px',
                  marginBottom: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  color: '#991b1b',
                  fontSize: '14px'
                }}
              >
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{submitError}</span>
              </div>
            )}

            <PaymentRailSelector
              selectedRail={selectedRail}
              onSelectRail={setSelectedRail}
              details={details}
              onChangeDetails={handleDetailsChange}
              disabled={isLocked || isSubmitting}
              claimantName={`${claim.firstName} ${claim.lastName}`}
              t={t}
            />

            <DigitalSignatureCard
              certificationAffirmed={certificationAffirmed}
              onToggleCertification={setCertificationAffirmed}
              signature={signature}
              onChangeSignature={setSignature}
              onSubmit={handleSubmitElection}
              isSubmitting={isSubmitting}
              canSubmit={canSubmit}
              settlementAmountFormatted={claim.formattedAwardAmount}
              disabled={isLocked || isSubmitting}
              t={t}
            />
          </>
        )}

        {/* FAQ Accordion Section */}
        {caseData.landingPageText?.faqAccordion && caseData.landingPageText.faqAccordion.length > 0 && (
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '24px',
              marginBottom: '24px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.04)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <HelpCircle size={20} color="#1e3a8a" />
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                {t('faqTitle')}
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {caseData.landingPageText.faqAccordion.map((faq, idx) => {
                const isOpen = openFaqIndices.includes(idx);
                return (
                  <div
                    key={idx}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      overflow: 'hidden'
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleFaq(idx)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 18px',
                        backgroundColor: isOpen ? '#f8fafc' : '#ffffff',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: '14px',
                        fontWeight: 600,
                        color: '#1e293b'
                      }}
                    >
                      <span>{faq.question}</span>
                      {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    {isOpen && (
                      <div
                        style={{
                          padding: '14px 18px',
                          borderTop: '1px solid #f1f5f9',
                          backgroundColor: '#ffffff',
                          fontSize: '14px',
                          color: '#475569',
                          lineHeight: 1.6
                        }}
                        dangerouslySetInnerHTML={{ __html: faq.answer }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
