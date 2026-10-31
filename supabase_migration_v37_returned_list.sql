-- ============================================================
-- RE:SPRINT - v37 選手を指導者が「復帰者リスト」へ移す
--
--   players.moved_to_returned_at：指導者が復帰者リストへ移した日時。
--     null … いままでどおり（復帰を記録してから15日目に自動で復帰者リストへ）
--     日時 … 指導者が移した（すぐに復帰者リストに出る）。「現役選手に戻す」で null に戻す。
--   読み書きの権限は players のほかの列と同じ（同じ組織の人だけ）。
--
--   列の追加だけ。公開中のアプリ（v15.22）はそのまま動く。
--   戻し方：alter table public.players drop column if exists moved_to_returned_at; notify pgrst, 'reload schema';
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

alter table public.players add column if not exists moved_to_returned_at timestamptz;

notify pgrst, 'reload schema';

-- 確認用
select 'players.moved_to_returned_at' as item,
       exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'players' and column_name = 'moved_to_returned_at')::text as value;
