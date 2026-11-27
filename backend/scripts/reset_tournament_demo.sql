\set ON_ERROR_STOP on

begin;

select set_config('app.seed_admin_id', :'admin_id', false);
select set_config('app.seed_verify_hash', :'verify_hash', false);

-- Keep only reusable infrastructure values before clearing the Tournament domain.
create temporary table _demo_template on commit drop as
select settings, public_token_hash, public_token
from tournaments
where admin_id = :'admin_id'
  and archived_at is null
order by updated_at desc
limit 1;

-- A tournament owns all entries, matches, payments, officials, files, revisions,
-- events and audit rows through ON DELETE CASCADE.
delete from tournament_refunds
where payment_id in (select id from tournament_payments where admin_id = :'admin_id');
delete from tournaments where admin_id = :'admin_id';
delete from tournament_people where admin_id = :'admin_id';
delete from tournament_files where admin_id = :'admin_id';
delete from payment_evidence_fingerprints
where admin_id = :'admin_id' and lower(source_system) = 'tournament';

insert into tournaments (
  id, admin_id, name, status, description, organizer, venue,
  start_at, end_at, timezone, public_token_hash, public_token,
  max_participants, pricing_free_snapshot, pricing_per_participant_snapshot,
  charged_coin, settings, version, created_by, created_at, updated_at
)
select
  'demo-flow-2026', :'admin_id',
  'Demo Flow Tournament 2026', 'กำลังแข่งขัน',
  'รายการตัวอย่างสำหรับไล่ทดสอบทีละขั้น: สมัคร อนุมัติ จัดกลุ่ม แข่งวน ตารางคะแนน และ Knockout',
  'LiveMatch Demo Organizer', 'สนามแบดมินตัน LiveMatch Arena',
  '2026-12-05 08:00:00+07', '2026-12-06 20:00:00+07', 'Asia/Bangkok',
  public_token_hash, public_token, 64,
  coalesce((select value::int from system_settings where key='tournamentFreeParticipants'),20),
  coalesce((select value::int from system_settings where key='tournamentCoinPerParticipant'),10),
  0,
  (settings || jsonb_build_object(
    'id', 'demo-flow-2026',
    'name', 'Demo Flow Tournament 2026',
    'description', 'รายการตัวอย่างสำหรับไล่ทดสอบทีละขั้น: สมัคร อนุมัติ จัดกลุ่ม แข่งวน ตารางคะแนน และ Knockout',
    'organizer', 'LiveMatch Demo Organizer',
    'contact', '081-234-5678',
    'venue', 'สนามแบดมินตัน LiveMatch Arena',
    'startDate', '2026-12-05', 'endDate', '2026-12-06',
    'startTime', '08:00', 'endTime', '20:00', 'timezone', 'Asia/Bangkok',
    'year', 2026, 'status', 'กำลังแข่งขัน',
    'drawSystem', 'group_then_knockout', 'teamsPerGroup', 4,
    'qualifiersPerGroup', 2, 'separateSameClub', false,
    'separateSeeds', false, 'bracketLocked', false, 'bracketVersion', 1,
    'maxParticipants', 64, 'emergencyPaused', false,
    'tieBreakOrder', jsonb_build_array('matches_won','head_to_head','set_diff','point_diff','points_for','coin_toss'),
    'scoringRules', jsonb_build_object(
      'bestOfSets', 2, 'pointsPerSet', 21, 'settingEnabled', true,
      'winByTwo', true, 'maxCapPoint', 30, 'changeEndsInDecidingSetAt', 11,
      'intervalAt', 11, 'timeoutPerMatch', 1, 'goldenPoint', false
    ),
    'registrationConfig', jsonb_build_object(
      'isOpen', true, 'openAt', '2026-11-01T00:00:00+07:00',
      'closeAt', '2026-12-01T23:59:59+07:00', 'enableWaitingList', true,
      'autoApprove', false, 'checkInMinutesBefore', 60,
      'allowEditUntil', '2026-12-03T23:59:59+07:00', 'allowPartnerChange', true,
      'pdpaConsentText', 'ยินยอมให้ใช้ข้อมูลเพื่อดำเนินการแข่งขันและประกาศผลตามวัตถุประสงค์ของรายการ',
      'refundPolicyText', 'คืนเงินตามเงื่อนไขที่ผู้จัดประกาศ'
    ),
    'divisions', jsonb_build_array(
      jsonb_build_object(
        'id', 'demo-open-doubles', 'code', 'DEMO-OD',
        'nameTh', 'Demo Open คู่', 'nameEn', 'Demo Open Doubles',
        'color', '#156143', 'enabled', true, 'gender', 'open',
        'formats', jsonb_build_array('doubles'), 'playersPerTeam', 2,
        'quotaDoubles', 24, 'quotaSingles', 0, 'minTeamsToOpen', 4,
        'minAge', 15, 'maxEventsPerPlayer', 1, 'preventDuplicatePartner', true,
        'entryFeeDoubles', 500, 'entryFeeSingles', 0
      ),
      jsonb_build_object(
        'id', 'demo-light-mixed', 'code', 'DEMO-LXD',
        'nameTh', 'Demo มือเบา คู่ผสม', 'nameEn', 'Demo Light Mixed Doubles',
        'color', '#0E7490', 'enabled', true, 'gender', 'mixed',
        'formats', jsonb_build_array('doubles'), 'playersPerTeam', 2,
        'quotaDoubles', 12, 'quotaSingles', 0, 'minTeamsToOpen', 4,
        'minAge', 15, 'maxEventsPerPlayer', 1, 'preventDuplicatePartner', true,
        'entryFeeDoubles', 450, 'entryFeeSingles', 0
      )
    ),
    'courts', jsonb_build_array(
      jsonb_build_object('id','demo-court-1','name','สนาม 1','openTime','08:00','closeTime','20:00','avgMatchMinutes',35,'bufferMinutes',5,'minRestMinutes',30,'status','available'),
      jsonb_build_object('id','demo-court-2','name','สนาม 2','openTime','08:00','closeTime','20:00','avgMatchMinutes',35,'bufferMinutes',5,'minRestMinutes',30,'status','available'),
      jsonb_build_object('id','demo-court-3','name','สนาม 3','openTime','08:00','closeTime','20:00','avgMatchMinutes',35,'bufferMinutes',5,'minRestMinutes',30,'status','available'),
      jsonb_build_object('id','demo-court-4','name','สนาม 4','openTime','08:00','closeTime','20:00','avgMatchMinutes',35,'bufferMinutes',5,'minRestMinutes',30,'status','available')
    ),
    'publicViewConfig', jsonb_build_object(
      'enabled',true,'showResults',true,'showLiveScore',true,'nextMatchesCount',8,
      'showUmpireName',true,'showSponsors',false,'autoRefreshSec',5,'hidePersonalData',true
    )
  )),
  1, 'demo-seed', now(), now()
