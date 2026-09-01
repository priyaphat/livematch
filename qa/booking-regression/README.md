# Booking Regression QA

ชุดตรวจระบบจองสนามบนฐาน PostgreSQL แยก `livematch_qa` โดยไม่แตะข้อมูลร้านจริง ครอบคลุมราคา ล็อกช่วงเวลา การจองพร้อมกัน rollback การคืนช่องหลังยกเลิก การตรวจชำระ ประวัติ และ Excel

รัน Full Regression:

```powershell
./qa/booking-regression/run.ps1 -KeepStack
```

Audit ฐานที่กำหนดแบบ read-only:

```powershell
./qa/booking-regression/run-booking-audit.ps1 -DatabaseUrl $env:STORE_READONLY_DATABASE_URL -OutputPath ./qa/booking-regression/results/booking-audit.json
```

ตัว audit บังคับเปิด transaction ด้วย `REPEATABLE READ, READ ONLY` และหยุดทันทีหาก PostgreSQL ไม่ยืนยัน `transaction_read_only=on`

