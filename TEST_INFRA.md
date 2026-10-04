# Test Infrastructure & Specification Matrix (`TEST_INFRA.md`)

## 1. Executive Summary & Architecture Overview

The Automated Payment Distribution System (`juris-banking`) E2E test track delivers a comprehensive, requirement-driven, opaque-box testing framework built natively under `tests/e2e/`. The framework verifies the complete multi-tenant MERN stack architecture, Dash Solutions SFTP payout integrations, Agenda/Agendash job scheduling, Quill WYSIWYG sanitization, and claimant self-service portal rails across four distinct testing tiers (84 automated tests total).

```
juris-banking/tests/e2e/
├── run_all.js                       # Master CLI runner supporting --tier, --feature, --filter, --verbose
├── config.js                        # Environment & network endpoint configurations
├── harness/
│   ├── test_runner.js               # Self-contained assertion framework (describe, it, expect, matchers)
│   ├── test_client.js               # Opaque-box HTTP client with automated cookie jar & session management
│   ├── oracles.js                   # Authoritative mathematical (Fed Mod 10, Luhn) & layout oracles
│   ├── data_generators.js           # 1,000-claimant roster generator, corrupt CSVs, test vectors
│   └── mock_sftp_server.js          # Pure Node.js Dash SFTP mock server & sandboxed VFS
├── tier1_features/                  # Tier 1: Feature Coverage (>=5 tests per feature area)
│   ├── test_auth_rbac.js            # Auth & RBAC Identity Management (6 tests)
│   ├── test_ingestion.js            # Claimant Batch Ingestion Pipeline (5 tests)
│   ├── test_quill_sanitization.js   # Quill WYSIWYG & HTML Sanitization (5 tests)
│   ├── test_claimant_portal.js      # Claimant Portal & Payment Rails (6 tests)
│   ├── test_dash_sftp.js            # Dash SFTP Batch Engine & Reconciliation (6 tests)
│   ├── test_agenda_scheduler.js     # Agenda Scheduler & Agendash (5 tests)
│   └── test_analytics.js            # Case Delivery & Disbursement Analytics (6 tests)
├── tier2_boundaries/                # Tier 2: Boundary & Corner Cases (>=5 tests per feature area)
│   ├── test_auth_boundaries.js      # Auth/RBAC Limits & Rate Limiting (5 tests)
│   ├── test_ingestion_boundaries.js # Ingestion Corruptions, Duplicates & Over-allocation (6 tests)
│   ├── test_quill_boundaries.js     # Obfuscated XSS, Null Bytes & Deep Nesting (5 tests)
│   ├── test_portal_boundaries.js    # Fed Mod 10 ABA Routing & Luhn Check Digits (6 tests)
│   ├── test_sftp_boundaries.js      # Zero Records, Control Mismatches & Traversal (6 tests)
│   ├── test_agenda_boundaries.js    # Concurrency, Backoff & Idempotent Fallback (5 tests)
│   └── test_analytics_boundaries.js # Zero Claimants, 100% Funnel & CSV Escaping (5 tests)
├── tier3_pairwise/                  # Tier 3: Cross-Feature Interactions & Pairwise Workflows
│   ├── test_claimant_expiry_fallback.js   # Token Expiry + Deadline Fallback + Check Generation (1 test)
│   ├── test_excel_variance_rejection.js   # Excel Ingestion + Fund Over-allocation Rejection (1 test)
│   ├── test_sftp_reconciliation_cycle.js  # Outbound Batch SFTP + Inbound Report Polling (1 test)
│   ├── test_quill_dispatch_magiclink.js   # Quill Merge Tags + Nodemailer + Magic Link Auth (1 test)
│   ├── test_exception_resolution_requeue.js # Return Codes + Admin Resolution + Re-queue (1 test)
│   └── test_rbac_tenant_isolation.js      # Multi-tenant Cross-Firm Data Isolation (1 test)
└── tier4_realworld/                 # Tier 4: Real-World Application Scenarios
    └── test_class_action_lifecycle.js     # Full 12-Stage 1,000-Claimant End-to-End Simulation (1 test)
```

---

## 2. Test Execution Guide

The test suite can be run directly via `npm` or through Node.js CLI invocations:

### Master Test Invocations
```bash
# Execute entire test suite (Tiers 1-4, 84 tests)
npm run test:e2e
# or
node tests/e2e/run_all.js
```