from _demo_template;

do $$
begin
  if not exists (select 1 from tournaments where id = 'demo-flow-2026') then
    raise exception 'No active Tournament template was available for the demo public token';
  end if;
end $$;

insert into tournament_divisions
  (id,tournament_id,admin_id,code,name_th,name_en,format,quota,players_per_team,sort_order,settings)
values
  ('demo-open-doubles','demo-flow-2026',:'admin_id','DEMO-OD','Demo Open คู่','Demo Open Doubles','doubles',24,2,1,
   '{"enabled":true,"gender":"open","color":"#156143"}'::jsonb),
  ('demo-light-mixed','demo-flow-2026',:'admin_id','DEMO-LXD','Demo มือเบา คู่ผสม','Demo Light Mixed Doubles','doubles',12,2,2,
   '{"enabled":true,"gender":"mixed","color":"#0E7490"}'::jsonb);

insert into tournament_courts (id,tournament_id,admin_id,name,sort_order,settings)
select 'demo-court-'||n, 'demo-flow-2026', :'admin_id', 'สนาม '||n, n,
       jsonb_build_object('openTime','08:00','closeTime','20:00','status','available')
from generate_series(1,4) n;

-- 16 eligible teams, two approval/payment examples, and one waiting-list team.
do $$
declare
  i int;
  slot int;
  entry_id text;
  person_id text;
  group_code text;
  doc_status text;
  pay_status text;
  source_kind text;
  wait_flag boolean;
  wait_pos int;
  team_name text;
  first_names text[] := array['กิตติ','ภาณุ','วรพล','อาทิตย์','ธนกร','ณัฐวุฒิ','ปกรณ์','ศุภชัย','ธีรภัทร','จักริน','พงศกร','ชยพล','นรินทร์','วชิรวิทย์','ภูวดล','ฐิติพงศ์','สิรวิชญ์','รัชพล','ชาญชัย','อนุชา'];
  last_names text[] := array['ใจดี','แสงทอง','ศรีสุข','มั่นคง','ทองแท้','วงศ์ชัย','แก้วคำ','บุญมี','อินทร์แก้ว','ยอดดี','คงมั่น','พรหมมา','สุวรรณ','ไชยวงศ์','คำปัน','รุ่งเรือง','เมืองแพร่','สุขใจ','ชนะดี','ว่องไว'];
