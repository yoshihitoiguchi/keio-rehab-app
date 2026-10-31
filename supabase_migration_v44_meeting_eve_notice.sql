-- ============================================================
-- RE:SPRINT - v44 面談の前日のお知らせ
--
--   作者の指示（2026-10-31）：面談を予約した選手と指導者に、前日に通知を送る。
--
--   v30 の面談リマインド（10分ごと：resprint-meeting-reminders）を置き換える：
--     ・前日のお知らせ：面談の前の日（日本時間）の19時から24時のあいだに1回。
--         選手へ　：「明日 18:00 から面談があります」
--         指導者へ：「明日 18:00 から選手との面談があります」
--       19時より後に翌日の面談が予約されたときも、その日のうちに送る。
--       当日に予約された面談には送らない（1時間前のお知らせだけ）。
--     ・1時間前のお知らせ（「まもなく面談の時間です」）は今までどおり。
--     ・v30 の「24〜12時間前」のお知らせ（面談の予定が近づいています）は、前日のお知らせに置き換えるのでやめる。
--   通知には時刻だけを入れ、選手の名前は入れない（ロック画面に出るため。v27 の決まり）。
--   同じ日に面談が2件あっても指導者の端末で上書きされないよう、通知の tag は面談ごとに分ける。
--
--   関数の置き換えだけ（定期実行・テーブルは v30 のまま）。アプリの変更なし。
--   resprint_private.meeting_reminders_at(時刻)：試験で時刻を指定できるようにした本体。
--   戻し方：supabase_migration_v30_operations.sql の run_meeting_reminders を再実行し、
--           drop function if exists resprint_private.meeting_reminders_at(timestamptz);
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

create or replace function resprint_private.meeting_reminders_at(p_now timestamptz)
returns integer
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  r record;
  v_now_jst timestamp := p_now at time zone 'Asia/Tokyo';
  v_tomorrow date := (p_now at time zone 'Asia/Tokyo')::date + 1;
  v_left interval;
  v_kind text;
  v_ref text;
  v_hm text;
  v_player text;
  v_coach text;
  v_tag text;
  v_n integer := 0;
  v_new integer;
begin
  for r in
    select s.id::text as id, s.org_id::text as org_id, s.booked_by::text as player_id, s.datetime,
           ((s.datetime || ':00')::timestamp at time zone 'Asia/Tokyo') as starts_at
      from public.slots s
     where s.booked_by is not null and s.datetime ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$'
  loop
    v_left := r.starts_at - p_now;
    v_ref := r.id || ':' || r.player_id || ':' || r.datetime;
    v_hm := substr(r.datetime, 12, 5);
    if v_left > interval '0' and v_left <= interval '1 hour' then
      v_kind := 'meeting-hour';
      v_player := 'まもなく面談の時間です';
      v_coach := v_player;
      v_tag := 'meeting';
    elsif left(r.datetime, 10) = to_char(v_tomorrow, 'YYYY-MM-DD') and extract(hour from v_now_jst) >= 19 then
      -- v30 の「24〜12時間前」で送った面談には、もう一度は送らない
      if exists (select 1 from resprint_private.reminder_log l where l.kind = 'meeting-day' and l.ref = v_ref) then
        continue;
      end if;
      v_kind := 'meeting-eve';
      v_player := '明日 ' || v_hm || ' から面談があります';
      v_coach := '明日 ' || v_hm || ' から選手との面談があります';
      v_tag := left('meeting-' || r.id, 40);
    else
      continue;
    end if;
    insert into resprint_private.reminder_log (kind, ref) values (v_kind, v_ref)
    on conflict do nothing;
    get diagnostics v_new = row_count;
    if v_new > 0 then
      perform resprint_private.push_send(r.org_id, 'player', r.player_id, v_player, v_tag);
      perform resprint_private.push_send(r.org_id, 'coach', r.player_id, v_coach, v_tag);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
exception when others then
  return v_n;
end
$fn$;

-- 定期実行（resprint-meeting-reminders）から呼ばれる入口。名前と形は v30 のまま
create or replace function resprint_private.run_meeting_reminders()
returns integer
language sql volatile security definer set search_path = ''
as $fn$
  select resprint_private.meeting_reminders_at(now())
$fn$;

do $v44grant$
declare r text;
begin
  revoke all on function resprint_private.meeting_reminders_at(timestamptz) from public;
  revoke all on function resprint_private.run_meeting_reminders() from public;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function resprint_private.meeting_reminders_at(timestamptz) from %I', r);
      execute format('revoke all on function resprint_private.run_meeting_reminders() from %I', r);
    end if;
  end loop;
end
$v44grant$;

-- 確認用
select 'meeting_reminders_at(timestamptz)' as item, (to_regprocedure('resprint_private.meeting_reminders_at(timestamptz)') is not null)::text as value
union all select 'run_meeting_reminders()', (to_regprocedure('resprint_private.run_meeting_reminders()') is not null)::text;