### Targeted Tier Execution
```bash
# Run Tier 1: Feature Coverage only (39 tests)
node tests/e2e/run_all.js --tier=1

# Run Tier 2: Boundary & Corner Cases only (38 tests)
node tests/e2e/run_all.js --tier=2

# Run Tier 3: Cross-Feature Pairwise Interactions only (6 tests)
node tests/e2e/run_all.js --tier=3

# Run Tier 4: Real-World 1,000-Claimant Lifecycle Simulation only (1 test)
node tests/e2e/run_all.js --tier=4
```

### Feature & Substring Filtering
```bash
# Filter tests by feature area across all tiers
node tests/e2e/run_all.js --feature=auth
node tests/e2e/run_all.js --feature=ingestion
node tests/e2e/run_all.js --feature=sftp
node tests/e2e/run_all.js --feature=portal
node tests/e2e/run_all.js --feature=quill
node tests/e2e/run_all.js --feature=agenda
node tests/e2e/run_all.js --feature=analytics

# Filter by custom name substring with verbose stack traces
node tests/e2e/run_all.js --filter="Mod 10" --verbose
```

---

## 3. Feature Inventory Coverage Matrix

| PROJECT.md Feature | Requirement | Tier 1 (Coverage) | Tier 2 (Boundary) | Tier 3 (Pairwise) | Tier 4 (Real-World) | Test Suites |
|---|---|---|---|---|---|---|
| **#3 User Schema & Roles** | R1 | ✔ Tests 1.1–1.4 | ✔ Test 2.4 | ✔ Test 3.6 | ✔ Stage 1 | `test_auth_rbac.js`, `test_rbac_tenant_isolation.js` |
| **#5 JWT & HttpOnly Cookies** | R1 | ✔ Tests 1.1, 1.3 | ✔ Test 2.3 | ✔ Test 3.6 | ✔ Stage 1 | `test_auth_rbac.js`, `test_auth_boundaries.js` |
| **#6 RBAC Middleware** | R1 | ✔ Tests 1.1–1.5 | ✔ Test 2.4 | ✔ Test 3.6 | ✔ Stage 1 | `test_auth_rbac.js`, `test_rbac_tenant_isolation.js` |
| **#7 Rate Limiting & Zod** | R1 | ✔ Test 1.6 | ✔ Tests 2.1, 2.5 | ✔ Test 3.6 | ✔ Stage 1 | `test_auth_boundaries.js` |
| **#8 Auth REST APIs** | R1 | ✔ Tests 1.1, 1.6 | ✔ Tests 2.1–2.3 | ✔ Test 3.6 | ✔ Stage 1 | `test_auth_rbac.js`, `test_auth_boundaries.js` |
| **#9 Case Data Model** | R2 | ✔ Test 1.1 | ✔ Test 2.5 | ✔ Tests 3.1, 3.2 | ✔ Stage 2 | `test_ingestion.js`, `test_claimant_expiry_fallback.js` |
| **#12 CSV Ingestion** | R2 | ✔ Tests 1.1, 1.2 | ✔ Tests 2.1–2.4 | ✔ Test 3.1 | ✔ Stage 3 | `test_ingestion.js`, `test_ingestion_boundaries.js` |
| **#13 Excel Ingestion** | R2 | ✔ Test 1.5 | ✔ Test 2.5 | ✔ Test 3.2 | ✔ Stage 3 | `test_ingestion.js`, `test_excel_variance_rejection.js` |
| **#14 Ingestion Validation** | R2 | ✔ Tests 1.1–1.3 | ✔ Tests 2.2–2.6 | ✔ Test 3.2 | ✔ Stage 3 | `test_ingestion_boundaries.js` |
| **#15 Staged Preview Screen** | R2 | ✔ Test 1.3 | ✔ Tests 2.3, 2.5 | ✔ Test 3.2 | ✔ Stage 3 | `test_ingestion.js`, `test_excel_variance_rejection.js` |
| **#16 Quill WYSIWYG** | R3 | ✔ Tests 1.2, 1.3 | ✔ Tests 2.3, 2.4 | ✔ Test 3.4 | ✔ Stage 4 | `test_quill_sanitization.js` |
| **#17 Dynamic Merge Tags** | R3 | ✔ Tests 1.3, 1.4 | ✔ Test 2.5 | ✔ Test 3.4 | ✔ Stages 4, 5 | `test_quill_sanitization.js`, `test_quill_dispatch_magiclink.js`|
| **#18 HTML Sanitization** | R3 | ✔ Tests 1.1–1.3 | ✔ Tests 2.1–2.4 | ✔ Test 3.4 | ✔ Stage 4 | `test_quill_sanitization.js`, `test_quill_boundaries.js` |
| **#21 Magic Link Tokens** | R3 | ✔ Test 1.4 | ✔ Test 2.6 | ✔ Test 3.4 | ✔ Stages 3, 5 | `test_claimant_portal.js`, `test_quill_dispatch_magiclink.js`|
| **#22 Email Dispatch Engine** | R4 | ✔ Test 1.4 | ✔ Test 2.3 | ✔ Test 3.4 | ✔ Stage 5 | `test_agenda_scheduler.js`, `test_quill_dispatch_magiclink.js`|
| **#23 Claimant Portal UI** | R4 | ✔ Test 1.1 | ✔ Tests 2.1, 2.6 | ✔ Test 3.4 | ✔ Stage 6 | `test_claimant_portal.js`, `test_portal_boundaries.js` |
| **#24 Direct Deposit (ACH)** | R4 | ✔ Test 1.2 | ✔ Tests 2.2, 2.3 | ✔ Test 3.3 | ✔ Stage 6 | `test_claimant_portal.js`, `test_portal_boundaries.js` |
| **#25 Digital Prepaid Card** | R4 | ✔ Test 1.3 | ✔ Test 2.5 | ✔ Test 3.3 | ✔ Stage 6 | `test_claimant_portal.js` |
| **#26 Push to Debit Card** | R4 | ✔ Test 1.4 | ✔ Test 2.4 | ✔ Test 3.3 | ✔ Stage 6 | `test_claimant_portal.js`, `test_portal_boundaries.js` |
| **#27 Physical Check Rail** | R4 | ✔ Test 1.5 | ✔ Test 2.5 | ✔ Test 3.1 | ✔ Stages 6, 7 | `test_claimant_portal.js`, `test_claimant_expiry_fallback.js` |
| **#28 Deadline Enforcement** | R4 | ✔ Test 1.1 | ✔ Test 2.1 | ✔ Test 3.1 | ✔ Stage 7 | `test_claimant_portal.js`, `test_portal_boundaries.js` |
| **#29 Digital Receipt** | R4 | ✔ Test 1.6 | ✔ Test 2.6 | ✔ Test 3.4 | ✔ Stage 6 | `test_claimant_portal.js` |
| **#30 Dash Batch Generator** | R5 | ✔ Test 1.1 | ✔ Tests 2.1–2.3 | ✔ Tests 3.1, 3.3 | ✔ Stage 8 | `test_dash_sftp.js`, `test_sftp_boundaries.js` |
| **#31 SHA-256 Checksum** | R5 | ✔ Test 1.2 | ✔ Test 2.3 | ✔ Test 3.3 | ✔ Stages 8, 9 | `test_dash_sftp.js` |
| **#32 Dash SFTP Client** | R5 | ✔ Tests 1.3, 1.4 | ✔ Test 2.6 | ✔ Test 3.3 | ✔ Stage 9 | `test_dash_sftp.js`, `test_sftp_reconciliation_cycle.js` |
| **#33 Mock SFTP Server** | R5 | ✔ Tests 1.3, 1.4 | ✔ Test 2.6 | ✔ Test 3.3 | ✔ Stages 9, 10 | `test_dash_sftp.js`, `mock_sftp_server.js` |
| **#34 Status Report Parser** | R5 | ✔ Test 1.5 | ✔ Tests 2.4, 2.5 | ✔ Test 3.3 | ✔ Stage 10 | `test_dash_sftp.js`, `test_sftp_boundaries.js` |
| **#35 Exception Ledger** | R5 | ✔ Test 1.6 | ✔ Test 2.5 | ✔ Test 3.5 | ✔ Stages 10, 12| `test_dash_sftp.js`, `test_exception_resolution_requeue.js` |
| **#36 Agenda Setup** | R6 | ✔ Test 1.2 | ✔ Tests 2.1, 2.2 | ✔ Test 3.1 | ✔ Stages 5, 7 | `test_agenda_scheduler.js`, `test_agenda_boundaries.js` |
| **#37 Dispatch Job** | R6 | ✔ Test 1.4 | ✔ Test 2.3 | ✔ Test 3.4 | ✔ Stage 5 | `test_agenda_scheduler.js` |
| **#38 Reminder Job** | R6 | ✔ Test 1.5 | ✔ Test 2.4 | ✔ Test 3.1 | ✔ Stage 7 | `test_agenda_scheduler.js` |
| **#39 Fallback Job** | R6 | ✔ Test 1.3 | ✔ Test 2.4 | ✔ Test 3.1 | ✔ Stage 7 | `test_agenda_scheduler.js`, `test_claimant_expiry_fallback.js` |
| **#40 Batch Upload Job** | R6 | ✔ Test 1.2 | ✔ Test 2.1 | ✔ Test 3.3 | ✔ Stage 8 | `test_agenda_scheduler.js` |
| **#41 Poll Report Job** | R6 | ✔ Test 1.2 | ✔ Test 2.4 | ✔ Test 3.3 | ✔ Stage 10 | `test_agenda_scheduler.js` |
| **#42 Agendash RBAC Mount** | R6 | ✔ Test 1.1 | ✔ Test 2.5 | ✔ Test 3.6 | ✔ Stage 1 | `test_agenda_scheduler.js`, `test_agenda_boundaries.js` |
| **#43 Delivery Funnel** | R7 | ✔ Test 1.1 | ✔ Tests 2.1, 2.2 | ✔ Test 3.3 | ✔ Stage 11 | `test_analytics.js`, `test_analytics_boundaries.js` |
| **#44 Method Distribution** | R7 | ✔ Test 1.2 | ✔ Test 2.5 | ✔ Test 3.1 | ✔ Stage 11 | `test_analytics.js` |
| **#45 Financial Summary** | R7 | ✔ Test 1.3 | ✔ Test 2.1 | ✔ Test 3.2 | ✔ Stage 11 | `test_analytics.js` |
| **#46 Exception Ledger UI** | R7 | ✔ Tests 1.4, 1.5 | ✔ Tests 2.3, 2.4 | ✔ Test 3.5 | ✔ Stage 12 | `test_analytics.js`, `test_exception_resolution_requeue.js` |
| **#47 CSV Ledger Export** | R7 | ✔ Test 1.6 | ✔ Test 2.5 | ✔ Test 3.3 | ✔ Stage 11 | `test_analytics.js`, `test_analytics_boundaries.js` |

