# Project: Automated Payment Distribution System (`juris-banking`)

## Architecture
Full-stack, enterprise-grade Automated Payment Distribution System tailored for class-action and legal settlement administration built on the MERN stack (MongoDB, Express, React, Node.js) with Agenda/Agendash scheduler, RBAC IDM, Quill WYSIWYG, and Dash Solutions SFTP integration.

### Monorepo Structure (npm workspaces)
- `server/`: Node.js, Express, TypeScript, MongoDB/Mongoose, Agenda 6.x (`@agendajs/mongo-backend`), Agendash 8.x UI mount, Dash SFTP client (`ssh2-sftp-client`), JWT/RBAC auth (`bcryptjs`, `jsonwebtoken`), Quill HTML sanitizer (`sanitize-html`), Nodemailer email engine.
- `client/`: React 18/19, Vite, TypeScript, React Router DOM, Tailwind CSS, Lucide icons, Recharts delivery analytics, Quill WYSIWYG component.
- `fixtures/mock-sftp/`: Built-in local mock SFTP server (`ssh2` based) enabling offline and CI/CD end-to-end batch transmission and status reconciliation tests without live external Dash credentials.
- `storage/sftp/outbox/`: Local spooling directory for generated Dash outbound batch CSVs and SHA-256 checksum companion files.
- `docs/`: In-tree architectural specifications, Dash Solutions SFTP file layouts, and session deployment logs.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Monorepo Workspace Init | npm workspaces (`server`, `client`), git init, `.gitignore`, `.env.example`, build/start scripts | M1 | Survey 1 |
| 2 | MongoDB & Mongoose Setup | Native MongoDB 7.0 connection on `localhost:27017`, connection lifecycle, dev & test DB config | M1 | Survey 1 |
| 3 | User Schema & Roles | Mongoose schema supporting Super Admin, Law Firm Admin, Case Manager, Auditor/Viewer | M1 | Survey 3 |
| 4 | Password Hashing & Crypto | `bcryptjs` password hashing and secure cryptographic token utilities | M1 | Survey 1 |
| 5 | JWT & HttpOnly Cookies | Access & refresh token signing, verification, and secure HttpOnly cookie management | M1 | Survey 3 |
| 6 | RBAC Middleware | Role verification (`requireRole`), tenant scoping (`requireTenantScope`), claimant token auth | M1 | Survey 3 |
| 7 | Request Validation & Rate Limiting | Zod schemas for input validation and `express-rate-limit` protection | M1 | Survey 3 |
| 8 | Auth REST APIs | `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/refresh` | M1 | Survey 3 |
| 9 | Settlement Case Data Model | Case schema: `name`, `docketNumber`, `lawFirmId`, `settlementFundTotal`, `disbursementDeadline`, `fallbackPaymentMethod`, `status`, templates | M2 | Survey 3 |
| 10 | Case CRUD & Management APIs | Create, list, view, update cases; deadline and status management | M2 | Survey 3 |
| 11 | Claimant Data Model | Claimant schema: name, contact, claim ID, amount, status (`pending_selection`, `selected`, `queued_for_sftp`, `disbursed`, etc.) | M2 | Survey 3 |
| 12 | CSV Claimant Ingestion | Drag-and-drop CSV upload and streaming parser (`fast-csv`) | M2 | Survey 3 |
| 13 | Excel Claimant Ingestion | Drag-and-drop Excel (`.xlsx`) parser using `xlsx` library | M2 | Survey 3 |
| 14 | Ingestion Validation Engine | Schema mapping, email validation, duplicate claim ID detection, settlement fund variance checks | M2 | Survey 3 |
| 15 | Staged Upload Preview Screen | Two-phase upload: stage preview with error reporting, followed by commit confirmation | M2 | Survey 3 |
| 16 | Quill WYSIWYG Template Editor | React Quill component with rich formatting toolbar, custom merge-tag insertion dropdown | M2 | Survey 3 |
| 17 | Dynamic Merge Tag Engine | Server and client replacement for `{{claimant_first_name}}`, `{{settlement_amount}}`, `{{payment_selection_link}}`, etc. | M2 | Survey 3 |
| 18 | HTML Sanitization | Server-side `sanitize-html` preserving safe styles and merge tags while blocking XSS | M2 | Survey 3 |
| 19 | Live Preview Modal | Desktop and mobile viewport email template preview modal | M2 | Survey 3 |
| 20 | Pluggable Nodemailer Engine | Dev mock/spooler, Ethereal email capture, and production SMTP/SendGrid/SES configuration | M3 | Survey 1 |
| 21 | Magic Link Token Generator | 64-hex cryptographic token generation with expiration tracking (`/claim/:token`) | M3 | Survey 3 |
| 22 | Email Notification Dispatch | Batch email delivery engine with event tracking (`Queued`, `Dispatched`, `Delivered`, `Opened`, `Clicked`, `Failed`) | M3 | Survey 3 |
| 23 | Claimant Portal UI | Mobile-first, responsive, WCAG 2.1 AA accessible public payment selection interface | M3 | Survey 3 |
| 24 | Direct Deposit (ACH) Rail | ABA Routing Check Digit verification (MOD 10 weights 3,7,1), account number, type (Checking/Savings), AES-256-GCM encryption at rest | M3 | Survey 3 |
| 25 | Digital Prepaid Card Rail | Preferred email and SMS phone delivery selection for Mastercard/Visa digital card | M3 | Survey 3 |
| 26 | Push to Debit Card Rail | Cardholder name, PAN format validation, Luhn check digit, tokenized/masked card representation | M3 | Survey 3 |
| 27 | Mailed Physical Check Rail | Mailing address verification, street, city, state, and 5/9-digit ZIP validation | M3 | Survey 3 |
| 28 | Portal Deadline Enforcement | Checks `disbursementDeadline`; if expired, locks edits and renders assigned fallback notice | M3 | Survey 3 |
| 29 | Digital Signature & Receipt | Digital acknowledgment signature capture and downloadable PDF/HTML confirmation receipt | M3 | Survey 3 |
| 30 | Dash Outbound Batch Generator | Formats Header, ACH detail, Card detail, Push Debit detail, Check detail, and Trailer records per Dash payout spec | M4 | Survey 2 |
| 31 | Outbox Spooling & SHA-256 | Writes `DASH_DISBURSE_{CASE_ID}_{TIMESTAMP}.csv` and `.sha256` digest to `storage/sftp/outbox/` | M4 | Survey 2 |
| 32 | Dash SFTP Client | `ssh2-sftp-client` supporting private key & password auth, `/inbound/disbursements`, atomic `.tmp` upload + rename | M4 | Survey 2 |
| 33 | Mock SFTP Server | In-process `ssh2.Server` in `fixtures/mock-sftp/` with sandboxed VFS and test helper API | M4 | Survey 2 |
| 34 | Inbound Status Report Parser | Parses `REPORT_STATUS_{TIMESTAMP}.csv`, correlates Claim ID, maps statuses (`paid`, `rejected`, `returned`) | M4 | Survey 2 |
| 35 | Reconciliation Exception Ledger | Audit ledger for reconciliation exceptions, NACHA return codes (`R01`-`R20`), and resolution state | M4 | Survey 2 |
| 36 | Agenda Scheduler Setup | Agenda 6.x initialized with `@agendajs/mongo-backend` and native MongoDB connection | M5 | Survey 1 |
| 37 | Job: Dispatch Notifications | `case:dispatch-notifications`: Throttled batch email delivery with exponential backoff on retry | M5 | Survey 1 |
| 38 | Job: Send Deadline Reminders | `case:send-deadline-reminders`: Automated reminder emails sent 7 days and 48 hours prior to deadline | M5 | Survey 1 |
| 39 | Job: Enforce Deadline Fallback | `case:enforce-deadline-fallback`: Sweeps expired claimants with `pending_selection`, sets fallback payment, queues for batch | M5 | Survey 1 |
| 40 | Job: Generate & Upload Batch | `sftp:generate-and-upload-batch`: Compiles finalized selections into Dash CSV and uploads via SFTP | M5 | Survey 1 |
| 41 | Job: Poll Reconciliation Reports | `sftp:poll-reconciliation-reports`: Polls remote SFTP reports directory, parses status files, updates database | M5 | Survey 1 |
| 42 | Agendash Protected Mount | Agendash 8.x mounted at `/agendash` behind Super Admin / Law Firm Admin RBAC middleware | M5 | Survey 1 |
| 43 | Case Delivery Funnel Dashboard | Visual funnel: Uploaded Claimants -> Notifications Dispatched -> Delivered -> Portal Visited -> Method Selected -> Disbursed | M5 | Survey 3 |
| 44 | Payment Method Distribution Chart | Recharts interactive breakdown (Direct Deposit vs. Prepaid Card vs. Push Debit vs. Mailed Check vs. Fallback) | M5 | Survey 3 |
| 45 | Financial Summary Widget | Total Settlement Fund, Total Claimed, Total Disbursed, Total Outstanding | M5 | Survey 3 |
| 46 | Interactive Exception Ledger UI | Filterable table showing failed deliveries and reconciliation exceptions with one-click resolution actions | M5 | Survey 3 |
| 47 | Audit & Ledger CSV Export | One-click export of complete case audit logs and disbursement ledgers to CSV | M5 | Survey 3 |
| 48 | Comprehensive E2E Testing & Hardening | Full Tiers 1-4 E2E testing suite pass + Tier 5 adversarial coverage hardening | M6 | Survey 1 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core Foundation & RBAC IDM | Monorepo workspaces (`server`, `client`), Express setup, MongoDB connection, User model, JWT HttpOnly cookies, RBAC middleware, Auth APIs | none | PLANNED |
| M2 | Case Management, Ingestion & Quill WYSIWYG | Case & Claimant models, CSV & Excel parsers, staged preview APIs, Quill editor with merge tags, HTML sanitization, live preview modal | M1 | PLANNED |
| M3 | Notification Engine & Claimant Portal | Pluggable Nodemailer engine, magic link token generator, tracking events, React claimant portal, ABA routing check digit validation, card/check forms, deadline lock, digital receipt | M2 | PLANNED |
| M4 | Dash Solutions SFTP Batch Engine | Outbound CSV batch generator (Header, ACH, Card, Debit, Check, Trailer), SHA-256 outbox spooler, `ssh2-sftp-client`, mock SFTP server (`fixtures/mock-sftp/`), inbound report parser, exception audit ledger | M3 | PLANNED |
| M5 | Agenda Scheduler, Agendash & Analytics | Agenda 6.x setup, 5 scheduled jobs, Agendash RBAC mount, delivery funnel, Recharts distribution charts, financial summary, exception ledger UI with resolution actions, CSV exports | M4 | PLANNED |
| M6 | Final Integration & E2E Acceptance | Pass 100% of E2E test suite (Tiers 1-4), Tier 5 adversarial coverage hardening, docs/ documentation, and conventional commit audit | M5, E2E-TESTS | PLANNED |

