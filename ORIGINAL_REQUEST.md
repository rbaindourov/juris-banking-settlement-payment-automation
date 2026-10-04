# Original User Request

## Initial Request — 2026-10-04T09:43:58Z

Start a private repository and build the Automated Payment Distribution system built on the MERN Stack (MongoDB, Express, React, Node.js) with Agenda/Agendash scheduler, RBAC IDM, Quill WYSIWYG, and Dash Solutions SFTP integration.

Working directory: /home/robert/projects/juris-banking
Integrity mode: development

## Executive Summary
Build and initialize a full-stack, enterprise-grade Automated Payment Distribution System tailored for class-action and legal settlement administration inside `/home/robert/projects/juris-banking`. The system enables law firms to register settlement cases, batch-ingest claimant rosters, compose custom notification emails and portal landing pages via a Quill WYSIWYG editor, dispatch secure tokenized magic links, and collect payment method preferences (Direct Deposit/ACH, Digital Prepaid Card, Push to Debit, Mailed Physical Check).

The platform orchestrates automated batch disbursements and status report reconciliation via Dash Solutions (formerly Prepaid Technologies) over secure SFTP, automatically resolves non-responsive claimants to a case fallback method upon deadline expiration, and provides scheduled background processing with Agendash and case-level delivery analytics.

## Architecture & Environment Configuration
- Workspace: `/home/robert/projects/juris-banking`
- Architecture Layout:
  - `server/`: Node.js, Express, MongoDB/Mongoose, Agenda scheduler, Agendash UI mount, Dash SFTP client, JWT/RBAC auth, Quill HTML sanitizer.
  - `client/`: React (Vite / TypeScript / modern styling), React Router, Quill WYSIWYG integration, Lucide icons, Recharts / Delivery analytics.
  - `fixtures/mock-sftp/`: Built-in local mock SFTP server (`ssh2` based) enabling offline and CI/CD end-to-end batch transmission and status reconciliation tests.
  - `docs/`: In-tree architectural specifications, Dash Solutions SFTP file layouts, and session deployment logs.
- Email Transport: Pluggable Nodemailer engine supporting local mock/Ethereal spooling during development, with production SMTP/SendGrid/SES configurable via `.env`.
- SFTP Verification: Self-contained `ssh2` mock SFTP server paired with production `ssh2-sftp-client` workflows.

## Detailed Requirements

### R1. Project Initialization & RBAC Identity Management (IDM)
- Initialize Git repository in `/home/robert/projects/juris-banking` with standard `.gitignore`, `.env.example`, and package management.
- Implement Role-Based Access Control (RBAC) with secure JWT and HTTP-only cookies:
  - Super Admin / Platform Admin: Global case management, law firm tenant management, Agendash scheduling access.
  - Law Firm Admin: Create/manage firm cases, upload claimant rosters, configure Quill templates, trigger dispatches.
  - Case Manager: Review claimant records, monitor delivery stats, review exceptions and reconciliation flags.
  - Auditor / Viewer: Read-only access to case delivery dashboards and disbursement audit logs.
  - Claimant (Tokenized): Passwordless, secure single-case token access restricted strictly to their individual claim record.
- Include password hashing (`argon2` or `bcrypt`), rate limiting (`express-rate-limit`), and request validation (`zod`).

### R2. Settlement Case Management & Claimant Ingestion
- Case Model:
  - `name`, `docketNumber`, `lawFirmId`, `settlementFundTotal`, `disbursementDeadline`, `fallbackPaymentMethod` (Default: `physical_check`), `status` (`draft`, `active`, `deadline_passed`, `disbursed`, `closed`), `emailTemplate`, `landingPageText`.
- Claimant Batch Ingestion:
  - Support CSV and Excel (`.xlsx`) drag-and-drop file upload.
  - Schema mapping and parsing: First Name, Last Name, Email, Phone, Address, Unique Claim/Member ID, Settlement Amount ($), Pre-assigned Payment Info (optional).
  - Validation engine: Detects invalid email formats, duplicate claim IDs within the case, and mismatched total allocations against settlement fund totals.
  - Staged preview screen allowing Case Managers to review parsed records and errors before committing to the database.

### R3. Quill WYSIWYG Template Designer & Landing Page Copy
- Integrate React-Quill (or Quill.js core) in the legal admin portal:
  - Email Template Editor: Rich text formatting (headings, lists, links, brand logo, styled buttons).
  - Dynamic Merge Tag Insertion: `{{claimant_first_name}}`, `{{claimant_last_name}}`, `{{settlement_amount}}`, `{{case_name}}`, `{{selection_deadline}}`, `{{payment_selection_link}}`.
  - Landing Page Text Editor: Customize public-facing introductory text, FAQ accordion copy, and support contact details per case.
  - Server-side HTML sanitization (`sanitize-html` or `DOMPurify`) to prevent XSS vulnerabilities while preserving safe styling and merge tags.
  - Live preview modal for desktop and mobile email layouts.

