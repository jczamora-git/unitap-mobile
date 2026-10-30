# UniTap — Capstone Demonstration Guide

**Project:** UniTap — NFC-Powered CSG Attendance, Event Management, and Student Transactions  
**Target:** Android Mobile Prototype (Offline-First)  
**Package ID:** `com.nfcinspector.app`  
**Display Name:** UniTap  

---

## 1. Overview & Demonstration Architecture

UniTap is designed for student government officers (CSG) to streamline attendance logging, event tracking, and student fee collections using university-issued RFID/NFC student IDs.

All operational data is persisted locally on the Android device via `@capacitor/preferences`. No external cloud or backend (Supabase/Firebase) is required for this prototype.

### Core Demonstration Flow
```
Register Student / Load Sample Data
       ↓
Link / Tap Physical NFC Card
       ↓
Create CSG Event & Audience Session
       ↓
Open Attendance Session & Scan Student ID
       ↓
Verify Live Status (Present / Late / Duplicate)
       ↓
Close Attendance (Pending → Absent Conversion)
       ↓
Issue Fee / Obligation (e.g. Cleanup Absence ₱20)
       ↓
Top Up Simulated Wallet (Demo Credits)
       ↓
NFC-Assisted / Manual Fee Payment
       ↓
Inspect Updated Ledger & Financial Analytics
```

---

## 2. Launching UniTap

### On an Android Device / Emulator
1. Install the debug APK (`app-debug.apk`) built from `android/app/build/outputs/apk/debug/app-debug.apk`.
2. Launch **UniTap** from the Android home screen or app launcher.
3. Grant NFC permission if prompted (standard Android permission `android.permission.NFC`).

### In Local Web / Dev Preview (For UI Inspection)
```bash
npx pnpm dev
```
Open `http://localhost:5173` in Chrome or modern mobile browser emulation mode (Pixel 7 / Galaxy S20).

---

## 3. Step-by-Step Demonstration Script

### Step 1: Pre-loading Demo Data (Optional but Recommended)
If you want instant sample data with pre-configured events, sections, and historical fees:
1. Navigate to **Home** → tap the **Gear icon (Settings & Diagnostics)** in the top right.
2. Under **Demo & Sample Data**, tap **Load Sample Data**.
3. A confirmation alert will confirm that sample students, CSG events, and charge templates have been seeded idempotently.
4. Return to **Home** to see updated dashboard metrics (Active events, registered students, outstanding charges).

---

### Step 2: Registering a New Student
1. Tap the **Students** tab in the bottom navigation bar.
2. Tap the **"+" (Add)** button in the top right header.
3. Complete the registration form:
   - **Student Number:** e.g., `2024-10492`
   - **First Name:** `Juan`
   - **Middle Name:** `Protacio` (optional)
   - **Last Name:** `Dela Cruz`
   - **Course:** `BSIT`
   - **Year Level:** `3`
   - **Section:** `3A`
4. Tap **Save Student**.
5. You are redirected back to the Student Directory, where the new student is listed.

---

### Step 3: Linking a University NFC Card to a Student
1. In the **Students** tab, tap the newly created student (`Juan Dela Cruz`).
2. In the **NFC Card** card section, tap **Link / Replace NFC Card**.
3. Hold the university student ID or NFC tag to the back of the Android device.
   - The scanner detects the tag, normalizes the hardware UID (e.g., `04:A1:B2:C3:D4:E5:F6`), and confirms readiness.
4. Tap **Save Card Assignment**.
5. The card status changes to **Active** with the timestamp and normalized UID recorded in the student's card history.

> **Note on Duplicate Prevention:** If the tapped NFC card is already linked to another active student, UniTap immediately displays an error badge and blocks assignment, preventing card collisions.

---