## Interface Contracts

### 1. Auth & Session Contract (M1)
- `POST /api/auth/login`: `{ email, password }` -> `Set-Cookie: token=...; HttpOnly; SameSite=Lax`, returns `{ user: { id, email, role, lawFirmId } }`
- `GET /api/auth/me`: Validates JWT from cookie, returns current user profile and role permissions
- `POST /api/auth/logout`: Clears auth cookie

### 2. Case & Ingestion Contract (M2)
- `POST /api/cases`: Create case `{ name, docketNumber, lawFirmId, settlementFundTotal, disbursementDeadline, fallbackPaymentMethod, emailTemplate, landingPageText }`
- `POST /api/cases/:id/claimants/stage-upload`: Multipart upload (CSV or XLSX) -> Returns `{ validCount, invalidCount, totalAllocation, fundVariance, errors: [...], preview: [...] }`
- `POST /api/cases/:id/claimants/commit-upload`: Commits staged claimants to database, generates 64-hex tokens, returns `{ insertedCount }`

### 3. Claimant Portal & Notification Contract (M3)
- `GET /api/public/claim/:token`: Returns sanitized case branding, claimant name, confirmed settlement amount, deadline, and portal status
- `POST /api/public/claim/:token/select-payment`:
  - Payload: `{ method: 'ach' | 'digital_card' | 'debit_card' | 'physical_check', details: { ... }, signature: string }`
  - Validations: ABA check digit for ACH; valid PAN format/Luhn for debit; valid address for check; rejects if deadline passed.
