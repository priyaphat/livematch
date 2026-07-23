package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"golang.org/x/crypto/bcrypt"
)

type app struct {
	db  *sql.DB
	tts *ttsService
}

const defaultAnnouncementTemplate = "บุฟเฟ่ต์สนามที่ {court}\n{pause}\nคุณ{a} คุณ{b} คุณ{c} คุณ{d}"
const defaultShuttleBrandID = "default"
const defaultShuttleBrandName = "ลูกแบดทั่วไป"

type HealthResponse struct {
	Status    string    `json:"status"`
	Service   string    `json:"service"`
	Timestamp time.Time `json:"timestamp"`
}

type SessionRecord struct {
	ID            string       `json:"id"`
	Name          string       `json:"name"`
	AdminPasscode string       `json:"adminPasscode"`
	State         SessionState `json:"state"`
}

type SessionState struct {
	Tab              string            `json:"tab"`
	Theme            string            `json:"theme"`
	Session          SessionInfo       `json:"session"`
	Settings         Settings          `json:"settings"`
	Players          []Player          `json:"players"`
	Couples          []Couple          `json:"couples"`
	ReturnedShuttles []ReturnedShuttle `json:"returnedShuttles"`
	Pending          []Match           `json:"pending"`
	Queue            []Match           `json:"queue"`
	Live             []Match           `json:"live"`
	History          []Match           `json:"history"`
	LiveShare        LiveShareHours    `json:"liveShare"`
	NextIDs          NextIDs           `json:"nextIds"`
	UpdatedAt        time.Time         `json:"updatedAt"`
}

type SessionInfo struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Type           string `json:"type"`
	AdminPasscode  string `json:"adminPasscode"`
	Unlocked       bool   `json:"unlocked"`
	CreatedAt      string `json:"createdAt"`
	ExpiresAt      string `json:"expiresAt"`
	Expired        bool   `json:"expired"`
	ReadOnly       bool   `json:"readOnly"`
	ReadOnlyReason string `json:"readOnlyReason"`
}

type Settings struct {
	EntryFee                int            `json:"entryFee"`
	ClubEntryFee            int            `json:"clubEntryFee"`
	CourtFeePerHour         int            `json:"courtFeePerHour"`
	ShuttleFee              int            `json:"shuttleFee"`
	ShuttleBrands           []ShuttleBrand `json:"shuttleBrands"`
	SessionFee              int            `json:"sessionFee"`
	CourtCount              int            `json:"courtCount"`
	CourtNames              []string       `json:"courtNames"`
	Levels                  []string       `json:"levels"`
	AllowCrossLevel         bool           `json:"allowCrossLevel"`
	CrossLevelRange         int            `json:"crossLevelRange"`
	RandomPriority          string         `json:"randomPriority"`
	ShowPaymentOnShare      bool           `json:"showPaymentOnShare"`
	ShowTotalOnShare        bool           `json:"showTotalOnShare"`
	ResetPlayersAfterFinish bool           `json:"resetPlayersAfterFinish"`
	StartMatchWithShuttle   bool           `json:"startMatchWithShuttle"`
	AnnouncementTemplate    string         `json:"announcementTemplate"`
}

type Player struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	Games      int    `json:"games"`
	Wins       int    `json:"wins"`
	Draws      int    `json:"draws"`
	Losses     int    `json:"losses"`
	Shuttles   int    `json:"shuttles"`
	Paid       bool   `json:"paid"`
	Active     bool   `json:"active"`
	Level      string `json:"level"`
	Coupon     bool   `json:"coupon"`
	ClubMember bool   `json:"clubMember"`
	MemberID   string `json:"memberId,omitempty"`
}

type ShuttleBrand struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Price  int    `json:"price"`
	Active bool   `json:"active"`
}

type ShuttleSeqItem struct {
	BrandID string `json:"brandId"`
	Number  int    `json:"number"`
}

type ReturnedShuttle struct {
	BrandID string `json:"brandId"`
	Number  int    `json:"number"`
}

type Couple struct {
	ID int `json:"id"`
	A  int `json:"a"`
	B  int `json:"b"`
}

type Match struct {
	ID                     int              `json:"id"`
	Court                  string           `json:"court"`
	Level                  string           `json:"level"`
	A1                     int              `json:"a1"`
	A2                     int              `json:"a2"`
	B1                     int              `json:"b1"`
	B2                     int              `json:"b2"`
	Shuttles               int              `json:"shuttles"`
	Winner                 string           `json:"winner"`
	ShuttleSeq             string           `json:"shuttleSequence"`
	ShuttleSeqItems        []ShuttleSeqItem `json:"shuttleSequenceItems"`
	ShuttleReturned        bool             `json:"shuttleReturned"`
	ReturnedShuttleBrandID string           `json:"returnedShuttleBrandId"`
	ReturnedShuttleNumber  int              `json:"returnedShuttleNumber"`
	Status                 string           `json:"status"`
	StartedAt              string           `json:"startedAt"`
	EndedAt                string           `json:"endedAt"`
	Note                   string           `json:"note"`
}

type LiveShareHours struct {
	CourtHours   map[string][]int `json:"courtHours"`
	PlayerHours  map[string][]int `json:"playerHours"`
	ShuttleHours map[string]int   `json:"shuttleHours"`
}

type NextIDs struct {
	Player  int `json:"player"`
	Couple  int `json:"couple"`
	Match   int `json:"match"`
	Pending int `json:"pending"`
}

var errPlayerNotFound = errors.New("player not found")

type requestContextKey string

const (
	requestIDContextKey requestContextKey = "request_id"
	requestIPContextKey requestContextKey = "request_ip"
)

func validateProductionConfig() error {
	if !strings.EqualFold(strings.TrimSpace(os.Getenv("APP_ENV")), "production") {
		return nil
	}
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("APP_BASE_URL")), "/")
	if !strings.HasPrefix(strings.ToLower(baseURL), "https://") {
		return errors.New("APP_BASE_URL must use HTTPS when APP_ENV=production")
	}
	missing := []string{}
	for _, key := range []string{"APP_ALLOWED_ORIGINS", "APP_ENCRYPTION_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URL"} {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("production configuration missing: %s", strings.Join(missing, ", "))
	}
	if !strings.EqualFold(os.Getenv("COOKIE_SECURE"), "true") {
		return errors.New("COOKIE_SECURE must be true when APP_BASE_URL uses HTTPS")
	}
	if len(strings.TrimSpace(os.Getenv("APP_ENCRYPTION_KEY"))) < 32 {
		return errors.New("APP_ENCRYPTION_KEY must contain at least 32 characters")
	}
	redirect := strings.TrimSpace(os.Getenv("GOOGLE_REDIRECT_URL"))
	if !strings.HasPrefix(strings.ToLower(redirect), "https://") {
		return errors.New("GOOGLE_REDIRECT_URL must use HTTPS in production")
	}
	return nil
}

