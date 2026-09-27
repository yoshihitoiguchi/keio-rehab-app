-- ============================================================
-- RE:SPRINT - 段階①（v15_prepare）を戻す
--
--   段階①で追加した関数とテーブルを削除します。
--   v15 アプリはこれらを使うので、先に Vercel で v13 のデプロイに戻してから実行してください。
--
--   ・段階③（v16）が有効なままでは実行できません（先に supabase_rollback_v16.sql）。
--   ・段階④（v17）を実行済みの場合は戻せません（パスワードの形式が変わっているため）。
--   ・消えるもの：管理者の登録（app_admins）、組織ログインの記録、ログイン失敗の記録。
--     組織・選手などのデータには触りません。
--     段階①の期間に v15 アプリで作った組織・変更したパスワードは v13 の形式なので、
--     v13 でもそのままログインできます。
--
--   全体が1つの文なので、「全部戻る」か「何も変わらない」かのどちらかになります。
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

do $rb15$
begin
  -- (0) 戻してよい状態か
  if exists (select 1 from pg_policies where policyname like 'resprint %') then
    raise exception '段階③（v16）が有効です。先に supabase_rollback_v16.sql を実行してください。';
  end if;
  if to_regprocedure('public.resprint_hash_password(text)') is not null
     and (select prosrc from pg_proc where oid = to_regprocedure('public.resprint_hash_password(text)')) like '%gen_salt%' then
    raise exception '段階④（v17）が適用済みのため戻せません。';
  end if;

  -- (1) 追加した関数・テーブルを削除
  drop function if exists public.org_login(text, text);
  drop function if exists public.org_leave(text);
  drop function if exists public.admin_whoami();
  drop function if exists public.admin_list_orgs();
  drop function if exists public.admin_create_org(text, text, text);
  drop function if exists public.admin_set_org_password(text, text);
  drop function if exists public.admin_delete_org(text);
  drop function if exists public.resprint_upgrade_org_hash(text, text, text);
  drop function if exists public.resprint_check_password(text, text);
  drop function if exists public.resprint_hash_password(text);
  drop function if exists public.resprint_js_trim(text);
  drop function if exists public.resprint_can_write_protocol(text);
  drop function if exists public.resprint_can_access_protocol(text);
  drop function if exists public.resprint_can_access_player(text);
  drop function if exists public.resprint_is_member(text);
  drop function if exists public.resprint_is_admin();

  drop table if exists public.org_login_failures;
  drop table if exists public.org_memberships;
  drop table if exists public.app_admins;

  -- ①で止めた組織表への書き込み権限を、Supabase の初期状態に戻す
  grant insert, update, delete on public.organizations to anon, authenticated;

  perform pg_notify('pgrst', 'reload schema');
end
$rb15$;

-- 確認用：すべて false なら戻っている
select 'app_admins' as item, to_regclass('public.app_admins') is not null as still_exists
union all select 'org_memberships', to_regclass('public.org_memberships') is not null
union all select 'org_login()', to_regprocedure('public.org_login(text,text)') is not null;
