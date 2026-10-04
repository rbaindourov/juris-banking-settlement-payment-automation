import React from 'react';
import { Clock, AlertTriangle, AlertCircle } from 'lucide-react';
import { useCountdown, CountdownUrgency } from '../hooks/useCountdown';

interface CountdownTimerProps {
  deadline: string | Date | undefined;
  label?: string;
  onExpire?: () => void;
}

const URGENCY_STYLES: Record<
  CountdownUrgency,
  { bg: string; border: string; text: string; iconColor: string }
> = {
  standard: {
    bg: '#eff6ff',
    border: '#bfdbfe',
    text: '#1e3a8a',
    iconColor: '#2563eb'
  },
  urgent: {
    bg: '#fffbeb',
    border: '#fde68a',
    text: '#92400e',
    iconColor: '#d97706'
  },
  critical: {
    bg: '#fef2f2',
    border: '#fecaca',
    text: '#991b1b',
    iconColor: '#dc2626'
  },
  expired: {
    bg: '#f1f5f9',
    border: '#cbd5e1',
    text: '#475569',
    iconColor: '#64748b'
  }
};

export const CountdownTimer: React.FC<CountdownTimerProps> = ({
  deadline,
  label = 'Remaining to elect payment',
  onExpire
}) => {
  const { isExpired, urgency, formattedText } = useCountdown(deadline);

  React.useEffect(() => {
    if (isExpired && onExpire) {
      onExpire();
    }
  }, [isExpired, onExpire]);

  const style = URGENCY_STYLES[urgency];

  return (
    <div
      role="timer"
      aria-live="polite"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 14px',
        borderRadius: '20px',
        backgroundColor: style.bg,
        border: `1px solid ${style.border}`,
        color: style.text,
        fontSize: '13px',
        fontWeight: 600,
        boxShadow: urgency === 'critical' ? '0 0 10px rgba(220, 38, 38, 0.2)' : 'none'
      }}
    >
      {urgency === 'critical' ? (
        <AlertCircle size={16} color={style.iconColor} />
      ) : urgency === 'urgent' ? (
        <AlertTriangle size={16} color={style.iconColor} />
      ) : (
        <Clock size={16} color={style.iconColor} />
      )}
      <span>
        {isExpired ? (
          'Deadline Expired'
        ) : (
          <>
            <span style={{ fontFamily: 'monospace', fontSize: '14px' }}>{formattedText}</span>{' '}
            <span style={{ fontWeight: 400, opacity: 0.9 }}>{label}</span>
          </>
        )}
      </span>
    </div>
  );
};
