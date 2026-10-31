-- ============================================================
-- RE:SPRINT - v39 日報へのリアクション
--
--   report_reactions：日報1件に、指導者が立場ごとにリアクションを付ける（返事を書く手間を減らすため）。
--     author_role  付けた人の立場（coach / student_trainer / trainer / doctor）
--     kind         リアクションの種類（seen 確認しました / good いいね / cheer がんばろう）
--   同じ日報・同じ立場・同じ種類は1件だけ（もう一度押すと取り消し＝行の削除）。
--   読み書きできるのは、その選手と同じ組織の人だけ（ほかの選手ごとの表と同じ）。
--   通知：付いたとき選手へ「日報にリアクションがあります」（立場・種類は通知に入れない）
--
--   表の追加だけ。公開中のアプリ（v15.25）はそのまま動く。
--   戻し方：drop table public.report_reactions; drop function resprint_private.push_on_report_reaction();
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

create table if not exists public.report_reactions (
  id bigint generated always as identity primary key,
  report_id bigint not null references public.reports(id) on delete cascade,
  player_id text not null references public.players(id) on delete cascade,
  author_role text not null check (author_role in ('coach', 'student_trainer', 'trainer', 'doctor')),
  kind text not null check (kind in ('seen', 'good', 'cheer')),
  created_at timestamptz not null default now(),
  unique (report_id, author_role, kind)
);
create index if not exists report_reactions_player_idx on public.report_reactions (player_id, report_id);

do $v39rls$
begin
  alter table public.report_reactions enable row level security;
  drop policy if exists "resprint org read" on public.report_reactions;
  drop policy if exists "resprint org insert" on public.report_reactions;
  drop policy if exists "resprint org delete" on public.report_reactions;
  create policy "resprint org read" on public.report_reactions for select to authenticated
    using (public.resprint_can_access_player(player_id::text));
  -- 日報と選手の組み合わせが合っている行だけ書ける
  create policy "resprint org insert" on public.report_reactions for insert to authenticated
    with check (public.resprint_can_access_player(player_id::text)
                and exists (select 1 from public.reports r where r.id = report_id and r.player_id = report_reactions.player_id));
  create policy "resprint org delete" on public.report_reactions for delete to authenticated
    using (public.resprint_can_access_player(player_id::text));
  revoke all on public.report_reactions from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.report_reactions from anon;
  end if;
  revoke all on public.report_reactions from authenticated;
  grant select, insert, delete on public.report_reactions to authenticated;
end
$v39rls$;

-- 通知（v27 の仕組みがあるときだけ）
do $v39push$
begin
  if to_regprocedure('resprint_private.push_send(text, text, text, text, text)') is null then
    return;
  end if;
  execute $f$
    create or replace function resprint_private.push_on_report_reaction()
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
      perform resprint_private.push_send(v_org, 'player', new.player_id, '日報にリアクションがあります', 'report-reaction');
      return new;
    exception when others then
      return new;
    end
    $fn$
  $f$;
  revoke all on function resprint_private.push_on_report_reaction() from public;
  drop trigger if exists resprint_push_report_reaction on public.report_reactions;
  create trigger resprint_push_report_reaction after insert on public.report_reactions
    for each row execute function resprint_private.push_on_report_reaction();
end
$v39push$;

notify pgrst, 'reload schema';

-- 確認用
select 'report_reactions' as item, (to_regclass('public.report_reactions') is not null)::text as value
union all
select '通知のトリガー', exists (select 1 from pg_trigger where tgname = 'resprint_push_report_reaction')::text;
