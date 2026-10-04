import sanitizeHtml from 'sanitize-html';

export interface TemplateContext {
  claimant_first_name?: string;
  claimant_last_name?: string;
  settlement_amount?: string | number;
  case_name?: string;
  selection_deadline?: string | Date;
  payment_selection_link?: string;
  [key: string]: any;
}

const DEFAULT_ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'div', 'span', 'blockquote', 'pre', 'code', 'hr', 'br',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'a', 'img', 'svg', 'g', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon'
];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: DEFAULT_ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'target', 'rel', 'class', 'style', 'title', 'id'],
    img: ['src', 'alt', 'title', 'width', 'height', 'class', 'style', 'id'],
    table: ['border', 'cellpadding', 'cellspacing', 'class', 'style', 'width'],
    th: ['colspan', 'rowspan', 'align', 'valign', 'class', 'style', 'width'],
    td: ['colspan', 'rowspan', 'align', 'valign', 'class', 'style', 'width'],
    svg: ['width', 'height', 'viewBox', 'xmlns', 'fill', 'stroke', 'class', 'style'],
    g: ['fill', 'stroke', 'class', 'style'],
    path: ['d', 'fill', 'stroke', 'stroke-width'],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke'],
    circle: ['cx', 'cy', 'r', 'fill', 'stroke'],
    line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width'],
    polyline: ['points', 'stroke', 'fill'],
    polygon: ['points', 'stroke', 'fill'],
    '*': ['class', 'style', 'id', 'align']
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    a: ['http', 'https', 'mailto', 'tel'],
    img: ['http', 'https', 'data']
  },
  allowProtocolRelative: true,
  transformTags: {
    // Strip javascript: pseudo-protocols if not caught by allowedSchemes
    a: (tagName, attribs) => {
      if (attribs.href && /^\s*javascript:/i.test(attribs.href)) {
        return {
          tagName,
          attribs: {
            ...attribs,
            href: '#'
          }
        };
      }
      return { tagName, attribs };
    }
  }
};

/**
 * Sanitizes HTML content, neutralizing XSS vectors while preserving safe markup and merge tags.
 */
export function sanitizeEmailHtml(dirtyHtml: string): string {
  if (typeof dirtyHtml !== 'string') return '';
  // Neutralize null bytes
  const sanitizedNullBytes = dirtyHtml.replace(/\0/g, '');
  // Sanitize with sanitize-html
  return sanitizeHtml(sanitizedNullBytes, SANITIZE_OPTIONS);
}

/**
 * Escapes HTML entities (&, <, >, ", ') to prevent XSS injection from dynamic context data.
 */