func main() {
	if err := validateProductionConfig(); err != nil {
		log.Fatal(err)
	}
	db, err := openDB()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	a := &app{db: db}
	if err := a.migrate(context.Background()); err != nil {
		log.Fatal(err)
	}
	go a.runExpiredBookingHoldCleanup(context.Background())
	go a.runRateLimitCleanup(context.Background())
	a.tts = newTTSService(db)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", a.handleHealth)
	mux.HandleFunc("/api/auth/", a.handleAuthRoutes)
	mux.HandleFunc("/api/admin/", a.handleAdminSupervisorRoutes)
	mux.HandleFunc("/api/backoffice/", a.handleBackofficeRoutes)
	mux.HandleFunc("/api/support-issues", a.handleSupportIssues)
	mux.HandleFunc("/api/telegram/webhook/", a.handleTelegramWebhook)
	mux.HandleFunc("/api/booking-telegram/webhook/", a.handleBookingTelegramWebhook)
	mux.HandleFunc("/api/public-auth/", a.handlePublicAuth)
	mux.HandleFunc("/api/public-booking/", a.handlePublicBooking)
	mux.HandleFunc("/api/profile/", a.handleProfile)
	mux.HandleFunc("/api/supervisor/summary", a.handleSupervisorSummary)
	mux.HandleFunc("/api/supervisor/session-detail", a.handleSupervisorSessionDetail)
	mux.HandleFunc("/api/sessions/unlock", a.handleUnlockByPasscode)
	mux.HandleFunc("/api/sessions", a.handleSessions)
	mux.HandleFunc("/api/sessions/", a.handleSessionRoutes)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("LiveMatch backend listening on :%s", port)
	if err := http.ListenAndServe(":"+port, withCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

func openDB() (*sql.DB, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://livematch:livematch@localhost:5432/livematch?sslmode=disable"
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return db, db.PingContext(ctx)
}

func (a *app) migrate(ctx context.Context) error {
	_, err := a.db.ExecContext(ctx, `
		create table if not exists sessions (
			id text primary key,
			name text not null,
			session_type text not null default 'liveMatch',
			admin_passcode text not null,
			state jsonb not null,
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		);
		alter table sessions add column if not exists name text;
		alter table sessions add column if not exists session_type text not null default 'liveMatch';
		alter table sessions add column if not exists admin_passcode text;
		alter table sessions add column if not exists state jsonb;
		alter table sessions add column if not exists admin_id text;
		alter table sessions add column if not exists created_at timestamptz not null default now();
		alter table sessions add column if not exists updated_at timestamptz not null default now();
		alter table sessions alter column name drop not null;
		alter table sessions alter column admin_passcode drop not null;
		alter table sessions alter column state drop not null;
		do $$
		begin
			if exists (
				select 1 from information_schema.columns
				where table_name = 'sessions' and column_name = 'venue_name'
			) then
				alter table sessions alter column venue_name drop not null;
			end if;
		end $$;
		create table if not exists session_settings (
			session_id text primary key references sessions(id) on delete cascade,
			entry_fee integer not null default 120,
			club_entry_fee integer not null default 120,
			court_fee_per_hour integer not null default 150,
			shuttle_fee integer not null default 85,
			shuttle_brands jsonb not null default '[]'::jsonb,
			session_fee integer not null default 0,
			court_count integer not null default 4,
			court_names jsonb not null default '["สนาม 1","สนาม 2","สนาม 3","สนาม 4"]'::jsonb,
			levels jsonb not null default '["light","middle","heavy"]'::jsonb,
			allow_cross_level boolean not null default true,
			cross_level_range integer not null default 1,
			random_priority text not null default 'level',
			show_payment_on_share boolean not null default true,
			show_total_on_share boolean not null default true,
			reset_players_after_finish boolean not null default true,
			start_match_with_shuttle boolean not null default true,
			announcement_template text not null default 'บุฟเฟ่ต์สนามที่ {court}
{pause}
คุณ{a} คุณ{b} คุณ{c} คุณ{d}'
		);
		alter table session_settings add column if not exists random_priority text not null default 'level';
		alter table session_settings add column if not exists club_entry_fee integer not null default 120;
		alter table session_settings add column if not exists court_fee_per_hour integer not null default 150;
		alter table session_settings add column if not exists shuttle_brands jsonb not null default '[]'::jsonb;
		alter table session_settings add column if not exists show_payment_on_share boolean not null default true;
		alter table session_settings add column if not exists show_total_on_share boolean not null default true;
		alter table session_settings add column if not exists reset_players_after_finish boolean not null default true;
		alter table session_settings add column if not exists start_match_with_shuttle boolean not null default true;
		alter table session_settings add column if not exists session_fee integer not null default 0;
		alter table session_settings add column if not exists announcement_template text not null default 'บุฟเฟ่ต์สนามที่ {court}
{pause}
คุณ{a} คุณ{b} คุณ{c} คุณ{d}';
		create table if not exists players (
			session_id text not null references sessions(id) on delete cascade,
			id integer not null,
			name text not null,
			games integer not null default 0,
			wins integer not null default 0,
			draws integer not null default 0,
			losses integer not null default 0,
			shuttles integer not null default 0,
			paid boolean not null default false,
			active boolean not null default true,
			level text not null default 'middle',
			coupon boolean not null default false,
			club_member boolean not null default false,
			primary key (session_id, id)
		);
		alter table players add column if not exists wins integer not null default 0;
		alter table players add column if not exists draws integer not null default 0;
		alter table players add column if not exists losses integer not null default 0;
		alter table players alter column coupon set default false;
		alter table players add column if not exists club_member boolean not null default false;
		alter table players add column if not exists member_id text;
		create table if not exists couples (
			session_id text not null references sessions(id) on delete cascade,
			id integer not null,
			player_a integer not null,
			player_b integer not null,
			primary key (session_id, id)
		);
		create table if not exists matches (
			session_id text not null references sessions(id) on delete cascade,
			id integer not null,
			phase text not null check (phase in ('pending', 'queue', 'live', 'history')),
			court text not null default '-',
			level text not null,
			a1 integer not null,
			a2 integer not null,
			b1 integer not null,
			b2 integer not null,
			shuttles integer not null default 0,
			winner text not null default '',
			shuttle_sequence text not null default '',
			shuttle_sequence_items jsonb not null default '[]'::jsonb,
			shuttle_returned boolean not null default false,
			returned_shuttle_brand_id text not null default '',
			returned_shuttle_number integer not null default 0,
			status text not null default '',
			started_at text not null default '',
			ended_at text not null default '',
			note text not null default '',
			primary key (session_id, id)
		);
		alter table matches drop constraint if exists matches_phase_check;
		alter table matches add constraint matches_phase_check check (phase in ('pending', 'queue', 'live', 'history'));
		alter table matches add column if not exists winner text not null default '';
		alter table matches add column if not exists shuttle_sequence text not null default '';
		alter table matches add column if not exists shuttle_sequence_items jsonb not null default '[]'::jsonb;
		alter table matches add column if not exists shuttle_returned boolean not null default false;
		alter table matches add column if not exists returned_shuttle_brand_id text not null default '';
		alter table matches add column if not exists returned_shuttle_number integer not null default 0;
		create table if not exists returned_shuttles (
			session_id text not null references sessions(id) on delete cascade,
			brand_id text not null default 'default',
			shuttle_number integer not null check (shuttle_number > 0),
			primary key (session_id, brand_id, shuttle_number)
		);
		alter table returned_shuttles add column if not exists brand_id text not null default 'default';
		alter table returned_shuttles drop constraint if exists returned_shuttles_pkey;
		alter table returned_shuttles add primary key (session_id, brand_id, shuttle_number);
		create table if not exists live_share_hours (
			session_id text not null references sessions(id) on delete cascade,
			kind text not null check (kind in ('court', 'player', 'shuttle')),
			target text not null,
			hour integer not null,
			quantity integer not null default 1,
			primary key (session_id, kind, target, hour)
		);
		create table if not exists tts_monthly_usage (
			period text primary key,
			characters bigint not null default 0 check (characters >= 0),
			updated_at timestamptz not null default now()
		);
		alter table live_share_hours add column if not exists quantity integer not null default 1;
		alter table live_share_hours drop constraint if exists live_share_hours_kind_check;
		alter table live_share_hours add constraint live_share_hours_kind_check check (kind in ('court', 'player', 'shuttle'));
		create index if not exists idx_players_session on players(session_id);
		create index if not exists idx_couples_session on couples(session_id);
		create index if not exists idx_matches_session_phase on matches(session_id, phase);
		create index if not exists idx_live_share_hours_session on live_share_hours(session_id);
		create table if not exists admin_users (
			id text primary key,
			email text not null unique,
			name text not null,
			password_hash text not null,
			verified_at timestamptz,
			coins integer not null default 0,
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		);
		create table if not exists admin_default_settings (
			admin_id text primary key references admin_users(id) on delete cascade,
			settings jsonb not null,
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		);
		create table if not exists backoffice_users (
			username text primary key,
			name text not null,
			password_hash text not null,
			active boolean not null default true,
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		);
		create table if not exists admin_sessions (
			token_hash text primary key,
			admin_id text not null references admin_users(id) on delete cascade,
			created_at timestamptz not null default now(),
			expires_at timestamptz not null
		);
		create table if not exists backoffice_sessions (
			token_hash text primary key,
			username text not null references backoffice_users(username) on delete cascade,
			created_at timestamptz not null default now(),
			expires_at timestamptz not null
		);
		create table if not exists email_verification_tokens (
			token_hash text primary key,
			admin_id text not null references admin_users(id) on delete cascade,
			created_at timestamptz not null default now(),
			expires_at timestamptz not null,
			used_at timestamptz
		);
		create table if not exists password_reset_tokens (
			token_hash text primary key,
			admin_id text not null references admin_users(id) on delete cascade,
			created_at timestamptz not null default now(),
			expires_at timestamptz not null,
			used_at timestamptz
		);
		create table if not exists system_settings (
			key text primary key,
			value text not null,
			updated_at timestamptz not null default now()
		);
		create table if not exists coin_ledger (
			id bigserial primary key,
			admin_id text not null references admin_users(id) on delete cascade,
			delta integer not null,
			balance integer not null,
			reason text not null,
			note text not null default '',
			created_at timestamptz not null default now()
		);
		create table if not exists admin_discounts (
			admin_id text primary key references admin_users(id) on delete cascade,
			discount_percent integer not null default 0 check (discount_percent between 0 and 100),
			updated_by text not null default '',
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		);
		create table if not exists admin_subscriptions (
			id text primary key,
			admin_id text not null references admin_users(id) on delete cascade,
			start_date date not null,
			end_date date not null,
			total_sessions integer not null check (total_sessions > 0),
			used_sessions integer not null default 0 check (used_sessions >= 0 and used_sessions <= total_sessions),
			paid_amount_thb integer not null default 0 check (paid_amount_thb >= 0),
			note text not null default '',
			created_by text not null default '',
			cancelled_at timestamptz,
			cancelled_by text not null default '',
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now(),
			check (end_date >= start_date)
		);
		create table if not exists session_billing (
			session_id text primary key references sessions(id) on delete cascade,
			admin_id text not null references admin_users(id) on delete cascade,
			session_type text not null,
			billing_method text not null check (billing_method in ('coin', 'subscription')),
			base_coin_cost integer not null default 0 check (base_coin_cost >= 0),
			discount_percent integer not null default 0 check (discount_percent between 0 and 100),
			charged_coin_cost integer not null default 0 check (charged_coin_cost >= 0),
			subscription_id text references admin_subscriptions(id) on delete set null,
			created_at timestamptz not null default now()
		);
		create table if not exists coin_packages (
			id text primary key,
			name text not null,
			price_thb integer not null,
			coins integer not null,
			bonus_text text not null default '',
			active boolean not null default true,
			sort_order integer not null default 0,
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		);
		create table if not exists subscription_packages (
			id text primary key,
			name text not null,
			price_thb integer not null check (price_thb > 0),
			total_sessions integer not null check (total_sessions > 0),
			duration_days integer not null check (duration_days > 0),
			bonus_text text not null default '',
			active boolean not null default true,
			sort_order integer not null default 0,
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		);
		create table if not exists coin_purchase_orders (
			id text primary key,
			admin_id text not null references admin_users(id) on delete cascade,
			package_id text not null,
			price_thb integer not null,
			coins integer not null,
			slip_image text not null,
			status text not null default 'pending',
			note text not null default '',
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now(),
			reviewed_at timestamptz
		);
		alter table coin_purchase_orders add column if not exists product_type text not null default 'coin';
		alter table coin_purchase_orders add column if not exists package_name text not null default '';
		alter table coin_purchase_orders add column if not exists total_sessions integer not null default 0;
		alter table coin_purchase_orders add column if not exists duration_days integer not null default 0;
		alter table coin_purchase_orders add column if not exists subscription_id text references admin_subscriptions(id) on delete set null;
		alter table coin_purchase_orders add column if not exists trans_ref text not null default '';
		alter table coin_purchase_orders add column if not exists slip_qr_payload text not null default '';
		alter table coin_purchase_orders add column if not exists detected_amount_thb integer;
		alter table coin_purchase_orders add column if not exists detected_paid_at text not null default '';
		alter table coin_purchase_orders add column if not exists detected_receiver text not null default '';
		alter table coin_purchase_orders add column if not exists verification_status text not null default 'manual_review';
		alter table coin_purchase_orders add column if not exists verification_note text not null default '';
		alter table coin_purchase_orders add column if not exists verification_provider text not null default 'local';
		alter table coin_purchase_orders add column if not exists provider_status text not null default 'not_checked';
		alter table coin_purchase_orders add column if not exists provider_error_code integer not null default 0;
		alter table coin_purchase_orders add column if not exists provider_checked_at timestamptz;
		alter table coin_purchase_orders drop constraint if exists coin_purchase_orders_status_check;
		alter table coin_purchase_orders add constraint coin_purchase_orders_status_check check (status in ('pending', 'approved', 'rejected'));
		alter table coin_purchase_orders drop constraint if exists coin_purchase_orders_verification_status_check;
		alter table coin_purchase_orders add constraint coin_purchase_orders_verification_status_check check (verification_status in ('passed', 'warning', 'manual_review', 'duplicate'));
		alter table coin_purchase_orders drop constraint if exists coin_purchase_orders_product_type_check;
		alter table coin_purchase_orders add constraint coin_purchase_orders_product_type_check check (product_type in ('coin', 'subscription'));
		create table if not exists activity_logs (
			id bigserial primary key,
			actor_type text not null,
			actor_id text not null,
			action text not null,
			target_type text not null default '',
			target_id text not null default '',
			details text not null default '{}',
			created_at timestamptz not null default now()
		);
		create extension if not exists btree_gist;
		create table if not exists admin_features (
			admin_id text primary key references admin_users(id) on delete cascade,
			member_enabled boolean not null default false,
			booking_enabled boolean not null default false,
			updated_by text not null default '',
			updated_at timestamptz not null default now()
		);
		create table if not exists public_users (
			id text primary key,
			google_sub text not null unique,
			email text not null unique,
			google_name text not null default '',
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		);
		create table if not exists public_user_sessions (
			token_hash text primary key,
			public_user_id text not null references public_users(id) on delete cascade,
			expires_at timestamptz not null,
			created_at timestamptz not null default now()
		);
		create table if not exists oauth_login_states (
			state_hash text primary key,
			nonce text not null,
			admin_id text not null references admin_users(id) on delete cascade,
			return_path text not null default '',
			expires_at timestamptz not null,
			created_at timestamptz not null default now()
		);
		create table if not exists members (
			id text primary key,
			admin_id text not null references admin_users(id) on delete cascade,
			public_user_id text references public_users(id) on delete set null,
			name text not null,
			phone text not null,
			contact_email text not null default '',
			member_type text not null default 'general' check (member_type in ('general','club')),
			active boolean not null default true,
			profile_token_hash text not null unique,
			profile_token text not null default '',
			deleted_at timestamptz,
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now(),
			unique (admin_id, phone),
			unique (admin_id, public_user_id)
		);
		alter table members add column if not exists profile_token text not null default '';
		alter table members drop constraint if exists members_admin_id_phone_key;
		create unique index if not exists idx_members_admin_phone_active on members(admin_id, phone) where deleted_at is null;
		alter table players drop constraint if exists players_member_id_fkey;
		alter table players add constraint players_member_id_fkey foreign key (member_id) references members(id) on delete set null;
		create table if not exists player_payment_events (
			id bigserial primary key,
			session_id text not null references sessions(id) on delete cascade,
			player_id integer not null,
			member_id text references members(id) on delete set null,
			paid boolean not null,
			amount_thb integer not null default 0,
			actor_id text not null default '',
			created_at timestamptz not null default now()
		);
		create table if not exists booking_settings (
			admin_id text primary key references admin_users(id) on delete cascade,
			public_token_hash text not null unique,
			public_token text not null default '',
			open_time time not null default '16:00',
			close_time time not null default '22:00',
			interval_minutes integer not null default 60 check (interval_minutes > 0 and interval_minutes % 10 = 0),
			allow_overnight boolean not null default false,
			use_same_price boolean not null default true,
			promptpay_type text not null default 'mobile',
			promptpay_id text not null default '',
			promptpay_receiver_name text not null default '',
			logo_data text not null default '',
			telegram_bot_token text not null default '',
			telegram_bot_fingerprint text not null default '',
			telegram_chat_id text not null default '',
			telegram_webhook_id text not null default '',
			telegram_secret_hash text not null default '',
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		);
		alter table booking_settings add column if not exists public_token text not null default '';
		alter table booking_settings add column if not exists telegram_bot_fingerprint text not null default '';
		create unique index if not exists idx_booking_settings_telegram_bot on booking_settings(telegram_bot_fingerprint) where telegram_bot_fingerprint <> '';
		create table if not exists booking_courts (
			id text primary key,
			admin_id text not null references admin_users(id) on delete cascade,
			name text not null,
			price_per_interval integer not null default 100 check (price_per_interval >= 0),
			sort_order integer not null default 0,
			active boolean not null default true,
			deleted_at timestamptz,
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		);
		create table if not exists bookings (
			id text primary key,
			admin_id text not null references admin_users(id) on delete cascade,
			court_id text not null references booking_courts(id),
			member_id text references members(id) on delete set null,
			booked_by text not null default 'member' check (booked_by in ('member','admin')),
			booker_name text not null default '',
			start_at timestamptz not null,
			end_at timestamptz not null,
			interval_minutes integer not null,
			unit_price_thb integer not null,
			total_price_thb integer not null,
			status text not null check (status in ('hold','pending_review','confirmed','rejected','cancelled','expired')),
			payment_status text not null default 'unpaid' check (payment_status in ('unpaid','pending','paid','rejected')),
			hold_expires_at timestamptz,
			note text not null default '',
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now(),
			check (end_at > start_at)
		);
		alter table bookings add column if not exists booking_batch_id text;
		create index if not exists idx_bookings_batch on bookings(admin_id, booking_batch_id) where booking_batch_id is not null;
		create table if not exists booking_occupancies (
			id bigserial primary key,
			admin_id text not null references admin_users(id) on delete cascade,
			court_id text not null references booking_courts(id),
			booking_id text references bookings(id) on delete cascade,
			kind text not null check (kind in ('booking','closure')),
			occupied_range tstzrange not null,
			active boolean not null default true,
			note text not null default '',
			created_at timestamptz not null default now()
		);
		alter table booking_occupancies drop constraint if exists booking_occupancies_no_overlap;
		alter table booking_occupancies add constraint booking_occupancies_no_overlap exclude using gist (court_id with =, occupied_range with &&) where (active);
		create table if not exists booking_payments (
			id text primary key,
			booking_id text not null references bookings(id) on delete cascade,
			member_id text references members(id) on delete set null,
			amount_thb integer not null,
			slip_data text not null default '',
			status text not null check (status in ('pending','approved','rejected','manual_paid')),
			note text not null default '',
			reviewed_by text not null default '',
			created_at timestamptz not null default now(),
			reviewed_at timestamptz
		);
		create index if not exists idx_members_admin on members(admin_id, active, created_at desc);
		create index if not exists idx_booking_courts_admin on booking_courts(admin_id, active, sort_order);
		create index if not exists idx_bookings_admin_time on bookings(admin_id, start_at, end_at);
		create index if not exists idx_booking_payments_booking on booking_payments(booking_id, created_at desc);
		create index if not exists idx_player_payment_member on player_payment_events(member_id, created_at desc);
		create index if not exists idx_sessions_admin on sessions(admin_id);
		create index if not exists idx_admin_sessions_admin on admin_sessions(admin_id);
		create index if not exists idx_coin_ledger_admin on coin_ledger(admin_id);
		create index if not exists idx_admin_subscriptions_admin_dates on admin_subscriptions(admin_id, start_date, end_date);
		create index if not exists idx_session_billing_admin on session_billing(admin_id, created_at desc);
		create index if not exists idx_coin_purchase_orders_admin on coin_purchase_orders(admin_id);
		create index if not exists idx_coin_purchase_orders_status on coin_purchase_orders(status);
		create unique index if not exists idx_coin_purchase_orders_trans_ref on coin_purchase_orders(trans_ref) where trans_ref <> '';
		create unique index if not exists idx_coin_purchase_orders_subscription on coin_purchase_orders(subscription_id) where subscription_id is not null;
		create unique index if not exists idx_coin_purchase_orders_pending_subscription on coin_purchase_orders(admin_id) where product_type = 'subscription' and status = 'pending';
		create index if not exists idx_activity_logs_created on activity_logs(created_at desc);
		create table if not exists support_issues (
			id text primary key,
			title text not null,
			details text not null,
			contact text not null,
			images jsonb not null default '[]'::jsonb,
			status text not null default 'new' check (status in ('new', 'in_progress', 'resolved')),
			supervisor_reply text not null default '',
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		);
		create index if not exists idx_support_issues_status_created on support_issues(status, created_at desc);
		create table if not exists request_rate_limits (
			rate_key text primary key,
			window_start timestamptz not null,
			reset_at timestamptz not null,
			request_count integer not null check (request_count > 0)
		);
		create index if not exists idx_request_rate_limits_reset on request_rate_limits(reset_at);
	`)
	if err != nil {
		return err
	}
	if err := a.seedBackofficeSuperadmin(ctx); err != nil {
		return err
	}
	if _, err := a.db.ExecContext(ctx, `
		insert into system_settings (key, value)
		values ('liveMatchSessionCoinCost', '49')
		on conflict (key) do nothing
	`); err != nil {
		return err
	}
	if _, err := a.db.ExecContext(ctx, `
		insert into system_settings (key, value)
		values ('liveShareSessionCoinCost', '49')
		on conflict (key) do nothing
	`); err != nil {
		return err
	}
	return a.backfillJSONStates(ctx)
}

func (a *app) seedBackofficeSuperadmin(ctx context.Context) error {
	username := os.Getenv("SUPERADMIN_USERNAME")
	if username == "" {
		username = "superadmin"
	}
	password := os.Getenv("SUPERADMIN_PASSWORD")
	if password == "" {
		password = "12345678"
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = a.db.ExecContext(ctx, `
		insert into backoffice_users (username, name, password_hash, active)
		values ($1, 'Superadmin', $2, true)
		on conflict (username) do nothing
	`, username, string(hash))
	return err
}

func (a *app) backfillJSONStates(ctx context.Context) error {
	rows, err := a.db.QueryContext(ctx, `
		select id, state
		from sessions
		where state is not null
		and not exists (
			select 1 from session_settings where session_settings.session_id = sessions.id
		)
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	var states []SessionState
	for rows.Next() {
		var id string
		var raw []byte
		if err := rows.Scan(&id, &raw); err != nil {
			return err
		}
		var state SessionState
		if err := json.Unmarshal(raw, &state); err != nil {
			continue
		}
		if state.Session.ID == "" {
			state.Session.ID = id
		}
		state.Settings.ResetPlayersAfterFinish = true
		states = append(states, state)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, state := range states {
		if err := a.saveState(ctx, state); err != nil {
			return err
		}
	}
	return nil
}

func (a *app) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, HealthResponse{
		Status:    "ok",
		Service:   "livematch-backend",
		Timestamp: time.Now().UTC(),
	})
}

func (a *app) handleSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	writeJSON(w, http.StatusGone, map[string]string{"error": "use admin session creation"})
	return

	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		body.Name = "แบดวันนี้"
	}

	id := "session-" + randHex(6)
	passcode := "LM-" + time.Now().Format("150405")
	state := defaultState(id, body.Name, passcode)
	if err := a.saveState(r.Context(), state); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusCreated, SessionRecord{ID: id, Name: body.Name, AdminPasscode: passcode, State: state})
}

func (a *app) handleUnlockByPasscode(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	writeJSON(w, http.StatusGone, map[string]string{"error": "passcode login removed"})
	return

	var body struct {
		Passcode string `json:"passcode"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	passcode := strings.TrimSpace(body.Passcode)
	if passcode == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "passcode required"})
		return
	}

	var id string
	err := a.db.QueryRowContext(r.Context(), `
		select id
		from sessions
		where admin_passcode = $1
		order by updated_at desc
		limit 1
	`, passcode).Scan(&id)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, sql.ErrNoRows) {
			status = http.StatusUnauthorized
		}
		writeJSON(w, status, map[string]string{"error": "invalid passcode"})
		return
	}

	state, err := a.loadState(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	state.Session.Unlocked = true
	writeJSON(w, http.StatusOK, state)
}

