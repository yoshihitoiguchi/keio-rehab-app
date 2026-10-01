-- ============================================================
-- RE:SPRINT - v24 管理者が、各組織の「組織パスワード」「指導者パスワード」を確認できるようにする
--               ＋ 組織の削除が失敗する不具合の修正（データごと削除する。default は削除不可）
--
--   これまで：パスワードは元に戻せない形（ハッシュ）だけを保存していたので、管理者でも確認できなかった。
--   これから：設定・変更のたびに、パスワードそのものを resprint_private.org_secrets にも控える。
--     ・resprint_private スキーマは API に公開されない。アプリ・選手・指導者からは読めない・書けない。
--     ・読めるのは、管理者としてログインした人が呼ぶ admin_get_org_secrets(組織ID) だけ。
--     ・作者の判断（2026-10-01）：管理者は所有者1人で、各施設にパスワードを伝え直す必要があるため。
--       DB を直接見られる人（Supabase のプロジェクトの所有者）には読める点に注意。
--   すでに設定済みのパスワードはハッシュしか残っていないので、表示できない（null）。
--   管理者が設定し直すか、指導者が自分で変更した時点から表示できる。
--   照合は今までどおりハッシュで行う（ログインの動きは変わらない）。
--
--   関数の引数・戻り値は変えないので、公開中のアプリ（v15.7）はそのまま動く。
--   戻し方：supabase_rollback_v24.sql
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

create schema if not exists resprint_private;
revoke all on schema resprint_private from public;

create table if not exists resprint_private.org_secrets (
  org_id text primary key references public.organizations(id) on delete cascade,
  org_password text,
  org_password_at timestamptz,
  coach_password text,
  coach_password_at timestamptz
);
revoke all on resprint_private.org_secrets from public;

-- 控えの保存（p_kind：'org' または 'coach'）
create or replace function resprint_private.save_secret(p_org_id text, p_kind text, p_password text)
returns void
language plpgsql volatile security definer set search_path = ''
as $fn$
begin
  if p_kind = 'org' then
    insert into resprint_private.org_secrets (org_id, org_password, org_password_at)
    values (p_org_id, p_password, now())
    on conflict (org_id) do update set org_password = excluded.org_password, org_password_at = now();
  elsif p_kind = 'coach' then
    insert into resprint_private.org_secrets (org_id, coach_password, coach_password_at)
    values (p_org_id, p_password, now())
    on conflict (org_id) do update set coach_password = excluded.coach_password, coach_password_at = now();
  end if;
end
$fn$;
revoke all on function resprint_private.save_secret(text, text, text) from public;

do $v24$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema resprint_private from %I', r);
      execute format('revoke all on all tables in schema resprint_private from %I', r);
      execute format('revoke all on function resprint_private.save_secret(text, text, text) from %I', r);
    end if;
  end loop;
end
$v24$;


-- 指導者パスワードの保存（設定・変更のすべての経路がここを通る）：ハッシュに加えて控えも残す
create or replace function public.resprint_set_coach_hash(p_org_id text, p_password text)
returns void
language plpgsql volatile security definer set search_path = ''
as $fn$
begin
  insert into public.app_settings (org_id, key, value, updated_at)
  values (p_org_id, 'coach_password_hash', public.resprint_coach_hash(p_password), now())
  on conflict (key, org_id) do update set value = excluded.value, updated_at = now();
  perform resprint_private.save_secret(p_org_id, 'coach', public.resprint_js_trim(coalesce(p_password, '')));
end
$fn$;


-- 組織の作成：組織パスワードの控えも残す（ほかは v21 と同じ）
create or replace function public.admin_create_org(p_id text, p_name text, p_password text, p_coach_password text default null)
returns json
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_id text := trim(coalesce(p_id, ''));
  v_name text := trim(coalesce(p_name, ''));
  v_pw text := public.resprint_js_trim(coalesce(p_password, ''));
  v_coach text := public.resprint_js_trim(coalesce(p_coach_password, ''));
  v_copied json;
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
  if v_coach <> '' and length(v_coach) < 4 then
    raise exception '指導者パスワードは4文字以上にしてください' using errcode = '22023';
  end if;
  if v_coach <> '' and v_coach = v_pw then
    raise exception '指導者パスワードは、組織パスワードと別のものにしてください' using errcode = '22023';
  end if;
  if exists (select 1 from public.organizations o where lower(o.id) = lower(v_id)) then
    raise exception '組織ID「%」はすでに使われています', v_id using errcode = '23505';
  end if;

  begin
    insert into public.organizations (id, name, password_hash)
    values (v_id, v_name, public.resprint_hash_password(v_pw));
  exception when unique_violation then
    raise exception '組織ID「%」はすでに使われています', v_id using errcode = '23505';
  end;

  perform resprint_private.save_secret(v_id, 'org', v_pw);

  if v_coach <> '' then
    perform public.resprint_set_coach_hash(v_id, v_coach);
  end if;

  v_copied := public.resprint_clone_template('default', v_id);

  return json_build_object('id', v_id, 'name', v_name, 'copied', v_copied, 'coach_password_set', v_coach <> '');
