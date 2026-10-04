import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { User } from '../models/User';
import { USER_ROLES, AuthenticatedRequest, UserRole, AuthTokenPayload } from '../types';
import {
  signToken,
  signRefreshToken,
  verifyToken,
  verifyRefreshToken,
  setAuthCookie,
  clearAuthCookie,
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_NAME
} from '../utils/jwt';

export const registerSchema = z.object({
  email: z.string().email('Valid email address required').max(255, 'Email must not exceed 255 characters'),
  password: z.string().min(8, 'Password must be at least 8 characters long').max(128, 'Password must not exceed 128 characters'),
  fullName: z.string().min(1, 'Full name must be at least 1 character long').max(100, 'Full name must not exceed 100 characters'),
  role: z.enum(USER_ROLES as [string, ...string[]]).optional().default('case_manager'),
  lawFirmId: z.string().max(100).optional().nullable()
});

export const loginSchema = z.object({
  email: z.string().email('Valid email address required').max(255),
  password: z.string().min(1, 'Password is required').max(128)
});

export const refreshSchema = z.object({
  refreshToken: z.string().optional()
});

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, fullName, role, lawFirmId } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      res.status(409).json({ error: 'User already exists with this email address' });
      return;
    }

    // Privilege Escalation Protection:
    // Disallow unauthenticated clients from registering as super_admin or platform_admin.
    // Allow elevated role only if authenticated by an existing super_admin, or bootstrap/admin domain.
    let effectiveRole: UserRole = role || 'case_manager';
    if (effectiveRole === 'super_admin' || effectiveRole === 'platform_admin') {
      let isAllowed = false;

      // 1. Check if caller is authenticated as an existing super_admin
      let callerToken: string | undefined;
      if (req.cookies && (req.cookies[AUTH_COOKIE_NAME] || req.cookies['juris_auth_token'])) {
        callerToken = req.cookies[AUTH_COOKIE_NAME] || req.cookies['juris_auth_token'];
      }
      if (!callerToken && req.headers.authorization?.startsWith('Bearer ')) {
        callerToken = req.headers.authorization.substring(7).trim();
      }
      if (callerToken) {
        try {
          const callerUser = verifyToken(callerToken);
          if (callerUser && callerUser.role === 'super_admin') {
            isAllowed = true;
          }
        } catch (_) {}
      }

      // 2. Allow authorized administrative/system domains
      if (!isAllowed) {
        const normalizedEmail = (email || '').toLowerCase();
        if (
          normalizedEmail.endsWith('@juris-banking.com') ||
          normalizedEmail.endsWith('@juris-test.com') ||
          normalizedEmail.endsWith('@juris-banking.local')
        ) {
          isAllowed = true;
        }
      }

      // If unauthorized, default/restrict to case_manager
      if (!isAllowed) {
        effectiveRole = 'case_manager';
      }
    }

    const passwordHash = await User.hashPassword(password);
    const user = await User.create({
      email,
      passwordHash,
      fullName,
      role: effectiveRole,
      lawFirmId: lawFirmId || null
    });

    const tokenPayload: AuthTokenPayload = {
      id: user._id.toString(),
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      lawFirmId: user.lawFirmId
    };

    const token = signToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

    setAuthCookie(res, token, refreshToken);

    res.status(201).json({
      success: true,
      user: user.toJSON(),
      token,
      refreshToken
    });
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ error: 'User already exists with this email address' });
      return;
    }
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const tokenPayload: AuthTokenPayload = {
      id: user._id.toString(),
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      lawFirmId: user.lawFirmId
    };

    const token = signToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

    setAuthCookie(res, token, refreshToken);

    res.status(200).json({
      success: true,
      user: user.toJSON(),
      token,
      refreshToken
    });
  } catch (err) {
    next(err);
  }
}

export async function logout(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    clearAuthCookie(res);
    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (err) {
    next(err);
  }
}

export async function getCurrentUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json({
      success: true,
      user: user.toJSON()
    });
  } catch (err) {
    next(err);
  }
}

export async function refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    let token: string | undefined;

    // 1. Check cookies
    if (req.cookies && (req.cookies[REFRESH_COOKIE_NAME] || req.cookies[AUTH_COOKIE_NAME] || req.cookies['juris_auth_token'])) {
      token = req.cookies[REFRESH_COOKIE_NAME] || req.cookies[AUTH_COOKIE_NAME] || req.cookies['juris_auth_token'];
    }

    // 2. Check request body
    if (!token && req.body?.refreshToken) {
      token = req.body.refreshToken;
    }

    // 3. Check Authorization header
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.substring(7).trim();
    }

    if (!token) {
      res.status(401).json({ error: 'Refresh token required' });
      return;
    }

    let payload: AuthTokenPayload;
    try {
      payload = verifyRefreshToken(token);
    } catch (_) {
      try {
        payload = verifyToken(token);
      } catch (err) {
        res.status(401).json({ error: 'Invalid or expired refresh token' });
        return;
      }
    }

    const user = await User.findById(payload.id);
    if (!user) {
      res.status(401).json({ error: 'User no longer exists' });
      return;
    }

    const tokenPayload: AuthTokenPayload = {
      id: user._id.toString(),
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      lawFirmId: user.lawFirmId
    };

    const newAccessToken = signToken(tokenPayload);
    const newRefreshToken = signRefreshToken(tokenPayload);

    setAuthCookie(res, newAccessToken, newRefreshToken);

    res.status(200).json({
      success: true,
      token: newAccessToken,
      refreshToken: newRefreshToken,
      user: user.toJSON()
    });
  } catch (err) {
    next(err);
  }
}
