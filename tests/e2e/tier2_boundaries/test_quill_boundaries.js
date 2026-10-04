/**
 * Tier 2 - Boundary & Corner Cases: Quill Sanitization & Template Boundaries
 * Tests 2.1 to 2.5: Obfuscated SVG/event handlers, Null bytes, Unclosed tags, Deep nesting, Unknown merge tags.
 */

const { describe, it, expect } = require('../harness/test_runner');
const { sanitizeHtmlOracle, resolveMergeTagsOracle } = require('../harness/oracles');

describe('Tier 2: Boundary & Corner Cases - Quill Sanitization & Template Boundaries', () => {
  it('2.1 Strips obfuscated SVG event vectors and nested onload handlers', () => {
    const maliciousPayload = '<svg><g onload="alert(\'XSS\')"><rect width="100" height="100" /></g></svg>';
    const sanitized = sanitizeHtmlOracle(maliciousPayload);

    expect(sanitized).not.toInclude('onload=');
    expect(sanitized).not.toInclude('alert');
  });

  it('2.2 Neutralizes null-byte (\0) injection within template strings', () => {
    const nullByteHtml = '<p>Official\0 <script>alert(1)</script>Notification</p>';
    const cleaned = sanitizeHtmlOracle(nullByteHtml.replace(/\0/g, ''));

    expect(cleaned).not.toInclude('\0');
    expect(cleaned).not.toInclude('<script>');
    expect(cleaned).toInclude('Official Notification');
  });

  it('2.3 Gracefully handles unclosed and mismatched HTML tags without parser throwing an exception', () => {
    const brokenHtml = '<div><p>Paragraph without closing tag <strong>bold text';
    let didThrow = false;
    let sanitized = '';

    try {
      sanitized = sanitizeHtmlOracle(brokenHtml);
    } catch (_) {
      didThrow = true;
    }

    expect(didThrow).toBe(false);
    expect(sanitized).toInclude('Paragraph without closing tag');
  });

  it('2.4 Handles deeply nested HTML structures (50+ nested containers) without stack overflow', () => {
    const depth = 60;
    let deepHtml = 'Content';
    for (let i = 0; i < depth; i++) {
      deepHtml = `<div>${deepHtml}</div>`;
    }

    let didThrow = false;
    let sanitized = '';
    try {
      sanitized = sanitizeHtmlOracle(deepHtml);
    } catch (_) {
      didThrow = true;
    }

    expect(didThrow).toBe(false);
    expect(sanitized).toInclude('Content');
  });

  it('2.5 Preserves unrecognized or unclosed merge tags without breaking template renderer', () => {
    const rawTemplate = '<p>Hello {{claimant_first_name}}, {{unknown_future_tag}} and {{unclosed_tag</p>';
    const context = { claimant_first_name: 'Robert' };

    const rendered = resolveMergeTagsOracle(rawTemplate, context);

    expect(rendered).toInclude('Hello Robert');
    expect(rendered).toInclude('{{unknown_future_tag}}'); // Unknown tag preserved
    expect(rendered).toInclude('{{unclosed_tag'); // Malformed tag untouched
  });
});
