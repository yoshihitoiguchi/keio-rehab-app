-- ============================================================
-- RE:SPRINT - v23 指導者パスワードの「最終変更日時と、誰が変えたか」を管理者が見られるようにする
--
--   指導者は自分で指導者パスワードを変えられる（今のパスワードの確認つき）。
--   管理者が気づけるように、最後に変えた日時と「管理者／指導者本人」を記録し、
--   管理者の組織一覧（admin_list_orgs）に出す。パスワードそのものは今までどおり保存しない（ハッシュのみ）。
--
--   ・resprint_set_coach_hash：保存のたびに app_settings.updated_at を更新
--   ・coach_change_password / admin_set_coach_password：app_settings に
--     'coach_password_changed_by'（'coach' または 'admin'）を記録
--   ・admin_list_orgs：coach_password_updated_at / coach_password_changed_by を追加（項目の追加だけ）
--
--   関数の引数・戻り値の形は変えないので、公開中のアプリ（v15.6）はそのまま動く。
--   戻し方：supabase_rollback_v23.sql（v21 の定義に戻す）
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

-- 本番にはすでにある列（古い環境のために念のため）
alter table public.app_settings add column if not exists updated_at timestamptz default now();

create or replace function public.resprint_set_coach_hash(p_org_id text, p_password text)
returns void
language sql volatile security definer set search_path = ''
as $fn$
  insert into public.app_settings (org_id, key, value, updated_at)
  values (p_org_id, 'coach_password_hash', public.resprint_coach_hash(p_password), now())
  on conflict (key, org_id) do update set value = excluded.value, updated_at = now();
$fn$;

create or replace function public.resprint_note_coach_change(p_org_id text, p_by text)
returns void
language sql volatile security definer set search_path = ''
as $fn$
  insert into public.app_settings (org_id, key, value, updated_at)
  values (p_org_id, 'coach_password_changed_by', p_by, now())
  on conflict (key, org_id) do update set value = excluded.value, updated_at = now();
$fn$;

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
  perform public.resprint_note_coach_change(p_org_id, 'coach');
  return true;
end
$fn$;

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
  perform public.resprint_note_coach_change(p_id, 'admin');
end
$fn$;

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
                  'coach_password_updated_at', (select s.updated_at from public.app_settings s
                                                 where s.org_id = o.id and s.key = 'coach_password_hash'),
                  'coach_password_changed_by', (select s.value from public.app_settings s
                                                 where s.org_id = o.id and s.key = 'coach_password_changed_by'),
                  'player_count', (select count(*) from public.players p where p.org_id::text = o.id)
                )
             order by o.id), '[]'::json)
      from public.organizations o
  );
end
$fn$;

revoke all on function public.resprint_set_coach_hash(text, text) from public, anon, authenticated;
revoke all on function public.resprint_note_coach_change(text, text) from public, anon, authenticated;
revoke all on function public.coach_change_password(text, text, text) from public, anon;
revoke all on function public.admin_set_coach_password(text, text) from public, anon;
revoke all on function public.admin_list_orgs() from public, anon;
grant execute on function public.coach_change_password(text, text, text) to authenticated;
grant execute on function public.admin_set_coach_password(text, text) to authenticated;
grant execute on function public.admin_list_orgs() to authenticated;

-- 記録の行（coach_password_changed_by）も、指導者パスワードの行と同じくアプリから読み書きできないようにする
do $v23$
begin
  drop policy if exists "resprint org read" on public.app_settings;
  drop policy if exists "resprint org insert" on public.app_settings;
  drop policy if exists "resprint org update" on public.app_settings;
  drop policy if exists "resprint org delete" on public.app_settings;
  create policy "resprint org read" on public.app_settings for select to authenticated
    using (public.resprint_is_member(org_id::text) and key not like 'coach\_password\_%');
  create policy "resprint org insert" on public.app_settings for insert to authenticated
    with check (public.resprint_is_member(org_id::text) and key not like 'coach\_password\_%');
  create policy "resprint org update" on public.app_settings for update to authenticated
    using (public.resprint_is_member(org_id::text) and key not like 'coach\_password\_%')
    with check (public.resprint_is_member(org_id::text) and key not like 'coach\_password\_%');
  create policy "resprint org delete" on public.app_settings for delete to authenticated
    using (public.resprint_is_member(org_id::text) and key not like 'coach\_password\_%');
end
$v23$;

notify pgrst, 'reload schema';

-- 確認用
select 'resprint_note_coach_change()' as item,
       (to_regprocedure('public.resprint_note_coach_change(text,text)') is not null)::text as value;
