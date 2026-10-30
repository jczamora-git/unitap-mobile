-- UniTap offline reporting, based on the SQLite schema.
-- Bind :semester_id to a valid semesters.id. Reports read local committed data.
-- Do not count VOID obligations or REVERSED payments.
-- Validate finance transaction constraints in an atomic application transaction.

-- A. FINES and CONTRIBUTIONS per student, current semester.
WITH adjustment_totals AS (
 SELECT obligation_id,
        SUM(CASE WHEN kind='ADDITION' THEN amount_centavos ELSE -amount_centavos END) AS change_centavos
 FROM obligation_adjustments GROUP BY obligation_id
),
 paid_totals AS (
 SELECT pa.obligation_id, SUM(pa.amount_centavos) AS paid_centavos
 FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id
 WHERE p.status='POSTED' GROUP BY pa.obligation_id
),
 balances AS (
 SELECT o.id, o.student_id, o.semester_id, o.type, o.title,
        o.amount_centavos + COALESCE(a.change_centavos,0) AS assessed_centavos,
        COALESCE(p.paid_centavos,0) AS paid_centavos
 FROM student_obligations o
 LEFT JOIN adjustment_totals a ON a.obligation_id=o.id
 LEFT JOIN paid_totals p ON p.obligation_id=o.id
 WHERE o.semester_id=:semester_id AND o.status='ACTIVE'
)
SELECT s.school_id, s.first_name, s.middle_name, s.last_name,
       e.year_level, e.section,
       b.type AS obligation_type, b.title,
       b.assessed_centavos, b.paid_centavos,
       MAX(0,b.assessed_centavos-b.paid_centavos) AS balance_centavos
FROM balances b JOIN students s ON s.id=b.student_id
JOIN student_enrollments e ON e.student_id=s.id AND e.semester_id=b.semester_id
ORDER BY b.type,s.last_name,s.first_name,b.title;

-- B. Semester fines/contributions total by category.
WITH a AS (
 SELECT obligation_id, SUM(CASE WHEN kind='ADDITION' THEN amount_centavos ELSE -amount_centavos END) d
 FROM obligation_adjustments GROUP BY obligation_id
),
p AS (
 SELECT pa.obligation_id,SUM(pa.amount_centavos) paid
 FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id
 WHERE p.status='POSTED' GROUP BY pa.obligation_id
)
SELECT o.type, COUNT(*) AS obligations_count,
 SUM(o.amount_centavos+COALESCE(a.d,0)) AS assessed_centavos,
 SUM(COALESCE(p.paid,0)) AS paid_centavos,
 SUM(MAX(0,o.amount_centavos+COALESCE(a.d,0)-COALESCE(p.paid,0))) AS outstanding_centavos
FROM student_obligations o
LEFT JOIN a ON a.obligation_id=o.id
LEFT JOIN p ON p.obligation_id=o.id
WHERE o.semester_id=:semester_id AND o.status='ACTIVE'
GROUP BY o.type ORDER BY o.type;
