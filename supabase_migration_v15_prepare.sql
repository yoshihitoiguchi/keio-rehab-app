-- ============================================================
-- RE:SPRINT - v15 準備（段階①：追加だけ。v13 はこれまでどおり動く）
--
--   このファイルは「足すだけ」です。既存のテーブル・ポリシー・ビュー・
--   Storage の設定には一切触りません。実行後も、いまの本番アプリ（v13）は
--   そのまま動きます。
--
--   追加するもの
--     (1) 管理者テーブル app_admins（所有者が SQL で登録する）
--     (2) 組織メンバー org_memberships / ログイン失敗 org_login_failures
--     (3) 権限を確かめる関数（段階③の RLS から使う）
--     (4) パスワードの保存と照合の関数
--     (5) ログイン・組織管理の関数（v15 アプリが /rest/v1/rpc/... で呼ぶ）
--
--   パスワードについて
--     段階④（v17）までは、v13 と同じ形式（SHA-256）で保存します。
--     こうしておくと、問題があったときに v13 のアプリへ戻しても、
--     新しく作った組織や変更したパスワードでそのままログインできます。
--     （ハッシュは段階③以降、アプリからは読めなくなります）
--
--   適用順
--     ① このファイル → ② v15 アプリ公開 → ③ v16_enforce → ④（数週間後）v17_finalize
--   戻し方
--     supabase_rollback_v15.sql（段階③を戻したあとでのみ）
--
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

create extension if not exists pgcrypto with schema extensions;


-- ------------------------------------------------------------
-- (1) 管理者
--     Supabase Auth のユーザーのうち、ここに登録された人だけが管理者。
--     登録は SQL Editor からのみ（supabase_setup_admin.sql）。
-- ------------------------------------------------------------
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz default now()
);
alter table public.app_admins enable row level security;
-- ポリシーを作らない＋権限を外す＝アプリからは読むことも書くこともできない
revoke all on public.app_admins from anon, authenticated;


-- ------------------------------------------------------------
-- (2) 組織メンバー・ログイン失敗の記録
-- ------------------------------------------------------------
create table if not exists public.org_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id text not null references public.organizations(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, org_id)
);
-- 組織ログインの有効期限（端末に保存するログインと同じ30日）。切れたらログインし直し
alter table public.org_memberships add column if not exists expires_at timestamptz default (now() + interval '30 days');
create index if not exists org_memberships_org_idx on public.org_memberships (org_id);
alter table public.org_memberships enable row level security;
revoke all on public.org_memberships from anon, authenticated;
grant select on public.org_memberships to authenticated;
drop policy if exists "own memberships" on public.org_memberships;
create policy "own memberships" on public.org_memberships
  for select to authenticated using (user_id = auth.uid());

create table if not exists public.org_login_failures (
  id bigint generated always as identity primary key,
  user_id uuid,
  org_id text,
  created_at timestamptz default now()
);
create index if not exists org_login_failures_user_idx on public.org_login_failures (user_id, created_at);
create index if not exists org_login_failures_org_idx on public.org_login_failures (org_id, created_at);
alter table public.org_login_failures enable row level security;
revoke all on public.org_login_failures from anon, authenticated;

-- 組織表への書き込みを止める（v13 は organizations を読むだけなので影響なし）。
-- v13 時代は誰でも組織のパスワードハッシュを書き換えられたため、移行期間中の乗っ取りを防ぐ。
-- 組織の作成・変更は、この後の管理者用の関数（security definer）だけが行う。
revoke insert, update, delete on public.organizations from anon, authenticated;


-- ------------------------------------------------------------
-- (3) 権限を確かめる関数
--     security definer：RLS の中から呼んでも無限ループにならないよう、
--     確認だけは所有者権限で行う。search_path は空にして乗っ取りを防ぐ。
-- ------------------------------------------------------------
create or replace function public.resprint_is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select exists (select 1 from public.app_admins a where a.user_id = auth.uid());
$fn$;

create or replace function public.resprint_is_member(p_org text)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select p_org is not null and exists (
    select 1 from public.org_memberships m
     where m.user_id = auth.uid() and m.org_id = p_org
       and (m.expires_at is null or m.expires_at > now())
  );
$fn$;

create or replace function public.resprint_can_access_player(p_player text)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select p_player is not null and exists (
    select 1
      from public.players p
      join public.org_memberships m on m.org_id = p.org_id::text
     where p.id::text = p_player and m.user_id = auth.uid()
       and (m.expires_at is null or m.expires_at > now())
  );
$fn$;

-- プロトコル：自分の組織のもの、または組織に属さない共通テンプレート
create or replace function public.resprint_can_access_protocol(p_protocol text)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select p_protocol is not null and exists (
    select 1 from public.protocols pr
     where pr.id::text = p_protocol
       and (pr.org_id is null or public.resprint_is_member(pr.org_id::text))
  );
$fn$;

-- プロトコルに属する行の書き込み：共通テンプレート（組織なし）は書き換えさせない
create or replace function public.resprint_can_write_protocol(p_protocol text)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select p_protocol is not null and exists (
    select 1 from public.protocols pr
     where pr.id::text = p_protocol
       and pr.org_id is not null
       and public.resprint_is_member(pr.org_id::text)
  );
