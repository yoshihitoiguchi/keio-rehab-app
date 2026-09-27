-- ============================================================
-- RE:SPRINT - v18 ログインの自動延長（追加だけ）
--
--   アプリを開くたびに、組織ログインの有効期限（30日）を延長する関数を追加します。
--   使い続けている限り、ログインし直しは不要になります。
--   30日以上開かなかった端末、組織パスワードが変更された組織の端末は、延長されません（ログインし直し）。
--
--   追加だけなので、今のアプリ（v15.1）には影響しません。
--   戻し方：drop function if exists public.org_renew(text);
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

create or replace function public.org_renew(p_org_id text)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $fn$
begin
  update public.org_memberships
     set expires_at = now() + interval '30 days'
   where user_id = auth.uid()
     and org_id = p_org_id
     and expires_at > now();
  return found;
end
$fn$;

revoke all on function public.org_renew(text) from public, anon, authenticated;
grant execute on function public.org_renew(text) to authenticated;

notify pgrst, 'reload schema';

-- 確認用
select 'org_renew()' as item, to_regprocedure('public.org_renew(text)') is not null as ok;