- `GET /api/public/claim/:token/receipt`: Returns receipt details and downloadable receipt PDF/HTML

### 4. Dash SFTP & Reconciliation Contract (M4)
- Outbound Batch Generator: `generateBatchCsv(caseId: string, claimants: Claimant[]): { filename: string, csvContent: string, sha256: string, recordCount: number, totalAmount: number }`
- SFTP Service: `uploadBatchFile(localPath: string, remoteFilename: string): Promise<boolean>`
- Reconciliation Parser: `parseReconciliationReport(csvContent: string): Promise<ReconciliationResult[]>`
- Mock SFTP Server: `startMockSftp(port?: number): Promise<{ host: string, port: number, stop: () => Promise<void> }>`

### 5. Agenda & Analytics Contract (M5)
- Agenda Job Mount: `/agendash` guarded by `authenticateToken` + `requireRole(['super_admin', 'platform_admin', 'law_firm_admin'])`
- `GET /api/cases/:id/analytics/funnel`: Returns counts for `uploaded`, `dispatched`, `delivered`, `visited`, `selected`, `disbursed`
- `GET /api/cases/:id/analytics/methods`: Returns counts and dollar totals per payment method
- `GET /api/cases/:id/exceptions`: Returns filterable exception list with resolution actions:
  - `POST /api/cases/:id/exceptions/:exceptionId/resolve`: `{ action: 'resend_email' | 'switch_to_check' | 'requeue_sftp' | 'mark_resolved', reason: string }`

