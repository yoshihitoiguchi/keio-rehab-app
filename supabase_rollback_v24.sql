-- ============================================================
-- RE:SPRINT - v24 を戻す（パスワードの控えをやめ、控えを消す）
--   アプリ（v15.8）の「パスワードを確認」は「確認できません」と出るだけで、ほかは動く。
--   ログイン（ハッシュでの照合）には影響しない。
-- ============================================================

create or replace function public.resprint_set_coach_hash(p_org_id text, p_password text)
returns void
language sql volatile security definer set search_path = ''
as $fn$
  insert into public.app_settings (org_id, key, value, updated_at)
  values (p_org_id, 'coach_password_hash', public.resprint_coach_hash(p_password), now())
  on conflict (key, org_id) do update set value = excluded.value, updated_at = now();
$fn$;

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

-- 組織の削除は v15 の定義に戻す（データのある組織は削除できない動きに戻る）
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

drop function if exists public.admin_get_org_secrets(text);
drop schema if exists resprint_private cascade;

revoke all on function public.resprint_set_coach_hash(text, text) from public, anon, authenticated;
revoke all on function public.admin_create_org(text, text, text, text) from public, anon;
revoke all on function public.admin_set_org_password(text, text) from public, anon;
grant execute on function public.admin_create_org(text, text, text, text) to authenticated;
grant execute on function public.admin_set_org_password(text, text) to authenticated;
notify pgrst, 'reload schema';