func (a *app) handleSupervisorSummary(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, http.StatusGone, map[string]string{"error": "supervisor removed; use backoffice"})
	return
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Username != "superadmin" || body.Password != "12345678" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid supervisor login"})
		return
	}

	type supervisorWinner struct {
		SessionID   string `json:"sessionId"`
		SessionName string `json:"sessionName"`
		ID          int    `json:"id"`
		Name        string `json:"name"`
		Wins        int    `json:"wins"`
		Draws       int    `json:"draws"`
		Losses      int    `json:"losses"`
	}
	type supervisorSession struct {
		ID             string `json:"id"`
		Name           string `json:"name"`
		Players        int    `json:"players"`
		PaidPlayers    int    `json:"paidPlayers"`
		UnpaidPlayers  int    `json:"unpaidPlayers"`
		Matches        int    `json:"matches"`
		QueueMatches   int    `json:"queueMatches"`
		LiveMatches    int    `json:"liveMatches"`
		HistoryMatches int    `json:"historyMatches"`
		Shuttles       int    `json:"shuttles"`
		Revenue        int    `json:"revenue"`
		UpdatedAt      string `json:"updatedAt"`
	}
	summary := struct {
		TotalSessions  int                 `json:"totalSessions"`
		TotalPlayers   int                 `json:"totalPlayers"`
		TotalMatches   int                 `json:"totalMatches"`
		QueueMatches   int                 `json:"queueMatches"`
		LiveMatches    int                 `json:"liveMatches"`
		HistoryMatches int                 `json:"historyMatches"`
		TotalShuttles  int                 `json:"totalShuttles"`
		TotalWins      int                 `json:"totalWins"`
		AverageGames   float64             `json:"averageGames"`
		TotalRevenue   int                 `json:"totalRevenue"`
		PaidRevenue    int                 `json:"paidRevenue"`
		UnpaidRevenue  int                 `json:"unpaidRevenue"`
		TopWinners     []supervisorWinner  `json:"topWinners"`
		Sessions       []supervisorSession `json:"sessions"`
	}{TopWinners: []supervisorWinner{}, Sessions: []supervisorSession{}}

	_ = a.db.QueryRowContext(r.Context(), `select count(*) from sessions`).Scan(&summary.TotalSessions)
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from players where active`).Scan(&summary.TotalPlayers)
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from matches where phase in ('live', 'history') and status <> 'cancelled'`).Scan(&summary.TotalMatches)
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from matches where phase = 'queue'`).Scan(&summary.QueueMatches)
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from matches where phase = 'live'`).Scan(&summary.LiveMatches)
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from matches where phase = 'history' and status <> 'cancelled'`).Scan(&summary.HistoryMatches)
	_ = a.db.QueryRowContext(r.Context(), `select coalesce(sum(shuttles), 0) from matches where status <> 'cancelled' or not shuttle_returned`).Scan(&summary.TotalShuttles)
	_ = a.db.QueryRowContext(r.Context(), `select coalesce(sum(wins), 0) from players where active`).Scan(&summary.TotalWins)
	_ = a.db.QueryRowContext(r.Context(), `select coalesce(avg(games), 0) from players where active`).Scan(&summary.AverageGames)
	_ = a.db.QueryRowContext(r.Context(), `
		select coalesce(sum(ss.entry_fee + p.shuttles * ss.shuttle_fee + ceiling(ss.session_fee::numeric / nullif((select count(*) from players ap where ap.session_id = p.session_id and ap.active), 0))::int), 0)
		from players p
		join session_settings ss on ss.session_id = p.session_id
		where p.active
	`).Scan(&summary.TotalRevenue)
	_ = a.db.QueryRowContext(r.Context(), `
		select coalesce(sum(ss.entry_fee + p.shuttles * ss.shuttle_fee + ceiling(ss.session_fee::numeric / nullif((select count(*) from players ap where ap.session_id = p.session_id and ap.active), 0))::int), 0)
		from players p
		join session_settings ss on ss.session_id = p.session_id
		where p.active and p.paid
	`).Scan(&summary.PaidRevenue)
	summary.UnpaidRevenue = summary.TotalRevenue - summary.PaidRevenue

	rows, err := a.db.QueryContext(r.Context(), `
		select p.session_id, coalesce(s.name, p.session_id), p.id, p.name, p.wins, p.draws, p.losses
		from players p
		join sessions s on s.id = p.session_id
		where p.active
		order by (p.wins + p.draws * 0.5) desc, p.wins desc, p.losses asc, p.games desc, p.id asc
		limit 5
	`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var item supervisorWinner
		if err := rows.Scan(&item.SessionID, &item.SessionName, &item.ID, &item.Name, &item.Wins, &item.Draws, &item.Losses); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		summary.TopWinners = append(summary.TopWinners, item)
	}

	rows, err = a.db.QueryContext(r.Context(), `
		select s.id, coalesce(s.name, s.id),
			(select count(*) from players p where p.session_id = s.id and p.active) as players,
			(select count(*) from players p where p.session_id = s.id and p.active and p.paid) as paid_players,
			(select count(*) from players p where p.session_id = s.id and p.active and not p.paid) as unpaid_players,
			(select count(*) from matches m where m.session_id = s.id and m.phase in ('live', 'history') and m.status <> 'cancelled') as matches,
			(select count(*) from matches m where m.session_id = s.id and m.phase = 'queue') as queue_matches,
			(select count(*) from matches m where m.session_id = s.id and m.phase = 'live') as live_matches,
			(select count(*) from matches m where m.session_id = s.id and m.phase = 'history' and m.status <> 'cancelled') as history_matches,
			(select coalesce(sum(m.shuttles), 0) from matches m where m.session_id = s.id and (m.status <> 'cancelled' or not m.shuttle_returned)) as shuttles,
			(
				select coalesce(sum(ss.entry_fee + p.shuttles * ss.shuttle_fee + ceiling(ss.session_fee::numeric / nullif((select count(*) from players ap where ap.session_id = p.session_id and ap.active), 0))::int), 0)
				from players p
				join session_settings ss on ss.session_id = p.session_id
				where p.session_id = s.id and p.active
			) as revenue,
			to_char(s.updated_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') as updated_at
		from sessions s
		order by s.updated_at desc
		limit 12
	`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var item supervisorSession
		if err := rows.Scan(&item.ID, &item.Name, &item.Players, &item.PaidPlayers, &item.UnpaidPlayers, &item.Matches, &item.QueueMatches, &item.LiveMatches, &item.HistoryMatches, &item.Shuttles, &item.Revenue, &item.UpdatedAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		summary.Sessions = append(summary.Sessions, item)
	}

	writeJSON(w, http.StatusOK, summary)
}

func (a *app) handleSupervisorSessionDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, http.StatusGone, map[string]string{"error": "supervisor removed; use backoffice"})
	return
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	var body struct {
		Username  string `json:"username"`
		Password  string `json:"password"`
		SessionID string `json:"sessionId"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Username != "superadmin" || body.Password != "12345678" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid supervisor login"})
		return
	}
	if strings.TrimSpace(body.SessionID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "session id required"})
		return
	}

	type paymentPlayer struct {
		ID       int    `json:"id"`
		Name     string `json:"name"`
		Games    int    `json:"games"`
		Wins     int    `json:"wins"`
		Draws    int    `json:"draws"`
		Losses   int    `json:"losses"`
		Shuttles int    `json:"shuttles"`
		Paid     bool   `json:"paid"`
		Active   bool   `json:"active"`
		Cost     int    `json:"cost"`
	}
	type historyMatch struct {
		ID         int    `json:"id"`
		Court      string `json:"court"`
		Level      string `json:"level"`
		A1         int    `json:"a1"`
		A2         int    `json:"a2"`
		B1         int    `json:"b1"`
		B2         int    `json:"b2"`
		A1Name     string `json:"a1Name"`
		A2Name     string `json:"a2Name"`
		B1Name     string `json:"b1Name"`
		B2Name     string `json:"b2Name"`
		Shuttles   int    `json:"shuttles"`
		Winner     string `json:"winner"`
		StartedAt  string `json:"startedAt"`
		EndedAt    string `json:"endedAt"`
		Note       string `json:"note"`
		ShuttleSeq string `json:"shuttleSequence"`
		Returned   bool   `json:"shuttleReturned"`
	}
	detail := struct {
		SessionID     string          `json:"sessionId"`
		SessionName   string          `json:"sessionName"`
		EntryFee      int             `json:"entryFee"`
		ShuttleFee    int             `json:"shuttleFee"`
		SessionFee    int             `json:"sessionFee"`
		Players       []paymentPlayer `json:"players"`
		History       []historyMatch  `json:"history"`
		TotalRevenue  int             `json:"totalRevenue"`
		PaidRevenue   int             `json:"paidRevenue"`
		UnpaidRevenue int             `json:"unpaidRevenue"`
	}{Players: []paymentPlayer{}, History: []historyMatch{}}

	if err := a.db.QueryRowContext(r.Context(), `
		select s.id, coalesce(s.name, s.id), ss.entry_fee, ss.shuttle_fee, ss.session_fee
		from sessions s
		join session_settings ss on ss.session_id = s.id
		where s.id = $1
	`, body.SessionID).Scan(&detail.SessionID, &detail.SessionName, &detail.EntryFee, &detail.ShuttleFee, &detail.SessionFee); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, sql.ErrNoRows) {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}

	rows, err := a.db.QueryContext(r.Context(), `
		select id, name, games, wins, draws, losses, shuttles, paid, active,
			$2 + shuttles * $3 + ceiling($4::numeric / nullif((select count(*) from players ap where ap.session_id = $1 and ap.active), 0))::int as cost
		from players
		where session_id = $1
		order by active desc, paid asc, id asc
	`, detail.SessionID, detail.EntryFee, detail.ShuttleFee, detail.SessionFee)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var player paymentPlayer
		if err := rows.Scan(&player.ID, &player.Name, &player.Games, &player.Wins, &player.Draws, &player.Losses, &player.Shuttles, &player.Paid, &player.Active, &player.Cost); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		detail.Players = append(detail.Players, player)
		detail.TotalRevenue += player.Cost
		if player.Paid {
			detail.PaidRevenue += player.Cost
		}
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	detail.UnpaidRevenue = detail.TotalRevenue - detail.PaidRevenue

	rows, err = a.db.QueryContext(r.Context(), `
		select m.id, m.court, m.level, m.a1, m.a2, m.b1, m.b2,
			coalesce(a1.name, '-'), coalesce(a2.name, '-'), coalesce(b1.name, '-'), coalesce(b2.name, '-'),
			m.shuttles, m.winner, m.started_at, m.ended_at, m.note, m.shuttle_sequence, m.shuttle_returned
		from matches m
		left join players a1 on a1.session_id = m.session_id and a1.id = m.a1
		left join players a2 on a2.session_id = m.session_id and a2.id = m.a2
		left join players b1 on b1.session_id = m.session_id and b1.id = m.b1
		left join players b2 on b2.session_id = m.session_id and b2.id = m.b2
		where m.session_id = $1 and m.phase = 'history'
		order by m.id asc
	`, detail.SessionID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var match historyMatch
		if err := rows.Scan(&match.ID, &match.Court, &match.Level, &match.A1, &match.A2, &match.B1, &match.B2, &match.A1Name, &match.A2Name, &match.B1Name, &match.B2Name, &match.Shuttles, &match.Winner, &match.StartedAt, &match.EndedAt, &match.Note, &match.ShuttleSeq, &match.Returned); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		detail.History = append(detail.History, match)
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, detail)
}

