import { Request } from 'express';

export type UserRole = 
  | 'super_admin' 
  | 'platform_admin' 
  | 'law_firm_admin' 
  | 'case_manager' 
  | 'auditor';

export const USER_ROLES: readonly UserRole[] = [
  'super_admin',
  'platform_admin',
  'law_firm_admin',
  'case_manager',
  'auditor'
] as const;

export const CORE_AGENDA_JOBS = [
  'case:dispatch-notifications',
  'case:send-deadline-reminders',
  'case:enforce-deadline-fallback',
  'sftp:generate-and-upload-batch',
  'sftp:poll-reconciliation-reports'
] as const;

export const AGENDA_JOBS = [
  'case:dispatch-notifications',
  'case:send-deadline-reminders',
  'case:enforce-deadline-fallback',
  'sftp:generate-and-upload-batch',
  'sftp:poll-reconciliation-reports',
  'email:scan-gmail-bounces'
] as const;

export type CoreAgendaJobName = typeof CORE_AGENDA_JOBS[number];
export type AgendaJobName = typeof AGENDA_JOBS[number];

export interface AuthTokenPayload {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  lawFirmId?: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthTokenPayload;
  tenantFilter?: {
    lawFirmId?: string | null;
  };
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
      tenantFilter?: {
        lawFirmId?: string | null;
      };
    }
  }
}