### Step 4: Creating a CSG Event & Attendance Session
1. Tap the **Events** tab in the bottom navigation bar.
2. Tap the **"+"** button to open the **Create Event** page.
3. Fill in the event details:
   - **Title:** `General Assembly 2026`
   - **Event Type:** `General Assembly`
   - **Target Audience:** Select `All BSIT Students` or `Specific Year Level / Section` (e.g., `3A`).
   - **Event Date:** Defaults to today.
   - **Start Time:** e.g., `08:00 AM`.
   - **End Time:** e.g., `12:00 PM`.
   - **Grace Period:** `15` minutes (used to distinguish **Present** vs **Late**).
4. Tap **Create Event**.
5. In the Event Details view, tap **Add Session / Occurrence** to schedule a session, or tap **Open Session** on an existing scheduled session.
6. The session status switches to **OPEN**. Expected participants are automatically resolved from enrolled students in the audience.

---

### Step 5: Recording NFC Attendance
1. Tap the **Scan** tab in the bottom navigation bar.
2. The active open session (`General Assembly 2026`) is automatically selected (or select it from the dropdown if multiple sessions are active).
3. Tap **Start NFC Scanner** (on Android, background scanning begins automatically).
4. Tap the student's university ID to the back of the device:
   - **Case A — On-Time Arrival:** Displays green **Accepted: Present** banner with student photo placeholder, full name, student number, and section.
   - **Case B — Late Arrival (Past Grace Period):** Displays amber **Accepted: Late** banner with check-in timestamp.
   - **Case C — Double Tap (Duplicate):** Tapping the card again displays yellow **Duplicate Scan** notice (`Student is already checked in for this session`). Only 1 attendance record is saved.
   - **Case D — Unregistered Card:** Tapping an unregistered tag displays red **Unregistered Card** warning.
   - **Case E — Ineligible Student:** If the event is restricted to Section 3A and a Section 1A student taps, displays **Not Eligible** notice.
5. Watch the session counters dynamically increment (**Expected**, **Present**, **Late**, **Pending**).

---

### Step 6: Closing the Attendance Session
1. Return to the **Events** tab and open the active event.
2. Tap **Close Attendance Session** and confirm.
3. **Automatic Finalization:** All remaining expected students whose status was `PENDING` are automatically converted to `ABSENT`.
4. The attendance roster updates to show final counts: Present, Late, and Absent.
5. If an officer needs to manually excuse a student (e.g., medical certificate), tap the student row in the roster, select **Excused**, and enter a mandatory reason. The action is audited in the session activity log.

---

### Step 7: Issuing a Student Charge / Fee
1. Tap the **Finance** tab in the bottom navigation bar.
2. Under Quick Actions, tap **Issue Charge**.
3. Select the student (`Juan Dela Cruz`).
4. Select a template (e.g., `Cleanup Absence — ₱20.00` or `Sportsfest Contribution — ₱25.00`) or select *Custom Charge*.
5. Enter amount (e.g., `₱20.00`) and remarks (e.g., `Unexcused absence at clean-up drive`).
6. Tap **Issue Charge**.
7. The student now has an **UNPAID** obligation of ₱20.00.

---

### Step 8: Adding Demo Wallet Credits (Simulated Top-Up)
1. In the **Finance** tab, tap **Student Wallets**.
2. Select `Juan Dela Cruz`.
3. Tap **Top Up Demo Wallet**.
4. Enter top-up amount (e.g., `₱100.00`) and note (e.g., `Demo cash replenishment at CSG booth`).
5. Tap **Confirm Top Up**.
6. The wallet ledger immediately records a `TOP_UP` entry. The balance is dynamically computed as `₱100.00`.
7. Notice the prominent banner: *"Prototype — Simulated Transactions Only. No actual currency is transferred."*

---

### Step 9: Processing an NFC-Assisted Payment
1. In the **Finance** tab, tap **Make Payment**.
2. Identify the student:
   - Tap **Scan NFC Card** and tap the student's ID (or search and tap student name manually).
3. The app loads the student's unpaid charges (₱20.00) and available wallet balance (₱100.00).
4. Check the box next to the ₱20.00 charge.
5. Tap **Review Payment**.
6. Confirm the allocation summary:
   - *Total to Pay:* ₱20.00
   - *Wallet Balance After:* ₱80.00