func (a *app) handleSessionRoutes(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/sessions/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	id := parts[0]

	state, err := a.loadState(r.Context(), id)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, sql.ErrNoRows) {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}

	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}
	if action != "state" {
		user, ok := a.currentAdmin(r.Context(), r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not logged in"})
			return
		}
		owned, err := a.sessionOwnedBy(r.Context(), id, user.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if !owned {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "session owner required"})
			return
		}
		if r.Method == http.MethodGet && action == "dashboard" && r.URL.Query().Get("open") == "1" {
			a.insertActivityLog(r.Context(), "admin", user.ID, "open_session", "session", id, map[string]any{"name": state.Session.Name, "expired": state.Session.Expired, "readOnly": state.Session.ReadOnly, "readOnlyReason": state.Session.ReadOnlyReason})
		}
		if isSessionWrite(r.Method) && action != "unlock" && state.Session.ReadOnly {
			a.insertActivityLog(r.Context(), "admin", user.ID, "blocked_readonly_session_action", "session", id, map[string]any{"name": state.Session.Name, "method": r.Method, "action": action, "path": r.URL.Path, "reason": state.Session.ReadOnlyReason})
			writeJSON(w, http.StatusConflict, map[string]string{"error": readOnlySessionMessage(state)})
			return
		}
	}

	switch {
	case r.Method == http.MethodPost && action == "announcement-audio":
		a.handleAnnouncementAudio(w, r)
	case r.Method == http.MethodPost && action == "unlock":
		writeJSON(w, http.StatusGone, map[string]string{"error": "passcode login removed"})
	case r.Method == http.MethodGet && action == "state":
		writeJSON(w, http.StatusOK, state)
	case r.Method == http.MethodGet && action == "dashboard":
		writeJSON(w, http.StatusOK, dashboardPayload(state))
	case r.Method == http.MethodGet && action == "players":
		items := state.Players
		search := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("search")))
		if search != "" {
			items = slices.DeleteFunc(slices.Clone(items), func(player Player) bool {
				return !strings.Contains(strings.ToLower(player.Name), search) && !strings.Contains(strconv.Itoa(player.ID), search)
			})
		}
		if r.URL.Query().Get("all") == "1" || r.URL.Query().Get("all") == "true" {
			writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items), "page": 1, "pageSize": len(items)})
			return
		}
		paged, page, pageSize := paginate(items, r)
		writeJSON(w, http.StatusOK, map[string]any{"items": paged, "total": len(items), "page": page, "pageSize": pageSize})
	case r.Method == http.MethodPost && action == "players":
		var body struct {
			Name       string `json:"name"`
			Level      string `json:"level"`
			Coupon     *bool  `json:"coupon"`
			ClubMember bool   `json:"clubMember"`
			MemberID   string `json:"memberId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Name) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid player"})
			return
		}
		if body.Level == "" {
			body.Level = firstLevel(state)
		}
		coupon := false
		if body.Coupon != nil {
			coupon = *body.Coupon
		}
		if body.MemberID != "" {
			var memberName, memberType string
			user, _ := a.currentAdmin(r.Context(), r)
			if err := a.db.QueryRowContext(r.Context(), `select name, member_type from members where id=$1 and admin_id=$2 and active and deleted_at is null`, body.MemberID, user.ID).Scan(&memberName, &memberType); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "member not found"})
				return
			}
			body.Name = memberName
			body.ClubMember = memberType == "club"
		}
		state.NextIDs.Player++
		player := Player{ID: state.NextIDs.Player, Name: body.Name, Active: true, Level: body.Level, Coupon: coupon, ClubMember: body.ClubMember, MemberID: body.MemberID}
		state.Players = append(state.Players, player)
		a.respondSavedWithActivity(w, r, state, "add_player", "player", strconv.Itoa(player.ID), map[string]any{"name": player.Name, "level": player.Level, "coupon": player.Coupon, "clubMember": player.ClubMember})
	case r.Method == http.MethodPatch && action == "players" && len(parts) >= 3:
		playerID, _ := strconv.Atoi(parts[2])
		var body struct {
			Name       *string `json:"name"`
			Paid       *bool   `json:"paid"`
			Level      *string `json:"level"`
			Coupon     *bool   `json:"coupon"`
			Active     *bool   `json:"active"`
			ClubMember *bool   `json:"clubMember"`
			MemberID   *string `json:"memberId"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		logDetails := map[string]any{}
		actionName := "update_player"
		for i := range state.Players {
			if state.Players[i].ID == playerID {
				if body.Name != nil {
					name := strings.TrimSpace(*body.Name)
					if name == "" {
						writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid player name"})
						return
					}
					logDetails["fromName"] = state.Players[i].Name
					logDetails["toName"] = name
					actionName = "rename_player"
					state.Players[i].Name = name
				}
				if body.Paid != nil {
					logDetails["paid"] = *body.Paid
					actionName = "toggle_player_paid"
					state.Players[i].Paid = *body.Paid
					if *body.Paid {
						state.Players[i].Coupon = false
						state.Couples = slices.DeleteFunc(state.Couples, func(c Couple) bool {
							return c.A == playerID || c.B == playerID
						})
					}
				}
				if body.Level != nil {
					logDetails["level"] = *body.Level
					state.Players[i].Level = *body.Level
				}
				if body.Coupon != nil {
					logDetails["coupon"] = *body.Coupon
					state.Players[i].Coupon = *body.Coupon
				}
				if body.Active != nil {
					logDetails["active"] = *body.Active
					state.Players[i].Active = *body.Active
				}
				if body.ClubMember != nil {
					logDetails["clubMember"] = *body.ClubMember
					state.Players[i].ClubMember = *body.ClubMember
				}
				if body.MemberID != nil {
					memberID := strings.TrimSpace(*body.MemberID)
					if memberID != "" {
						user, _ := a.currentAdmin(r.Context(), r)
						var memberName, memberType string
						if err := a.db.QueryRowContext(r.Context(), `select name,member_type from members where id=$1 and admin_id=$2 and active and deleted_at is null`, memberID, user.ID).Scan(&memberName, &memberType); err != nil {
							writeJSON(w, http.StatusBadRequest, map[string]string{"error": "member not found"})
							return
						}
						state.Players[i].Name = memberName
						state.Players[i].ClubMember = memberType == "club"
					}
					state.Players[i].MemberID = memberID
					logDetails["memberId"] = memberID
				}
				if body.Level != nil || body.Coupon != nil {
					syncCoupledPlayerStatus(&state, state.Players[i].ID)
				}
			}
		}
		a.respondSavedWithActivity(w, r, state, actionName, "player", strconv.Itoa(playerID), logDetails)
	case r.Method == http.MethodDelete && action == "players" && len(parts) >= 3:
		playerID, _ := strconv.Atoi(parts[2])
		if err := deletePlayer(&state, playerID); err != nil {
			status := http.StatusConflict
			if errors.Is(err, errPlayerNotFound) {
				status = http.StatusNotFound
			}
			writeJSON(w, status, map[string]string{"error": err.Error()})
			return
		}
		a.respondSavedWithActivity(w, r, state, "delete_player", "player", strconv.Itoa(playerID), map[string]any{})
	case r.Method == http.MethodGet && action == "settings":
		writeJSON(w, http.StatusOK, map[string]any{"settings": state.Settings})
	case r.Method == http.MethodGet && action == "live-share-hours":
		writeJSON(w, http.StatusOK, map[string]any{"liveShare": state.LiveShare})
	case r.Method == http.MethodGet && action == "queue":
		writeJSON(w, http.StatusOK, queuePayload(state))
	case r.Method == http.MethodGet && action == "live":
		writeJSON(w, http.StatusOK, map[string]any{"live": state.Live, "players": state.Players})
	case r.Method == http.MethodGet && action == "history":
		writeJSON(w, http.StatusOK, map[string]any{"history": state.History, "players": state.Players})
	case r.Method == http.MethodPut && action == "settings":
		var body struct {
			Settings
			SessionName *string `json:"sessionName"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid settings"})
			return
		}
		settings := body.Settings
		normalizeSettings(&settings)
		if isLiveShare(state) {
			settings.StartMatchWithShuttle = false
		}
		if body.SessionName != nil {
			name := strings.TrimSpace(*body.SessionName)
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid session name"})
				return
			}
			state.Session.Name = name
		}
		state.Settings = settings
		a.respondSavedWithActivity(w, r, state, "update_session_settings", "session", state.Session.ID, map[string]any{"name": state.Session.Name, "entryFee": settings.EntryFee, "shuttleFee": settings.ShuttleFee, "courtCount": settings.CourtCount, "allowCrossLevel": settings.AllowCrossLevel})
	case r.Method == http.MethodPut && action == "live-share-hours":
		if !isLiveShare(state) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "liveShare only"})
			return
		}
		var body LiveShareHours
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid liveShare hours"})
			return
		}
		state.LiveShare = sanitizeLiveShareHours(body, state)
		a.respondSavedWithActivity(w, r, state, "update_live_share_hours", "session", state.Session.ID, map[string]any{"courtHours": liveShareCourtHours(state), "playerHours": liveSharePlayerHours(state)})
	case r.Method == http.MethodPost && action == "couples":
		var body struct {
			A int `json:"a"`
			B int `json:"b"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		playerA, playerB := playerByID(state.Players, body.A), playerByID(state.Players, body.B)
		if body.A == 0 || body.B == 0 || body.A == body.B || playerA == nil || playerB == nil || playerA.Paid || playerB.Paid {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid couple"})
			return
		}
		state.Couples = removeCouplesForPlayers(state.Couples, body.A, body.B)
		state.NextIDs.Couple++
		state.Couples = append(state.Couples, Couple{ID: state.NextIDs.Couple, A: body.A, B: body.B})
		syncNewCouple(&state, body.A, body.B)
		a.respondSavedWithActivity(w, r, state, "add_couple", "couple", strconv.Itoa(state.NextIDs.Couple), map[string]any{"a": body.A, "b": body.B})
	case r.Method == http.MethodGet && action == "couples":
		if r.URL.Query().Get("all") == "1" || r.URL.Query().Get("all") == "true" {
			writeJSON(w, http.StatusOK, map[string]any{"items": state.Couples, "total": len(state.Couples), "page": 1, "pageSize": len(state.Couples)})
			return
		}
		paged, page, pageSize := paginate(state.Couples, r)
		writeJSON(w, http.StatusOK, map[string]any{"items": paged, "total": len(state.Couples), "page": page, "pageSize": pageSize})
	case r.Method == http.MethodDelete && action == "couples" && len(parts) >= 3:
		coupleID, _ := strconv.Atoi(parts[2])
		state.Couples = slices.DeleteFunc(state.Couples, func(c Couple) bool { return c.ID == coupleID })
		a.respondSavedWithActivity(w, r, state, "delete_couple", "couple", strconv.Itoa(coupleID), map[string]any{})
	case r.Method == http.MethodPost && action == "random":
		if err := randomMatch(&state); err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}
		a.respondSavedWithActivity(w, r, state, "random_matches", "session", state.Session.ID, map[string]any{"pending": len(state.Pending)})
	case r.Method == http.MethodPost && action == "pending" && len(parts) == 2:
		var body Match
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ข้อมูลทีมไม่ถูกต้อง"})
			return
		}
		created, err := createManualPendingMatch(&state, body)
		if err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}
		a.respondSavedWithActivity(w, r, state, "create_manual_match", "match", strconv.Itoa(created.ID), map[string]any{
			"a1": created.A1, "a2": created.A2, "b1": created.B1, "b2": created.B2, "level": created.Level,
		})
	case r.Method == http.MethodPost && action == "pending" && len(parts) >= 4 && parts[3] == "confirm":
		matchID, _ := strconv.Atoi(parts[2])
		if !confirmPendingMatch(&state, matchID) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match not found"})
			return
		}
		a.respondSavedWithActivity(w, r, state, "confirm_pending_match", "match", strconv.Itoa(matchID), map[string]any{})
	case r.Method == http.MethodDelete && action == "pending" && len(parts) >= 3:
		matchID, _ := strconv.Atoi(parts[2])
		if !cancelPendingMatch(&state, matchID) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match not found"})
			return
		}
		a.respondSavedWithActivity(w, r, state, "cancel_pending_match", "match", strconv.Itoa(matchID), map[string]any{})
	case r.Method == http.MethodGet && action == "coupons":
		busy := map[int]bool{}
		for _, match := range append(append(append([]Match{}, state.Pending...), state.Queue...), state.Live...) {
			for _, id := range matchPlayers(match) {
				busy[id] = true
			}
		}
		groups := buildAvailableGroups(state, busy)
		items := []map[string]any{}
		for _, group := range groups {
			names := []string{}
			for _, id := range group.ids {
				for _, player := range state.Players {
					if player.ID == id {
						names = append(names, player.Name)
					}
				}
			}
			items = append(items, map[string]any{
				"ids":   group.ids,
				"name":  strings.Join(names, " + "),
				"level": group.level,
				"games": group.games,
			})
		}
		search := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("search")))
		if search != "" {
			items = slices.DeleteFunc(slices.Clone(items), func(item map[string]any) bool {
				return !strings.Contains(strings.ToLower(fmt.Sprint(item["name"])), search) && !strings.Contains(fmt.Sprint(item["ids"]), search)
			})
		}
		if r.URL.Query().Get("all") == "1" || r.URL.Query().Get("all") == "true" {
			writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items), "page": 1, "pageSize": len(items)})
			return
		}
		paged, page, pageSize := paginate(items, r)
		writeJSON(w, http.StatusOK, map[string]any{"items": paged, "total": len(items), "page": page, "pageSize": pageSize})
	case r.Method == http.MethodPost && action == "queue" && len(parts) >= 4 && parts[3] == "start":
		matchID, _ := strconv.Atoi(parts[2])
		var body struct {
			Court   string `json:"court"`
			BrandID string `json:"brandId"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Court == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "court is required"})
			return
		}
		brandID := selectableShuttleBrandID(state, body.BrandID)
		if brandID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "shuttle brand is required"})
			return
		}
		if !startMatch(&state, matchID, body.Court, brandID) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match not found"})
			return
		}
		a.respondSavedWithActivity(w, r, state, "start_match", "match", strconv.Itoa(matchID), map[string]any{"court": body.Court, "brandId": brandID})
	case r.Method == http.MethodDelete && action == "queue" && len(parts) >= 3:
		matchID, _ := strconv.Atoi(parts[2])
		if !cancelQueuedMatch(&state, matchID) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match not found"})
			return
		}
		a.respondSavedWithActivity(w, r, state, "cancel_queued_match", "match", strconv.Itoa(matchID), map[string]any{})
	case r.Method == http.MethodPatch && action == "live" && len(parts) >= 4 && parts[3] == "shuttles":
		matchID, _ := strconv.Atoi(parts[2])
		var body struct {
			Delta   int    `json:"delta"`
			BrandID string `json:"brandId"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		brandID := selectableShuttleBrandID(state, body.BrandID)
		adjustShuttles(&state, matchID, body.Delta, brandID)
		a.respondSavedWithActivity(w, r, state, "adjust_match_shuttles", "match", strconv.Itoa(matchID), map[string]any{"delta": body.Delta, "brandId": brandID})
	case r.Method == http.MethodPost && action == "live" && len(parts) >= 5 && parts[3] == "shuttles" && parts[4] == "return":
		matchID, _ := strconv.Atoi(parts[2])
		number, ok := returnLatestShuttle(&state, matchID)
		if !ok {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "match must have more than one shuttle"})
			return
		}
		a.respondSavedWithActivity(w, r, state, "return_match_shuttle", "match", strconv.Itoa(matchID), map[string]any{"shuttleNumber": number})
	case r.Method == http.MethodPost && action == "live" && len(parts) >= 4 && (parts[3] == "finish" || parts[3] == "cancel"):
		matchID, _ := strconv.Atoi(parts[2])
		var body struct {
			Note            string `json:"note"`
			Winner          string `json:"winner"`
			ShuttleReturned bool   `json:"shuttleReturned"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if !closeLive(&state, matchID, parts[3] == "cancel", body.Note, body.Winner, body.ShuttleReturned) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match not found"})
			return
		}
		actionName := "finish_match"
		if parts[3] == "cancel" {
			actionName = "cancel_live_match"
		}
		a.respondSavedWithActivity(w, r, state, actionName, "match", strconv.Itoa(matchID), map[string]any{"winner": body.Winner, "note": body.Note, "shuttleReturned": body.ShuttleReturned})
	case r.Method == http.MethodPatch && action == "history" && len(parts) >= 3:
		matchID, _ := strconv.Atoi(parts[2])
		var body struct {
			Winner string `json:"winner"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if !updateHistoryWinner(&state, matchID, body.Winner) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match not found"})
			return
		}
		a.respondSavedWithActivity(w, r, state, "update_history_winner", "match", strconv.Itoa(matchID), map[string]any{"winner": body.Winner})
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	}
}

