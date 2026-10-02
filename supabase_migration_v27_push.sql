-- ============================================================
-- RE:SPRINT - v27 プッシュ通知（アプリを閉じていても届く通知）
--
--   しくみ：
--     1. 端末で「通知を受け取る」を押すと、その端末の宛先（Web Push の登録）を push_subscribe() で保存する。
--     2. チャット・面談の申し込み・SOS が DB に入ると、トリガーが宛先を集めて、
--        Vercel 上の送信役（/api/push）を pg_net で呼び出す。
--     3. 送信役が各端末へ通知を送る。使えなくなった宛先は push_report_gone() で消す。
--
--   通知の文面には、選手の名前・メッセージの本文・痛みの数値などを入れない（ロック画面に出るため）。
--     指導者へ：選手からのメッセージ／面談の予約／面談の申し込み／SOS
--     選手へ　：指導者からのメッセージ／面談が決まった
--
--   ・宛先と設定は resprint_private（API 非公開）に置く。アプリからは関数経由でしか触れない。
--   ・送信役の URL と合言葉は resprint_private.push_config に入れる（このファイルには書かない）。
--     設定がない間は、何も送らない（トリガーは何もしないで終わる）。
--   ・通知の送信に失敗しても、元の書き込み（チャットの送信など）は必ず成功する。
--
--   追加だけ。公開中のアプリ（v15.9）の動きは変わらない。
--   戻し方：supabase_rollback_v27.sql
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

-- 外へ HTTP を送るための拡張（Supabase では net スキーマに入る）。使えない環境では飛ばす
do $v27ext$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net を有効にできませんでした（通知は送られません）: %', sqlerrm;
end
$v27ext$;

create schema if not exists resprint_private;
revoke all on schema resprint_private from public;

create table if not exists resprint_private.push_config (
  key text primary key,
  value text not null
);

create table if not exists resprint_private.push_subscriptions (
  endpoint text not null,
  role text not null check (role in ('player', 'coach')),
  org_id text not null references public.organizations(id) on delete cascade,
  player_id text references public.players(id) on delete cascade,
  user_id uuid not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (endpoint, role)
);
create index if not exists push_subscriptions_org_idx on resprint_private.push_subscriptions (org_id, role);

-- 宛先として認めるのは、主要なブラウザの通知サービスだけ（勝手な URL へ送らせない）
create or replace function resprint_private.push_endpoint_ok(p_endpoint text)
returns boolean
language sql immutable set search_path = ''
as $fn$
  select length(p_endpoint) < 2000 and p_endpoint ~ '^https://([a-z0-9-]+\.)*(push\.apple\.com|googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)/'
$fn$;


-- 端末の登録（組織のメンバーだけ）
create or replace function public.push_subscribe(
  p_org_id text, p_role text, p_player_id text, p_endpoint text, p_p256dh text, p_auth text)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.resprint_is_member(p_org_id) then
    raise exception 'この組織にログインしていません' using errcode = '42501';
  end if;
  if p_role not in ('player', 'coach') then
    raise exception '通知の種類が正しくありません' using errcode = '22023';
  end if;
  if not resprint_private.push_endpoint_ok(coalesce(p_endpoint, ''))
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' or length(p_p256dh) > 300 or length(p_auth) > 100 then
    raise exception 'この端末の通知の登録を読み取れませんでした' using errcode = '22023';
  end if;
  if p_role = 'player' and not exists (
       select 1 from public.players pl where pl.id = p_player_id and pl.org_id::text = p_org_id) then
    raise exception '選手が見つかりません' using errcode = 'P0002';
  end if;

  insert into resprint_private.push_subscriptions (endpoint, role, org_id, player_id, user_id, p256dh, auth)
  values (p_endpoint, p_role, p_org_id, case when p_role = 'player' then p_player_id end, v_uid, p_p256dh, p_auth)
  on conflict (endpoint, role) do update
    set org_id = excluded.org_id, player_id = excluded.player_id, user_id = excluded.user_id,
        p256dh = excluded.p256dh, auth = excluded.auth, updated_at = now();
  return true;
end
$fn$;

-- 端末の登録をやめる（p_role を省くと、その端末の登録をすべて消す）
create or replace function public.push_unsubscribe(p_endpoint text, p_role text default null)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    return false;
  end if;
  delete from resprint_private.push_subscriptions s
   where s.endpoint = p_endpoint and (p_role is null or s.role = p_role);
  return true;
end
$fn$;

-- この端末が登録済みか（画面の表示用）
create or replace function public.push_status(p_endpoint text)
returns json
language sql stable security definer set search_path = ''
as $fn$
  select coalesce(json_agg(json_build_object('role', s.role, 'org_id', s.org_id, 'player_id', s.player_id)), '[]'::json)
    from resprint_private.push_subscriptions s
   where s.endpoint = p_endpoint and s.user_id = auth.uid()
$fn$;

-- 送信役からの報告：使えなくなった宛先を消す（合言葉が合っているときだけ）
create or replace function public.push_report_gone(p_secret text, p_endpoints text[])
returns integer
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_secret text;
  v_n integer;
begin
  select value into v_secret from resprint_private.push_config where key = 'secret';
  if v_secret is null or p_secret is null or v_secret <> p_secret then
    return 0;
  end if;
  delete from resprint_private.push_subscriptions s where s.endpoint = any (coalesce(p_endpoints, '{}'));
  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;


