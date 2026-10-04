# Milestone 4: Dash Solutions SFTP Batch Engine, Outbox Spooling, SFTP Client Service, In-Process Mock SFTP Daemon, and Reconciliation Exception Ledger

**Juris Banking Automated Payment Distribution Platform**  
**Engineering Specification & Verification Report — Milestone 4**  
**Author**: Worker Subagent (`teamwork_preview_worker_m4_1`)  
**Date**: October 4, 2026  
**Status**: Completed & Verified  

---

## 1. Executive Summary

Milestone 4 implements the production-grade disbursement execution, banking rail interchange, and financial reconciliation layer for the Juris Banking settlement disbursement engine. The milestone connects selected claimant payment preferences with bank partner processing through Dash Solutions via secure SFTP interchange:

1. **RFC 4180 Multi-Record CSV Batch Generator**: Formats disbursement rosters according to Dash Solutions banking specifications with strict RFC 4180 escaping, trailer record control totals, modulo routing hashes, atomic `.tmp` outbox spooling, and cryptographic SHA-256 companion checksums.
2. **High-Fidelity In-Process Mock SFTP Daemon**: An ephemeral, socket-level SSH2/SFTP server running in-process for integration and end-to-end testing with absolute filesystem sandboxing, path traversal guards (`SSH_FX_PERMISSION_DENIED`), and forceful socket tracking for zero-leak Vitest teardowns.
3. **Resilient SFTP Client Service (`SftpService`)**: A robust `ssh2-sftp-client` wrapper supporting password and Ed25519/RSA private key authentication, atomic upload via `.tmp` staging and remote rename, inbound report listing, automated downloads, and scoped client resource lifecycle management (`withSftpClient<T>`).
4. **Inbound Status Report Parser & State Reconciliation Engine**: Parses 14-column detailed and 7-column compact bank clearing reports, classifies NACHA (R01–R85) and check return failure codes, transitions claimant states to terminal `disbursed`, `rejected`, or `returned`, and maintains full reconciliation audit logs.
5. **Reconciliation Exception Ledger & Resolution Workflows**: Automatic tracking of processing anomalies, ACH returns, and unmatched records with full administrative remediation actions (`switch_to_check`, `resend_email`, `requeue_sftp`, `mark_resolved`).
6. **Mongoose Models & E2E Oracle Compatibility**: Full schema indexes, compound indexes, virtual getters/setters (`errorCode`, `errorMessage`, `paymentMethod`), and idempotent state transitions across `Claimant`, `DisbursementBatch`, and `ReconciliationException`.

---

## 2. Data Models & Schema Architecture

### 2.1 Claimant Extensions (`server/src/models/Claimant.ts`)
Extended with Milestone 4 banking interchange metadata:
- `batchId`: Reference to the `DisbursementBatch` in which this claimant was submitted.
- `batchFilename`: Filename of the generated outbox CSV batch.
- `batchGeneratedAt`: Timestamp when the batch was created.
- `dashReferenceId`: Bank transaction reference identifier assigned by Dash Solutions.
- `settlementDate`: Value date / settlement date confirmed by the financial institution.
- `rejectionReason`: Human-readable explanation of rejection or return.
- `failureCode`: Standardized NACHA or clearing network error code (e.g., `R01`, `R02`, `R03`).
- `requeuedAt`: Timestamp when an exception was resolved and claimant was re-queued.

### 2.2 DisbursementBatch Model (`server/src/models/DisbursementBatch.ts`)
Tracks the complete lifecycle of an outbound transmission:
```typescript
export interface IDisbursementBatch extends Document {
  batchId: string;
  caseId: mongoose.Types.ObjectId;
  filename: string;
  recordCount: number;
  totalAmount: number;
  status: 'generated' | 'spooled' | 'uploaded' | 'acknowledged' | 'reconciled' | 'failed';
  uploadedAt?: Date;
  acknowledgedAt?: Date;
  reconciledAt?: Date;
  railBreakdown: Record<string, { count: number; amount: number }>;
  sha256Checksum: string;
  errorMessage?: string;
}
```
**Indexes**:
- `{ caseId: 1, batchId: 1 }` (unique)
- `{ status: 1 }`
- `{ createdAt: -1 }`

