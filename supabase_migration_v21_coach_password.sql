-- ============================================================
-- RE:SPRINT - v21 指導者パスワードを管理者が決める・サーバー側で照合する
--
--   これまで：指導者パスワードのハッシュ（app_settings の coach_password_hash）は、
--             組織のメンバー（選手を含む）なら誰でも読めて、書き換えもできた。
--             未設定の組織では、最初に画面を開いた人が決められた。
--   これから：
--     ・管理者が、組織を作るときに指導者パスワードも決める（admin_create_org の4つ目の引数）
--     ・既存の組織は、管理者が admin_set_coach_password で設定・変更する
--     ・照合はサーバーの中だけ（coach_check）。ハッシュはアプリから読めない・書けない
--     ・指導者本人の変更は、今のパスワードを確かめてから（coach_change_password）
--     ・間違いは同じ利用者で15分に10回まで
--
--   ■ 本番への適用は2段階：前段（関数の追加）→ アプリ v15.5 公開 → 後段（ポリシーの切り替え）。
--     このファイルを一度に流してもよいが、その場合は v15.4 以前のアプリで指導者ログインができなくなる。
--
--   保存形式は今までと同じ（前後の空白を除いた SHA-256 の16進）。既存の指導者パスワードはそのまま使える。
--   戻し方：supabase_rollback_v21.sql
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

-- 指導者パスワードの保存形式（今までと同じ：前後の空白を除いて SHA-256 の16進）
create or replace function public.resprint_coach_hash(p_password text)
returns text
language sql immutable set search_path = ''
as $fn$
  select encode(extensions.digest(public.resprint_js_trim(coalesce(p_password, '')), 'sha256'), 'hex');
$fn$;

create or replace function public.resprint_set_coach_hash(p_org_id text, p_password text)
returns void
language sql volatile security definer set search_path = ''
as $fn$
  insert into public.app_settings (org_id, key, value)
  values (p_org_id, 'coach_password_hash', public.resprint_coach_hash(p_password))
  on conflict (key, org_id) do update set value = excluded.value;
$fn$;


-- 照合（組織のメンバーだけ）。{ set: 設定済みか, ok: 合っているか }
create or replace function public.coach_check(p_org_id text, p_password text)
returns json
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_ok boolean;
begin
  if not public.resprint_is_member(p_org_id) then
    raise exception 'この組織にログインしていません' using errcode = '42501';
  end if;
  if (select count(*) from public.org_login_failures f
       where f.user_id = v_uid and f.org_id = left('coach:' || p_org_id, 80)
         and f.created_at > now() - interval '15 minutes') >= 10 then
    raise exception '指導者パスワードの間違いが続いたため、15分ほど待ってからお試しください' using errcode = 'P0001';
  end if;

  select lower(public.resprint_js_trim(value)) into v_hash
    from public.app_settings where org_id = p_org_id and key = 'coach_password_hash';
  if v_hash is null or v_hash = '' then
    return json_build_object('set', false, 'ok', false);
  end if;

  -- パスワードが空なら「設定済みかどうか」を返すだけ（間違いには数えない）
  if public.resprint_js_trim(coalesce(p_password, '')) = '' then
    return json_build_object('set', true, 'ok', false);
  end if;
  v_ok := v_hash = public.resprint_coach_hash(p_password);
  if not v_ok then
    insert into public.org_login_failures (user_id, org_id) values (v_uid, left('coach:' || p_org_id, 80));
  end if;
  return json_build_object('set', true, 'ok', v_ok);
end
$fn$;


-- 指導者本人による変更（今のパスワードを確かめてから）
create or replace function public.coach_change_password(p_org_id text, p_current text, p_new text)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_check json;
begin
  if length(public.resprint_js_trim(coalesce(p_new, ''))) < 4 then
    raise exception '新しいパスワードは4文字以上にしてください' using errcode = '22023';
  end if;
  v_check := public.coach_check(p_org_id, p_current);
  if not (v_check->>'ok')::boolean then
    return false;
  end if;
  perform public.resprint_set_coach_hash(p_org_id, p_new);
  return true;
end
$fn$;


