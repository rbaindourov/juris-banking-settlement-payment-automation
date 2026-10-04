import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, UserRole } from '../types';
import { verifyToken, AUTH_COOKIE_NAME } from '../utils/jwt';

export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  let cookieToken: string | undefined;
  let headerToken: string | undefined;

  // 1. Check HttpOnly cookie
  if (req.cookies && (req.cookies[AUTH_COOKIE_NAME] || req.cookies['juris_auth_token'])) {
    cookieToken = req.cookies[AUTH_COOKIE_NAME] || req.cookies['juris_auth_token'];
  }

  // 2. Check Authorization header (Bearer token)
  if (req.headers.authorization) {
    const authHeader = req.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      headerToken = authHeader.substring(7).trim();
    }
  }

  if (!cookieToken && !headerToken) {
    res.status(401).json({ error: 'Authentication required. No token provided.' });
    return;
  }

  // Try cookie first if present
  if (cookieToken) {
    try {
      const payload = verifyToken(cookieToken);
      req.user = payload;
      return next();
    } catch (cookieErr) {
      // If cookie token is invalid/expired and no header token is provided, return 401
      if (!headerToken) {
        res.status(401).json({ error: 'Invalid or expired authentication token.' });
        return;
      }
      // If headerToken is provided, fall through to header verification
    }
  }

  // Check Bearer token (either primary or fallback)
  if (headerToken) {
    try {
      const payload = verifyToken(headerToken);
      req.user = payload;
      return next();
    } catch (headerErr) {
      res.status(401).json({ error: 'Invalid or expired authentication token.' });
      return;
    }
  }

  res.status(401).json({ error: 'Invalid or expired authentication token.' });
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Forbidden: Insufficient permissions.',
        requiredRoles: allowedRoles,
        currentRole: req.user.role
      });
      return;
    }

    next();
  };
}

export function requireTenantScope(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  // Super Admins and Platform Admins have global cross-tenant access
  if (req.user.role === 'super_admin' || req.user.role === 'platform_admin') {
    req.tenantFilter = {};
    return next();
  }

  // Law Firm Admins, Case Managers, and Auditors must be bound to a law firm
  if (!req.user.lawFirmId) {
    res.status(403).json({
      error: 'Forbidden: Tenant context required. User is not assigned to a law firm.'
    });
    return;
  }

  const userFirmId = req.user.lawFirmId;

  // Validate URL parameters if present
  const paramFirmId = req.params?.firmId || req.params?.lawFirmId;
  if (paramFirmId && paramFirmId !== userFirmId) {
    res.status(403).json({
      error: 'Forbidden: Cross-tenant access denied.',
      userFirmId,
      targetFirmId: paramFirmId
    });
    return;
  }

  // Validate request body lawFirmId if present
  const bodyFirmId = req.body?.lawFirmId || req.body?.firmId;
  if (bodyFirmId && bodyFirmId !== userFirmId) {
    res.status(403).json({
      error: 'Forbidden: Cross-tenant access denied.',
      userFirmId,
      targetFirmId: bodyFirmId
    });
    return;
  }

  // Validate query parameters if present
  const queryFirmId = (req.query?.lawFirmId as string | undefined) || (req.query?.firmId as string | undefined);
  if (queryFirmId && queryFirmId !== userFirmId) {
    res.status(403).json({
      error: 'Forbidden: Cross-tenant access denied.',
      userFirmId,
      targetFirmId: queryFirmId
    });
    return;
  }

  req.tenantFilter = { lawFirmId: userFirmId };
  next();
}