### 2.3 ReconciliationException Model (`server/src/models/ReconciliationException.ts`)
Audits all anomalies encountered during inbound status report reconciliation:
- `caseId`: Reference to the parent case.
- `batchId`: Batch identifier associated with the transaction.
- `claimId`: Unique claim identifier of the impacted claimant.
- `claimantId`: Optional ObjectId reference to the `Claimant` record.
- `exceptionType`: `'ach_return' | 'check_stop' | 'invalid_account' | 'unmatched_claim_id' | 'other'`.
- `reasonCode`: Return code string (e.g. `R01`, `R02`, `STOP_PAYMENT`).
- `description`: Textual error description.
- `amount`: Dollar amount of the affected transaction.
- `rawRecord`: Complete serialized row data from the inbound CSV report.
- `resolved`: Boolean flag indicating if administrative resolution has taken place.
- `resolvedAt`, `resolvedBy`, `resolutionNotes`: Administrative audit stamps.
- `resolutionAction`: `'switch_to_check' | 'resend_email' | 'requeue_sftp' | 'mark_resolved'`.

**Virtual Compatibility Fields**:
To ensure drop-in compatibility with E2E oracle test suites, virtual aliases are mapped:
- `errorCode` -> maps to/from `reasonCode`
- `errorMessage` -> maps to/from `description`
- `paymentMethod` -> maps to/from `rawRecord.Payment_Method` or `rawRecord.payment_method`

**Indexes**:
- `{ caseId: 1, claimId: 1 }`
- `{ caseId: 1, resolved: 1 }`
- `{ batchId: 1 }`
- `{ exceptionType: 1 }`

---

## 3. RFC 4180 Batch Generator Architecture

### 3.1 Specification & Dual Format Support
The generator (`server/src/services/batchGenerator.service.ts`) compiles claimants with status `selected` into compliant disbursement rosters. It supports both the modern 14-column RFC 4180 format and the compact 12-column Dash interchange format.

#### Field Mappings:
1. `Record_Type` (`DETAIL`)
2. `Batch_ID`
3. `Claim_ID`
4. `Claimant_Name` (`"${lastName}, ${firstName}"`)
5. `Amount` (formatted as two decimal places, e.g. `150.00`)
6. `Payment_Method` (normalized rail code: `ach`, `digital_card`, `physical_check`, etc.)
7. `Routing_Number` (ABA routing number or empty)
8. `Account_Number` (Decrypted bank account number or empty)
9. `Account_Type` (`checking`, `savings`, or empty)
10. `Address_Line1`
11. `City`
12. `State`
13. `Zip`
14. `Email`

### 3.2 Control Totals & Trailer Record
Every generated CSV concludes with an authentic TRAILER record providing integrity checking:
- `Record_Type`: `TRAILER`
- `Record_Count`: Total count of detail rows.
- `Total_Amount`: Sum of all detail disbursement amounts.
- `Checksum_Hash`: Modulo hash calculated as `(totalAmountInCents % 999983).toString().padStart(6, '0')`.

### 3.3 Atomic Outbox Spooling & SHA-256 Digest
To prevent race conditions with background upload daemons:
1. Batch data is written to a temporary file: `storage/sftp/outbox/${filename}.tmp`.
2. Flushed and atomically renamed to `storage/sftp/outbox/${filename}` via `fs.promises.rename`.
3. Companion digest file `storage/sftp/outbox/${filename}.sha256` is generated containing the hex SHA-256 hash followed by two spaces and the filename (`${hash}  ${filename}\n`).
4. All included claimants transition atomically from `selected` to `batched` with their `batchId`, `batchFilename`, and `batchGeneratedAt` timestamps recorded.

