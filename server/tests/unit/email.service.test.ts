import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EmailService,
  MockEmailProvider,
  SmtpEmailProvider,
  GmailServiceProvider,
  checkBouncePreflight
} from '../../src/services/email.service';
import { GmailService } from '../../src/services/gmailService';
import { Claimant } from '../../src/models/Claimant';

describe('Pluggable Email Service & Bounce Preflight Unit Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('MockEmailProvider', () => {
    it('records sent emails in-memory and returns success result with messageId', async () => {
      const mockProvider = new MockEmailProvider();
      const sendResult = await mockProvider.send({
        to: 'claimant@example.com',
        subject: 'Settlement Notification',
        html: '<p>You have a settlement payment waiting.</p>'
      });

      expect(sendResult.success).toBe(true);
      expect(sendResult.provider).toBe('mock');
      expect(sendResult.recipient).toBe('claimant@example.com');
      expect(sendResult.messageId).toBeDefined();
      expect(mockProvider.sentEmails).toHaveLength(1);
      expect(mockProvider.sentEmails[0].subject).toBe('Settlement Notification');

      mockProvider.clear();
      expect(mockProvider.sentEmails).toHaveLength(0);
    });
  });

  describe('GmailServiceProvider', () => {
    it('delegates delivery to GmailService client adapter', async () => {
      const sendSpy = vi.spyOn(GmailService, 'sendEmail').mockResolvedValueOnce({
        success: true,
        data: { messageId: 'msg-12345', threadId: 'th-99' }
      });

      const provider = new GmailServiceProvider();
      const result = await provider.send({
        to: 'beneficiary@example.com',
        subject: 'Action Required',
        html: '<p>Click link to claim.</p>'
      });

      expect(sendSpy).toHaveBeenCalledOnce();
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-12345');
      expect(result.provider).toBe('gmail_service');
    });

    it('delegates bounce verification to GmailService bounce checker', async () => {
      vi.spyOn(GmailService, 'checkBounce').mockResolvedValueOnce({
        success: true,
        data: {
          email: 'bounced@example.com',
          suppressed: true,
          reason: '550 5.1.1 User unknown',
          bounceType: 'hard'
        }
      });

      const provider = new GmailServiceProvider();
      const checkResult = await provider.checkBounce('bounced@example.com');
      expect(checkResult.eligible).toBe(false);
      expect(checkResult.suppressed).toBe(true);
      expect(checkResult.bounceType).toBe('hard');
    });
  });

  describe('SmtpEmailProvider', () => {
    it('fails gracefully when connecting to unavailable SMTP server without crashing process', async () => {
      const smtpProvider = new SmtpEmailProvider({
        host: '127.0.0.1',
        port: 65530, // Unused port
        secure: false
      });

      const result = await smtpProvider.send({
        to: 'user@example.com',
        subject: 'Test SMTP',
        html: '<p>Hello</p>'
      });

      expect(result.success).toBe(false);
      expect(result.provider).toBe('smtp');
      expect(result.error).toBeDefined();
    });
  });

  describe('EmailService Factory', () => {
    it('instantiates appropriate provider based on type', () => {
      const mock = EmailService.createProvider('mock');
      expect(mock.name).toBe('mock');

      const smtp = EmailService.createProvider('smtp');
      expect(smtp.name).toBe('smtp');

      const gmail = EmailService.createProvider('gmail_service');
      expect(gmail.name).toBe('gmail_service');
    });

    it('allows runtime switching of singleton provider', async () => {
      const customMock = new MockEmailProvider();
      EmailService.setProvider(customMock);
      expect(EmailService.getProvider()).toBe(customMock);

      await EmailService.sendEmail({
        to: 'test@example.com',
        subject: 'Testing Factory',
        html: '<b>Body</b>'
      });
      expect(customMock.sentEmails).toHaveLength(1);
    });
  });

  describe('3-Layer Pre-flight Bounce Check (checkBouncePreflight)', () => {
    it('Layer 1: rejects empty, non-string, or malformed email syntax', async () => {
      const emptyRes = await checkBouncePreflight('');
      expect(emptyRes.eligible).toBe(false);
      expect(emptyRes.bounceType).toBe('syntax_error');

      const badSyntaxRes = await checkBouncePreflight('not-an-email-address');
      expect(badSyntaxRes.eligible).toBe(false);
      expect(badSyntaxRes.bounceType).toBe('syntax_error');

      const longEmail = `${'a'.repeat(250)}@example.com`;
      const longRes = await checkBouncePreflight(longEmail);
      expect(longRes.eligible).toBe(false);
      expect(longRes.bounceType).toBe('syntax_error');
    });

    it('Layer 3: rejects emails with historical bounce records in Claimant database', async () => {
      vi.spyOn(Claimant, 'findOne').mockReturnValueOnce({
        select: vi.fn().mockReturnValueOnce({
          lean: vi.fn().mockResolvedValueOnce({
            _id: 'clm-id-1',
            bounceReason: '550 Recipient mailbox not found'
          })
        })
      } as any);

      const res = await checkBouncePreflight('prior.bounced@domain.com');
      expect(res.eligible).toBe(false);
      expect(res.suppressed).toBe(true);
      expect(res.bounceType).toBe('suppressed');
      expect(res.reason).toContain('550 Recipient mailbox not found');
    });

    it('passes clean, syntactically valid emails not flagged as bounced', async () => {
      vi.spyOn(Claimant, 'findOne').mockReturnValueOnce({
        select: vi.fn().mockReturnValueOnce({
          lean: vi.fn().mockResolvedValueOnce(null)
        })
      } as any);

      const res = await checkBouncePreflight('clean.claimant@example.com');
      expect(res.eligible).toBe(true);
      expect(res.suppressed).toBe(false);
    });
  });
});
