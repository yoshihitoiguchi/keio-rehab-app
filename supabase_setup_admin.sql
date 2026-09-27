-- ============================================================
-- RE:SPRINT - 初期管理者の登録（段階① v15_prepare のあとに、所有者が行う）
--
-- 管理者は「アプリの画面で最初に来た人」ではなく、
-- 所有者がここで明示的に登録した人だけがなれます。
--
-- 手順
--   1. Supabase ダッシュボード > Authentication > Users > 「Add user」
--      > 「Create new user」
--        ・Email：管理者のメールアドレス
--        ・Password：12文字以上を推奨
--        ・「Auto Confirm User」にチェック
--   2. 下の insert 文の「where email = ...」の引用符の中身を、
--      1 で入れたメールアドレスに書き換えて、SQL Editor で実行する
--   3. 最後の SELECT に、そのメールアドレスが 1 行出れば完了
--   4. アプリのログイン画面で「管理者」を選び、1 のメールアドレスとパスワードで入る
--
-- 管理者をやめさせるとき：
--   delete from public.app_admins
--    where user_id = (select id from auth.users where email = '対象のメールアドレス');
-- ============================================================

do $adm$
declare
  v_email text := lower(trim('ここに管理者のメールアドレス'));
  v_ids uuid[];
begin
  -- メール確認済み・匿名でないユーザーだけを対象にする
  -- （他人が先に同じアドレスで仮登録していても、確認が済んでいなければ管理者にならない）
  select array_agg(id) into v_ids
    from auth.users
   where lower(email) = v_email
     and email_confirmed_at is not null
     and coalesce(is_anonymous, false) = false;

  if v_ids is null then
    raise exception '「%」のメール確認済みユーザーが見つかりません。Add user で「Auto Confirm User」にチェックして作成してください。', v_email;
  end if;
  if array_length(v_ids, 1) > 1 then
    raise exception '「%」に当てはまるユーザーが複数あります。Authentication > Users で確認してください。', v_email;
  end if;

  insert into public.app_admins (user_id, note)
  values (v_ids[1], '初期管理者')
  on conflict (user_id) do nothing;
end
$adm$;

-- 確認：登録済みの管理者
-- 作成日時が、いま Add user で作ったときと一致しているかも確かめてください
select u.email, u.created_at as user_created_at, u.email_confirmed_at, a.note, a.created_at as admin_since
  from public.app_admins a
  join auth.users u on u.id = a.user_id
 order by a.created_at;
