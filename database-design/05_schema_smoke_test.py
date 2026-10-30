"""Run: python 05_schema_smoke_test.py
Schema smoke test ONLY. Does not implement runtime business authorization or sync.
"""
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parent
conn = sqlite3.connect(':memory:')
conn.executescript((ROOT/'01_unitap_offline_schema.sql').read_text(encoding='utf-8'))
conn.execute('PRAGMA foreign_keys=ON')
now='2026-10-31T00:00:00Z'
conn.execute("INSERT INTO academic_years VALUES ('ay','2026-2027','2026-08-01','2027-05-31','ACTIVE')")
conn.execute("INSERT INTO semesters VALUES ('sem1','ay','FIRST','2026-08-01','2026-12-31','ACTIVE')")
conn.execute("INSERT INTO semesters VALUES ('sem2','ay','SECOND','2027-01-01','2027-05-31','PLANNED')")
conn.execute("INSERT INTO programs VALUES ('p1','BSIT','Bachelor of Science in Information Technology',1)")
conn.execute("INSERT INTO students (id,school_id,first_name,last_name,status,created_at,updated_at) VALUES ('s1','0000123','Alex','Sample','ACTIVE',?,?)",(now,now))
conn.execute("INSERT INTO student_enrollments (id,student_id,semester_id,program_id,year_level,section,first_name_snapshot,last_name_snapshot,updated_at) VALUES ('e1','s1','sem1','p1',3,'3F4','Alex','Sample',?)",(now,))
conn.execute("INSERT INTO student_enrollments (id,student_id,semester_id,program_id,year_level,section,first_name_snapshot,last_name_snapshot,updated_at) VALUES ('e2','s1','sem2','p1',4,'4F4','Alex','Sample',?)",(now,))
assert conn.execute("SELECT COUNT(*) FROM students").fetchone()[0]==1
assert conn.execute("SELECT COUNT(*) FROM student_enrollments WHERE student_id='s1'").fetchone()[0]==2

try:
 conn.execute("INSERT INTO students (id,school_id,first_name,last_name,created_at,updated_at) VALUES ('s2','0000123','Test','Duplicate',?,?)",(now,now))
 raise AssertionError('Unique school ID not enforced')
except sqlite3.IntegrityError: pass

conn.execute("INSERT INTO users (id,username,account_status,created_at,updated_at) VALUES ('dev','test_admin','ACTIVE',?,?)",(now,now))
conn.execute("INSERT INTO user_roles (id,user_id,role,assigned_at) VALUES ('r1','dev','DEVADMIN',?)",(now,))
conn.execute("INSERT INTO nfc_cards (id,student_id,uid_normalized,assigned_at) VALUES ('card','s1','04AABBCC',?)",(now,))
try:
 conn.execute("INSERT INTO nfc_cards (id,student_id,uid_normalized,assigned_at) VALUES ('card2','s1','04DDEEFF',?)",(now,))
 raise AssertionError('One active card per student not enforced')
except sqlite3.IntegrityError: pass

conn.execute("INSERT INTO obligation_rules (id,semester_id,name,type,trigger_type,default_amount_centavos,created_at) VALUES ('rul','sem1','Absence fee','FINE','ABSENCE',2500,?)",(now,))
conn.execute("INSERT INTO student_obligations (id,student_id,semester_id,rule_id,title,type,amount_centavos,issued_at,updated_at) VALUES ('ob','s1','sem1','rul','Absence fee','FINE',2500,?,?)",(now,now))
conn.execute("INSERT INTO payments (id,student_id,semester_id,reference_number,idempotency_key,amount_centavos,source,channel,processed_by_user_id,processed_at) VALUES ('pay','s1','sem1','RECEIPT-001','pay-unique',1000,'CASH_RECORDED','MANUAL','dev',?)",(now,))
conn.execute("INSERT INTO payment_allocations (id,payment_id,obligation_id,amount_centavos) VALUES ('alloc','pay','ob',1000)")

reports=(ROOT/'02_reports_queries.sql').read_text(encoding='utf-8').split(';')
result=conn.execute(reports[0].split('WITH adjustment_totals',1)[-1].join(['WITH adjustment_totals','']),{'semester_id':'sem1'}).fetchone()
assert result and result[0]=='0000123' and result[9]==1000 and result[10]==1500, result
conn.execute("UPDATE payments SET status='REVERSED',reversed_at=?,reversal_reason='Test reversal' WHERE id='pay'",(now,))
result=conn.execute(reports[0].split('WITH adjustment_totals',1)[-1].join(['WITH adjustment_totals','']),{'semester_id':'sem1'}).fetchone()
assert result and result[9]==0 and result[10]==2500, result
assert conn.execute('PRAGMA foreign_key_check').fetchall()==[]
print('PASSED: schema, historical enrollments, school ID uniqueness, active card uniqueness, fine reporting, payment reversal, foreign keys')