-- 管理者による設定・変更
create or replace function public.admin_set_coach_password(p_id text, p_password text)
returns void
language plpgsql volatile security definer set search_path = ''
as $fn$
begin
  if not public.resprint_is_admin() then
    raise exception '管理者の権限がありません' using errcode = '42501';
  end if;
  if length(public.resprint_js_trim(coalesce(p_password, ''))) < 4 then
    raise exception '指導者パスワードは4文字以上にしてください' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations where id = p_id) then
    raise exception '組織が見つかりません' using errcode = 'P0002';
  end if;
  perform public.resprint_set_coach_hash(p_id, p_password);
end
$fn$;


-- 組織の作成：指導者パスワードも一緒に決める（4つ目の引数。省略すると未設定のまま）
drop function if exists public.admin_create_org(text, text, text);
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

  if v_coach <> '' then
    perform public.resprint_set_coach_hash(v_id, v_coach);
  end if;

  v_copied := public.resprint_clone_template('default', v_id);

  return json_build_object('id', v_id, 'name', v_name, 'copied', v_copied, 'coach_password_set', v_coach <> '');
end
$fn$;


-- 組織一覧に「指導者パスワードが設定済みか」を足す
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
                  'has_coach_password', exists (select 1 from public.app_settings s
                                                 where s.org_id = o.id and s.key = 'coach_password_hash'
                                                   and coalesce(s.value, '') <> ''),
                  'player_count', (select count(*) from public.players p where p.org_id::text = o.id)
                )
             order by o.id), '[]'::json)
      from public.organizations o
  );
end
$fn$;


-- 実行権限
revoke all on function public.resprint_coach_hash(text) from public, anon, authenticated;
revoke all on function public.resprint_set_coach_hash(text, text) from public, anon, authenticated;
revoke all on function public.coach_check(text, text) from public, anon;
revoke all on function public.coach_change_password(text, text, text) from public, anon;
revoke all on function public.admin_set_coach_password(text, text) from public, anon;
revoke all on function public.admin_create_org(text, text, text, text) from public, anon;
revoke all on function public.admin_list_orgs() from public, anon;
grant execute on function public.coach_check(text, text) to authenticated;
grant execute on function public.coach_change_password(text, text, text) to authenticated;
grant execute on function public.admin_set_coach_password(text, text) to authenticated;
grant execute on function public.admin_create_org(text, text, text, text) to authenticated;
grant execute on function public.admin_list_orgs() to authenticated;

-- ------------------------------------------------------------
-- 【後段】app_settings のポリシーを、指導者パスワードの行を除く形に作り直す
--   公開中のアプリが coach_check を使う版（v15.5 以降）になってから適用すること。
--   （v15.4 以前のアプリは、この行を直接読んで照合しているため）
-- ------------------------------------------------------------
do $v21$
begin
  -- 今までの app_settings のポリシー（v16 で作ったもの）を、指導者パスワードの行を除く形に作り直す
  drop policy if exists "resprint org read" on public.app_settings;
  drop policy if exists "resprint org insert" on public.app_settings;
  drop policy if exists "resprint org update" on public.app_settings;
  drop policy if exists "resprint org delete" on public.app_settings;
  create policy "resprint org read" on public.app_settings for select to authenticated
    using (public.resprint_is_member(org_id::text) and key <> 'coach_password_hash');
  create policy "resprint org insert" on public.app_settings for insert to authenticated
    with check (public.resprint_is_member(org_id::text) and key <> 'coach_password_hash');
  create policy "resprint org update" on public.app_settings for update to authenticated
    using (public.resprint_is_member(org_id::text) and key <> 'coach_password_hash')
    with check (public.resprint_is_member(org_id::text) and key <> 'coach_password_hash');
  create policy "resprint org delete" on public.app_settings for delete to authenticated
    using (public.resprint_is_member(org_id::text) and key <> 'coach_password_hash');
end
$v21$;

notify pgrst, 'reload schema';

-- 確認用
select 'coach_check()' as item, (to_regprocedure('public.coach_check(text,text)') is not null)::text as value
union all select 'admin_create_org(4引数)', (to_regprocedure('public.admin_create_org(text,text,text,text)') is not null)::text
union all select 'app_settings の指導者パスワード行をアプリから読めない',
  (select string_agg(policyname || ':' || coalesce(qual, ''), ' | ') from pg_policies where tablename = 'app_settings');
