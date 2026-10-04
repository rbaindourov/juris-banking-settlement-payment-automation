# JurisBanking Platform Training Videos & UX Operational Guide

This document serves as the comprehensive user training manual and media index for the **JurisBanking Automated Payment Distribution System**. It accompanies high-resolution walkthrough video recordings and high-fidelity poster captures covering every critical user experience (UX) flow across the administrative portal, claimant payment selection experience, and real-time backend observability.

---

## 📽️ Video Training Library Overview

All training videos are encoded in universal web-compatible **H.264 (High Profile, YUV420P, FastStart MP4)** at **1280×720 (720p HD)**. They can be embedded directly in web portals or played via standard media players.

| Video | Title | Duration | File Size | Primary Target Audience | Key Capabilities Demonstrated |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **Flow 1** | [Case Setup & Roster Ingestion](#flow-1-case-setup--claimant-roster-batch-ingestion) | `00:20` | `569 KB` | Law Firm Admin, Case Manager | Case registration, settlement fund pool, CSV ingestion, validation preview |
| **Flow 2** | [Quill WYSIWYG & Localization](#flow-2-quill-wysiwyg-template-designer--localization-engine) | `00:10` | `403 KB` | Claims Administrator, Communications | Rich-text template editor, merge tags, multi-lingual switching (EN, ES, ZH, VI) |
| **Flow 3** | [Claimant Portal & 9 Payment Rails](#flow-3-claimant-magic-link-portal--payment-rails-selection) | `00:39` | `1.25 MB` | Claimants, Customer Support | Passwordless magic link, ABA routing check, 9 payment rails, instant receipt |
| **Flow 4** | [Analytics Dashboard & Agendash](#flow-4-real-time-analytics-dashboard-exception-ledger--agendash) | `00:21` | `722 KB` | Managing Partners, Platform Ops | Delivery funnel, disbursement charts, NACHA exception ledger, Agenda jobs |

---

## Flow 1: Case Setup & Claimant Roster Batch Ingestion

- **Video File**: [`docs/videos/01_case_setup_and_roster_ingestion.mp4`](file:///home/robert/projects/juris-banking/docs/videos/01_case_setup_and_roster_ingestion.mp4)
- **Poster Snapshot**: [`docs/videos/posters/01_case_setup_and_roster_ingestion.jpg`](file:///home/robert/projects/juris-banking/docs/videos/posters/01_case_setup_and_roster_ingestion.jpg)

![Flow 1: Case Setup & Ingestion](posters/01_case_setup_and_roster_ingestion.jpg)

### Objective & Workflow Walkthrough
Demonstrates how a **Law Firm Administrator** logs into the administrative console, creates a new settlement class action matter, establishes the settlement pool parameters, and ingests a multi-record CSV/Excel roster of class members.

### Step-by-Step Training Procedures
1. **Secure Admin Authentication**:
   - Navigate to `/login`.
   - Authenticate with valid firm administrative credentials (`admin@lawfirm.com`).
   - The system establishes an HTTP-only JWT session with Role-Based Access Control (RBAC).
2. **Case Creation**:
   - From the main Case Registry, click **"New Case"**.
   - Input matter parameters:
     - **Case Name**: e.g., *In re National Consumer Privacy Settlement*
     - **Docket Number**: e.g., *1:24-cv-08912-WHA*
     - **Total Settlement Pool**: e.g., *$1,250,000.00*
     - **Disbursement Deadline**: Set the 30-day decision horizon for claimants.
     - **Fallback Payment Rail**: Select default method for non-responsive claimants (e.g., *Physical Check by Mail*).
3. **Claimant Roster Upload & Schema Ingestion**:
   - Navigate to the **"Claimants"** tab within the case.
   - Click **"Import Roster"** and select a formatted CSV or XLSX file (see [`storage/sample_claimants_roster.csv`](file:///home/robert/projects/juris-banking/storage/sample_claimants_roster.csv)).
   - The parser inspects required columns: `Claim ID`, `First Name`, `Last Name`, `Email`, `Phone`, `Address`, `Settlement Amount`.
4. **Validation Preview & Ingestion Verification**:
   - The system displays a live validation summary modal with parsed record counts, total allocated funds, and syntax error checks.
   - Click **"Confirm & Ingest Roster"** to commit records to the database.

---

## Flow 2: Quill WYSIWYG Template Designer & Localization Engine

- **Video File**: [`docs/videos/02_quill_wysiwyg_and_localization.mp4`](file:///home/robert/projects/juris-banking/docs/videos/02_quill_wysiwyg_and_localization.mp4)
- **Poster Snapshot**: [`docs/videos/posters/02_quill_wysiwyg_and_localization.jpg`](file:///home/robert/projects/juris-banking/docs/videos/posters/02_quill_wysiwyg_and_localization.jpg)

![Flow 2: Quill WYSIWYG & Localization](posters/02_quill_wysiwyg_and_localization.jpg)

### Objective & Workflow Walkthrough
Demonstrates how claims administrators author court-approved communication copy, insert dynamic merge tags, preview emails across viewports, and customize multi-lingual landing page copy for diverse claimant communities.

### Step-by-Step Training Procedures
1. **Navigating to Template Management**:
   - Within the active case view, select the **"Templates & Communications"** tab.
2. **Quill WYSIWYG Email Authoring**:
   - Use the rich-text toolbar to customize typography, headers, bullet lists, blockquotes, and brand callouts.
   - Insert dynamic merge tags:
     - `{{claimant_first_name}}` / `{{claimant_last_name}}`
     - `{{settlement_amount}}`
     - `{{selection_deadline}}`
     - `{{payment_selection_link}}` (cryptographic magic link button)
   - Server-side sanitization guarantees zero XSS injection vulnerabilities while preserving court-mandated disclosures.
3. **Multi-Lingual Localization Engine**:
   - Switch language selector tabs between:
     - **English (EN)**
     - **Spanish (ES)**: *Notificación de Acuerdo y Selección de Pago*
     - **Chinese Simplified (ZH)**: *和解金分配通知与付款方式选择*
     - **Vietnamese (VI)**: *Thông Báo Giải Quyết và Lựa Chọn Thanh Toán*
   - Verify that landing page introductory notices, FAQ accordions, and claim instructions dynamically update per locale.
4. **Live Device Preview**:
   - Toggle between **Desktop** and **Mobile** preview frames to ensure optimal responsiveness and legibility across all screen dimensions.

---

## Flow 3: Claimant Magic Link Portal & Payment Rails Selection

- **Video File**: [`docs/videos/03_claimant_portal_and_payment_rails.mp4`](file:///home/robert/projects/juris-banking/docs/videos/03_claimant_portal_and_payment_rails.mp4)
- **Poster Snapshot**: [`docs/videos/posters/03_claimant_portal_and_payment_rails.jpg`](file:///home/robert/projects/juris-banking/docs/videos/posters/03_claimant_portal_and_payment_rails.jpg)

![Flow 3: Claimant Portal & Payment Rails](posters/03_claimant_portal_and_payment_rails.jpg)

### Objective & Workflow Walkthrough
Walks through the entire end-user claimant journey: receiving a secure magic link, inspecting their approved settlement award, comparing all 9 supported payout methods, inputting banking or digital wallet credentials with real-time client-side validation, and receiving an official digital submission confirmation receipt.

### Step-by-Step Training Procedures
1. **Passwordless Magic Link Access**:
   - Claimant accesses their unique URL: `https://portal.domain/claim/{paymentSelectionToken}`.
   - The portal validates the 64-character cryptographic token, retrieving claimant identity, docket information, and exact awarded settlement amount ($450.00).
2. **Reviewing Settlement Terms**:
   - Review case overview, disbursement deadline countdown, and claim identification number.
   - Change display language on-the-fly using the top-right locale switcher.
3. **Selecting Payout Rail (9 Comprehensive Rails Supported)**:
   - **Direct Deposit (ACH)**:
     - Real-time **ABA 9-digit Routing Number** check-digit validation.
     - Account number confirmation and Account Type (Checking vs. Savings).
   - **Digital Prepaid Card (Mastercard / Visa)**:
     - Immediate digital issuance via email or SMS with zero bank account requirement.
   - **Push to Debit (Visa Direct / Mastercard Send)**:
     - Instant funds pushed directly to an existing debit card via sanitized 16-digit card number and expiration.
   - **Mailed Physical Check**:
     - Verify or update official postal address with auto-formatted City, State, and ZIP.
   - **PayPal**:
     - Disbursement to verified PayPal email address.
   - **Venmo**:
     - Disbursement to Venmo handle or registered mobile phone number.
   - **Zelle**:
     - Fast clearing via Zelle registered email or phone number.
   - **Bitcoin (BTC On-Chain)**:
     - Native SegWit / Taproot cryptocurrency address validation for decentralized settlement funds.
4. **Electronic Acknowledgment & Digital Receipt**:
   - Provide typed electronic signature certifying penalty of perjury.
   - Click **"Confirm & Submit Payment Preference"**.
   - Review instant on-screen confirmation receipt complete with Submission Reference ID, timestamp, and downloadable PDF receipt summary.

---

## Flow 4: Real-Time Analytics Dashboard, Exception Ledger & Agendash

- **Video File**: [`docs/videos/04_analytics_dashboard_and_agendash.mp4`](file:///home/robert/projects/juris-banking/docs/videos/04_analytics_dashboard_and_agendash.mp4)
- **Poster Snapshot**: [`docs/videos/posters/04_analytics_dashboard_and_agendash.jpg`](file:///home/robert/projects/juris-banking/docs/videos/posters/04_analytics_dashboard_and_agendash.jpg)

![Flow 4: Analytics Dashboard & Agendash](posters/04_analytics_dashboard_and_agendash.jpg)

### Objective & Workflow Walkthrough
Demonstrates operational command and control for law firm partners and case auditors: real-time disbursement funnels, payment rail distribution charts, the automated NACHA/SFTP exception resolution ledger, and background job scheduling via Agendash.

### Step-by-Step Training Procedures
1. **Executive Settlement Analytics**:
   - Select the **"Analytics & Reporting"** tab on the case dashboard.
   - **Delivery Funnel**: Monitor conversion from *Uploaded* ➔ *Dispatched* ➔ *Delivered* ➔ *Portal Visited* ➔ *Method Selected* ➔ *Disbursed*.
   - **Method Breakdown**: Interactive visualization illustrating payment rail distribution (ACH, Push-to-Debit, Digital Cards, Checks, PayPal, Venmo, Zelle, Bitcoin).
   - **Fund Utilization**: Live tracking of Settled Capital ($) vs. In-Flight Disbursements vs. Outstanding Unclaimed Reserves.
2. **Exception Management & NACHA Returns**:
   - Navigate to the **"Exception Ledger"** table.
   - Review flagged records such as:
     - `R01`: Insufficient Funds / Account Invalid
     - `R03`: No Account / Unable to Locate
     - Bounced email dispatches or undeliverable physical check addresses.
   - Trigger one-click resolution actions: *Resend Notification*, *Update Payment Method*, or *Queue for Fallback Check Disbursement*.
3. **Agendash Job Scheduling Orchestration**:
   - Navigate to the authenticated Agenda Dashboard at `/agendash`.
   - Inspect active, queued, and completed distributed jobs:
     - `case:dispatch-notifications`: Throttled email delivery engine.
     - `case:send-deadline-reminders`: 7-day and 48-hour automated claimant alerts.
     - `case:enforce-deadline-fallback`: Automatic deadline reconciliation sweeper.
     - `sftp:generate-and-upload-batch`: Dash Solutions SFTP transmission engine.
     - `sftp:poll-reconciliation-reports`: Inbound status file polling and settlement reconciliation.

---

## 🛠️ Automated Video Capture Pipeline

All training videos and poster images in this directory are generated completely deterministically using a headless Chromium browser automation pipeline powered by Playwright and FFmpeg.

### Execution Script
The capture pipeline is maintained in [`scripts/capture_training_videos.mjs`](file:///home/robert/projects/juris-banking/scripts/capture_training_videos.mjs).

To re-record or update all training videos from source:
```bash
# Ensure local development prerequisites are running (MongoDB on port 27017)
# Run the automated capture, database seeder, and transcoding pipeline:
node scripts/capture_training_videos.mjs
```

### Video Quality & Compression Parameters
The pipeline executes the following two-stage pipeline:
1. **Lossless Capture**: Playwright records the browser context at native 1280×720 viewport resolution at 60 FPS into WebM format.
2. **Universal Transcoding**: FFmpeg transcodes raw WebM streams into H.264 MP4 using optimal compression flags:
   ```bash
   ffmpeg -y -i input.webm \
     -c:v libx264 -preset slow -crf 20 \
     -pix_fmt yuv420p -movflags +faststart \
     output.mp4
   ```
3. **Poster Extraction**: High-clarity JPEG frame grabs are automatically extracted at optimal action keyframes for use in documentation, training slides, and web preview cards.

---

## 📞 Administrative Support & Inquiries

For technical assistance, workflow customization, or API integrations, refer to:
- Technical Documentation: [`docs/milestone_1_rbac.md`](file:///home/robert/projects/juris-banking/docs/milestone_1_rbac.md) through [`docs/milestone_6_final_hardening.md`](file:///home/robert/projects/juris-banking/docs/milestone_6_final_hardening.md)
- Commercial Licensing & Inquiries: [`LICENSE`](file:///home/robert/projects/juris-banking/LICENSE)
- Lead Architect: Robert Baindourov (`rbaindourov@gmail.com`)