end
$fn$;


-- 組織パスワードの変更：控えも残す（ほかは v15 と同じ）
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
  perform resprint_private.save_secret(p_id, 'org', v_pw);
  -- パスワードを変えたら、それまでログインしていた端末は入り直しにする
  delete from public.org_memberships where org_id = p_id;
end
$fn$;


-- 組織の削除：その組織のデータ（選手・記録・プロトコル・種目・設定など）も一緒に消す
--   これまで：組織に1件でもデータがあると、DB の外部キーに阻まれて削除できなかった
--   （v20 から、新しい組織には必ずプロトコルと種目がコピーされるため、どの組織も削除できない状態だった）。
--   'default' は新しい組織のテンプレートの元なので、削除できないようにする。
--   写真・動画のファイル（Storage）は対象外（90日で消える設定）。
create or replace function public.admin_delete_org(p_id text)
returns void
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  t record;
begin
  if not public.resprint_is_admin() then
    raise exception '管理者の権限がありません' using errcode = '42501';
  end if;
  if p_id = 'default' then
    raise exception '「default」は新しい組織のテンプレートの元になっているため、削除できません' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations where id = p_id) then
    raise exception '組織が見つかりません' using errcode = 'P0002';
  end if;
  delete from public.org_memberships where org_id = p_id;
  -- 選手を先に消す（日報・チャットなど選手にひもづく記録は一緒に消える）
  delete from public.players where org_id::text = p_id;
  -- 組織を参照しているほかの表（プロトコル・種目・設定・面談の枠など）
  for t in
    select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.organizations'::regclass
       and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1
  loop
    execute format('delete from %s where %I::text = $1', t.tbl, t.col) using p_id;
  end loop;
  delete from public.organizations where id = p_id;
end
$fn$;


-- 管理者だけが読める：組織のID・パスワードの控え
create or replace function public.admin_get_org_secrets(p_id text)
returns json
language plpgsql stable security definer set search_path = ''
as $fn$
begin
  if not public.resprint_is_admin() then
    raise exception '管理者の権限がありません' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_id) then
    raise exception '組織が見つかりません' using errcode = 'P0002';
  end if;
  return (
    select json_build_object(
             'id', o.id,
             'name', o.name,
             'password', s.org_password,
             'password_at', s.org_password_at,
             'coach_password', s.coach_password,
             'coach_password_at', s.coach_password_at)
      from public.organizations o
      left join resprint_private.org_secrets s on s.org_id = o.id
     where o.id = p_id
  );
end
$fn$;

revoke all on function public.resprint_set_coach_hash(text, text) from public, anon, authenticated;
revoke all on function public.admin_create_org(text, text, text, text) from public, anon;
revoke all on function public.admin_set_org_password(text, text) from public, anon;
revoke all on function public.admin_get_org_secrets(text) from public, anon;
grant execute on function public.admin_create_org(text, text, text, text) to authenticated;
grant execute on function public.admin_set_org_password(text, text) to authenticated;
grant execute on function public.admin_get_org_secrets(text) to authenticated;
revoke all on function public.admin_delete_org(text) from public, anon;
grant execute on function public.admin_delete_org(text) to authenticated;

notify pgrst, 'reload schema';

-- 確認用
select 'admin_get_org_secrets()' as item, (to_regprocedure('public.admin_get_org_secrets(text)') is not null)::text as value
union all
select 'アプリ（authenticated）から控えの表を読めない', (not has_schema_privilege('authenticated', 'resprint_private', 'USAGE'))::text;
