import rateLimit, { MemoryStore } from 'express-rate-limit';

export const authRateLimiterStore = new MemoryStore();
export const apiRateLimiterStore = new MemoryStore();

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  store: authRateLimiterStore,
  keyGenerator: (req) => {
    const account = typeof req.body?.email === 'string' ? req.body.email : '';
    return `${req.ip}_${account}`;
  },
  message: {
    error: 'Too many authentication attempts. Please try again later.'
  }
});

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 2000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  store: apiRateLimiterStore,
  message: {
    error: 'Too many requests. Rate limit exceeded.'
  }
});

export const trackingPixelRateLimiterStore = new MemoryStore();
export const trackingClickRateLimiterStore = new MemoryStore();
export const portalRateLimiterStore = new MemoryStore();

export const trackingPixelRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: process.env.NODE_ENV === 'test' ? 10000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  store: trackingPixelRateLimiterStore,
  message: {
    error: 'Rate limit exceeded on tracking pixel.'
  }
});

export const trackingClickRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: process.env.NODE_ENV === 'test' ? 10000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: trackingClickRateLimiterStore,
  message: {
    error: 'Rate limit exceeded on click tracking.'
  }
});

export const portalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'test' ? 2000 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: portalRateLimiterStore,
  message: {
    error: 'Too many requests to the claimant portal. Please try again later.'
  }
});

/**
 * Resets in-memory rate limiter stores so test suites do not leak counts across runs.
 */
export const resetAuthRateLimiter = async (): Promise<void> => {
  if (authRateLimiterStore && typeof (authRateLimiterStore as any).resetAll === 'function') {
    await (authRateLimiterStore as any).resetAll();
  }
  if (apiRateLimiterStore && typeof (apiRateLimiterStore as any).resetAll === 'function') {
    await (apiRateLimiterStore as any).resetAll();
  }
  if (trackingPixelRateLimiterStore && typeof (trackingPixelRateLimiterStore as any).resetAll === 'function') {
    await (trackingPixelRateLimiterStore as any).resetAll();
  }
  if (trackingClickRateLimiterStore && typeof (trackingClickRateLimiterStore as any).resetAll === 'function') {
    await (trackingClickRateLimiterStore as any).resetAll();
  }
  if (portalRateLimiterStore && typeof (portalRateLimiterStore as any).resetAll === 'function') {
    await (portalRateLimiterStore as any).resetAll();
  }
};

export const resetTrackingRateLimiters = async (): Promise<void> => {
  if (trackingPixelRateLimiterStore && typeof (trackingPixelRateLimiterStore as any).resetAll === 'function') {
    await (trackingPixelRateLimiterStore as any).resetAll();
  }
  if (trackingClickRateLimiterStore && typeof (trackingClickRateLimiterStore as any).resetAll === 'function') {
    await (trackingClickRateLimiterStore as any).resetAll();
  }
};

export const resetPortalRateLimiter = async (): Promise<void> => {
  if (portalRateLimiterStore && typeof (portalRateLimiterStore as any).resetAll === 'function') {
    await (portalRateLimiterStore as any).resetAll();
  }
};

export function createCustomRateLimiter(max: number, windowMs: number = 60 * 1000, message?: string) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: message || 'Rate limit exceeded. Please try again later.'
    }
  });
}