---

## 4. Detailed Tier Inventory Breakdown

### Tier 1: Feature Coverage (39 Tests)
- **`test_auth_rbac.js` (6 tests)**:
  1. Super Admin registration, login, cookie generation, and `/api/auth/me` verification.
  2. Law Firm Admin tenant-scoped session and `lawFirmId` association.
  3. Case Manager user authentication and clean logout session termination.
  4. Auditor / Viewer read-only identity inspection.
  5. 401 Unauthorized rejection on unauthenticated access.
  6. 401 rejection on invalid password without session cookie issuance.
- **`test_ingestion.js` (5 tests)**:
  1. Standard CSV roster parsing and row structure validation.
  2. Disparate header alias normalization (`member_id`, `email_address`, `payment`).
  3. Two-phase upload protocol: Staged preview before database persistence.
  4. Unique 64-hexadecimal token generation per committed claimant.
  5. Excel (`.xlsx`) format ingestion and row validation.
- **`test_quill_sanitization.js` (5 tests)**:
  1. Server-side XSS stripping (`<script>`, `<iframe>`, `onerror=`, `javascript:`).
  2. Preservation of authorized rich tags (`<h1>`, `<p>`, `<strong>`, tables).
  3. Preservation of dynamic merge tags (`{{claimant_first_name}}`, `{{payment_selection_link}}`).
  4. Contextual merge tag resolution with mock claimant values.
  5. Landing page copy configuration with FAQ accordion models.
