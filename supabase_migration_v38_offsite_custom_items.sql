-- ============================================================
-- RE:SPRINT - v38 患部外トレーニングを選手ごとに個別に追加
--
--   player_offsite_custom_items：共通リスト（offsite_items）にない種目を、選手1人ごとに足す表。
--     name       種目名
--     load_type  'unloaded'（免荷で可）／'partial'（部分荷重）／'full'（全荷重）
--     note       回数・セット・注意など（任意）
--   読み書きできるのは、その選手と同じ組織の人だけ（ほかの選手ごとの表と同じ）。
--   共通リストからの選択（player_offsite_selections）はそのまま。
--
--   表の追加だけ。公開中のアプリ（v15.22）はそのまま動く。
--   この表がない間は、新しいアプリでも「個別に追加」の欄が出ないだけで、リストからの選択は使える。
--   戻し方：drop table public.player_offsite_custom_items;
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

create table if not exists public.player_offsite_custom_items (
  id bigint generated always as identity primary key,
  player_id text not null references public.players(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  load_type text not null default 'full' check (load_type in ('unloaded', 'partial', 'full')),
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists player_offsite_custom_items_player_idx
  on public.player_offsite_custom_items (player_id, created_at);

do $v38rls$
begin
  alter table public.player_offsite_custom_items enable row level security;
  drop policy if exists "resprint org read" on public.player_offsite_custom_items;
  drop policy if exists "resprint org insert" on public.player_offsite_custom_items;
  drop policy if exists "resprint org update" on public.player_offsite_custom_items;
  drop policy if exists "resprint org delete" on public.player_offsite_custom_items;
  create policy "resprint org read" on public.player_offsite_custom_items for select to authenticated
    using (public.resprint_can_access_player(player_id::text));
  create policy "resprint org insert" on public.player_offsite_custom_items for insert to authenticated
    with check (public.resprint_can_access_player(player_id::text));
  create policy "resprint org update" on public.player_offsite_custom_items for update to authenticated
    using (public.resprint_can_access_player(player_id::text))
    with check (public.resprint_can_access_player(player_id::text));
  create policy "resprint org delete" on public.player_offsite_custom_items for delete to authenticated
    using (public.resprint_can_access_player(player_id::text));
  revoke all on public.player_offsite_custom_items from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.player_offsite_custom_items from anon;
  end if;
  revoke all on public.player_offsite_custom_items from authenticated;
  grant select, insert, update, delete on public.player_offsite_custom_items to authenticated;
end
$v38rls$;

notify pgrst, 'reload schema';

-- 確認用
select 'player_offsite_custom_items' as item,
       (to_regclass('public.player_offsite_custom_items') is not null)::text as value
union all
select 'RLS', (select relrowsecurity::text from pg_class where oid = 'public.player_offsite_custom_items'::regclass);
