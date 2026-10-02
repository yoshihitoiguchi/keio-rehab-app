-- ============================================================
-- RE:SPRINT - v27 を戻す（プッシュ通知をやめる）
--   通知が止まるだけで、チャット・面談などの動きは変わらない。
--   アプリ（v15.10）の「通知を受け取る」は「登録できませんでした」と出るだけで、ほかは動く。
--   端末の登録（宛先）は消える。パスワードの控え（v24 の org_secrets）は残す。
-- ============================================================
do $rb27$
begin
  if to_regclass('public.messages') is not null then
    drop trigger if exists resprint_push_message on public.messages;
  end if;
  if to_regclass('public.consultation_requests') is not null then
    drop trigger if exists resprint_push_consultation on public.consultation_requests;
  end if;
  drop trigger if exists resprint_push_sos on public.players;
end
$rb27$;
drop function if exists public.push_subscribe(text, text, text, text, text, text);
drop function if exists public.push_unsubscribe(text, text);
drop function if exists public.push_status(text);
drop function if exists public.push_report_gone(text, text[]);
drop function if exists resprint_private.push_on_message();
drop function if exists resprint_private.push_on_consultation();
drop function if exists resprint_private.push_on_sos();
drop function if exists resprint_private.push_send(text, text, text, text, text);
drop function if exists resprint_private.push_endpoint_ok(text);
drop table if exists resprint_private.push_subscriptions;
drop table if exists resprint_private.push_config;
notify pgrst, 'reload schema';
