package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type issue struct {
	Severity string `json:"severity"`
	Check    string `json:"check"`
	AdminID  string `json:"adminId,omitempty"`
	EntityID string `json:"entityId,omitempty"`
	Expected string `json:"expected,omitempty"`
	Actual   string `json:"actual,omitempty"`
	Detail   string `json:"detail"`
}

type result struct {
	Status      string         `json:"status"`
	ReadOnly    bool           `json:"readOnly"`
	AdminFilter string         `json:"adminFilter,omitempty"`
	CheckedAt   string         `json:"checkedAt"`
	Counts      map[string]int `json:"counts"`
	Issues      []issue        `json:"issues"`
}

func collect(ctx context.Context, tx *sql.Tx, output *[]issue, query string, args ...any) error {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item issue
		if err = rows.Scan(&item.Severity, &item.Check, &item.AdminID, &item.EntityID, &item.Expected, &item.Actual, &item.Detail); err != nil {
			return err
		}
		*output = append(*output, item)
	}
	return rows.Err()
}

func main() {
	databaseURL := strings.TrimSpace(os.Getenv("AUDIT_DATABASE_URL"))
	if databaseURL == "" {
		log.Fatal("AUDIT_DATABASE_URL is required; booking-audit has no implicit database")
	}
	adminID := strings.TrimSpace(os.Getenv("AUDIT_ADMIN_ID"))
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		log.Fatal(err)
	}
	defer tx.Rollback()
	var readOnly bool
	if err = tx.QueryRowContext(ctx, `select current_setting('transaction_read_only')='on'`).Scan(&readOnly); err != nil || !readOnly {
		log.Fatal("database transaction is not read-only")
	}

	issues := []issue{}
	checks := []string{
		`select 'P0','booking_price',b.admin_id,b.id,((extract(epoch from (b.end_at-b.start_at))/60)::int/b.interval_minutes*b.unit_price_thb)::text,b.total_price_thb::text,'ยอดจองไม่ตรงจำนวนช่วงคูณราคาที่บันทึกไว้' from bookings b where ($1='' or b.admin_id=$1) and (b.interval_minutes<=0 or b.unit_price_thb<0 or b.total_price_thb<0 or extract(epoch from (b.end_at-b.start_at))<=0 or (extract(epoch from (b.end_at-b.start_at))/60)::int%b.interval_minutes<>0 or b.total_price_thb<>((extract(epoch from (b.end_at-b.start_at))/60)::int/b.interval_minutes*b.unit_price_thb))`,
		`select 'P0','active_booking_occupancy',b.admin_id,b.id,'1 active occupancy',count(o.id) filter(where o.active)::text,'รายการที่ยังใช้ช่องเวลาต้องมี occupancy ทำงานหนึ่งรายการ' from bookings b left join booking_occupancies o on o.booking_id=b.id and o.kind='booking' where ($1='' or b.admin_id=$1) and b.status in ('hold','pending_review','confirmed') group by b.admin_id,b.id having count(o.id) filter(where o.active)<>1`,
		`select 'P0','inactive_booking_occupancy',b.admin_id,b.id,'0 active occupancy',count(o.id) filter(where o.active)::text,'รายการยกเลิกหรือปฏิเสธแล้วยังล็อกช่องเวลา' from bookings b left join booking_occupancies o on o.booking_id=b.id and o.kind='booking' where ($1='' or b.admin_id=$1) and b.status in ('cancelled','rejected','expired') group by b.admin_id,b.id having count(o.id) filter(where o.active)<>0`,
		`select 'P0','occupancy_snapshot',o.admin_id,o.id::text,b.court_id||'/'||tstzrange(b.start_at,b.end_at,'[)')::text,o.court_id||'/'||o.occupied_range::text,'occupancy ไม่ตรง tenant สนาม หรือช่วงเวลาของ booking' from booking_occupancies o join bookings b on b.id=o.booking_id where ($1='' or o.admin_id=$1) and o.kind='booking' and (o.admin_id<>b.admin_id or o.court_id<>b.court_id or o.occupied_range<>tstzrange(b.start_at,b.end_at,'[)'))`,
		`select 'P0','occupancy_overlap',a.admin_id,a.id::text||'/'||b.id::text,'ไม่ทับซ้อน',a.occupied_range::text||' && '||b.occupied_range::text,'พบ occupancy ทำงานทับซ้อนในสนามเดียวกัน' from booking_occupancies a join booking_occupancies b on b.admin_id=a.admin_id and b.court_id=a.court_id and b.id>a.id and b.active and a.occupied_range&&b.occupied_range where ($1='' or a.admin_id=$1) and a.active`,
		`select 'P0','batch_identity',b.admin_id,b.booking_batch_id,'member/booker/interval เดียวกัน','members='||count(distinct coalesce(b.member_id,''))::text||', bookedBy='||count(distinct b.booked_by)::text||', intervals='||count(distinct b.interval_minutes)::text,'ข้อมูลหลักภายในชุดจองไม่เป็นชุดเดียวกัน' from bookings b where ($1='' or b.admin_id=$1) and coalesce(b.booking_batch_id,'')<>'' group by b.admin_id,b.booking_batch_id having count(distinct coalesce(b.member_id,''))<>1 or count(distinct b.booked_by)<>1 or count(distinct b.interval_minutes)<>1`,
		`select 'P0','payment_amount',p.admin_id,p.id,coalesce(sum(x.total_price_thb),b.total_price_thb)::text,p.amount_thb::text,'ยอดชำระไม่ตรงยอดรวมของชุดจอง' from booking_payments p join bookings b on b.id=p.booking_id left join bookings x on x.admin_id=b.admin_id and b.booking_batch_id is not null and x.booking_batch_id=b.booking_batch_id where ($1='' or p.admin_id=$1) group by p.admin_id,p.id,p.amount_thb,b.total_price_thb having p.amount_thb<>coalesce(sum(x.total_price_thb),b.total_price_thb)`,
		`select 'P0','payment_tenant',coalesce(p.admin_id,''),p.id,b.admin_id,coalesce(p.admin_id,''),'payment อยู่ผิด tenant จาก booking ต้นทาง' from booking_payments p join bookings b on b.id=p.booking_id where ($1='' or b.admin_id=$1) and p.admin_id is distinct from b.admin_id`,
		`select 'P0','pending_workflow',b.admin_id,b.id,'pending_review/pending พร้อม payment pending',b.status||'/'||b.payment_status,'สถานะรอตรวจสอบไม่สัมพันธ์กับ payment ล่าสุด' from bookings b where ($1='' or b.admin_id=$1) and b.status='pending_review' and (b.payment_status<>'pending' or not exists(select 1 from booking_payments p join bookings pb on pb.id=p.booking_id where pb.admin_id=b.admin_id and (pb.id=b.id or (b.booking_batch_id is not null and pb.booking_batch_id=b.booking_batch_id)) and p.status='pending'))`,
		`select 'P0','reviewed_workflow',p.admin_id,p.id,case p.status when 'rejected' then 'rejected/rejected' else 'confirmed-or-cancelled/paid' end,string_agg(distinct b.status||'/'||b.payment_status,','),'ผลตรวจชำระไม่สัมพันธ์กับสถานะการจองทั้งชุด' from booking_payments p join bookings pb on pb.id=p.booking_id join bookings b on b.admin_id=pb.admin_id and (b.id=pb.id or (pb.booking_batch_id is not null and b.booking_batch_id=pb.booking_batch_id)) where ($1='' or p.admin_id=$1) and p.status in ('approved','manual_paid','rejected') group by p.admin_id,p.id,p.status having (p.status='rejected' and bool_or(b.status<>'rejected' or b.payment_status<>'rejected')) or (p.status in ('approved','manual_paid') and bool_or(b.status not in ('confirmed','cancelled') or b.payment_status<>'paid'))`,
		`select 'P1','paid_without_evidence',b.admin_id,b.id,'payment metadata อย่างน้อย 1 รายการ','ไม่มี payment','การจองถูกทำเครื่องหมายว่าชำระแล้วแต่ไม่มีหลักฐานการชำระสำหรับตรวจย้อนหลัง' from bookings b where ($1='' or b.admin_id=$1) and b.payment_status='paid' and not exists(select 1 from booking_payments p join bookings pb on pb.id=p.booking_id where pb.admin_id=b.admin_id and (pb.id=b.id or (b.booking_batch_id is not null and pb.booking_batch_id=b.booking_batch_id)))`,
		`select 'P1','slip_metadata',p.admin_id,p.id,'file key/size/hash ครบ',p.slip_file_key||'/'||p.slip_size_bytes::text||'/'||p.slip_sha256,'ไฟล์สลิปมี metadata ไม่ครบสำหรับตรวจความสมบูรณ์' from booking_payments p where ($1='' or p.admin_id=$1) and p.slip_file_key<>'' and (p.slip_size_bytes<=0 or p.slip_sha256='')`,
	}
	for _, query := range checks {
		if err = collect(ctx, tx, &issues, query, adminID); err != nil {
			log.Fatalf("booking audit query failed: %v", err)
		}
	}
	counts := map[string]int{"P0": 0, "P1": 0, "P2": 0, "P3": 0}
	for _, item := range issues {
		counts[item.Severity]++
	}
	status := "PASS"
	if counts["P0"] > 0 || counts["P1"] > 0 {
		status = "FAIL"
	}
	output := result{Status: status, ReadOnly: readOnly, AdminFilter: adminID, CheckedAt: time.Now().Format(time.RFC3339), Counts: counts, Issues: issues}
	encoded, _ := json.MarshalIndent(output, "", "  ")
	fmt.Println(string(encoded))
	if err = tx.Commit(); err != nil {
		log.Fatal(err)
	}
	if status == "FAIL" {
		os.Exit(1)
	}
}
