package main

import "context"

func (a *app) migrateTournament(ctx context.Context) error {
	_, err := a.db.ExecContext(ctx, `
		create table if not exists tournament_staff (
			id text primary key, admin_id text not null references admin_users(id) on delete cascade,
			staff_number text not null unique, name text not null, email text not null default '', phone text not null default '',
			role text not null check(role in ('tournament_admin','registration_staff','score_staff')),
			pin_hash text not null, permissions jsonb not null default '{}'::jsonb, active boolean not null default true,
			failed_login_count integer not null default 0, last_failed_login_at timestamptz, last_login_at timestamptz,
			created_at timestamptz not null default now(), updated_at timestamptz not null default now()
		);
		create index if not exists idx_tournament_staff_admin on tournament_staff(admin_id,active,created_at);
		create table if not exists tournament_staff_sessions (
			session_id text primary key, token_hash text not null unique, previous_token_hash text not null default '',
			previous_valid_until timestamptz, staff_id text not null references tournament_staff(id) on delete cascade,
			created_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
			idle_expires_at timestamptz not null, absolute_expires_at timestamptz not null, rotate_after timestamptz not null,
			expires_at timestamptz not null, revoked_at timestamptz, reuse_detected_at timestamptz, persistent boolean not null default true
		);
		create unique index if not exists idx_tournament_staff_sessions_previous on tournament_staff_sessions(previous_token_hash) where previous_token_hash<>'';

		create table if not exists tournaments (
			id text primary key, admin_id text not null references admin_users(id) on delete cascade,
			name text not null, status text not null default 'Draft', description text not null default '', organizer text not null default '',
			venue text not null default '', start_at timestamptz, end_at timestamptz, timezone text not null default 'Asia/Bangkok',
			public_token_hash text not null unique, public_token text not null default '', max_participants integer not null default 20 check(max_participants>0),
			pricing_free_snapshot integer not null default 20, pricing_per_participant_snapshot integer not null default 10,
			charged_coin integer not null default 0, settings jsonb not null default '{}'::jsonb, version bigint not null default 1,
			archived_at timestamptz, created_by text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
		);
		create index if not exists idx_tournaments_admin on tournaments(admin_id,archived_at,updated_at desc);
		create table if not exists tournament_divisions (
			id text primary key, tournament_id text not null references tournaments(id) on delete cascade, admin_id text not null references admin_users(id) on delete cascade,
			code text not null, name_th text not null, name_en text not null default '', format text not null, quota integer not null default 0,
			players_per_team integer not null default 2, sort_order integer not null default 0, settings jsonb not null default '{}'::jsonb,
			unique(tournament_id,code)
		);
		create table if not exists tournament_courts (
			id text primary key, tournament_id text not null references tournaments(id) on delete cascade, admin_id text not null references admin_users(id) on delete cascade,
			name text not null, sort_order integer not null default 0, settings jsonb not null default '{}'::jsonb
		);
		create table if not exists tournament_people (
			id text primary key, admin_id text not null references admin_users(id) on delete cascade, member_id text,
			first_name text not null, last_name text not null default '', nickname text not null default '', gender text not null default '', birth_date date,
			phone text not null default '', email text not null default '', club text not null default '', province text not null default '',
			health_ciphertext text not null default '', pdpa_consent boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
		);
		alter table tournament_people add column if not exists payload jsonb not null default '{}'::jsonb;
		create table if not exists tournament_entries (
			id text primary key, tournament_id text not null references tournaments(id) on delete cascade, admin_id text not null references admin_users(id) on delete cascade,
			division_id text references tournament_divisions(id) on delete restrict, registration_code text not null, verification_code_hash text not null,
			team_name text not null, format text not null, source text not null default 'staff', document_status text not null default 'pending',
			payment_status text not null default 'unpaid', checked_in boolean not null default false, checked_in_at timestamptz,
			waiting_list boolean not null default false, waiting_position integer, withdrawn_at timestamptz, no_show boolean not null default false,
			seed integer, group_name text not null default '', amount_due_satang bigint not null default 0, amount_paid_satang bigint not null default 0,
			payload jsonb not null default '{}'::jsonb, version bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
			unique(tournament_id,registration_code)
		);
		create index if not exists idx_tournament_entries_list on tournament_entries(tournament_id,division_id,waiting_list,created_at);
		create table if not exists tournament_entry_members (
			entry_id text not null references tournament_entries(id) on delete cascade, person_id text not null references tournament_people(id) on delete restrict,
			slot integer not null check(slot in (1,2)), primary key(entry_id,slot), unique(entry_id,person_id)
		);

		create table if not exists tournament_officials (
			id text primary key, tournament_id text not null references tournaments(id) on delete cascade, admin_id text not null references admin_users(id) on delete cascade,
			code text not null, first_name text not null, last_name text not null default '', nickname text not null default '', phone text not null default '', email text not null default '',
			login_code_hash text not null default '', login_code_last4 text not null default '', code_expires_at timestamptz,
			active boolean not null default true, approval_status text not null default 'approved', payload jsonb not null default '{}'::jsonb,
			created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(tournament_id,code)
		);
		create table if not exists tournament_director_sessions (
			session_id text primary key, token_hash text not null unique, previous_token_hash text not null default '', previous_valid_until timestamptz,
			official_id text not null references tournament_officials(id) on delete cascade, created_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
			idle_expires_at timestamptz not null, absolute_expires_at timestamptz not null, rotate_after timestamptz not null, expires_at timestamptz not null,
			revoked_at timestamptz, reuse_detected_at timestamptz, persistent boolean not null default true
		);
		create unique index if not exists idx_tournament_director_sessions_previous on tournament_director_sessions(previous_token_hash) where previous_token_hash<>'';

		create table if not exists tournament_matches (
			id text primary key, tournament_id text not null references tournaments(id) on delete cascade, admin_id text not null references admin_users(id) on delete cascade,
			division_id text references tournament_divisions(id) on delete restrict, match_code text not null, stage text not null, status text not null default 'scheduled',
			team_a_id text, team_b_id text, court_id text, official_id text, next_match_id text, next_match_slot text,
			payload jsonb not null default '{}'::jsonb, locked boolean not null default false, version bigint not null default 1,
			started_at timestamptz, ended_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(tournament_id,match_code)
		);
		create index if not exists idx_tournament_matches_status on tournament_matches(tournament_id,status,updated_at);
		create table if not exists tournament_match_events (
			id bigserial primary key, match_id text not null references tournament_matches(id) on delete cascade, tournament_id text not null references tournaments(id) on delete cascade,
			admin_id text not null references admin_users(id) on delete cascade, event_id text not null, event_type text not null, payload jsonb not null default '{}'::jsonb,
			actor_type text not null, actor_id text not null, created_at timestamptz not null default now(), unique(match_id,event_id)
		);
		create table if not exists tournament_draw_revisions (
			id bigserial primary key, tournament_id text not null references tournaments(id) on delete cascade, admin_id text not null references admin_users(id) on delete cascade,
			division_id text, version integer not null, random_seed text not null, snapshot jsonb not null, locked boolean not null default false,
			created_by text not null, created_at timestamptz not null default now(), unique(tournament_id,division_id,version)
		);
		alter table tournament_draw_revisions add column if not exists published_at timestamptz;
		alter table tournament_draw_revisions add column if not exists locked_at timestamptz;
		alter table tournament_draw_revisions add column if not exists locked_by text not null default '';
		create table if not exists tournament_draw_previews (
			id text primary key, tournament_id text not null references tournaments(id) on delete cascade,
			admin_id text not null references admin_users(id) on delete cascade, division_id text not null,
			draw_system text not null, random_seed text not null, entrants_fingerprint text not null,
			snapshot jsonb not null, created_by text not null, expires_at timestamptz not null,
			created_at timestamptz not null default now()
		);
		create index if not exists idx_tournament_draw_previews_expiry on tournament_draw_previews(expires_at);
		create table if not exists tournament_realtime_events (
			id bigserial primary key, admin_id text not null references admin_users(id) on delete cascade,
			tournament_id text not null references tournaments(id) on delete cascade, match_id text not null default '',
			event_type text not null, payload jsonb not null default '{}'::jsonb,
			created_at timestamptz not null default now()
		);
		create index if not exists idx_tournament_realtime_scope on tournament_realtime_events(admin_id,tournament_id,id);

		create table if not exists tournament_payments (
			id text primary key, entry_id text not null references tournament_entries(id) on delete cascade, tournament_id text not null references tournaments(id) on delete cascade,
			admin_id text not null references admin_users(id) on delete cascade, amount_satang bigint not null check(amount_satang>=0), method text not null default '',
			status text not null default 'pending', provider text not null default 'manual', reference_number text not null default '',
			slip_file_id text, verification jsonb not null default '{}'::jsonb, received_by text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
		);
		create table if not exists tournament_payment_attempts (
			id bigserial primary key, payment_id text not null references tournament_payments(id) on delete cascade,
			admin_id text not null references admin_users(id) on delete cascade, provider text not null, request_id text not null,
			status text not null, response_code text not null default '', response_payload jsonb not null default '{}'::jsonb,
			created_at timestamptz not null default now(), unique(payment_id,request_id)
		);
		create table if not exists tournament_refunds (
			id text primary key, payment_id text not null references tournament_payments(id) on delete restrict,
			admin_id text not null references admin_users(id) on delete cascade, amount_satang bigint not null check(amount_satang>0),
			reason text not null, status text not null default 'completed', created_by text not null, created_at timestamptz not null default now()
		);
		create table if not exists payment_evidence_fingerprints (
			fingerprint text primary key, source_system text not null, source_id text not null, admin_id text not null references admin_users(id) on delete cascade,
			created_at timestamptz not null default now()
		);
		create table if not exists tournament_files (
			id text primary key, admin_id text not null references admin_users(id) on delete cascade, tournament_id text references tournaments(id) on delete cascade,
			kind text not null, storage_key text not null, mime_type text not null, size_bytes bigint not null, sha256 text not null,
			staged boolean not null default true, expires_at timestamptz, created_at timestamptz not null default now()
		);
		create table if not exists tournament_incidents (
			id text primary key, tournament_id text not null references tournaments(id) on delete cascade, admin_id text not null references admin_users(id) on delete cascade,
			match_id text, incident_type text not null, description text not null, status text not null default 'open', reported_by text not null, created_at timestamptz not null default now(), resolved_at timestamptz
		);
		create table if not exists tournament_notifications (
			id text primary key, tournament_id text references tournaments(id) on delete cascade, admin_id text not null references admin_users(id) on delete cascade,
			channel text not null, recipient text not null, template_key text not null, payload jsonb not null default '{}'::jsonb,
			status text not null default 'pending', attempts integer not null default 0, idempotency_key text not null unique, next_attempt_at timestamptz not null default now(), created_at timestamptz not null default now()
		);
		create table if not exists tournament_audit_logs (
			id bigserial primary key, admin_id text not null references admin_users(id) on delete cascade, tournament_id text references tournaments(id) on delete cascade,
			actor_type text not null, actor_id text not null, actor_name text not null, action text not null, target_type text not null, target_id text not null,
			reason text not null default '', details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
		);
		create index if not exists idx_tournament_audit on tournament_audit_logs(admin_id,tournament_id,created_at desc);
		update tournament_officials set payload=payload-'loginCode12'-'loginCode' where payload ? 'loginCode12' or payload ? 'loginCode';

		insert into system_settings(key,value) values('tournamentFreeParticipants','20') on conflict(key) do nothing;
		insert into system_settings(key,value) values('tournamentCoinPerParticipant','10') on conflict(key) do nothing;
	`)
	return err
}