begin
  for i in 1..19 loop
    entry_id := 'demo-entry-'||lpad(i::text,2,'0');
    team_name := 'ทีมเดโม '||lpad(i::text,2,'0');
    group_code := case when i <= 16 then chr(65 + ((i-1)/4)) else '' end;
    doc_status := case when i = 17 then 'pending' else 'approved' end;
    pay_status := case when i <= 16 then 'paid' when i = 18 then 'pending_verify' else 'unpaid' end;
    source_kind := case when i in (17,19) then 'online' else 'staff' end;
    wait_flag := i = 19;
    wait_pos := case when i = 19 then 1 else null end;

    insert into tournament_entries (
      id,tournament_id,admin_id,division_id,registration_code,verification_code_hash,
      team_name,format,source,document_status,payment_status,checked_in,
      waiting_list,waiting_position,group_name,amount_due_satang,amount_paid_satang,payload,version,created_at,updated_at
    ) values (
      entry_id,'demo-flow-2026',current_setting('app.seed_admin_id'),'demo-open-doubles','DM'||lpad(i::text,6,'0'),current_setting('app.seed_verify_hash'),
      team_name,'doubles',source_kind,doc_status,pay_status,i <= 8,
      wait_flag,wait_pos,group_code,50000,case when i <= 16 then 50000 else 0 end,
      jsonb_build_object(
        'id',entry_id,'registrationCode','DM'||lpad(i::text,6,'0'),'verificationCodeLast4','3456',
        'tournamentId','demo-flow-2026','teamName',team_name,
        'firstName',first_names[((i-1)%20)+1],'lastName',last_names[((i-1)%20)+1],
        'nickname','ผู้เล่น '||i||'A','gender',case when i%2=0 then 'F' else 'M' end,
        'birthDate','1995-01-01','age',31,'nationality','ไทย','address','จังหวัดแพร่',
        'phone','080000'||lpad((i*2-1)::text,4,'0'),'email','demo'||i||'a@example.com',
        'club','ชมรมเดโม '||(((i-1)%6)+1),'province','แพร่','divisionId','demo-open-doubles','format','doubles',
        'partnerFirstName',first_names[(i%20)+1],'partnerLastName',last_names[(i%20)+1],
        'partnerNickname','ผู้เล่น '||i||'B','partnerPhone','080000'||lpad((i*2)::text,4,'0'),
        'partnerEmail','demo'||i||'b@example.com','partnerClub','ชมรมเดโม '||(((i-1)%6)+1),'partnerProvince','แพร่',
        'members',jsonb_build_array(
          jsonb_build_object('role','primary','firstName',first_names[((i-1)%20)+1],'lastName',last_names[((i-1)%20)+1],'nickname','ผู้เล่น '||i||'A','gender',case when i%2=0 then 'F' else 'M' end,'birthDate','1995-01-01','nationality','ไทย','address','จังหวัดแพร่','phone','080000'||lpad((i*2-1)::text,4,'0'),'email','demo'||i||'a@example.com','club','ชมรมเดโม '||(((i-1)%6)+1),'province','แพร่','shirtSize','L','emergencyContact','0899999999','healthInfo','','healthConsent',true,'pdpaConsent',true),
          jsonb_build_object('role','partner','firstName',first_names[(i%20)+1],'lastName',last_names[(i%20)+1],'nickname','ผู้เล่น '||i||'B','gender',case when i%2=0 then 'M' else 'F' end,'birthDate','1996-02-02','nationality','ไทย','address','จังหวัดแพร่','phone','080000'||lpad((i*2)::text,4,'0'),'email','demo'||i||'b@example.com','club','ชมรมเดโม '||(((i-1)%6)+1),'province','แพร่','shirtSize','M','emergencyContact','0899999999','healthInfo','','healthConsent',true,'pdpaConsent',true)
        ),
        'shirtSize','L','emergencyContact','0899999999','healthInfo','','healthConsent',true,'pdpaConsent',true,
        'documentStatus',doc_status,'paymentStatus',pay_status,'slipStatus',case when i=18 then 'pending' when i<=16 then 'approved' else 'not_uploaded' end,
        'paymentChannel',case when i<=16 then 'PromptPay' else null end,
        'amountPaid',case when i<=16 then 500 else 0 end,'amountDue',case when i<=16 then 0 else 500 end,
        'checkedIn',i<=8,'checkInTime',case when i<=8 then '2026-12-05T07:30:00+07:00' else null end,
        'waitingList',wait_flag,'waitingPosition',wait_pos,'withdrawn',false,'noShow',false,
        'groupName',group_code,'registeredAt','2026-11-'||lpad((5+i)::text,2,'0')||'T10:00:00+07:00',
        'registrationSource',source_kind,'notes',case when i=17 then 'รออนุมัติการสมัคร' when i=18 then 'อนุมัติแล้ว รอตรวจชำระเงิน' when i=19 then 'ตัวอย่าง Waiting List' else 'พร้อมเข้าสายการแข่งขัน' end
      ),
      1, now() - ((20-i)||' hours')::interval, now()
    );

    for slot in 1..2 loop
      person_id := 'demo-person-'||lpad(i::text,2,'0')||'-'||slot;
      insert into tournament_people (
        id,admin_id,first_name,last_name,nickname,gender,birth_date,phone,email,club,province,
        pdpa_consent,created_at,updated_at,payload
      ) values (
        person_id,current_setting('app.seed_admin_id'),
        case when slot=1 then first_names[((i-1)%20)+1] else first_names[(i%20)+1] end,
        case when slot=1 then last_names[((i-1)%20)+1] else last_names[(i%20)+1] end,
        'ผู้เล่น '||i||case when slot=1 then 'A' else 'B' end,
        case when (i+slot)%2=0 then 'M' else 'F' end,'1995-01-01',
        '080000'||lpad((i*2-2+slot)::text,4,'0'),'demo'||i||case when slot=1 then 'a' else 'b' end||'@example.com',
        'ชมรมเดโม '||(((i-1)%6)+1),'แพร่',true,now(),now(),
        jsonb_build_object('address','จังหวัดแพร่','emergencyContact','0899999999','healthConsent',true,'pdpaConsent',true)
      );
      insert into tournament_entry_members(entry_id,person_id,slot) values(entry_id,person_id,slot);
    end loop;
  end loop;