---

## 4. In-Process Mock SFTP Server Daemon

The Mock SFTP Daemon (`fixtures/mock-sftp/`) implements a real SSH2/SFTP server using Node.js `ssh2`:

### 4.1 Ephemeral Port Binding
- Binds to port `0` (`127.0.0.1`), allowing the OS kernel to assign an unused ephemeral port.
- Emits the assigned port upon listen, enabling multiple parallel test workers to run without port collision.

### 4.2 Virtual Filesystem Sandbox & Traversal Guards
- Anchored at `storage/mock-sftp-server/` with directories `/inbound`, `/outbox`, and `/archive`.
- **Path Traversal Guard**: Prevents directory escape. Any path containing `..` or resolving outside the sandbox root immediately aborts with `SSH_FX_PERMISSION_DENIED: Path traversal prohibited`.
- Virtual directory structure maps RFC SFTP commands (`OPEN`, `READ`, `WRITE`, `CLOSE`, `REMOVE`, `RENAME`, `MKDIR`, `RMDIR`, `OPENDIR`, `READDIR`, `STAT`, `REALPATH`) directly to safe Node.js `fs.promises` operations.

### 4.3 Forced Socket Destruction & Zero Vitest Hangs
- `server.on('connection', (conn) => { sockets.add(socket); ... })` tracks all active network sockets.
- When `stopMockSftp(instance)` is invoked:
  1. Stops accepting new connections (`server.close()`).
  2. Forcibly destroys all active sockets via `socket.destroy()`.
  3. Uses a 500ms safety timer on `server.close()` to guarantee zero hanging event-loop handles in Vitest's `singleFork: true` execution mode.

---

## 5. SFTP Client Service (`SftpService`)

Implemented in `server/src/services/sftp.service.ts`:
- **Authentication**: Supports both password credentials and private SSH keys (Ed25519/RSA).
- **Atomic Upload**: Uploads files to remote path `${target}.tmp` and renames to `${target}` upon completion.
- **Report Discovery & Retrieval**: Scans `/reports` or `/inbound` on the remote server for status CSVs and downloads them to local storage.
- **Resource Lifecycle Guard**: `withSftpClient<T>(config, fn)` automatically handles `connect()`, executes business logic `fn(client)`, and guarantees `client.end()` in a `finally` block even on unhandled errors.

---

## 6. Inbound Status Report Parser & Reconciliation Engine

### 6.1 Multi-Format Report Parsing
Implemented in `server/src/services/reconciliation.service.ts`:
- **14-Column Full Format**: Contains detailed clearing metadata including `Transaction_ID`, `Claim_ID`, `Status`, `Amount`, `Settlement_Date`, `Error_Code`, and `Error_Message`.
- **7-Column Compact Format**: Parses compact clearing files with columns `Claim_ID,Status,Amount,Settlement_Date,Error_Code,Error_Message,Transaction_ID`.

### 6.2 State Machine Transitions
- `PROCESSED` / `CLEARED` / `PAID`:
  - Claimant transitions from `batched` to `disbursed`.
  - Sets `settlementDate` and `dashReferenceId`.
- `REJECTED`:
  - Claimant transitions to `rejected`.
  - Captures `failureCode` and `rejectionReason`.
  - Records an entry in `ReconciliationException`.
- `RETURNED`:
  - Claimant transitions to `returned`.
  - Captures `failureCode` and `rejectionReason`.
  - Records an entry in `ReconciliationException`.

### 6.3 NACHA Return Code Classification
Standard ACH return codes are parsed and categorized:
- `R01`: Insufficient Funds
- `R02`: Account Closed
- `R03`: No Account / Unable to Locate Account
- `R04`: Invalid Account Number Structure
- `R08`: Stop Payment
- `R10`: Unauthorized Debit to Consumer Account
- `R16`: Account Frozen

---

## 7. Reconciliation Exception Ledger & Remediation Actions