func (a *app) respondSaved(w http.ResponseWriter, r *http.Request, state SessionState) {
	if err := a.saveState(r.Context(), state); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (a *app) respondSavedWithActivity(w http.ResponseWriter, r *http.Request, state SessionState, action, targetType, targetID string, details map[string]any) {
	if err := a.saveState(r.Context(), state); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if user, ok := a.currentAdmin(r.Context(), r); ok {
		if details == nil {
			details = map[string]any{}
		}
		details["sessionId"] = state.Session.ID
		details["sessionName"] = state.Session.Name
		a.insertActivityLog(r.Context(), "admin", user.ID, action, targetType, targetID, details)
		if action == "toggle_player_paid" {
			playerID, _ := strconv.Atoi(targetID)
			for _, player := range state.Players {
				if player.ID != playerID || player.MemberID == "" {
					continue
				}
				amount := playerEntryFee(state, player) + playerShuttleCost(state, player.ID) + sessionFeeShare(state)
				if isLiveShare(state) {
					amount = liveSharePlayerCost(state, player)
				}
				_, _ = a.db.ExecContext(r.Context(), `insert into player_payment_events (session_id,player_id,member_id,paid,amount_thb,actor_id) values ($1,$2,$3,$4,$5,$6)`, state.Session.ID, player.ID, player.MemberID, player.Paid, amount, user.ID)
				break
			}
		}
	}
	writeJSON(w, http.StatusOK, state)
}

func (a *app) saveState(ctx context.Context, state SessionState) error {
	normalizeLiveShareState(&state)
	state.UpdatedAt = time.Now().UTC()
	courtNames, err := json.Marshal(state.Settings.CourtNames)
	if err != nil {
		return err
	}
	levels, err := json.Marshal(state.Settings.Levels)
	if err != nil {
		return err
	}
	shuttleBrands, err := json.Marshal(state.Settings.ShuttleBrands)
	if err != nil {
		return err
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.ExecContext(ctx, `
		insert into sessions (id, name, session_type, admin_passcode, updated_at)
		values ($1, $2, $3, $4, now())
		on conflict (id) do update set
			name = excluded.name,
			session_type = excluded.session_type,
			admin_passcode = excluded.admin_passcode,
			updated_at = now()
	`, state.Session.ID, state.Session.Name, sessionType(state), state.Session.AdminPasscode); err != nil {
		return err
	}

	if _, err = tx.ExecContext(ctx, `
		insert into session_settings (
			session_id, entry_fee, club_entry_fee, court_fee_per_hour, shuttle_fee, shuttle_brands, session_fee, court_count, court_names, levels, allow_cross_level, cross_level_range, random_priority, show_payment_on_share, show_total_on_share, reset_players_after_finish, start_match_with_shuttle, announcement_template
		)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
		on conflict (session_id) do update set
			entry_fee = excluded.entry_fee,
			club_entry_fee = excluded.club_entry_fee,
			court_fee_per_hour = excluded.court_fee_per_hour,
			shuttle_fee = excluded.shuttle_fee,
			shuttle_brands = excluded.shuttle_brands,
			session_fee = excluded.session_fee,
			court_count = excluded.court_count,
			court_names = excluded.court_names,
			levels = excluded.levels,
			allow_cross_level = excluded.allow_cross_level,
			cross_level_range = excluded.cross_level_range,
			random_priority = excluded.random_priority,
			show_payment_on_share = excluded.show_payment_on_share,
			show_total_on_share = excluded.show_total_on_share,
			reset_players_after_finish = excluded.reset_players_after_finish,
			start_match_with_shuttle = excluded.start_match_with_shuttle,
			announcement_template = excluded.announcement_template
	`, state.Session.ID, state.Settings.EntryFee, state.Settings.ClubEntryFee, state.Settings.CourtFeePerHour, state.Settings.ShuttleFee, shuttleBrands, state.Settings.SessionFee, state.Settings.CourtCount, courtNames, levels, state.Settings.AllowCrossLevel, state.Settings.CrossLevelRange, state.Settings.RandomPriority, state.Settings.ShowPaymentOnShare, state.Settings.ShowTotalOnShare, state.Settings.ResetPlayersAfterFinish, state.Settings.StartMatchWithShuttle, state.Settings.AnnouncementTemplate); err != nil {
		return err
	}

	for _, table := range []string{"players", "couples", "matches", "live_share_hours", "returned_shuttles"} {
		if _, err = tx.ExecContext(ctx, "delete from "+table+" where session_id = $1", state.Session.ID); err != nil {
			return err
		}
	}

	for _, player := range state.Players {
		if _, err = tx.ExecContext(ctx, `
			insert into players (session_id, id, name, games, wins, draws, losses, shuttles, paid, active, level, coupon, club_member, member_id)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, nullif($14, ''))
		`, state.Session.ID, player.ID, player.Name, player.Games, player.Wins, player.Draws, player.Losses, player.Shuttles, player.Paid, player.Active, player.Level, player.Coupon, player.ClubMember, player.MemberID); err != nil {
			return err
		}
	}

	for _, couple := range state.Couples {
		if _, err = tx.ExecContext(ctx, `
			insert into couples (session_id, id, player_a, player_b)
			values ($1, $2, $3, $4)
		`, state.Session.ID, couple.ID, couple.A, couple.B); err != nil {
			return err
		}
	}
	for _, number := range state.ReturnedShuttles {
		if _, err = tx.ExecContext(ctx, `
			insert into returned_shuttles (session_id, brand_id, shuttle_number)
			values ($1, $2, $3)
		`, state.Session.ID, normalizedBrandID(number.BrandID), number.Number); err != nil {
			return err
		}
	}

	insertMatch := func(phase string, match Match) error {
		seqItems, err := json.Marshal(normalizedShuttleSeqItems(match, state))
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `
			insert into matches (
				session_id, id, phase, court, level, a1, a2, b1, b2, shuttles, winner, shuttle_sequence, shuttle_sequence_items, shuttle_returned, returned_shuttle_brand_id, returned_shuttle_number, status, started_at, ended_at, note
			)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
		`, state.Session.ID, match.ID, phase, match.Court, match.Level, match.A1, match.A2, match.B1, match.B2, match.Shuttles, match.Winner, match.ShuttleSeq, seqItems, match.ShuttleReturned, match.ReturnedShuttleBrandID, match.ReturnedShuttleNumber, match.Status, match.StartedAt, match.EndedAt, match.Note)
		return err
	}
	for _, match := range state.Pending {
		if err = insertMatch("pending", match); err != nil {
			return err
		}
	}
	for _, match := range state.Queue {
		if err = insertMatch("queue", match); err != nil {
			return err
		}
	}
	for _, match := range state.Live {
		if err = insertMatch("live", match); err != nil {
			return err
		}
	}
	for _, match := range state.History {
		if err = insertMatch("history", match); err != nil {
			return err
		}
	}
	for target, hours := range state.LiveShare.CourtHours {
		for _, hour := range normalizedHourSet(hours) {
			if _, err = tx.ExecContext(ctx, `
				insert into live_share_hours (session_id, kind, target, hour, quantity)
				values ($1, 'court', $2, $3, 1)
			`, state.Session.ID, target, hour); err != nil {
				return err
			}
		}
	}
	for target, hours := range state.LiveShare.PlayerHours {
		for _, hour := range normalizedHourSet(hours) {
			if _, err = tx.ExecContext(ctx, `
				insert into live_share_hours (session_id, kind, target, hour, quantity)
				values ($1, 'player', $2, $3, 1)
			`, state.Session.ID, target, hour); err != nil {
				return err
			}
		}
	}
	for hour, quantity := range state.LiveShare.ShuttleHours {
		if quantity <= 0 {
			continue
		}
		if _, err = tx.ExecContext(ctx, `
			insert into live_share_hours (session_id, kind, target, hour, quantity)
			values ($1, 'shuttle', 'shuttle', $2, $3)
		`, state.Session.ID, hour, quantity); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (a *app) loadState(ctx context.Context, id string) (SessionState, error) {
	var name, sessionTypeValue, passcode string
	var createdAt, updatedAt time.Time
	if err := a.db.QueryRowContext(ctx, `
		select name, coalesce(session_type, 'liveMatch'), admin_passcode, created_at, updated_at from sessions where id = $1
	`, id).Scan(&name, &sessionTypeValue, &passcode, &createdAt, &updatedAt); err != nil {
		return SessionState{}, err
	}

	state := defaultState(id, name, passcode)
	state.Session.Type = normalizeSessionType(sessionTypeValue)
	state.Session.Unlocked = true
	state.UpdatedAt = updatedAt
	applySessionValidity(&state, createdAt)

	var courtNamesRaw, levelsRaw, shuttleBrandsRaw []byte
	err := a.db.QueryRowContext(ctx, `
		select entry_fee, club_entry_fee, court_fee_per_hour, shuttle_fee, shuttle_brands, session_fee, court_count, court_names, levels, allow_cross_level, cross_level_range, random_priority, show_payment_on_share, show_total_on_share, reset_players_after_finish, start_match_with_shuttle, announcement_template
		from session_settings
		where session_id = $1
	`, id).Scan(
		&state.Settings.EntryFee,
		&state.Settings.ClubEntryFee,
		&state.Settings.CourtFeePerHour,
		&state.Settings.ShuttleFee,
		&shuttleBrandsRaw,
		&state.Settings.SessionFee,
		&state.Settings.CourtCount,
		&courtNamesRaw,
		&levelsRaw,
		&state.Settings.AllowCrossLevel,
		&state.Settings.CrossLevelRange,
		&state.Settings.RandomPriority,
		&state.Settings.ShowPaymentOnShare,
		&state.Settings.ShowTotalOnShare,
		&state.Settings.ResetPlayersAfterFinish,
		&state.Settings.StartMatchWithShuttle,
		&state.Settings.AnnouncementTemplate,
	)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return SessionState{}, err
	}
	if len(courtNamesRaw) > 0 {
		_ = json.Unmarshal(courtNamesRaw, &state.Settings.CourtNames)
	}
	if len(levelsRaw) > 0 {
		_ = json.Unmarshal(levelsRaw, &state.Settings.Levels)
	}
	if len(shuttleBrandsRaw) > 0 {
		_ = json.Unmarshal(shuttleBrandsRaw, &state.Settings.ShuttleBrands)
	}
	normalizeSettings(&state.Settings)
	normalizeLiveShareState(&state)

	rows, err := a.db.QueryContext(ctx, `
		select id, name, games, wins, draws, losses, shuttles, paid, active, level, coupon, club_member, coalesce(member_id, '')
		from players
		where session_id = $1
		order by id
	`, id)
	if err != nil {
		return SessionState{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var player Player
		if err := rows.Scan(&player.ID, &player.Name, &player.Games, &player.Wins, &player.Draws, &player.Losses, &player.Shuttles, &player.Paid, &player.Active, &player.Level, &player.Coupon, &player.ClubMember, &player.MemberID); err != nil {
			return SessionState{}, err
		}
		state.Players = append(state.Players, player)
		if player.ID > state.NextIDs.Player {
			state.NextIDs.Player = player.ID
		}
	}
	if err := rows.Err(); err != nil {
		return SessionState{}, err
	}

	rows, err = a.db.QueryContext(ctx, `
		select id, player_a, player_b
		from couples
		where session_id = $1
		order by id
	`, id)
	if err != nil {
		return SessionState{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var couple Couple
		if err := rows.Scan(&couple.ID, &couple.A, &couple.B); err != nil {
			return SessionState{}, err
		}
		state.Couples = append(state.Couples, couple)
		if couple.ID > state.NextIDs.Couple {
			state.NextIDs.Couple = couple.ID
		}
	}
	if err := rows.Err(); err != nil {
		return SessionState{}, err
	}

	rows, err = a.db.QueryContext(ctx, `
		select id, phase, court, level, a1, a2, b1, b2, shuttles, winner, shuttle_sequence, shuttle_sequence_items, shuttle_returned, returned_shuttle_brand_id, returned_shuttle_number, status, started_at, ended_at, note
		from matches
		where session_id = $1
		order by id
	`, id)
	if err != nil {
		return SessionState{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var phase string
		var match Match
		var seqItemsRaw []byte
		if err := rows.Scan(&match.ID, &phase, &match.Court, &match.Level, &match.A1, &match.A2, &match.B1, &match.B2, &match.Shuttles, &match.Winner, &match.ShuttleSeq, &seqItemsRaw, &match.ShuttleReturned, &match.ReturnedShuttleBrandID, &match.ReturnedShuttleNumber, &match.Status, &match.StartedAt, &match.EndedAt, &match.Note); err != nil {
			return SessionState{}, err
		}
		if len(seqItemsRaw) > 0 {
			_ = json.Unmarshal(seqItemsRaw, &match.ShuttleSeqItems)
		}
		match.ShuttleSeqItems = normalizedShuttleSeqItems(match, state)
		switch phase {
		case "pending":
			state.Pending = append(state.Pending, match)
		case "queue":
			state.Queue = append(state.Queue, match)
		case "live":
			state.Live = append(state.Live, match)
		case "history":
			state.History = append([]Match{match}, state.History...)
		}
		if match.ID < 0 && -match.ID > state.NextIDs.Pending {
			state.NextIDs.Pending = -match.ID
		}
		if match.ID > state.NextIDs.Match {
			state.NextIDs.Match = match.ID
		}
	}
	if err := rows.Err(); err != nil {
		return SessionState{}, err
	}

	rows, err = a.db.QueryContext(ctx, `
		select brand_id, shuttle_number
		from returned_shuttles
		where session_id = $1
		order by brand_id, shuttle_number
	`, id)
	if err != nil {
		return SessionState{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var item ReturnedShuttle
		if err := rows.Scan(&item.BrandID, &item.Number); err != nil {
			return SessionState{}, err
		}
		item.BrandID = normalizedBrandID(item.BrandID)
		state.ReturnedShuttles = append(state.ReturnedShuttles, item)
	}
	if err := rows.Err(); err != nil {
		return SessionState{}, err
	}

	rows, err = a.db.QueryContext(ctx, `
		select kind, target, hour, quantity
		from live_share_hours
		where session_id = $1
		order by kind, target, hour
	`, id)
	if err != nil {
		return SessionState{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var kind, target string
		var hour, quantity int
		if err := rows.Scan(&kind, &target, &hour, &quantity); err != nil {
			return SessionState{}, err
		}
		switch kind {
		case "court":
			state.LiveShare.CourtHours[target] = append(state.LiveShare.CourtHours[target], hour)
		case "player":
			state.LiveShare.PlayerHours[target] = append(state.LiveShare.PlayerHours[target], hour)
		case "shuttle":
			if quantity > 0 {
				state.LiveShare.ShuttleHours[strconv.Itoa(hour)] = quantity
			}
		}
	}
	if err := rows.Err(); err != nil {
		return SessionState{}, err
	}

	applySessionReadOnly(&state, createdAt)
	return state, nil
}

func defaultState(id, name, passcode string) SessionState {
	state := SessionState{
		Tab:   "home",
		Theme: "light",
		Session: SessionInfo{
			ID:            id,
			Name:          name,
			Type:          "liveMatch",
			AdminPasscode: passcode,
			Unlocked:      false,
		},
		Settings: Settings{
			EntryFee:                120,
			ClubEntryFee:            120,
			CourtFeePerHour:         150,
			ShuttleFee:              85,
			ShuttleBrands:           []ShuttleBrand{{ID: defaultShuttleBrandID, Name: defaultShuttleBrandName, Price: 85, Active: true}},
			SessionFee:              0,
			CourtCount:              4,
			CourtNames:              []string{"สนาม 1", "สนาม 2", "สนาม 3", "สนาม 4"},
			Levels:                  []string{"เบา", "กลาง", "หนัก"},
			AllowCrossLevel:         true,
			CrossLevelRange:         1,
			RandomPriority:          "level",
			ShowPaymentOnShare:      true,
			ShowTotalOnShare:        true,
			ResetPlayersAfterFinish: true,
			StartMatchWithShuttle:   true,
			AnnouncementTemplate:    defaultAnnouncementTemplate,
		},
		Players: []Player{},
		Couples: []Couple{},
		Pending: []Match{},
		Queue:   []Match{},
		Live:    []Match{},
		History: []Match{},
		LiveShare: LiveShareHours{
			CourtHours:   map[string][]int{},
			PlayerHours:  map[string][]int{},
			ShuttleHours: map[string]int{},
		},
		NextIDs: NextIDs{Player: 0, Couple: 0, Match: 0, Pending: 0},
	}
	applySessionValidity(&state, time.Now().UTC())
	return state
}

func randomMatch(state *SessionState) error {
	busy := map[int]bool{}
	for _, match := range append(append(append([]Match{}, state.Pending...), state.Queue...), state.Live...) {
		for _, id := range matchPlayers(match) {
			busy[id] = true
		}
	}

	levelIndex := map[string]int{}
	for i, level := range state.Settings.Levels {
		levelIndex[level] = i
	}

	created := 0
	for {
		groups := buildAvailableGroups(*state, busy)
		selected, level := pickRandomMatch(groups, state.Settings, levelIndex)
		if len(selected) < 4 {
			break
		}

		teams := arrangeTeamsByTeammateHistory(selected, state.Couples, state.History)
		state.NextIDs.Pending++
		state.Pending = append(state.Pending, Match{
			ID:    -state.NextIDs.Pending,
			Court: "-",
			Level: level,
			A1:    teams[0],
			A2:    teams[1],
			B1:    teams[2],
			B2:    teams[3],
		})
		for _, id := range selected {
			busy[id] = true
		}
		created++
	}
	if created == 0 {
		return errors.New("ผู้เล่นว่างที่พร้อมสุ่มไม่พอสำหรับจัดคู่")
	}
	return nil
}

func createManualPendingMatch(state *SessionState, requested Match) (Match, error) {
	ids := []int{requested.A1, requested.A2, requested.B1, requested.B2}
	selected := map[int]bool{}
	for _, id := range ids {
		if id <= 0 || selected[id] {
			return Match{}, errors.New("กรุณาเลือกผู้เล่นให้ครบ 4 คนโดยไม่ซ้ำกัน")
		}
		selected[id] = true
	}

	busy := map[int]bool{}
	for _, match := range append(append(append([]Match{}, state.Pending...), state.Queue...), state.Live...) {
		for _, id := range matchPlayers(match) {
			busy[id] = true
		}
	}
	for _, id := range ids {
		player := playerByID(state.Players, id)
		if player == nil || !player.Active || player.Paid || busy[id] {
			return Match{}, errors.New("มีผู้เล่นที่ไม่ว่างหรือไม่สามารถจัดทีมได้")
		}
	}

	teamByPlayer := map[int]int{
		requested.A1: 0,
		requested.A2: 0,
		requested.B1: 1,
		requested.B2: 1,
	}
	for _, couple := range state.Couples {
		teamA, hasA := teamByPlayer[couple.A]
		teamB, hasB := teamByPlayer[couple.B]
		if hasA != hasB {
			return Match{}, errors.New("คู่ที่กำหนดไว้ต้องถูกเลือกมาด้วยกัน")
		}
		if hasA && teamA != teamB {
			return Match{}, errors.New("คู่ที่กำหนดไว้ต้องอยู่ทีมเดียวกัน")
		}
	}

	level := strings.TrimSpace(requested.Level)
	if level == "" && len(state.Settings.Levels) > 0 {
		level = state.Settings.Levels[0]
	}
	if level == "" || !slices.Contains(state.Settings.Levels, level) {
		return Match{}, errors.New("กรุณาเลือกระดับมือที่ถูกต้อง")
	}

	state.NextIDs.Pending++
	created := Match{
		ID:    -state.NextIDs.Pending,
		Court: "-",
		Level: level,
		A1:    requested.A1,
		A2:    requested.A2,
		B1:    requested.B1,
		B2:    requested.B2,
	}
	state.Pending = append(state.Pending, created)
	return created, nil
}

type group struct {
	ids   []int
	level string
	games int
}

func buildAvailableGroups(state SessionState, busy map[int]bool) []group {
	playersByID := map[int]Player{}
	for _, p := range state.Players {
		playersByID[p.ID] = p
	}
	used := map[int]bool{}
	var groups []group
	for _, p := range state.Players {
		if used[p.ID] || !p.Active || p.Paid || !p.Coupon || busy[p.ID] {
			continue
		}
		if c, ok := coupleForPlayer(state.Couples, p.ID); ok {
			mateID := c.A
			if mateID == p.ID {
				mateID = c.B
			}
			mate, exists := playersByID[mateID]
			if exists && mate.Active && !mate.Paid && mate.Coupon && !busy[mateID] {
				groups = append(groups, group{ids: []int{p.ID, mateID}, level: p.Level, games: p.Games + mate.Games})
				used[p.ID], used[mateID] = true, true
				continue
			}
		}
		groups = append(groups, group{ids: []int{p.ID}, level: p.Level, games: p.Games})
		used[p.ID] = true
	}
	slices.SortFunc(groups, func(a, b group) int {
		if a.games != b.games {
			return a.games - b.games
		}
		return len(b.ids) - len(a.ids)
	})
	return groups
}

func pickFour(groups []group) []int {
	selected, ok := pickFourFrom(groups, 0, nil)
	if !ok {
		return selected
	}
	return selected
}

func pickFourFrom(groups []group, index int, selected []int) ([]int, bool) {
	if len(selected) == 4 {
		return selected, true
	}
	if len(selected) > 4 || index >= len(groups) {
		return selected, false
	}
	if len(selected)+len(groups[index].ids) <= 4 {
		with := append(append([]int{}, selected...), groups[index].ids...)
		if result, ok := pickFourFrom(groups, index+1, with); ok {
			return result, true
		}
	}
	return pickFourFrom(groups, index+1, selected)
}

func pickRandomMatch(groups []group, settings Settings, levelIndex map[string]int) ([]int, string) {
	if settings.RandomPriority == "games" {
		return pickRandomMatchByGames(groups, settings, levelIndex)
	}
	return pickRandomMatchByLevel(groups, settings, levelIndex)
}

func pickRandomMatchByLevel(groups []group, settings Settings, levelIndex map[string]int) ([]int, string) {
	for _, base := range settings.Levels {
		pool := []group{}
		for _, g := range groups {
			if g.level == base {
				pool = append(pool, g)
			}
		}
		selected := pickFour(pool)
		if len(selected) == 4 {
			return selected, base
		}
	}
	if settings.AllowCrossLevel {
		for _, base := range settings.Levels {
			for _, poolLevels := range adjacentLevelWindows(base, levelIndex) {
				pool := []group{}
				for _, g := range groups {
					if slices.Contains(poolLevels, g.level) {
						pool = append(pool, g)
					}
				}
				selected := pickFour(pool)
				if len(selected) == 4 {
					return selected, base
				}
			}
		}
	}
	return nil, ""
}

func pickRandomMatchByGames(groups []group, settings Settings, levelIndex map[string]int) ([]int, string) {
	if selected, level := bestMatchForLevels(groups, settings.Levels); len(selected) == 4 {
		return selected, level
	}
	if settings.AllowCrossLevel {
		var best []int
		bestLevel := ""
		bestGames := int(^uint(0) >> 1)
		for _, base := range settings.Levels {
			for _, poolLevels := range adjacentLevelWindows(base, levelIndex) {
				pool := []group{}
				for _, g := range groups {
					if slices.Contains(poolLevels, g.level) {
						pool = append(pool, g)
					}
				}
				if selected := pickFour(pool); len(selected) == 4 {
					games := selectedGroupGames(pool, selected)
					if games < bestGames {
						best = selected
						bestLevel = base
						bestGames = games
					}
				}
			}
		}
		if len(best) == 4 {
			return best, bestLevel
		}
	}
	return nil, ""
}

func bestMatchForLevels(groups []group, levels []string) ([]int, string) {
	var best []int
	bestLevel := ""
	bestGames := int(^uint(0) >> 1)
	for _, level := range levels {
		pool := []group{}
		for _, g := range groups {
			if g.level == level {
				pool = append(pool, g)
			}
		}
		selected := pickFour(pool)
		if len(selected) != 4 {
			continue
		}
		games := selectedGroupGames(pool, selected)
		if games < bestGames {
			best = selected
			bestLevel = level
			bestGames = games
		}
	}
	return best, bestLevel
}

func selectedGroupGames(groups []group, selected []int) int {
	selectedSet := map[int]bool{}
	for _, id := range selected {
		selectedSet[id] = true
	}
	total := 0
	for _, g := range groups {
		for _, id := range g.ids {
			if selectedSet[id] {
				total += g.games
				break
			}
		}
	}
	return total
}

func adjacentLevelWindows(base string, levelIndex map[string]int) [][]string {
	basePos, ok := levelIndex[base]
	if !ok {
		return nil
	}
	windows := [][]string{}
	if basePos > 0 {
		windows = append(windows, []string{base, levelByIndex(levelIndex, basePos-1)})
	}
	if levelByIndex(levelIndex, basePos+1) != "" {
		windows = append(windows, []string{base, levelByIndex(levelIndex, basePos+1)})
	}
	return windows
}

func levelByIndex(levelIndex map[string]int, index int) string {
	for level, candidate := range levelIndex {
		if candidate == index {
			return level
		}
	}
	return ""
}

type teammatePair struct {
	a int
	b int
}

type teammateScore struct {
	total          int
	mostWithOne    int
	recencyPenalty int
}

func teammatePairFor(a, b int) teammatePair {
	if a > b {
		a, b = b, a
	}
	return teammatePair{a: a, b: b}
}

func arrangeTeamsByTeammateHistory(ids []int, couples []Couple, history []Match) []int {
	if len(ids) != 4 {
		return ids
	}
	candidates := [][]int{
		{ids[0], ids[1], ids[2], ids[3]},
		{ids[0], ids[2], ids[1], ids[3]},
		{ids[0], ids[3], ids[1], ids[2]},
	}
	counts := map[teammatePair]int{}
	recency := map[teammatePair]int{}
	for index, match := range history {
		weight := len(history) - index
		for _, pair := range []teammatePair{
			teammatePairFor(match.A1, match.A2),
			teammatePairFor(match.B1, match.B2),
		} {
			if pair.a <= 0 || pair.b <= 0 || pair.a == pair.b {
				continue
			}
			counts[pair]++
			if _, exists := recency[pair]; !exists {
				recency[pair] = weight
			}
		}
	}

	var best []int
	bestScore := teammateScore{total: int(^uint(0) >> 1), mostWithOne: int(^uint(0) >> 1), recencyPenalty: int(^uint(0) >> 1)}
	for _, candidate := range candidates {
		if !candidateKeepsCouplesTogether(candidate, couples) {
			continue
		}
		first := teammatePairFor(candidate[0], candidate[1])
		second := teammatePairFor(candidate[2], candidate[3])
		firstCount, secondCount := counts[first], counts[second]
		score := teammateScore{
			total:          firstCount + secondCount,
			mostWithOne:    max(firstCount, secondCount),
			recencyPenalty: recency[first] + recency[second],
		}
		if score.total < bestScore.total ||
			(score.total == bestScore.total && score.mostWithOne < bestScore.mostWithOne) ||
			(score.total == bestScore.total && score.mostWithOne == bestScore.mostWithOne && score.recencyPenalty < bestScore.recencyPenalty) {
			best = candidate
			bestScore = score
		}
	}
	if len(best) == 4 {
		return best
	}
	return ids
}

func candidateKeepsCouplesTogether(candidate []int, couples []Couple) bool {
	teamByPlayer := map[int]int{
		candidate[0]: 0,
		candidate[1]: 0,
		candidate[2]: 1,
		candidate[3]: 1,
	}
	for _, couple := range couples {
		teamA, hasA := teamByPlayer[couple.A]
		teamB, hasB := teamByPlayer[couple.B]
		if hasA && hasB && teamA != teamB {
			return false
		}
	}
	return true
}

func startMatch(state *SessionState, matchID int, court string, brandIDs ...string) bool {
	brandID := ""
	if len(brandIDs) > 0 {
		brandID = brandIDs[0]
	}
	brandID = selectableShuttleBrandID(*state, brandID)
	if brandID == "" {
		brandID = defaultShuttleBrandID
	}
	for i, match := range state.Queue {
		if match.ID == matchID {
			if !matchLevelsAllowed(*state, match) {
				return false
			}
			state.Queue = append(state.Queue[:i], state.Queue[i+1:]...)
			match.Court = court
			match.Shuttles = 0
			match.ShuttleSeq = ""
			match.ShuttleSeqItems = []ShuttleSeqItem{}
			if state.Settings.StartMatchWithShuttle {
				match.Shuttles = 1
				number := nextShuttleNumber(state, brandID)
				match.ShuttleSeqItems = append(match.ShuttleSeqItems, ShuttleSeqItem{BrandID: normalizedBrandID(brandID), Number: number})
				match.ShuttleSeq = appendShuttleNumber(match.ShuttleSeq, number)
			}
			match.Status = "กำลังเล่น"
			match.StartedAt = nowHHMM()
			state.Live = append(state.Live, match)
			return true
		}
	}
	return false
}

func confirmPendingMatch(state *SessionState, matchID int) bool {
	for i, match := range state.Pending {
		if match.ID == matchID {
			state.Pending = append(state.Pending[:i], state.Pending[i+1:]...)
			state.NextIDs.Match++
			match.ID = state.NextIDs.Match
			match.Court = "-"
			state.Queue = append(state.Queue, match)
			return true
		}
	}
	return false
}

func cancelPendingMatch(state *SessionState, matchID int) bool {
	for i, match := range state.Pending {
		if match.ID == matchID {
			state.Pending = append(state.Pending[:i], state.Pending[i+1:]...)
			return true
		}
	}
	return false
}

func matchLevelsAllowed(state SessionState, match Match) bool {
	levelIndex := map[string]int{}
	for i, level := range state.Settings.Levels {
		levelIndex[level] = i
	}
	minIndex := 1 << 30
	maxIndex := -1
	for _, id := range matchPlayers(match) {
		player := playerByID(state.Players, id)
		if player == nil {
			return false
		}
		index, ok := levelIndex[player.Level]
		if !ok {
			return false
		}
		if index < minIndex {
			minIndex = index
		}
		if index > maxIndex {
			maxIndex = index
		}
	}
	if minIndex == maxIndex {
		return true
	}
	return state.Settings.AllowCrossLevel && maxIndex-minIndex <= 1
}

func deletePlayer(state *SessionState, playerID int) error {
	for i := range state.Players {
		if state.Players[i].ID != playerID {
			continue
		}
		reasons := playerDeleteBlockReasons(*state, playerID)
		if len(reasons) > 0 {
			return fmt.Errorf("cannot delete player: %s", strings.Join(reasons, ", "))
		}
		state.Players = append(state.Players[:i], state.Players[i+1:]...)
		return nil
	}
	return errPlayerNotFound
}

func playerReferenced(state SessionState, playerID int) bool {
	return len(playerDeleteBlockReasons(state, playerID)) > 0
}

func playerDeleteBlockReasons(state SessionState, playerID int) []string {
	reasons := []string{}
	for _, couple := range state.Couples {
		if couple.A == playerID || couple.B == playerID {
			reasons = append(reasons, "couple")
			break
		}
	}
	if matchListContainsPlayer(state.Pending, playerID) {
		reasons = append(reasons, "pending")
	}
	if matchListContainsPlayer(state.Queue, playerID) {
		reasons = append(reasons, "queue")
	}
	if matchListContainsPlayer(state.Live, playerID) {
		reasons = append(reasons, "live")
	}
	if matchListContainsPlayer(state.History, playerID) {
		reasons = append(reasons, "history")
	}
	return reasons
}

func matchListContainsPlayer(matches []Match, playerID int) bool {
	for _, match := range matches {
		if slices.Contains(matchPlayers(match), playerID) {
			return true
		}
	}
	return false
}

func cancelQueuedMatch(state *SessionState, matchID int) bool {
	for i, match := range state.Queue {
		if match.ID == matchID {
			state.Queue = append(state.Queue[:i], state.Queue[i+1:]...)
			return true
		}
	}
	return false
}

func adjustShuttles(state *SessionState, matchID, delta int, brandIDs ...string) {
	brandID := ""
	if len(brandIDs) > 0 {
		brandID = brandIDs[0]
	}
	for i := range state.Live {
		if state.Live[i].ID == matchID {
			if delta <= 0 {
				return
			}
			brandID = selectableShuttleBrandID(*state, brandID)
			if brandID == "" {
				return
			}
			for range delta {
				nextNumber := nextShuttleNumber(state, brandID)
				state.Live[i].Shuttles++
				state.Live[i].ShuttleSeqItems = append(state.Live[i].ShuttleSeqItems, ShuttleSeqItem{BrandID: normalizedBrandID(brandID), Number: nextNumber})
				state.Live[i].ShuttleSeq = appendShuttleNumber(state.Live[i].ShuttleSeq, nextNumber)
			}
			return
		}
	}
}

func returnLatestShuttle(state *SessionState, matchID int) (int, bool) {
	for i := range state.Live {
		match := &state.Live[i]
		items := normalizedShuttleSeqItems(*match, *state)
		if match.ID != matchID || match.Shuttles <= 1 || len(items) <= 1 {
			continue
		}
		returned := items[len(items)-1]
		items = items[:len(items)-1]
		parts := make([]string, 0, len(items))
		for _, item := range items {
			parts = append(parts, strconv.Itoa(item.Number))
		}
		match.Shuttles--
		match.ShuttleSeqItems = items
		match.ShuttleSeq = strings.Join(parts, ",")
		match.ReturnedShuttleBrandID = normalizedBrandID(returned.BrandID)
		match.ReturnedShuttleNumber = returned.Number
		if !returnedShuttleContains(state.ReturnedShuttles, ReturnedShuttle{BrandID: returned.BrandID, Number: returned.Number}) {
			state.ReturnedShuttles = append(state.ReturnedShuttles, ReturnedShuttle{BrandID: normalizedBrandID(returned.BrandID), Number: returned.Number})
			sortReturnedShuttles(state.ReturnedShuttles)
		}
		return returned.Number, true
	}
	return 0, false
}

func closeLive(state *SessionState, matchID int, cancelled bool, note string, winner string, shuttleReturned bool) bool {
	for i, match := range state.Live {
		if match.ID != matchID {
			continue
		}
		state.Live = append(state.Live[:i], state.Live[i+1:]...)
		match.EndedAt = nowHHMM()
		if note != "" {
			match.Note = note
		} else if cancelled {
			match.Note = "ยกเลิกการแข่งขัน"
		} else {
			match.Note = "จบการแข่งขัน"
		}
		if !cancelled {
			if winner != "A" && winner != "B" && winner != "draw" {
				winner = ""
			}
			match.Winner = winner
			match.Status = "finished"
		} else {
			match.Winner = ""
			match.Status = "cancelled"
			match.ShuttleReturned = shuttleReturned && match.Shuttles > 0 && match.ShuttleSeq != ""
			if match.ShuttleReturned {
				items := normalizedShuttleSeqItems(match, *state)
				if len(items) > 0 {
					last := items[len(items)-1]
					match.ReturnedShuttleBrandID = normalizedBrandID(last.BrandID)
					match.ReturnedShuttleNumber = last.Number
					if !returnedShuttleContains(state.ReturnedShuttles, ReturnedShuttle{BrandID: last.BrandID, Number: last.Number}) {
						state.ReturnedShuttles = append(state.ReturnedShuttles, ReturnedShuttle{BrandID: normalizedBrandID(last.BrandID), Number: last.Number})
						sortReturnedShuttles(state.ReturnedShuttles)
					}
				}
			}
		}
		for j := range state.Players {
			if slices.Contains(matchPlayers(match), state.Players[j].ID) && (!cancelled || !match.ShuttleReturned) {
				state.Players[j].Shuttles += match.Shuttles
				if cancelled {
					continue
				}
				state.Players[j].Games++
				if state.Settings.ResetPlayersAfterFinish {
					state.Players[j].Coupon = false
				}
				if winner == "A" && (state.Players[j].ID == match.A1 || state.Players[j].ID == match.A2) {
					state.Players[j].Wins++
				} else if winner == "B" && (state.Players[j].ID == match.B1 || state.Players[j].ID == match.B2) {
					state.Players[j].Wins++
				} else if winner == "draw" {
					state.Players[j].Draws++
				} else if winner != "" && winner != "draw" {
					state.Players[j].Losses++
				}
			}
		}
		state.History = append([]Match{match}, state.History...)
		return true
	}
	return false
}

func updateHistoryWinner(state *SessionState, matchID int, winner string) bool {
	if winner != "A" && winner != "B" && winner != "draw" {
		winner = ""
	}
	for i := range state.History {
		if state.History[i].ID != matchID {
			continue
		}
		if isCancelledMatch(state.History[i]) {
			return true
		}
		applyResultStats(state, state.History[i], state.History[i].Winner, -1)
		state.History[i].Winner = winner
		applyResultStats(state, state.History[i], winner, 1)
		return true
	}
	return false
}

func applyResultStats(state *SessionState, match Match, winner string, delta int) {
	if winner != "A" && winner != "B" && winner != "draw" {
		return
	}
	for i := range state.Players {
		playerID := state.Players[i].ID
		if !slices.Contains(matchPlayers(match), playerID) {
			continue
		}
		switch {
		case winner == "draw":
			state.Players[i].Draws = clampStat(state.Players[i].Draws + delta)
		case winner == "A" && (playerID == match.A1 || playerID == match.A2):
			state.Players[i].Wins = clampStat(state.Players[i].Wins + delta)
		case winner == "B" && (playerID == match.B1 || playerID == match.B2):
			state.Players[i].Wins = clampStat(state.Players[i].Wins + delta)
		default:
			state.Players[i].Losses = clampStat(state.Players[i].Losses + delta)
		}
	}
}

func clampStat(value int) int {
	if value < 0 {
		return 0
	}
	return value
}

func isCancelledMatch(match Match) bool {
	return match.Status == "cancelled"
}

func realRecordedMatchCount(state SessionState) int {
	total := len(state.Live)
	for _, match := range state.History {
		if !isCancelledMatch(match) {
			total++
		}
	}
	return total
}

func dashboardPayload(state SessionState) map[string]any {
	return map[string]any{
		"players":  state.Players,
		"queue":    state.Queue,
		"live":     state.Live,
		"history":  state.History,
		"settings": state.Settings,
		"summary": map[string]any{
			"activePlayers":         activePlayerCount(state),
			"recordedMatches":       realRecordedMatchCount(state),
			"cancelledMatches":      cancelledMatchCount(state),
			"totalShuttles":         totalSessionShuttles(state),
			"totalPlays":            totalPlays(state),
			"averageGames":          averageGames(state),
			"minGames":              minGames(state),
			"maxGames":              maxGames(state),
			"totalRevenue":          totalRevenue(state),
			"paidRevenue":           paidRevenue(state),
			"unpaidRevenue":         totalRevenue(state) - paidRevenue(state),
			"paymentPercent":        paymentPercent(state),
			"liveShareCourtHours":   liveShareCourtHours(state),
			"liveSharePlayerHours":  liveSharePlayerHours(state),
			"liveShareCourtCost":    liveShareCourtCost(state),
			"liveShareShuttleCount": liveShareShuttleCount(state),
			"liveShareShuttleCost":  liveShareShuttleCost(state),
			"liveShareSessionCost":  liveShareSessionCost(state),
			"queueMatches":          len(state.Queue),
			"liveMatches":           len(state.Live),
			"realHistoryMatches":    len(state.History) - cancelledMatchCount(state),
			"historyMatches":        len(state.History),
			"availableCourtCount":   len(state.Settings.CourtNames),
		},
	}
}

func queuePayload(state SessionState) map[string]any {
	return map[string]any{
		"pending":             state.Pending,
		"queue":               state.Queue,
		"live":                state.Live,
		"players":             state.Players,
		"settings":            state.Settings,
		"availableCourtNames": availableCourtNames(state),
	}
}

func activePlayerCount(state SessionState) int {
	count := 0
	for _, player := range state.Players {
		if player.Active {
			count++
		}
	}
	return count
}

func totalRealShuttles(state SessionState) int {
	total := 0
	for _, match := range state.Live {
		total += match.Shuttles
	}
	for _, match := range state.History {
		if !isCancelledMatch(match) || !match.ShuttleReturned {
			total += match.Shuttles
		}
	}
	return total
}

func totalSessionShuttles(state SessionState) int {
	if isLiveShare(state) {
		return liveShareShuttleCount(state)
	}
	return totalRealShuttles(state)
}

func totalPlays(state SessionState) int {
	total := 0
	for _, player := range state.Players {
		if player.Active {
			total += player.Games
		}
	}
	return total
}

func averageGames(state SessionState) float64 {
	count := activePlayerCount(state)
	if count == 0 {
		return 0
	}
	return float64(totalPlays(state)) / float64(count)
}

func minGames(state SessionState) int {
	minimum := 0
	found := false
	for _, player := range state.Players {
		if !player.Active {
			continue
		}
		if !found || player.Games < minimum {
			minimum = player.Games
			found = true
		}
	}
	return minimum
}

func maxGames(state SessionState) int {
	maximum := 0
	for _, player := range state.Players {
		if player.Active && player.Games > maximum {
			maximum = player.Games
		}
	}
	return maximum
}

func totalRevenue(state SessionState) int {
	if isLiveShare(state) {
		return liveShareTotalCost(state)
	}
	total := 0
	share := sessionFeeShare(state)
	for _, player := range state.Players {
		if player.Active {
			total += playerEntryFee(state, player) + playerShuttleCost(state, player.ID) + share
		}
	}
	return total
}

func paidRevenue(state SessionState) int {
	if isLiveShare(state) {
		total := 0
		for _, player := range state.Players {
			if player.Active && player.Paid {
				total += liveSharePlayerCost(state, player)
			}
		}
		return total
	}
	total := 0
	share := sessionFeeShare(state)
	for _, player := range state.Players {
		if player.Active && player.Paid {
			total += playerEntryFee(state, player) + playerShuttleCost(state, player.ID) + share
		}
	}
	return total
}

func playerEntryFee(state SessionState, player Player) int {
	if player.ClubMember {
		return state.Settings.ClubEntryFee
	}
	return state.Settings.EntryFee
}

func shuttleBrandPrice(state SessionState, brandID string) int {
	brandID = normalizedBrandID(brandID)
	for _, brand := range state.Settings.ShuttleBrands {
		if normalizedBrandID(brand.ID) == brandID {
			return brand.Price
		}
	}
	return state.Settings.ShuttleFee
}

func playerShuttleCost(state SessionState, playerID int) int {
	total := 0
	for _, match := range append(append([]Match{}, state.Live...), state.History...) {
		if !slices.Contains(matchPlayers(match), playerID) {
			continue
		}
		if isCancelledMatch(match) && match.ShuttleReturned {
			continue
		}
		for _, item := range normalizedShuttleSeqItems(match, state) {
			total += shuttleBrandPrice(state, item.BrandID)
		}
		if len(normalizedShuttleSeqItems(match, state)) == 0 {
			total += match.Shuttles * state.Settings.ShuttleFee
		}
	}
	return total
}

func liveShareCourtHours(state SessionState) int {
	total := 0
	for _, hours := range state.LiveShare.CourtHours {
		total += len(normalizedHourSet(hours))
	}
	return total
}

func liveSharePlayerHours(state SessionState) int {
	total := 0
	for _, player := range state.Players {
		if !player.Active {
			continue
		}
		total += liveShareHoursForPlayer(state, player.ID)
	}
	return total
}

func liveShareActiveHours(state SessionState) []int {
	seen := map[int]bool{}
	for _, hours := range state.LiveShare.CourtHours {
		for _, hour := range normalizedHourSet(hours) {
			seen[hour] = true
		}
	}
	for _, hours := range state.LiveShare.PlayerHours {
		for _, hour := range normalizedHourSet(hours) {
			seen[hour] = true
		}
	}
	for hourText, quantity := range state.LiveShare.ShuttleHours {
		hour, err := strconv.Atoi(hourText)
		if err == nil && hour > 0 && quantity > 0 {
			seen[hour] = true
		}
	}
	out := []int{}
	for hour := range seen {
		out = append(out, hour)
	}
	slices.Sort(out)
	return out
}

func liveShareCourtCountForHour(state SessionState, hour int) int {
	total := 0
	for _, hours := range state.LiveShare.CourtHours {
		if slices.Contains(normalizedHourSet(hours), hour) {
			total++
		}
	}
	return total
}

func liveSharePlayerCountForHour(state SessionState, hour int) int {
	total := 0
	for _, player := range state.Players {
		if !player.Active {
			continue
		}
		if slices.Contains(normalizedHourSet(state.LiveShare.PlayerHours[strconv.Itoa(player.ID)]), hour) {
			total++
		}
	}
	return total
}

func liveShareHoursForPlayer(state SessionState, playerID int) int {
	return len(normalizedHourSet(state.LiveShare.PlayerHours[strconv.Itoa(playerID)]))
}

func liveShareCourtCost(state SessionState) int {
	return liveShareCourtHours(state) * state.Settings.CourtFeePerHour
}

func liveShareShuttleCost(state SessionState) int {
	return liveShareShuttleCount(state) * state.Settings.ShuttleFee
}

func liveShareShuttleCount(state SessionState) int {
	total := 0
	for _, quantity := range state.LiveShare.ShuttleHours {
		if quantity > 0 {
			total += quantity
		}
	}
	return total
}

func liveShareSessionCost(state SessionState) int {
	if state.Settings.SessionFee < 0 {
		return 0
	}
	return state.Settings.SessionFee
}

func liveShareTotalCost(state SessionState) int {
	return liveShareCourtCost(state) + liveShareShuttleCost(state) + liveShareSessionCost(state)
}

func liveSharePlayerCost(state SessionState, player Player) int {
	activeHours := liveShareActiveHours(state)
	if len(activeHours) == 0 {
		return 0
	}
	sessionCost := liveShareSessionCost(state)
	total := 0
	playerHours := normalizedHourSet(state.LiveShare.PlayerHours[strconv.Itoa(player.ID)])
	for _, hour := range playerHours {
		playerCount := liveSharePlayerCountForHour(state, hour)
		if playerCount == 0 {
			continue
		}
		hourCourtCost := liveShareCourtCountForHour(state, hour) * state.Settings.CourtFeePerHour
		hourShuttleCost := state.LiveShare.ShuttleHours[strconv.Itoa(hour)] * state.Settings.ShuttleFee
		// Session cost is not timestamped, so spread it across occupied hours before splitting that hour.
		numerator := (hourCourtCost+hourShuttleCost)*len(activeHours) + sessionCost
		denominator := len(activeHours) * playerCount
		total += (numerator + denominator - 1) / denominator
	}
	return total
}

func sanitizeLiveShareHours(input LiveShareHours, state SessionState) LiveShareHours {
	out := LiveShareHours{CourtHours: map[string][]int{}, PlayerHours: map[string][]int{}, ShuttleHours: map[string]int{}}
	courts := map[string]bool{}
	for _, court := range state.Settings.CourtNames {
		courts[court] = true
	}
	for court, hours := range input.CourtHours {
		if courts[court] {
			out.CourtHours[court] = normalizedHourSet(hours)
		}
	}
	players := map[string]bool{}
	for _, player := range state.Players {
		if player.Active {
			players[strconv.Itoa(player.ID)] = true
		}
	}
	for playerID, hours := range input.PlayerHours {
		if players[playerID] {
			out.PlayerHours[playerID] = normalizedHourSet(hours)
		}
	}
	for hourText, quantity := range input.ShuttleHours {
		hour, err := strconv.Atoi(hourText)
		if err != nil || hour < 1 || quantity <= 0 {
			continue
		}
		out.ShuttleHours[strconv.Itoa(hour)] = quantity
	}
	return out
}

func sessionFeeShare(state SessionState) int {
	count := activePlayerCount(state)
	if count == 0 || state.Settings.SessionFee <= 0 {
		return 0
	}
	return (state.Settings.SessionFee + count - 1) / count
}

func paymentPercent(state SessionState) int {
	total := totalRevenue(state)
	if total == 0 {
		return 0
	}
	return paidRevenue(state) * 100 / total
}

func cancelledMatchCount(state SessionState) int {
	count := 0
	for _, match := range state.History {
		if isCancelledMatch(match) {
			count++
		}
	}
	return count
}

func availableCourtNames(state SessionState) []string {
	used := map[string]bool{}
	for _, match := range state.Live {
		if match.Court != "" {
			used[match.Court] = true
		}
	}
	available := []string{}
	for _, court := range state.Settings.CourtNames {
		if !used[court] {
			available = append(available, court)
		}
	}
	return available
}

func appendShuttleNumber(sequence string, number int) string {
	if sequence == "" {
		return strconv.Itoa(number)
	}
	return sequence + "," + strconv.Itoa(number)
}

func nextShuttleNumber(state *SessionState, brandID string) int {
	brandID = normalizedBrandID(brandID)
	sortReturnedShuttles(state.ReturnedShuttles)
	for index, item := range state.ReturnedShuttles {
		if normalizedBrandID(item.BrandID) == brandID {
			state.ReturnedShuttles = append(state.ReturnedShuttles[:index], state.ReturnedShuttles[index+1:]...)
			return item.Number
		}
	}
	maxNumber := 0
	legacyCount := 0
	allocationCount := map[int]int{}
	returnCount := map[int]int{}
	for _, match := range append(append([]Match{}, state.Live...), state.History...) {
		items := normalizedShuttleSeqItems(match, *state)
		if len(items) == 0 {
			legacyCount += match.Shuttles
			continue
		}
		for _, item := range items {
			if normalizedBrandID(item.BrandID) != brandID {
				continue
			}
			if item.Number > maxNumber {
				maxNumber = item.Number
			}
			allocationCount[item.Number]++
			if match.Status == "cancelled" && match.ShuttleReturned && normalizedBrandID(match.ReturnedShuttleBrandID) == brandID {
				returnCount[item.Number]++
			}
		}
	}
	for number := 1; number <= maxNumber; number++ {
		if allocationCount[number] > 0 && allocationCount[number] == returnCount[number] {
			return number
		}
	}
	if legacyCount > maxNumber {
		return legacyCount + 1
	}
	return maxNumber + 1
}

func normalizedBrandID(brandID string) string {
	if strings.TrimSpace(brandID) == "" {
		return defaultShuttleBrandID
	}
	return strings.TrimSpace(brandID)
}

func defaultShuttleBrand(settings Settings) ShuttleBrand {
	price := settings.ShuttleFee
	if price <= 0 {
		price = 85
	}
	return ShuttleBrand{ID: defaultShuttleBrandID, Name: defaultShuttleBrandName, Price: price, Active: true}
}

func activeShuttleBrands(settings Settings) []ShuttleBrand {
	brands := []ShuttleBrand{}
	for _, brand := range settings.ShuttleBrands {
		if brand.Active {
			brands = append(brands, brand)
		}
	}
	return brands
}

func selectableShuttleBrandID(state SessionState, brandID string) string {
	rawBrandID := strings.TrimSpace(brandID)
	brandID = normalizedBrandID(brandID)
	active := activeShuttleBrands(state.Settings)
	if len(active) == 0 {
		return defaultShuttleBrandID
	}
	if len(active) == 1 && rawBrandID == "" {
		return normalizedBrandID(active[0].ID)
	}
	if rawBrandID == "" && len(active) > 1 {
		return ""
	}
	for _, brand := range active {
		if normalizedBrandID(brand.ID) == brandID {
			return brandID
		}
	}
	if len(active) == 1 {
		return normalizedBrandID(active[0].ID)
	}
	return ""
}

func normalizedShuttleSeqItems(match Match, state SessionState) []ShuttleSeqItem {
	items := []ShuttleSeqItem{}
	for _, item := range match.ShuttleSeqItems {
		if item.Number > 0 {
			items = append(items, ShuttleSeqItem{BrandID: normalizedBrandID(item.BrandID), Number: item.Number})
		}
	}
	if len(items) > 0 {
		return items
	}
	for _, number := range shuttleSequenceNumbers(match.ShuttleSeq) {
		items = append(items, ShuttleSeqItem{BrandID: defaultShuttleBrandID, Number: number})
	}
	return items
}

func returnedShuttleContains(items []ReturnedShuttle, target ReturnedShuttle) bool {
	for _, item := range items {
		if normalizedBrandID(item.BrandID) == normalizedBrandID(target.BrandID) && item.Number == target.Number {
			return true
		}
	}
	return false
}

func sortReturnedShuttles(items []ReturnedShuttle) {
	slices.SortFunc(items, func(a, b ReturnedShuttle) int {
		if normalizedBrandID(a.BrandID) < normalizedBrandID(b.BrandID) {
			return -1
		}
		if normalizedBrandID(a.BrandID) > normalizedBrandID(b.BrandID) {
			return 1
		}
		return a.Number - b.Number
	})
}

func shuttleSequenceNumbers(sequence string) []int {
	numbers := []int{}
	for _, part := range strings.Split(sequence, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		bounds := strings.Split(part, "-")
		start, startErr := strconv.Atoi(strings.TrimSpace(bounds[0]))
		end := start
		endErr := startErr
		if len(bounds) > 1 {
			end, endErr = strconv.Atoi(strings.TrimSpace(bounds[len(bounds)-1]))
		}
		if startErr != nil || endErr != nil {
			continue
		}
		if start > end {
			start, end = end, start
		}
		for number := start; number <= end; number++ {
			numbers = append(numbers, number)
		}
	}
	return numbers
}

func maxShuttleSequenceNumber(sequence string) int {
	maxNumber := 0
	for _, part := range strings.Split(sequence, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		bounds := strings.Split(part, "-")
		number, err := strconv.Atoi(strings.TrimSpace(bounds[len(bounds)-1]))
		if err == nil && number > maxNumber {
			maxNumber = number
		}
	}
	return maxNumber
}

func matchPlayers(match Match) []int {
	return []int{match.A1, match.A2, match.B1, match.B2}
}

func coupleForPlayer(couples []Couple, id int) (Couple, bool) {
	for _, c := range couples {
		if c.A == id || c.B == id {
			return c, true
		}
	}
	return Couple{}, false
}

func removeCouplesForPlayers(couples []Couple, a, b int) []Couple {
	return slices.DeleteFunc(couples, func(c Couple) bool {
		return c.A == a || c.A == b || c.B == a || c.B == b
	})
}

func syncNewCouple(state *SessionState, a, b int) {
	source := playerByID(state.Players, a)
	if source == nil {
		return
	}
	for i := range state.Players {
		if state.Players[i].ID == b {
			state.Players[i].Level = source.Level
			state.Players[i].Coupon = source.Coupon
			return
		}
	}
}

func syncCoupledPlayerStatus(state *SessionState, id int) {
	couple, ok := coupleForPlayer(state.Couples, id)
	if !ok {
		return
	}
	source := playerByID(state.Players, id)
	if source == nil {
		return
	}
	mateID := couple.A
	if mateID == id {
		mateID = couple.B
	}
	for i := range state.Players {
		if state.Players[i].ID == mateID {
			state.Players[i].Level = source.Level
			state.Players[i].Coupon = source.Coupon
			return
		}
	}
}

func playerByID(players []Player, id int) *Player {
	for i := range players {
		if players[i].ID == id {
			return &players[i]
		}
	}
	return nil
}

func normalizeSettings(settings *Settings) {
	if settings.EntryFee < 0 {
		settings.EntryFee = 0
	}
	if settings.ClubEntryFee < 0 {
		settings.ClubEntryFee = 0
	}
	if settings.ClubEntryFee == 0 {
		settings.ClubEntryFee = settings.EntryFee
	}
	if settings.CourtFeePerHour < 0 {
		settings.CourtFeePerHour = 0
	}
	if settings.CourtFeePerHour == 0 {
		settings.CourtFeePerHour = 150
	}
	if settings.ShuttleFee < 0 {
		settings.ShuttleFee = 0
	}
	brands := []ShuttleBrand{}
	seenBrands := map[string]bool{}
	for _, brand := range settings.ShuttleBrands {
		brand.ID = normalizedBrandID(brand.ID)
		brand.Name = strings.TrimSpace(brand.Name)
		if brand.Name == "" || seenBrands[brand.ID] {
			continue
		}
		if brand.Price < 0 {
			brand.Price = 0
		}
		seenBrands[brand.ID] = true
		brands = append(brands, brand)
	}
	if len(brands) == 0 {
		brands = []ShuttleBrand{defaultShuttleBrand(*settings)}
	}
	if len(activeShuttleBrands(Settings{ShuttleBrands: brands})) == 0 {
		brands[0].Active = true
	}
	settings.ShuttleBrands = brands
	settings.ShuttleFee = settings.ShuttleBrands[0].Price
	if settings.SessionFee < 0 {
		settings.SessionFee = 0
	}
	if len(settings.CourtNames) == 0 {
		settings.CourtNames = []string{"สนาม 1"}
	}
	settings.CourtCount = len(settings.CourtNames)
	if len(settings.Levels) == 0 {
		settings.Levels = []string{"เบา", "กลาง", "หนัก"}
	}
	settings.CrossLevelRange = 1
	if settings.RandomPriority != "games" {
		settings.RandomPriority = "level"
	}
	if strings.TrimSpace(settings.AnnouncementTemplate) == "" {
		settings.AnnouncementTemplate = defaultAnnouncementTemplate
	}
}

func normalizeSessionType(value string) string {
	if value == "liveShare" {
		return "liveShare"
	}
	return "liveMatch"
}

func sessionType(state SessionState) string {
	return normalizeSessionType(state.Session.Type)
}

func isLiveShare(state SessionState) bool {
	return sessionType(state) == "liveShare"
}

func normalizeLiveShareState(state *SessionState) {
	state.Session.Type = sessionType(*state)
	if state.LiveShare.CourtHours == nil {
		state.LiveShare.CourtHours = map[string][]int{}
	}
	if state.LiveShare.PlayerHours == nil {
		state.LiveShare.PlayerHours = map[string][]int{}
	}
	if state.LiveShare.ShuttleHours == nil {
		state.LiveShare.ShuttleHours = map[string]int{}
	}
	if isLiveShare(*state) {
		state.Settings.StartMatchWithShuttle = false
	}
}

func normalizedHourSet(hours []int) []int {
	seen := map[int]bool{}
	out := []int{}
	for _, hour := range hours {
		if hour < 1 || seen[hour] {
			continue
		}
		seen[hour] = true
		out = append(out, hour)
	}
	slices.Sort(out)
	return out
}

func applySessionValidity(state *SessionState, createdAt time.Time) {
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	expiresAt := createdAt.Add(72 * time.Hour)
	state.Session.CreatedAt = formatBangkokTime(createdAt)
	state.Session.ExpiresAt = formatBangkokTime(expiresAt)
	applySessionReadOnly(state, createdAt)
}

func applySessionReadOnly(state *SessionState, createdAt time.Time) {
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	now := time.Now().UTC()
	readOnly := false
	reason := ""
	if now.After(createdAt.Add(72 * time.Hour)) {
		readOnly = true
		reason = "three_days"
	} else if now.After(createdAt.Add(24*time.Hour)) && activePlayersAllPaid(*state) {
		readOnly = true
		reason = "paid_complete_24h"
	}
	state.Session.ReadOnly = readOnly
	state.Session.ReadOnlyReason = reason
	state.Session.Expired = readOnly
}

func activePlayersAllPaid(state SessionState) bool {
	active := 0
	for _, player := range state.Players {
		if !player.Active {
			continue
		}
		active++
		if !player.Paid {
			return false
		}
	}
	return active > 0
}

func readOnlySessionMessage(state SessionState) string {
	if state.Session.ReadOnlyReason == "paid_complete_24h" {
		return "session นี้ชำระครบและเกิน 1 วันแล้ว เปิดดูย้อนหลังได้ แต่ต้องสร้าง session ใหม่เพื่อจัดต่อ"
	}
	return "session นี้ครบ 3 วันแล้ว เปิดดูย้อนหลังได้ แต่ต้องสร้าง session ใหม่เพื่อจัดต่อ"
}

func formatBangkokTime(value time.Time) string {
	location, err := time.LoadLocation("Asia/Bangkok")
	if err != nil {
		return value.UTC().Add(7 * time.Hour).Format("2006-01-02 15:04")
	}
	return value.In(location).Format("2006-01-02 15:04")
}

func isSessionWrite(method string) bool {
	return method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete
}

func firstLevel(state SessionState) string {
	if len(state.Settings.Levels) == 0 {
		return "middle"
	}
	return state.Settings.Levels[0]
}

func paginate[T any](items []T, r *http.Request) ([]T, int, int) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	start := (page - 1) * pageSize
	if start >= len(items) {
		return []T{}, page, pageSize
	}
	end := start + pageSize
	if end > len(items) {
		end = len(items)
	}
	return items[start:end], page, pageSize
}

func firstCourt(state SessionState) string {
	if len(state.Settings.CourtNames) == 0 {
		return "สนาม 1"
	}
	return state.Settings.CourtNames[0]
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func nowHHMM() string {
	location, err := time.LoadLocation("Asia/Bangkok")
	if err != nil {
		return time.Now().UTC().Add(7 * time.Hour).Format("15:04")
	}
	return time.Now().In(location).Format("15:04")
}

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return hex.EncodeToString(b)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := randHex(12)
		requestIP := clientIP(r)
		ctx := context.WithValue(r.Context(), requestIDContextKey, requestID)
		ctx = context.WithValue(ctx, requestIPContextKey, requestIP)
		r = r.WithContext(ctx)
		w.Header().Set("X-Request-ID", requestID)
		origin := r.Header.Get("Origin")
		allowed := origin == ""
		for _, candidate := range strings.Split(os.Getenv("APP_ALLOWED_ORIGINS")+","+os.Getenv("APP_BASE_URL"), ",") {
			if strings.TrimSpace(candidate) != "" && strings.EqualFold(strings.TrimRight(origin, "/"), strings.TrimRight(strings.TrimSpace(candidate), "/")) {
				allowed = true
				break
			}
		}
		if !allowed {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin not allowed"})
			return
		}
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-Backoffice-Username, X-Backoffice-Password")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com")
		if strings.HasPrefix(strings.ToLower(os.Getenv("APP_BASE_URL")), "https://") {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		csrfCookie, csrfErr := r.Cookie("livematch_csrf")
		csrfToken := ""
		if csrfErr == nil {
			csrfToken = csrfCookie.Value
		}
		if csrfToken == "" {
			csrfToken = randHex(24)
			secure := r.TLS != nil || strings.EqualFold(os.Getenv("COOKIE_SECURE"), "true")
			http.SetCookie(w, &http.Cookie{Name: "livematch_csrf", Value: csrfToken, Path: "/", Secure: secure, SameSite: http.SameSiteStrictMode, MaxAge: int((7 * 24 * time.Hour).Seconds())})
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		unsafe := r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch || r.Method == http.MethodDelete
		_, hasAdminSession := r.Cookie(adminCookieName)
		_, hasPublicSession := r.Cookie(publicCookieName)
		if unsafe && (hasAdminSession == nil || hasPublicSession == nil) && r.Header.Get("X-CSRF-Token") != csrfToken {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "invalid csrf token"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("write json: %v", err)
	}
}