end $$;

-- Second division: 8 approved mixed-doubles teams in two groups of four.
do $$
declare
  i int;
  slot int;
  entry_id text;
  person_id text;
  group_code text;
  team_name text;
  male_names text[] := array['ธนภัทร','กฤษฎา','ปัณณวิชญ์','เจษฎา','ภูริณัฐ','ชินวัตร','อภิรักษ์','นพดล'];
  female_names text[] := array['พิมพ์ชนก','ชลธิชา','ณิชาภัทร','สุภัสสรา','กัญญารัตน์','วรัญญา','ศิรินภา','อรปรียา'];
begin
  for i in 1..8 loop
    entry_id := 'demo-mixed-entry-'||lpad(i::text,2,'0');
    team_name := 'คู่ผสมเดโม '||lpad(i::text,2,'0');
    group_code := case when i <= 4 then 'A' else 'B' end;
    insert into tournament_entries (
      id,tournament_id,admin_id,division_id,registration_code,verification_code_hash,
      team_name,format,source,document_status,payment_status,checked_in,waiting_list,
      group_name,amount_due_satang,amount_paid_satang,payload,version,created_at,updated_at
    ) values (
      entry_id,'demo-flow-2026',current_setting('app.seed_admin_id'),'demo-light-mixed',
      'MX'||lpad(i::text,6,'0'),current_setting('app.seed_verify_hash'),team_name,'doubles','staff',
      'approved','paid',i<=4,false,group_code,45000,45000,
      jsonb_build_object(
        'id',entry_id,'registrationCode','MX'||lpad(i::text,6,'0'),'verificationCodeLast4','3456',
        'tournamentId','demo-flow-2026','teamName',team_name,
        'firstName',male_names[i],'lastName','ทีมผสม','nickname','ชาย '||i,'gender','M',
        'birthDate','1996-01-01','age',30,'nationality','ไทย','address','จังหวัดแพร่',
        'phone','082100'||lpad(i::text,4,'0'),'email','mixed'||i||'m@example.com',
        'club','ชมรมคู่ผสม '||(((i-1)%4)+1),'province','แพร่','divisionId','demo-light-mixed','format','doubles',
        'partnerFirstName',female_names[i],'partnerLastName','ทีมผสม','partnerNickname','หญิง '||i,
        'partnerPhone','082200'||lpad(i::text,4,'0'),'partnerEmail','mixed'||i||'f@example.com',
        'partnerClub','ชมรมคู่ผสม '||(((i-1)%4)+1),'partnerProvince','แพร่',
        'members',jsonb_build_array(
          jsonb_build_object('role','primary','firstName',male_names[i],'lastName','ทีมผสม','nickname','ชาย '||i,'gender','M','birthDate','1996-01-01','nationality','ไทย','address','จังหวัดแพร่','phone','082100'||lpad(i::text,4,'0'),'email','mixed'||i||'m@example.com','club','ชมรมคู่ผสม '||(((i-1)%4)+1),'province','แพร่','shirtSize','L','emergencyContact','0899999999','healthInfo','','healthConsent',true,'pdpaConsent',true),
          jsonb_build_object('role','partner','firstName',female_names[i],'lastName','ทีมผสม','nickname','หญิง '||i,'gender','F','birthDate','1997-02-02','nationality','ไทย','address','จังหวัดแพร่','phone','082200'||lpad(i::text,4,'0'),'email','mixed'||i||'f@example.com','club','ชมรมคู่ผสม '||(((i-1)%4)+1),'province','แพร่','shirtSize','M','emergencyContact','0899999999','healthInfo','','healthConsent',true,'pdpaConsent',true)
        ),
        'shirtSize','L','emergencyContact','0899999999','healthInfo','','healthConsent',true,'pdpaConsent',true,
        'documentStatus','approved','paymentStatus','paid','slipStatus','approved','paymentChannel','PromptPay',
        'amountPaid',450,'amountDue',0,'checkedIn',i<=4,
        'checkInTime',case when i<=4 then '2026-12-05T07:45:00+07:00' else null end,
        'waitingList',false,'withdrawn',false,'noShow',false,'groupName',group_code,
        'registeredAt','2026-11-'||lpad((10+i)::text,2,'0')||'T11:00:00+07:00',
        'registrationSource','staff','notes','พร้อมแข่งขันคู่มือ Demo มือเบา คู่ผสม'
      ),1,now()-((10-i)||' hours')::interval,now()
    );
    for slot in 1..2 loop
      person_id := 'demo-mixed-person-'||lpad(i::text,2,'0')||'-'||slot;
      insert into tournament_people (
        id,admin_id,first_name,last_name,nickname,gender,birth_date,phone,email,club,province,
        pdpa_consent,created_at,updated_at,payload
      ) values (
        person_id,current_setting('app.seed_admin_id'),
        case when slot=1 then male_names[i] else female_names[i] end,'ทีมผสม',
        case when slot=1 then 'ชาย '||i else 'หญิง '||i end,case when slot=1 then 'M' else 'F' end,
        case when slot=1 then '1996-01-01'::date else '1997-02-02'::date end,
        case when slot=1 then '082100'||lpad(i::text,4,'0') else '082200'||lpad(i::text,4,'0') end,
        'mixed'||i||case when slot=1 then 'm' else 'f' end||'@example.com',
        'ชมรมคู่ผสม '||(((i-1)%4)+1),'แพร่',true,now(),now(),
        jsonb_build_object('address','จังหวัดแพร่','emergencyContact','0899999999','healthConsent',true,'pdpaConsent',true)
      );
      insert into tournament_entry_members(entry_id,person_id,slot) values(entry_id,person_id,slot);
    end loop;
  end loop;
