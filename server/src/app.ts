import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config/env';
import authRoutes from './routes/auth.routes';
import caseRoutes from './routes/case.routes';
import trackingRoutes from './routes/tracking.routes';
import portalRoutes from './routes/portal.routes';
import reconciliationRoutes from './routes/reconciliation.routes';
import analyticsRoutes from './routes/analytics.routes';
import { authenticateToken, requireRole } from './middleware/auth';
import { CORE_AGENDA_JOBS, AGENDA_JOBS } from './types';
import { createExpressMiddleware } from 'agendash';
import { getAgenda } from './config/agenda';

let cachedAgendaInstance: any = null;
let cachedAgendashHandler: any = null;
function getAgendashMiddleware() {
  const currentAgenda = getAgenda();
  if (!cachedAgendashHandler || cachedAgendaInstance !== currentAgenda) {
    cachedAgendaInstance = currentAgenda;
    cachedAgendashHandler = createExpressMiddleware(currentAgenda);
  }
  return cachedAgendashHandler;
}

export function createApp(): Express {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS with credentials support
  app.use(
    cors({
      origin: config.CLIENT_URL,
      credentials: true
    })
  );

  // Cookie parsing
  app.use(cookieParser(config.COOKIE_SECRET));

  // Request body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Health check endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      environment: config.NODE_ENV,
      timestamp: new Date().toISOString()
    });
  });

  // Auth routes
  app.use('/api/auth', authRoutes);

  // Case & Ingestion routes
  app.use('/api/cases', caseRoutes);
  app.use('/api/cases', reconciliationRoutes);
  app.use('/api/cases', analyticsRoutes);

  // Public tracking routes
  app.use('/api/public/tracking', trackingRoutes);

  // Public claimant portal routes
  app.use('/api/public/claim', portalRoutes);

  // Agendash scheduler mount (RBAC protected per PROJECT.md Contract 5)
  app.use(
    '/agendash',
    authenticateToken,
    requireRole(['super_admin', 'platform_admin', 'law_firm_admin']),
    (req: Request, res: Response, next: NextFunction) => {
      // Content negotiation: return registered jobs JSON for API clients and automated tests
      if ((req.path === '/' || req.path === '') && req.headers.accept?.includes('application/json')) {
        return res.status(200).json({
          message: 'Agendash scheduler interface',
          registeredJobs: CORE_AGENDA_JOBS,
          allJobs: AGENDA_JOBS
        });
      }
      return getAgendashMiddleware()(req, res, next);
    }
  );

  // 404 handler for undefined routes
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // Centralized error handling middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    let statusCode = err.status || err.statusCode || 500;
    let message = err.message || 'Internal server error';

    if (err.name === 'CastError') {
      statusCode = 400;
      message = `Invalid ID format: ${err.value}`;
    } else if (err.code === 11000) {
      statusCode = 409;
      if (
        (err.keyPattern && err.keyPattern.claimId) ||
        (typeof err.message === 'string' && err.message.includes('claimId'))
      ) {
        message = 'Claimant with this Claim ID already exists for this case';
      } else {
        message = 'User already exists with this email address';
      }
    }

    if (config.NODE_ENV !== 'test' && statusCode === 500) {
      console.error('[ServerError]', err);
    }

    res.status(statusCode).json({
      error: message,
      ...(config.NODE_ENV === 'development' ? { stack: err.stack } : {})
    });
  });

  return app;
}

export const app = createApp();
