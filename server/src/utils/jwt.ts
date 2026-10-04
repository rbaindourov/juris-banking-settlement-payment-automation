import jwt, { SignOptions } from 'jsonwebtoken';
import { Response } from 'express';
import { AuthTokenPayload } from '../types';
import { config } from '../config/env';

export const AUTH_COOKIE_NAME = 'token';
export const REFRESH_COOKIE_NAME = 'refreshToken';

export function signToken(payload: AuthTokenPayload, expiresIn?: string | number): string {
  const secret = config.JWT_SECRET;
  const options: SignOptions = {
    expiresIn: (expiresIn || config.JWT_EXPIRES_IN) as any
  };
  return jwt.sign(payload, secret, options);
}

export function signRefreshToken(payload: AuthTokenPayload, expiresIn: string | number = '7d'): string {
  const secret = config.JWT_SECRET;
  const options: SignOptions = {
    expiresIn: expiresIn as any
  };
  return jwt.sign({ ...payload, tokenType: 'refresh' }, secret, options);
}

export function verifyToken(token: string): AuthTokenPayload {
  const secret = config.JWT_SECRET;
  const decoded = jwt.verify(token, secret);
  return decoded as AuthTokenPayload;
}

export function verifyRefreshToken(token: string): AuthTokenPayload {
  const secret = config.JWT_SECRET;
  const decoded = jwt.verify(token, secret) as AuthTokenPayload & { tokenType?: string };
  return decoded;
}

export function setAuthCookie(res: Response, token: string, refreshToken?: string): void {
  const isProduction = config.NODE_ENV === 'production';
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  });

  if (refreshToken) {
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
  }
}

export function clearAuthCookie(res: Response): void {
  const isProduction = config.NODE_ENV === 'production';
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/'
  });
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/'
  });
}