7. Tap **Confirm Payment**.
8. A success receipt appears showing the unique reference number (e.g., `PAY-20261013-XXXX`).
9. The charge status is updated to **PAID**, and a `PAYMENT` ledger deduction is recorded.

---

### Step 10: Inspecting Dashboards & History
1. **Home Dashboard:** Shows live totals for registered students, completed check-ins, active events, and outstanding balances.
2. **Student Profile:** Open `Juan Dela Cruz` to see full 360° overview:
   - Academic info and active NFC card UID.
   - Attendance history for all CSG events attended.
   - Current wallet balance (₱80.00) and transaction history.
   - Settled obligations and receipts.
3. **NFC Diagnostics:** Accessible from the Settings gear icon, demonstrating raw hardware UID stability, ATR, and frame reading for technical capstone defense.

---

## 4. Implementation Status Matrix

| Module / Feature | Implementation Status | Storage / Engine | Notes |
| :--- | :--- | :--- | :--- |
| **NFC Hardware Integration** | IMPLEMENTED | `@capgo/capacitor-nfc` | Native Android NFC reader with debounce & UID normalization. Tested with university ID cards. |
| **Student Directory & Profiles** | IMPLEMENTED | `@capacitor/preferences` (`nfc_inspector_students_v1`) | Full CRUD, unique student numbers, legacy data preservation. |
| **NFC Card Lifecycle Management** | IMPLEMENTED | Local student records | ACTIVE, LOST, REPLACED, DEACTIVATED states; collision prevention. |
| **CSG Event Management** | IMPLEMENTED | `@capacitor/preferences` (`unitap_events_v1`) | Events, Schedules, Occurrences, Audience filtering (All / Year / Section). |
| **Live Attendance Scanning** | IMPLEMENTED | `@capgo/capacitor-nfc` | On-time/Late evaluation, duplicate rejection, non-eligible alerts, live counts. |
| **Session Finalization** | IMPLEMENTED | Event service | Automatically marks pending participants as Absent upon session closure. |
| **Manual Attendance Correction** | IMPLEMENTED | Event service | Officer override with audit trail & reason logging. |
| **Charge Templates & Issuance** | IMPLEMENTED | `@capacitor/preferences` (`unitap_finance_v1`) | Pre-configured and custom obligations (₱ centavos). |
| **Simulated Student Wallet** | IMPLEMENTED | Double-entry ledger (`unitap_finance_v1`) | Top-up, ledger audit trail, non-floating-point centavo math. |
| **NFC-Assisted Payment** | IMPLEMENTED | Atomic financial document | Two-step NFC identification + payment confirmation, partial & multi-charge payments. |
| **Demo Data Seeding & Reset** | IMPLEMENTED | Demo Data service | Idempotent sample population for rapid presentation. |
| **Hardware Diagnostics** | IMPLEMENTED | Diagnostics / Scanner components | Preserved from original NFC Inspector for hardware testing. |
| **Cloud Sync / Backend** | NOT IMPLEMENTED (Out of Scope) | N/A | Strictly local offline prototype as mandated. Ready for future Supabase migration. |
| **Physical Payment Settlement** | NOT IMPLEMENTED (Out of Scope) | N/A | Simulated demonstration logic only; no live bank/GCash APIs. |

---

## 5. Defense & Presentation Tips
- **Highlighting Offline-First Architecture:** Emphasize that university network connectivity inside gymnasiums or campus grounds is often spotty; UniTap functions 100% offline with zero network latency during peak scanning.
- **Hardware Debounce vs Application Duplicate Check:** Clarify for panel reviewers that the hardware scanner uses a 1.5s debounce to suppress physical read jitter, whereas UniTap's domain service checks the official session ledger to permanently prevent duplicate attendance for the same occurrence.
- **Centavo Financial Safety:** Point out that all student balances are stored as integer centavos, eliminating floating-point rounding errors common in naive JavaScript prototypes.
