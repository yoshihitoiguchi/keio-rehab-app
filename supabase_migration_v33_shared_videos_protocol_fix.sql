-- ============================================================
-- RE:SPRINT - v33 種目の動画を全組織で共通に／プロトコルの改定（作者の指示 2026-10-06）
--
--   (1) exercise_videos：種目名ごとの動画の URL（全組織で共通）
--         ・読むのは、ログインしている人なら誰でも。
--         ・書くのは exercise_video_set() だけ。組織のメンバーで、その組織の指導者パスワードが合っている人
--           （または管理者）が登録できる。登録すると、同じ名前の種目を持つすべての組織に出る。
--         ・v32 の exercises.video_url（組織ごと）は使わなくなる。入っている値があれば共通の表へ移す。列は残す。
--   (2) プロトコルの改定（ハムストリング肉離れ。default と各組織のコピー）
--         ・PHASE 8：Prone Hamstring Tantrums の条件を2つにする
--             「15秒×2–3set を、痛みなし・左右差が大きくならない・速度が落ちすぎない・翌日増悪なしで実施可能」（v31 の文面に戻す）
--             「50回×3set を違和感なく実施可能」（その次に足す）
--         ・Mini Hurdle の「狭め」→「身長幅」（PHASE 8 の条件・種目名・ステップ・メモ）
--         ・PHASE 3 の名称に「両脚RDLができたらウエイト解禁」を付ける
--         ・よくある質問（v32 で入れた2件）は外す（プロトコル本体に書いたため）
--
--   公開中のアプリ（v15.19）はそのまま動く。
--   戻し方：実行前の控え「v33 の前」から protocols・exercises・exercise_steps を戻す。
--           drop function public.exercise_video_set(text, text, text, text); drop table public.exercise_videos;
--   冪等：何度実行しても同じ状態になります。
-- ============================================================

create table if not exists public.exercise_videos (
  name text primary key,
  video_url text not null,
  updated_at timestamptz not null default now()
);

do $v33rls$
begin
  alter table public.exercise_videos enable row level security;
  drop policy if exists "resprint shared read" on public.exercise_videos;
  create policy "resprint shared read" on public.exercise_videos for select to authenticated using (true);
  revoke all on public.exercise_videos from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.exercise_videos from anon;
  end if;
  revoke all on public.exercise_videos from authenticated;
  grant select on public.exercise_videos to authenticated;
end
$v33rls$;

-- 登録・変更・削除（URL を空にすると削除）
create or replace function public.exercise_video_set(p_org_id text, p_coach_password text, p_name text, p_url text)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_url text := btrim(coalesce(p_url, ''));
begin
  if not public.resprint_is_admin() then
    if not public.resprint_is_member(p_org_id) then
      raise exception 'この組織にログインしていません' using errcode = '42501';
    end if;
    if not coalesce((public.coach_check(p_org_id, p_coach_password)->>'ok')::boolean, false) then
      raise exception '指導者パスワードを確認できませんでした。指導者モードに入り直してからお試しください' using errcode = '42501';
    end if;
  end if;
  if v_name = '' or length(v_name) > 200 then
    raise exception '種目名が正しくありません' using errcode = '22023';
  end if;
  if v_url = '' then
    delete from public.exercise_videos where name = v_name;
    return true;
  end if;
  if v_url !~ '^https?://' or length(v_url) > 1000 then
    raise exception 'https:// で始まる URL を貼り付けてください' using errcode = '22023';
  end if;
  insert into public.exercise_videos (name, video_url) values (v_name, v_url)
  on conflict (name) do update set video_url = excluded.video_url, updated_at = now();
  return true;
end
$fn$;
revoke all on function public.exercise_video_set(text, text, text, text) from public;
do $v33grant$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.exercise_video_set(text, text, text, text) from anon;
  end if;
  grant execute on function public.exercise_video_set(text, text, text, text) to authenticated;
end
$v33grant$;

