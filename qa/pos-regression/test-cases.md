# POS Regression Test Catalog

ไฟล์นี้เป็น source of truth ถาวร สถานะ Automation ต้องตรงกับสิ่งที่รันจริง และทุก Playwright test ต้องมี Case ID ในชื่อ

| Case ID | P | Preconditions | Steps | Expected Result | Automation | Browser |
|---|---:|---|---|---|---|---|
| POS-AUTH-001 | P1 | Owner A, POS enabled | Login ด้วยอีเมลและรหัสผ่าน | เข้า POS ได้และ session เป็น Owner A | Playwright | Chromium/WebKit |
| POS-AUTH-002 | P1 | Staff active | Login ด้วย Staff email/number + PIN | ทั้งสอง identifier เข้าได้ด้วย actor เดิม | Go | API |
| POS-AUTH-003 | P1 | Owner A | Login ด้วยอีเมลตัวพิมพ์ต่างกัน | Login สำเร็จ | Go | API |
| POS-AUTH-004 | P1 | Staff/Owner exists | PIN/password ผิดและ Staff disabled | ได้ข้อความทั่วไป ไม่รั่วข้อมูล | Go | API |
| POS-AUTH-005 | P1 | Session active | Backoffice ปิด `pos_enabled` | Owner/Staff เข้าไม่ได้และ session เดิมถูกปฏิเสธทันที | Go | API |
| POS-AUTH-006 | P2 | Admin A มี Staff 3 คน | เพิ่มคนที่ 4 | API ปฏิเสธตาม limit | Go | API |
| POS-AUTH-007 | P0 | Admin A/B | ใช้อีเมล Staff ซ้ำและแก้ root email | API ปฏิเสธทั้งข้าม tenant และ root email | Go | API |
| POS-AUTH-008 | P1 | มี POS session token ที่ยังไม่หมดอายุ | เปิดหรือ reload หน้า Login | เรียก `/api/auth/pos/me` แล้วเข้าสู่หน้าขายอัตโนมัติโดยไม่ต้องกรอกรหัสอีก | Playwright | Chromium |
| POS-SEC-001 | P0 | Login Admin A/B | A อ่าน/แก้ resource ของ B | ตอบ 404/403 และข้อมูล B ไม่เปลี่ยน | Playwright | API |
| POS-SEC-002 | P1 | Authenticated | Mutation ไม่มี/ผิด CSRF | API ปฏิเสธ | Playwright | API |
| POS-SEC-003 | P2 | Authenticated | อ่าน auth/settings/catalog | มี `Cache-Control: no-store` และ error ไม่รั่ว SQL | Playwright | API |
| POS-SEC-004 | P1 | Cashier restricted | เรียก endpoint ที่ไม่มีสิทธิ์ | API ปฏิเสธแม้เรียกตรง | Go | API |
| POS-CAT-001 | P2 | Seed catalog | เปิดหน้าขายและสินค้า | แสดงชื่อหมวดหมู่/หน่วย ไม่แสดง ID/code | Playwright | Chromium |
| POS-CAT-002 | P2 | Owner | Category/Unit CRUD + pagination | ข้อมูลถูก tenant และหน้า paginate ถูก | Manual | Chromium |
| POS-CAT-003 | P2 | Owner | Product create/edit/deactivate | default image, ราคา 2 ตำแหน่ง, ไม่มี leading zero | Manual | Chromium |
| POS-CAT-004 | P2 | Product exists | Upload PNG/JPEG/WebP เกินต้นฉบับ 2 MB | browser resize และ backend รับไม่เกิน limit | Manual | Chromium |
| POS-CAT-005 | P1 | Product created | แก้ SKU/สต็อกเริ่มต้น | ช่องและ API ถูกล็อกตามกติกา | Manual | Chromium/API |
| POS-CAT-006 | P2 | Owner เปิดหน้าจัดการสินค้า | เปิด modal หมวดหมู่และหน่วยนับที่ความกว้าง 700/390 px | input, select และปุ่มอยู่ภายในกรอบ ไม่มีส่วนใดล้น modal | Playwright | Chromium Desktop/Mobile |
| POS-CAT-007 | P1 | เปิด modal เพิ่มหรือแก้ไขสินค้าและกรอกข้อมูลพร้อมแล้ว | Focus ช่อง barcode แล้วยิง scanner ที่มี suffix Enter | ค่า barcode ถูกแทนที่ครบ แต่ Enter ไม่ submit และ modal ยังเปิดจนกดปุ่มบันทึกเอง | Playwright | Chromium |
| POS-CAT-008 | P2 | Owner เปิด modal เพิ่ม/แก้ไขสินค้า | กรอกจำนวนในแพ็ค 0, 1, 12, ค่าติดลบ, ทศนิยม และเกิน 1,000,000 | รับเฉพาะจำนวนเต็ม 0–1,000,000, ไม่มีศูนย์นำหน้า/spinner และบันทึก Activity Log ก่อน/หลัง | Playwright | API/Chromium |
| POS-STOCK-001 | P0 | Stock seed | รับเข้าหลายรายการ ส่วนลดบาท/เปอร์เซ็นต์ | กระจายครบทุกสตางค์ ไม่มีต้นทุนติดลบ | Playwright | API |
| POS-STOCK-002 | P0 | Stock 10@100 | รับ 10 ชิ้น กรอกมูลค่ารวม 800 บาท เลขบิล และลด 100 บาท | ระบบคำนวณต้นทุนรับเข้า 80 บาท/หน่วย, weighted average = 85 บาท และเก็บเลขบิลครบ | Playwright | API |
| POS-STOCK-016 | P1 | เปิด modal รับเข้า/จ่ายออก/ปรับยอดและสินค้ามี barcode | Focus ช่องค้นหาแล้วยิง barcode พร้อม suffix Enter | เลือกสินค้าตรงตัวเข้าเอกสาร, ล้างช่องค้นหา และไม่ submit modal | Playwright | Chromium |
| POS-STOCK-017 | P0 | เปิดสต็อกที่ 2 และสินค้ามีสองยอด | โอนสินค้าระหว่างคลังและกรอง movement | หัก/เพิ่มแบบ atomic ต้นทุนไม่เปลี่ยน และปิดสต็อกที่ 2 ไม่ได้ขณะมียอด | Playwright | API |
| POS-STOCK-018 | P0 | สินค้าติ๊กไม่ติดตามสต็อก | ตรวจฟอร์ม/ตาราง/หน้าขาย แล้วขายจำนวนมาก | ไม่แสดงจำนวนคงเหลือ ซ่อนเตือนสต็อกต่ำและจำนวนในแพ็ค, API บังคับค่าทั้งสองเป็น 0, ขายสำเร็จ ไม่ตัดยอด และไม่สร้าง stock movement | Playwright | API/Chromium |
| POS-STOCK-019 | P0 | สินค้าทดลองเริ่มสต็อกหลัก 100 สต็อกที่ 2 จำนวน 40 ต้นทุน 25 บาท ราคา 50 บาท แพ็คละ 12 | ซื้อเข้า 20, โอน 30, นำออก 5, ปรับลด 2, พักและชำระ 4, พัก/void 3, เปลี่ยนคลังขายแล้วพัก/void 2 | ยอดสุดท้ายหลัก 88 สต็อกที่ 2 จำนวน 61 รวม 149, ต้นทุนไม่เปลี่ยน, ทุก movement ต่อกันและรายงาน/ประวัติ/Excel ตรงถึงหน่วยและสตางค์ | Playwright | API/Chromium/Excel |
| POS-STOCK-020 | P0 | ฐาน QA หรือฐานร้านแบบ read-only | รัน stock ledger audit ทุก tenant | ไม่มียอดติดลบ, balance chain ขาด, transfer ขาดคู่, sale/void/batch movement ผิด, allocation เงินไม่ตรง หรือสินค้าที่ไม่ติดตามมี movement | Go | PostgreSQL read-only |
| POS-STOCK-021 | P0 | ผ่าน scenario ledger POS-STOCK-019 แล้ว | เปิดจัดการสินค้า ประวัติ/ใบเสร็จ รายงานสินค้าคงเหลือ และ Export Excel | ราคา 50 บาท ยอดชำระ 200 บาท สต็อกที่ 2 เท่ากับ 61, แพ็ค 5+เศษ 1 และมูลค่าทุน/ขายใน Excel ตรงทุกสตางค์ | Playwright | Chromium/Excel |
| POS-STOCK-003 | P0 | Stock จำกัด | จ่ายออกเกินคงเหลือ | rollback ทั้งเอกสาร สต็อกไม่ติดลบ | Playwright | API |
| POS-STOCK-004 | P1 | Product exists | ปรับยอดเพิ่ม/ลด | เก็บ qty/value ก่อน หลัง และผลต่าง | Playwright | API |
| POS-STOCK-005 | P2 | Supplier exists | CRUD + เปิดรับเข้า + แก้ชื่อภายหลัง | เลือก supplier อัตโนมัติและเอกสารเก็บ snapshot | Manual | Chromium |
| POS-STOCK-006 | P2 | มี movement | เปิดเอกสาร/ประวัติ | รายละเอียดครบ รับเข้าเขียว จ่ายออกแดง ปรับยอดส้ม | Playwright | Chromium |
| POS-STOCK-007 | P0 | สินค้าทุน 101 สตางค์ | รับเข้าพร้อมส่วนลด 12.34% | ปัดครึ่งขึ้นเป็นส่วนลด 12 สตางค์ ต้นทุนสุทธิ 89 สตางค์ | Playwright | API |
| POS-STOCK-008 | P0 | สินค้าสต็อกศูนย์ | รับเข้าพร้อมส่วนลดเต็ม 100% | สต็อกเพิ่มครบ ต้นทุนสุทธิศูนย์และไม่มีรายการติดลบ | Playwright | API |
| POS-STOCK-009 | P0 | สต็อก 3 ชิ้น ต้นทุน 333 สตางค์ | จ่ายออกครบจนเหลือศูนย์ | มูลค่าจ่ายออก 999 สตางค์ ต้นทุนต่อหน่วยคงเดิมและยอดไม่ติดลบ | Playwright | API |
| POS-STOCK-010 | P1 | สินค้าสต็อกศูนย์ ต้นทุน 250 สตางค์ | ปรับ 0→10, 10→0 และ 0→0 | จำนวน ผลต่าง และมูลค่าก่อน/หลังทุกทิศทางถูกต้อง | Playwright | API |
| POS-STOCK-011 | P0 | สต็อกจำกัดและสองคำขอ | จ่ายออกพร้อมกัน/ส่งเอกสารชื่อเดิมซ้ำ | สำเร็จเพียงรายการที่ทำได้ ล็อกแถวและไม่ตัดสต็อกซ้ำ | Playwright | API |
| POS-STOCK-012 | P2 | เอกสารปรับยอดลง | เปิดประวัติ movement | ประเภทยังคงเป็นปรับยอด ไม่ถูกแปลงเป็นจ่ายออกเพราะ delta ติดลบ | Playwright | API |
| POS-STOCK-013 | P0 | สินค้าหน่วยละ 1 สตางค์หลายรายการ | รับเข้ายอด 5 สตางค์ ลด 3 สตางค์ | ส่วนลดรวมตรง 3 ยอดสุทธิ 2 และไม่มีรายการติดลบ | Playwright | API |
| POS-STOCK-014 | P0 | สต็อกเดิม 1@1 สตางค์ | รับเพิ่ม 1@2 สตางค์ | ต้นทุนเฉลี่ย 1.5 ปัดครึ่งขึ้นเป็น 2 สตางค์ | Playwright | API |
| POS-STOCK-015 | P0 | ยอดรับเข้า 1 สตางค์ | กรอกส่วนลด 2 สตางค์ | ปฏิเสธทั้งเอกสารและไม่เปลี่ยนสต็อก/ต้นทุน | Playwright | API |
| POS-SALE-001 | P1 | Owner A login | เปิดหน้าขาย | โหลดเฉพาะสินค้า active พร้อมชื่อหมวด ราคา stock จริง | Playwright | Chromium/WebKit |
| POS-SALE-002 | P0 | Products in stock | ขายพร้อมส่วนลดและ VAT off/included/excluded | server คำนวณ/ปัด satang ถูก | Playwright | API |
| POS-SALE-003 | P2 | Cart has item | ตรวจรายการคำสั่งซื้อ | ไม่มีปุ่ม/modal เพิ่มโน้ต | Playwright | Chromium |
| POS-SALE-004 | P1 | Cart has item | จ่ายเงินสดต่ำกว่า/สูงกว่ายอด | ต่ำกว่าไม่ตัดสต็อก สูงกว่าบันทึกเงินรับ/ทอน | Playwright | API |
| POS-SALE-005 | P1 | PromptPay setting | ขอ QR ตามยอด inherited/override/fallback | payload, amount, receiver และ precedence ถูก ไม่โอนเงินจริง | Playwright | API |
| POS-SALE-006 | P0 | Sale request | ส่ง request ซ้ำ/ยอดหรือ stock เปลี่ยน | ไม่ตัด stock ซ้ำ, stale total ได้ 409, rollback | Playwright | API |
| POS-SALE-007 | P2 | หน้าการขาย Desktop | เปิดรายการสินค้า viewport 1440px | การ์ดแสดง 5 คอลัมน์ ไม่แสดง SKU และข้อมูลภายในการ์ดไม่ล้น | Playwright | Chromium |
| POS-SALE-008 | P1 | สินค้า active มี barcode และ stock โดยเครื่องอาจตั้งแป้นพิมพ์ภาษาไทย | ยิง barcode จากพื้นที่ใดก็ได้โดยไม่ focus ช่องค้นหา จำลอง key code ที่ระบุไม่ได้, text injection ไม่มี Enter และรหัสตัวอักษรใหญ่ที่เครื่องส่ง Shift คั่น | ช่องรับ scanner แบบซ่อนรับ focus อัตโนมัติ, แปลงแป้นไทย, ไม่ล้าง buffer เมื่อเจอ modifier, จบการอ่านและเพิ่มตะกร้าโดยไม่เกิน stock | Playwright | Chromium |
| POS-SALE-009 | P0 | Browser เคยมี catalog จำลองใน localStorage | เปิดหน้าขาย | ไม่แสดงหรือใช้สินค้า/หมวดหมู่จำลอง และล้าง cache catalog เดิม | Playwright | Chromium |
| POS-SALE-010 | P0 | API สร้าง PromptPay QR ใช้งานไม่ได้ | เลือกชำระด้วย PromptPay | ไม่สร้าง QR จากหมายเลขสำรอง แจ้งข้อผิดพลาด และปิดปุ่มยืนยัน | Playwright | Chromium |
| POS-HOLD-001 | P1 | Members exist | ค้น member ใน Hold | debounce 500 ms, เลือกสมาชิกจริง, เพิ่มสมาชิกได้ | Manual | Chromium |
| POS-HOLD-002 | P1 | Same member | Hold หลาย sale | การ์ดเดียว แต่ source documents ครบ | Go | API |
| POS-PAY-001 | P1 | Receivables 2+ members | เลือกหลายคน จ่าย cash/QR | settlement สำเร็จครบและยอดถูก | Manual | Chromium |
| POS-PAY-002 | P0 | Open hold | Void hold / void central payment | Hold คืน stock; payment สำเร็จแล้วเปิดคืนไม่ได้ | Playwright | API |
| POS-DISP-001 | P1 | No cart | เปิด `?display=customer` | แสดง index setting และไม่มีคำว่า “สาขา/สาขาหลัก” | Playwright | Chromium/WebKit |
| POS-DISP-002 | P1 | Browser รองรับ Presentation API | เปิด customer display อีกจอ | เชื่อม receiver, ส่ง state แรก และไม่เปิด popup ซ้ำ | Playwright | Chromium mocked Presentation API |
| POS-DISP-003 | P2 | Browser ไม่รองรับ Presentation API | กดเปิดจอลูกค้า | fallback เป็น popup เดิมหนึ่งครั้งและแสดงสถานะไม่รองรับ | Playwright | Chromium |
| POS-HW-001 | P1 | Android + USB keyboard | เปิด/ปิดโหมดคีย์บอร์ด USB | inputmode เป็น none ระหว่างเปิด, พิมพ์ด้วย hardware event ได้ และคืนค่าเดิมเมื่อปิด | Playwright | Chromium Android UA |
| POS-HW-002 | P1 | W POS firmware รายงาน user agent เป็น Linux/Chromium | เปิดหน้า POS | ปุ่มคีย์บอร์ด USB ยังแสดงและสลับ inputmode ได้ | Playwright | Chromium Linux UA |
| POS-PRINT-001 | P1 | Owner เปิดตั้งค่าเครื่องพิมพ์ | กดค้นหา/เลือกเครื่องพิมพ์ | สร้างเอกสาร 80 mm ในหน้าเดิมและเปิด Android Print Dialog | Playwright | Chromium mocked print |
| POS-PRINT-002 | P1 | W POS Android เปิด iMin H5 Web Print service | ตรวจหาและทดสอบ InnerPrinter | เชื่อมต่อ localhost WebSocket, ตรวจสถานะและส่งข้อความไทยพร้อม feed/cut โดยไม่เปิด Android Print Dialog | Playwright | Chromium mocked iMin WebSocket |
| POS-PRINT-003 | P1 | มีบิลขายและ iMin InnerPrinter พร้อมใช้ | เปิด Preview แล้วกดพิมพ์ใบเสร็จ | ส่งภาพใบเสร็จชุดเดียวกับ Preview ไปยัง InnerPrinter และไม่เปิด Android Print Dialog | Playwright | Chromium mocked iMin WebSocket |
| POS-RCPT-001 | P1 | Paid sale | เปิด/พิมพ์ใบเสร็จ | ไม่มีสาขา; มีสินค้า VAT วิธีชำระ ผู้ขาย ยอดถูก | Manual | Chromium/printer |
| POS-BILL-001 | P1 | มีประวัติชำระเงิน | กดดูรายละเอียดจากแท็บประวัติการขาย | modal แสดงลูกค้า วันเวลา ผู้รับชำระ ช่องทาง รายการ Match/POS ยอดรวม เงินรับ/ทอนหรือเลขอ้างอิงครบ | Playwright | Chromium |
| POS-BILL-002 | P1 | มีประวัติอย่างน้อย 21 รายการ | ค้นหา กรอง และเปลี่ยนหน้าประวัติการขาย | API แบ่งหน้าละ 20, จำนวนรวม/ช่วงรายการถูก และตัวกรองทำงานกับข้อมูลทุกหน้า | Playwright | Chromium/API |
| POS-BILL-003 | P1 | เลือกยอดพักอย่างน้อย 1 บิล | กดชำระเงินทันทีและตรวจ Modal | แสดงรายการ Match/POS และสินค้าในแต่ละบิลครบ; Desktop แบ่งรายละเอียดซ้าย/ชำระเงินขวา และ Mobile เรียงหนึ่งคอลัมน์ | Manual | Chromium |
| POS-BILL-004 | P3 | มีรายการพักยอดอย่างน้อย 1 บิล | เปิดหน้าจัดการบิลบน Desktop | การ์ดรายการพักยอดใช้ grid 4 ใบต่อแถวที่ breakpoint Desktop | Playwright | Chromium |
| POS-XMATCH-001 | P1 | Match-only linked member | เปิด receivables POS | เห็น Match charge แม้ POS = 0 | Playwright | API |
| POS-XMATCH-002 | P1 | Multiple linked players | เปิด receivables | สมาชิกมีค่า Match ทุกคนขึ้น; guest ไม่รวม | Playwright | API |
| POS-XMATCH-003 | P1 | Match + shuttle + POS | เปิดรายละเอียดสองระบบ | ค่าสนาม ลูกแบด session และชื่อสินค้าแสดงครบ | Vitest | Match |
| POS-XMATCH-004 | P1 | Linked member | Hold POS แล้วเปิด Match summary | Match เห็นยอด POS และ account เดิม | Playwright | API |
| POS-XMATCH-005 | P0 | Open cross charges | settle จาก POS/Match | payment เดียว allocation Match/POS พร้อม snapshot/origin | Go | API |
| POS-XMATCH-006 | P0 | Payment modal open | ยอดเปลี่ยนหรือสองเครื่องกดพร้อมกัน | stale ได้ 409 และสำเร็จครั้งเดียว | Go | API |
| POS-XMATCH-007 | P2 | Two tabs | ปล่อย polling 10 วินาทีขณะพิมพ์/แก้เกม | อัปเดตเฉพาะการเงิน ไม่ reset form/game | Manual | Chromium two-window |
| POS-XMATCH-008 | P1 | ผู้เล่นชำระแล้วและกดกลับมาเล่น | สั่งสินค้า POS แบบพักยอด แล้วเปิด billing sync ของ Match | ผู้เล่นยังเป็นสถานะกลับมาเล่นและยอด POS ใหม่แสดงเป็นยอดเพิ่มที่ต้องชำระ | Playwright | API/Match |
| POS-XMEM-001 | P1 | Active member | ค้นจาก POS Hold | พบเฉพาะสมาชิก Admin เดียวกัน | Playwright | API |
| POS-XMEM-002 | P1 | Hold dialog | เพิ่มสมาชิกใหม่ | ปรากฏในระบบสมาชิก tenant เดียวกัน | Playwright | API |
| POS-XMEM-003 | P1 | Members active/inactive/deleted | ค้น/hold ด้วยทุกสถานะ | inactive/deleted/ข้าม Admin ใช้ไม่ได้ | Go | API |
| POS-XMEM-004 | P0 | Member multiple sessions/sales | ตรวจ IDs และ accounts | Member ID คงเดิมและไม่สร้าง billing account ซ้ำ | Go | API |
| POS-XMEM-005 | P2 | Member เก็บ phone แบบ +66 | ค้นด้วยเลขไทย 10 หลัก `08xxxxxxxx` | ควรพบสมาชิกเดียวกับการค้นชื่อ/+66 | Manual | Chromium/API |
| POS-DASH-001 | P2 | Seed transactions | เลือก 1d/1w/1m | cards, charts, latest bills, low stock, holds ตรง DB | Playwright | API |
| POS-DASH-002 | P2 | Seed transactions | สลับ 1d/1w/1m บนหน้า Dashboard | หัวข้อและการ์ดอัปเดตตรง API ทุกช่วง | Playwright | Chromium |
| POS-DASH-003 | P2 | Dashboard มีบิลและหมวดหมู่ | ตรวจค่าเฉลี่ยและหัวข้อหมวดหมู่ | แสดงค่าเฉลี่ย 2 ตำแหน่งและจำนวนหมวดหมู่จริง | Playwright | Chromium |
| POS-DASH-004 | P2 | Dashboard loaded | กดทางลัดสต็อกและประวัติบิล | เปิดหน้าปลายทางถูกต้อง | Playwright | Chromium |
| POS-NF-003 | P2 | เปิดหน้า POS และเห็นเมนูด้านล่าง | กดปุ่มลูกศรสลับเมนูซ้าย/ขวา | เมนูเลื่อนด้วย animation, ปุ่มย้ายไปอยู่ขอบฝั่งตรงข้าม และจำตำแหน่งเมื่อ reload | Playwright | Chromium |
| POS-NF-004 | P2 | เปิด POS บนหน้าจอแคบ | ตรวจเมนูด้านล่างและสลับตำแหน่ง | รายการเมนู wrap เพิ่มความสูงอัตโนมัติ ไม่มี scrollbar แนวนอน และหน้าไม่เกิด horizontal overflow | Playwright | Chromium Mobile |
| POS-DASH-005 | P2 | Mobile viewport | เปิด Dashboard และสลับช่วงเวลา | ไม่มี horizontal overflow และ controls ไม่ถูก nav บัง | Playwright | Chromium Mobile |
| POS-DASH-006 | P3 | Dashboard loaded | ใช้ Tab/Enter กับการ์ดและบิลล่าสุด | ทุกส่วนที่คลิกได้มี button/link semantics และ keyboard focus | Playwright | Chromium |
| POS-RPT-001 | P2 | Seed reports | วัน/สัปดาห์/เดือน/custom + paginate | ยอด VAT top products payment methods ตรง DB | Playwright | API |
| POS-RPT-002 | P2 | Report selected | Export `.xlsx` | ตรง tab/range ภาษาไทยอ่านได้ ไม่มี technical code/permission error | Manual | Chromium/Excel |
| POS-RPT-003 | P2 | มี paid/hold/void sales หลายวัน | เปิดรายงานสินค้าที่ขายช่วง day/week/month/custom และเปลี่ยนหน้า | รวมเฉพาะ paid ตามเวลารับชำระ Asia/Bangkok พร้อมจำนวนขาย จำนวนบิลและยอดขายหลังส่วนลด/VAT | Playwright | API/Chromium |
| POS-RPT-004 | P2 | สินค้าคงเหลือ 101 ชิ้น กำหนด 12 ชิ้น/แพ็ค | เปิดรายงานสินค้าคงเหลือและใช้ทุก filter | แสดง 8 แพ็ค + เศษ 5 ชิ้น, สินค้า active/inactive, มูลค่าทุน/ขาย และ pagination ถูกต้อง | Playwright | API/Chromium |
| POS-RPT-005 | P1 | มี LiveMatch 2 Session วันเดียวกัน พร้อมผู้เล่นหลายประเภทและลูกแบดคืน/ไม่คืน | เปิดรายงาน POS + LiveMatch | แยก 2 Session, นับผู้เล่นทุกคน, นับลูกจริงครั้งเดียว, ไม่นับลูกที่คืน และรวมยอดตาม snapshot ถูกต้อง | Playwright | API/Chromium |
| POS-RPT-006 | P1 | Staff มี/ไม่มี reports, สิทธิ์รายงานย่อยทั้ง 9 เมนู และ report_export; Admin A/B | เปิดแต่ละแท็บ เรียก report APIs พิมพ์ และส่งออกพร้อม filter | แสดงเฉพาะเมนูที่อนุญาต, API/print/export ปฏิเสธรายงานที่ไม่มีสิทธิ์, tenant isolation ถูกต้อง และไม่แสดง code เทคนิค | Go/Playwright | API/Chromium/Excel |
| POS-RPT-007 | P2 | มีเอกสารรับเข้าที่ระบุซัพพลายเออร์และส่วนลด | ค้นหาชื่อ เลือกซัพพลายเออร์ ดูรายละเอียด และส่งออก Excel รวม/รายเอกสาร | ค่าเริ่มต้นเป็นวันนี้และซัพพลายเออร์ทั้งหมด ตัวกรองทำงาน รายการย่อย/ยอดตรงเอกสาร และคอลัมน์เงินใน Excel เป็นตัวเลข 2 ตำแหน่ง | Playwright | API/Chromium/Excel |
| POS-RPT-008 | P1 | สินค้าคงเหลือกำหนดจำนวนต่อแพ็ก | พิมพ์รายงานสินค้าคงเหลือแบบสลิปย่อ | แสดงแพ็กเต็ม เศษ และยอดรวมหน่วย ส่วนสินค้าไม่กำหนดแพ็กแสดงจำนวนหน่วย | Playwright | Chromium |
| POS-NF-001 | P2 | Desktop/Mobile | เปิด critical pages/modals | ไม่มี overflow/modal หลุด/nav ทับ action | Playwright | Chromium Desktop/Mobile |
| POS-NF-002 | P2 | QA local | วัด API read และ sale/settlement | read <1s, transaction <2s ไม่มี external delay | Playwright | API |
| POS-PWA-001 | P2 | POS served | ตรวจ manifest/service worker/installability | manifest/icon/start URL ถูก | Playwright | Chromium |
| POS-PWA-002 | P3 | Supported device | กดติดตั้ง PWA | ได้ icon เปิด standalone ได้ | Manual | Desktop/Mobile |
| POS-AUDIT-001 | P0 | มีธุรกรรมขาย สต็อก และชำระรวม | บันทึกธุรกรรมสำเร็จและจำลอง audit insert ล้มเหลว | Activity log อยู่ Transaction เดียวกัน มี before/after, Request ID และ rollback ธุรกรรมหาก audit เขียนไม่ได้ | Go | API/PostgreSQL |
| POS-AUDIT-002 | P1 | Owner และ Staff | Login fail/success/logout, เปลี่ยนสิทธิ์, reset PIN และแก้ Setting | มี event/actor/reason ครบ โดยไม่เก็บ password, PIN, PromptPay ID เต็ม หรือ image data | Go | API/PostgreSQL |
| POS-MON-001 | P1 | Backend ทำงาน | ยิง API ให้เกิด 409/429/500 และ slow request | ตอบ X-Request-ID, เก็บ status/latency percentile/route และค้น recent error ด้วย Request ID ได้ | Go | API |
| POS-LOAD-001 | P1 | QA หรือ staging ผ่าน Reverse Proxy | จำลอง 20+ จอ polling แบบ jitter และ synchronized | p95 ≤2s, error ≤1%, ไม่มี polling 429/5xx และผลล้มเหลวมี Request ID | Node load | API/Reverse Proxy |
