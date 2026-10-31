# UniTap 2.0 — Supabase Migration & Cloud Setup Guide

Gabay ito para ma-apply at mai-setup mo ang database schema, RPC functions, Realtime, at Storage sa iyong Supabase project nang mabilis at walang error.

---

## Impormasyon ng Proyekto
- **Supabase Project URL**: `https://snqcbmroefhxkhcadidr.supabase.co`
- **Dashboard URL**: [https://supabase.com/dashboard/project/snqcbmroefhxkhcadidr](https://supabase.com/dashboard/project/snqcbmroefhxkhcadidr)
- **Migration SQL File**: [`supabase/migrations/20261031000001_unitap_initial_schema.sql`](./supabase/migrations/20261031000001_unitap_initial_schema.sql)

---

## Hakbang 1: I-run ang Database Schema sa Supabase SQL Editor (Pinakamabilis)

1. Buksan ang iyong browser at pumunta sa:  
   👉 **[Supabase Project SQL Editor](https://supabase.com/dashboard/project/snqcbmroefhxkhcadidr/sql/new)**
2. I-click ang **"New Query"** (o `+` button).
3. Buksan ang file na ito sa iyong editor:  
   👉 [`supabase/migrations/20261031000001_unitap_initial_schema.sql`](./supabase/migrations/20261031000001_unitap_initial_schema.sql)
4. I-copy lahat ng laman nito (`Ctrl + A`, tapos `Ctrl + C`).
5. I-paste ito sa Supabase SQL Editor.
6. I-click ang berdeng **"Run"** button sa ibabang kanan (o pindutin ang `Ctrl + Enter`).
7. Hintayin lumabas ang message na:  
   `Success. No rows returned`

> [!TIP]
> Kasama na sa SQL script na ito ang lahat ng tables, foreign keys, indexes, triggers para sa automatic `sync_change_log`, RLS security policies, at ang dalawang kritikal na RPC functions:
> - `verify_and_claim_student_code`
> - `sync_pull_changes`

---

## Hakbang 2: I-enable ang Supabase Realtime (Para sa Live Sync)

Para makatanggap agad ang mga devices ng update kapag may nagbago sa database:

1. Sa kaliwang menu ng Supabase Dashboard, pumunta sa **Database** ➔ **Replication**  
   (o URL: `https://supabase.com/dashboard/project/snqcbmroefhxkhcadidr/database/replication`).
2. Sa ilalim ng **"Source"** tab, hanapin ang `supabase_realtime`.
3. I-toggle o i-select ang mga sumusunod na tables:
   - ✅ `attendance_records`
   - ✅ `cards`
   - ✅ `activation_claims`
   - ✅ `student_wallet_ledger`
   - ✅ `obligation_rules`
   - ✅ `sync_change_log`
4. I-click ang **Save**.

---

## Hakbang 3: I-setup ang Storage Bucket (Student Photos)

Para sa mga ID photo ng estudyante na ginagamit sa offline/online photo verification:

1. Sa kaliwang sidebar, pumunta sa **Storage**  
   (URL: `https://supabase.com/dashboard/project/snqcbmroefhxkhcadidr/storage/buckets`).
2. I-click ang **"New Bucket"**.
3. Ilagay ang Bucket Name: `student-photos`
4. I-toggle ang **"Public bucket"** kung gusto mong mabilis ma-access ng image components (o iwanang private kung gagamit ng authenticated signed URLs).
5. I-click ang **"Create bucket"**.

---

## Hakbang 4: Verification Query (I-check kung kumpleto)

Sa SQL Editor, magbukas ng bagong query at i-run ito para masiguro na kumpleto ang lahat ng tables at functions:

```sql
-- 1. I-check ang bilang ng tables (Dapat may ~20+ tables na nilikha)
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- 2. I-verify ang mga RPC Functions
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name IN ('verify_and_claim_student_code', 'sync_pull_changes');
```

Dapat makita mo ang parehong functions:
- `verify_and_claim_student_code`
- `sync_pull_changes`

---

## Hakbang 5 (Opsyonal): Mag-seed ng Initial Active Academic Year & Semester

Kung bago ang Supabase project mo, maglagay ng inisyal na Active Academic Year at Semester para makapag-enroll agad:

```sql
-- Maglagay ng Academic Year 2026-2027
INSERT INTO academic_years (id, label, starts_on, ends_on, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'A.Y. 2026-2027', '2026-08-01', '2027-06-30', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- Maglagay ng 1st Semester bilang ACTIVE
INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'FIRST', '2026-08-01', '2026-12-20', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- Maglagay ng standard programs
INSERT INTO programs (code, name, status)
VALUES 
  ('BSIT', 'Bachelor of Science in Information Technology', 'ACTIVE'),
  ('BSCS', 'Bachelor of Science in Computer Science', 'ACTIVE'),
  ('BLIS', 'Bachelor of Library and Information Science', 'ACTIVE')
ON CONFLICT (code) DO NOTHING;
```

---

## Alternatibo: Gamit ang Supabase CLI (Para sa Terminal Users)

Kung naka-install ang Supabase CLI sa iyong computer:

```bash
# 1. Mag-login sa Supabase
npx supabase login

# 2. I-link ang local project sa remote Supabase project
npx supabase link --project-ref snqcbmroefhxkhcadidr

# 3. I-push ang migration nang diretso
npx supabase db push
```

---

## Pagkatapos Mai-set Up sa Supabase

Kapag nai-run mo na ang SQL sa Supabase:
1. Buksan ang UniTap app (`npx pnpm dev` o sa Android device).
2. Mag-login gamit ang officer o admin account.
3. Awtomatikong dadaan ang app sa **Initial Sync screen (`/initial-sync`)** at mada-download ang data mula sa Supabase papunta sa local SQLite!
4. Ang lahat ng offline operations (NFC tap, attendance, fines, top-up) ay mag-i-enqueue sa `sync_outbox` at kusa nang magsi-sync pabalik sa Supabase sa tuwing may internet connection.

