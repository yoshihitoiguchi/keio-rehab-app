-- ============================================================
-- RE:SPRINT - v29 通知の文面をアプリの表記にそろえる（「スタッフ」→「指導者」）
--   SOS の通知：「選手からスタッフへの連絡（SOS）があります」→「選手から SOS の連絡があります」
--   関数の置き換えだけ。動きは変わらない。冪等。
--   戻し方：supabase_migration_v27_push.sql の push_on_sos を再実行。
-- ============================================================
create or replace function resprint_private.push_on_sos()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $fn$
begin
  if coalesce(new.sos, false) and not coalesce(old.sos, false) then
    perform resprint_private.push_send(new.org_id::text, 'coach', new.id, '選手から SOS の連絡があります', 'sos');
  end if;
  return new;
exception when others then
  return new;
end
$fn$;
revoke all on function resprint_private.push_on_sos() from public;

-- 確認用
select 'push_on_sos()' as item, (to_regprocedure('resprint_private.push_on_sos()') is not null)::text as value;
