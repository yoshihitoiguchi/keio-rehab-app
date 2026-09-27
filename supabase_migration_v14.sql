-- ############################################################
-- ## 実行しないでください（2026-09-27 追記）
-- ##
-- ## このファイルは本番DBに一度も適用されていません（2026-09-27 時点で
-- ## admin_settings が存在せず、gate_check_agreement が残っていることを確認）。
-- ## 下の (1) は「最初にアクセスした人が管理者パスワードを設定できる」方式で、
-- ## 誰でも管理者になれてしまいます。
-- ## 代わりに supabase_migration_v15_prepare.sql → v16_enforce → v17_finalize を
-- ## 順に使ってください（CLAUDE.md「v15〜v17 の本番反映手順」）。
-- ## 一致率ビューの削除は v17 で行います（v13 が使っているため、それまでは残す）。
-- ############################################################

-- ============================================================
-- RE:SPRINT - 差分マイグレーション v14
--   (1) 管理者タブ（組織の追加）用の設定テーブル
--   (2) 一致率ビューの削除
--
-- ※ ホーム画面アプリ（PWA）化と、ログイン状態の保存は
--    すべてアプリ側の変更です。データベースの変更は要りません。
-- ============================================================


-- ------------------------------------------------------------
-- (1) 管理者パスワード
--     組織より上の階層なので、organizations への外部キーを持たない
--     専用テーブルにします。
--     初期パスワードは置かず、最初にアクセスした人が設定します
--     （指導者パスワードと同じ流れ）。
-- ------------------------------------------------------------
create table if not exists admin_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

alter table admin_settings enable row level security;

drop policy if exists "admin_settings read" on admin_settings;
create policy "admin_settings read" on admin_settings for select using (true);

drop policy if exists "admin_settings write" on admin_settings;
create policy "admin_settings write" on admin_settings for all using (true) with check (true);


-- ------------------------------------------------------------
-- (2) 一致率ビューの削除
--     本人とスタッフの一致率は使わないことになったため。
--     チェックの記録そのもの（gate_item_checks）は残します。
-- ------------------------------------------------------------
drop view if exists gate_check_agreement;


-- ------------------------------------------------------------
-- (3) 確認用：登録済みの組織一覧
-- ------------------------------------------------------------
select
  o.id,
  o.name,
  (o.password_hash is not null) as has_password,
  (select count(*) from players p where p.org_id = o.id) as players,
  o.created_at
from organizations o
order by o.created_at;
