# UniTap 2.0 Consent & Notice Management Policy
**Document Reference**: PRIV-POL-002  
**Status**: DRAFT — Pending Institutional Review & DPO Approval  
**Applicable Law**: RA 10173 Section 12, NPC Advisory on Valid Consent

---

## 1. Distinction Between Notice Acknowledgment and Consent
Under RA 10173, consent is required only when an authorized lawful basis other than contractual necessity, legal obligation, or legitimate interest is invoked.
- **Privacy Notice Acknowledgment**: Confirms that the data subject has received, read, and understood the information detailing how mandatory organizational records (attendance, contributions) are handled.
- **Explicit Consent**: Required only for optional, secondary processing activities (e.g., student talent directories, optional photo publication, or external notification integrations).

UniTap does **not** conflate Privacy Notice acknowledgment with legal consent, nor does it present pre-checked consent boxes.

---

## 2. Notice Presentation and Recording
1. **First-Time Welcome Integration**:
   - Following user authentication and initial data synchronization, users are presented with the UniTap Privacy Overview modal.
   - Users can review the full Privacy Notice and Terms of Use.
   - Tapping "Continue" / "Acknowledge" records an audit record in `privacy_notice_acknowledgments`:
     - `user_id`: Authenticated user UUID
     - `policy_version`: Version string (e.g. `'2.0.0'`)
     - `acknowledged_at`: ISO-8601 UTC timestamp
2. **Version Changes & Re-Acknowledgment**:
   - When a major policy change occurs (incrementing version number), users are presented with a notification highlighting the changes and invited to review the updated notice upon their next login.

---

## 3. Optional Consent Management & Withdrawal
- When an optional processing feature is introduced, an affirmative opt-in toggle is displayed in **Settings → Privacy & Security**.
- Users may freely grant or withdraw consent at any time without penalty or denial of core organizational services.
- Withdrawing consent updates `privacy_consents` with `withdrawn_at` timestamp and immediately halts the optional processing activity.
- Consent withdrawal does **not** retroactively erase lawfully mandated administrative records (e.g., historical payment receipts or attendance audits).

