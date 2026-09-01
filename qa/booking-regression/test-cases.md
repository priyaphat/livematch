# Booking Reconciliation Test Cases

| Case ID | Severity | Scenario | Expected |
|---|---|---|---|
| BOOK-LEDGER-001 | P0 | ตั้งช่วง 30 นาที สนาม A ราคา 120 และสนาม B ราคา 150; จอง A 60 นาทีกับ B 30 นาที | สร้าง 2 รายการ ยอด 240+150=390 และ occupancy ทำงาน 2 รายการ |
| BOOK-LEDGER-002 | P0 | ส่งชุดจองที่รายการแรกว่างแต่รายการที่สองทับช่วงเดิม | HTTP 409 และ rollback ทั้งชุด ไม่มี booking/occupancy จากรายการแรกหลุดมา |
| BOOK-LEDGER-003 | P0 | ส่งคำขอพร้อมกัน 2 คำขอสำหรับสนามและช่วงเดียวกัน | สำเร็จ 1 คำขอ อีกคำขอล้มเหลว และมี active occupancy เพียง 1 |
| BOOK-LEDGER-004 | P0 | ยกเลิก batch แล้วกดยกเลิกซ้ำ | สถานะ cancelled ทั้งชุด ปลด occupancy ครั้งเดียว และจองช่วงเดิมใหม่ได้ |
| BOOK-PAY-001 | P0 | Hold 150 บาท → pending review → approve ซ้ำ | confirmed/paid, payment approved, ยอด booking/payment เท่ากับ 150 |
| BOOK-PAY-002 | P0 | Hold → reject | rejected/rejected และคืนช่องเวลา |
| BOOK-PAY-003 | P0 | ชุดจอง 120+150 ชำระรวม 270 | API/Excel แสดงยอดจองรวม 270 และยอดชำระรวม 270 ไม่ทำซ้ำทุกแถว |
| BOOK-EXPORT-001 | P0 | Export วันที่และสถานะทั้งหมด | ราคา สถานะ เวลา และ payment ตรง source; ไม่มีข้อมูลภาพสลิปใน JSON/Excel |
| BOOK-AUDIT-001 | P0 | Audit booking, occupancy และ payment ทุก tenant | ไม่มีราคาผิด, occupancy ขาด/เกิน/ทับซ้อน, tenant ผิด, payment ผิดยอด หรือ workflow ขัดกัน |
| BOOK-AUDIT-002 | P1 | Booking paid และไฟล์สลิป | มี payment evidence และ metadata file/size/hash ครบเมื่อจัดเก็บเป็นไฟล์ |
| BOOK-REG-001 | P0 | Full Go + Vue/Vitest + production build | ไม่มี P0/P1 และทุก test ผ่าน |