- **`test_claimant_portal.js` (6 tests)**:
  1. Passwordless tokenized magic link claim record retrieval.
  2. Direct Deposit (ACH) election with Federal Reserve Mod 10 check digit verification.
  3. Digital Prepaid Card election with email and E.164 phone validation.
  4. Push to Debit Card election with cardholder name and Luhn check digit validation.
  5. Mailed Physical Check election with US state and ZIP code validation.
  6. Digital signature capture and instant confirmation receipt generation.
- **`test_dash_sftp.js` (6 tests)**:
  1. Outbound batch CSV generation with Header, Detail rows, and Trailer controls.
  2. SHA-256 companion `.sha256` file generation and cryptographic checksum verification.
  3. SFTP client file transmission to sandboxed mock SFTP server.
  4. Atomic `.tmp` upload staging followed by atomic remote rename.
  5. Inbound reconciliation report parsing (`PAID`, `REJECTED`, `RETURNED`).
  6. Reconciliation exception logging with NACHA return codes (`R02`).
- **`test_agenda_scheduler.js` (5 tests)**:
  1. Agendash UI mount protection behind RBAC (`super_admin`, `law_firm_admin`).
  2. Exact registration of all 5 core Agenda scheduled jobs.
  3. Deadline fallback sweeper job logic (`case:enforce-deadline-fallback`).
  4. Notification dispatch job queuing with rate limiting and concurrency control.
  5. Automated deadline reminders at 7 days and 48 hours prior to deadline.
