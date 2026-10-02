-- ============================================================
-- RE:SPRINT - v26 「続ける種目」の案内を、プロトコルごとの設定にする
--
--   「PHASE 4 以降の Strength / Eccentric は、Jump・Jog・Running を始めたあとも続ける」は、
--   ハムストリング肉離れのプロトコルだけの話。ほかのプロトコルの選手には出さない。
--   そこで、案内の内容を protocols.continue_rule（JSON）に持たせ、設定のあるプロトコルだけで表示する。
--     { "from_phase": 4, "categories": ["strength","eccentric"], "label": "...", "title": "...", "text": "...", "ack": "..." }
--   設定するのは、ハムストリング肉離れのプロトコル（id が proto-hamstring-10、および各組織へのコピー）だけ。
--   新しい組織を作るときは、default からのコピー（v20）で一緒に引き継がれる。
--
--   列の追加だけ。公開中のアプリ（v15.9）はこの列を見ないので、そのまま動く。
--   戻し方：alter table public.protocols drop column if exists continue_rule;
--   冪等：何度実行しても同じ状態になります（すでに設定があるものは書き換えない）。
-- ============================================================

alter table public.protocols add column if not exists continue_rule jsonb;

update public.protocols
   set continue_rule = jsonb_build_object(
         'from_phase', 4,
         'categories', jsonb_build_array('strength', 'eccentric'),
         'label', 'Strength / Eccentric',
         'title', 'Strength / Eccentric は続ける',
         'text', 'PHASE 4 以降の Strength / Eccentric は、Jump・Jog・Running を始めたあとも続けます。負荷は少しずつ上げていきます。',
         'ack', '次のPHASEに進んでも、Strength / Eccentric は続け、負荷を少しずつ上げていくことを確認しました')
 where continue_rule is null
   and (id = 'proto-hamstring-10' or id like '%-proto-hamstring-10');

notify pgrst, 'reload schema';

-- 確認用
select id, org_id, (continue_rule is not null) as has_continue_rule from public.protocols order by 2, 1;
