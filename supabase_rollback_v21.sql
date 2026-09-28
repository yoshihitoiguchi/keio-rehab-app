-- ============================================================
-- RE:SPRINT - v21 を戻す（指導者パスワードの照合をアプリ側に戻す）
--   v15.4 以前のアプリを使う場合に必要。v15.5 以降のアプリは coach_check を使うので、アプリも戻すこと。
-- ============================================================
do $rb21$
begin
  drop policy if exists "resprint org read" on public.app_settings;
  drop policy if exists "resprint org insert" on public.app_settings;
  drop policy if exists "resprint org update" on public.app_settings;
  drop policy if exists "resprint org delete" on public.app_settings;
  create policy "resprint org read" on public.app_settings for select to authenticated using (public.resprint_is_member(org_id::text));
  create policy "resprint org insert" on public.app_settings for insert to authenticated with check (public.resprint_is_member(org_id::text));
  create policy "resprint org update" on public.app_settings for update to authenticated
    using (public.resprint_is_member(org_id::text)) with check (public.resprint_is_member(org_id::text));
  create policy "resprint org delete" on public.app_settings for delete to authenticated using (public.resprint_is_member(org_id::text));
  perform pg_notify('pgrst', 'reload schema');
end
$rb21$;
-- 関数（coach_check など）は残しても害はない。admin_create_org は4引数のままでも v15.4 のアプリから呼べる（4つ目は省略可）。