end $$;

insert into tournament_payments
  (id,entry_id,tournament_id,admin_id,amount_satang,method,status,provider,reference_number,verification,received_by,created_at,updated_at)
select 'demo-payment-'||lpad(i::text,2,'0'), 'demo-entry-'||lpad(i::text,2,'0'),
       'demo-flow-2026', :'admin_id', 50000, 'PromptPay', 'paid', 'manual',
       'DEMO-PAY-'||lpad(i::text,4,'0'), '{"verified":true,"source":"demo"}'::jsonb,
       'demo-seed', now(), now()
from generate_series(1,16) i;

insert into tournament_payments
  (id,entry_id,tournament_id,admin_id,amount_satang,method,status,provider,reference_number,verification,received_by,created_at,updated_at)
select 'demo-mixed-payment-'||lpad(i::text,2,'0'), 'demo-mixed-entry-'||lpad(i::text,2,'0'),
       'demo-flow-2026', :'admin_id', 45000, 'PromptPay', 'paid', 'manual',
       'DEMO-MIX-PAY-'||lpad(i::text,4,'0'), '{"verified":true,"source":"demo"}'::jsonb,
       'demo-seed', now(), now()
from generate_series(1,8) i;

-- Four approved officials. Their login codes are intentionally documented demo codes.
insert into tournament_officials
  (id,tournament_id,admin_id,code,first_name,last_name,nickname,phone,email,
   login_code_hash,login_code_last4,code_expires_at,active,approval_status,payload,created_at,updated_at)
values
  ('demo-official-1','demo-flow-2026',:'admin_id','UMP-01','สมเกียรติ','สุริยะวงศ์','อ.เกียรติ','0811110001','umpire1@example.com',:'official_hash_1','0001','2027-12-31 23:59:59+07',true,'approved',jsonb_build_object('id','demo-official-1','code','UMP-01','tournamentId','demo-flow-2026','firstName','สมเกียรติ','lastName','สุริยะวงศ์','nickname','อ.เกียรติ','phone','0811110001','email','umpire1@example.com','certification','กรรมการสมาคมฯ ระดับ 2','capableDivisions',jsonb_build_array(),'loginCode12','900000000001','loginCodeLast4','0001','codeExpiresAt','2027-12-31T23:59:59+07:00','active',true,'assignedMatches',0,'completedMatches',0,'hoursWorked',0,'approvalStatus','approved','applicationSource','staff','pdpaConsent',true,'history',jsonb_build_array()),now(),now()),
  ('demo-official-2','demo-flow-2026',:'admin_id','UMP-02','วรรณา','พิทักษ์พงศ์','ครูวรรณ','0811110002','umpire2@example.com',:'official_hash_2','0002','2027-12-31 23:59:59+07',true,'approved',jsonb_build_object('id','demo-official-2','code','UMP-02','tournamentId','demo-flow-2026','firstName','วรรณา','lastName','พิทักษ์พงศ์','nickname','ครูวรรณ','phone','0811110002','email','umpire2@example.com','certification','กรรมการสมาคมฯ ระดับ 1','capableDivisions',jsonb_build_array(),'loginCode12','900000000002','loginCodeLast4','0002','codeExpiresAt','2027-12-31T23:59:59+07:00','active',true,'assignedMatches',0,'completedMatches',0,'hoursWorked',0,'approvalStatus','approved','applicationSource','staff','pdpaConsent',true,'history',jsonb_build_array()),now(),now()),
  ('demo-official-3','demo-flow-2026',:'admin_id','UMP-03','ประสิทธิ์','มหาชัย','สิทธิ์','0811110003','umpire3@example.com',:'official_hash_3','0003','2027-12-31 23:59:59+07',true,'approved',jsonb_build_object('id','demo-official-3','code','UMP-03','tournamentId','demo-flow-2026','firstName','ประสิทธิ์','lastName','มหาชัย','nickname','สิทธิ์','phone','0811110003','email','umpire3@example.com','certification','กรรมการภูมิภาค','capableDivisions',jsonb_build_array(),'loginCode12','900000000003','loginCodeLast4','0003','codeExpiresAt','2027-12-31T23:59:59+07:00','active',true,'assignedMatches',0,'completedMatches',0,'hoursWorked',0,'approvalStatus','approved','applicationSource','staff','pdpaConsent',true,'history',jsonb_build_array()),now(),now()),
  ('demo-official-4','demo-flow-2026',:'admin_id','UMP-04','กมลชนก','อินทร์แก้ว','นก','0811110004','umpire4@example.com',:'official_hash_4','0004','2027-12-31 23:59:59+07',true,'approved',jsonb_build_object('id','demo-official-4','code','UMP-04','tournamentId','demo-flow-2026','firstName','กมลชนก','lastName','อินทร์แก้ว','nickname','นก','phone','0811110004','email','umpire4@example.com','certification','กรรมการฝึกหัด','capableDivisions',jsonb_build_array(),'loginCode12','900000000004','loginCodeLast4','0004','codeExpiresAt','2027-12-31T23:59:59+07:00','active',true,'assignedMatches',0,'completedMatches',0,'hoursWorked',0,'approvalStatus','approved','applicationSource','staff','pdpaConsent',true,'history',jsonb_build_array()),now(),now());

