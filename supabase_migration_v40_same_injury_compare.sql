-- ============================================================
-- RE:SPRINT - v40 同じ受傷の選手と PHASE ごとの基準を比べる
--
--   players.is_demo：デモの選手（集計に含めない）。名前が「デモ」で始まる選手は true にしておく。
--     指導者が選手の「記録」タブで切り替えられる。
--   same_injury_phase_compare(選手ID)：同じ受傷（同じプロトコル＝疾患名、同じ BAMIC分類・損傷筋・部位）の
--     ほかの選手について、PHASE ごとの日数と、各基準を最初に満たした日（その PHASE に入ってから何日目か）を
--     平均・最短・最長・人数で返す。受傷（再受傷）から何日目かも返す。名前やIDは返さない。
--       ・本人・デモの選手は含めない。一覧から削除した選手は、記録ごと消えているので含まれない。
--       ・再受傷などで同じ PHASE に何度か入った選手は、いちばん新しい滞在だけを使う（画面の「あなた」と同じ数え方）。
--       ・item_index が null の行は PHASE 全体の日数（その PHASE を終えた選手だけ）。
--       ・見る人の権限で動く（security invoker）。自分の組織の選手しか数えない。
--   集計のビュー（protocol_phase_avg_duration / protocol_avg_recovery / hamstring_recovery_by_classification）も
--     デモの選手を除くように作り直す（列は同じ。security_invoker もそのまま）。
--
--   列・関数の追加とビューの作り直しだけ。公開中のアプリ（v15.26）はそのまま動く。
--   戻し方：drop function public.same_injury_phase_compare(text); alter table public.players drop column is_demo;
--           （ビューは is_demo の条件を外して作り直す。控え「v40 の前」から定義を戻せる）
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

-- 戻り値の列を変えたときに作り直せるように
drop function if exists public.same_injury_phase_compare(text);

alter table public.players add column if not exists is_demo boolean not null default false;

-- 名前が「デモ」で始まる選手はデモとして扱う
update public.players set is_demo = true
 where not is_demo and btrim(name) like 'デモ%';

-- ---------- 集計のビュー：デモの選手を除く ----------
create or replace view public.protocol_phase_avg_duration with (security_invoker = true) as
select p.name as protocol_name,
       ph.phase_number,
       round(avg(extract(epoch from ph.left_at - ph.entered_at) / 86400::numeric), 1) as avg_days,
       count(*) as sample_size
  from public.phase_history ph
  join public.protocols p on p.id = ph.protocol_id
  join public.players pl on pl.id = ph.player_id
 where ph.left_at is not null and not pl.is_demo
 group by p.name, ph.phase_number;

create or replace view public.protocol_avg_recovery with (security_invoker = true) as
select org_id,
       protocol_id,
       round(avg(completed_at::date - injury_date), 1) as avg_days,
       count(*) as sample_size
  from public.players
 where completed_at is not null and injury_date is not null and not is_demo
 group by org_id, protocol_id;

create or replace view public.hamstring_recovery_by_classification with (security_invoker = true) as
select p.org_id,
       pl.bamic_grade,
       pl.hamstring_muscle,
       pl.hamstring_location,
       round(avg(pl.completed_at::date - pl.injury_date), 1) as avg_days,
       min(pl.completed_at::date - pl.injury_date) as min_days,
       max(pl.completed_at::date - pl.injury_date) as max_days,
       count(*) as sample_size
  from public.players pl
  join public.protocols p on p.id = pl.protocol_id
 where pl.completed_at is not null and pl.injury_date is not null
   and p.classification_scheme = 'hamstring'::text and not pl.is_demo
 group by p.org_id, pl.bamic_grade, pl.hamstring_muscle, pl.hamstring_location;

-- ---------- 同じ受傷の選手との PHASE ごとの比較 ----------
create or replace function public.same_injury_phase_compare(p_player_id text)
returns table (phase_number int, item_index int, sample_size int,
               avg_days numeric, min_days int, max_days int,
               injury_sample_size int, avg_from_injury numeric, min_from_injury int, max_from_injury int)
language sql stable security invoker set search_path = ''
as $fn$
  with me as (
    select pl.id, pl.protocol_id, pl.bamic_grade, pl.hamstring_muscle, pl.hamstring_location
      from public.players pl
     where pl.id = p_player_id
  ),
  peers as (
    select o.id, o.injury_date, o.reinjury_date
      from public.players o, me
     where o.id <> me.id
       and not o.is_demo
       and o.protocol_id = me.protocol_id
       and o.bamic_grade is not distinct from me.bamic_grade
       and o.hamstring_muscle is not distinct from me.hamstring_muscle
       and o.hamstring_location is not distinct from me.hamstring_location
  ),
  -- それぞれの選手の、PHASE ごとのいちばん新しい滞在。受傷日は、その滞在より前の再受傷があればその日
  stays as (
    select distinct on (h.player_id, h.phase_number)
           h.player_id, h.phase_number, h.entered_at, h.left_at,
           case when peers.reinjury_date is not null and peers.reinjury_date <= h.entered_at::date
                then peers.reinjury_date else peers.injury_date end as base_date
      from public.phase_history h
      join peers on peers.id = h.player_id
      join me on me.protocol_id = h.protocol_id
     where h.entered_at is not null
     order by h.player_id, h.phase_number, h.entered_at desc
  ),
  phase_days as (
    select s.phase_number, null::int as item_index,
           round(extract(epoch from s.left_at - s.entered_at) / 86400)::int as days,
           (s.left_at::date - s.base_date)::int as from_injury
      from stays s
     where s.left_at is not null
  ),
  -- 基準ごとに、その滞在の中で最初に「満たした」と記録された日
  item_days as (
    select s.phase_number, g.item_index,
           greatest(0, round(extract(epoch from min(g.created_at) - s.entered_at) / 86400))::int as days,
           (min(g.created_at)::date - s.base_date)::int as from_injury
      from stays s
      join public.gate_item_checks g
        on g.player_id = s.player_id and g.phase_number = s.phase_number and g.result
       and g.created_at >= s.entered_at
       and (s.left_at is null or g.created_at <= s.left_at)
     group by s.player_id, s.phase_number, s.entered_at, s.base_date, g.item_index
  ),
  all_days as (
    select * from phase_days
    union all
    select * from item_days
  )
  select a.phase_number, a.item_index,
         count(*)::int as sample_size,
         round(avg(a.days), 1) as avg_days,
         min(a.days)::int as min_days,
         max(a.days)::int as max_days,
         count(a.from_injury) filter (where a.from_injury >= 0)::int as injury_sample_size,
         round(avg(a.from_injury) filter (where a.from_injury >= 0), 1) as avg_from_injury,
         (min(a.from_injury) filter (where a.from_injury >= 0))::int as min_from_injury,
         (max(a.from_injury) filter (where a.from_injury >= 0))::int as max_from_injury
    from all_days a
   group by a.phase_number, a.item_index
   order by a.phase_number, a.item_index nulls first;
$fn$;

do $v40grant$
begin
  revoke all on function public.same_injury_phase_compare(text) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.same_injury_phase_compare(text) from anon;
  end if;
  grant execute on function public.same_injury_phase_compare(text) to authenticated;
end
$v40grant$;

notify pgrst, 'reload schema';

-- 確認用
select (select count(*) from public.players where is_demo) as demo_players,
       (select count(*) from public.players where not is_demo) as other_players,
       to_regprocedure('public.same_injury_phase_compare(text)') is not null as compare_fn,
       (select reloptions::text from pg_class where oid = 'public.protocol_phase_avg_duration'::regclass) as view_options;
