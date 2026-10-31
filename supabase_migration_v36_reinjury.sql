-- ============================================================
-- RE:SPRINT - v36 再受傷の記録
--
--   players.reinjury_date：いちばん新しい再受傷の日（なければ null）。
--     アプリは、面談の目安（受傷から14日）をこの日から数え直す。
--     受傷日（injury_date）は最初の受傷のまま残す。
--   player_reinjuries：再受傷の記録（1回ごとに1行）。
--     reinjured_on      再受傷の日
--     phase_before      記録したときの PHASE
--     completed_before  記録したときに復帰を記録済みだったら、その日時（復帰の途中なら null）
--     restart_phase     再開した PHASE
--     note              メモ（任意）
--   読み書きできるのは、その選手と同じ組織の人だけ（ほかの選手ごとの表と同じ）。書き換えは不可・削除は可。
--
--   列と表の追加だけ。公開中のアプリ（v15.22）はそのまま動く（新しい列は読まない）。
--   新しいアプリは、この表がなくても画面は動く（再受傷を記録するときだけエラーになる）。
--   戻し方：drop table public.player_reinjuries; alter table public.players drop column reinjury_date;
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

alter table public.players add column if not exists reinjury_date date;

create table if not exists public.player_reinjuries (
  id bigint generated always as identity primary key,
  player_id text not null references public.players(id) on delete cascade,
  reinjured_on date not null,
  phase_before integer,
  completed_before timestamptz,
  restart_phase integer check (restart_phase is null or restart_phase >= 1),
  note text check (note is null or length(note) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists player_reinjuries_player_idx on public.player_reinjuries (player_id, reinjured_on);

do $v36rls$
begin
  alter table public.player_reinjuries enable row level security;
  drop policy if exists "resprint org read" on public.player_reinjuries;
  drop policy if exists "resprint org insert" on public.player_reinjuries;
  drop policy if exists "resprint org delete" on public.player_reinjuries;
  create policy "resprint org read" on public.player_reinjuries for select to authenticated
    using (public.resprint_can_access_player(player_id::text));
  create policy "resprint org insert" on public.player_reinjuries for insert to authenticated
    with check (public.resprint_can_access_player(player_id::text));
  create policy "resprint org delete" on public.player_reinjuries for delete to authenticated
    using (public.resprint_can_access_player(player_id::text));
  revoke all on public.player_reinjuries from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.player_reinjuries from anon;
  end if;
  revoke all on public.player_reinjuries from authenticated;
  grant select, insert, delete on public.player_reinjuries to authenticated;
end
$v36rls$;

notify pgrst, 'reload schema';

-- 確認用
select 'players.reinjury_date' as item,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'players' and column_name = 'reinjury_date')::text as value
union all
select 'player_reinjuries', (to_regclass('public.player_reinjuries') is not null)::text
union all
select 'player_reinjuries の RLS', coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.player_reinjuries')), 'false');
