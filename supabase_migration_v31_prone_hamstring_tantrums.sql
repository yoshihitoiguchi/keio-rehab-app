-- ============================================================
-- RE:SPRINT - v31 Prone Hamstring Tantrums を追加（ハムストリング肉離れのプロトコル）
--
--   作者の指示（2026-10-06）：PHASE 8 から PHASE 9 に上がるときの条件にする。
--   (1) PHASE 8 の GATE の条件の最後に1項目足す（最後に足すので、記録済みの「できた」の番号はずれない）
--   (2) 種目として登録する（PHASE 8 で導入・分類は Strength・GATE 種目）
--         導入 10秒×2set → 基本 15秒×2–3set／Rest 45–60秒／できるだけ速く左右交互に叩く
--   対象は、ハムストリング肉離れのプロトコル（default と、各組織へのコピー）。
--   新しい組織は、default からのコピー（v20）で引き継ぐ。
--
--   データの追加だけ。公開中のアプリはそのまま動く（PHASE 8 の選手は、この項目も満たしてから進む）。
--   戻し方：実行前の控え「v31 の前」から protocols.phases を戻し、
--           delete from public.exercises where name = 'Prone Hamstring Tantrums';（種目のステップは一緒に消える）
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

do $v31$
declare
  p record;
  v_item constant text := 'Prone Hamstring Tantrums 15秒×2–3setを、痛みなし・左右差が大きくならない・速度が落ちすぎない・翌日増悪なしで実施可能';
  v_ex bigint;
begin
  for p in
    select id, org_id, phases from public.protocols
     where (id = 'proto-hamstring-10' or id like '%-proto-hamstring-10')
       and jsonb_typeof(phases) = 'array' and jsonb_array_length(phases) >= 8
  loop
    -- (1) PHASE 8 の条件（まだ入っていなければ、最後に足す）
    if not exists (
         select 1 from jsonb_array_elements_text(coalesce(p.phases->7->'conditions', '[]'::jsonb)) c
          where c like '%Prone Hamstring Tantrums%') then
      update public.protocols
         set phases = jsonb_set(phases, '{7,conditions}',
                                coalesce(phases->7->'conditions', '[]'::jsonb) || to_jsonb(v_item))
       where id = p.id;
    end if;

    -- (2) 種目（まだなければ登録）
    if not exists (select 1 from public.exercises e where e.protocol_id = p.id and e.name = 'Prone Hamstring Tantrums') then
      insert into public.exercises
        (org_id, protocol_id, name, intro_phase, continues, is_gate_exercise, category, prescription, notes, sort_order)
      values
        (p.org_id, p.id, 'Prone Hamstring Tantrums', 8, true, true, 'strength',
         '導入 10秒×2set → 基本 15秒×2–3set／Rest 45–60秒',
         'できるだけ速く左右交互に叩く。条件：痛みなし／左右差が大きくならない／速度が落ちすぎない／翌日増悪なし',
         275)
      returning id into v_ex;
      insert into public.exercise_steps (exercise_id, step_order, label, target) values
        (v_ex, 1, '導入', '10秒×2set'),
        (v_ex, 2, '基本', '15秒×2–3set');
    end if;
  end loop;
end
$v31$;

-- 確認用
select p.id, jsonb_array_length(p.phases->7->'conditions') as phase8_items,
       (select count(*) from public.exercises e where e.protocol_id = p.id and e.name = 'Prone Hamstring Tantrums') as exercise,
       (select count(*) from public.exercise_steps s join public.exercises e on e.id = s.exercise_id
         where e.protocol_id = p.id and e.name = 'Prone Hamstring Tantrums') as steps
  from public.protocols p order by 1;