### R4. Claimant Notification Engine & Payment Selection Portal
- Notification Dispatch:
  - Background dispatch of personalized emails via Nodemailer with pluggable transports (local mock spooler in dev, SMTP/SendGrid/SES in prod).
  - Generate cryptographically secure, time-limited magic links: `https://portal.domain/claim/{claimantToken}`.
  - Delivery event tracking: Queued, Dispatched, Delivered, Opened, Clicked, Failed.
- Claimant Payment Selection Portal:
  - Clean, mobile-first, WCAG 2.1 AA accessible UI.
  - Authenticates via URL token, displaying case branding, claimant name, and confirmed settlement amount.
  - Payment Choices:
    1. Direct Deposit (ACH): Bank Routing Number (with routing check digit verification), Account Number, Account Type (Checking/Savings).
    2. Digital Prepaid Card (Mastercard/Visa): Preferred email/phone delivery.
    3. Push to Debit Card: Cardholder Name, Debit Card Number, Expiration (tokenized/sanitized).
    4. Mailed Physical Check: Verify/update mailing street address, city, state, and ZIP.
  - Deadline Enforcement: If visited after `disbursementDeadline`, portal disables modification and displays the assigned fallback disbursement notice.
  - Digital signature / acknowledgment and instant submission confirmation with downloadable receipt.

### R5. Dash Solutions (Prepaid Technologies) SFTP Batch Engine
- Outbound Batch Generation:
  - Research and implement Dash Solutions payout specifications:
    - Standard batch disbursement file format (Header Record, Detail Records for ACH, Card, Check, and Batch Trailer Record).
    - Map claimant payment selections to Dash record types (Direct Deposit NACHA/ACH fields, Digital Card orders, Check print files).
  - Automated file naming convention: `DASH_DISBURSE_{CASE_ID}_{TIMESTAMP}.csv`.
- SFTP Client Integration:
  - Secure file transfer client (`ssh2-sftp-client`) supporting private key (`id_rsa` / `id_ed25519`) and password authentication.
  - Configurable SFTP endpoints: Host, Port, Username, Remote Upload Directory (`/inbound/disbursements`), Remote Report Directory (`/outbound/reports`).
  - Outbox spooling: Local storage of generated batch files in `storage/sftp/outbox/` with SHA-256 checksums before transmission.
- Inbound Reconciliation Report Parser:
  - Scheduled download and parsing of daily Dash status reports (e.g. `REPORT_STATUS_{TIMESTAMP}.csv`).
  - Reconciles individual transactions by Claim ID:
    - Status updates: `paid` (with Dash Reference ID & settlement date), `rejected`, `returned` (with failure code / reason).
  - Logs reconciliation exceptions in a dedicated audit ledger.
- Mock SFTP Server:
  - Built-in `ssh2` mock SFTP server for automated testing and local developer verification without requiring live external Dash credentials.

### R6. Agenda & Agendash Job Scheduling Engine
- Native MongoDB-backed job scheduler (Agenda):
  - Job: `case:dispatch-notifications`: Throttled batch email delivery with exponential backoff on retry.
  - Job: `case:send-deadline-reminders`: Automated reminder emails sent 7 days and 48 hours prior to deadline.
  - Job: `case:enforce-deadline-fallback`: Runs upon deadline expiration; sweeps all claimants with `status: "pending_selection"`, assigns `case.fallbackPaymentMethod`, and queues them for final disbursement batch.
  - Job: `sftp:generate-and-upload-batch`: Compiles all finalized selections and uploads batch file to Dash SFTP.
  - Job: `sftp:poll-reconciliation-reports`: Polls Dash SFTP report directory, downloads new reconciliation files, and triggers status updates.
- Agendash Dashboard:
  - Agendash web UI mounted at `/agendash` (or `/admin/scheduler`).
  - Protected behind Super Admin / Law Firm Admin RBAC middleware.
  - Provides real-time job visibility: Scheduled, Running, Completed, Failed, with manual rerun triggers.

### R7. Case Delivery & Disbursement Analytics Dashboard
- Comprehensive case-level metrics for legal administrators:
  - Delivery Funnel: Total Uploaded Claimants -> Notifications Dispatched -> Delivered -> Portal Visited -> Method Selected -> Disbursed.
  - Method Breakdown: Visual chart of selected methods (Direct Deposit vs. Prepaid Card vs. Push to Debit vs. Mailed Check vs. Default Fallback).
  - Financial Summary: Total Case Settlement Pool, Total Claimed Amount, Total Disbursed via Dash, Total Outstanding/Unclaimed.
  - Exception Ledger: Filterable table showing failed email deliveries, rejected bank account routings, and Dash SFTP reconciliation errors with one-click resolution workflows.
  - Exporting: One-click export of complete case audit logs and disbursement ledgers to CSV.

