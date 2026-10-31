-- ============================================================
-- RE:SPRINT - v41 復帰の日数を「最後の PHASE（ハムストリングは PHASE 10）に入った日」で数える
--
--   作者の指示（2026-10-31）：
--     ・復帰の目安は、損傷筋と分類（BAMIC）が完全に一致する選手とだけ比べる（疾患名＝プロトコル・部位も一致）。
--     ・復帰は、日数の上では最後の PHASE に入った日とする。復帰者リストへの移動はこれまでどおり手動（このファイルは関係しない）。
--     ・デモの選手・一覧から削除した選手は含めない（削除した選手は記録ごと消えている）。
--
--   player_return_days（ビュー）：選手ごとの「受傷から最後の PHASE に入った日まで」の日数。
--     最後の PHASE に何度か入った選手は、いちばん新しい日。その日より前に再受傷していれば再受傷日から数える。日付は日本時間。
--   same_injury_return_days(選手ID)：同じ受傷のほかの選手（本人・デモを除く）の平均・最短・最長・人数。名前は返さない。
--   protocol_avg_recovery / hamstring_recovery_by_classification：列はそのまま、上の数え方に作り直す（completed_at は使わない）。
--   どれも見る人の権限で動く（自分の組織だけ）。
--
--   ビューと関数の追加・作り直しだけ。公開中のアプリ（v15.28）はそのまま動く（数字の数え方が変わるだけ）。
--   戻し方：drop function public.same_injury_return_days(text);
--           2つのビューを v40 の定義（completed_at - injury_date）で作り直し、drop view public.player_return_days;
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

create or replace view public.player_return_days with (security_invoker = true) as
with fin as (
  select h.player_id, max(h.entered_at) as reached_at
    from public.phase_history h
    join public.players pl on pl.id = h.player_id
    join public.protocols p on p.id = pl.protocol_id
   where h.protocol_id = pl.protocol_id
     and h.entered_at is not null
     and h.phase_number = jsonb_array_length(p.phases::jsonb)
   group by h.player_id
)
select pl.id as player_id,
       pl.org_id,
       pl.protocol_id,
       pl.bamic_grade,
       pl.hamstring_muscle,
       pl.hamstring_location,
       pl.is_demo,
       f.reached_at,
       ((f.reached_at at time zone 'Asia/Tokyo')::date
         - case when pl.reinjury_date is not null
                     and pl.reinjury_date <= (f.reached_at at time zone 'Asia/Tokyo')::date
                then pl.reinjury_date else pl.injury_date end)::int as days
  from public.players pl
  join fin f on f.player_id = pl.id
 where pl.injury_date is not null;

create or replace view public.protocol_avg_recovery with (security_invoker = true) as
select org_id,
       protocol_id,
       round(avg(days), 1) as avg_days,
       count(*) as sample_size
  from public.player_return_days
 where not is_demo and days >= 0
 group by org_id, protocol_id;

create or replace view public.hamstring_recovery_by_classification with (security_invoker = true) as
select p.org_id,
       r.bamic_grade,
       r.hamstring_muscle,
       r.hamstring_location,
       round(avg(r.days), 1) as avg_days,
       min(r.days) as min_days,
       max(r.days) as max_days,
       count(*) as sample_size
  from public.player_return_days r
  join public.protocols p on p.id = r.protocol_id
 where p.classification_scheme = 'hamstring'::text and not r.is_demo and r.days >= 0
 group by p.org_id, r.bamic_grade, r.hamstring_muscle, r.hamstring_location;

create or replace function public.same_injury_return_days(p_player_id text)
returns table (sample_size int, avg_days numeric, min_days int, max_days int)
language sql stable security invoker set search_path = ''
as $fn$
  select count(*)::int, round(avg(r.days), 1), min(r.days)::int, max(r.days)::int
    from public.player_return_days r
    join public.players me on me.id = p_player_id
   where r.player_id <> me.id
     and not r.is_demo
     and r.days >= 0
     and r.protocol_id = me.protocol_id
     and r.bamic_grade is not distinct from me.bamic_grade
     and r.hamstring_muscle is not distinct from me.hamstring_muscle
     and r.hamstring_location is not distinct from me.hamstring_location
  having count(*) > 0;
$fn$;

do $v41grant$
begin
  revoke all on public.player_return_days from public;
  revoke all on function public.same_injury_return_days(text) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.player_return_days from anon;
    revoke all on function public.same_injury_return_days(text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.protocol_avg_recovery from anon;
    revoke all on public.hamstring_recovery_by_classification from anon;
  end if;
  grant select on public.player_return_days, public.protocol_avg_recovery, public.hamstring_recovery_by_classification to authenticated;
  grant execute on function public.same_injury_return_days(text) to authenticated;
end
$v41grant$;

notify pgrst, 'reload schema';

-- 確認用（名前は出さない）
select r.bamic_grade, r.hamstring_muscle, r.hamstring_location, r.is_demo, r.days
  from public.player_return_days r
 order by r.bamic_grade, r.hamstring_muscle, r.hamstring_location;