- **`test_analytics.js` (6 tests)**:
  1. Funnel conversion rate calculations across all 6 stages.
  2. Payment method distribution breakdown by count and dollar amount.
  3. Financial summary metrics (Fund Pool, Claimed, Disbursed, Outstanding).
  4. Filterable exception ledger query by status and error code.
  5. Exception resolution workflow updating status and creating audit trace.
  6. CSV export formatting with RFC 4180 escaping.

### Tier 2: Boundary & Corner Cases (38 Tests)
- **`test_auth_boundaries.js` (5 tests)**:
  1. Empty payload rejection with 400 Bad Request.
  2. 5,000-character excessive password length resilience without crash.
  3. Forged JWT token signature rejection with 401 Unauthorized.
  4. Cross-tenant access denial boundary between distinct law firms.
  5. Rate limiting threshold: Exceeding auth limit decrements remaining count and returns 429.
- **`test_ingestion_boundaries.js` (6 tests)**:
  1. 0-byte empty file upload rejected with explicit error message.
  2. Missing mandatory headers (`Email`, `Amount`) flags schema error.
  3. In-file duplicate Claim IDs identified with line numbers in staged report.
  4. Malformed email addresses flagged with row-level error reports.
  5. Settlement fund variance detected when total allocation exceeds approved fund.
  6. Negative amounts, zero amounts, and NaN values rejected.
- **`test_quill_boundaries.js` (5 tests)**:
  1. Obfuscated SVG event vectors and nested onload handlers stripped.
  2. Null-byte (`\0`) injection neutralized within template strings.
  3. Mismatched and unclosed HTML tags handled gracefully without parser crash.
  4. Deeply nested HTML structures (60+ nested containers) parsed safely.
  5. Unrecognized or unclosed merge tags preserved without breaking template renderer.
- **`test_portal_boundaries.js` (6 tests)**:
  1. Post-deadline payment submission rejected with 403 `DEADLINE_PASSED`.
  2. Mathematical oracle rejects invalid ABA routing numbers (`123456789`, `000000000`, `999999999`).
  3. Mathematical oracle verifies real ABA routing numbers across Federal Reserve districts.
  4. Luhn algorithm oracle rejects invalid Debit Card PANs (single-digit transpositions).
  5. Rejects invalid US state codes (`CAL`, `12`) and malformed ZIP codes.
  6. Non-existent claimant token returns 404 with zero internal metadata leaked.
- **`test_sftp_boundaries.js` (6 tests)**:
  1. Empty detail array rejected (`MIN_RECORDS = 1`).
  2. Control total mismatch ($100.01 declared vs $100.00 calculated) detected and rejected.
  3. Complex names and addresses with quotes and commas escaped per RFC 4180.
  4. 0-byte corrupt reconciliation report handled without unhandled exception.
  5. Inbound report with unmatched `ClaimId` logged as `UNMATCHED_CLAIM_ID`.
  6. SFTP path traversal attempts (`/inbound/../../../etc/passwd`) rejected.
- **`test_agenda_boundaries.js` (5 tests)**:
  1. Concurrency limit locks prevent duplicate concurrent jobs on same case.
  2. Database disconnection handled gracefully without crashing worker process.
  3. Exponential backoff calculation for failed email dispatch retries (up to 1 hour).
  4. Fallback sweeper is strictly idempotent (never re-sweeps settled claimants).
  5. Unauthenticated request to `/agendash` blocked with 401/403.
- **`test_analytics_boundaries.js` (5 tests)**:
  1. Zero-claimant empty case avoids division-by-zero errors (returns 0% rates).
  2. 100% conversion rates handled without rounding overflow.
  3. Exception ledger search with zero matches returns empty array `[]`.
  4. Resolving non-existent exception ID returns 404 Not Found.
  5. CSV export properly quotes complex fields containing semicolons and quotes.

