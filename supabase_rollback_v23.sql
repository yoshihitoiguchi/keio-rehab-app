-- ============================================================
-- RE:SPRINT - v23 を戻す（指導者パスワードの変更記録をやめ、v21 の定義に戻す）
--   admin_list_orgs の追加項目がなくなるだけで、アプリ（v15.6 / v15.7）はどちらも動く。
-- ============================================================
do $rb23$
begin
  execute $f1$
    create or replace function public.resprint_set_coach_hash(p_org_id text, p_password text)
    returns void language sql volatile security definer set search_path = ''
    as $b$
      insert into public.app_settings (org_id, key, value)
      values (p_org_id, 'coach_password_hash', public.resprint_coach_hash(p_password))
      on conflict (key, org_id) do update set value = excluded.value;
    $b$
  $f1$;
  execute $f2$
    create or replace function public.coach_change_password(p_org_id text, p_current text, p_new text)
    returns boolean language plpgsql volatile security definer set search_path = ''
    as $b$
    declare v_check json;
    begin
      if length(public.resprint_js_trim(coalesce(p_new, ''))) < 4 then
        raise exception '新しいパスワードは4文字以上にしてください' using errcode = '22023';
      end if;
      v_check := public.coach_check(p_org_id, p_current);
      if not (v_check->>'ok')::boolean then return false; end if;
      perform public.resprint_set_coach_hash(p_org_id, p_new);
      return true;
    end
    $b$
  $f2$;
  execute $f3$
    create or replace function public.admin_set_coach_password(p_id text, p_password text)
    returns void language plpgsql volatile security definer set search_path = ''
    as $b$
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
    $b$
  $f3$;
  drop function if exists public.resprint_note_coach_change(text, text);
  delete from public.app_settings where key = 'coach_password_changed_by';

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
  perform pg_notify('pgrst', 'reload schema');
end
$rb23$;
-- admin_list_orgs は v23 の版のままでも害はない（追加の項目が空になるだけ）。
