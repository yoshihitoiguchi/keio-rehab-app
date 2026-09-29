-- ============================================================
-- RE:SPRINT - v22 本番DBの「その時点の控え（スナップショット）」
--
--   アプリを更新するたびに、DB を変える前に控えを取っておき、
--   万一データを壊したときに、選手の記録を元に戻せるようにする。
--
--   ・控えは resprint_backup スキーマに入れる。このスキーマは API に公開されないので、
--     アプリ（匿名キー・ログイン中の利用者）からは読めない・書けない。
--   ・public の全テーブルの全行を、テーブルごとに JSON で保存する。
--     （ログイン失敗の記録と、移行時の退避テーブルは除く）
--   ・写真・動画のファイル（Storage）は対象外。
--   ・古い控えは新しい方から10回分だけ残して消す。
--
--   使い方（本番DBを変える前に、SQL Editor または書き込み用の接続から）：
--     select * from resprint_backup.take_snapshot('v23 の前');
--   控えの一覧：
--     select label, taken_at, count(*) as tables, sum(row_count) as rows
--       from resprint_backup.snapshots group by 1, 2 order by 2 desc;
--   戻し方（例：reports の消えた行だけを戻す）：
--     insert into public.reports overriding system value
--     select * from jsonb_populate_recordset(null::public.reports,
--       (select rows from resprint_backup.snapshots where label = 'v23 の前' and table_name = 'reports'))
--     on conflict do nothing;
--
--   追加だけで、既存のテーブル・アプリの動作には触りません。
--   戻し方：drop schema resprint_backup cascade;
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

create schema if not exists resprint_backup;
revoke all on schema resprint_backup from public;
do $v22$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema resprint_backup from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema resprint_backup from authenticated';
  end if;
end
$v22$;

create table if not exists resprint_backup.snapshots (
  id bigint generated always as identity primary key,
  label text not null,
  taken_at timestamptz not null default now(),
  table_name text not null,
  row_count integer not null,
  rows jsonb not null
);
create index if not exists snapshots_label_idx on resprint_backup.snapshots (label, table_name);
revoke all on resprint_backup.snapshots from public;


create or replace function resprint_backup.take_snapshot(p_label text, p_keep integer default 10)
returns table (table_name text, row_count integer)
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  t record;
  v_label text := coalesce(nullif(trim(p_label), ''), 'snapshot');
  v_now timestamptz := clock_timestamp();
  v_rows jsonb;
  v_n integer;
begin
  -- 同じ名前の控えがあれば、取り直す
  delete from resprint_backup.snapshots s where s.label = v_label;

  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and c.relname not in ('org_login_failures', 'resprint_migration_backup')
     order by c.relname
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb), count(*)::int from public.%I x', t.relname)
      into v_rows, v_n;
    insert into resprint_backup.snapshots (label, taken_at, table_name, row_count, rows)
    values (v_label, v_now, t.relname, v_n, v_rows);
    table_name := t.relname;
    row_count := v_n;
    return next;
  end loop;

  -- 新しい方から p_keep 回分だけ残す
  delete from resprint_backup.snapshots s
   where s.taken_at < (
     select min(k.taken_at) from (
       select distinct s2.taken_at from resprint_backup.snapshots s2
        order by s2.taken_at desc limit greatest(coalesce(p_keep, 10), 1)
     ) k
   );
end
$fn$;

revoke all on function resprint_backup.take_snapshot(text, integer) from public;
do $v22g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function resprint_backup.take_snapshot(text, integer) from anon';
    execute 'revoke all on all tables in schema resprint_backup from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function resprint_backup.take_snapshot(text, integer) from authenticated';
    execute 'revoke all on all tables in schema resprint_backup from authenticated';
  end if;
end
$v22g$;

-- 確認用
select 'resprint_backup.take_snapshot()' as item,
       (to_regprocedure('resprint_backup.take_snapshot(text,integer)') is not null)::text as value
union all
select 'アプリ（authenticated）から控えを読めない',
       (not has_schema_privilege('authenticated', 'resprint_backup', 'USAGE'))::text;
