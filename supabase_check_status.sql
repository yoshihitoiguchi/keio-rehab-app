-- ============================================================
-- RE:SPRINT - 状態の確認（読み取りのみ。何も変更しません）
--
--   どの段階まで適用済みか、次の段階に進んでよいかを1つの表で返します。
--   患者のデータは読みません（件数・テーブル構成・設定だけ）。
--   SQL Editor でも、読み取り専用の MCP 接続（execute_sql）でも使えます。
--
--   見方：section ごとに item と value が並びます。
--     1 段階 … v12〜v17 のどこまで適用済みか
--     2 移行 … 段階①〜③の間に v15 アプリが使えるか（authenticated で読めるか）
--     3 表   … 各テーブルがどの単位で組織に結びつくか（段階③の RLS の作り方）
--     4 方針 … いま設定されているポリシー
--     5 組織 … パスワードの形式（ハッシュそのものは出さない）と選手数
--     6 その他
-- ============================================================

with
tbl as (
  select c.oid, c.relname::text as name, c.relrowsecurity as rls,
         bool_or(a.attname = 'org_id') as has_org,
         bool_or(a.attname = 'player_id') as has_player,
         bool_or(a.attname = 'protocol_id') as has_protocol
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
   where n.nspname = 'public' and c.relkind in ('r', 'p')
   group by c.oid, c.relname, c.relrowsecurity
),
pol as (
  select schemaname::text as sch, tablename::text as tbl, policyname::text as name,
         cmd::text as cmd, roles::text as roles,
         coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
    from pg_policies
   where schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects')
),
r as (
  -- 1 段階
  select 1 as sec, '1 段階' as section, 1 as ord, 'Postgres' as item, current_setting('server_version') as value
  union all select 1, '1 段階', 2, 'v12 reports.fear_level',
    (exists (select 1 from information_schema.columns where table_schema = 'public'
              and table_name = 'reports' and column_name = 'fear_level'))::text
  union all select 1, '1 段階', 3, 'v13 media_attachments', (to_regclass('public.media_attachments') is not null)::text
  union all select 1, '1 段階', 4, 'v14 admin_settings（無いのが正しい）', (to_regclass('public.admin_settings') is not null)::text
  union all select 1, '1 段階', 5, '① v15_prepare（org_login 関数）',
    (to_regprocedure('public.org_login(text,text)') is not null)::text
  union all select 1, '1 段階', 6, '③ v16_enforce（resprint のポリシー数）',
    (select count(*)::text from pol where name like 'resprint %')
  union all select 1, '1 段階', 7, '③ 未サインインで organizations を読めるか（v13 が動く条件）',
    has_table_privilege('anon', 'public.organizations', 'select')::text
  union all select 1, '1 段階', 8, '④ v17（bcrypt 保存に切り替え済み）',
    coalesce((select (prosrc like '%gen_salt%')::text from pg_proc
               where oid = to_regprocedure('public.resprint_hash_password(text)')), 'false')
  union all select 1, '1 段階', 9, 'gate_check_agreement（v13 が使う。④まで残す）',
    (to_regclass('public.gate_check_agreement') is not null)::text
  union all select 1, '1 段階', 10, '管理者の人数',
    case when to_regclass('public.app_admins') is null then '(未作成)'
         else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.app_admins', false, true, '')))[1]::text end
  union all select 1, '1 段階', 11, '組織ログインの件数（③の安全装置：1以上で実行可）',
    case when to_regclass('public.org_memberships') is null then '(未作成)'
         else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.org_memberships', false, true, '')))[1]::text end
  union all select 1, '1 段階', 12, '変更前の退避（v16）',
    case when to_regclass('public.resprint_migration_backup') is null then '(未作成)'
         else (xpath('/row/c/text()', query_to_xml(
           'select count(*) as c from public.resprint_migration_backup where step = ''v16''', false, true, '')))[1]::text end

  -- 2 移行：authenticated（v15 アプリ）が段階①〜③の間も読めるか
  union all
  select 2, '2 移行', 100 + row_number() over (order by t.name)::int, t.name,
         case
           when not has_any_column_privilege('authenticated', t.oid, 'select') then 'NG：authenticated に SELECT 権限なし'
           when t.rls and not exists (select 1 from pol p where p.sch = 'public' and p.tbl = t.name
                                        and p.cmd in ('SELECT', 'ALL')
                                        and (p.roles like '%public%' or p.roles like '%authenticated%'))
             then 'NG：authenticated に当てはまる SELECT ポリシーなし'
           else 'OK'
         end
    from tbl t
   where t.name not in ('app_admins', 'org_login_failures', 'resprint_migration_backup')

  -- 3 表：段階③での RLS の作り方
  union all
  select 3, '3 表', 200 + row_number() over (order by t.name)::int, t.name,
         case
           when t.name = 'organizations' then '組織（メンバーのみ読める・書き込みは管理者の関数のみ）'
           when t.name in ('app_admins', 'org_memberships', 'org_login_failures', 'resprint_migration_backup', 'admin_settings') then '管理用（対象外）'
           when t.has_player then '選手単位' || case when t.has_org then '＋組織一致' else '' end
           when t.has_org then '組織単位'
           when t.has_protocol then 'プロトコル単位'
           when t.name in ('exercise_steps', 'offsite_items') then '共通マスタ（読み取りのみ）'
           else '分類できない（③後はアプリから読み書きできない）← アプリが使う表なら要相談'
         end || ' / RLS=' || t.rls::text
    from tbl t

  -- 4 方針：いまのポリシー
  union all
  select 4, '4 方針', 300 + row_number() over (order by p.sch, p.tbl, p.name)::int,
         p.sch || '.' || p.tbl || ' : ' || p.name,
         p.cmd || ' to ' || p.roles || ' using(' || left(p.qual, 120) || ')'
         || case when p.with_check <> '' then ' check(' || left(p.with_check, 120) || ')' else '' end
    from pol p

  -- 5 組織：パスワードの形式と選手数（ハッシュそのものは出さない）
  union all
  select 5, '5 組織', 400 + row_number() over (order by o.id)::int, o.id::text || '（' || coalesce(o.name, '') || '）',
         case
           when o.password_hash is null then 'パスワード未設定'
           when o.password_hash like '$2%' then 'bcrypt'
           when lower(o.password_hash) ~ '^[0-9a-f]{64}$' then 'sha256（旧形式）'
           else 'sha256（旧形式・前後に空白や改行あり。ログインはできる）'
         end || ' / 選手 ' || (select count(*) from public.players p where p.org_id::text = o.id::text) || '名'
    from public.organizations o

  -- 6 その他
  union all select 6, '6 その他', 499, '組織のない共通プロトコル（読めるが書き換え不可になる）',
    (select count(*)::text from public.protocols where org_id is null)
  union all select 6, '6 その他', 500, 'org_id が空の選手（③後は誰からも見えない。0 が正しい）',
    (select count(*)::text from public.players where org_id is null)
  union all select 6, '6 その他', 501, 'ビュー（security_invoker）',
    (select string_agg(c.relname || '=' || coalesce(array_to_string(c.reloptions, ','), '-'), ', ' order by c.relname)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v')
  union all select 6, '6 その他', 502, 'attachments バケット',
    coalesce((select 'public=' || public::text || ' / 上限 ' || coalesce(file_size_limit::text, '-')
                from storage.buckets where id = 'attachments'), '(なし)')
)
select section, item, value from r order by sec, ord;
