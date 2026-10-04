import net from 'node:net';
import tls from 'node:tls';
import { config } from '../config/env';
import { Claimant } from '../models/Claimant';
import { GmailService } from './gmailService';

export type EmailProviderType = 'mock' | 'smtp' | 'gmail_service';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  provider: EmailProviderType;
  recipient: string;
  error?: string;
  timestamp: Date;
}

export interface BounceCheckResult {
  eligible: boolean;
  suppressed: boolean;
  reason?: string;
  bounceType?: 'hard' | 'soft' | 'blocked' | 'syntax_error' | 'suppressed';
}

export interface IEmailProvider {
  readonly name: EmailProviderType;
  send(options: SendEmailOptions): Promise<SendEmailResult>;
  checkBounce?(email: string): Promise<BounceCheckResult>;
  verifyConnection?(): Promise<boolean>;
}

/**
 * In-memory Mock Email Provider for testing and local development.
 */
export class MockEmailProvider implements IEmailProvider {
  readonly name: EmailProviderType = 'mock';
  public sentEmails: SendEmailOptions[] = [];

  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    this.sentEmails.push({ ...options });
    const mockId = `<mock-${Date.now()}-${Math.random().toString(36).substring(2, 8)}@juris-banking.local>`;
    return {
      success: true,
      messageId: mockId,
      provider: 'mock',
      recipient: options.to,
      timestamp: new Date()
    };
  }

  async checkBounce(_email: string): Promise<BounceCheckResult> {
    return { eligible: true, suppressed: false };
  }

  async verifyConnection(): Promise<boolean> {
    return true;
  }

  clear(): void {
    this.sentEmails = [];
  }
}

/**
 * Native Socket-based SMTP Email Provider without external npm dependencies.
 */
export class SmtpEmailProvider implements IEmailProvider {
  readonly name: EmailProviderType = 'smtp';
  private host: string;
  private port: number;
  private secure: boolean;
  private user?: string;
  private pass?: string;

  constructor(options?: {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
  }) {
    this.host = options?.host || config.SMTP_HOST || 'localhost';
    this.port = options?.port || config.SMTP_PORT || 587;
    this.secure = options?.secure ?? config.SMTP_SECURE ?? false;
    this.user = options?.user || config.SMTP_USER;
    this.pass = options?.pass || config.SMTP_PASS;
  }

  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    const fromAddr = options.from || config.EMAIL_FROM;
    const fromMatch = fromAddr.match(/<([^>]+)>/);
    const cleanFrom = fromMatch ? fromMatch[1] : fromAddr.trim();

    // In offline test environments or if host is localhost with no listener, wrap gracefully
    return new Promise<SendEmailResult>((resolve) => {
      let resolved = false;
      const done = (result: SendEmailResult) => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };

      try {
        const socket = this.secure
          ? tls.connect({ host: this.host, port: this.port, rejectUnauthorized: false })
          : net.connect({ host: this.host, port: this.port });

        socket.setTimeout(6000);

        let stage = 0;
        let buffer = '';

        const sendCmd = (cmd: string) => {
          socket.write(`${cmd}\r\n`);
        };

        socket.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\r\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const code = parseInt(line.substring(0, 3), 10);
            if (isNaN(code)) continue;

            if (stage === 0 && code === 220) {
              stage = 1;
              sendCmd('EHLO localhost');
            } else if (stage === 1 && (code === 250 || code === 220)) {
              if (this.user && this.pass) {
                stage = 2;
                sendCmd('AUTH LOGIN');
              } else {
                stage = 4;
                sendCmd(`MAIL FROM:<${cleanFrom}>`);
              }
            } else if (stage === 2 && code === 334) {
              stage = 3;
              sendCmd(Buffer.from(this.user!).toString('base64'));
            } else if (stage === 3 && code === 334) {
              stage = 4;
              sendCmd(Buffer.from(this.pass!).toString('base64'));
            } else if (stage === 4 && (code === 235 || code === 250)) {
              stage = 5;
              sendCmd(`MAIL FROM:<${cleanFrom}>`);
            } else if (stage === 5 && code === 250) {
              stage = 6;
              sendCmd(`RCPT TO:<${options.to}>`);
            } else if (stage === 6 && code === 250) {
              stage = 7;
              sendCmd('DATA');
            } else if (stage === 7 && code === 354) {
              stage = 8;
              const dateStr = new Date().toUTCString();
              const msgId = `<smtp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}@${this.host}>`;
              const emailContent = [
                `From: ${fromAddr}`,
                `To: ${options.to}`,
                `Subject: ${options.subject}`,
                `Date: ${dateStr}`,
                `Message-ID: ${msgId}`,
                'MIME-Version: 1.0',
                'Content-Type: text/html; charset=UTF-8',
                '',
                options.html,
                '.'
              ].join('\r\n');
              socket.write(`${emailContent}\r\n`);
            } else if (stage === 8 && code === 250) {
              stage = 9;
              sendCmd('QUIT');
              socket.end();
              done({
                success: true,
                messageId: `<smtp-${Date.now()}@${this.host}>`,
                provider: 'smtp',
                recipient: options.to,
                timestamp: new Date()
              });
            } else if (code >= 400) {
              socket.destroy();
              done({
                success: false,
                error: `SMTP server error ${code}: ${line}`,
                provider: 'smtp',
                recipient: options.to,
                timestamp: new Date()
              });
            }
          }
        });

        socket.on('error', (err) => {
          done({
            success: false,
            error: `SMTP connection failed: ${err.message}`,
            provider: 'smtp',
            recipient: options.to,
            timestamp: new Date()
          });
        });

        socket.on('timeout', () => {
          socket.destroy();
          done({
            success: false,
            error: 'SMTP connection timed out',
            provider: 'smtp',
            recipient: options.to,
            timestamp: new Date()
          });
        });
      } catch (err: any) {
        done({
          success: false,
          error: `SMTP client exception: ${err.message}`,
          provider: 'smtp',
          recipient: options.to,
          timestamp: new Date()
        });
      }
    });
  }

  async verifyConnection(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      try {
        const socket = this.secure
          ? tls.connect({ host: this.host, port: this.port, rejectUnauthorized: false })
          : net.connect({ host: this.host, port: this.port });

        socket.setTimeout(3000);
        socket.on('data', (chunk) => {
          const code = parseInt(chunk.toString().substring(0, 3), 10);
          socket.end();
          resolve(code === 220);
        });
        socket.on('error', () => resolve(false));
        socket.on('timeout', () => {
          socket.destroy();
          resolve(false);
        });
      } catch {
        resolve(false);
      }
    });
  }
}

