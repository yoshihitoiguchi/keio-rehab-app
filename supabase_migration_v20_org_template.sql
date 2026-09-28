-- ============================================================
-- RE:SPRINT - v20 新しい組織に、テンプレート（プロトコル・種目メニュー）をコピーする
--
--   (1) resprint_clone_template(元の組織, 新しい組織)
--       元の組織の protocols → exercises → exercise_steps、phase_menus を、新しい組織用にコピーする。
--       選手・日報・チャットなどの記録はコピーしない。
--       列は DB から読み取ってコピーするので、表に列が増えても動く。
--   (2) admin_create_org：組織を作ったら、'default' 組織の内容を自動でコピーする
--   (3) phase_menus の phase_number の制約「1〜5」を「1〜20」に広げる
--       （ハムストリングは10段階。PHASE 数はプロトコルごとに可変）
--
--   追加・置き換えだけで、既存の組織のデータには触りません。
--   戻し方：supabase_migration_v15_prepare.sql の admin_create_org を再実行し、
--           drop function public.resprint_clone_template(text, text);
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

do $v20$
declare
  con record;
begin
  -- (3) phase_menus の Phase 番号の上限
  for con in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.phase_menus'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%phase_number%'
  loop
    execute format('alter table public.phase_menus drop constraint %I', con.conname);
  end loop;
  alter table public.phase_menus
    add constraint phase_menus_phase_number_check check (phase_number >= 1 and phase_number <= 20);
end
$v20$;


create or replace function public.resprint_clone_template(p_src text, p_dst text)
returns json
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  pr record;
  ex record;
  st record;
  pm record;
  new_pid text;
  new_eid bigint;
  cols_pr text;
  cols_ex text;
  cols_st text;
  cols_pm text;
  n_pr int := 0;
  n_ex int := 0;
  n_st int := 0;
  n_pm int := 0;
begin
  if p_src is null or p_dst is null or p_src = p_dst then
    return json_build_object('protocols', 0, 'exercises', 0, 'steps', 0, 'menus', 0);
  end if;

  -- 自動採番（identity）の列は除く
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols_pr
    from information_schema.columns
   where table_schema = 'public' and table_name = 'protocols' and is_identity = 'NO';
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols_ex
    from information_schema.columns
   where table_schema = 'public' and table_name = 'exercises' and is_identity = 'NO';
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols_st
    from information_schema.columns
   where table_schema = 'public' and table_name = 'exercise_steps' and is_identity = 'NO';
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols_pm
    from information_schema.columns
   where table_schema = 'public' and table_name = 'phase_menus' and is_identity = 'NO';

  for pr in select p.id, to_jsonb(p) as j from public.protocols p where p.org_id = p_src order by p.id loop
    new_pid := left(p_dst || '-' || pr.id, 200);
    if exists (select 1 from public.protocols where id = new_pid) then
      continue;  -- すでにコピー済み
    end if;
    execute format('insert into public.protocols (%s) select %s from jsonb_populate_record(null::public.protocols, $1)',
                   cols_pr, cols_pr)
      using pr.j || jsonb_build_object('id', new_pid, 'org_id', p_dst, 'created_at', now());
    n_pr := n_pr + 1;

    for ex in select e.id, to_jsonb(e) as j from public.exercises e where e.protocol_id = pr.id order by e.id loop
      execute format('insert into public.exercises (%s) select %s from jsonb_populate_record(null::public.exercises, $1) returning id',
                     cols_ex, cols_ex)
        using ex.j || jsonb_build_object('protocol_id', new_pid, 'org_id', p_dst)
        into new_eid;
      n_ex := n_ex + 1;

      if cols_st is not null then
        for st in select to_jsonb(s) as j from public.exercise_steps s where s.exercise_id = ex.id loop
          execute format('insert into public.exercise_steps (%s) select %s from jsonb_populate_record(null::public.exercise_steps, $1)',
                         cols_st, cols_st)
            using st.j || jsonb_build_object('exercise_id', new_eid);
          n_st := n_st + 1;
        end loop;
      end if;
    end loop;

    if cols_pm is not null then
      for pm in select to_jsonb(m) as j from public.phase_menus m where m.protocol_id = pr.id loop
        execute format('insert into public.phase_menus (%s) select %s from jsonb_populate_record(null::public.phase_menus, $1)',
                       cols_pm, cols_pm)
          using pm.j || jsonb_build_object('protocol_id', new_pid, 'org_id', p_dst);
        n_pm := n_pm + 1;
      end loop;
    end if;
  end loop;

  return json_build_object('protocols', n_pr, 'exercises', n_ex, 'steps', n_st, 'menus', n_pm);
end
$fn$;

revoke all on function public.resprint_clone_template(text, text) from public, anon, authenticated;


-- (2) 組織の作成（管理者のみ）：作ったら 'default' のテンプレートをコピーする
create or replace function public.admin_create_org(p_id text, p_name text, p_password text)
returns json
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_id text := trim(coalesce(p_id, ''));
  v_name text := trim(coalesce(p_name, ''));
  v_pw text := public.resprint_js_trim(coalesce(p_password, ''));
  v_copied json;
begin
  if not public.resprint_is_admin() then
    raise exception '管理者の権限がありません' using errcode = '42501';
  end if;
  if v_id !~ '^[A-Za-z0-9_-]{2,40}$' then
    raise exception '組織IDは半角英数字・ハイフン・アンダースコアで2〜40文字にしてください' using errcode = '22023';
  end if;
  if v_name = '' or length(v_name) > 100 then
    raise exception '組織名は1〜100文字で入力してください' using errcode = '22023';
  end if;
  if length(v_pw) < 8 then
    raise exception '組織パスワードは8文字以上にしてください' using errcode = '22023';
  end if;
  if exists (select 1 from public.organizations o where lower(o.id) = lower(v_id)) then
    raise exception '組織ID「%」はすでに使われています', v_id using errcode = '23505';
  end if;

  begin
    insert into public.organizations (id, name, password_hash)
    values (v_id, v_name, public.resprint_hash_password(v_pw));
  exception when unique_violation then
    raise exception '組織ID「%」はすでに使われています', v_id using errcode = '23505';
  end;

  v_copied := public.resprint_clone_template('default', v_id);

  return json_build_object('id', v_id, 'name', v_name, 'copied', v_copied);
end
$fn$;

revoke all on function public.admin_create_org(text, text, text) from public, anon;
grant execute on function public.admin_create_org(text, text, text) to authenticated;

notify pgrst, 'reload schema';

-- 確認用
select 'resprint_clone_template()' as item, (to_regprocedure('public.resprint_clone_template(text,text)') is not null)::text as value
union all
select 'phase_menus の Phase 上限', pg_get_constraintdef(c.oid)
  from pg_constraint c where c.conrelid = 'public.phase_menus'::regclass and c.conname = 'phase_menus_phase_number_check';
