# Milestone 1: Core Foundation & RBAC Identity Management Specification

**Project**: Automated Payment Distribution System (`juris-banking`)  
**Status**: Completed  
**Date**: 2026-10-04  
**Author**: `teamwork_preview_worker_m1`

---

## 1. Executive Summary

Milestone 1 establishes the production-grade foundational architecture and Role-Based Access Control (RBAC) Identity Management system for `juris-banking`. The platform is configured as a native npm workspaces monorepo hosting an Express/TypeScript backend running on native Node.js (`v26.5.0`) and connected to a native MongoDB 7.0 instance (`localhost:27017`).

Key deliverables completed in Milestone 1 (including Iteration 2 Remediations):
- Root monorepo workspace configuration (`server`, `client`) with unified build, test, and lifecycle scripts.
- Native MongoDB connection lifecycle manager with automated indexing and test suite environment segregation (`juris_banking` vs `juris_banking_test`).
- Mongoose `User` model with strict role enumeration, safe `toJSON` serialization (zero password leakage), and `bcryptjs` password hashing.
- Cryptographically signed JWT tokens with HttpOnly, SameSite cookie transport and dual-token refresh rotation (`POST /api/auth/refresh`).
- Dual-transport token extraction with automatic fallback from invalid/expired cookies to `Authorization: Bearer <token>` headers.
- Multi-tier RBAC middleware enforcing strict role gates, privilege escalation guards, and multi-tenant body/param/query boundary isolation (`requireTenantScope`).
- Centralized asynchronous controller error handling routing rejections via `next(err)` to Express error middleware with MongoDB/Mongoose error translation.
- Strict Zod schema string bounds (`fullName.max(100)`, `password.max(128)`, `email.max(255)`) protecting against HTTP 431 header and payload overflows.
- Hardened rate limiting on auth endpoints with `max: 5` attempts per window and account/IP key partitioning.
- Comprehensive automated test coverage with 85 Vitest unit/integration/adversarial tests and 84 Master E2E tests achieving 100% pass rates.

---

## 2. Monorepo Architecture & Environment

### 2.1 Workspace Structure

```
juris-banking/
├── package.json              # Monorepo workspaces: ["server", "client"]
├── .gitignore                # Production ignore patterns for node_modules, build, storage, logs
├── .env.example              # Master environment configuration
├── PROJECT.md                # Orchestrator milestone contract & feature inventory
├── docs/
│   └── milestone_1_rbac.md   # Architectural specification & API reference
├── client/
│   └── package.json          # Frontend workspace placeholder
└── server/
    ├── package.json          # Backend dependencies & test scripts
    ├── tsconfig.json         # TypeScript compiler configuration (ES2022)
    ├── vitest.config.ts      # Vitest configuration for unit & integration tests
    ├── src/
    │   ├── config/
    │   │   ├── env.ts        # Zod-validated environment config
    │   │   └── db.ts         # Mongoose native connection manager
    │   ├── models/
    │   │   └── User.ts       # Mongoose User model with role hierarchy
    │   ├── types/
    │   │   └── index.ts      # Role definitions, JWT payloads, Express Request typing
    │   ├── utils/
    │   │   └── jwt.ts        # JWT sign/verify and HttpOnly cookie management
    │   ├── middleware/
    │   │   ├── auth.ts       # authenticateToken, requireRole, requireTenantScope
    │   │   ├── validate.ts   # Zod request schema validator
    │   │   └── rateLimiter.ts# express-rate-limit definitions
    │   ├── controllers/
    │   │   └── auth.controller.ts # Register, login, logout, me handlers
    │   ├── routes/
    │   │   └── auth.routes.ts     # Auth REST endpoints
    │   ├── app.ts            # Express application pipeline
    │   └── server.ts         # Server entrypoint with graceful shutdown
    └── tests/
        ├── helpers/
        │   └── db.ts         # Test database setup/teardown
        ├── unit/
        │   ├── password.test.ts      # bcrypt hashing unit tests
        │   ├── jwt.test.ts           # JWT sign/verify unit tests
        │   └── zodValidation.test.ts # Zod schema validation unit tests
        └── integration/
            ├── auth.test.ts          # Auth API integration tests
            ├── rbac.test.ts          # RBAC & tenant isolation tests
            └── rateLimiter.test.ts   # Rate limiter integration tests
```

