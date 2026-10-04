# Contributing to JurisBanking

Thank you for your interest in contributing to **JurisBanking: Settlement Payment Automation**! We welcome contributions from developers, legal operations engineers, and financial systems specialists.

As a platform that manages real-world legal settlements and financial disbursements, our codebase adheres to strict engineering invariants, mathematical precision, and zero-defect testing standards.

---

## 🏛️ Code of Conduct

All contributors must adhere to our [Code of Conduct](CODE_OF_CONDUCT.md). Please report unacceptable behavior to security@juris-banking.org.

---

## 🛠️ Development Workflow

### 1. Fork & Branch
- Fork the repository on GitHub.
- Create a dedicated feature branch from `main`:
  ```bash
  git checkout -b feat/add-stripe-payout-rail
  ```

### 2. Conventional Commits
All commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:
- `feat(...)`: A new feature or payment rail
- `fix(...)`: A bug fix or security patch
- `test(...)`: Adding or refactoring tests
- `docs(...)`: Documentation updates
- `refactor(...)`: Code change that neither fixes a bug nor adds a feature

*Blanket `git add -A` is prohibited. Always audit staged diffs line-by-line before committing.*

### 3. Strict Deterministic Testing Invariant
Every contribution touching server logic, models, or payment rails MUST pass all test suites deterministically:

```bash
# Run server test battery (41 files, 545 tests)
cd server
npm test

# Run master end-to-end acceptance suite (84 tests)
cd ..
npm run test:e2e

# Run client & server builds
npm run build
```

#### Test Guidelines:
- Tests must use isolated MongoDB database namespaces (`server/tests/helpers/db.ts`).
- Never introduce open socket leaks, un-awaited Supertest promises, or shared-database teardown races.
- If introducing a new payment rail or validator, implement a corresponding mathematical oracle in `server/tests/unit/portalValidation.test.ts`.

---

## 🛡️ Security & Privacy Requirements

1. **Zero Hardcoded Secrets**: Never commit real API keys, private keys, or passwords. Use `.env.example` as a template.
2. **Formula Injection Defense**: All user-controlled fields exported to CSV must be wrapped or escaped to prevent spreadsheet injection (CWE-1236).
3. **No PII/PCI Persistence**: Never store raw credit/debit card numbers (PANs) or unencrypted banking details in plain text.

---

## 📬 Submitting a Pull Request

1. Ensure all 545 backend tests and 84 E2E tests pass 100% green.
2. Ensure both `client` and `server` compile with zero TypeScript errors.
3. Push your branch and open a Pull Request against `main`.
4. Provide a clear description of the problem, solution, and automated tests added.