-- Four groups of four: 6 round-robin matches per group, 24 matches total.
-- A is complete, B is in progress, C has started, D has not started.
do $$
declare
  g int;
  p int;
  seq int := 0;
  local_seq int;
  team_numbers int[][] := array[[1,2],[1,3],[1,4],[2,3],[2,4],[3,4]];
  team_a_num int;
  team_b_num int;
  team_a_id text;
  team_b_id text;
  team_a_name text;
  team_b_name text;
  group_code text;
  match_id text;
  match_code text;
  match_status text;
  match_winner text;
  sets jsonb;
  official_no int;
  official_id text;
  official_name text;
  start_at text;
begin
  for g in 0..3 loop
    group_code := chr(65+g);
    for p in 1..6 loop
      seq := seq + 1;
      local_seq := p;
      team_a_num := g*4 + team_numbers[p][1];
      team_b_num := g*4 + team_numbers[p][2];
      team_a_id := 'demo-entry-'||lpad(team_a_num::text,2,'0');
      team_b_id := 'demo-entry-'||lpad(team_b_num::text,2,'0');
      team_a_name := 'ทีมเดโม '||lpad(team_a_num::text,2,'0');
      team_b_name := 'ทีมเดโม '||lpad(team_b_num::text,2,'0');
      match_id := 'demo-match-'||lpad(seq::text,2,'0');
      match_code := 'DEMO-'||group_code||local_seq;
      match_status := case
        when g=0 then 'finished'
        when g=1 and p<=4 then 'finished'
        when g=1 and p=5 then 'live'
        when g=2 and p<=2 then 'finished'
        else 'scheduled' end;
      match_winner := case when match_status='finished' then
        case when seq%3=1 then 'A' when seq%3=2 then 'draw' else 'B' end
        else null end;
      sets := case
        when match_status='finished' and match_winner='A' then '[{"setNumber":1,"scoreA":21,"scoreB":15,"winner":"A"},{"setNumber":2,"scoreA":21,"scoreB":18,"winner":"A"}]'::jsonb
        when match_status='finished' and match_winner='B' then '[{"setNumber":1,"scoreA":14,"scoreB":21,"winner":"B"},{"setNumber":2,"scoreA":17,"scoreB":21,"winner":"B"}]'::jsonb
        when match_status='finished' then '[{"setNumber":1,"scoreA":21,"scoreB":17,"winner":"A"},{"setNumber":2,"scoreA":18,"scoreB":21,"winner":"B"}]'::jsonb
        when match_status='live' then '[{"setNumber":1,"scoreA":21,"scoreB":16,"winner":"A"},{"setNumber":2,"scoreA":8,"scoreB":6}]'::jsonb
        else '[]'::jsonb end;
      official_no := ((seq-1)%4)+1;
      official_id := 'demo-official-'||official_no;
      official_name := (array['สมเกียรติ สุริยะวงศ์','วรรณา พิทักษ์พงศ์','ประสิทธิ์ มหาชัย','กมลชนก อินทร์แก้ว'])[official_no];
      start_at := '2026-12-05T'||lpad((8+((seq-1)/4))::text,2,'0')||':'||case when (seq-1)%2=0 then '00' else '40' end||':00+07:00';

      insert into tournament_matches (
        id,tournament_id,admin_id,division_id,match_code,stage,status,team_a_id,team_b_id,
        court_id,official_id,payload,locked,version,started_at,ended_at,created_at,updated_at
      ) values (
        match_id,'demo-flow-2026',current_setting('app.seed_admin_id'),'demo-open-doubles',match_code,'group',match_status,
        team_a_id,team_b_id,'demo-court-'||(((seq-1)%4)+1),official_id,
        jsonb_build_object(
          'id',match_id,'tournamentId','demo-flow-2026','matchCode',match_code,
          'divisionId','demo-open-doubles','format','doubles','stage','group','groupName',group_code,
          'courtId','demo-court-'||(((seq-1)%4)+1),'scheduledDate','2026-12-05',
          'scheduledTime',substring(start_at from 12 for 5),'estimatedStart',substring(start_at from 12 for 5),
          'actualStart',case when match_status in ('live','finished') then start_at else null end,
          'actualEnd',case when match_status='finished' then (start_at::timestamptz+interval '30 minutes')::text else null end,
          'teamAId',team_a_id,'teamAName',team_a_name,'teamAClub','ชมรมเดโม '||(((team_a_num-1)%6)+1),
          'teamAPlayers',jsonb_build_array('ผู้เล่น '||team_a_num||'A','ผู้เล่น '||team_a_num||'B'),
          'teamBId',team_b_id,'teamBName',team_b_name,'teamBClub','ชมรมเดโม '||(((team_b_num-1)%6)+1),
          'teamBPlayers',jsonb_build_array('ผู้เล่น '||team_b_num||'A','ผู้เล่น '||team_b_num||'B'),
          'umpireId',official_id,'umpireName',official_name,'status',match_status,'callCount',case when match_status='scheduled' then 0 else 1 end,
          'currentSet',case when match_status='live' then 2 when match_status='finished' then 2 else 1 end,
          'sets',sets,'servingTeam','A','servingPlayerIndex',0,
          'courtPositions',jsonb_build_object('A',jsonb_build_array(0,1),'B',jsonb_build_array(0,1)),
          'manualServerSwaps','{}'::jsonb,'endsSwapped',match_status in ('live','finished'),
          'winner',match_winner,'locked',match_status='finished',
          'umpireConfirmedAt',case when match_status='finished' then (start_at::timestamptz+interval '31 minutes')::text else null end,
          'umpireNote',case when match_status='finished' then 'ยืนยันผลการแข่งขันตัวอย่างแล้ว' else null end,
          'cards','[]'::jsonb,'timeoutsUsed',jsonb_build_object('A',0,'B',0),'shuttlesUsed',case when match_status='finished' then 2 else 0 end,
          'timeline',case when match_status='finished' then jsonb_build_array(jsonb_build_object('id','demo-event-'||seq,'timestamp',(start_at::timestamptz+interval '30 minutes')::text,'setNumber',2,'type','end_match','scoreSnapshot',case when match_winner='draw' then '21-17, 18-21' when match_winner='A' then '21-15, 21-18' else '14-21, 17-21' end,'actor',official_name,'detail',case when match_winner='draw' then 'ผลการแข่งขันเสมอ 1-1 เซต' else 'ยืนยันผลการแข่งขัน' end)) else '[]'::jsonb end,
          'version',1
        ),
        match_status='finished',1,
        case when match_status in ('live','finished') then start_at::timestamptz else null end,
        case when match_status='finished' then start_at::timestamptz+interval '30 minutes' else null end,
        now()+seq*interval '1 second',now()
      );
    end loop;
  end loop;
