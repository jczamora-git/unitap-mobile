# UniTap 2.0 Data Processing Policy
**Document Reference**: PRIV-POL-001  
**Status**: DRAFT — Pending Institutional Review & DPO Approval  
**Applicable Law**: Republic Act No. 10173, NPC Circular 2023-06

---

## 1. Principles of Data Processing
All personal information collected and processed within UniTap 2.0 must adhere to the three foundational principles of Philippine data privacy:
1. **Transparency**: Students and officers must be made aware of the nature, purpose, extent, and lawful basis of data processing before or at the time of collection.
2. **Legitimate Purpose**: Data is processed solely for official student organization governance, attendance recording, academic identification, and financial obligation tracking. Secondary incompatible uses are prohibited.
3. **Proportionality**: Processing is strictly limited to data elements necessary to achieve the stated purpose. Excessive data collection (such as unnecessary home addresses, telephone numbers, or biometric facial geometry) is prohibited.

---

## 2. Roles in Data Processing
- **Personal Information Controller (PIC)**: The Student Organization (CSG) and University Administration control the purposes and means of processing.
- **Personal Information Processor (PIP)**: Cloud hosting infrastructure (Supabase, Inc.) executes processing strictly in accordance with documented instructions and encryption safeguards.
- **Data Protection Officer (DPO)**: Oversees institutional compliance, advises on Privacy Impact Assessments, and addresses data subject requests.

---

## 3. Lawful Bases for Processing Under RA 10173
Processing within UniTap relies upon:
1. **Contractual Necessity (Section 12b)**: Fulfilling the student's organizational membership obligations, dues payment, and receipt generation.
2. **Legal Obligation (Section 12c)**: Compliance with student organization financial liquidation rules and university reporting standards.
3. **Legitimate Interests (Section 12f)**: Preventing proxy attendance fraud, maintaining accurate assembly quorums, and safeguarding student organization funds.

Consent is **not** forced for core administrative services, avoiding deceptive pre-ticked checkboxes.

---

## 4. Student Roster Import Procedures
When officers import student records via CSV:
- Uploads must originate from officially verified registrar or department enrollment lists.
- Uploaded fields are restricted to: `school_id`, `first_name`, `middle_name`, `lastname`, `year`, `section`.
- Raw uploaded CSV files are processed in-memory, validated, and never permanently archived in public web directories.
- Formula injection attacks are stripped prior to database entry.

