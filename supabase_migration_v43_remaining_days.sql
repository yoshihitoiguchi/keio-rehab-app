-- ============================================================
-- RE:SPRINT - v43 「全体復帰まであと」を同じ受傷の選手の実績から出す
--
--   作者の指示（2026-10-31）：これまでの「全体復帰まであと○週間」は、プロトコルに設定した全体の週数を
--   PHASE の数で割っただけで、実績に基づいていなかった。
--   同じ受傷（プロトコル・BAMIC分類・損傷筋・部位がすべて一致）のほかの選手が、
--   いまの PHASE に入ってから最後の PHASE（PHASE 10）に入るまでにかかった日数から出す。
--
--   same_injury_remaining_days(選手ID)：その選手のいまの PHASE について、同じ受傷のほかの選手の
--     「その PHASE に入った日 → 最後の PHASE に入った日」の日数の平均・最短・最長・人数。名前は返さない。
--     ・本人・デモの選手は数えない。一覧から削除した選手は記録ごと消えている。
--     ・その PHASE に何度か入った選手は、最後の PHASE に入る前のいちばん新しい日を使う。日付は日本時間。
--     ・該当者がいなければ0行。見る人の権限で動く（自分の組織だけ）。
--     ・v41 の player_return_days（受傷から最後の PHASE に入った日）を使う。
--
--   関数の追加だけ。公開中のアプリはそのまま動く。
--   戻し方：drop function public.same_injury_remaining_days(text);
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

create or replace function public.same_injury_remaining_days(p_player_id text)
returns table (phase_number int, sample_size int, avg_days numeric, min_days int, max_days int)
language sql stable security invoker set search_path = ''
as $fn$
  with me as (
    select pl.id, pl.protocol_id, pl.current_phase, pl.bamic_grade, pl.hamstring_muscle, pl.hamstring_location
      from public.players pl
     where pl.id = p_player_id
  ),
  peers as (
    select r.player_id, r.reached_at
      from public.player_return_days r, me
     where r.player_id <> me.id
       and not r.is_demo
       and r.protocol_id = me.protocol_id
       and r.bamic_grade is not distinct from me.bamic_grade
       and r.hamstring_muscle is not distinct from me.hamstring_muscle
       and r.hamstring_location is not distinct from me.hamstring_location
  ),
  spans as (
    select p.player_id,
           ((p.reached_at at time zone 'Asia/Tokyo')::date
             - (max(h.entered_at) at time zone 'Asia/Tokyo')::date)::int as days
      from peers p
      join me on true
      join public.phase_history h
        on h.player_id = p.player_id
       and h.protocol_id = me.protocol_id
       and h.phase_number = me.current_phase
       and h.entered_at is not null
       and h.entered_at <= p.reached_at
     group by p.player_id, p.reached_at
  )
  select (select current_phase from me)::int, count(*)::int, round(avg(s.days), 1), min(s.days)::int, max(s.days)::int
    from spans s
   where s.days >= 0
  having count(*) > 0;
$fn$;

do $v43grant$
begin
  revoke all on function public.same_injury_remaining_days(text) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.same_injury_remaining_days(text) from anon;
  end if;
  grant execute on function public.same_injury_remaining_days(text) to authenticated;
end
$v43grant$;

notify pgrst, 'reload schema';

-- 確認用（名前は出さない）
select pl.current_phase, pl.bamic_grade, pl.hamstring_muscle, pl.is_demo, r.*
  from public.players pl
  left join lateral public.same_injury_remaining_days(pl.id) r on true
 order by pl.current_phase;
