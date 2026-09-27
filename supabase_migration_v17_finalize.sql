-- ============================================================
-- RE:SPRINT - v17 後片付け（段階④：v15 アプリが数週間問題なく動いてから）
--
--   ■ これを実行すると、v13 のアプリには戻せなくなります。
--     （パスワードの保存形式が変わるため。v15 アプリには影響しません）
--
--   (1) 組織パスワードを bcrypt で保存するように切り替える
--       ・新しく作る組織、変更するパスワード … bcrypt
--       ・既存の組織 … 次にログインに成功したときに bcrypt へ置き換わる
--   (2) 一致率ビュー gate_check_agreement を削除（定義は退避しておく）
--       チェック記録そのもの（gate_item_checks）は残す
--   (3) v14 を誤って実行していた場合の admin_settings を削除
--
--   前提：段階①（v15_prepare）と段階③（v16_enforce）が適用済みであること。
--   全体が1つの文なので、「全部適用される」か「何も変わらない」かのどちらかになります。
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

do $v17$
begin
  -- (0) 実行してよい状態か
  if to_regprocedure('public.resprint_hash_password(text)') is null then
    raise exception '段階①（v15_prepare）が未適用です。';
  end if;
  if not exists (select 1 from pg_policies where policyname like 'resprint %') then
    raise exception '段階③（v16_enforce）が未適用です。先に v16 を実行してください。';
  end if;

  -- ------------------------------------------------------------
  -- (1) bcrypt への切り替え
  -- ------------------------------------------------------------
  create or replace function public.resprint_hash_password(p_password text)
  returns text
  language sql volatile security definer set search_path = ''
  as $fn$
    select extensions.crypt(public.resprint_js_trim(p_password), extensions.gen_salt('bf', 10));
  $fn$;

  create or replace function public.resprint_upgrade_org_hash(p_org_id text, p_password text, p_hash text)
  returns void
  language sql volatile security definer set search_path = ''
  as $fn$
    update public.organizations
       set password_hash = public.resprint_hash_password(p_password)
     where id = p_org_id
       and p_hash is not null
       and p_hash not like '$2%';
  $fn$;

  revoke all on function public.resprint_hash_password(text) from public, anon, authenticated;
  revoke all on function public.resprint_upgrade_org_hash(text, text, text) from public, anon, authenticated;

  -- ------------------------------------------------------------
  -- (2) 一致率ビューの削除（定義を退避してから）
  -- ------------------------------------------------------------
  if to_regclass('public.gate_check_agreement') is not null then
    insert into public.resprint_migration_backup (step, kind, schema_name, object_name, detail)
    values ('v17', 'view_definition', 'public', 'gate_check_agreement',
            jsonb_build_object('definition', pg_get_viewdef('public.gate_check_agreement'::regclass, true)));
    drop view public.gate_check_agreement;
  end if;

  -- ------------------------------------------------------------
  -- (3) v14 の管理者パスワード表（誰でも書き換えられる）を削除
  -- ------------------------------------------------------------
  drop table if exists public.admin_settings;

  perform pg_notify('pgrst', 'reload schema');
end
$v17$;

-- 確認用（読み取りのみ）：上3行が true なら完了。下は各組織のパスワード形式（旧形式は次回ログインで置き換わる）
select 'bcrypt で保存する' as item,
       ((select prosrc from pg_proc where oid = to_regprocedure('public.resprint_hash_password(text)')) like '%gen_salt%')::text as value
union all select 'gate_check_agreement を削除した', (to_regclass('public.gate_check_agreement') is null)::text
union all select 'admin_settings がない', (to_regclass('public.admin_settings') is null)::text
union all
select '組織 ' || id || '（' || coalesce(name, '') || '）',
       case when password_hash like '$2%' then 'bcrypt' when password_hash is null then '未設定' else 'sha256（旧形式）' end
  from public.organizations;