end $$;

-- Two groups of four for the mixed-doubles division, all ready to start.
do $$
declare
  g int;
  p int;
  seq int := 0;
  team_numbers int[][] := array[[1,2],[1,3],[1,4],[2,3],[2,4],[3,4]];
  team_a_num int;
  team_b_num int;
  group_code text;
  match_id text;
  official_no int;
  official_id text;
  official_name text;
  start_at text;
  male_names text[] := array['ธนภัทร','กฤษฎา','ปัณณวิชญ์','เจษฎา','ภูริณัฐ','ชินวัตร','อภิรักษ์','นพดล'];
  female_names text[] := array['พิมพ์ชนก','ชลธิชา','ณิชาภัทร','สุภัสสรา','กัญญารัตน์','วรัญญา','ศิรินภา','อรปรียา'];
begin
  for g in 0..1 loop
    group_code := chr(65+g);
    for p in 1..6 loop
      seq := seq+1;
      team_a_num := g*4+team_numbers[p][1];
      team_b_num := g*4+team_numbers[p][2];
      match_id := 'demo-mixed-match-'||lpad(seq::text,2,'0');
      official_no := ((seq-1)%4)+1;
      official_id := 'demo-official-'||official_no;
      official_name := (array['สมเกียรติ สุริยะวงศ์','วรรณา พิทักษ์พงศ์','ประสิทธิ์ มหาชัย','กมลชนก อินทร์แก้ว'])[official_no];
      start_at := '2026-12-06T'||lpad((8+((seq-1)/4))::text,2,'0')||':'||case when (seq-1)%2=0 then '00' else '40' end||':00+07:00';
      insert into tournament_matches (
        id,tournament_id,admin_id,division_id,match_code,stage,status,team_a_id,team_b_id,
        court_id,official_id,payload,locked,version,created_at,updated_at
      ) values (
        match_id,'demo-flow-2026',current_setting('app.seed_admin_id'),'demo-light-mixed',
        'MIX-'||group_code||p,'group','scheduled',
        'demo-mixed-entry-'||lpad(team_a_num::text,2,'0'),'demo-mixed-entry-'||lpad(team_b_num::text,2,'0'),
        'demo-court-'||(((seq-1)%4)+1),official_id,
        jsonb_build_object(
          'id',match_id,'tournamentId','demo-flow-2026','matchCode','MIX-'||group_code||p,
          'divisionId','demo-light-mixed','format','doubles','stage','group','groupName',group_code,
          'courtId','demo-court-'||(((seq-1)%4)+1),'scheduledDate','2026-12-06',
          'scheduledTime',substring(start_at from 12 for 5),'estimatedStart',substring(start_at from 12 for 5),
          'teamAId','demo-mixed-entry-'||lpad(team_a_num::text,2,'0'),'teamAName','คู่ผสมเดโม '||lpad(team_a_num::text,2,'0'),
          'teamAClub','ชมรมคู่ผสม '||(((team_a_num-1)%4)+1),
          'teamAPlayers',jsonb_build_array(male_names[team_a_num]||' ทีมผสม',female_names[team_a_num]||' ทีมผสม'),
          'teamBId','demo-mixed-entry-'||lpad(team_b_num::text,2,'0'),'teamBName','คู่ผสมเดโม '||lpad(team_b_num::text,2,'0'),
          'teamBClub','ชมรมคู่ผสม '||(((team_b_num-1)%4)+1),
          'teamBPlayers',jsonb_build_array(male_names[team_b_num]||' ทีมผสม',female_names[team_b_num]||' ทีมผสม'),
          'umpireId',official_id,'umpireName',official_name,'status','scheduled','callCount',0,
          'currentSet',1,'sets','[]'::jsonb,'servingTeam','A','servingPlayerIndex',0,
          'courtPositions',jsonb_build_object('A',jsonb_build_array(0,1),'B',jsonb_build_array(0,1)),
          'manualServerSwaps','{}'::jsonb,'endsSwapped',false,'locked',false,
          'cards','[]'::jsonb,'timeoutsUsed',jsonb_build_object('A',0,'B',0),'shuttlesUsed',0,
          'timeline','[]'::jsonb,'version',1
        ),false,1,now()+seq*interval '1 second',now()
      );
    end loop;
  end loop;
