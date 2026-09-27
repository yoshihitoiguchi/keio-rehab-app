-- ============================================================
-- RE:SPRINT - 差分マイグレーション v12
--   (1) 日報送信エラー（PGRST204）の修正：不足カラムの追加
--   (2) 膝関節角度の換算メモを削除
--
-- エラー内容：
--   Could not find the 'fear_level' column of 'reports' in the schema cache
--
-- 原因：
--   恐怖心・抜ける接地・主観的努力度の3列は v8 で追加する予定でしたが、
--   v8 は破棄したため、実行済みの v9〜v11 に含まれていませんでした。
--   アプリ側だけが先にこの3列へ書き込んでいた状態です。
-- ============================================================


-- ------------------------------------------------------------
-- (1) reports に不足カラムを追加
-- ------------------------------------------------------------

-- PHASEで出し分ける入力項目
alter table reports add column if not exists fear_level int;           -- 恐怖心（PHASE5から）
alter table reports add column if not exists slipping_contact boolean; -- 抜ける接地（PHASE6から）
alter table reports add column if not exists rpe int;                  -- 主観的努力度（PHASE7から）

-- アプリが書き込む他の列も、抜けがないかここで揃えておく
alter table reports add column if not exists fatigue int;
alter table reports add column if not exists sleep_quality int;
alter table reports add column if not exists compensation boolean;
alter table reports add column if not exists severe_symptom boolean;
alter table reports add column if not exists self_compensation boolean;
alter table reports add column if not exists self_severe_symptom boolean;
alter table reports add column if not exists observed_by text;

-- players 側も同様に確認（v8 で追加予定だったものを含む）
alter table players add column if not exists body_weight_kg numeric;
alter table players add column if not exists baseline_time_sec numeric;
alter table players add column if not exists baseline_distance_m numeric;
alter table players add column if not exists imaging_findings text;
alter table players add column if not exists bamic_grade text;
alter table players add column if not exists hamstring_muscle text;
alter table players add column if not exists hamstring_location text;

-- PostgREST のスキーマキャッシュを更新する。
-- これを行わないと、列を追加した直後でも
-- 「Could not find the ... column in the schema cache」が出続けることがある。
notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- (2) 膝関節角度の換算メモを削除
--     （画面に原案の180°表記を出さない方針のため）
-- ------------------------------------------------------------
update exercises
   set notes = null
 where notes like '%完全伸展%';


-- ------------------------------------------------------------
-- (3) 確認用：日報に必要な列が揃ったか
--     実行後にこの結果が13行になっていれば修正完了です。
-- ------------------------------------------------------------
select column_name, data_type
  from information_schema.columns
 where table_name = 'reports'
   and column_name in (
     'vas','mental','honne','fatigue','sleep_quality',
     'fear_level','slipping_contact','rpe',
     'compensation','severe_symptom',
     'self_compensation','self_severe_symptom','observed_by'
   )
 order by column_name;
