-- ============================================================
-- RE:SPRINT - v16 締める（段階③：v15 アプリの公開・確認のあとに実行）
--
--   これまで：全テーブル using (true)（匿名キーだけで全組織を読み書きできた）
--   これから：組織ログインした利用者が、自分の組織の行だけ読み書きできる
--
--   ■ 実行すると、v13 のアプリはデータを読めなくなります。
--     必ず v15 アプリの公開と動作確認のあとに実行してください。
--     （安全装置：v15 アプリでの組織ログインが1件もなければ、何も変更せずに止まります）
--
--   ■ 実行前の設定（ポリシー・権限・RLS・ビューの設定）は、
--     public.resprint_migration_backup に自動で退避します。
--     戻すときは supabase_rollback_v16.sql を実行すると、退避した状態に戻ります。
--
--   ■ 全体が1つの文（DO ブロック）なので、SQL Editor・MCP のどちらから実行しても
--     「全部適用される」か「何も変わらない」かのどちらかになります（途中で止まった半端な状態にならない）。
--
--   冪等：何度実行しても同じ状態になります（退避は最初の1回だけ）。
-- ============================================================

do $v16$
declare
  -- 段階①で足した管理用のテーブルと退避テーブル自身は、退避・作り直しの対象外
  skip text[] := array['app_admins', 'org_memberships', 'org_login_failures', 'resprint_migration_backup'];
  t record;
  v record;
  pol record;
  cols text;
  has_org boolean;
  has_player boolean;
  has_protocol boolean;
  scope text;
  read_expr text;
  write_expr text;
  last_rollback timestamptz;
  -- どの列もないが、全組織共通のマスタとして読み取りだけ許すテーブル（それ以外は誰も読めない側に倒す）
  masters text[] := array['exercise_steps', 'offsite_items'];
  -- org_id が空の行を全組織共通で使うテーブル（読み取りだけ共通。書き込みは自分の組織の行だけ）
  -- 本番を確認した結果（2026-09-27）：offsite_domains 11件・offsite_items 70件がすべて共通
  shared_null_org text[] := array['offsite_domains', 'offsite_items'];
