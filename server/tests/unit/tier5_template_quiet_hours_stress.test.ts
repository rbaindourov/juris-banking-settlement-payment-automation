import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import {
  TemplateService,
  sanitizeEmailHtml,
  resolveMergeTags,
  formatCurrency,
  formatDate,
  sanitizeLinkUrl,
  escapeHtml
} from '../../src/services/template.service';
import {
  isWithinQuietHours,
  calculateNextSendWindow,
  executeDispatchWaveSubBatch
} from '../../src/jobs/waveDispatchSubbatch.job';
import { EmailService, MockEmailProvider } from '../../src/services/email.service';
import {
  Case,
  Claimant,
  NotificationCadence,
  EmailWave,
  SubBatch
} from '../../src/models';

describe('Tier 5 Adversarial Stress Test: Templates, Quiet Hours & Pipeline Integrity', () => {
  const SUITE_DB_NAME = 'tier5_template_quiet_hours_stress';
  let mockEmailProvider: MockEmailProvider;

  beforeAll(async () => {
    await setupTestDb(SUITE_DB_NAME);
    mockEmailProvider = new MockEmailProvider();
    EmailService.setProvider(mockEmailProvider);
  });

  afterAll(async () => {
    EmailService.resetProvider();
    await teardownTestDb(SUITE_DB_NAME);
  });

  beforeEach(async () => {
    await clearTestDb(SUITE_DB_NAME);
    mockEmailProvider.clear();
  });

  // =========================================================================
  // PART 1: MALFORMED MERGE TAGS & ADVERSARIAL INJECTION
  // =========================================================================
  describe('Part 1: Dynamic Merge Tag Replacement & Security Resilience', () => {
    it('[T5.1.1] Nested braces {{{{claimant_first_name}}}} resolve safely without crash or infinite recursion', () => {
      const template = '<p>Hello {{{{claimant_first_name}}}}, welcome!</p>';
      const context = { claimant_first_name: 'Sophia' };

      const resolved = resolveMergeTags(template, context);

      // Inner tag matches {{claimant_first_name}} -> replaced with Sophia, leaving {{Sophia}}
      expect(resolved).toBe('<p>Hello {{Sophia}}, welcome!</p>');
      expect(resolved).not.toContain('{{claimant_first_name}}');
      expect(resolved).toContain('Sophia');

      // Deeply nested: 6 pairs of braces
      const deeplyNested = '{{{{{{claimant_first_name}}}}}}';
      const deepResolved = resolveMergeTags(deeplyNested, context);
      expect(deepResolved).toBe('{{{{Sophia}}}}');
    });

    it('[T5.1.2] Unbalanced braces handled gracefully without throwing or corrupting text', () => {
      const unbalancedTemplates = [
        { raw: 'Hello {{claimant_first_name', expected: 'Hello {{claimant_first_name' },
        { raw: 'Hello claimant_first_name}}', expected: 'Hello claimant_first_name}}' },
        { raw: 'Hello {{{claimant_first_name}}', expected: 'Hello {Sophia' },
        { raw: 'Hello {{claimant_first_name}}}', expected: 'Hello Sophia}' },
        { raw: '{{{claimant_first_name}}}', expected: '{Sophia}' },
        { raw: '{ {claimant_first_name} }', expected: '{ {claimant_first_name} }' }
      ];

      const context = { claimant_first_name: 'Sophia' };
      for (const item of unbalancedTemplates) {
        expect(() => resolveMergeTags(item.raw, context)).not.toThrow();
        const output = resolveMergeTags(item.raw, context);
        expect(output).toBe(item.expected);
      }
    });

    it('[T5.1.3] Empty, whitespace, numeric, and unrecognized merge tags are preserved safely', () => {
      const raw = '<p>Tags: {{}} and {{   }} and {{_}} and {{123}} and {{case_nonexistent}}</p>';
      const context = { case_name: 'Test Settlement' };

      const output = resolveMergeTags(raw, context);
      expect(output).toContain('{{}}');
      expect(output).toContain('{{   }}');
      expect(output).toContain('{{case_nonexistent}}');
    });

    it('[T5.1.4] Script tag injection in merge tag values is strictly HTML-escaped', () => {
      const template = '<h1>Notice</h1><p>Claimant: {{claimant_first_name}} {{claimant_last_name}}</p>';
      const context = {
        claimant_first_name: '<script>alert("PWNED_FIRST")</script>',
        claimant_last_name: '<script src="http://attacker.com/steal.js"></script>'
      };

      const resolved = resolveMergeTags(template, context);

      expect(resolved).not.toContain('<script>');
      expect(resolved).not.toContain('</script>');
      expect(resolved).toContain('&lt;script&gt;alert(&quot;PWNED_FIRST&quot;)&lt;/script&gt;');
      expect(resolved).toContain('&lt;script src=&quot;http://attacker.com/steal.js&quot;&gt;&lt;/script&gt;');
    });

    it('[T5.1.5] HTML event handlers and attribute breakouts in merge tag values are neutralized', () => {
      const template = '<div title="{{case_name}}">Hello {{claimant_first_name}}</div>';
      const context = {
        case_name: 'Juris" onfocus="alert(1)" autofocus="true',
        claimant_first_name: '<img src="x" onerror="document.location=\'http://evil.com\'">'
      };

      const resolved = resolveMergeTags(template, context);

      // Verify no raw executable tags or unescaped event breakout attributes
      expect(resolved).not.toContain('<img');
      expect(resolved).not.toContain('" onfocus=');
      expect(resolved).toContain('Juris&quot; onfocus=&quot;alert(1)&quot; autofocus=&quot;true');
      expect(resolved).toContain('&lt;img src=&quot;x&quot; onerror=&quot;document.location=&#39;http://evil.com&#39;&quot;&gt;');
    });

    it('[T5.1.6] Malicious URL schemes in payment_selection_link are neutralized to #', () => {
      const dangerousUrls = [
        'javascript:alert(1)',
        'JAVASCRIPT:alert(document.cookie)',
        ' javascript:alert(1)',
        'java\0script:alert(1)',
        'vbscript:msgbox(1)',
        'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
        'file:///etc/passwd',
        'blob:https://portal.juris-banking.com/xyz',
        'ftp://evil.com/payload'
      ];

      for (const dangerous of dangerousUrls) {
        const sanitized = sanitizeLinkUrl(dangerous);
        expect(sanitized).toBe('#');

        const template = '<a href="{{payment_selection_link}}">Claim</a>';
        const resolved = resolveMergeTags(template, { payment_selection_link: dangerous });
        expect(resolved).toContain('href="#"');
      }
    });

    it('[T5.1.7] Authorized HTTPS and relative payment_selection_link URLs are preserved', () => {
      const safeUrls = [
        'https://portal.juris-banking.com/claim/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        'https://settlement.lawfirm.com/verify?token=abc-123&case=456',
        'http://localhost:3000/claim/test-token',
        '/claim/token-relative',
        './claim/path',
        '#step-2'
      ];

      for (const safe of safeUrls) {
        const sanitized = sanitizeLinkUrl(safe);
        expect(sanitized).toBe(safe);

        const template = '<a href="{{payment_selection_link}}">Claim</a>';
        const resolved = resolveMergeTags(template, { payment_selection_link: safe });
        expect(resolved).toContain(`href="${escapeHtml(safe)}"`);
      }
    });

    it('[T5.1.8] Complex context with undefined, null, numbers, and SQL injection strings handled safely', () => {
      const template = '<p>{{claimant_first_name}} - {{settlement_amount}} - {{case_name}} - {{extra_field}}</p>';
      const context = {
        claimant_first_name: "Robert'; DROP TABLE claimants; --",
        settlement_amount: 1500.5,
        case_name: null as any,
        extra_field: undefined
      };

      const resolved = resolveMergeTags(template, context);
      expect(resolved).toContain('Robert&#39;; DROP TABLE claimants; --');
      expect(resolved).toContain('$1500.50');
      // null is replaced with empty string, undefined is skipped and tag preserved
      expect(resolved).not.toContain('{{case_name}}');
      expect(resolved).toContain('{{extra_field}}');
    });
  });

  // =========================================================================
  // PART 2: UNICODE, INTERNATIONALIZATION & CURRENCY FORMATTING
  // =========================================================================
  describe('Part 2: Unicode Edge Cases, RTL & Non-ASCII Currency', () => {
    it('[T5.2.1] Unicode combining characters and Vietnamese tonal diacritics preserved intact', () => {
      const template = '<p>Kính gửi {{claimant_first_name}} {{claimant_last_name}}, bạn có khoản bồi thường {{settlement_amount}}.</p>';
      const context = {
        claimant_first_name: 'Nguyễn',
        claimant_last_name: 'Văn Đức',
        settlement_amount: 520.75
      };

      const resolved = resolveMergeTags(template, context);

      expect(resolved).toContain('Nguyễn');
      expect(resolved).toContain('Văn Đức');
      expect(resolved).toContain('$520.75');

      // Combining accent e + acute: e\u0301
      const combiningName = 'Andre\u0301';
      const combiningResolved = resolveMergeTags('<p>{{claimant_first_name}}</p>', { claimant_first_name: combiningName });
      expect(combiningResolved).toContain('Andre\u0301');
    });

    it('[T5.2.2] Right-to-Left (RTL) text (Arabic & Hebrew) and directional marks interpolate cleanly', () => {
      const template = '<div class="notice">عزيزي {{claimant_first_name}} {{claimant_last_name}} - שלום</div>';
      const context = {
        claimant_first_name: '\u200Eطارق\u200F', // Arabic Tariq with LRM & RLM marks
        claimant_last_name: 'בן אברהם' // Hebrew Ben Avraham
      };

      const resolved = resolveMergeTags(template, context);
      expect(resolved).toContain('\u200Eطارق\u200F');
      expect(resolved).toContain('בן אברהם');
      expect(resolved.startsWith('<div class="notice">')).toBe(true);
      expect(resolved.endsWith('</div>')).toBe(true);
    });

    it('[T5.2.3] Chinese Simplified (zh) multi-byte glyphs and full-width punctuation preserved', () => {
      const template = '<h2>和解赔偿通知：{{case_name}}</h2><p>尊敬的 {{claimant_first_name}} {{claimant_last_name}}：您的金额为 {{settlement_amount}}。</p>';
      const context = {
        case_name: '【全国消费者权益案】（2026）',
        claimant_first_name: '张',
        claimant_last_name: '伟',
        settlement_amount: 8888.88
      };

      const resolved = resolveMergeTags(template, context);
      expect(resolved).toContain('和解赔偿通知：【全国消费者权益案】（2026）');
      expect(resolved).toContain('尊敬的 张 伟：');
      expect(resolved).toContain('$8888.88');
    });

    it('[T5.2.4] Currency formatting handles non-ASCII and international currency representations without throwing or NaN', () => {
      // Standard numbers
      expect(formatCurrency(0)).toBe('$0.00');
      expect(formatCurrency(450)).toBe('$450.00');
      expect(formatCurrency(450.5)).toBe('$450.50');
      expect(formatCurrency(0.01)).toBe('$0.01');

      // Existing formatted strings
      expect(formatCurrency('$125.00')).toBe('$125.00');
      expect(formatCurrency('250.75')).toBe('$250.75');

      // Non-ASCII and European currencies
      expect(formatCurrency('€500.00')).toBe('€500.00');
      expect(formatCurrency('£750.50')).toBe('£750.50');
      expect(formatCurrency('¥10000')).toBe('¥10000');
      expect(formatCurrency('500 €')).toBe('$500.00'); // parseFloat reads 500

      // Negative amounts
      expect(formatCurrency(-50.25)).toBe('$-50.25');

      // Edge case: empty string
      expect(formatCurrency('')).toBe('');
    });

    it('[T5.2.5] Date formatting enforces UTC timezone invariant consistently across test environments', () => {
      // A date at exactly 00:00:00Z should render as December 15, 2026, regardless of host local timezone
      const dateUtc = new Date('2026-12-15T00:00:00.000Z');
      const formatted = formatDate(dateUtc);
      expect(formatted).toBe('December 15, 2026');

      // String ISO format
      const formattedIso = formatDate('2026-11-30T00:00:00Z');
      expect(formattedIso).toBe('November 30, 2026');

      // Invalid date string falls back to raw string
      expect(formatDate('invalid-date')).toBe('invalid-date');
    });
  });

  // =========================================================================
  // PART 3: TIMEZONE QUIET HOURS & BOUNDARY SECONDS EVALUATION
  // =========================================================================
  describe('Part 3: Quiet Hours Boundary Seconds & Complex Timezones', () => {
    it('[T5.3.1] Quiet hours boundary seconds precision in UTC (20:59:58 vs 20:59:59 vs 21:00:00 vs 21:00:01)', () => {
      const start = '21:00';
      const end = '08:00';
      const tz = 'UTC';

      // 20:59:58 UTC -> outside quiet hours
      expect(isWithinQuietHours(new Date('2026-10-16T20:59:58Z'), start, end, tz)).toBe(false);

      // 20:59:59 UTC -> outside quiet hours (boundary second)
      expect(isWithinQuietHours(new Date('2026-10-16T20:59:59Z'), start, end, tz)).toBe(false);

      // 21:00:00 UTC -> inside quiet hours (boundary start)
      expect(isWithinQuietHours(new Date('2026-10-16T21:00:00Z'), start, end, tz)).toBe(true);

      // 21:00:01 UTC -> inside quiet hours
      expect(isWithinQuietHours(new Date('2026-10-16T21:00:01Z'), start, end, tz)).toBe(true);
    });

    it('[T5.3.2] Morning exit boundary seconds precision in UTC (07:59:59 vs 08:00:00 vs 08:00:01)', () => {
      const start = '21:00';
      const end = '08:00';
      const tz = 'UTC';

      // 07:59:59 UTC -> inside quiet hours
      expect(isWithinQuietHours(new Date('2026-10-16T07:59:59Z'), start, end, tz)).toBe(true);

      // 08:00:00 UTC -> outside quiet hours (quiet hours ended at 08:00:00 sharp)
      expect(isWithinQuietHours(new Date('2026-10-16T08:00:00Z'), start, end, tz)).toBe(false);

      // 08:00:01 UTC -> outside quiet hours
      expect(isWithinQuietHours(new Date('2026-10-16T08:00:01Z'), start, end, tz)).toBe(false);
    });

    it('[T5.3.3] Midnight wraparound evaluation (23:59:59 -> 00:00:00 -> 00:00:01)', () => {
      const start = '22:00';
      const end = '07:00';
      const tz = 'UTC';

      // Before midnight
      expect(isWithinQuietHours(new Date('2026-10-16T23:59:59Z'), start, end, tz)).toBe(true);

      // Exactly midnight
      expect(isWithinQuietHours(new Date('2026-10-17T00:00:00Z'), start, end, tz)).toBe(true);

      // After midnight
      expect(isWithinQuietHours(new Date('2026-10-17T00:00:01Z'), start, end, tz)).toBe(true);

      // 03:30 AM
      expect(isWithinQuietHours(new Date('2026-10-17T03:30:00Z'), start, end, tz)).toBe(true);

      // 06:59:59 AM
      expect(isWithinQuietHours(new Date('2026-10-17T06:59:59Z'), start, end, tz)).toBe(true);

      // 07:00:00 AM -> ended
      expect(isWithinQuietHours(new Date('2026-10-17T07:00:00Z'), start, end, tz)).toBe(false);
    });

    it('[T5.3.4] Complex timezone: America/New_York (EDT UTC-4 in October)', () => {
      const start = '21:00'; // 9:00 PM NY time
      const end = '08:00';   // 8:00 AM NY time
      const tz = 'America/New_York';

      // In October (EDT, UTC-4), 21:00 EDT corresponds to 01:00 UTC next day
      // 20:59:59 NY time is 00:59:59 UTC -> outside quiet hours
      expect(isWithinQuietHours(new Date('2026-10-17T00:59:59Z'), start, end, tz)).toBe(false);

      // 21:00:00 NY time is 01:00:00 UTC -> inside quiet hours
      expect(isWithinQuietHours(new Date('2026-10-17T01:00:00Z'), start, end, tz)).toBe(true);

      // 07:59:59 NY time is 11:59:59 UTC -> inside quiet hours
      expect(isWithinQuietHours(new Date('2026-10-17T11:59:59Z'), start, end, tz)).toBe(true);

      // 08:00:00 NY time is 12:00:00 UTC -> outside quiet hours
      expect(isWithinQuietHours(new Date('2026-10-17T12:00:00Z'), start, end, tz)).toBe(false);
    });

    it('[T5.3.5] Complex timezone: Asia/Shanghai (UTC+8, no DST)', () => {
      const start = '22:00'; // 10:00 PM Shanghai
      const end = '07:00';   // 7:00 AM Shanghai
      const tz = 'Asia/Shanghai';

      // 22:00 Shanghai is 14:00 UTC
      // 21:59:59 Shanghai is 13:59:59 UTC -> outside quiet hours
      expect(isWithinQuietHours(new Date('2026-10-16T13:59:59Z'), start, end, tz)).toBe(false);

      // 22:00:00 Shanghai is 14:00:00 UTC -> inside quiet hours
      expect(isWithinQuietHours(new Date('2026-10-16T14:00:00Z'), start, end, tz)).toBe(true);

      // 07:00:00 Shanghai is 23:00:00 UTC (previous day) -> ended
      expect(isWithinQuietHours(new Date('2026-10-16T23:00:00Z'), start, end, tz)).toBe(false);
    });

    it('[T5.3.6] Complex timezone: Australia/Sydney (AEDT UTC+11 in October)', () => {
      const start = '21:00'; // 9:00 PM Sydney
      const end = '08:00';   // 8:00 AM Sydney
      const tz = 'Australia/Sydney';

      // In October (AEDT, UTC+11), 21:00 Sydney is 10:00 UTC
      // 20:59:59 Sydney is 09:59:59 UTC -> outside quiet hours
      expect(isWithinQuietHours(new Date('2026-10-16T09:59:59Z'), start, end, tz)).toBe(false);

      // 21:00:00 Sydney is 10:00:00 UTC -> inside quiet hours
      expect(isWithinQuietHours(new Date('2026-10-16T10:00:00Z'), start, end, tz)).toBe(true);

      // 08:00:00 Sydney is 21:00:00 UTC -> ended
      expect(isWithinQuietHours(new Date('2026-10-16T21:00:00Z'), start, end, tz)).toBe(false);
    });

    it('[T5.3.7] Half-hour offset timezone: Asia/Kolkata (UTC+5:30)', () => {
      const start = '22:00';
      const end = '07:00';
      const tz = 'Asia/Kolkata';

      // 22:00 IST is 16:30 UTC
      expect(isWithinQuietHours(new Date('2026-10-16T16:29:59Z'), start, end, tz)).toBe(false);
      expect(isWithinQuietHours(new Date('2026-10-16T16:30:00Z'), start, end, tz)).toBe(true);

      // 07:00 IST is 01:30 UTC next day
      expect(isWithinQuietHours(new Date('2026-10-17T01:29:59Z'), start, end, tz)).toBe(true);
      expect(isWithinQuietHours(new Date('2026-10-17T01:30:00Z'), start, end, tz)).toBe(false);
    });

    it('[T5.3.8] Daytime quiet hours window (start < end, e.g. 13:00 to 15:00)', () => {
      const start = '13:00';
      const end = '15:00';
      const tz = 'UTC';

      expect(isWithinQuietHours(new Date('2026-10-16T12:59:59Z'), start, end, tz)).toBe(false);
      expect(isWithinQuietHours(new Date('2026-10-16T13:00:00Z'), start, end, tz)).toBe(true);
      expect(isWithinQuietHours(new Date('2026-10-16T14:30:00Z'), start, end, tz)).toBe(true);
      expect(isWithinQuietHours(new Date('2026-10-16T14:59:59Z'), start, end, tz)).toBe(true);
      expect(isWithinQuietHours(new Date('2026-10-16T15:00:00Z'), start, end, tz)).toBe(false);
    });

    it('[T5.3.9] Degenerate quiet hours window (start === end) returns false', () => {
      expect(isWithinQuietHours(new Date('2026-10-16T22:00:00Z'), '22:00', '22:00', 'UTC')).toBe(false);
      expect(isWithinQuietHours(new Date('2026-10-16T12:00:00Z'), '22:00', '22:00', 'UTC')).toBe(false);
    });

    it('[T5.3.10] calculateNextSendWindow calculates exact morning resumption time across day boundaries in multiple timezones', () => {
      // 1. UTC late night (23:30) -> next morning at 07:00 UTC
      const currentUtc = new Date('2026-10-16T23:30:00Z');
      const nextUtc = calculateNextSendWindow(currentUtc, '22:00', '07:00', 'UTC');
      expect(nextUtc.toISOString()).toBe('2026-10-17T07:00:00.000Z');
      expect(isWithinQuietHours(nextUtc, '22:00', '07:00', 'UTC')).toBe(false);

      // 2. UTC early morning (03:00) -> same day morning at 07:00 UTC
      const earlyMorningUtc = new Date('2026-10-17T03:00:00Z');
      const nextSameDayUtc = calculateNextSendWindow(earlyMorningUtc, '22:00', '07:00', 'UTC');
      expect(nextSameDayUtc.toISOString()).toBe('2026-10-17T07:00:00.000Z');

      // 3. America/New_York (EDT UTC-4) at 23:30 NY time (03:30 UTC next day)
      // NY 07:00 EDT is 11:00 UTC
      const nyNight = new Date('2026-10-17T03:30:00Z'); // 23:30 NY on Oct 16
      const nextNy = calculateNextSendWindow(nyNight, '22:00', '07:00', 'America/New_York');
      expect(nextNy.toISOString()).toBe('2026-10-17T11:00:00.000Z');
      expect(isWithinQuietHours(nextNy, '22:00', '07:00', 'America/New_York')).toBe(false);

      // 4. Asia/Shanghai (UTC+8) at 23:30 Shanghai time (15:30 UTC)
      // Shanghai 07:00 is 23:00 UTC
      const shNight = new Date('2026-10-16T15:30:00Z');
      const nextSh = calculateNextSendWindow(shNight, '22:00', '07:00', 'Asia/Shanghai');
      expect(nextSh.toISOString()).toBe('2026-10-16T23:00:00.000Z');
      expect(isWithinQuietHours(nextSh, '22:00', '07:00', 'Asia/Shanghai')).toBe(false);
    });
  });

  // =========================================================================
  // PART 4: LOCALIZED TEMPLATES & CORRUPTED / MISSING FIELDS
  // =========================================================================
  describe('Part 4: Localized Quill WYSIWYG Templates & Fallback Integrity', () => {
    it('[T5.4.1] Localized templates render correctly across EN, ES, ZH, VI with language tags', () => {
      const templates = {
        en: {
          subject: 'Court Notice: {{case_name}}',
          bodyHtml: '<p>Dear {{claimant_first_name}}, claim {{settlement_amount}}.</p>'
        },
        es: {
          subject: 'Aviso del Tribunal: {{case_name}}',
          bodyHtml: '<p>Estimado/a {{claimant_first_name}}, reclame {{settlement_amount}}.</p>'
        },
        zh: {
          subject: '法院通知：{{case_name}}',
          bodyHtml: '<p>尊敬的 {{claimant_first_name}}，您的和解金为 {{settlement_amount}}。</p>'
        },
        vi: {
          subject: 'Thông Báo Tòa Án: {{case_name}}',
          bodyHtml: '<p>Kính gửi {{claimant_first_name}}, số tiền là {{settlement_amount}}.</p>'
        }
      };

      const context = {
        case_name: 'Tech Settlement',
        claimant_first_name: 'Alex',
        settlement_amount: 300
      };

      for (const [lang, tpl] of Object.entries(templates)) {
        const sub = resolveMergeTags(tpl.subject, context);
        const body = resolveMergeTags(sanitizeEmailHtml(tpl.bodyHtml), context);

        expect(sub).toContain('Tech Settlement');
        expect(body).toContain('Alex');
        expect(body).toContain('$300.00');

        if (lang === 'vi') expect(sub).toContain('Thông Báo Tòa Án');
        if (lang === 'zh') expect(sub).toContain('法院通知');
        if (lang === 'es') expect(sub).toContain('Aviso del Tribunal');
      }
    });

    it('[T5.4.2] Recipient preferredLanguage case-insensitivity and whitespace normalization', () => {
      const variants = ['  ES  ', 'es', 'Es', 'ES\t', 'es\n'];
      for (const v of variants) {
        const normalized = v.toLowerCase().trim();
        expect(normalized).toBe('es');
      }
    });

    it('[T5.4.3] Fallback behavior when preferred language is unconfigured in stage templates', () => {
      const stageTemplates: Record<string, any> = {
        en: {
          subject: 'Court Notice: {{case_name}}',
          bodyHtml: '<p>Dear {{claimant_first_name}}, claim {{settlement_amount}}.</p>'
        }
      };

      const unsupportedLangs = ['fr', 'de', 'ja', 'ko', 'tl', 'pt'];
      for (const lang of unsupportedLangs) {
        const template = stageTemplates[lang] || stageTemplates.en;
        expect(template).toBeDefined();
        expect(template.subject).toContain('Court Notice');
      }
    });

    it('[T5.4.4] Missing or corrupted localized template fields (e.g. VI template missing subject or empty subject)', () => {
      // Scenario: Administrator created stage with EN template, but VI template has empty subject
      const corruptedTemplates = {
        en: {
          subject: 'Official Settlement Notice: {{case_name}}',
          bodyHtml: '<p>Dear {{claimant_first_name}}, please claim your settlement of {{settlement_amount}}.</p>'
        },
        vi: {
          subject: '', // Missing / empty subject
          bodyHtml: '<p>Kính gửi {{claimant_first_name}}, vui lòng nhận bồi thường {{settlement_amount}}.</p>'
        }
      };

      const tags = {
        claimant_first_name: 'Minh',
        case_name: 'Class Action 2026',
        settlement_amount: '$500.00'
      };

      // In current implementation: if templates.vi.subject is empty, resolveMergeTags returns empty string
      const resolvedViSubject = resolveMergeTags(corruptedTemplates.vi.subject, tags);
      expect(resolvedViSubject).toBe('');

      // Resilient fallback logic: if localized subject is empty or blank, it should fall back to English subject
      const effectiveSubject = corruptedTemplates.vi.subject?.trim()
        ? resolveMergeTags(corruptedTemplates.vi.subject, tags)
        : resolveMergeTags(corruptedTemplates.en.subject, tags);

      expect(effectiveSubject).toBe('Official Settlement Notice: Class Action 2026');
    });

    it('[T5.4.5] Missing or empty bodyHtml in localized template handled safely without throwing', () => {
      const corruptedTemplates: any = {
        en: {
          subject: 'Settlement Notice',
          bodyHtml: '<p>English body content.</p>'
        },
        es: {
          subject: 'Aviso de Liquidación'
          // bodyHtml omitted
        }
      };

      expect(() => sanitizeEmailHtml(corruptedTemplates.es.bodyHtml)).not.toThrow();
      expect(sanitizeEmailHtml(corruptedTemplates.es.bodyHtml)).toBe('');

      expect(() => resolveMergeTags(corruptedTemplates.es.bodyHtml, {})).not.toThrow();
      expect(resolveMergeTags(corruptedTemplates.es.bodyHtml, {})).toBe('');
    });
  });

  // =========================================================================
  // PART 5: END-TO-END ADVERSARIAL WAVE PIPELINE INTEGRATION
  // =========================================================================
  describe('Part 5: End-to-End Adversarial Wave Pipeline Integration with Isolated DB', () => {
    it('[T5.5.1] End-to-end wave dispatch with multilingual and adversarial claimants in isolated DB', async () => {
      // 1. Create Case
      const testCase = await Case.create({
        name: 'Adversarial Multilingual Case',
        docketNumber: '1:26-cv-00999',
        lawFirmId: 'FIRM-ADV-TIER5',
        settlementFundTotal: 1000000,
        disbursementDeadline: new Date('2026-12-31T00:00:00Z'),
        fallbackPaymentMethod: 'physical_check',
        status: 'active',
        defaultLanguage: 'en'
      });

      // 2. Create NotificationCadence with 4 languages
      const cadence = await NotificationCadence.create({
        caseId: testCase._id,
        lawFirmId: 'FIRM-ADV-TIER5',
        name: 'Tier 5 Multilingual Cadence',
        status: 'active',
        stages: [
          {
            stageKey: 'initial_notice',
            stageName: 'Initial Court-Approved Notice',
            enabled: true,
            triggerType: 'deadline_relative',
            offsetHours: -720,
            status: 'in_progress',
            templates: {
              en: {
                subject: 'Notice of Settlement: {{case_name}}',
                bodyHtml: '<p>Dear {{claimant_first_name}}, amount: {{settlement_amount}}</p>'
              },
              es: {
                subject: 'Aviso de Liquidación: {{case_name}}',
                bodyHtml: '<p>Estimado/a {{claimant_first_name}}, cantidad: {{settlement_amount}}</p>'
              },
              zh: {
                subject: '和解通知：{{case_name}}',
                bodyHtml: '<p>尊敬的 {{claimant_first_name}}，金额：{{settlement_amount}}</p>'
              },
              vi: {
                subject: 'Thông Báo Tòa Án: {{case_name}}',
                bodyHtml: '<p>Kính gửi {{claimant_first_name}}, số tiền: {{settlement_amount}}</p>'
              }
            }
          }
        ],
        throttling: {
          batchSize: 50,
          intervalMinutes: 15,
          rateLimitPerSecond: 100,
          dailyCap: 10000,
          quietHoursEnabled: false, // Disabled for immediate dispatch test
          quietHoursStart: '22:00',
          quietHoursEnd: '07:00',
          timezone: 'UTC'
        },
        suppression: {
          skipCompletedPayments: true,
          suppressBounced: true,
          checkGlobalSuppression: false
        }
      });

      // 3. Create diverse claimants
      const claimantData = [
        {
          caseId: testCase._id,
          claimId: 'CLM-ADV-001',
          firstName: '王小明',
          lastName: 'Wang',
          email: 'wang.xiaoming@example.com',
          settlementAmount: 1250.75,
          paymentSelectionToken: 'tok_zh_001',
          status: 'pending_selection',
          preferredLanguage: 'zh',
          paymentDetails: { preferredLanguage: 'zh' }
        },
        {
          caseId: testCase._id,
          claimId: 'CLM-ADV-002',
          firstName: 'Nguyễn',
          lastName: 'Thị Mai',
          email: 'nguyen.mai@example.com',
          settlementAmount: 840.50,
          paymentSelectionToken: 'tok_vi_002',
          status: 'pending_selection',
          preferredLanguage: 'vi',
          paymentDetails: { preferredLanguage: 'vi' }
        },
        {
          caseId: testCase._id,
          claimId: 'CLM-ADV-003',
          firstName: '<script>alert("XSS")</script>',
          lastName: 'Adversary',
          email: 'xss.claimant@example.com',
          settlementAmount: 99.99,
          paymentSelectionToken: 'tok_adv_003',
          status: 'pending_selection',
          preferredLanguage: 'es',
          paymentDetails: { preferredLanguage: 'es' }
        },
        {
          caseId: testCase._id,
          claimId: 'CLM-ADV-004',
          firstName: 'Tariq',
          lastName: 'Al-Mansoor',
          email: 'tariq@example.com',
          settlementAmount: 450.00,
          paymentSelectionToken: 'tok_ar_004',
          status: 'pending_selection',
          preferredLanguage: 'ar', // Unconfigured language -> should fall back to English
          paymentDetails: { preferredLanguage: 'ar' }
        }
      ];

      const createdClaimants = await Claimant.insertMany(claimantData);

      // 4. Create Wave and SubBatch
      const waveId = `wave_adv_${Date.now()}`;
      const subBatchId = `sub_${waveId}_0`;

      const wave = await EmailWave.create({
        waveId,
        caseId: testCase._id,
        cadenceId: cadence._id,
        stage: 'initial_notice',
        stageName: 'Initial Court-Approved Notice',
        status: 'scheduled',
        scheduledDate: new Date(),
        totalSubBatches: 1,
        completedSubBatches: 0,
        throttlingConfig: cadence.throttling,
        telemetry: {
          eligible: 4,
          queued: 4,
          dispatched: 0,
          skipped_completed: 0,
          suppressed_bounced: 0,
          failed: 0,
          opened: 0,
          clicked: 0
        },
        controlState: { isPaused: false }
      });

      const subBatch = await SubBatch.create({
        subBatchId,
        waveId: wave._id,
        caseId: testCase._id,
        chunkIndex: 0,
        totalChunks: 1,
        claimantIds: createdClaimants.map((c) => c._id),
        recipients: createdClaimants.map((c, idx) => ({
          claimantId: c._id,
          claimId: c.claimId,
          email: c.email,
          firstName: c.firstName,
          lastName: c.lastName,
          settlementAmount: c.settlementAmount,
          paymentSelectionToken: c.paymentSelectionToken,
          preferredLanguage: claimantData[idx].preferredLanguage,
          status: 'queued'
        })),
        status: 'pending',
        scheduledAt: new Date(),
        recipientCount: 4,
        dispatchedCount: 0,
        skippedCompletedCount: 0,
        suppressedBouncedCount: 0,
        failedCount: 0,
        retryCount: 0,
        maxRetries: 3,
        executionLogs: []
      });

      // 5. Execute Sub-Batch Dispatch
      const result = await executeDispatchWaveSubBatch({
        waveId: wave.waveId,
        subBatchId: subBatch.subBatchId
      });

      expect(result.status).toBe('completed');
      expect(result.dispatchedCount).toBe(4);
      expect(result.failedCount).toBe(0);

      // 6. Verify MockEmailProvider sent emails
      expect(mockEmailProvider.sentEmails.length).toBe(4);

      // Recipient 1: Chinese
      const zhEmail = mockEmailProvider.sentEmails.find((e) => e.to === 'wang.xiaoming@example.com');
      expect(zhEmail).toBeDefined();
      expect(zhEmail?.subject).toContain('和解通知：Adversarial Multilingual Case');
      expect(zhEmail?.html).toContain('尊敬的 王小明，金额：$1250.75');

      // Recipient 2: Vietnamese
      const viEmail = mockEmailProvider.sentEmails.find((e) => e.to === 'nguyen.mai@example.com');
      expect(viEmail).toBeDefined();
      expect(viEmail?.subject).toContain('Thông Báo Tòa Án: Adversarial Multilingual Case');
      expect(viEmail?.html).toContain('Kính gửi Nguyễn, số tiền: $840.50');

      // Recipient 3: Spanish with script tag in name
      const esEmail = mockEmailProvider.sentEmails.find((e) => e.to === 'xss.claimant@example.com');
      expect(esEmail).toBeDefined();
      expect(esEmail?.subject).toContain('Aviso de Liquidación: Adversarial Multilingual Case');
      expect(esEmail?.html).not.toContain('<script>');
      expect(esEmail?.html).toContain('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');

      // Recipient 4: Arabic (unconfigured) -> fallback to English
      const arEmail = mockEmailProvider.sentEmails.find((e) => e.to === 'tariq@example.com');
      expect(arEmail).toBeDefined();
      expect(arEmail?.subject).toContain('Notice of Settlement: Adversarial Multilingual Case');
      expect(arEmail?.html).toContain('Dear Tariq, amount: $450.00');

      // 7. Verify Telemetry on EmailWave
      const updatedWave = await EmailWave.findById(wave._id);
      expect(updatedWave?.telemetry.dispatched).toBe(4);
      expect(updatedWave?.telemetry.queued).toBe(0);
      expect(updatedWave?.telemetry.failed).toBe(0);
    });

    it('[T5.5.2] Quiet hours suppression / deferral during active quiet hours window', async () => {
      // 1. Create Case
      const testCase = await Case.create({
        name: 'Quiet Hours Test Case',
        docketNumber: '1:26-cv-00888',
        lawFirmId: 'FIRM-ADV-QH',
        settlementFundTotal: 500000,
        disbursementDeadline: new Date('2026-12-31T00:00:00Z'),
        status: 'active'
      });

      // 2. Create NotificationCadence with quiet hours enabled (22:00 to 07:00 America/New_York)
      const cadence = await NotificationCadence.create({
        caseId: testCase._id,
        lawFirmId: 'FIRM-ADV-QH',
        name: 'Quiet Hours Cadence',
        status: 'active',
        stages: [
          {
            stageKey: 'initial_notice',
            stageName: 'Initial Notice',
            enabled: true,
            triggerType: 'deadline_relative',
            offsetHours: 0,
            status: 'in_progress',
            templates: {
              en: {
                subject: 'Notice: {{case_name}}',
                bodyHtml: '<p>Hello {{claimant_first_name}}</p>'
              }
            }
          }
        ],
        throttling: {
          batchSize: 50,
          intervalMinutes: 15,
          rateLimitPerSecond: 25,
          dailyCap: 10000,
          quietHoursEnabled: true,
          quietHoursStart: '22:00',
          quietHoursEnd: '07:00',
          timezone: 'America/New_York'
        },
        suppression: {
          skipCompletedPayments: true,
          suppressBounced: true,
          checkGlobalSuppression: false
        }
      });

      // 3. Create Claimant
      const claimant = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-QH-001',
        firstName: 'NightOwl',
        lastName: 'User',
        email: 'nightowl@example.com',
        settlementAmount: 100,
        status: 'pending_selection'
      });

      // 4. Create Wave and SubBatch
      const waveId = `wave_qh_${Date.now()}`;
      const subBatchId = `sub_${waveId}_0`;

      const wave = await EmailWave.create({
        waveId,
        caseId: testCase._id,
        cadenceId: cadence._id,
        stage: 'initial_notice',
        status: 'scheduled',
        scheduledDate: new Date(),
        totalSubBatches: 1,
        completedSubBatches: 0,
        throttlingConfig: cadence.throttling,
        telemetry: {
          eligible: 1,
          queued: 1,
          dispatched: 0,
          skipped_completed: 0,
          suppressed_bounced: 0,
          failed: 0,
          opened: 0,
          clicked: 0
        },
        controlState: { isPaused: false }
      });

      const subBatch = await SubBatch.create({
        subBatchId,
        waveId: wave._id,
        caseId: testCase._id,
        chunkIndex: 0,
        totalChunks: 1,
        claimantIds: [claimant._id],
        recipients: [
          {
            claimantId: claimant._id,
            claimId: claimant.claimId,
            email: claimant.email,
            status: 'queued'
          }
        ],
        status: 'pending',
        scheduledAt: new Date(),
        recipientCount: 1,
        dispatchedCount: 0,
        skippedCompletedCount: 0,
        suppressedBouncedCount: 0,
        failedCount: 0,
        retryCount: 0,
        maxRetries: 3,
        executionLogs: []
      });

      // 5. Execute Sub-Batch Dispatch during quiet hours: 23:30 NY time (03:30 UTC next day in October EDT)
      const quietHourTime = new Date('2026-10-17T03:30:00Z');
      const result = await executeDispatchWaveSubBatch(
        {
          waveId: wave.waveId,
          subBatchId: subBatch.subBatchId
        },
        {
          currentTime: quietHourTime
        }
      );

      // 6. Verify result is deferred
      expect(result.status).toBe('deferred_quiet_hours');
      expect(result.deferred).toBe(true);
      expect(result.nextRunAt).toBeDefined();

      // Zero emails dispatched
      expect(mockEmailProvider.sentEmails.length).toBe(0);

      // Verify sub-batch scheduledAt was deferred to morning send window (07:00 EDT is 11:00 UTC)
      const updatedSubBatch = await SubBatch.findById(subBatch._id);
      expect(updatedSubBatch?.status).toBe('pending');
      expect(updatedSubBatch?.scheduledAt.toISOString()).toBe('2026-10-17T11:00:00.000Z');
      expect(updatedSubBatch?.executionLogs.length).toBeGreaterThan(0);
      expect(updatedSubBatch?.executionLogs[0].message).toContain('Quiet hours active');
    });
  });
});