## Code Layout
```
juris-banking/
├── package.json              # Root npm workspaces config ("server", "client")
├── .gitignore
├── .env.example
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── config/           # Database, environment, SFTP, and email configuration
│   │   ├── models/           # Mongoose schemas (User, Case, Claimant, ReconciliationException)
│   │   ├── middleware/       # Auth JWT, RBAC, tenant scoping, rate limiting, validation
│   │   ├── routes/           # Auth, cases, claimants, portal, sftp, analytics routes
│   │   ├── services/         # SFTP client, batch generator, reconciliation parser, emailer, crypto
│   │   ├── jobs/             # Agenda scheduler jobs (definitions and triggers)
│   │   ├── utils/            # ABA check digit, Luhn algorithm, sanitize-html, CSV parsing
│   │   └── server.ts         # Express app initialization, Agendash mount, and listener
│   └── tests/                # Server unit, integration, and mock SFTP tests
├── client/
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── components/       # Reusable UI (Navbar, Sidebar, Modals, Forms)
│   │   ├── pages/            # Admin Dashboard, Case Detail, Ingestion, Quill Editor, Analytics
│   │   ├── portal/           # Public Claimant Payment Selection Portal & Receipt
│   │   ├── services/         # API client & auth session hooks
│   │   └── App.tsx           # React Router routing configuration
├── fixtures/
│   └── mock-sftp/            # ssh2-based mock SFTP server daemon and keys
├── storage/
│   └── sftp/outbox/          # Spooled outbound batch CSVs and .sha256 files
└── docs/                     # Architectural specifications, SFTP layouts, deployment logs
```
