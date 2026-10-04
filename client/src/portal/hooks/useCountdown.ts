import { useState, useEffect } from 'react';

export type CountdownUrgency = 'standard' | 'urgent' | 'critical' | 'expired';

export interface CountdownState {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
  urgency: CountdownUrgency;
  formattedText: string;
}

export function useCountdown(targetDate: string | Date | undefined): CountdownState {
  const calculate = (): CountdownState => {
    if (!targetDate) {
      return {
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        isExpired: false,
        urgency: 'standard',
        formattedText: ''
      };
    }

    const targetTime = new Date(targetDate).getTime();
    const now = Date.now();
    const diff = targetTime - now;

    if (diff <= 0) {
      return {
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        isExpired: true,
        urgency: 'expired',
        formattedText: '00d 00h 00m 00s'
      };
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    let urgency: CountdownUrgency = 'standard';
    if (diff <= 48 * 60 * 60 * 1000) {
      urgency = 'critical';
    } else if (diff <= 7 * 24 * 60 * 60 * 1000) {
      urgency = 'urgent';
    }

    const pad = (n: number) => String(n).padStart(2, '0');
    const formattedText = `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;

    return {
      days,
      hours,
      minutes,
      seconds,
      isExpired: false,
      urgency,
      formattedText
    };
  };

  const [state, setState] = useState<CountdownState>(calculate);

  useEffect(() => {
    setState(calculate());
    const interval = setInterval(() => {
      setState(calculate());
    }, 1000);

    return () => clearInterval(interval);
  }, [targetDate]);

  return state;
}
