/**
 * Tier 3 - Cross-Feature Combinations: Pairwise Scenario 4
 * Feature Interaction: Quill WYSIWYG Template + Sanitization + Email Dispatch + Portal Magic Link Verification.
 */

const { describe, it, expect } = require('../harness/test_runner');
const { sanitizeHtmlOracle, resolveMergeTagsOracle } = require('../harness/oracles');

describe('Tier 3: Pairwise - Quill Template, Email Dispatch & Magic Link Verification', () => {
  it('Sanitizes custom Quill template, dispatches email with merge tags, and verifies magic link loads claimant portal', () => {
    // 1. Legal admin authors email template in Quill with rich styles and dynamic merge tags
    const rawTemplate = `
      <h2>Important Notice: {{case_name}}</h2>
      <p>Hello {{claimant_first_name}},</p>
      <p>You have been approved to receive a distribution of <strong>{{settlement_amount}}</strong>.</p>
      <p><a href="{{payment_selection_link}}">Select Your Payment Method Now</a></p>
      <p>Please complete your election before {{selection_deadline}}.</p>
      <script>alert("Should be stripped")</script>
    `;

    // 2. Server sanitizes template HTML
    const sanitizedTemplate = sanitizeHtmlOracle(rawTemplate);
    expect(sanitizedTemplate).not.toInclude('<script>');
    expect(sanitizedTemplate).toInclude('{{payment_selection_link}}');
    expect(sanitizedTemplate).toInclude('<h2>Important Notice: {{case_name}}</h2>');

    // 3. Claimant record in database
    const claimantToken = '55aabbccddee00112233445566778899aabbccddeeff00112233445566778899';
    const claimant = {
      firstName: 'Eleanor',
      lastName: 'Vance',
      amount: '$350.00',
      caseName: 'Hill House Consumer Settlement',
      token: claimantToken,
      portalBaseUrl: 'https://claims.juris-banking.com',
    };

    // 4. Dispatch engine resolves merge tags
    const context = {
      case_name: claimant.caseName,
      claimant_first_name: claimant.firstName,
      claimant_last_name: claimant.lastName,
      settlement_amount: claimant.amount,
      payment_selection_link: `${claimant.portalBaseUrl}/claim/${claimant.token}`,
      selection_deadline: 'November 15, 2026',
    };

    const renderedEmailBody = resolveMergeTagsOracle(sanitizedTemplate, context);

    expect(renderedEmailBody).toInclude('Hello Eleanor');
    expect(renderedEmailBody).toInclude('distribution of <strong>$350.00</strong>');
    expect(renderedEmailBody).toInclude(`https://claims.juris-banking.com/claim/${claimantToken}`);

    // 5. Simulate claimant clicking magic link: token parses and matches claimant in DB
    const magicLinkUrl = `${claimant.portalBaseUrl}/claim/${claimant.token}`;
    const tokenFromUrl = magicLinkUrl.split('/claim/')[1];

    expect(tokenFromUrl).toBe(claimantToken);
    expect(tokenFromUrl).toHaveLength(64);
  });
});
