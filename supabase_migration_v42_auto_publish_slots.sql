-- ============================================================
-- RE:SPRINT - v42 そろった日時を自動で公開する・過ぎた日時の空き枠と空き時間を消す
--
--   作者の指示（2026-10-31）：
--     ・「そろった日時を公開する」を押さなくても、2人以上そろえば自動で公開する。
--     ・時間が過ぎた面談の枠が残っているのは邪魔なので消す。
--
--   resprint_private.sync_slot(組織ID, 日時)＋ staff_availability のトリガー：
--     指導者の空き時間が足される・消されるたびに、その日時にそろっている立場（コーチ・トレーナー・ドクター）を数え、
--     2人以上なら枠を公開（slots に作る。あれば参加者を更新）、1人以下になったら予約のない枠の公開をやめる。
--     予約の入った枠は消さない。過ぎた日時は公開しない。
--
--   resprint_private.purge_past_schedule()：
--     ・slots：予約のない枠（booked_by が空）で、日時が今より前のもの
--     ・staff_availability：指導者の空き時間で、日時が今より前のもの
--     日時（"YYYY-MM-DD HH:MM" の文字列）は日本時間として比べる。形が違う行には触らない。
--     予約の入った枠（面談をした・する枠）は消さない（面談履歴に残す）。
--   すぐに1回実行し、そのあとは毎時0分に実行する（pg_cron：resprint-purge-past-schedule）。
--
--   関数・トリガー・定期実行の追加と、過ぎた空き枠の削除、いまそろっている日時の公開だけ。
--   公開中のアプリ（v15.30）はそのまま動く（「公開する」ボタンも、押せば今までどおり動く）。
--   戻し方：drop trigger if exists resprint_sync_slot on public.staff_availability;
--           drop function resprint_private.staff_availability_sync(); drop function resprint_private.sync_slot(text, text);
--           select cron.unschedule('resprint-purge-past-schedule');
--           drop function resprint_private.purge_past_schedule();
--           消した行は、控え「v42 の前」から戻す（supabase_migration_v22_snapshot.sql の冒頭）。
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

create or replace function resprint_private.purge_past_schedule()
returns table (slots_deleted integer, availability_deleted integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $purge$
declare
  v_now timestamp := (now() at time zone 'Asia/Tokyo');
  v_slots integer;
  v_avail integer;
begin
  delete from public.slots s
   where s.booked_by is null
     and s.datetime ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$'
     and to_timestamp(s.datetime, 'YYYY-MM-DD HH24:MI')::timestamp < v_now;
  get diagnostics v_slots = row_count;

  delete from public.staff_availability a
   where a.datetime ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$'
     and to_timestamp(a.datetime, 'YYYY-MM-DD HH24:MI')::timestamp < v_now;
  get diagnostics v_avail = row_count;

  return query select v_slots, v_avail;
end
$purge$;

revoke all on function resprint_private.purge_past_schedule() from public, anon, authenticated;

-- ---------- そろった日時を自動で公開する ----------
create or replace function resprint_private.sync_slot(p_org text, p_datetime text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $sync$
declare
  v_roles jsonb;
  v_count integer;
begin
  if p_org is null or p_datetime is null then
    return;
  end if;
  select coalesce(jsonb_agg(r order by r), '[]'::jsonb), count(*)
    into v_roles, v_count
    from (select distinct a.role as r
            from public.staff_availability a
           where a.org_id = p_org and a.datetime = p_datetime
             and a.role in ('coach', 'trainer', 'doctor')) x;

  if v_count >= 2 then
    -- 過ぎた日時は公開しない
    if p_datetime ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$'
       and to_timestamp(p_datetime, 'YYYY-MM-DD HH24:MI')::timestamp < (now() at time zone 'Asia/Tokyo') then
      return;
    end if;
    insert into public.slots (org_id, datetime, matched_roles)
    values (p_org, p_datetime, v_roles)
    on conflict (org_id, datetime) do update set matched_roles = excluded.matched_roles;
  else
    -- そろわなくなった：予約のない枠は公開をやめる。予約済みの枠はそのまま残す（面談履歴のため）
    delete from public.slots s
     where s.org_id = p_org and s.datetime = p_datetime and s.booked_by is null;
  end if;
end
$sync$;

create or replace function resprint_private.staff_availability_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $trg$
begin
  if tg_op in ('DELETE', 'UPDATE') then
    perform resprint_private.sync_slot(old.org_id, old.datetime);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform resprint_private.sync_slot(new.org_id, new.datetime);
  end if;
  return null;
end
$trg$;

revoke all on function resprint_private.sync_slot(text, text) from public, anon, authenticated;
revoke all on function resprint_private.staff_availability_sync() from public, anon, authenticated;

drop trigger if exists resprint_sync_slot on public.staff_availability;
create trigger resprint_sync_slot
  after insert or update or delete on public.staff_availability
  for each row execute function resprint_private.staff_availability_sync();

-- ---------- 定期実行（pg_cron が使えるときだけ） ----------
do $v42cron$
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron がないので、定期実行は設定しません';
    return;
  end if;
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'resprint-purge-past-schedule';
  perform cron.schedule('resprint-purge-past-schedule', '0 * * * *', 'select resprint_private.purge_past_schedule()');
end
$v42cron$;

-- いま残っている過ぎた空き枠を消す
select * from resprint_private.purge_past_schedule();

-- いまそろっている日時を公開する
select count(*) as synced
  from (select distinct org_id, datetime from public.staff_availability) d,
       lateral resprint_private.sync_slot(d.org_id, d.datetime);

-- 確認用
select 'purge_past_schedule()' as item, (to_regprocedure('resprint_private.purge_past_schedule()') is not null)::text as value
union all select '過ぎた空き枠（0なら正常）',
  (select count(*) from public.slots where booked_by is null and datetime ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$'
     and to_timestamp(datetime, 'YYYY-MM-DD HH24:MI')::timestamp < (now() at time zone 'Asia/Tokyo'))::text
union all select '過ぎた空き時間（0なら正常）',
  (select count(*) from public.staff_availability where datetime ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$'
     and to_timestamp(datetime, 'YYYY-MM-DD HH24:MI')::timestamp < (now() at time zone 'Asia/Tokyo'))::text
union all select '自動公開のトリガー', (select count(*) from pg_trigger where tgname = 'resprint_sync_slot')::text
union all select '定期実行', (select count(*) from cron.job where jobname = 'resprint-purge-past-schedule')::text;
