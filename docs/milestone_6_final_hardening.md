# Milestone 6 Final Integration & Tier 5 Adversarial Hardening Specification

**Document Version**: 1.0.0  
**Date**: 2026-10-04  
**Author**: `teamwork_preview_worker_m6_final`  
**Milestone**: Milestone 6: Final Integration & E2E Acceptance  

---

## 1. Executive Summary

Milestone 6 Final Hardening resolves all empirical white-box findings and race conditions identified during Tier 5 adversarial challenge testing. The hardening addresses seven critical system facets:
1. **Batch Filename Collision Prevention** (`server/src/services/batchGenerator.service.ts`)
2. **Atomic Claimant Batch Reservation** (`server/src/services/batchGenerator.service.ts`)
3. **Portal Payment Re-Election Guard** (`server/src/controllers/portal.controller.ts`)
4. **Regular Expression Special Character Escaping** (`server/src/controllers/case.controller.ts` & `server/src/controllers/reconciliation.controller.ts`)
5. **CSV Formula Injection Neutralization (CWE-1236)** (`server/src/services/csvExport.service.ts`)
6. **Reconciliation Exception Idempotency** (`server/src/services/reconciliation.service.ts`)
7. **Zero-Fund Settlement Overallocation Validation** (`server/src/services/ingestion.service.ts`)

All 41 server test suites (545 tests), a 3-run deterministic test loop, and the master E2E test harness (84/84 tests across Tiers 1–4) pass with 100% success. Both client and server production builds compile cleanly with zero TypeScript errors.

---

## 2. Hardening Implementations

### 2.1 Batch Filename Collision Prevention & Atomic Claimant Reservation
- **Source File**: `server/src/services/batchGenerator.service.ts`
- **Vulnerability**:
  - `spoolToOutbox` previously wrote to a deterministic staging file `${csvPath}.tmp`. Rapid parallel invocations within the same second collided on `.tmp` and threw `ENOENT` during file rename.
  - `compileAndSpoolCaseBatch` queried claimants non-atomically before updating them, allowing concurrent batch runs to double-draw identical claimants into multiple batches.
- **Remediation**:
  1. Generated filenames now incorporate millisecond timestamps and a cryptographic random hex salt (`crypto.randomBytes(3).toString('hex')`):
     `DASH_DISBURSE_${cleanCaseId}_${timestampStr}_${randomSalt}.csv`
  2. The staging path in `spoolToOutbox` uses an isolated random temporary salt:
     `${csvPath}.${crypto.randomBytes(4).toString('hex')}.tmp`
  3. Eligible claimants are reserved atomically via `Claimant.updateMany` setting `status: 'queued_for_sftp'` and assigning `batchId` before the batch payload is generated. Only claimants successfully transitioned by that specific call (`batchId`) are included in the generated batch. Concurrent executions attempting to draw the same claimants find 0 remaining candidates and fail safely with `MIN_RECORDS`.

### 2.2 Portal Status Guard on Payment Re-Election
- **Source File**: `server/src/controllers/portal.controller.ts`
- **Vulnerability**:
  - `selectPaymentMethod` previously checked `if (claimant.status === 'disbursed')`, but did not check `queued_for_sftp` or `batched`. A claimant could re-submit a payment election after their claim had already been bundled into an outbound SFTP batch, reverting their status to `selected` and creating a double-disbursement hazard.
- **Remediation**:
  - `selectPaymentMethod` now rejects elections with HTTP 400 Bad Request if `claimant.status === 'queued_for_sftp' || claimant.status === 'batched'`:
    `"Payment method cannot be changed once disbursement batch processing has begun"`
  - Status `disbursed` continues to return HTTP 400 `ALREADY_DISBURSED`.

### 2.3 Regular Expression Special Character Escaping
- **Source Files**:
  - `server/src/controllers/case.controller.ts` (Case list & Claimant list search queries)
  - `server/src/controllers/reconciliation.controller.ts` (Exception ledger search queries)
- **Vulnerability**:
  - Raw user search parameters containing punctuation characters (such as `(`, `[`, `*`, `+`, `?`, `\`) were passed unescaped to `new RegExp()` or MongoDB `$regex`, throwing `SyntaxError: Invalid regular expression` and triggering HTTP 500 server crashes.
- **Remediation**:
  - Search query strings are sanitized with standard regex character escaping prior to RegExp compilation or MongoDB filtering:
    `const safeSearch = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');`
  - Eliminates unhandled 500 errors and protects against ReDoS vectors on search endpoints.

### 2.4 CSV Formula Injection Neutralization (CWE-1236)
- **Source File**: `server/src/services/csvExport.service.ts`
- **Vulnerability**:
  - `escapeCsvField` only handled RFC 4180 quotes, commas, and newlines. Cells starting with formula injection prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) could execute arbitrary macros or exfiltrate data when legal auditors opened audit CSV exports in Microsoft Excel or LibreOffice Calc.
