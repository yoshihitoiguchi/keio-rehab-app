-- ============================================================
-- RE:SPRINT - v46 カメラで測った値（GATE のチェックの添付）
--
--   pose_measurements：スマホのカメラで種目を撮り、関節の位置から測った値を残す表。
--     gate_check_id  どの GATE のチェック（gate_item_checks）に添付したか
--     exercise_key   種目ID（src/pose/measurement-specs.ts の id。例 heel-dig-iso）
--     variant        種類（例 long-lever。なければ null）
--     spec_version   測り方の版（measurement-specs.ts の version）
--     measured       測った値（指定と並べて出す値。合否は入れない）
--     landmarks      撮った側の関節の座標（6点・最大15コマ/秒）。動画は保存しない
--   読み書きできるのは、その選手と同じ組織の人だけ（ほかの選手ごとの表と同じ）。書き換えはできない（削除は可）。
--
--   表の追加だけ。公開中のアプリはそのまま動く。
--   この表がない間は、新しいアプリでも GATE に「カメラで測る」が出ないだけ。
--   戻し方：drop table public.pose_measurements;
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

create table if not exists public.pose_measurements (
  id bigint generated always as identity primary key,
  player_id text not null references public.players(id) on delete cascade,
  gate_check_id bigint references public.gate_item_checks(id) on delete cascade,
  phase_number integer,
  item_index integer,
  exercise_key text not null check (exercise_key ~ '^[a-z0-9-]{1,40}$'),
  variant text check (variant is null or variant ~ '^[a-z0-9-]{1,40}$'),
  spec_version integer not null default 1,
  recorded_by text not null check (recorded_by in ('self', 'staff')),
  delegate text check (delegate is null or delegate in ('GPU', 'CPU')),
  measured jsonb not null check (pg_column_size(measured) <= 65536),
  landmarks jsonb check (landmarks is null or pg_column_size(landmarks) <= 2097152),
  created_at timestamptz not null default now()
);
create index if not exists pose_measurements_player_idx
  on public.pose_measurements (player_id, phase_number, created_at);
create index if not exists pose_measurements_gate_check_idx
  on public.pose_measurements (gate_check_id);

do $v46rls$
begin
  alter table public.pose_measurements enable row level security;
  drop policy if exists "resprint org read" on public.pose_measurements;
  drop policy if exists "resprint org insert" on public.pose_measurements;
  drop policy if exists "resprint org delete" on public.pose_measurements;
  create policy "resprint org read" on public.pose_measurements for select to authenticated
    using (public.resprint_can_access_player(player_id::text));
  create policy "resprint org insert" on public.pose_measurements for insert to authenticated
    with check (
      public.resprint_can_access_player(player_id::text)
      and (gate_check_id is null or exists (
        select 1 from public.gate_item_checks g
        where g.id = gate_check_id and g.player_id = pose_measurements.player_id
      ))
    );
  create policy "resprint org delete" on public.pose_measurements for delete to authenticated
    using (public.resprint_can_access_player(player_id::text));
  revoke all on public.pose_measurements from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.pose_measurements from anon;
  end if;
  revoke all on public.pose_measurements from authenticated;
  grant select, insert, delete on public.pose_measurements to authenticated;
end
$v46rls$;

notify pgrst, 'reload schema';

-- 確認用
select 'pose_measurements' as item,
       (to_regclass('public.pose_measurements') is not null)::text as value
union all
select 'RLS', (select relrowsecurity::text from pg_class where oid = 'public.pose_measurements'::regclass)
union all
select 'policies', (select count(*)::text from pg_policies where tablename = 'pose_measurements');