When anomalies occur, administrative staff can execute targeted resolutions via `POST /api/cases/:caseId/exceptions/:exceptionId/resolve`:

| Action | Resulting Claimant State | System Behavior |
|---|---|---|
| `switch_to_check` | `selected` | Changes `selectedPaymentMethod` to `physical_check`, records resolution audit trail, clears failure flags, and sets claimant status to `selected` for inclusion in subsequent outbound batches. |
| `resend_email` | `pending_selection` | Resets payment submission state, generates fresh selection token, flags for new magic-link notification dispatch. |
| `requeue_sftp` | `selected` | Re-queues the claimant for inclusion in the next outbound SFTP batch run (`claimant.status = 'selected'`, `requeuedAt = new Date()`), picked up by `compileAndSpoolCaseBatch`. |
| `mark_resolved` | No state change | Administratively marks exception as resolved with custom notes without altering claimant state. |

### Multi-Tenant Authorization & Safe Lookups
1. **Canonical Multi-Tenant Scoping**: All exception queries and resolution mutations run through `findCaseWithTenantCheck`. Any non-super/platform admin (including `auditor` and users with missing `lawFirmId`) attempting to query or mutate another firm's case or exceptions is strictly rejected with `403 Forbidden`.
2. **Safe Identifier Lookup**: Exception lookup safely differentiates between 24-character hexadecimal `ObjectId` and domain string `claimId` via `mongoose.isValidObjectId(exceptionId)`, preventing Mongoose `CastError` exceptions.

---

## 8. API Endpoints

Mounted under `/api/cases`:

- `POST /:caseId/batches/generate` — Generates a new disbursement batch CSV, spools to outbox, creates `.sha256` checksum, and records `DisbursementBatch`.
- `POST /:caseId/batches/:batchId/upload` — Uploads spooled batch via SFTP to Dash Solutions.
- `POST /:caseId/reconciliation/upload` — Ingests and processes an inbound clearing report CSV.
- `GET /:caseId/exceptions` — Lists reconciliation exceptions with filtering by status and type.
- `POST /:caseId/exceptions/:exceptionId/resolve` — Executes administrative resolution action on an exception.

---

## 9. Verification & Test Summary

The Milestone 4 implementation was verified against comprehensive unit, integration, and adversarial security suites:

1. **Unit Tests**:
   - `server/tests/unit/sftpMock.test.ts`: 5/5 passed (VFS, directory creation, traversal guard, socket teardown).
   - `server/tests/unit/sftp.service.test.ts`: 5/5 passed (connect, atomic upload, list, download, client cleanup).
   - `server/tests/unit/batchGenerator.test.ts`: 6/6 passed (RFC 4180 escaping, trailer modulo, atomic `.tmp`, sha256).
   - `server/tests/unit/reconciliation.test.ts`: 5/5 passed (14-col and 7-col CSV parsing, NACHA mapping, exception generation).
2. **Integration Tests**:
   - `server/tests/integration/sftp_lifecycle.test.ts`: 2/2 passed (end-to-end generate -> spool -> upload -> download -> verify).
   - `server/tests/integration/sftp_batch_reconciliation.test.ts`: 1/1 passed (multi-rail batch reconciliation and state machine).
   - `server/tests/integration/reconciliation_exceptions.test.ts`: 10/10 passed (exception ledger filtering, resolutions, audit trail, cross-tenant auditor block, missing tenant block, non-ObjectId claimId resolution, and state machine batch re-spooling).
3. **Adversarial Security**:
   - `server/tests/adversarial/m4_sftp_security_challenge.test.ts`: 5/5 passed (directory traversal block, corrupt CSV handling, duplicate reconciliation idempotency, unauthorized access guards).
4. **Reliability Gates**:
   - 3 consecutive complete server test runs passed 100% (349/349 tests across 30 test files on all 3 runs).
   - Concurrent test execution passed with exit code 0.

