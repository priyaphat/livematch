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
		if err := rows.Scan(&item.Severity, &item.Check, &item.AdminID, &item.EntityID, &item.Expected, &item.Actual, &item.Detail); err != nil {
			return err
		}
		*output = append(*output, item)
	}
	return rows.Err()
}

func main() {
	databaseURL := strings.TrimSpace(os.Getenv("AUDIT_DATABASE_URL"))
	if databaseURL == "" {
		log.Fatal("AUDIT_DATABASE_URL is required; stock-audit has no implicit database")
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
	if err := tx.QueryRowContext(ctx, `select current_setting('transaction_read_only')='on'`).Scan(&readOnly); err != nil || !readOnly {
		log.Fatal("database transaction is not read-only")
	}

	issues := []issue{}
	filter := `($1='' or admin_id=$1)`
	checks := []string{
		`select 'P0','negative_stock',admin_id,id,'primary >= 0 and secondary >= 0',stock_quantity::text||'/'||secondary_stock_quantity::text,'ยอดสินค้าติดลบ' from pos_products where ` + filter + ` and deleted_at is null and (stock_quantity<0 or secondary_stock_quantity<0)`,
		`select 'P0','untracked_values',admin_id,id,'stock/threshold/pack = 0',stock_quantity::text||'/'||secondary_stock_quantity::text||'/'||low_stock_threshold::text||'/'||units_per_pack::text,'สินค้าที่ไม่ติดตามสต็อกยังมีค่าของระบบสต็อก' from pos_products where ` + filter + ` and deleted_at is null and not track_stock and (stock_quantity<>0 or secondary_stock_quantity<>0 or low_stock_threshold<>0 or units_per_pack<>0)`,
		`select 'P0','untracked_movement',p.admin_id,p.id,'0 movement',count(m.id)::text,'สินค้าที่ไม่ติดตามสต็อกมี movement' from pos_products p join pos_stock_movements m on m.product_id=p.id and m.admin_id=p.admin_id where ($1='' or p.admin_id=$1) and not p.track_stock group by p.admin_id,p.id having count(m.id)>0`,
		`with chain as (select admin_id,product_id,stock_location,id,balance,delta,lag(balance) over(partition by admin_id,product_id,stock_location order by id) previous_balance from pos_stock_movements where ` + filter + `) select 'P0','movement_chain',admin_id,product_id||':'||stock_location||':'||id::text,previous_balance::text,(balance-delta)::text,'beforeStock ไม่ต่อกับ balance ก่อนหน้า' from chain where previous_balance is not null and previous_balance<>balance-delta`,
		`with latest as (select m.*,row_number() over(partition by m.admin_id,m.product_id,m.stock_location order by m.id desc) rn from pos_stock_movements m where ` + filter + `) select 'P0','latest_balance',l.admin_id,l.product_id||':'||l.stock_location,case when l.stock_location='secondary' then p.secondary_stock_quantity else p.stock_quantity end::text,l.balance::text,'movement ล่าสุดไม่ตรงยอดสินค้า' from latest l join pos_products p on p.id=l.product_id and p.admin_id=l.admin_id where l.rn=1 and l.balance<>case when l.stock_location='secondary' then p.secondary_stock_quantity else p.stock_quantity end`,
		`select 'P0','transfer_pair',m.admin_id,m.batch_id||':'||m.product_id,'out + in = 0, อย่างละ 1',sum(m.delta)::text||', out='||count(*) filter(where m.reason='transfer_out')::text||', in='||count(*) filter(where m.reason='transfer_in')::text,'movement โอนไม่ครบคู่หรือจำนวนไม่ตรง' from pos_stock_movements m join pos_stock_batches b on b.id=m.batch_id and b.admin_id=m.admin_id where ($1='' or m.admin_id=$1) and b.mode='transfer' group by m.admin_id,m.batch_id,m.product_id having sum(m.delta)<>0 or count(*) filter(where m.reason='transfer_out')<>1 or count(*) filter(where m.reason='transfer_in')<>1`,
		`select 'P0','sale_movement',s.admin_id,s.id||':'||coalesce(i.product_id,''),'sale=-quantity; void=quantity only when status void',coalesce(sum(m.delta) filter(where m.reason='sale'),0)::text||'/'||coalesce(sum(m.delta) filter(where m.reason='void'),0)::text,'movement ขายหรือคืนไม่ตรงรายการสินค้า' from pos_sales s join pos_sale_items i on i.sale_id=s.id and i.stock_tracked left join pos_stock_movements m on m.sale_id=s.id and m.product_id=i.product_id where ($1='' or s.admin_id=$1) group by s.admin_id,s.id,s.status,i.product_id,i.quantity having coalesce(sum(m.delta) filter(where m.reason='sale'),0)<>-i.quantity or (s.status='void' and coalesce(sum(m.delta) filter(where m.reason='void'),0)<>i.quantity) or (s.status<>'void' and coalesce(sum(m.delta) filter(where m.reason='void'),0)<>0)`,
		`select 'P0','sale_stock_location',s.admin_id,s.id,s.stock_location,string_agg(distinct m.stock_location,','),'movement ขาย/คืนอยู่ผิดคลังต้นทางของบิล' from pos_sales s join pos_stock_movements m on m.sale_id=s.id where ($1='' or s.admin_id=$1) group by s.admin_id,s.id,s.stock_location having bool_or(m.stock_location<>s.stock_location)`,
		`select 'P0','batch_movement',b.admin_id,b.id,'movement อย่างน้อย 1 รายการ','0','เอกสารสต็อกไม่มี movement' from pos_stock_batches b where ` + filter + ` and not exists(select 1 from pos_stock_movements m where m.batch_id=b.id)`,
		`select 'P0','paid_sale_allocation',s.admin_id,s.id,s.total_satang::text,coalesce(sum(a.amount_satang),0)::text,'ยอด allocation ของบิลชำระแล้วไม่ตรงยอดบิล' from pos_sales s left join billing_payment_allocations a on a.payment_id=s.payment_id and a.source_type='pos' and a.source_id=s.id where ($1='' or s.admin_id=$1) and s.status='paid' group by s.admin_id,s.id,s.total_satang having coalesce(sum(a.amount_satang),0)<>s.total_satang`,
		`select 'P0','negative_money',admin_id,id,'all satang >= 0',gross_total_satang::text||'/'||discount_satang::text||'/'||net_total_satang::text,'เอกสารสต็อกมีมูลค่าติดลบ' from pos_stock_batches where ` + filter + ` and (gross_total_satang<0 or discount_satang<0 or net_total_satang<0)`,
		`select 'P1','opening_balance_only',p.admin_id,p.id,'มี movement สำหรับตรวจย้อนหลัง','ไม่มี movement','สินค้ามียอดคงเหลือแต่ไม่มี movement; ถือเป็นยอดยกมาตั้งต้นและควรตรวจเอกสารเดิม' from pos_products p where ($1='' or p.admin_id=$1) and p.deleted_at is null and p.track_stock and (p.stock_quantity<>0 or p.secondary_stock_quantity<>0) and not exists(select 1 from pos_stock_movements m where m.product_id=p.id and m.admin_id=p.admin_id)`,
	}
	for _, query := range checks {
		if err := collect(ctx, tx, &issues, query, adminID); err != nil {
			log.Fatalf("stock audit query failed: %v", err)
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
	if err := tx.Commit(); err != nil {
		log.Fatal(err)
	}
	if status == "FAIL" {
		os.Exit(1)
	}
}