### 2.2 Environment Configuration (`.env.example`)

The platform is configured via strongly typed environment variables parsed with Zod:
- `MONGODB_URI`: Production/development connection string (`mongodb://localhost:27017/juris_banking`)
- `MONGODB_URI_TEST`: Isolated test database (`mongodb://localhost:27017/juris_banking_test`)
- `JWT_SECRET`: 256-bit cryptographic signing secret
- `JWT_EXPIRES_IN`: Token validity duration (default: `24h`)
- `COOKIE_SECRET`: Secret key for signed cookie parsing
- `SALT_ROUNDS`: Salt rounds for `bcryptjs` (default: `10`)
- `PORT`: HTTP listener port (default: `5000`)
- `CLIENT_URL`: Trusted frontend origin for CORS (default: `http://localhost:5173`)

---

## 3. RBAC Identity Management & Permissions Model

### 3.1 Role Hierarchy & Scope Matrix

The platform implements five distinct administrative and operational roles:

| Role Identifier | Title | Scope | Capabilities | Restrictions |
|---|---|---|---|---|
| `super_admin` | Super Administrator | Global | Cross-firm case oversight, law firm tenant management, system maintenance, Agendash access | None |
| `platform_admin` | Platform Administrator | Global | System maintenance, scheduler monitoring, infrastructure telemetry | Cannot perform firm-specific case mutations without audit reason |
| `law_firm_admin` | Law Firm Administrator | Single Law Firm (`lawFirmId`) | Create/manage firm settlement cases, upload claimant rosters, design Quill templates, trigger dispatches | Scoped strictly to assigned `lawFirmId`; blocked from global Agendash |
| `case_manager` | Case Manager | Single Law Firm (`lawFirmId`) | Review claimant records, inspect staged ingestion errors, approve roster commits, resolve exception ledgers | Cannot manage tenant users or delete settlement cases |
| `auditor` | Auditor / Compliance | Single Law Firm (`lawFirmId`) | Read-only access to case delivery metrics, disbursement ledgers, reconciliation reports, audit logs | Strictly read-only; cannot modify state or trigger jobs |

### 3.2 User Data Schema (`server/src/models/User.ts`)

| Field | Type | Attributes | Description |
|---|---|---|---|
| `_id` | `ObjectId` | Primary key | Unique user identifier |
| `email` | `String` | Required, Unique, Lowercase, Indexed | Business email address |
| `passwordHash` | `String` | Required | Hashed password (`bcryptjs`, 10 rounds) |
| `role` | `String` | Required, Enum, Indexed | One of: `super_admin`, `platform_admin`, `law_firm_admin`, `case_manager`, `auditor` |
| `lawFirmId` | `String` | Optional, Indexed, Default: `null` | Associated law firm identifier (required for firm-scoped roles) |
| `fullName` | `String` | Required, Trimmed | Legal full name of user |
| `createdAt` | `Date` | Automated timestamp | Creation timestamp |
| `updatedAt` | `Date` | Automated timestamp | Last update timestamp |

**Security Invariant (Serialization)**: The Mongoose schema `toJSON` transform automatically strips `passwordHash` and internal version keys (`__v`), ensuring sensitive cryptographic credentials are never exposed over the network.

---

## 4. Security & Middleware Implementation

### 4.1 Authentication Middleware (`authenticateToken`)
- **Dual-Transport Extraction**: Extracts JWT from either:
  1. Primary: HttpOnly cookie `juris_auth_token` (or legacy `token`).
  2. Fallback: `Authorization: Bearer <token>` header.