$fn$;


-- ------------------------------------------------------------
-- (4) パスワードの保存と照合
--     ・照合は SHA-256（v13 方式）と bcrypt の両方に対応
--     ・保存は v17 まで SHA-256（v13 に戻せるように）。v17 で bcrypt に切り替える
--     ・v13 と同じく、前後の空白は取り除いてから扱う
-- ------------------------------------------------------------
-- JavaScript の trim() と同じ文字（空白・タブ・改行・全角スペースなど）を前後から除く。
-- v13 はパスワードも保存済みハッシュも JavaScript の trim() で整えてから比べていたため、それに合わせる。
create or replace function public.resprint_js_trim(p text)
returns text
language sql immutable set search_path = ''
as $fn$
  select btrim(p, chr(32) || chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(160) || chr(5760)
                  || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198)
                  || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239)
                  || chr(8287) || chr(12288) || chr(65279));
$fn$;

create or replace function public.resprint_hash_password(p_password text)
returns text
language sql immutable security definer set search_path = ''
as $fn$
  -- 段階④（v17）で bcrypt に置き換える
  select encode(extensions.digest(public.resprint_js_trim(p_password), 'sha256'), 'hex');
$fn$;

create or replace function public.resprint_check_password(p_password text, p_hash text)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
    when p_hash is null or public.resprint_js_trim(coalesce(p_password, '')) = '' then false
    when public.resprint_js_trim(p_hash) like '$2%'
      then extensions.crypt(public.resprint_js_trim(p_password), public.resprint_js_trim(p_hash)) = public.resprint_js_trim(p_hash)
    else lower(public.resprint_js_trim(p_hash)) = encode(extensions.digest(public.resprint_js_trim(p_password), 'sha256'), 'hex')
  end;
$fn$;

-- ログイン成功時に古い形式を新しい形式へ置き換える。v17 までは何もしない
create or replace function public.resprint_upgrade_org_hash(p_org_id text, p_password text, p_hash text)
returns void
language sql volatile security definer set search_path = ''
as $fn$
  select null::void;
$fn$;


-- ------------------------------------------------------------
-- (5) ログイン・組織管理
-- ------------------------------------------------------------

-- 組織ログイン
--   ・照合はサーバーの中だけで行い、ハッシュは外に出さない
--   ・失敗したときは null（組織IDが存在するかどうかも漏らさない）
--   ・同じ利用者は15分に10回まで。同じ組織への失敗は（利用者を変えても）15分に100回まで
--   ・成功すると30日間メンバーになる（再ログインで延長）
create or replace function public.org_login(p_org_id text, p_password text)
returns json
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_id text := trim(coalesce(p_org_id, ''));
  v_hash text;
  v_name text;
begin
  if v_uid is null then
    raise exception 'サインインしていません' using errcode = '28000';
  end if;

  -- 古い失敗記録は1日で消す
  delete from public.org_login_failures where created_at < now() - interval '1 day';

  if (select count(*) from public.org_login_failures f
       where f.user_id = v_uid and f.created_at > now() - interval '15 minutes') >= 10 then
    raise exception 'ログインの失敗が続いたため、15分ほど待ってからお試しください' using errcode = 'P0001';
  end if;
  -- 匿名ユーザーを作り直して回数制限をすり抜ける総当たりを防ぐ
  if (select count(*) from public.org_login_failures f
       where f.org_id = left(v_id, 80) and f.created_at > now() - interval '15 minutes') >= 100 then
    raise exception 'この組織へのログインの失敗が続いているため、15分ほど待ってからお試しください' using errcode = 'P0001';
  end if;

  select o.password_hash, o.name into v_hash, v_name
    from public.organizations o where o.id = v_id;

  if not public.resprint_check_password(p_password, v_hash) then
    insert into public.org_login_failures (user_id, org_id) values (v_uid, left(v_id, 80));
    return null;
  end if;

  perform public.resprint_upgrade_org_hash(v_id, p_password, v_hash);

  insert into public.org_memberships (user_id, org_id, expires_at)
  values (v_uid, v_id, now() + interval '30 days')
  on conflict (user_id, org_id) do update set expires_at = excluded.expires_at;

  return json_build_object('id', v_id, 'name', v_name);
end
$fn$;

-- 組織から抜ける（ログアウト時）
create or replace function public.org_leave(p_org_id text)
returns void
language sql volatile security definer set search_path = ''
as $fn$
  delete from public.org_memberships where user_id = auth.uid() and org_id = p_org_id;
$fn$;

-- 自分が管理者かどうか
create or replace function public.admin_whoami()
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select public.resprint_is_admin();
$fn$;

-- 組織の一覧（管理者のみ）。パスワードは「設定済みかどうか」だけ返す
create or replace function public.admin_list_orgs()
returns json
language plpgsql stable security definer set search_path = ''
as $fn$
begin
  if not public.resprint_is_admin() then
    raise exception '管理者の権限がありません' using errcode = '42501';
  end if;
  return (
    select coalesce(json_agg(
             (to_jsonb(o) - 'password_hash')
             || jsonb_build_object(
                  'has_password', o.password_hash is not null,
                  'player_count', (select count(*) from public.players p where p.org_id::text = o.id)
                )
             order by o.id), '[]'::json)
      from public.organizations o
  );
