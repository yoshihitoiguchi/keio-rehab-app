-- ============================================================
-- RE:SPRINT - v19 セキュリティ診断（Supabase Security Advisor）の指摘への対応
--
--   (1) protocol_phase_avg_duration（Phase 別の平均日数）を、見る人の権限で動くようにする。
--       これまでは全組織を横断した集計だったため、別のコミュニティの復帰日数が見えていた。
--       複数のコミュニティに組織を割り当てる運用なので、自分の組織の中だけの比較にする。
--   (2) purge_expired_attachments の search_path を固定する（関数の乗っ取り対策）。
--
--   戻し方：
--     alter view public.protocol_phase_avg_duration reset (security_invoker);
--     alter function public.purge_expired_attachments() reset search_path;
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

do $v19$
begin
  if to_regclass('public.protocol_phase_avg_duration') is not null then
    alter view public.protocol_phase_avg_duration set (security_invoker = true);
  end if;
  if to_regprocedure('public.purge_expired_attachments()') is not null then
    alter function public.purge_expired_attachments() set search_path = public, pg_temp;
  end if;
  perform pg_notify('pgrst', 'reload schema');
end
$v19$;

-- 確認用
select c.relname, c.reloptions from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relname = 'protocol_phase_avg_duration';
