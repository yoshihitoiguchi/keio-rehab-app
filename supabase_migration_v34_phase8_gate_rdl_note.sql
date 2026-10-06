-- ============================================================
-- RE:SPRINT - v34 プロトコルの文面の修正（作者の指示 2026-10-06。データの変更だけ）
--
--   ハムストリング肉離れのプロトコル（default と各組織のコピー）
--   (1) PHASE 8 → 9 の条件：元々の条件はそのまま。Prone Hamstring Tantrums は「50回×3setを違和感なく実施可能」の1項目だけにする
--       （v33 で入れた「15秒×2–3set…」の項目は外す。15秒のほうは種目のステップ＝PHASE 8 のトレーニングとして残る）
--   (2) ウエイト解禁：PHASE 3 の名称から外し、PHASE 3 の条件の Bilateral RDL の項目に併記する
--
--   アプリの変更なし。戻し方：実行前の控え「v34 の前」から protocols を戻す。
--   冪等：何度実行しても同じ状態になります。
-- ============================================================
do $v34$
declare
  p record;
  v_t50 constant text := 'Prone Hamstring Tantrums 50回×3setを違和感なく実施可能';
  v_tail constant text := '（できたらウエイト解禁）';
  v_p8 jsonb;
  v_p3 jsonb;
begin
  for p in
    select id, phases from public.protocols
     where (id = 'proto-hamstring-10' or id like '%-proto-hamstring-10')
       and jsonb_typeof(phases) = 'array' and jsonb_array_length(phases) >= 8
  loop
    select coalesce(jsonb_agg(to_jsonb(t) order by ord), '[]'::jsonb) || to_jsonb(v_t50) into v_p8
      from jsonb_array_elements_text(coalesce(p.phases->7->'conditions', '[]'::jsonb)) with ordinality x(t, ord)
     where t not like '%Prone Hamstring Tantrums%';
    select coalesce(jsonb_agg(to_jsonb(case when t like 'Bilateral RDL%' and t not like '%ウエイト解禁%' then t || v_tail else t end) order by ord), '[]'::jsonb) into v_p3
      from jsonb_array_elements_text(coalesce(p.phases->2->'conditions', '[]'::jsonb)) with ordinality x(t, ord);

    update public.protocols pr
       set phases = jsonb_set(jsonb_set(jsonb_set(pr.phases, '{7,conditions}', v_p8), '{2,conditions}', v_p3),
                              '{2,title}', to_jsonb(replace(coalesce(pr.phases->2->>'title', ''), '（両脚RDLができたらウエイト解禁）', '')))
     where pr.id = p.id;

    update public.exercises e
       set notes = 'できるだけ速く左右交互に叩く。GATE：50回×3setを違和感なく。'
     where e.protocol_id = p.id and e.name = 'Prone Hamstring Tantrums';
  end loop;
end
$v34$;

-- 確認用
select p.id, (p.phases->2->>'title') as phase3_title, (p.phases->2->'conditions') as phase3_conditions, (p.phases->7->'conditions') as phase8_conditions
  from public.protocols p order by 1;
