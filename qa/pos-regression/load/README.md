# POS multi-terminal polling load test

ตัวทดสอบนี้จำลองหลายเครื่องเปิด POS พร้อมกัน โดย Login เพียงครั้งเดียวแล้วแต่ละ virtual client ยิงเฉพาะ `GET` ไปที่ยอดค้าง ประวัติ สินค้า และสรุปสต็อก ไม่มีการขาย ชำระเงิน หรือแก้ข้อมูล

รัน Local QA:

```powershell
./qa/pos-regression/run-load.ps1 -Clients 20 -DurationSeconds 60
```

รันผ่าน Reverse Proxy บน Hostinger ต้องยืนยัน `-AllowRemote` และกำหนดบัญชีทดสอบผ่าน environment variable:

```powershell
$env:POS_IDENTIFIER = 'load-test@example.com'
$env:POS_SECRET = '...'
./qa/pos-regression/run-load.ps1 -BaseURL 'https://your-domain.example' -Clients 30 -DurationSeconds 180 -AllowRemote
```

เกณฑ์ผ่านเริ่มต้น: p95 ไม่เกิน 2 วินาที, error rate ไม่เกิน 1%, ไม่มี `429` จาก polling และไม่มี `5xx` ผล JSON จะอยู่ใน `results/` และ failure ทุกตัวเก็บ Request ID สำหรับค้นใน CloudPanel log

ใช้ `-Synchronized` เพื่อจำลองทุกเครื่องยิงพร้อมกัน (thundering herd) และใช้แบบปกติเพื่อจำลอง polling ที่มี jitter ใกล้การใช้งานจริง