export function escapeHtml(str: string): string {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validates and sanitizes payment_selection_link URL.
 * Only permits http:, https:, or relative paths; neutralizes javascript: or other unsafe schemes to '#'.
 */
export function sanitizeLinkUrl(url: string): string {
  if (typeof url !== 'string') return '#';
  const trimmed = url.trim();
  if (!trimmed) return '';

  // Remove control characters
  const clean = trimmed.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

  // Neutralize dangerous pseudo-protocols: javascript:, vbscript:, data:, file:
  if (/^(javascript|vbscript|data|file):/i.test(clean)) {
    return '#';
  }

  // Relative paths: e.g. /claim/..., ./..., #...
  if (/^(\/|\.\/|#)/.test(clean)) {
    return clean;
  }

  try {
    const parsed = new URL(clean);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return clean;
    }
    return '#';
  } catch {
    // If not a full URL with scheme, but relative path without colon
    if (!clean.includes(':')) {
      return clean;
    }
    return '#';
  }
}

/**
 * Formats a currency amount into a standard USD string ($X.XX).
 */
export function formatCurrency(amount: number | string): string {
  if (typeof amount === 'number') {
    return `$${amount.toFixed(2)}`;
  }
  if (typeof amount === 'string') {
    if (amount.startsWith('$')) return amount;
    const num = parseFloat(amount);
    if (!isNaN(num)) return `$${num.toFixed(2)}`;
  }
  return String(amount);
}

/**
 * Formats a date into a standard human-readable string using UTC timezone.
 */
export function formatDate(date: Date | string): string {
  if (date instanceof Date) {
    return date.toLocaleDateString('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
  if (typeof date === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(date)) {
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('en-US', {
          timeZone: 'UTC',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      }
    }
    return date;
  }
  return String(date);
}

/**
 * Replaces dynamic merge tags with context values while safely preserving unrecognized tags.
 * Dynamic context values are HTML-escaped and URLs validated to prevent post-sanitization XSS injection.
 */
export function resolveMergeTags(template: string, context: TemplateContext = {}): string {
  if (typeof template !== 'string') return '';

  // Build normalized context with alias fallbacks
  const normalized: Record<string, string> = {};

  // Standard tags
  if (context.claimant_first_name !== undefined || context.firstName !== undefined) {
    normalized['claimant_first_name'] = escapeHtml(String(context.claimant_first_name ?? context.firstName ?? ''));
  }
  if (context.claimant_last_name !== undefined || context.lastName !== undefined) {
    normalized['claimant_last_name'] = escapeHtml(String(context.claimant_last_name ?? context.lastName ?? ''));
  }
  if (context.settlement_amount !== undefined || context.amount !== undefined) {
    const rawAmt = context.settlement_amount ?? context.amount;
    normalized['settlement_amount'] = escapeHtml(formatCurrency(rawAmt));
  }
  if (context.case_name !== undefined || context.caseName !== undefined) {
    normalized['case_name'] = escapeHtml(String(context.case_name ?? context.caseName ?? ''));
  }
  if (context.selection_deadline !== undefined || context.disbursementDeadline !== undefined) {
    const rawDeadline = context.selection_deadline ?? context.disbursementDeadline;
    normalized['selection_deadline'] = escapeHtml(formatDate(rawDeadline));
  }
  if (context.payment_selection_link !== undefined || context.magicLink !== undefined) {
    const rawLink = String(context.payment_selection_link ?? context.magicLink ?? '');
    normalized['payment_selection_link'] = escapeHtml(sanitizeLinkUrl(rawLink));
  }

  // Copy and escape any additional custom properties
  for (const [key, value] of Object.entries(context)) {
    if (!(key in normalized) && value !== undefined && value !== null) {
      normalized[key] = escapeHtml(String(value));
    }
  }

  // Replace {{tag_name}}
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, tag) => {
    if (tag in normalized) {
      return normalized[tag];
    }
    return match; // Keep unrecognized tag intact
  });
}

export class TemplateService {
  /**
   * Sanitizes email/landing HTML content.
   */
  static sanitize(html: string): string {
    return sanitizeEmailHtml(html);
  }

  /**
   * Resolves merge tags with the provided context.
   */
  static resolve(template: string, context: TemplateContext): string {
    return resolveMergeTags(template, context);
  }

  /**
   * Renders a sanitized preview of a template with sample claimant data.
   */
  static renderPreview(
    template: string,
    sampleData: Partial<TemplateContext> = {},
    options: { viewport?: 'desktop' | 'mobile' } = {}
  ): {
    sanitizedHtml: string;
    renderedHtml: string;
    previewHtml: string;
    viewport: 'desktop' | 'mobile';
  } {
    const defaultSampleContext: TemplateContext = {
      claimant_first_name: 'Jane',
      claimant_last_name: 'Doe',
      settlement_amount: '$450.00',
      case_name: 'Sample Class Action Settlement',
      selection_deadline: 'November 30, 2026',
      payment_selection_link: 'https://portal.juris-banking.com/claim/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ...sampleData
    };

    const sanitizedHtml = sanitizeEmailHtml(template);
    const renderedHtml = resolveMergeTags(sanitizedHtml, defaultSampleContext);

    const viewport = options.viewport === 'mobile' ? 'mobile' : 'desktop';
    const containerStyle =
      viewport === 'mobile'
        ? 'max-width: 375px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; background: #ffffff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;'
        : 'max-width: 680px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px; background: #ffffff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';

    const previewHtml = `<div class="template-preview-${viewport}" style="${containerStyle}">${renderedHtml}</div>`;

    return {
      sanitizedHtml,
      renderedHtml,
      previewHtml,
      viewport
    };
  }
}