end $$;

insert into tournament_draw_revisions
  (tournament_id,admin_id,division_id,version,random_seed,snapshot,locked,created_by,created_at,published_at)
select 'demo-flow-2026', :'admin_id', 'demo-open-doubles', 1, 'DEMO-FLOW-2026',
       jsonb_build_object(
         'version',1,'createdAt',now()::text,'createdBy','Demo Seed','divisionId','demo-open-doubles',
         'format','doubles','summary','4 กลุ่ม × 4 ทีม / แข่งพบกันหมด / เข้ารอบกลุ่มละ 2 ทีม',
         'locked',false,'randomSeed','DEMO-FLOW-2026',
         'matches',(select jsonb_agg(payload order by match_code) from tournament_matches where tournament_id='demo-flow-2026' and division_id='demo-open-doubles')
       ),
       false,'demo-seed',now(),now();

insert into tournament_draw_revisions
  (tournament_id,admin_id,division_id,version,random_seed,snapshot,locked,created_by,created_at,published_at)
select 'demo-flow-2026', :'admin_id', 'demo-light-mixed', 1, 'DEMO-MIXED-2026',
       jsonb_build_object(
         'version',1,'createdAt',now()::text,'createdBy','Demo Seed','divisionId','demo-light-mixed',
         'format','doubles','summary','2 กลุ่ม × 4 ทีม / แข่งพบกันหมด / เข้ารอบกลุ่มละ 2 ทีม',
         'locked',false,'randomSeed','DEMO-MIXED-2026',
         'matches',(select jsonb_agg(payload order by match_code) from tournament_matches where tournament_id='demo-flow-2026' and division_id='demo-light-mixed')
       ),
       false,'demo-seed',now(),now();

insert into tournament_audit_logs
  (admin_id,tournament_id,actor_type,actor_id,actor_name,action,target_type,target_id,reason,details,created_at)
values
  (:'admin_id','demo-flow-2026','system','demo-seed','Demo Seed','RESET_AND_SEED','tournament','demo-flow-2026','สร้างข้อมูลตัวอย่างตามคำขอ',jsonb_build_object('divisions',2,'entries',27,'matches',36,'groups',6),now());

insert into tournament_realtime_events(admin_id,tournament_id,match_id,event_type,payload,created_at)
values (:'admin_id','demo-flow-2026','','state_updated',jsonb_build_object('tournamentId','demo-flow-2026','source','demo_seed'),now());

commit;

select jsonb_build_object(
  'tournaments',(select count(*) from tournaments where admin_id=:'admin_id'),
  'entries',(select count(*) from tournament_entries where admin_id=:'admin_id'),
  'eligibleEntries',(select count(*) from tournament_entries where admin_id=:'admin_id' and document_status='approved' and not waiting_list and withdrawn_at is null),
  'officials',(select count(*) from tournament_officials where admin_id=:'admin_id'),
  'matches',(select count(*) from tournament_matches where admin_id=:'admin_id'),
  'finishedMatches',(select count(*) from tournament_matches where admin_id=:'admin_id' and status='finished'),
  'liveMatches',(select count(*) from tournament_matches where admin_id=:'admin_id' and status='live'),
  'scheduledMatches',(select count(*) from tournament_matches where admin_id=:'admin_id' and status='scheduled')
);
