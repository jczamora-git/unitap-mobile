# Project Goals — UniTap

## Core Objective
Transform the NFC Inspector & Student Information System into **UniTap: An NFC-Powered Mobile Application for CSG Attendance, Event Management, and Student Transactions**.

## Key Acceptance Deliverables
1. **Student Management**:
   - Backward-compatible student model supporting `studentNumber`, status, and card lifecycle.
   - Link, replace, and deactivate NFC cards without losing historical integrity.
2. **CSG Event Management**:
   - Create and manage events with schedules, occurrences, and audience targeting (ALL_BSIT, Year Level, Section).
   - Generate expected participant rosters.
   - Open, close, and cancel occurrence sessions.
3. **NFC Attendance Tracking**:
   - Real-time NFC scanning against OPEN occurrences.
   - Precise status calculation (Present vs Late with configurable grace period).
   - Duplicate tap detection & unregistered card handling.
   - Attendance roster & session closure converting pending to absent.
4. **Student Obligations & Simulated Wallet**:
   - Charge templates & student charges (Fines, contributions).
   - Simulated student wallet with integer centavos ledger.
   - Top-up simulated credits and pay charges with NFC or manual student selection.
   - Full and partial charge settlement.
5. **Modern 5-Tab UI & Diagnostics**:
   - Home, Events, Scan, Students, Finance.
   - Dedicated Settings page preserving original NFC diagnostics and raw log history.
   - Sample data loading & idempotent reset.
