-- ============================================================
-- RE:SPRINT - v28 引き継ぎコード（ブラウザ → ホーム画面のアプリへ、ログインを引き継ぐ）
--
--   iPhone は、Safari とホーム画面のアプリでログインが別になる。
--   ホーム画面に追加したあと、パスワードや暗証番号を入れ直さずに済むよう、
--   ブラウザ側で8桁のコードを作り、ホーム画面のアプリに貼り付けると、
--   組織のログイン（と、選手のログイン）がそのまま引き継がれるようにする。
--
--   ・transfer_create(組織ID, 選手ID)：いまログインしている端末がコードを作る（30分だけ有効）
--   ・transfer_redeem(コード)：別の端末（ホーム画面のアプリ）がコードを使う。
--       その端末が組織のメンバーになり、選手の ID と名前が返る。期限内なら何度でも使える（貼り直しのため）。
--   ・間違いは同じ利用者で15分に10回まで（組織ログインと共通）、全体で15分に200回まで。
--   ・コードは resprint_private（API 非公開）に置く。アプリからは関数経由でしか触れない。
--
--   追加だけ。公開中のアプリ（v15.10）の動きは変わらない。
--   戻し方：drop function public.transfer_create(text, text); drop function public.transfer_redeem(text);
--           drop table resprint_private.transfer_codes;
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

create schema if not exists resprint_private;
revoke all on schema resprint_private from public;

create table if not exists resprint_private.transfer_codes (
  code text primary key,
  org_id text not null references public.organizations(id) on delete cascade,
  player_id text references public.players(id) on delete cascade,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create or replace function public.transfer_create(p_org_id text, p_player_id text default null)
returns json
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_expires timestamptz := now() + interval '30 minutes';
begin
  if v_uid is null or not public.resprint_is_member(p_org_id) then
    raise exception 'この組織にログインしていません' using errcode = '42501';
  end if;
  if p_player_id is not null and not exists (
       select 1 from public.players pl where pl.id = p_player_id and pl.org_id::text = p_org_id) then
    raise exception '選手が見つかりません' using errcode = 'P0002';
  end if;

  -- 期限切れと、この端末が前に作ったコードは消す
  delete from resprint_private.transfer_codes t where t.expires_at < now() or t.created_by = v_uid;

  loop
    -- 8桁の数字（先頭が 0 にならないようにする）
    v_code := (10000000 + (('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 90000000))::text;
    begin
      insert into resprint_private.transfer_codes (code, org_id, player_id, created_by, expires_at)
      values (v_code, p_org_id, p_player_id, v_uid, v_expires);
      exit;
    exception when unique_violation then
      -- まれに重なったら作り直す
      null;
    end;
  end loop;

  return json_build_object('code', v_code, 'expires_at', v_expires);
end
$fn$;

create or replace function public.transfer_redeem(p_code text)
returns json
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_code text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  t record;
begin
  if v_uid is null then
    raise exception 'サインインしていません' using errcode = '28000';
  end if;
  if (select count(*) from public.org_login_failures f
       where f.user_id = v_uid and f.created_at > now() - interval '15 minutes') >= 10 then
    raise exception '間違いが続いたため、15分ほど待ってからお試しください' using errcode = 'P0001';
  end if;
  if (select count(*) from public.org_login_failures f
       where f.org_id = 'transfer' and f.created_at > now() - interval '15 minutes') >= 200 then
    raise exception '引き継ぎコードの間違いが続いているため、15分ほど待ってからお試しください' using errcode = 'P0001';
  end if;

  select c.org_id, c.player_id into t
    from resprint_private.transfer_codes c
   where c.code = v_code and c.expires_at > now();
  if not found then
    insert into public.org_login_failures (user_id, org_id) values (v_uid, 'transfer');
    return null;
  end if;

  insert into public.org_memberships (user_id, org_id, expires_at)
  values (v_uid, t.org_id, now() + interval '30 days')
  on conflict (user_id, org_id) do update set expires_at = excluded.expires_at;

  return json_build_object(
    'org', (select json_build_object('id', o.id, 'name', o.name) from public.organizations o where o.id = t.org_id),
    'player', (select json_build_object('id', pl.id, 'name', pl.name) from public.players pl where pl.id = t.player_id)
  );
end
$fn$;

do $v28grant$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema resprint_private from %I', r);
      execute format('revoke all on all tables in schema resprint_private from %I', r);
    end if;
  end loop;
end
$v28grant$;
revoke all on all tables in schema resprint_private from public;
revoke all on function public.transfer_create(text, text) from public, anon;
revoke all on function public.transfer_redeem(text) from public, anon;
grant execute on function public.transfer_create(text, text) to authenticated;
grant execute on function public.transfer_redeem(text) to authenticated;

notify pgrst, 'reload schema';

-- 確認用
select 'transfer_create()' as item, (to_regprocedure('public.transfer_create(text,text)') is not null)::text as value
union all select 'transfer_redeem()', (to_regprocedure('public.transfer_redeem(text)') is not null)::text;
