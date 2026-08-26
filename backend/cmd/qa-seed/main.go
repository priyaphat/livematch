package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"golang.org/x/crypto/bcrypt"
)

const qaDatabaseName = "livematch_qa"

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is required; qa-seed refuses to use an implicit database")
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var databaseName string
	if err = db.QueryRowContext(ctx, `select current_database()`).Scan(&databaseName); err != nil {
		log.Fatal(err)
	}
	if databaseName != qaDatabaseName {
		log.Fatalf("refusing to seed database %q; expected %q", databaseName, qaDatabaseName)
	}

	ownerHash := mustHash("QaPass123!")
	managerHash := mustHash("246824")
	cashierHash := mustHash("135713")

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		log.Fatal(err)
	}
	defer tx.Rollback()

	// Deleting QA owners cascades every prior QA run without touching non-QA rows.
	if _, err = tx.ExecContext(ctx, `delete from sessions where admin_id in ('qa-admin-a','qa-admin-b')`); err != nil {
		log.Fatal(err)
	}
	if _, err = tx.ExecContext(ctx, `delete from billing_accounts where admin_id in ('qa-admin-a','qa-admin-b')`); err != nil {
		log.Fatal(err)
	}
	if _, err = tx.ExecContext(ctx, `delete from members where admin_id in ('qa-admin-a','qa-admin-b')`); err != nil {
		log.Fatal(err)
	}
	if _, err = tx.ExecContext(ctx, `delete from admin_users where id in ('qa-admin-a','qa-admin-b')`); err != nil {
		log.Fatal(err)
	}

	mustExec(ctx, tx, `
		insert into admin_users(id,email,name,password_hash,verified_at,coins,pos_admin_number,system_name)
		values
		('qa-admin-a','qa.owner.a@example.invalid','QA Owner A',$1,now(),1000,9101,'QA LiveMatch A'),
		('qa-admin-b','qa.owner.b@example.invalid','QA Owner B',$1,now(),1000,9102,'QA LiveMatch B')
	`, ownerHash)
	mustExec(ctx, tx, `
		insert into admin_features(admin_id,member_enabled,booking_enabled,pos_enabled,updated_by)
		values ('qa-admin-a',true,true,true,'qa-seed'),('qa-admin-b',true,true,true,'qa-seed')
	`)
	mustExec(ctx, tx, `
		insert into member_types(id,admin_id,code,name,system,active) values
		('qa-member-type-a-general','qa-admin-a','general','สมาชิกทั่วไป',true,true),
		('qa-member-type-a-club','qa-admin-a','club','สมาชิกชมรม',true,true),
		('qa-member-type-b-general','qa-admin-b','general','สมาชิกทั่วไป',true,true),
		('qa-member-type-b-club','qa-admin-b','club','สมาชิกชมรม',true,true)
	`)
	mustExec(ctx, tx, `
		insert into pos_staff(id,admin_id,staff_number,name,email,role,pin_hash,active) values
		('qa-staff-manager-a','qa-admin-a','QA-MGR-001','QA Manager A','qa.manager.a@example.invalid','manager',$1,true),
		('qa-staff-cashier-a','qa-admin-a','QA-CASH-001','QA Cashier A','qa.cashier.a@example.invalid','cashier',$2,true)
	`, managerHash, cashierHash)
	mustExec(ctx, tx, `
		insert into pos_role_permissions(admin_id,role,permissions,updated_by) values
		('qa-admin-a','manager','{"sales":true,"bills":true,"products":true,"stock":true,"reports":true,"settings":true,"discounts":true,"void_sales":true,"stock_adjust":true,"product_pricing":true,"report_export":true,"member_create":true}'::jsonb,'qa-seed'),
		('qa-admin-a','cashier','{"sales":true,"bills":true,"products":false,"stock":false,"reports":false,"settings":false,"discounts":false,"void_sales":false,"stock_adjust":false,"product_pricing":false,"report_export":false,"member_create":true}'::jsonb,'qa-seed')
	`)

	mustExec(ctx, tx, `
		insert into members(id,admin_id,name,phone,member_type,member_type_id,active,profile_token_hash,profile_token) values
		('qa-member-a-1','qa-admin-a','สมาชิก QA Match Only','0810000001','general','qa-member-type-a-general',true,'qa-profile-hash-a-1','qa-profile-a-1'),
		('qa-member-a-2','qa-admin-a','สมาชิก QA Match POS','0810000002','club','qa-member-type-a-club',true,'qa-profile-hash-a-2','qa-profile-a-2'),
		('qa-member-a-3','qa-admin-a','สมาชิก QA คนที่สาม','0810000003','general','qa-member-type-a-general',true,'qa-profile-hash-a-3','qa-profile-a-3'),
		('qa-member-a-inactive','qa-admin-a','สมาชิก QA ปิดใช้งาน','0810000004','general','qa-member-type-a-general',false,'qa-profile-hash-a-4','qa-profile-a-4'),
		('qa-member-b-1','qa-admin-b','สมาชิก QA Tenant B','0820000001','general','qa-member-type-b-general',true,'qa-profile-hash-b-1','qa-profile-b-1')
	`)
	mustExec(ctx, tx, `
		insert into billing_accounts(id,admin_id,kind,member_id,display_name,phone,active) values
		('qa-billing-a-1','qa-admin-a','member','qa-member-a-1','สมาชิก QA Match Only','0810000001',true),
		('qa-billing-a-2','qa-admin-a','member','qa-member-a-2','สมาชิก QA Match POS','0810000002',true),
		('qa-billing-a-3','qa-admin-a','member','qa-member-a-3','สมาชิก QA คนที่สาม','0810000003',true),
		('qa-billing-b-1','qa-admin-b','member','qa-member-b-1','สมาชิก QA Tenant B','0820000001',true)
	`)

	mustExec(ctx, tx, `
		insert into sessions(id,name,session_type,admin_passcode,state,admin_id,usage_started_at)
		values
		('qa-session-a','QA Cross-system Session','liveMatch','qa-pass','{}'::jsonb,'qa-admin-a',(date_trunc('day',now() at time zone 'Asia/Bangkok')+interval '9 hour') at time zone 'Asia/Bangkok'),
		('qa-session-a-2','QA Same-day Session 2','liveMatch','qa-pass-2','{}'::jsonb,'qa-admin-a',(date_trunc('day',now() at time zone 'Asia/Bangkok')+interval '10 hour') at time zone 'Asia/Bangkok')
	`)
	mustExec(ctx, tx, `
		insert into session_settings(session_id,entry_fee,club_entry_fee,member_entry_fees,shuttle_fee,shuttle_brands,court_count,court_names)
		values
		('qa-session-a',120,100,'{"qa-member-type-a-general":120,"qa-member-type-a-club":100}'::jsonb,50,'[{"id":"qa-shuttle","name":"ลูกแบด QA","price":50,"active":true}]'::jsonb,2,'["สนาม 1","สนาม 2"]'::jsonb),
		('qa-session-a-2',80,70,'{"qa-member-type-a-general":80,"qa-member-type-a-club":70}'::jsonb,55,'[{"id":"qa-shuttle","name":"ลูกแบด QA","price":55,"active":true}]'::jsonb,1,'["สนาม 1"]'::jsonb)
	`)
	mustExec(ctx, tx, `
		insert into players(session_id,id,name,games,shuttles,paid,active,level,coupon,member_id,member_type_id,billing_account_id) values
		('qa-session-a',1,'สมาชิก QA Match Only',1,2,false,true,'middle',true,'qa-member-a-1','qa-member-type-a-general','qa-billing-a-1'),
		('qa-session-a',2,'สมาชิก QA Match POS',1,1,false,true,'middle',true,'qa-member-a-2','qa-member-type-a-club','qa-billing-a-2'),
		('qa-session-a',3,'สมาชิก QA คนที่สาม',1,0,false,true,'middle',true,'qa-member-a-3','qa-member-type-a-general','qa-billing-a-3'),
		('qa-session-a',4,'ผู้เล่นขาจร QA',1,1,false,true,'middle',true,null,null,null)
	`)
	mustExec(ctx, tx, `
		insert into players(session_id,id,name,games,shuttles,paid,active,level,coupon,member_id,member_type_id,billing_account_id) values
		('qa-session-a-2',1,'สมาชิก QA คนที่สาม',1,1,false,false,'middle',true,'qa-member-a-3','qa-member-type-a-general','qa-billing-a-3')
	`)
	mustExec(ctx, tx, `
		insert into matches(session_id,id,phase,court,level,a1,a2,b1,b2,shuttles,shuttle_sequence_items,status,shuttle_pricing_mode,shuttle_price_snapshot,legacy_shuttle_fee) values
		('qa-session-a',1,'history','สนาม 1','middle',1,2,3,4,2,'[{"brandId":"qa-shuttle","number":1},{"brandId":"qa-shuttle","number":2}]'::jsonb,'finished','split_per_match','[{"id":"qa-shuttle","name":"ลูกแบด QA","price":50,"active":true}]'::jsonb,50),
		('qa-session-a-2',1,'history','สนาม 1','middle',1,1,1,1,1,'[{"brandId":"qa-shuttle","number":1}]'::jsonb,'finished','split_per_match','[{"id":"qa-shuttle","name":"ลูกแบด QA","price":55,"active":true}]'::jsonb,55)
	`)

	mustExec(ctx, tx, `
		insert into pos_categories(id,admin_id,name,active,icon,color) values
		('qa-category-drink-a','qa-admin-a','เครื่องดื่ม',true,'Coffee','#EF4444'),
		('qa-category-snack-a','qa-admin-a','ของว่าง',true,'Cookie','#F59E0B'),
		('qa-category-b','qa-admin-b','Tenant B Category',true,'Package','#64748B')
	`)
	mustExec(ctx, tx, `
		insert into pos_units(id,admin_id,name,active) values
		('qa-unit-cup-a','qa-admin-a','แก้ว',true),
		('qa-unit-piece-a','qa-admin-a','ชิ้น',true),
		('qa-unit-b','qa-admin-b','กล่อง',true)
	`)
	mustExec(ctx, tx, `
		insert into pos_products(id,admin_id,sku,category,name,price_thb,price_satang,cost_thb,cost_satang,stock_quantity,low_stock_threshold,active,unit,units_per_pack,image_data,barcode,description) values
		('qa-product-coffee-a','qa-admin-a','QA-COFFEE-001','qa-category-drink-a','กาแฟ QA',45,4500,20,2000,40,5,true,'แก้ว',12,'','8850000000001','สินค้าทดสอบ QA'),
		('qa-product-cake-a','qa-admin-a','QA-CAKE-001','qa-category-snack-a','เค้ก QA',60,6000,30,3000,2,5,true,'ชิ้น',0,'','8850000000002','สินค้าสต็อกต่ำ QA'),
		('qa-product-inactive-a','qa-admin-a','QA-OFF-001','qa-category-snack-a','สินค้าปิด QA',10,1000,5,500,10,5,false,'ชิ้น',5,'','8850000000003',''),
		('qa-product-b','qa-admin-b','QA-B-001','qa-category-b','สินค้า Tenant B',99,9900,50,5000,99,5,true,'กล่อง',10,'','8850000000004','')
	`)
	mustExec(ctx, tx, `
		insert into pos_suppliers(id,admin_id,code,name,contact_person,phone,email,address,active)
		values ('qa-supplier-a','qa-admin-a','SUP-QA-001','ซัพพลายเออร์ QA','คุณทดสอบ','0890000001','supplier.qa@example.invalid','QA address',true)
	`)
	mustExec(ctx, tx, `
		insert into pos_settings(admin_id,promptpay_type,promptpay_id,promptpay_receiver_name,receipt_header,receipt_footer,default_low_stock,theme,language,tax_rate_percent,prices_include_tax,inherit_booking_promptpay,store_tax_id,store_phone,store_email,store_address,navbar_title,customer_display_title,customer_display_highlight,customer_display_subtitle,customer_display_card_text,customer_display_cta_text)
		values ('qa-admin-a','mobile','0810000000','QA Receiver','QA POS Receipt','ขอบคุณที่ใช้ระบบ QA',5,'light','th',7,true,false,'0105555000000','0810000000','qa.store@example.invalid','QA address','QA POS','ยินดีต้อนรับ QA','พร้อมทดสอบระบบ','หน้าจอลูกค้าสำหรับ QA','ตรวจรายการและยอดก่อนชำระ','สั่งรายการได้ที่แคชเชียร์')
	`)

	if err = tx.Commit(); err != nil {
		log.Fatal(err)
	}
	fmt.Println("QA seed completed: owners=2 staff=2 members=5 products=4 sessions=2")
}

func mustHash(value string) string {
	hash, err := bcrypt.GenerateFromPassword([]byte(value), bcrypt.MinCost)
	if err != nil {
		log.Fatal(err)
	}
	return string(hash)
}

func mustExec(ctx context.Context, tx *sql.Tx, query string, args ...any) {
	if _, err := tx.ExecContext(ctx, query, args...); err != nil {
		log.Fatalf("seed statement failed: %v", err)
	}
}
