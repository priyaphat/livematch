# Manual Critical Checklist

กรอกผู้ทดสอบ วันที่ commit browser/device และแนบหลักฐานใน `results/` ทุกครั้ง ช่อง P0/P1 ต้องผ่านก่อน release

## Hardware / PWA

- [ ] POS-PWA-002 ติดตั้ง Chromium Desktop แล้วมีไอคอน เปิดเป็น standalone และ login ได้
- [ ] POS-PWA-002 ติดตั้ง Android/iOS ที่รองรับ แล้ว icon/title/start URL ถูก
- [ ] POS-RCPT-001 พิมพ์ thermal printer จริง: ภาษาไทยไม่เพี้ยน ความกว้าง/ตัดกระดาษถูก และไม่มี “สาขา”
- [ ] POS-RCPT-001 พิมพ์ A4/PDF: รายการ VAT วิธีชำระ ผู้ขายและยอดตรงกับ DB
- [ ] POS-SALE-005 สแกน QR ด้วยมือถือ อ่าน receiver/ยอดถูก โดยไม่กดยืนยันโอนเงินจริง

## Two-screen customer display

- [ ] POS-DISP-002 เปิด cashier + `?display=customer` คนละจอ
- [ ] เพิ่ม/ลด/ล้างตะกร้าแล้วจอลูกค้า sync โดยไม่มี reload manual
- [ ] เลือก cash แล้วรายการ เงินรับ เงินทอนขึ้นในหน้าเดิมสีส้ม
- [ ] เลือก PromptPay แล้ว QR/yอดขึ้นในหน้าเดิมสีส้ม
- [ ] ชำระสำเร็จแล้ว thank-you state ขึ้นและกลับ index ตามเวลา

## Cross-system / concurrency

- [ ] POS-XMATCH-007 เปิด Match และ POS คนละเครื่อง เพิ่มค่า Match แล้ว POS เห็นภายใน 10 วินาที
- [ ] กำลังพิมพ์ setting/member/search แล้ว polling ไม่ reset input
- [ ] แก้เกม Match พร้อม polling แล้ว state เกมไม่ถูกเขียนทับ
- [ ] POS-PAY-001 เลือกสมาชิก 2 คนขึ้นไป ชำระ cash และ QR อย่างละรอบ
- [ ] POS-XMATCH-006 สองเครื่องกดชำระบัญชีเดียวกันพร้อมกัน สำเร็จครั้งเดียว อีกเครื่องเห็นยอดล่าสุด/409
- [ ] POS-LOAD-001 รัน polling ผ่านโดเมน/Reverse Proxy จริงทั้ง jitter และ synchronized แล้วแนบ JSON result
- [ ] ใช้ Request ID จากตัวอย่าง 409/429/500 ค้นเจอ structured log รายการเดียวกันใน CloudPanel

## UI / responsive

- [ ] POS-CAT-002 modal Category/Unit ไม่หลุด viewport
- [ ] POS-STOCK-006 modal stock document กว้างพอ รายละเอียดไม่ถูกตัด
- [ ] POS-NF-001 Chromium 1440×900, 390×844 และ iPad WebKit ไม่มี horizontal overflow
- [ ] Bottom navigation ไม่บังฟอร์มเพิ่ม Staff หรือปุ่มบันทึก
- [ ] Select, spinner success และ toast ใช้รูปแบบเดียวกับระบบ

## Tester sign-off

- Commit:
- Environment:
- Tester:
- วันที่/เวลา:
- P0/P1 defects:
- P2 accepted + owner/due date:
- Result: PASS / FAIL / BLOCKED