-- v32 で組織ごとに登録された動画があれば、共通の表へ移す
insert into public.exercise_videos (name, video_url)
select distinct on (e.name) e.name, e.video_url
  from public.exercises e
 where coalesce(e.video_url, '') ~ '^https?://'
 order by e.name, e.id
on conflict (name) do nothing;


-- ---------- (2) プロトコルの改定 ----------
do $v33data$
declare
  p record;
  v_t15 constant text := 'Prone Hamstring Tantrums 15秒×2–3setを、痛みなし・左右差が大きくならない・速度が落ちすぎない・翌日増悪なしで実施可能';
  v_t50 constant text := 'Prone Hamstring Tantrums 50回×3setを違和感なく実施可能';
  v_conds jsonb;
  v_new jsonb;
  c text;
begin
  for p in
    select id, phases from public.protocols
     where (id = 'proto-hamstring-10' or id like '%-proto-hamstring-10')
       and jsonb_typeof(phases) = 'array' and jsonb_array_length(phases) >= 8
  loop
    -- PHASE 8 の条件：Tantrums の項目はいったん外して、最後に「15秒…」「50回…」の順で並べ直す。Mini Hurdle は「身長幅」に
    v_conds := coalesce(p.phases->7->'conditions', '[]'::jsonb);
    v_new := '[]'::jsonb;
    for c in select t from jsonb_array_elements_text(v_conds) with ordinality x(t, ord) order by ord loop
      if c like '%Prone Hamstring Tantrums%' then
        continue;
      end if;
      v_new := v_new || to_jsonb(replace(c, 'Mini Hurdleを狭め設定から', 'Mini Hurdleを身長幅の設定から'));
    end loop;
    v_new := v_new || to_jsonb(v_t15) || to_jsonb(v_t50);

    update public.protocols pr
       set phases = jsonb_set(
             jsonb_set(pr.phases, '{7,conditions}', v_new),
             '{2,title}',
             to_jsonb(case when coalesce(pr.phases->2->>'title', '') like '%ウエイト解禁%' then pr.phases->2->>'title'
                           else coalesce(pr.phases->2->>'title', '') || '（両脚RDLができたらウエイト解禁）' end)),
           faq = (select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements(coalesce(pr.faq, '[]'::jsonb)) f
                   where f->>'q' not in ('Mini Hurdle の「狭め」はどのくらい？', 'ウエイトはいつから解禁？'))
     where pr.id = p.id;

    -- 種目：Mini Hurdle（名前・ステップ・メモ）
    update public.exercises e
       set name = replace(e.name, 'Mini Hurdle（狭め）', 'Mini Hurdle（身長幅）'),
           notes = btrim(replace(coalesce(e.notes, ''), ' 「狭め」は身長と同じくらいの幅。', '')
                         || case when coalesce(e.notes, '') like '%開始時の幅は身長と同じくらい%' then '' else ' 開始時の幅は身長と同じくらい。' end)
     where e.protocol_id = p.id and e.name like '%Mini Hurdle%';
    update public.exercise_steps s
       set label = 'Mini Hurdle（身長幅）'
      from public.exercises e
     where e.id = s.exercise_id and e.protocol_id = p.id and s.label like '狭めのMini Hurdle%';

    -- 種目：Tantrums のメモ（条件を戻し、GATE を添える）
    update public.exercises e
       set notes = 'できるだけ速く左右交互に叩く。条件：痛みなし／左右差が大きくならない／速度が落ちすぎない／翌日増悪なし。GATE：50回×3setを違和感なく。'
     where e.protocol_id = p.id and e.name = 'Prone Hamstring Tantrums';
  end loop;
end
$v33data$;

notify pgrst, 'reload schema';

-- 確認用
select p.id, (p.phases->2->>'title') as phase3_title, (p.phases->7->'conditions') as phase8_conditions, jsonb_array_length(p.faq) as faq
  from public.protocols p order by 1;
