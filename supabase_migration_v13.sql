-- ============================================================
-- RE:SPRINT - 差分マイグレーション v13
--   (1) 写真・動画のアップロード（Supabase Storage）
--   (2) 添付の記録と、90日で消すための仕組み
--   (3) フェーズ進行は選手本人のみ（スタッフは確認のみ）
-- ============================================================


-- ------------------------------------------------------------
-- (1) Storage バケット
--     file_size_limit は 50MB（52428800 バイト）
--     画像・動画のみ許可する
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  true,
  52428800,
  array[
    'image/jpeg','image/png','image/heic','image/heif','image/webp',
    'video/mp4','video/quicktime','video/webm'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- バケットへの読み書きポリシー
-- （他テーブルと同様、いまは anon に開いています。
--   選手データを厳密に分離する場合は Supabase Auth の導入が必要です）
drop policy if exists "attachments read" on storage.objects;
create policy "attachments read" on storage.objects
  for select using (bucket_id = 'attachments');

drop policy if exists "attachments insert" on storage.objects;
create policy "attachments insert" on storage.objects
  for insert with check (bucket_id = 'attachments');

drop policy if exists "attachments delete" on storage.objects;
create policy "attachments delete" on storage.objects
  for delete using (bucket_id = 'attachments');


-- ------------------------------------------------------------
-- (2) 添付の記録
--     どの選手の・どの場面の添付かを残し、期限切れの削除に使う
-- ------------------------------------------------------------
create table if not exists media_attachments (
  id bigint generated always as identity primary key,
  player_id text references players(id) on delete cascade,
  org_id text references organizations(id),
  storage_path text not null,          -- attachments バケット内のパス
  public_url text not null,
  mime_type text,
  byte_size bigint,
  kind text not null check (kind in ('image', 'video')),
  context text not null check (context in ('gate_check', 'report', 'message')),
  context_id text,                     -- GATE項目のindexや日報IDなど
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '90 days')
);
create index if not exists media_attachments_player_idx on media_attachments (player_id);
create index if not exists media_attachments_expires_idx on media_attachments (expires_at);

alter table media_attachments enable row level security;
drop policy if exists "public all - media_attachments" on media_attachments;
create policy "public all - media_attachments" on media_attachments
  for all using (true) with check (true);

-- GATEチェック・日報からも直接参照できるように
alter table gate_item_checks add column if not exists attachment_id bigint references media_attachments(id) on delete set null;
alter table reports add column if not exists attachment_id bigint references media_attachments(id) on delete set null;


-- ------------------------------------------------------------
-- (3) 90日で消す
--     関数だけ用意します。自動実行するには pg_cron が必要です。
-- ------------------------------------------------------------
create or replace function purge_expired_attachments()
returns integer
language plpgsql
security definer
as $$
declare
  v_count integer := 0;
begin
  -- Storage の実体を削除
  delete from storage.objects
   where bucket_id = 'attachments'
     and name in (select storage_path from media_attachments where expires_at < now());

  -- 記録を削除
  with deleted as (
    delete from media_attachments where expires_at < now() returning 1
  )
  select count(*) into v_count from deleted;

  return v_count;
end $$;

-- 自動実行（任意）：pg_cron を有効にしている場合だけ実行してください。
-- Supabase ダッシュボード > Database > Extensions で pg_cron を有効にしてから。
--
--   select cron.schedule(
--     'purge-expired-attachments',
--     '0 3 * * *',                      -- 毎日 03:00 (UTC)
--     $$select purge_expired_attachments()$$
--   );
--
-- 有効にしない場合は、ときどき手動で実行してください：
--   select purge_expired_attachments();


-- ------------------------------------------------------------
-- (4) 確認用
-- ------------------------------------------------------------
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id = 'attachments';
