-- ============================================================
-- RE:SPRINT - v35 日報の「本音」へのコメント・返信
--
--   report_comments：日報1件ごとのやり取り（チャットとは別）。
--     sender       'staff'（指導者）／'player'（選手本人の返信）
--     author_role  指導者の立場（coach / student_trainer / trainer / doctor）
--     author_name  書いた人の名前（誰からのコメントか分かるように）
--   読み書きできるのは、その選手と同じ組織の人だけ（ほかの選手ごとの表と同じ）。
--   通知：指導者のコメント → 選手へ「日報にコメントがあります」／選手の返信 → 指導者へ「選手から日報への返信があります」
--         （本文・名前は通知に入れない）
--
--   表の追加だけ。公開中のアプリ（v15.20）はそのまま動く。
--   戻し方：drop table public.report_comments; drop function resprint_private.push_on_report_comment();
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

create table if not exists public.report_comments (
  id bigint generated always as identity primary key,
  report_id bigint not null references public.reports(id) on delete cascade,
  player_id text not null references public.players(id) on delete cascade,
  sender text not null default 'staff' check (sender in ('staff', 'player')),
  author_role text,
  author_name text,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists report_comments_player_idx on public.report_comments (player_id, report_id, created_at);

do $v35rls$
begin
  alter table public.report_comments enable row level security;
  drop policy if exists "resprint org read" on public.report_comments;
  drop policy if exists "resprint org insert" on public.report_comments;
  drop policy if exists "resprint org delete" on public.report_comments;
  create policy "resprint org read" on public.report_comments for select to authenticated
    using (public.resprint_can_access_player(player_id::text));
  -- 日報と選手の組み合わせが合っている行だけ書ける
  create policy "resprint org insert" on public.report_comments for insert to authenticated
    with check (public.resprint_can_access_player(player_id::text)
                and exists (select 1 from public.reports r where r.id = report_id and r.player_id = report_comments.player_id));
  create policy "resprint org delete" on public.report_comments for delete to authenticated
    using (public.resprint_can_access_player(player_id::text));
  revoke all on public.report_comments from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.report_comments from anon;
  end if;
  revoke all on public.report_comments from authenticated;
  grant select, insert, delete on public.report_comments to authenticated;
end
$v35rls$;

-- 通知（v27 の仕組みがあるときだけ）
do $v35push$
begin
  if to_regprocedure('resprint_private.push_send(text, text, text, text, text)') is null then
    return;
  end if;
  execute $f$
    create or replace function resprint_private.push_on_report_comment()
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
      if new.sender = 'player' then
        perform resprint_private.push_send(v_org, 'coach', new.player_id, '選手から日報への返信があります', 'report-comment');
      else
        perform resprint_private.push_send(v_org, 'player', new.player_id, '日報にコメントがあります', 'report-comment');
      end if;
      return new;
    exception when others then
      return new;
    end
    $fn$
  $f$;
  revoke all on function resprint_private.push_on_report_comment() from public;
  drop trigger if exists resprint_push_report_comment on public.report_comments;
  create trigger resprint_push_report_comment after insert on public.report_comments
    for each row execute function resprint_private.push_on_report_comment();
end
$v35push$;

notify pgrst, 'reload schema';

-- 確認用
select 'report_comments' as item, (to_regclass('public.report_comments') is not null)::text as value
union all
select '通知のトリガー', exists (select 1 from pg_trigger where tgname = 'resprint_push_report_comment')::text;
