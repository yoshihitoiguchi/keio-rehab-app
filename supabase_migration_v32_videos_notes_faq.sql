-- ============================================================
-- RE:SPRINT - v32 種目の動画・面談メモ・よくある質問／Tantrums の GATE を変更
--
--   (1) exercises.video_url     種目の動きを確認する動画の URL（指導者が登録。なければアプリが YouTube の検索を開く）
--   (2) meeting_notes           面談の内容のメモ（指導者が書き、選手本人と指導者が読む）
--   (3) protocols.faq           よくある質問（[{ "q": "...", "a": "..." }]。プロトコルごと。指導者が編集）
--   (4) データ（作者の指示 2026-10-06）
--       ・Prone Hamstring Tantrums：PHASE 8 → 9 の GATE を「50回×3set を違和感なく実施可能」に。種目のステップに 50回×3set を追加
--       ・よくある質問を2件登録（ミニハードルの「狭め」／ウエイトの解禁）。関係する種目のメモにも同じ内容を添える
--
--   列・表の追加と、ハムストリング肉離れのプロトコルのデータの変更だけ。公開中のアプリ（v15.18）はそのまま動く。
--   戻し方：実行前の控え「v32 の前」から protocols・exercises・exercise_steps を戻す。
--           列と表は残しても害はない（消すなら alter table ... drop column / drop table public.meeting_notes）。
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

alter table public.exercises add column if not exists video_url text;
alter table public.protocols add column if not exists faq jsonb not null default '[]'::jsonb;

create table if not exists public.meeting_notes (
  id bigint generated always as identity primary key,
  player_id text not null references public.players(id) on delete cascade,
  held_on date,
  author_role text,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists meeting_notes_player_idx on public.meeting_notes (player_id, held_on);

do $v32rls$
begin
  alter table public.meeting_notes enable row level security;
  drop policy if exists "resprint org read" on public.meeting_notes;
  drop policy if exists "resprint org insert" on public.meeting_notes;
  drop policy if exists "resprint org update" on public.meeting_notes;
  drop policy if exists "resprint org delete" on public.meeting_notes;
  create policy "resprint org read" on public.meeting_notes for select to authenticated
    using (public.resprint_can_access_player(player_id::text));
  create policy "resprint org insert" on public.meeting_notes for insert to authenticated
    with check (public.resprint_can_access_player(player_id::text));
  create policy "resprint org update" on public.meeting_notes for update to authenticated
    using (public.resprint_can_access_player(player_id::text)) with check (public.resprint_can_access_player(player_id::text));
  create policy "resprint org delete" on public.meeting_notes for delete to authenticated
    using (public.resprint_can_access_player(player_id::text));
  revoke all on public.meeting_notes from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.meeting_notes from anon;
  end if;
  grant select, insert, update, delete on public.meeting_notes to authenticated;
end
$v32rls$;


-- ---------- (4) データ：ハムストリング肉離れのプロトコル ----------
do $v32data$
declare
  p record;
  v_gate constant text := 'Prone Hamstring Tantrums 50回×3setを違和感なく実施可能';
  v_faq constant jsonb := jsonb_build_array(
    jsonb_build_object('q', 'Mini Hurdle の「狭め」はどのくらい？', 'a', '身長と同じくらいの幅です。'),
    jsonb_build_object('q', 'ウエイトはいつから解禁？', 'a', '両脚の RDL ができるようになったら解禁です。'));
  f jsonb;
  v_ex bigint;
begin
  for p in
    select id from public.protocols
     where (id = 'proto-hamstring-10' or id like '%-proto-hamstring-10')
       and jsonb_typeof(phases) = 'array' and jsonb_array_length(phases) >= 8
  loop
    -- GATE の文面：Tantrums の項目を置き換える（なければ最後に足す）。位置は変えない
    update public.protocols pr
       set phases = jsonb_set(pr.phases, '{7,conditions}', (
             select case
                      when bool_or(c.t like '%Prone Hamstring Tantrums%')
                        then jsonb_agg(case when c.t like '%Prone Hamstring Tantrums%' then to_jsonb(v_gate) else to_jsonb(c.t) end order by c.ord)
                      else coalesce(jsonb_agg(to_jsonb(c.t) order by c.ord), '[]'::jsonb) || to_jsonb(v_gate)
                    end
               from jsonb_array_elements_text(coalesce(pr.phases->7->'conditions', '[]'::jsonb)) with ordinality c(t, ord)))
     where pr.id = p.id
       and not exists (select 1 from jsonb_array_elements_text(coalesce(pr.phases->7->'conditions', '[]'::jsonb)) c where c = v_gate);

    -- 種目のステップ：導入 → 基本 → 50回×3set（GATE）
    select e.id into v_ex from public.exercises e where e.protocol_id = p.id and e.name = 'Prone Hamstring Tantrums' limit 1;
    if v_ex is not null then
      if not exists (select 1 from public.exercise_steps s where s.exercise_id = v_ex and s.target = '50回×3set') then
        insert into public.exercise_steps (exercise_id, step_order, label, target)
        values (v_ex, (select coalesce(max(s.step_order), 0) + 1 from public.exercise_steps s where s.exercise_id = v_ex), 'GATE', '50回×3set');
      end if;
      update public.exercises
         set prescription = '導入 10秒×2set → 基本 15秒×2–3set → 50回×3set／Rest 45–60秒',
             notes = 'できるだけ速く左右交互に叩く。GATE：50回×3setを違和感なく。'
       where id = v_ex;
    end if;

    -- よくある質問（同じ質問がまだなければ足す）
    for f in select * from jsonb_array_elements(v_faq) loop
      update public.protocols pr
         set faq = coalesce(pr.faq, '[]'::jsonb) || f
       where pr.id = p.id
         and not exists (select 1 from jsonb_array_elements(coalesce(pr.faq, '[]'::jsonb)) x where x->>'q' = f->>'q');
    end loop;

    -- 種目のメモにも添える（まだ入っていなければ）
    update public.exercises e
       set notes = btrim(coalesce(e.notes, '') || ' 「狭め」は身長と同じくらいの幅。')
     where e.protocol_id = p.id and e.name like '%Mini Hurdle%' and coalesce(e.notes, '') not like '%身長と同じくらいの幅%';
    update public.exercises e
       set notes = btrim(coalesce(e.notes, '') || ' 両脚の RDL ができるようになったら、ウエイトを解禁。')
     where e.protocol_id = p.id and e.name = 'Bilateral RDL' and coalesce(e.notes, '') not like '%ウエイトを解禁%';
  end loop;
end
$v32data$;

notify pgrst, 'reload schema';

-- 確認用
select p.id, (p.phases->7->'conditions') as phase8_conditions, jsonb_array_length(p.faq) as faq_count
  from public.protocols p order by 1;