- **Remediation**:
  - If a value begins with `=+-@\t\r`, `escapeCsvField` prepends a single quotation mark `'`:
    ```ts
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }
    ```
  - Excel and Calc treat the cell strictly as literal text, neutralizing code execution while preserving human legibility.

### 2.5 Reconciliation Exception Idempotency
- **Source File**: `server/src/services/reconciliation.service.ts`
- **Vulnerability**:
  - `reconcileCaseStatusReport` unconditionally created new `ReconciliationException` records for `UNMATCHED`, `REJECTED`, and `RETURNED` records. Re-processing an inbound bank report (e.g. daily scheduled SFTP polling) generated redundant duplicate exception rows in the database.
- **Remediation**:
  - Before logging an exception, the service verifies whether an open, unresolved exception already exists for the identical `caseId`, `claimId`, and `exceptionType`:
    ```ts
    const existing = await ReconciliationException.findOne({
      caseId: caseDoc._id,
      claimId: claimant.claimId,
      exceptionType,
      resolved: false
    });
    if (!existing) {
      await ReconciliationException.create({ ... });
    }
    ```
  - Eliminates duplicate exception tickets across repeated reconciliation cycles.

### 2.6 Zero-Fund Settlement Overallocation Validation
- **Source File**: `server/src/services/ingestion.service.ts`
- **Vulnerability**:
  - `isVarianceExceeded` checked `settlementFundTotal > 0 && fundVariance > 0.001`. For a settlement case configured with `settlementFundTotal: 0`, the check was bypassed, allowing rosters with millions of dollars in allocations to be committed against a zero fund.
- **Remediation**:
  - The variance condition now accounts for zero and negative settlement fund totals:
    ```ts
    const isVarianceExceeded = settlementFundTotal > 0 ? fundVariance > 0.001 : combinedAllocation > 0;
    ```
  - When `settlementFundTotal <= 0 && combinedAllocation > 0`, the upload is blocked (`canCommit: false`) with error code `SETTLEMENT_FUND_OVERALLOCATION`.

---

## 3. Test Suite Alignment & Elevation

In accordance with the "Tests as Anticipated Change Control (Elevate the Baseline)" standard, test assertions in `server/tests/adversarial/m6_tier5_coverage_hardening_1.test.ts` originally authored to prove pre-existing vulnerabilities were updated to assert the hardened behavior:
1. `[CONCUR-03]`: Asserts collision-resistant random hex filenames and atomic mutual exclusion without claimant double-draw.
2. `[BOUND-03]`: Asserts zero-fund overallocation rejection (`canCommit: false`, `SETTLEMENT_FUND_OVERALLOCATION`).
3. `[BOUND-05]`, `[BOUND-06]`, `[BOUND-07]`: Asserts safe HTTP 200 responses on punctuation search queries across cases, claimants, and exceptions.
4. `[STATE-01]`: Asserts HTTP 400 Bad Request when attempting payment election on `queued_for_sftp` claimants.
5. `[STATE-05]`: Asserts exception deduplication maintains exactly 1 exception row upon repeated report ingestion.
6. `[CSV-01]`: Asserts formula triggers (`=+@-`) are neutralized with single quote `'`.

---

## 4. Verification Results Matrix

| Verification Check | Target | Expected | Result |
|---|---|---|---|
| Full Server Unit & Adversarial Tests | `npm test` in `server/` | 41 test files, 545 tests green | **PASS (41/41 files, 545/545 tests)** |
| Deterministic Verification (3x loop) | `for i in 1 2 3; do npm test \|\| exit 1; done` | 3 consecutive runs pass 100% | **PASS (3/3 runs green, 0 flakes)** |
| Master E2E Test Suite | `node tests/e2e/run_all.js` | 84/84 tests across Tiers 1–4 | **PASS (84/84 tests in 0.94s)** |
| Client Production Build | `npm run build --workspace=client` | Vite TypeScript build exit 0 | **PASS (2509 modules transformed, exit 0)** |
| Server Production Build | `npm run build --workspace=server` | TypeScript compiler (`tsc`) exit 0 | **PASS (0 errors, exit 0)** |

---

## 5. Summary of Modified Files

- `server/src/services/batchGenerator.service.ts`: Random hex salt on filenames and staging files; atomic claimant batch reservation.
- `server/src/controllers/portal.controller.ts`: Guard against payment method mutation post-batching (`queued_for_sftp`, `batched`).
- `server/src/controllers/case.controller.ts`: Regex special character sanitization in case and claimant search endpoints.
- `server/src/controllers/reconciliation.controller.ts`: Regex special character sanitization in exception search endpoint.
- `server/src/services/csvExport.service.ts`: Neutralize formula injection prefixes in CSV fields.
- `server/src/services/reconciliation.service.ts`: Deduplicate exception creation across status report reconciliation runs.
- `server/src/services/ingestion.service.ts`: Validate fund overallocation for zero-fund cases.
- `server/tests/adversarial/m6_tier5_coverage_hardening_1.test.ts`: Elevated test suite asserting hardened behavior.
- `docs/milestone_6_final_hardening.md`: In-tree architectural hardening specification.
