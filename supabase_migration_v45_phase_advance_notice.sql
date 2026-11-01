-- ============================================================
-- RE:SPRINT - v45 選手が次の PHASE に進んだら、指導者に通知する
--
--   選手が「確認して次のPHASEへ進む」を押すと、アプリが phase_advances に1行入れる。
--   その行に合わせて、指導者（その組織で通知をオンにした端末）へ「選手が次の PHASE に進みました」を送る。
--   通知の文面に選手名・PHASE の番号は入れない（ロック画面に出るため）。
--
--   トリガーの追加だけ。表・列は変えない。公開中のアプリ（v15.38）はそのまま動く。
--   通知の送信に失敗しても、PHASE を進める書き込みは必ず成功する。
--   戻し方：drop trigger if exists resprint_push_phase_advance on public.phase_advances;
--           drop function if exists resprint_private.push_on_phase_advance();
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

do $v45push$
begin
  if to_regclass('public.phase_advances') is null
     or to_regprocedure('resprint_private.push_send(text, text, text, text, text)') is null then
    return;
  end if;
  execute $f$
    create or replace function resprint_private.push_on_phase_advance()
    returns trigger
    language plpgsql volatile security definer set search_path = ''
    as $fn$
    declare
      v_org text;
    begin
      select pl.org_id::text into v_org from public.players pl where pl.id = new.player_id;
      if v_org is null then
        return new;
      end if;
      perform resprint_private.push_send(v_org, 'coach', new.player_id, '選手が次の PHASE に進みました', 'phase');
      return new;
    exception when others then
      return new;
    end
    $fn$
  $f$;
  revoke all on function resprint_private.push_on_phase_advance() from public;
  drop trigger if exists resprint_push_phase_advance on public.phase_advances;
  create trigger resprint_push_phase_advance after insert on public.phase_advances
    for each row execute function resprint_private.push_on_phase_advance();
end
$v45push$;

notify pgrst, 'reload schema';

-- 確認用
select '通知のトリガー' as item, exists (select 1 from pg_trigger where tgname = 'resprint_push_phase_advance')::text as value;