- **Graceful Cookie Fallback**: If an invalid or expired cookie is present, rather than failing immediately, the middleware attempts verification against the `Authorization: Bearer <token>` header if provided.
- Verifies signature using `jsonwebtoken` against `JWT_SECRET`.
- Attaches decoded `AuthTokenPayload` to `req.user`.
- Rejects missing, invalid, or expired tokens with `401 Unauthorized`.

### 4.2 Role Enforcement & Privilege Escalation Protection
- **Role Enforcement (`requireRole(allowedRoles)`)**:
  - Compares `req.user.role` against the permitted roles array.
  - If unauthorized, halts the request with `403 Forbidden` returning required vs. current role diagnostics.
- **Privilege Escalation Protection (`register`)**:
  - Disallows unauthenticated public clients from arbitrarily assigning themselves elevated administrative roles (`super_admin` or `platform_admin`).
  - Unless the request originates from an already-authenticated `super_admin` session or an authorized system domain (`@juris-banking.com`, `@juris-test.com`), elevated role requests are automatically neutralized and defaulted to `case_manager`.

### 4.3 Multi-Tenant Scoping Middleware (`requireTenantScope`)
- **Global Roles** (`super_admin`, `platform_admin`): Pass through automatically with global scope (`req.tenantFilter = {}`).
- **Firm-Scoped Roles** (`law_firm_admin`, `case_manager`, `auditor`):
  - Validates that `req.user.lawFirmId` is present (rejects with `403 Forbidden` if unassigned).
  - Performs comprehensive cross-tenant boundary validation across:
    1. URL parameters: `req.params.firmId`, `req.params.lawFirmId`
    2. Body payload: `req.body.lawFirmId`
    3. Query parameters: `req.query.lawFirmId`
  - Blocks cross-tenant mismatch attempts with `403 Forbidden` (`{ error: 'Forbidden: Cross-tenant access denied.' }`).
  - Injects `req.tenantFilter = { lawFirmId: req.user.lawFirmId }` for downstream query scoping.

### 4.4 Rate Limiting & Input Validation
- **Brute-Force Rate Limiting (`authRateLimiter`)**:
  - Protected via `express-rate-limit` with `windowMs: 15 * 60 * 1000` (15 minutes).
  - Maximum failed attempts threshold: `max: 5` attempts per window.
  - Key partitioned by client IP and target account (`${req.ip}_${account}`) to prevent denial-of-service across shared proxies while strictly throttling targeted brute-force attempts.
  - `skipSuccessfulRequests: true` ensures authenticated users do not burn attempt quotas.
- **Strict Bounded Zod Schemas**:
  - `email`: `z.string().trim().email().max(255)`
  - `password`: `z.string().min(8).max(128)`
  - `fullName`: `z.string().trim().min(1).max(100)`
  - Bounded lengths protect the HTTP server and parser from memory exhaustion and HTTP 431 header/payload overflow attacks.
  - Pipeline ordering: `validateRequest` executes before `authRateLimiter` on auth routes to prevent malformed syntax errors from consuming credential attempt quotas.

### 4.5 Centralized Asynchronous Error Handling
- All asynchronous controller handlers (`register`, `login`, `logout`, `getCurrentUser`, `refreshToken`) are wrapped in `try / catch (err) { next(err); }`.
- Centralized error handling middleware in `server/src/app.ts` provides consistent error translation:
  - Mongoose `CastError`: maps to `400 Bad Request` with structured `{ error: 'Invalid ID format', details: err.message }`.
  - MongoDB duplicate key (`err.code === 11000`): maps to `409 Conflict` with `{ error: 'Duplicate entry detected', details: ... }`.
  - Uncaught exceptions: logs stack trace and returns sanitized `500 Internal Server Error`.

---

## 5. REST API Specifications

### 5.1 `POST /api/auth/register`
Creates an initial user or administrator with privilege escalation guards.
- **Request Body**:
  ```json
  {
    "email": "admin@juris-banking.com",
    "password": "SecurePassword123!",
    "fullName": "Alexander Hamilton",
    "role": "super_admin",
    "lawFirmId": null
  }
  ```
