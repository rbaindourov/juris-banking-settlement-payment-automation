import { useEffect, useRef, useCallback } from 'react';
import { PortalTelemetryPayload } from '../types/portal.types';

/**
 * Computes a deterministic 64-character hex fingerprint from non-invasive browser/device signals
 * (User-Agent, language, screen dimensions, color depth, hardwareConcurrency, and timezone offset).
 */
function computeDeterministicDeviceFingerprint(): string {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return '00000000000000000000000000000000';
  }

  const rawSignals = [
    navigator.userAgent || '',
    navigator.language || '',
    `${window.screen?.width || 0}x${window.screen?.height || 0}x${window.screen?.colorDepth || 24}`,
    String(navigator.hardwareConcurrency || 0),
    String(new Date().getTimezoneOffset()),
    Intl?.DateTimeFormat?.()?.resolvedOptions?.()?.timeZone || ''
  ].join('|');

  // FNV-1a 32-bit multi-seed deterministic hex hash (produces a 32-char hex string)
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const hexParts = seeds.map((seed) => {
    let hash = seed >>> 0;
    for (let i = 0; i < rawSignals.length; i++) {
      hash ^= rawSignals.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  });

  return hexParts.join('');
}

export interface UseFraudTelemetrySensorResult {
  recordKeystroke: () => void;
  recordInteraction: () => void;
  getTelemetrySnapshot: () => PortalTelemetryPayload;
}

export function useFraudTelemetrySensor(): UseFraudTelemetrySensorResult {
  const mountedAtRef = useRef<number>(Date.now());
  const interactionCountRef = useRef<number>(0);
  const keystrokeCountRef = useRef<number>(0);
  const deviceFingerprintRef = useRef<string>(computeDeterministicDeviceFingerprint());

  const recordInteraction = useCallback(() => {
    interactionCountRef.current += 1;
  }, []);

  const recordKeystroke = useCallback(() => {
    keystrokeCountRef.current += 1;
    interactionCountRef.current += 1;
  }, []);

  useEffect(() => {
    mountedAtRef.current = Date.now();

    const handlePointerDown = () => {
      interactionCountRef.current += 1;
    };

    const handleKeyDown = () => {
      keystrokeCountRef.current += 1;
      interactionCountRef.current += 1;
    };

    window.addEventListener('pointerdown', handlePointerDown, { passive: true });
    window.addEventListener('keydown', handleKeyDown, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const getTelemetrySnapshot = useCallback((): PortalTelemetryPayload => {
    const dwellTimeMs = Math.max(0, Date.now() - mountedAtRef.current);
    const webdriverDetected =
      typeof navigator !== 'undefined' ? Boolean((navigator as any).webdriver) : false;
    const timezoneOffset = new Date().getTimezoneOffset();
    const screenResolution =
      typeof window !== 'undefined'
        ? `${window.screen?.width || 0}x${window.screen?.height || 0}`
        : '0x0';

    return {
      dwellTimeMs,
      interactionCount: interactionCountRef.current,
      keystrokeCount: keystrokeCountRef.current,
      webdriverDetected,
      deviceFingerprint: deviceFingerprintRef.current,
      timezoneOffset,
      screenResolution
    };
  }, []);

  return {
    recordKeystroke,
    recordInteraction,
    getTelemetrySnapshot
  };
}
