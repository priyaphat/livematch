# LiveMatch POS Company QA Regression Suite

ชุดนี้เป็นแหล่งข้อมูลกลางสำหรับตรวจ POS, POS ↔ Match และ POS ↔ สมาชิกซ้ำได้ทุก release โดยใช้ฐานข้อมูล QA แบบ disposable เท่านั้น

## ข้อกำหนด

- Docker Desktop + Docker Compose v2
- Node.js 24+, Go 1.24+ และ PowerShell 7+
- พอร์ต QA ว่าง: `5273` (Match), `5275` (POS), `8182` (API), `5534` (PostgreSQL)
- ห้ามนำ `DATABASE_URL` ของ Development/Production มาใช้กับ runner นี้

## คำสั่งหลัก

```powershell
./qa/pos-regression/run.ps1 -Suite smoke
./qa/pos-regression/run.ps1 -Suite cross-system
./qa/pos-regression/run.ps1 -Suite full
```

Runner จะตรวจชื่อฐานและพอร์ต, ล้างเฉพาะ Docker project `livematch-pos-qa`, สร้างฐานใหม่, รอ migration, seed ข้อมูล QA, รัน test และปิด stack พร้อมลบ QA volume เมื่อเสร็จ ใช้ `-KeepStack` เมื่อต้องการตรวจ defect ต่อด้วยมือ

## Test accounts

| บัญชี | Login | Secret | บทบาท |
|---|---|---|---|
| Owner A | `qa.owner.a@example.invalid` หรือ Admin No. `9101` | `QaPass123!` | Owner |
| Manager A | `qa.manager.a@example.invalid` หรือ `QA-MGR-001` | PIN `246824` | Manager |
| Cashier A | `qa.cashier.a@example.invalid` หรือ `QA-CASH-001` | PIN `135713` | Cashier |
| Owner B | `qa.owner.b@example.invalid` หรือ Admin No. `9102` | `QaPass123!` | Owner สำหรับ tenant isolation |

ข้อมูลทั้งหมดใช้ prefix `qa-` และอยู่ในฐาน `livematch_qa` บน QA PostgreSQL เท่านั้น

## Suite matrix

| Suite | สิ่งที่รัน |
|---|---|
| `smoke` | catalog validator, Go tests/integration, Match Vitest, POS typecheck/build, Chromium critical browser flow และ WebKit smoke |
| `cross-system` | catalog validator, seed ใหม่ และ Playwright เฉพาะ POS ↔ Match ↔ Member |
| `full` | ทุกอย่างใน smoke, Playwright Chromium Desktop/Mobile, WebKit smoke, responsive/security/report checks |

Playwright เก็บ HTML/JUnit report และเก็บ screenshot, video, trace เมื่อ test ล้มเหลวไว้ใน `artifacts/` ส่วนผลสรุปรอบล่าสุดอยู่ใน `results/latest.md`

## การเพิ่ม regression case

1. เพิ่ม Case ID ใน [test-cases.md](./test-cases.md) ก่อน
2. ใส่ Case ID ในชื่อ test เช่น `POS-SALE-014 ...`
3. กำหนด Automation เป็น `Playwright`, `Go`, `Vitest` หรือ `Manual` ตามของจริง
4. รัน `npm run validate:cases` ในโฟลเดอร์นี้ ตัวตรวจจะ fail หาก Playwright case ใน catalog ไม่มี test หรือ test ใช้ ID ที่ไม่มีใน catalog
5. Defect ต้องบันทึกในผลรอบทดสอบตาม template และเพิ่ม regression test ก่อนปิด

## Result policy

- P0: เงิน/สต็อกเสีย, ชำระซ้ำ, tenant data leak หรือระบบล่มทั้งหมด
- P1: Login, Sale, Settlement หรือ cross-system sync ใช้งานไม่ได้
- P2: ฟังก์ชันบางส่วนผิดแต่มีทางเลี่ยง
- P3: UI/copy/spacing ไม่กระทบธุรกรรม

Release ผ่านเมื่อ automated tests ผ่านทั้งหมด, ไม่มี P0/P1, P2 มี owner/แผนแก้ และ manual critical checklist ผ่าน

## Monitoring และ polling load

- Owner อ่าน snapshot ได้ที่ `GET /api/admin/pos/monitoring` โดยมี status count, `409/429/500`, p50/p95/p99, slow route และ Request ID ของ error ล่าสุด ข้อมูลเก็บใน memory แบบมีขอบเขตและ reset เมื่อ backend restart
- Backend เขียน structured JSON log เมื่อเกิด `409`, `429`, `5xx` หรือ latency ตั้งแต่ 2 วินาที เพื่อค้นต่อใน CloudPanel ด้วย `requestId`
- ใช้ `./qa/pos-regression/run-load.ps1` จำลองหลายจอ ดูวิธีและ safety guard ที่ [load/README.md](./load/README.md)