## Master Acceptance Criteria
- [ ] Complete MERN stack running natively on host (Node.js + Express backend, React frontend, MongoDB connection).
- [ ] RBAC fully enforces permissions: unauthorized users cannot view cases or access Agendash.
- [ ] Claimant CSV/Excel parser successfully validates and ingests multi-thousand-row datasets.
- [ ] Quill editor successfully outputs sanitized HTML with functional dynamic merge tags for emails and landing pages.
- [ ] Claimant magic link portal loads claim details, accepts payment preferences, and writes to database.
- [ ] Deadline expiration job automatically transitions pending claimants to the fallback method.
- [ ] Dash Solutions SFTP integration successfully generates formatted batch files, uploads via SFTP, and parses status report files.
- [ ] Agenda executes scheduled tasks reliably, visible within the authenticated Agendash UI.
- [ ] Case delivery dashboard displays live metrics, selection breakdown charts, and exception ledgers.
- [ ] Automated unit, integration, and mock-SFTP test suites pass 100% green.
- [ ] All changes committed cleanly with conventional commit messages in `/home/robert/projects/juris-banking`.

## Addendum 1 — 2026-10-04T10:40:21Z (User Request: Open-Source gmail-service Integration)
The user explicitly requested:
"we should defnitely add gmail_service (the open source version) integration into the system on top of whatever the agents are already building out, so we can easily wire it up to any workspace the lawers might be using."

### R8. Open-Source Gmail Service (`gmail-service`) Integration
- Support integration with the open-source `gmail-service` (`/home/robert/Documents/projects/gmail-service`) as a first-class email transport and law firm workspace communication provider:
  - **Provider Adapter (`server/src/services/gmailService.ts`)**: Strongly-typed client communicating with `gmail-service` REST endpoints via `GMAIL_SERVICE_URL` (default: `http://localhost:8085`).
  - **Notification Dispatch**: Transmit claimant magic links and settlement updates via `POST /api/gmail/send` (supporting HTML bodies rendered by Quill).
  - **Workspace & Tenant Wireup**: Law firms can configure their email delivery provider (`provider: "gmail_service" | "smtp"`) allowing seamless binding to any Google Workspace mailbox used by attorneys or case managers.
  - **Bounce Suppression & Telemetry**: Query `GET /api/gmail/bounces/check?email=...` before dispatch to avoid suppressed addresses, and trigger bounce detection scans (`POST /api/gmail/bounces/scan`) during Agenda reconciliation runs.
  - **Testability**: Provide unit and mock tests for `gmailService.ts` simulating HTTP responses from `gmail-service`.

## Addendum 2 — 2026-10-04T10:51:16Z (User Request: Payment Methods Expansion)
The user explicitly requested:
"Include Paypal, Venmo, Zelle, Bitcoin as payment methods"

### Extended Payment Rails Specification
Incorporate `paypal`, `venmo`, `zelle`, and `bitcoin` into the claimant payment selection options, Mongoose models, validation schemas, and disbursement workflows:
1. **Model & Schema Enum Updates**:
   - `PaymentRail`: `'ach' | 'direct_deposit' | 'digital_card' | 'debit_card' | 'physical_check' | 'paypal' | 'venmo' | 'zelle' | 'bitcoin'`.
2. **Claimant Selection Portal Payloads**:
   - `paypal`: Recipient PayPal account email or phone number.
   - `venmo`: Recipient Venmo handle (`@username`) or phone number.
   - `zelle`: Recipient mobile phone or email linked to Zelle.
   - `bitcoin`: Valid Bitcoin wallet address (Bech32 `bc1...`, SegWit `3...`, or Legacy `1...` with address format validation).
3. **Disbursement & SFTP Export Mapping**:
   - Map digital wallet choices (PayPal, Venmo, Zelle) to Dash Solutions push-disbursement partner fields or dedicated batch payout record types.
   - Isolate Bitcoin payouts to dedicated crypto-disbursement batch ledger with on-chain transaction hash reconciliation.

## Addendum 3 — 2026-10-04T10:56:23Z (User Request: Landing Page Localization)
The user explicitly requested:
"we will need localization for the landing pages"

### Landing Page & Portal Localization (i18n / l10n) Specification
1. **Case Model Updates**:
   - Support multi-language landing page text and FAQs:
     - `defaultLanguage`: e.g. `'en'` (ISO 639-1 code).
     - `supportedLanguages`: Array of enabled locales (e.g. `['en', 'es', 'zh', 'vi']`).
     - `landingPageText`: Map or schema supporting per-locale localized structures (headline, introHtml, faqAccordion, supportContact).
2. **Admin WYSIWYG Editor (Quill)**:
   - Provide a language selector tab in the case management UI allowing law firm administrators to author, translate, sanitize, and preview landing page copy and FAQs across each enabled language.
3. **Claimant Selection Portal (React Frontend)**:
   - Responsive language switcher dropdown/pill in the navigation header.
   - Auto-detects locale from claimant preferences or browser `navigator.language`, with user override.
   - Internationalized static UI strings (prompts, buttons, error messages, payment rail descriptions) via frontend i18n dictionaries.