### Tier 3: Cross-Feature Interactions & Pairwise Workflows (6 Tests)
- **`test_claimant_expiry_fallback.js`**: Claimant token expiration + Scheduled Deadline Fallback sweeper + Outbound batch physical check detail generation with verified roster address.
- **`test_excel_variance_rejection.js`**: Excel (`.xlsx`) roster parsing + Multi-row allocation summation + Staged preview rejection when allocations exceed approved pool.
- **`test_sftp_reconciliation_cycle.js`**: Outbound batch generation + Mock SFTP upload + Inbound reconciliation status report seeding + Poller discovery + Status transitions (`PAID` -> `disbursed`, `RETURNED` -> `payment_failed`).
- **`test_quill_dispatch_magiclink.js`**: Quill rich text authoring + HTML sanitization + Merge tag resolution + Nodemailer dispatch + 64-hex token verification in portal.
- **`test_exception_resolution_requeue.js`**: SFTP NACHA `R02` Account Closed return + Exception ledger creation + Case Manager resolution action (`switch_to_check`) + Re-queue for next batch.
- **`test_rbac_tenant_isolation.js`**: RBAC tenant scoping middleware + Case & claimant isolation between Law Firm A and Law Firm B.

### Tier 4: Real-World Application Scenario (1 Test)
- **`test_class_action_lifecycle.js`**: Comprehensive 12-stage class-action settlement lifecycle simulation with 1,000 claimants:
  1. Stage 1: Platform & Tenant Initialization (Super Admin creates Law Firm tenant).
  2. Stage 2: Case Registration ("In re Nexus Consumer Privacy Settlement", $250,000.00 pool).
  3. Stage 3: 1,000-Claimant Roster Ingestion (Two-phase staging, zero variance, 1,000 unique 64-hex tokens).
  4. Stage 4: Quill WYSIWYG Template Authoring & Server-Side Sanitization.
  5. Stage 5: Notification Email Dispatch & Event Tracking (1,000 emails dispatched).
  6. Stage 6: Multi-Cohort Claimant Elections (400 ACH, 250 Digital Card, 150 Push Debit, 100 Physical Check, 100 Non-Responsive).
  7. Stage 7: Deadline Enforcement & Fallback Sweeper (100 non-responsive assigned to physical check).
  8. Stage 8: Dash Solutions Outbound Batch Compilation (1 Header, 1,000 Details, 1 Trailer, $250,000.00 total, SHA-256 companion).
  9. Stage 9: Atomic SFTP Upload to Mock SFTP Server (`.tmp` write + rename + `.sha256` digest).
  10. Stage 10: Inbound Reconciliation & Exception Logging (980 PAID, 10 RETURNED `R02`, 10 REJECTED `CARD_BLOCKED`).
  11. Stage 11: Case Delivery Funnel & Financial Summary Verification ($245,000 disbursed, $5,000 in resolution).
  12. Stage 12: Exception Resolution & Re-Disbursement (All 20 exceptions resolved with audit trace).

---

## 5. Mathematical & Specification Oracles Reference

The test suite incorporates independent mathematical reference implementations to prevent circular testing against implementation code:

1. **Federal Reserve ABA Routing Check Digit (Fed Mod 10)**:
   $$\text{Checksum} = [3(d_1 + d_4 + d_7) + 7(d_2 + d_5 + d_8) + 1(d_3 + d_6 + d_9)] \pmod{10} === 0$$
   Valid prefixes verified: `01`–`12` (Fed districts), `21`–`32` (thrifts), `61`–`72` (wire transfers), `80` (traveler's checks).
2. **Luhn Algorithm (ISO/IEC 7812)**:
   Double alternate digits from right, subtract 9 if $>9$, sum all digits; total must equal $0 \pmod{10}$.
3. **Dash Solutions Batch Trailer Controls**:
   - `totalDetailRecords === detailLines.length`
   - `totalBatchAmount === (amountAch + amountCard + amountDebit + amountCheck)`
   - `routingHashTotal === sum(achRoutingNumbers) % 10000000000`
4. **RFC 4180 Escaping & Checksums**:
   Fields containing quotes, commas, semicolons, or newlines must be surrounded by double quotes, with internal quotes escaped as `""`. Outbound batches accompanied by 64-hex SHA-256 digests.
