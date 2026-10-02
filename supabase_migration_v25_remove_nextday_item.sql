-- ============================================================
-- RE:SPRINT - v25 各フェーズの条件から「実施後〜翌日に症状増悪なし」を外す
--
--   作者の指示（2026-10-02）。全組織のプロトコル（protocols.phases）が対象。
--   ・「実施後」と「翌日」の両方を含む条件を、各フェーズの conditions から取り除く。
--     本番ではどのフェーズでも最後の項目なので、選手が付けた GATE の記録（項目の番号）はずれない。
--   ・PHASE 7 のその項目に付いていた注意「Flatへの移行は必ず別セッションで行う」は、
--     種目「Flat Running @82%」のメモに移して残す（メモが空のときだけ）。
--
--   アプリ（v15.8 以前・以後）はどちらも、項目が減った状態でそのまま動く。
--   戻し方：実行前の控え（resprint_backup.snapshots の protocols / exercises）から戻す。
--     update public.protocols p set phases = (b.r->'phases')
--       from (select jsonb_array_elements(rows) r from resprint_backup.snapshots
--              where label = 'v15.9 公開前（v25 の前）' and table_name = 'protocols') b
--      where p.id = b.r->>'id';
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

do $v25$
declare
  v_note constant text := 'Uphill / Heavy Sled から Flat への移行は、必ず別セッションで行う。';
begin
  -- 注意書きの引っ越し（その注意が付いた項目を持つプロトコルの Flat Running だけ）
  update public.exercises e
     set notes = v_note
   where e.name like 'Flat Running%'
     and coalesce(e.notes, '') = ''
     and exists (
       select 1 from public.protocols p, jsonb_array_elements(p.phases) ph, jsonb_array_elements_text(ph->'conditions') c
        where p.id = e.protocol_id and c like '%実施後%' and c like '%翌日%' and c like '%別セッション%'
     );

  -- 条件の削除
  update public.protocols p
     set phases = (
       select coalesce(jsonb_agg(
                case when jsonb_typeof(ph.v->'conditions') = 'array' then
                  jsonb_set(ph.v, '{conditions}',
                    coalesce((select jsonb_agg(to_jsonb(c.t) order by c.ord)
                                from jsonb_array_elements_text(ph.v->'conditions') with ordinality c(t, ord)
                               where not (c.t like '%実施後%' and c.t like '%翌日%')), '[]'::jsonb))
                else ph.v end
                order by ph.ord), '[]'::jsonb)
         from jsonb_array_elements(p.phases) with ordinality ph(v, ord)
     )
   where jsonb_typeof(p.phases) = 'array'
     and exists (
       select 1 from jsonb_array_elements(p.phases) ph, jsonb_array_elements_text(ph->'conditions') c
        where jsonb_typeof(ph->'conditions') = 'array' and c like '%実施後%' and c like '%翌日%'
     );
end
$v25$;

-- 確認用
select '「翌日」の条件が残っているフェーズの数' as item,
       (select count(*) from public.protocols p, jsonb_array_elements(p.phases) ph, jsonb_array_elements_text(ph->'conditions') c
         where c like '%実施後%' and c like '%翌日%')::text as value;
