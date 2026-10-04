# Security Policy

## 🛡️ Supported Versions

We provide security patches and vulnerability updates for the following release branches:

| Version | Supported          |
| :--- | :--- |
| `1.0.x` | :white_check_mark: |
| `main`  | :white_check_mark: |

---

## 🔒 Reporting a Vulnerability

The JurisBanking team takes financial integrity and data security with utmost seriousness. If you discover a security vulnerability or exploit vector within this repository, **please do not disclose it in a public GitHub issue**.

### How to Report:
- Send a detailed vulnerability report via email to **`security@juris-banking.org`** (or contact the maintainers directly through private GitHub security advisories).
- Include:
  - Exact description of the vulnerability (e.g. JWT privilege escalation, formula injection, XSS reflection, race condition).
  - Minimal reproducible proof-of-concept (PoC) code or HTTP curl command.
  - Potential impact and affected endpoints.

### Our Response Commitment:
- **Initial Acknowledgment**: Within 24 hours of receipt.
- **Triage & Reproduction**: Within 48 hours.
- **Patch & Public Advisory**: Coordinated disclosure within 14 days of verification.

---

## 🏛️ Built-in Architectural Security Invariants

JurisBanking is architected with defense-in-depth across every layer:

1. **Mathematical Validation Oracles**:
   - Bank Routing Transit Numbers verified using the Federal Reserve Modulo-10 checksum algorithm.
   - Debit Card Primary Account Numbers (PANs) verified via the Luhn algorithm.
   - Bitcoin addresses validated for Base58Check, Bech32, and Bech32m standards.
2. **Formula Injection Neutralization (CWE-1236)**:
   - All dynamic strings emitted in CSV exports are prefixed with single quotes (`'`) if they begin with `=+-@\t\r`, preventing remote command execution in Microsoft Excel and Google Sheets.
3. **Pre-Substitutive HTML Escaping**:
   - Dynamic merge tags in Quill WYSIWYG legal templates are escaped *before* injection into HTML documents, neutralizing stored XSS and DOM-based injection vectors.
4. **Tokenization & Ephemeral Secrets**:
   - Magic links utilize 64-hex cryptographically signed tokens with expiration timestamps.
   - All SSH/SFTP host keys in mock environments are generated dynamically in-memory without persistent disk storage.