/**
 * Adapter Provider delegating to dedicated open-source gmail-service.
 */
export class GmailServiceProvider implements IEmailProvider {
  readonly name: EmailProviderType = 'gmail_service';

  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    const res = await GmailService.sendEmail({
      to: options.to,
      subject: options.subject,
      bodyHtml: options.html,
      bodyText: options.text || '',
      cc: Array.isArray(options.cc) ? options.cc.join(', ') : options.cc,
      bcc: Array.isArray(options.bcc) ? options.bcc.join(', ') : options.bcc
    });

    return {
      success: res.success,
      messageId: res.data?.messageId,
      provider: 'gmail_service',
      recipient: options.to,
      error: res.error,
      timestamp: new Date()
    };
  }

  async checkBounce(email: string): Promise<BounceCheckResult> {
    const check = await GmailService.checkBounce(email);
    if (!check.success || !check.data) {
      return { eligible: true, suppressed: false };
    }
    return {
      eligible: !check.data.suppressed,
      suppressed: Boolean(check.data.suppressed),
      reason: check.data.reason,
      bounceType: check.data.bounceType as any
    };
  }

  async verifyConnection(): Promise<boolean> {
    return GmailService.isHealthy();
  }
}

/**
 * 3-Layer Pre-flight Bounce Check:
 * Layer 1: Strict RFC 5322 regex syntax and length validation
 * Layer 2: External Gmail Service suppression registry check (if configured/available, with fail-open safety)
 * Layer 3: Local historical database bounce records check
 */
export async function checkBouncePreflight(email: string): Promise<BounceCheckResult> {
  // Layer 1: Strict RFC 5322 Syntax & Domain Validation
  if (!email || typeof email !== 'string') {
    return {
      eligible: false,
      suppressed: true,
      reason: 'Empty or missing email address',
      bounceType: 'syntax_error'
    };
  }

  const trimmed = email.trim().toLowerCase();
  const EMAIL_REGEX =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  if (!EMAIL_REGEX.test(trimmed) || trimmed.length > 254) {
    return {
      eligible: false,
      suppressed: true,
      reason: `Malformed email syntax: '${email}'`,
      bounceType: 'syntax_error'
    };
  }

  // Layer 2: Gmail Service Suppression Registry (if active or configured)
  if (config.EMAIL_PROVIDER === 'gmail_service') {
    try {
      const bounceRes = await GmailService.checkBounce(trimmed);
      if (bounceRes.success && bounceRes.data?.suppressed) {
        return {
          eligible: false,
          suppressed: true,
          reason: bounceRes.data.reason || 'Email is suppressed in mail delivery registry',
          bounceType: (bounceRes.data.bounceType as any) || 'hard'
        };
      }
    } catch (err: any) {
      // Fail-open policy: If the telemetry service is down, do not fail legitimate claims
      console.warn(`[BouncePreflight] Gmail service bounce check failed, failing open: ${err.message}`);
    }
  }

  // Layer 3: Database Historical Bounce Check
  try {
    const historicalBounce = await Claimant.findOne({
      email: trimmed,
      bounced: true
    })
      .select('_id bounceReason')
      .lean();

    if (historicalBounce) {
      return {
        eligible: false,
        suppressed: true,
        reason: historicalBounce.bounceReason || 'Address previously recorded as bounced in historical case records',
        bounceType: 'suppressed'
      };
    }
  } catch (err: any) {
    console.warn(`[BouncePreflight] DB historical bounce check error: ${err.message}`);
  }

  return {
    eligible: true,
    suppressed: false
  };
}

/**
 * Singleton EmailService orchestrator and transport factory.
 */
export class EmailService {
  private static providerInstance: IEmailProvider | null = null;

  public static getProvider(): IEmailProvider {
    if (!this.providerInstance) {
      this.providerInstance = this.createProvider(config.EMAIL_PROVIDER as EmailProviderType);
    }
    return this.providerInstance;
  }

  public static createProvider(type: EmailProviderType): IEmailProvider {
    switch (type) {
      case 'gmail_service':
        return new GmailServiceProvider();
      case 'smtp':
        return new SmtpEmailProvider({
          host: config.SMTP_HOST,
          port: config.SMTP_PORT,
          secure: config.SMTP_SECURE,
          user: config.SMTP_USER,
          pass: config.SMTP_PASS
        });
      case 'mock':
      default:
        return new MockEmailProvider();
    }
  }

  public static setProvider(provider: IEmailProvider): void {
    this.providerInstance = provider;
  }

  public static resetProvider(): void {
    this.providerInstance = null;
  }

  public static async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    const provider = this.getProvider();
    return provider.send(options);
  }
}
