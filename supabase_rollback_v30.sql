-- ============================================================
-- RE:SPRINT - v30 を戻す
--   定期実行（リマインド・自動バックアップ）を止め、規約の同意・リマインドの記録を消す。
--   申し送りメモ（staff_notes）と種目の記録（exercise_logs）は、データが入っているので消さない
--   （消すときは手で： drop table public.staff_notes; drop table public.exercise_logs;）。
--   アプリ（v15.18）は、規約の同意画面が出なくなる以外はそのまま動く。
-- ============================================================
do $rb30$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname like 'resprint-%';
  end if;
end
$rb30$;
drop function if exists public.admin_set_terms(text);
drop function if exists public.admin_get_terms();
drop function if exists public.terms_status(text);
drop function if exists public.terms_accept(text, integer);
drop function if exists resprint_private.run_report_reminders();
drop function if exists resprint_private.run_meeting_reminders();
drop function if exists resprint_backup.daily();
drop table if exists resprint_private.terms_acceptances;
drop table if exists resprint_private.terms;
drop table if exists resprint_private.reminder_log;
notify pgrst, 'reload schema';
