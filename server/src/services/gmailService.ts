import { config } from '../config/env';

export interface GmailSendInput {
  to: string;
  subject: string;
  bodyText?: string;
  bodyHtml: string;
  cc?: string;
  bcc?: string;
}

export interface GmailSendResponse {
  success: boolean;
  data?: {
    messageId: string;
    threadId?: string;
    labelIds?: string[];
  };
  error?: string;
}

export interface GmailBounceCheckResponse {
  success: boolean;
  data?: {
    email: string;
    suppressed: boolean;
    reason?: string;
    bounceType?: 'hard' | 'soft' | 'blocked' | 'unknown';
  };
  error?: string;
}

export interface GmailScanResponse {
  success: boolean;
  data?: {
    scanned: number;
    bouncesDetected: number;
    newBounces: Array<{
      recipient: string;
      bounceType: string;
      diagnosticMessage: string;
    }>;
  };
  error?: string;
}

export class GmailService {
  private static get baseUrl(): string {
    return (config.GMAIL_SERVICE_URL || 'http://localhost:8085').replace(/\/+$/, '');
  }

  /**
   * Dispatches an email via POST /api/gmail/send
   */
  public static async sendEmail(payload: GmailSendInput): Promise<GmailSendResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/gmail/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000)
      });

      const json = (await response.json()) as any;
      if (!response.ok) {
        return {
          success: false,
          error: json?.error || `Gmail service returned HTTP ${response.status}`
        };
      }
      return {
        success: true,
        data: json.data || json
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Gmail service request failed: ${err.message}`
      };
    }
  }

  /**
   * Queries bounce suppression status via GET /api/gmail/bounces/check?email=...
   */
  public static async checkBounce(email: string): Promise<GmailBounceCheckResponse> {
    try {
      const url = `${this.baseUrl}/api/gmail/bounces/check?email=${encodeURIComponent(email)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000)
      });

      const json = (await response.json()) as any;
      if (!response.ok) {
        return {
          success: false,
          error: json?.error || `HTTP ${response.status}`
        };
      }
      return {
        success: true,
        data: json.data || json
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Gmail bounce check failed: ${err.message}`
      };
    }
  }

  /**
   * Triggers an inbox DSN bounce scan via POST /api/gmail/bounces/scan
   */
  public static async scanBounces(limit: number = 25): Promise<GmailScanResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/gmail/bounces/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit }),
        signal: AbortSignal.timeout(15000)
      });
      const json = (await response.json()) as any;
      return {
        success: response.ok,
        data: json.data || json,
        error: json?.error
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Health check verifying connectivity
   */
  public static async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
