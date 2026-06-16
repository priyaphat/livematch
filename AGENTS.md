# AGENTS.md

## Project Overview

App name: LiveMatch

LiveMatch is a mobile-first web app for managing badminton join sessions, team randomization, active matches, and per-player cost summaries.

Languages:

- UI structure should support `th` and `en`.
- v1 content starts in Thai first.

Auth model:

- No full user login/account system in v1.
- Each badminton venue/session has an admin passcode for dashboard and admin actions.
- Players can register or view shared pages through QR code or share link without logging in.

Primary goals:

- Register players who join a badminton session.
- Randomize balanced teams and manage match flow.
- Show per-player costs and overall session summaries.
- Prioritize mobile-first usage.

Target users:

- Court admin/session organizer.
- Badminton players who register through QR code or share link.

## Tech Stack

- Docker services: frontend, backend, pgAdmin, PostgreSQL
- Backend language: Go
- Database: PostgreSQL
- Frontend: Vue
- Styling: Tailwind CSS
- Frontend test framework: Vitest
- Backend test framework: Go test

## Docker

- Development should run through Docker Compose.
- Required services:
  - `frontend`: Vue + Tailwind CSS app
  - `backend`: Go API service
  - `postgres`: PostgreSQL database
  - `pgadmin`: database admin UI for local development
- Keep service names consistent across Docker Compose, environment variables, and documentation.
- Backend should connect to PostgreSQL through the Docker network using the `postgres` service name.

## Theme

- สีกระดาษถนอมสายตา
- เรียบ สไตย์ งานกีฬา
- Light mode
- Dark mode

## System
- ไม่มีระบบ login/account เต็มรูปแบบใน v1
- ผู้ดูแลใช้ admin passcode ต่อสนาม/session เพื่อเข้า dashboard และจัดการข้อมูล
- สมาชิก/ผู้เล่นลงทะเบียนหรือดูข้อมูลผ่าน QR code หรือ share link โดยไม่ต้อง login
- โครงสร้าง UI ควรรองรับ `th/en` แต่ v1 ใช้ภาษาไทยเป็นหลัก
- การพัฒนาและรันระบบในเครื่องควรใช้ Docker Compose เป็นหลัก

## Page && Menu
- index
  - สำหรับสร้างสนาม/session แบด
  - เมื่อกดสร้าง ให้ระบบ generate admin passcode สำหรับผู้ดูแล
  - มีปุ่มเข้า dashboard โดยให้กรอก admin passcode
- dashboard
  - แสดงภาพรวมรายการ จำนวน รายรับ และรายรับรวม
  - ตัวอย่างข้อมูลที่ควรแสดง:
    - ผู้เล่นวันนี้ 42 คน
    - จำนวนแมตช์ที่บันทึก 50 เกม
    - รวมการลงเล่น 164 ครั้ง
    - เฉลี่ยเกมต่อคน 3.904761905
    - ลงน้อยสุด 0 เกม
    - ลงมากสุด 6 เกม
    - ใช้ลูกแบดที่เบิก 42 ลูก
    - ลูกแบดรวม 168 ลูก
  - สามารถเพิ่มข้อมูลวิเคราะห์เพิ่มเติมได้ เช่น ช่วงพีค คนชนะเยอะสุด คนแพ้เยอะสุด และเวลาเฉลี่ย
- player
  - CRUD สมาชิก
  - หากสมาชิกมีข้อมูล live match/history แล้ว ไม่ควรลบถาวร ให้ใช้การปิดใช้งานหรือซ่อนแทน
  - มี QR code สำหรับให้สมาชิกลงทะเบียน
  - แสดง column: เลข(id), ชื่อ, จำนวนเกม, จำนวนลูก, ค่าใช้จ่าย, สถานะจ่ายเงิน
  - สามารถกดแชร์หน้าสมาชิกให้ผู้เล่นเข้าดูได้
  - ก่อนแชร์ ให้เลือกได้ว่าจะแสดงช่องสถานะจ่ายเงินหรือไม่
  - admin สามารถ ติ๊ก จ่ายเงิน checkbox แล้ว save เลย