- **Response** (`201 Created`):
  ```json
  {
    "success": true,
    "user": {
      "id": "670014b2a8c3d5e...",
      "email": "admin@juris-banking.com",
      "fullName": "Alexander Hamilton",
      "role": "super_admin",
      "lawFirmId": null,
      "createdAt": "2026-10-04T03:00:00.000Z",
      "updatedAt": "2026-10-04T03:00:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
- **Cookies**: Sets HttpOnly `juris_auth_token` and `juris_refresh_token` (and legacy compatibility cookies).

### 5.2 `POST /api/auth/login`
Authenticates user credentials and establishes a dual-token secure session.
- **Request Body**:
  ```json
  {
    "email": "admin@juris-banking.com",
    "password": "SecurePassword123!"
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "user": { ... },
    "token": "...",
    "refreshToken": "..."
  }
  ```
- **Cookies**: Sets HttpOnly `juris_auth_token` and `juris_refresh_token`.

### 5.3 `POST /api/auth/refresh`
Rotates access and refresh tokens using a valid refresh token.
- **Request Body / Cookie**:
  ```json
  {
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
  *(Or HttpOnly cookie `juris_refresh_token` / `refreshToken`)*
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
- **Error Response** (`401 Unauthorized`): If refresh token is missing, invalid, or expired.

### 5.4 `POST /api/auth/logout`
Terminates user session and clears all session cookies.
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Logged out successfully"
  }
  ```
- **Cookies**: Clears `juris_auth_token`, `juris_refresh_token`, and legacy `token` cookies.

### 5.5 `GET /api/auth/me`
Retrieves current authenticated profile from cookie or Bearer token.
- **Headers / Cookie**: Requires active session.
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "user": { ... }
  }
  ```

---

## 6. Verification & Automated Test Results

The test suite consists of Vitest unit, integration, and adversarial tests running with isolated worker execution (`fileParallelism: false`) against native MongoDB on port 27017, alongside the full End-to-End test suite:

### 6.1 Vitest Backend Test Suite (`npm test` in `server/`)
```
Test Files  8 passed (8)
Tests       85 passed (85)
```

| Test File | Tier | Coverage Area | Tests | Status |
|---|---|---|---|---|
| `tests/unit/password.test.ts` | Unit | `bcryptjs` hashing, salting, password match and mismatch verification | 3 | PASS |
| `tests/unit/jwt.test.ts` | Unit | JWT payload signing, token verification, tampering rejection, expiration | 4 | PASS |
| `tests/unit/zodValidation.test.ts` | Unit | Registration and login Zod schemas, bounds checks, email validation, role constraints | 10 | PASS |
| `tests/integration/auth.test.ts` | Integration | Registration, login, logout, me, refresh endpoint, token fallback, HttpOnly cookies | 15 | PASS |
| `tests/integration/rbac.test.ts` | Integration | 5-role hierarchy gates, cross-tenant isolation, unauthorized 403 enforcement | 11 | PASS |
| `tests/integration/rateLimiter.test.ts` | Integration | Rate limiting threshold (5 attempts), 429 Too Many Requests response verification | 1 | PASS |
| `tests/adversarial/m1_adversarial.test.ts` | Adversarial | Injection attacks, privilege escalation, parameter tampering, cross-tenant leaks | 19 | PASS |
| `tests/adversarial/adversarial_challenge.test.ts` | Adversarial | Security boundary challenges, malformed tokens, tenant bypass regressions | 22 | PASS |

### 6.2 Master E2E Runner (`node tests/e2e/run_all.js`)
```
==================================================
Juris Banking - Master E2E Test Suite
==================================================
Starting test execution against: http://localhost:5000/api
...
Passed: 84 / 84
Failed: 0 / 84
Success Rate: 100.0%
🎉 ALL TESTS PASSED! Platform is ready for deployment.
```

All 85 Vitest tests and all 84 E2E tests pass with zero warnings, zero deprecations, and zero failures.