-- 送信：宛先を集めて、送信役を呼ぶ。何が起きても呼び出し元を失敗させない
--   p_role = 'coach' … その組織で通知をオンにした指導者の端末すべて
--   p_role = 'player' … その選手の端末
--   組織のメンバーでなくなった端末（期限切れ・パスワード変更後）には送らない
create or replace function resprint_private.push_send(
  p_org_id text, p_role text, p_player_id text, p_body text, p_tag text)
returns void
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_url text;
  v_secret text;
  v_subs jsonb;
begin
  select value into v_url from resprint_private.push_config where key = 'url';
  select value into v_secret from resprint_private.push_config where key = 'secret';
  if v_url is null or v_secret is null or to_regproc('net.http_post') is null then
    return;
  end if;

  select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
    into v_subs
    from resprint_private.push_subscriptions s
   where s.org_id = p_org_id and s.role = p_role
     and (p_role = 'coach' or s.player_id = p_player_id)
     and exists (select 1 from public.org_memberships m
                  where m.user_id = s.user_id and m.org_id = s.org_id and m.expires_at > now());
  if v_subs is null then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('subscriptions', v_subs, 'title', 'RE:SPRINT', 'body', p_body, 'tag', p_tag, 'url', '/'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-resprint-secret', v_secret),
    timeout_milliseconds := 8000
  );
exception when others then
  -- 通知が送れなくても、チャットの送信などは成功させる
  null;
end
$fn$;


-- チャット：選手 → 指導者へ／指導者 → その選手へ。面談の予約（【面談の予約】で始まる自動メッセージ）は双方へ
create or replace function resprint_private.push_on_message()
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
    if coalesce(new.content, '') like '【面談の予約】%' then
      perform resprint_private.push_send(v_org, 'coach', new.player_id, '面談が予約されました', 'meeting');
      perform resprint_private.push_send(v_org, 'player', new.player_id, '面談が決まりました', 'meeting');
    else
      perform resprint_private.push_send(v_org, 'coach', new.player_id, '選手から新しいメッセージがあります', 'message');
    end if;
  elsif new.sender = 'staff' then
    perform resprint_private.push_send(v_org, 'player', new.player_id, '指導者から新しいメッセージがあります', 'message');
  end if;
  return new;
exception when others then
  return new;
end
$fn$;

-- 面談の申し込み → 指導者へ
create or replace function resprint_private.push_on_consultation()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_org text;
begin
  select pl.org_id::text into v_org from public.players pl where pl.id = new.player_id;
  if v_org is not null then
    perform resprint_private.push_send(v_org, 'coach', new.player_id, '面談の申し込みがあります', 'consultation');
  end if;
  return new;
exception when others then
  return new;
end
$fn$;

-- SOS（選手からスタッフへの連絡）がオンになった → 指導者へ
create or replace function resprint_private.push_on_sos()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $fn$
begin
  if coalesce(new.sos, false) and not coalesce(old.sos, false) then
    perform resprint_private.push_send(new.org_id::text, 'coach', new.id, '選手からスタッフへの連絡（SOS）があります', 'sos');
  end if;
  return new;
exception when others then
  return new;
end
$fn$;

do $v27trg$
begin
  if to_regclass('public.messages') is not null then
    drop trigger if exists resprint_push_message on public.messages;
    create trigger resprint_push_message after insert on public.messages
      for each row execute function resprint_private.push_on_message();
  end if;
  if to_regclass('public.consultation_requests') is not null then
    drop trigger if exists resprint_push_consultation on public.consultation_requests;
    create trigger resprint_push_consultation after insert on public.consultation_requests
      for each row execute function resprint_private.push_on_consultation();
  end if;
  drop trigger if exists resprint_push_sos on public.players;
  create trigger resprint_push_sos after update of sos on public.players
    for each row execute function resprint_private.push_on_sos();
end
$v27trg$;


-- 権限：private の中身はアプリから触れない。公開する関数だけ許可する
do $v27grant$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema resprint_private from %I', r);
      execute format('revoke all on all tables in schema resprint_private from %I', r);
      execute format('revoke all on all functions in schema resprint_private from %I', r);
    end if;
  end loop;
end
$v27grant$;
revoke all on all tables in schema resprint_private from public;
revoke all on all functions in schema resprint_private from public;

revoke all on function public.push_subscribe(text, text, text, text, text, text) from public, anon;
revoke all on function public.push_unsubscribe(text, text) from public, anon;
revoke all on function public.push_status(text) from public, anon;
revoke all on function public.push_report_gone(text, text[]) from public;
grant execute on function public.push_subscribe(text, text, text, text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text, text) to authenticated;
grant execute on function public.push_status(text) to authenticated;
-- 送信役はログインせずに呼ぶ（合言葉で確かめる）
grant execute on function public.push_report_gone(text, text[]) to anon, authenticated;

notify pgrst, 'reload schema';

-- 確認用
select 'push_subscribe()' as item, (to_regprocedure('public.push_subscribe(text,text,text,text,text,text)') is not null)::text as value
union all select 'pg_net（送信に必要）', (to_regproc('net.http_post') is not null)::text
union all select '送信役の設定（url・secret）', (select count(*)::text from resprint_private.push_config where key in ('url', 'secret'))
union all select 'アプリから宛先の表を読めない', (not has_schema_privilege('authenticated', 'resprint_private', 'USAGE'))::text;