end
$fn$;

-- 組織の作成（管理者のみ）
create or replace function public.admin_create_org(p_id text, p_name text, p_password text)
returns json
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_id text := trim(coalesce(p_id, ''));
  v_name text := trim(coalesce(p_name, ''));
  v_pw text := trim(coalesce(p_password, ''));
begin
  if not public.resprint_is_admin() then
    raise exception '管理者の権限がありません' using errcode = '42501';
  end if;
  if v_id !~ '^[A-Za-z0-9_-]{2,40}$' then
    raise exception '組織IDは半角英数字・ハイフン・アンダースコアで2〜40文字にしてください' using errcode = '22023';
  end if;
  if v_name = '' or length(v_name) > 100 then
    raise exception '組織名は1〜100文字で入力してください' using errcode = '22023';
  end if;
  if length(v_pw) < 8 then
    raise exception '組織パスワードは8文字以上にしてください' using errcode = '22023';
  end if;
  -- 大文字・小文字だけ違うIDも重複として扱う（ログイン時の取り違え防止）
  if exists (select 1 from public.organizations o where lower(o.id) = lower(v_id)) then
    raise exception '組織ID「%」はすでに使われています', v_id using errcode = '23505';
  end if;

  begin
    insert into public.organizations (id, name, password_hash)
    values (v_id, v_name, public.resprint_hash_password(v_pw));
  exception when unique_violation then
    raise exception '組織ID「%」はすでに使われています', v_id using errcode = '23505';
  end;

  return json_build_object('id', v_id, 'name', v_name);
end
$fn$;

-- 組織パスワードの変更（管理者のみ）
create or replace function public.admin_set_org_password(p_id text, p_password text)
returns void
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_pw text := trim(coalesce(p_password, ''));
begin
  if not public.resprint_is_admin() then
    raise exception '管理者の権限がありません' using errcode = '42501';
  end if;
  if length(v_pw) < 8 then
    raise exception '組織パスワードは8文字以上にしてください' using errcode = '22023';
  end if;
  update public.organizations
     set password_hash = public.resprint_hash_password(v_pw)
   where id = p_id;
  if not found then
    raise exception '組織が見つかりません' using errcode = 'P0002';
  end if;
  -- パスワードを変えたら、それまでログインしていた端末は入り直しにする
  delete from public.org_memberships where org_id = p_id;
end
$fn$;

-- 組織の削除（管理者のみ）
create or replace function public.admin_delete_org(p_id text)
returns void
language plpgsql volatile security definer set search_path = ''
as $fn$
begin
  if not public.resprint_is_admin() then
    raise exception '管理者の権限がありません' using errcode = '42501';
  end if;
  delete from public.org_memberships where org_id = p_id;
  delete from public.organizations where id = p_id;
  if not found then
    raise exception '組織が見つかりません' using errcode = 'P0002';
  end if;
end
$fn$;


-- ------------------------------------------------------------
-- 関数の実行権限
--   アプリから呼ぶものだけ authenticated に許可する。
--   パスワード関連の内部関数はアプリから直接呼べないようにする。
-- ------------------------------------------------------------
do $grants$
declare
  f text;
begin
  foreach f in array array[
    'resprint_is_admin()', 'resprint_is_member(text)', 'resprint_can_access_player(text)',
    'resprint_can_access_protocol(text)', 'resprint_can_write_protocol(text)', 'resprint_hash_password(text)',
    'resprint_check_password(text, text)', 'resprint_upgrade_org_hash(text, text, text)',
    'org_login(text, text)', 'org_leave(text)', 'admin_whoami()', 'admin_list_orgs()',
    'admin_create_org(text, text, text)', 'admin_set_org_password(text, text)', 'admin_delete_org(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;

  -- RLS の中で使う判定用と、アプリが呼ぶもの
  foreach f in array array[
    'resprint_is_admin()', 'resprint_is_member(text)', 'resprint_can_access_player(text)',
    'resprint_can_access_protocol(text)', 'resprint_can_write_protocol(text)',
    'org_login(text, text)', 'org_leave(text)', 'admin_whoami()', 'admin_list_orgs()',
    'admin_create_org(text, text, text)', 'admin_set_org_password(text, text)', 'admin_delete_org(text)'
  ] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$grants$;


notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認用：すべて true なら段階①は完了
-- ------------------------------------------------------------
select 'app_admins' as item, to_regclass('public.app_admins') is not null as ok
union all select 'org_memberships', to_regclass('public.org_memberships') is not null
union all select 'org_login_failures', to_regclass('public.org_login_failures') is not null
union all select 'org_login()', to_regprocedure('public.org_login(text,text)') is not null
union all select 'admin_create_org()', to_regprocedure('public.admin_create_org(text,text,text)') is not null
union all select 'v13 用のポリシーは変更していない（resprint で始まるポリシーが0件）',
                 not exists (select 1 from pg_policies where policyname like 'resprint %');
