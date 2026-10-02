-- ============================================================
-- RE:SPRINT - v30 運用のための機能（追加だけ）
--
--   (1) staff_notes        指導者どうしの申し送りメモ（選手ごと。選手の画面には出さない）
--   (2) exercise_logs      「今日やった種目」の記録（選手・種目・日付）
--   (3) 利用規約・個人情報の取り扱いへの同意
--         文面は管理者が登録する（admin_set_terms）。登録がない間は、同意の画面は出ない。
--         文面を変えると版が上がり、選手はもう一度同意する。
--   (4) リマインドの通知（プッシュ通知。v27 の仕組みを使う）
--         ・日報：毎日20時（日本時間）に、その日まだ日報のない選手へ
--         ・面談：予定の24時間前〜12時間前に1回、1時間前に1回（選手と指導者へ）
--   (5) 毎日の自動バックアップ（午前3時30分。resprint_backup に30回分）
--
--   (4)(5) は pg_cron（DB の定期実行）を使う。使えない環境では、関数だけ作って予定は入れない。
--   公開中のアプリ（v15.17）の動きは変わらない。
--   戻し方：supabase_rollback_v30.sql
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

-- ---------- (1) 申し送りメモ ----------
create table if not exists public.staff_notes (
  id bigint generated always as identity primary key,
  player_id text not null references public.players(id) on delete cascade,
  author_role text,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists staff_notes_player_idx on public.staff_notes (player_id, created_at);

-- ---------- (2) 今日やった種目 ----------
create table if not exists public.exercise_logs (
  player_id text not null references public.players(id) on delete cascade,
  exercise_id bigint not null references public.exercises(id) on delete cascade,
  done_on date not null,
  created_at timestamptz not null default now(),
  primary key (player_id, exercise_id, done_on)
);
create index if not exists exercise_logs_player_idx on public.exercise_logs (player_id, done_on);

-- 権限：ほかの表と同じく、自分の組織の選手の行だけ（v16 と同じ考え方）
do $v30rls$
declare
  t text;
begin
  foreach t in array array['staff_notes', 'exercise_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "resprint org read" on public.%I', t);
    execute format('drop policy if exists "resprint org insert" on public.%I', t);
    execute format('drop policy if exists "resprint org update" on public.%I', t);
    execute format('drop policy if exists "resprint org delete" on public.%I', t);
    execute format('create policy "resprint org read" on public.%I for select to authenticated using (public.resprint_can_access_player(player_id::text))', t);
    execute format('create policy "resprint org insert" on public.%I for insert to authenticated with check (public.resprint_can_access_player(player_id::text))', t);
    execute format('create policy "resprint org update" on public.%I for update to authenticated using (public.resprint_can_access_player(player_id::text)) with check (public.resprint_can_access_player(player_id::text))', t);
    execute format('create policy "resprint org delete" on public.%I for delete to authenticated using (public.resprint_can_access_player(player_id::text))', t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end
$v30rls$;


-- ---------- (3) 利用規約・個人情報の取り扱いへの同意 ----------
create schema if not exists resprint_private;
revoke all on schema resprint_private from public;

create table if not exists resprint_private.terms (
  version integer primary key,
  body text not null,
  created_at timestamptz not null default now()
);
create table if not exists resprint_private.terms_acceptances (
  player_id text not null references public.players(id) on delete cascade,
  version integer not null,
  user_id uuid,
  accepted_at timestamptz not null default now(),
  primary key (player_id, version)
);

-- 管理者：文面の登録（変わったときだけ版を上げる。空にすると「規約なし」に戻る）
create or replace function public.admin_set_terms(p_body text)
returns json
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_body text := btrim(coalesce(p_body, ''), E' \n\r\t　');
  v_cur record;
begin
  if not public.resprint_is_admin() then
    raise exception '管理者の権限がありません' using errcode = '42501';
  end if;
  select t.version, t.body into v_cur from resprint_private.terms t order by t.version desc limit 1;
  if v_cur.version is not null and v_cur.body = v_body then
    return json_build_object('version', v_cur.version, 'changed', false);
  end if;
  if v_cur.version is null and v_body = '' then
    return json_build_object('version', 0, 'changed', false);
  end if;
  insert into resprint_private.terms (version, body) values (coalesce(v_cur.version, 0) + 1, v_body);
  return json_build_object('version', coalesce(v_cur.version, 0) + 1, 'changed', true);
end
$fn$;

create or replace function public.admin_get_terms()
returns json
language plpgsql stable security definer set search_path = ''
as $fn$
begin
  if not public.resprint_is_admin() then
    raise exception '管理者の権限がありません' using errcode = '42501';
  end if;
  return (
    select json_build_object(
             'version', t.version, 'body', t.body, 'updated_at', t.created_at,
             'accepted_count', (select count(*) from resprint_private.terms_acceptances a where a.version = t.version))
      from resprint_private.terms t order by t.version desc limit 1
  );
end
$fn$;

-- 選手：いまの文面と、同意済みかどうか（文面がなければ null）
create or replace function public.terms_status(p_player_id text)
returns json
language plpgsql stable security definer set search_path = ''
as $fn$
declare
  v record;
begin
  if not public.resprint_can_access_player(p_player_id) then
    raise exception 'この選手の情報は見られません' using errcode = '42501';
  end if;
  select t.version, t.body into v from resprint_private.terms t order by t.version desc limit 1;
  if v.version is null or v.body = '' then
    return null;
  end if;
  return json_build_object(
    'version', v.version, 'body', v.body,
    'accepted', exists (select 1 from resprint_private.terms_acceptances a
                         where a.player_id = p_player_id and a.version = v.version));
end
$fn$;

create or replace function public.terms_accept(p_player_id text, p_version integer)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $fn$
begin
  if not public.resprint_can_access_player(p_player_id) then
    raise exception 'この選手の情報は見られません' using errcode = '42501';
  end if;
  if not exists (select 1 from resprint_private.terms t where t.version = p_version) then
    return false;
  end if;
  insert into resprint_private.terms_acceptances (player_id, version, user_id)
  values (p_player_id, p_version, auth.uid())
  on conflict (player_id, version) do nothing;
  return true;
end
$fn$;


-- ---------- (4) リマインドの通知 ----------
-- 同じ通知を二度送らないための記録
create table if not exists resprint_private.reminder_log (
  kind text not null,
  ref text not null,
  sent_at timestamptz not null default now(),
  primary key (kind, ref)
);

-- 日報：今日（日本時間）の日報がまだの選手のうち、通知をオンにしている人へ
create or replace function resprint_private.run_report_reminders()
returns integer
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_today text := to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM-DD');
  r record;
  v_n integer := 0;
  v_new integer;
begin
  delete from resprint_private.reminder_log where sent_at < now() - interval '14 days';
  for r in
    select p.id, p.org_id::text as org_id
      from public.players p
     where p.completed_at is null
       and not exists (select 1 from public.reports rp where rp.player_id = p.id and rp.date = v_today)
       and exists (select 1 from resprint_private.push_subscriptions s where s.role = 'player' and s.player_id = p.id)
  loop
    insert into resprint_private.reminder_log (kind, ref) values ('report', r.id || ':' || v_today)
    on conflict do nothing;
    get diagnostics v_new = row_count;
    if v_new > 0 then
      perform resprint_private.push_send(r.org_id, 'player', r.id, '今日の日報がまだです', 'report');
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$fn$;

-- 面談：24時間前〜12時間前に1回、1時間前に1回。選手と、その組織の指導者へ
--   slots.datetime は 'YYYY-MM-DD HH:MM'（日本時間）の文字
create or replace function resprint_private.run_meeting_reminders()
returns integer
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  r record;
  v_left interval;
  v_kind text;
  v_body text;
  v_n integer := 0;
  v_new integer;
begin
  for r in
    select s.id::text as id, s.org_id::text as org_id, s.booked_by::text as player_id, s.datetime,
           ((s.datetime || ':00')::timestamp at time zone 'Asia/Tokyo') as starts_at
      from public.slots s
     where s.booked_by is not null and s.datetime ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$'
  loop
    v_left := r.starts_at - now();
    if v_left > interval '0' and v_left <= interval '1 hour' then
      v_kind := 'meeting-hour';
      v_body := 'まもなく面談の時間です';
    elsif v_left > interval '12 hours' and v_left <= interval '24 hours' then
      v_kind := 'meeting-day';
      v_body := '面談の予定が近づいています';
    else
      continue;
    end if;
    insert into resprint_private.reminder_log (kind, ref)
    values (v_kind, r.id || ':' || r.player_id || ':' || r.datetime)
    on conflict do nothing;
    get diagnostics v_new = row_count;
    if v_new > 0 then
      perform resprint_private.push_send(r.org_id, 'player', r.player_id, v_body, 'meeting');
      perform resprint_private.push_send(r.org_id, 'coach', r.player_id, v_body, 'meeting');
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
exception when others then
  return v_n;
end
$fn$;


-- ---------- (5) 毎日の自動バックアップ ----------
-- 残す回数の初期値を 10 → 30 に（毎日の自動分と、公開前の手動分を合わせて）
create or replace function resprint_backup.take_snapshot(p_label text, p_keep integer default 30)
returns table (table_name text, row_count integer)
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  t record;
  v_label text := coalesce(nullif(trim(p_label), ''), 'snapshot');
  v_now timestamptz := clock_timestamp();
  v_rows jsonb;
  v_n integer;
begin
  -- 同じ名前の控えがあれば、取り直す
  delete from resprint_backup.snapshots s where s.label = v_label;

  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and c.relname not in ('org_login_failures', 'resprint_migration_backup')
     order by c.relname
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb), count(*)::int from public.%I x', t.relname)
      into v_rows, v_n;
    insert into resprint_backup.snapshots (label, taken_at, table_name, row_count, rows)
    values (v_label, v_now, t.relname, v_n, v_rows);
    table_name := t.relname;
    row_count := v_n;
    return next;
  end loop;

  -- 新しい方から p_keep 回分だけ残す
  delete from resprint_backup.snapshots s
   where s.taken_at < (
     select min(k.taken_at) from (
       select distinct s2.taken_at from resprint_backup.snapshots s2
        order by s2.taken_at desc limit greatest(coalesce(p_keep, 30), 1)
     ) k
   );
end
$fn$;
revoke all on function resprint_backup.take_snapshot(text, integer) from public;

create or replace function resprint_backup.daily()
returns integer
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_n integer;
begin
  select count(*) into v_n
    from resprint_backup.take_snapshot('自動 ' || to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM-DD'), 30);
  return v_n;
end
$fn$;
revoke all on function resprint_backup.daily() from public;


-- ---------- 権限 ----------
do $v30grant$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema resprint_private from %I', r);
      execute format('revoke all on all tables in schema resprint_private from %I', r);
      execute format('revoke all on all functions in schema resprint_private from %I', r);
      execute format('revoke all on all functions in schema resprint_backup from %I', r);
    end if;
  end loop;
end
$v30grant$;
revoke all on all tables in schema resprint_private from public;
revoke all on all functions in schema resprint_private from public;
revoke all on function public.admin_set_terms(text) from public, anon;
revoke all on function public.admin_get_terms() from public, anon;
revoke all on function public.terms_status(text) from public, anon;
revoke all on function public.terms_accept(text, integer) from public, anon;
grant execute on function public.admin_set_terms(text) to authenticated;
grant execute on function public.admin_get_terms() to authenticated;
grant execute on function public.terms_status(text) to authenticated;
grant execute on function public.terms_accept(text, integer) to authenticated;


-- ---------- 定期実行（pg_cron が使えるときだけ） ----------
do $v30cron$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron を有効にできませんでした（定期実行は設定されません）: %', sqlerrm;
  end;
  if to_regnamespace('cron') is null then
    return;
  end if;
  -- 入れ直す（何度実行しても1つずつ）
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname like 'resprint-%';
  -- 時刻は UTC。日本時間 = UTC + 9時間
  perform cron.schedule('resprint-meeting-reminders', '*/10 * * * *', 'select resprint_private.run_meeting_reminders()');
  perform cron.schedule('resprint-report-reminders', '0 11 * * *', 'select resprint_private.run_report_reminders()');
  perform cron.schedule('resprint-daily-backup', '30 18 * * *', 'select resprint_backup.daily()');
end
$v30cron$;

notify pgrst, 'reload schema';

-- 確認用
select 'staff_notes / exercise_logs' as item,
       ((to_regclass('public.staff_notes') is not null) and (to_regclass('public.exercise_logs') is not null))::text as value
union all select 'terms_status()', (to_regprocedure('public.terms_status(text)') is not null)::text
union all select '定期実行（pg_cron）', (to_regnamespace('cron') is not null)::text;