begin
  -- ----------------------------------------------------------
  -- (0) 実行してよい状態かの確認（1つでも満たさなければ、何も変更せずに止まる）
  -- ----------------------------------------------------------
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'Postgres 15 以上が必要です（現在 %）。ビューの security_invoker が使えません。',
      current_setting('server_version');
  end if;
  if to_regprocedure('public.org_login(text,text)') is null
     or to_regprocedure('public.resprint_can_access_player(text)') is null then
    raise exception '段階①（supabase_migration_v15_prepare.sql）が未適用です。先に実行してください。';
  end if;
  -- v15 アプリでの有効な組織ログインが必要。③を戻したことがあれば、戻した後のログインが必要
  --（戻した後に v13 へ切り替えていた場合に、古いログイン記録だけで素通りしないように）
  if to_regclass('public.resprint_migration_backup') is not null then
    select max(taken_at) into last_rollback
      from public.resprint_migration_backup where step = 'v16-rolled-back';
  end if;
  if not exists (select 1 from public.org_memberships m
                  where (m.expires_at is null or m.expires_at > now())
                    and (last_rollback is null or m.created_at > last_rollback
                         or m.expires_at > last_rollback + interval '30 days')) then
    raise exception 'v15 アプリでの組織ログインがまだありません（③を戻した後は、戻した後のログインが必要です）。v15 アプリを公開し、ログインできることを確認してから実行してください。';
  end if;

  -- ----------------------------------------------------------
  -- (1) 変更前の状態を退避（最初の1回だけ。2回目以降は上書きしない）
  -- ----------------------------------------------------------
  create table if not exists public.resprint_migration_backup (
    id bigint generated always as identity primary key,
    step text not null,
    kind text not null,          -- policy / table_grant / rls / view_options / function_grant
    schema_name text,
    object_name text,
    detail jsonb not null,
    taken_at timestamptz default now()
  );
  alter table public.resprint_migration_backup enable row level security;
  revoke all on public.resprint_migration_backup from anon, authenticated;

  -- ③が効いている間に再実行したときは、最初の退避を残す（効いた後の状態で上書きしない）。
  -- ③が効いていない（戻した後など）なら、古い退避は「使わない」印を付けて取り直す。
  if exists (select 1 from pg_policies where policyname like 'resprint %')
     and exists (select 1 from public.resprint_migration_backup where step = 'v16') then
    raise notice '③が有効で退避済みのため、退避はスキップします';
  else
    update public.resprint_migration_backup set step = 'v16-superseded' where step = 'v16';

    -- ポリシー（public のアプリのテーブル＋ Storage）
    insert into public.resprint_migration_backup (step, kind, schema_name, object_name, detail)
    select 'v16', 'policy', p.schemaname, p.tablename,
           jsonb_build_object('policyname', p.policyname, 'permissive', p.permissive,
                              'roles', to_jsonb(p.roles::text[]), 'cmd', p.cmd,
                              'qual', p.qual, 'with_check', p.with_check)
      from pg_policies p
     where (p.schemaname = 'public' and p.tablename <> all (skip))
        or (p.schemaname = 'storage' and p.tablename = 'objects');

    -- テーブル・ビューの権限（anon / authenticated）。ACL を直接読むので MAINTAIN なども漏れない
    insert into public.resprint_migration_backup (step, kind, schema_name, object_name, detail)
    select 'v16', 'table_grant', n.nspname, c.relname,
           jsonb_build_object('grantee', r.rolname, 'privilege', a.privilege_type)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) a
      join pg_roles r on r.oid = a.grantee
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
       and r.rolname in ('anon', 'authenticated')
       and c.relname <> all (skip);

    -- RLS の有効・無効
    insert into public.resprint_migration_backup (step, kind, schema_name, object_name, detail)
    select 'v16', 'rls', n.nspname, c.relname, jsonb_build_object('enabled', c.relrowsecurity)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and c.relname <> all (skip);

    -- ビューのオプション（security_invoker など）
    insert into public.resprint_migration_backup (step, kind, schema_name, object_name, detail)
    select 'v16', 'view_options', n.nspname, c.relname,
           jsonb_build_object('reloptions', to_jsonb(coalesce(c.reloptions, '{}'::text[])))
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v';

    -- 期限切れ添付の削除関数の実行権限
    insert into public.resprint_migration_backup (step, kind, schema_name, object_name, detail)
    select 'v16', 'function_grant', 'public', 'purge_expired_attachments()',
           jsonb_build_object('grantee', r.rolname,
             'can_execute', has_function_privilege(r.oid, 'public.purge_expired_attachments()', 'execute'))
      from pg_roles r
     where r.rolname in ('anon', 'authenticated')
       and to_regprocedure('public.purge_expired_attachments()') is not null;
  end if;

  -- ----------------------------------------------------------
  -- (2) organizations：自分がメンバーの組織だけ読める。password_hash は読めない。
  --     書き込みは管理者用の関数（admin_*）経由のみ。
  -- ----------------------------------------------------------
  alter table public.organizations enable row level security;
  for pol in select policyname from pg_policies
              where schemaname = 'public' and tablename = 'organizations' loop
    execute format('drop policy %I on public.organizations', pol.policyname);
  end loop;

  revoke all on public.organizations from anon, authenticated;
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'organizations'
     and column_name <> 'password_hash';
  execute format('grant select (%s) on public.organizations to authenticated', cols);

  create policy "resprint members read" on public.organizations
    for select to authenticated using (public.resprint_is_member(id));

  -- ----------------------------------------------------------
  -- (3) それ以外のテーブル：列を見て RLS を作る
  --     player_id を持つ   → 自分の組織の選手の行だけ（org_id もあれば一致も必須）
  --     org_id を持つ      → 自分の組織の行だけ
  --     protocol_id を持つ → 自分の組織（または共通）のプロトコルの行だけ
  --     どれも持たない     → 共通マスタとして読み取りのみ
  --     未サインイン（anon）→ 何も読めない（ポリシーは authenticated のみ）
  -- ----------------------------------------------------------
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and c.relname <> all (skip)
       and c.relname not in ('organizations', 'admin_settings')
     order by c.relname
  loop
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = t.relname loop
      execute format('drop policy %I on public.%I', pol.policyname, t.relname);
    end loop;
    execute format('alter table public.%I enable row level security', t.relname);

    select bool_or(column_name = 'org_id'),
           bool_or(column_name = 'player_id'),
           bool_or(column_name = 'protocol_id')
      into has_org, has_player, has_protocol
      from information_schema.columns
     where table_schema = 'public' and table_name = t.relname;

    if has_player then
      scope := 'public.resprint_can_access_player(player_id::text)';
      if has_org then
        scope := scope || ' and (org_id is null or public.resprint_is_member(org_id::text))';
      end if;
    elsif has_org then
      scope := 'public.resprint_is_member(org_id::text)';
    elsif has_protocol then
      scope := 'public.resprint_can_access_protocol(protocol_id::text)';
    else
      scope := null;
    end if;

    -- 書き込みの条件（読み取りより厳しくする場合）
    write_expr := scope;
    if not has_player and not has_org and has_protocol then
      -- 共通テンプレート（組織なし）のプロトコルに属する行は、読めるが書き換えられない
      write_expr := 'public.resprint_can_write_protocol(protocol_id::text)';
    end if;
    if t.relname = 'media_attachments' and has_player then
      -- 写真・動画の記録は、自分の選手のフォルダだけを指せる（他組織のファイルを消させない）
      write_expr := write_expr || ' and split_part(storage_path, ''/'', 1) = player_id::text';
      if exists (select 1 from information_schema.columns where table_schema = 'public'
                   and table_name = 'media_attachments' and column_name = 'expires_at') then
        write_expr := write_expr || ' and (expires_at is null or expires_at > now())';
      end if;
    end if;

    if scope is null and t.relname = any (masters) then
      execute format(
        'create policy "resprint master read" on public.%I for select to authenticated using (true)',
        t.relname);
      raise notice '% : 共通マスタとして読み取りのみ許可', t.relname;
    elsif scope is null then
      -- 分類できないテーブルは、誰も読み書きできない側に倒す（RLS 有効・ポリシーなし）
      raise notice '% : 組織に結びつく列がないため、アプリからは読み書きできません（必要なら個別にポリシーを追加）', t.relname;
    else
      read_expr := scope;
      -- オフサイトの領域・項目は org_id が空の行を全組織共通で使う
      if t.relname = any (shared_null_org) then
        read_expr := '(org_id is null or ' || scope || ')';
      end if;
      execute format(
        'create policy "resprint org read" on public.%I for select to authenticated using (%s)',
        t.relname, read_expr);
      execute format(
        'create policy "resprint org insert" on public.%I for insert to authenticated with check (%s)',
        t.relname, write_expr);
      execute format(
        'create policy "resprint org update" on public.%I for update to authenticated using (%s) with check (%s)',
        t.relname, write_expr, write_expr);
      execute format(
        'create policy "resprint org delete" on public.%I for delete to authenticated using (%s)',
        t.relname, write_expr);
      raise notice '% : %', t.relname, scope;
    end if;
  end loop;

  -- ----------------------------------------------------------
  -- (4) ビュー
  --   security_invoker = true にして、見る人の権限（＝自分の組織だけ）で動かす。
  --   例外：protocol_phase_avg_duration は全組織横断のフェーズ別平均日数（集計値）。
  --   どのビューも未サインインでは読めない。
  -- ----------------------------------------------------------
  for v in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('revoke all on public.%I from anon', v.relname);
    execute format('grant select on public.%I to authenticated', v.relname);
    if v.relname <> 'protocol_phase_avg_duration' then
      execute format('alter view public.%I set (security_invoker = true)', v.relname);
    end if;
  end loop;

  -- ----------------------------------------------------------
  -- (5) Storage（attachments バケット）
  --   パスの先頭（選手ID）が自分の組織の選手のときだけ、書き込み・削除・一覧を許可。
  --   ※ バケットは public のまま。公開URLを知っていれば見られる（残作業）。
  -- ----------------------------------------------------------
  drop policy if exists "attachments read" on storage.objects;
  drop policy if exists "attachments insert" on storage.objects;
  drop policy if exists "attachments delete" on storage.objects;

  drop policy if exists "resprint attachments read" on storage.objects;
  create policy "resprint attachments read" on storage.objects
    for select to authenticated
    using (bucket_id = 'attachments'
           and public.resprint_can_access_player((storage.foldername(name))[1]));

  drop policy if exists "resprint attachments insert" on storage.objects;
  create policy "resprint attachments insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'attachments'
                and public.resprint_can_access_player((storage.foldername(name))[1]));

  drop policy if exists "resprint attachments delete" on storage.objects;
  create policy "resprint attachments delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'attachments'
           and public.resprint_can_access_player((storage.foldername(name))[1]));

  -- ----------------------------------------------------------
  -- (6) 期限切れ添付の削除関数は、アプリからは呼べなくする
  --     （SQL Editor や pg_cron からは引き続き実行できる）
  -- ----------------------------------------------------------
  if to_regprocedure('public.purge_expired_attachments()') is not null then
    revoke all on function public.purge_expired_attachments() from public, anon, authenticated;
  end if;

  perform pg_notify('pgrst', 'reload schema');
end
$v16$;


-- ------------------------------------------------------------
-- (7) 確認用（読み取りのみ）
--   ・すべてのテーブルで rls_enabled = true
--   ・policies が 0 のテーブルは app_admins / org_login_failures /
--     resprint_migration_backup だけ
-- ------------------------------------------------------------
select c.relname::text as table_name,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       (select string_agg(p.policyname, ', ' order by p.policyname) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policy_names
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p')
union all
select '(未サインインで organizations を読めるか)', null,
       case when has_table_privilege('anon', 'public.organizations', 'select') then 1 else 0 end, null
order by 1;
