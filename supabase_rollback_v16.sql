-- ============================================================
-- RE:SPRINT - 段階③（v16_enforce）を戻す
--
--   v16 を実行する直前に退避した状態（resprint_migration_backup の step='v16'）に戻します。
--     ・v16 が作ったポリシー（名前が "resprint " で始まるもの）を消す
--     ・退避したポリシーを作り直す（v13 時代の using (true) など）
--     ・テーブル・ビューの権限、RLS の有効/無効、ビューの設定を元に戻す
--
--   戻したあとは、v15 アプリも v13 アプリも動きます（段階①の関数は残るため）。
--   v13 アプリに戻す場合は、このあと Vercel で v13 のデプロイに戻してください。
--
--   全体が1つの文なので、「全部戻る」か「何も変わらない」かのどちらかになります。
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

do $rb$
declare
  b record;
  pol record;
  roles text;
  stmt text;
  -- 段階①で足した管理用のテーブルと退避テーブル自身には触らない
  skip text[] := array['app_admins', 'org_memberships', 'org_login_failures', 'resprint_migration_backup'];
begin
  -- (0) 退避データがなければ、何も変えずに止まる
  if to_regclass('public.resprint_migration_backup') is null then
    raise exception '退避データ（resprint_migration_backup）がありません。v16 が未適用です。';
  end if;
  if not exists (select 1 from public.resprint_migration_backup where step = 'v16' and kind = 'policy') then
    raise exception '退避データ（resprint_migration_backup の v16）がありません。v16 が未適用か、退避が失われています。';
  end if;
  -- ④（v17）の後は戻さない：データが匿名キーで読める状態に戻るのに、v13 はもう動かないため
  if to_regprocedure('public.resprint_hash_password(text)') is not null
     and (select prosrc from pg_proc where oid = to_regprocedure('public.resprint_hash_password(text)')) like '%gen_salt%' then
    raise exception '段階④（v17）が適用済みのため、③は戻せません。問題があるときはアプリを以前の v15 のデプロイに戻してください（DB は戻さない）。';
  end if;

  -- (1) v16 が作ったポリシーを消す
  for pol in select schemaname, tablename, policyname from pg_policies
              where policyname like 'resprint %'
                and (schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects')) loop
    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;

  -- (2) 退避したポリシーを作り直す（同名が残っていれば作り直す）
  for b in select * from public.resprint_migration_backup
            where step = 'v16' and kind = 'policy'
              and not (schema_name = 'public' and object_name = any (skip)) order by id loop
    if to_regclass(format('%I.%I', b.schema_name, b.object_name)) is null then
      raise notice 'テーブル %.% がないため、ポリシー % は戻しません', b.schema_name, b.object_name, b.detail->>'policyname';
      continue;
    end if;
    execute format('drop policy if exists %I on %I.%I', b.detail->>'policyname', b.schema_name, b.object_name);
    select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ')
      into roles from jsonb_array_elements_text(b.detail->'roles') as r;
    stmt := format('create policy %I on %I.%I as %s for %s to %s',
                   b.detail->>'policyname', b.schema_name, b.object_name,
                   b.detail->>'permissive', b.detail->>'cmd', coalesce(roles, 'public'));
    if b.detail->>'qual' is not null then
      stmt := stmt || format(' using (%s)', b.detail->>'qual');
    end if;
    if b.detail->>'with_check' is not null then
      stmt := stmt || format(' with check (%s)', b.detail->>'with_check');
    end if;
    execute stmt;
  end loop;

  -- (3) RLS の有効/無効を戻す
  for b in select * from public.resprint_migration_backup
            where step = 'v16' and kind = 'rls' and object_name <> all (skip) loop
    if to_regclass(format('%I.%I', b.schema_name, b.object_name)) is null then continue; end if;
    if (b.detail->>'enabled')::boolean then
      execute format('alter table %I.%I enable row level security', b.schema_name, b.object_name);
    else
      execute format('alter table %I.%I disable row level security', b.schema_name, b.object_name);
    end if;
  end loop;

  -- (4) テーブル・ビューの権限を戻す：いったん外してから、退避していたとおりに付け直す
  for b in select distinct schema_name, object_name from public.resprint_migration_backup
            where step = 'v16' and kind in ('rls', 'view_options') and object_name <> all (skip) loop
    if to_regclass(format('%I.%I', b.schema_name, b.object_name)) is null then continue; end if;
    execute format('revoke all on %I.%I from anon, authenticated', b.schema_name, b.object_name);
  end loop;
  for b in select * from public.resprint_migration_backup
            where step = 'v16' and kind = 'table_grant' and object_name <> all (skip) loop
    if to_regclass(format('%I.%I', b.schema_name, b.object_name)) is null then continue; end if;
    execute format('grant %s on %I.%I to %I',
                   b.detail->>'privilege', b.schema_name, b.object_name, b.detail->>'grantee');
  end loop;

  -- (5) ビューの設定を、退避していたとおりに戻す
  for b in select * from public.resprint_migration_backup
            where step = 'v16' and kind = 'view_options' loop
    if to_regclass(format('%I.%I', b.schema_name, b.object_name)) is null then continue; end if;
    execute format('alter view %I.%I reset (security_invoker)', b.schema_name, b.object_name);
    if jsonb_array_length(b.detail->'reloptions') > 0 then
      execute format('alter view %I.%I set (%s)', b.schema_name, b.object_name,
                     (select string_agg(o, ', ') from jsonb_array_elements_text(b.detail->'reloptions') o));
    end if;
  end loop;

  -- (6) 期限切れ添付の削除関数の実行権限を戻す
  for b in select * from public.resprint_migration_backup
            where step = 'v16' and kind = 'function_grant' loop
    if to_regprocedure('public.purge_expired_attachments()') is null then continue; end if;
    if (b.detail->>'can_execute')::boolean then
      execute format('grant execute on function public.purge_expired_attachments() to %I', b.detail->>'grantee');
    end if;
  end loop;

  -- (7) 戻した記録（次に③を実行するとき、この後の v15 ログインがあるかを安全装置が確かめる）
  insert into public.resprint_migration_backup (step, kind, detail)
  values ('v16-rolled-back', 'marker', jsonb_build_object('at', now()));

  perform pg_notify('pgrst', 'reload schema');
end
$rb$;

-- 確認用：退避したポリシーの数と、いまあるポリシーの数（同じなら戻っている）
select 'ポリシー（退避していた数）' as item,
       (select count(*) from public.resprint_migration_backup where step = 'v16' and kind = 'policy') as n
union all
select 'ポリシー（いまの数。resprint 以外）',
       (select count(*) from pg_policies
         where (schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects'))
           and policyname not like 'resprint %'
           and policyname <> 'own memberships')
union all
select '未サインインで organizations を読めるか（1=読める=v13 が動く）',
       case when has_table_privilege('anon', 'public.organizations', 'select') then 1 else 0 end;