- livematch
  - ปุ่มคู่รักเปิด modal สำหรับสร้างหรือลบคู่รัก โดยคู่รักต้องอยู่ทีมเดียวกันเสมอ
  - ปุ่มคูปองระดับมือ/สิทธิ์สุ่มเปิด modal รายชื่อคนว่างที่ยังไม่ได้จับทีม
  - ใน modal คูปองระดับมือ ให้แสดงเลขที่ ชื่อ และระดับมือแบบ slide/select
  - หากสมาชิกถูกกำหนดเป็นคู่รัก ให้รวมชื่อเป็นกลุ่มเดียวกันในรายการคูปองระดับมือ
  - ตาราง livematch แสดงเฉพาะรายการรอลงสนาม
  - ตารางรอลงสนามแสดง: เกมที่, สนาม/court, A1, A2, B1, B2, ระดับมือ
  - ปุ่มเริ่มการแข่งขันให้เลือกสนาม/court ก่อนย้ายเกมไป liveboard
  - ปุ่ม random จะ random เฉพาะสมาชิกที่มีคูปองระดับมือ/สิทธิ์สุ่มและมีสถานะว่าง
  - หลัง random สำเร็จ เกมจะถูกเพิ่มในตารางรอลงสนาม
    - กฎการ random
        - เลือกเฉพาะสมาชิกที่มีคูปองระดับมือ/สิทธิ์สุ่มและมีสถานะว่าง
        - สถานะว่างหมายถึงไม่อยู่ในการแข่งขันและไม่อยู่ในคิวรอลงสนาม
        - ให้สมาชิกที่ลงเล่นน้อยกว่ามีลำดับก่อน
        - จับคู่ระดับมือเดียวกันก่อนเสมอ
        - หากมีคู่รักถูกเลือก คู่รักต้องอยู่ทีมเดียวกัน เช่น A1+A2 หรือ B1+B2
        - รูปแบบเกมคือ A1+A2 vs B1+B2
        - หากระดับมือเดียวกันเหลือเศษ ให้ข้ามระดับ `+1/-1` ได้เฉพาะเมื่อ setting เปิดให้จับคู่ข้ามระดับ
        - หาก setting ไม่เปิดให้จับคู่ข้ามระดับ สมาชิกที่เหลือเศษต้องรอรอบถัดไป
- liveboard
    - แสดงการแข่งขันที่กำลังเล่น
    - แสดงข้อมูล: เกมที่, สนาม/court, A1+A2, B1+B2, ระดับมือ, จำนวนลูกที่ใช้, สถานะ
    - จำนวนลูกที่ใช้สามารถกดเพิ่มหรือลบได้
    - มีปุ่มจบการแข่งขันและยกเลิกการแข่งขัน
    - เมื่อจบหรือยกเลิกการแข่งขัน ให้บันทึกหมายเหตุได้
- history
    - แสดงประวัติเกมที่จบแล้วหรือถูกยกเลิก
    - แสดงข้อมูล: เกมที่, สนาม/court, A1, A2, B1, B2, เวลาเริ่ม, เวลาจบ, จำนวนลูกที่ใช้, หมายเหตุ
- setting
    - ค่าเข้าสนามต่อคน
    - ค่าลูกแบด
    - จำนวนสนาม/court
    - เลขสนาม/court โดย default ใช้เลขตามลำดับ
    - ระดับมือ default: light, middle, heavy
    - เปิด/ปิดการจับคู่ข้ามระดับมือ
    - ช่วงการจับคู่ข้ามระดับมือ default: `+1/-1`

## Other
- ค่าเข้าสนามคิดต่อคน
- ค่าลูกแบดคิดจากจำนวนลูกที่ใช้จริงใน liveboard/history
- ค่าใช้จ่ายรายคนคำนวณจากจำนวนเกม จำนวนลูกที่เกี่ยวข้อง และการตั้งค่าค่าใช้จ่าย
- ภาพรวมรายรับและค่าใช้จ่ายใน dashboard ควรอ้างอิงข้อมูลจาก liveboard/history และ player payment status