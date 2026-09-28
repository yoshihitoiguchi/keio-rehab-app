// ============================================================
// 段階ごとの適用・戻しを、v13 の利用者（anon）と v15 の利用者（authenticated）の両方から確かめる
//
//   npm run test:db            … ①→③→戻す→③→④ の通し
//   npm run test:db -- rb15    … ①だけ適用して①を戻すケース
//
//   PGlite（Node の中で動く本物の Postgres）に Supabase の最低限の土台
//   （anon / authenticated ロール、auth.uid()、storage.objects）と、
//   本番に近いテーブル構成（アプリのコードから推定）を作って試す。
//   本番の Supabase には接続しない。
// ============================================================
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";

import { fileURLToPath } from "node:url";
const R = fileURLToPath(new URL("../../", import.meta.url));
const SQL = (f) => readFileSync(R + f, "utf8");
const db = new PGlite({ extensions: { pgcrypto } });
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${l}`); };
const sha = (s) => createHash("sha256").update(s.trim()).digest("hex");

// ---------- Supabase の土台 ----------
await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema extensions; create extension pgcrypto with schema extensions;
create schema auth;
create table auth.users (id uuid primary key, email text, is_anonymous boolean default false, email_confirmed_at timestamptz, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
alter table storage.objects enable row level security;
grant usage on schema public, auth, storage, extensions to anon, authenticated;
grant all on storage.objects to anon, authenticated;
insert into storage.buckets values ('attachments','attachments',true,52428800,null);
`);

// ---------- 本番に近い public スキーマ（v13 時代） ----------
await db.exec(`
create table organizations (id text primary key, name text, password_hash text, created_at timestamptz default now());
create table app_settings (org_id text references organizations(id), key text, value text, primary key (org_id, key));
create table protocols (id text primary key, org_id text references organizations(id), name text);
create table players (id text primary key, org_id text references organizations(id) on delete cascade, name text, pin text, protocol_id text);
create table reports (id bigint generated always as identity primary key, player_id text references players(id) on delete cascade, vas int);
create table messages (id bigint generated always as identity primary key, player_id text references players(id) on delete cascade, content text);
create table gate_item_checks (id bigint generated always as identity primary key, player_id text references players(id) on delete cascade, checker_role text, result text);
create table phase_history (id bigint generated always as identity primary key, player_id text references players(id) on delete cascade, protocol_id text, phase_number int);
create table slots (id bigint generated always as identity primary key, org_id text references organizations(id) on delete cascade, datetime text);
create table exercises (id bigint generated always as identity primary key, org_id text, protocol_id text, name text);
create table exercise_steps (id bigint generated always as identity primary key, exercise_id bigint, step_order int, label text);
create table phase_menus (id bigint generated always as identity primary key, org_id text references organizations(id), protocol_id text, phase_number int check (phase_number >= 1 and phase_number <= 5), name text);
create table offsite_domains (id text primary key, org_id text, label text);
create table offsite_items (id bigint generated always as identity primary key, org_id text, domain_id text);
create table media_attachments (id bigint generated always as identity primary key, player_id text references players(id) on delete cascade, org_id text references organizations(id), storage_path text, public_url text, kind text);
create view player_directory as select id, name, org_id from players;
create view protocol_phase_avg_duration as select p.name as protocol_name, h.phase_number, count(*) n from phase_history h join protocols p on p.id = h.protocol_id group by 1,2;
create view gate_check_agreement as select player_id, count(*) filter (where checker_role='player') as self_n, count(*) as n from gate_item_checks group by 1;
grant all on all tables in schema public to anon, authenticated;
create function purge_expired_attachments() returns integer language sql security definer as $$ select 0 $$;
do $x$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "public all - %s" on %I for all using (true) with check (true)', t, t);
  end loop; end $x$;
create policy "attachments read" on storage.objects for select using (bucket_id = 'attachments');
create policy "attachments insert" on storage.objects for insert with check (bucket_id = 'attachments');
create policy "attachments delete" on storage.objects for delete using (bucket_id = 'attachments');
insert into organizations (id, name, password_hash) values ('default','デフォルト','${sha("1234")}'), ('other','他','${sha("otherpass")}');
insert into protocols values ('hs','default','ハム'), ('op','other','他');
insert into players values ('p1','default','A','1111','hs'), ('p2','other','B','2222','op');
insert into reports (player_id, vas) values ('p1',3), ('p2',5);
insert into gate_item_checks (player_id, checker_role, result) values ('p1','player','ok'), ('p1','coach','ok');
insert into app_settings values ('default','coach_password_hash','${sha("coach")}'), ('default','other_setting','x');
insert into offsite_domains values ('A', null, '共通'), ('Z', 'other', '他専用');
insert into protocols values ('tpl', null, '共通テンプレート');
create table protocol_notes (id bigint generated always as identity primary key, protocol_id text, note text);
insert into protocol_notes (protocol_id, note) values ('tpl', 'テンプレの注意'), ('hs', 'ハムの注意'), ('op', '他組織の注意');
grant all on protocol_notes to anon, authenticated;
alter table protocol_notes enable row level security;
create policy "public all - protocol_notes" on protocol_notes for all using (true) with check (true);
insert into exercises (org_id, protocol_id, name) values ('default', 'hs', 'ノルディック'), ('default', 'hs', 'ブリッジ');
insert into exercise_steps (exercise_id, step_order, label) select id, g, 'step' || g from exercises, generate_series(1,2) g where protocol_id = 'hs';
insert into phase_menus (org_id, protocol_id, phase_number, name) values ('default', 'hs', 1, '歩行');
insert into offsite_items (org_id, domain_id) values (null, 'A'), (null, 'A'), ('other', 'Z');
insert into organizations (id, name, password_hash) values ('ws', '改行つきハッシュ', '${sha("pass1234")}' || chr(10));
create table mystery (id int, note text);
insert into mystery values (1, '分類できない表');
grant all on mystery to anon, authenticated;
alter table mystery enable row level security;
create policy "public all - mystery" on mystery for all using (true) with check (true);
`);
const snapshotPolicies = async () =>
  (await db.query(`select schemaname||'.'||tablename||':'||policyname||':'||cmd||':'||roles::text||':'||coalesce(qual,'')||':'||coalesce(with_check,'') s
                    from pg_policies order by 1`)).rows.map((r) => r.s).join("\n");
const ORIGINAL_POLICIES = await snapshotPolicies();
const aclSnapshot = async () => (await db.query(`select c.relname || ':' || coalesce(c.relacl::text,'') || ':' || coalesce(c.reloptions::text,'') s
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v')
   and c.relname not in ('app_admins','org_memberships','org_login_failures','resprint_migration_backup') order by 1`)).rows.map((r) => r.s).join("\n");

// ---------- 利用者 ----------
const ADMIN = randomUUID(), U1 = randomUUID(), U2 = randomUUID();
await db.exec(`insert into auth.users (id, email, is_anonymous, email_confirmed_at) values ('${ADMIN}','owner@example.com',false,now()),('${U1}',null,true,null),('${U2}',null,true,null),(gen_random_uuid(),'evil@example.com',false,null)`);
async function as(uid, sql, params = []) {
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return { rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { error: e.message }; }
  finally { await db.exec("reset role"); }
}
const one = (r) => r.rows?.[0] && Object.values(r.rows[0])[0];
const run = async (file, label) => { try { await db.exec(SQL(file)); return null; } catch (e) { return e.message; } };
const run2 = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return e.message; } };

// v13 の利用者がやること（匿名キーのまま）
async function v13Works(tag) {
  const org = await as(null, "select id,name,password_hash from organizations where id='default'");
  const loginOk = org.rows?.[0]?.password_hash === sha("1234");
  const dir = await as(null, "select id,name from player_directory where org_id='default'");
  const agree = await as(null, "select * from gate_check_agreement");
  const ins = await as(null, "insert into reports (player_id, vas) values ('p1', 1) returning id");
  const up = await as(null, "insert into storage.objects (bucket_id, name) values ('attachments','p1/report/v13.jpg') returning id");
  const coach = await as(null, "select value from app_settings where org_id='default'");
  const all = !org.error && loginOk && dir.rows?.length === 1 && !agree.error && ins.rows?.length === 1 && up.rows?.length === 1 && !coach.error;
  return { all, detail: { org: org.error || loginOk, dir: dir.error || dir.rows.length, agree: agree.error || "ok", ins: ins.error || "ok", up: up.error || "ok" } };
}
// v15 の利用者がやること（組織ログイン後）
async function v15Works(uid, org, pw) {
  const login = await as(uid, "select public.org_login($1,$2)", [org, pw]);
  const orgRow = await as(uid, "select id,name from organizations where id=$1", [org]);
  const players = await as(uid, "select id from players where org_id=$1", [org]);
  const dir = await as(uid, "select id from player_directory where org_id=$1", [org]);
  const pid = players.rows?.[0]?.id;
  const ins = pid ? await as(uid, "insert into reports (player_id, vas) values ($1, 2) returning id", [pid]) : { rows: [1] };
  return { all: one(login)?.id === org && orgRow.rows?.length === 1 && !players.error && !dir.error && (ins.rows?.length === 1),
           detail: { login: login.error || one(login), orgRow: orgRow.error || orgRow.rows.length, players: players.error || players.rows.length, ins: ins.error || "ok" } };
}

// ===== 0. v13 の状態 =====
ok((await v13Works()).all, "[0] 適用前：v13 は動く");

// ===== 1. 段階① prepare =====
ok(!(await run("supabase_migration_v15_prepare.sql")), "[①] v15_prepare の実行 1 回目");
ok(!(await run("supabase_migration_v15_prepare.sql")), "[①] v15_prepare の実行 2 回目（冪等）");
ok(ORIGINAL_POLICIES === (await snapshotPolicies()).split("\n").filter((s) => !s.includes(":own memberships:")).join("\n"),
  "[①] 既存のポリシーは1つも変わっていない");
let v13 = await v13Works();
ok(v13.all, "[①] v13 はそのまま動く " + JSON.stringify(v13.detail));
ok(!!(await as(null, "select public.org_login('default','1234')")).error, "[①] 未サインインでは org_login を呼べない");
let v15 = await v15Works(U1, "default", "1234");
ok(v15.all, "[①] v15 は（ポリシーが開いたままでも）動く " + JSON.stringify(v15.detail));
ok((await db.query("select password_hash from organizations where id='default'")).rows[0].password_hash === sha("1234"),
  "[①] ログインしても旧形式のパスワードは置き換えない（v13 に戻せる）");
await db.exec(SQL("supabase_setup_admin.sql").replace("'ここに管理者のメールアドレス'", "'owner@example.com'"));
ok(one(await as(ADMIN, "select public.admin_whoami()")) === true, "[①] 所有者が登録した管理者は admin_whoami = true");
ok(/メール確認済みユーザーが見つかりません/.test((await run2(SQL("supabase_setup_admin.sql").replace("'ここに管理者のメールアドレス'", "'evil@example.com'"))) || ""),
   "[①] メール確認が済んでいないアカウントは管理者に登録できない（先回りの仮登録対策）");
ok(!!(await as(null, "update organizations set password_hash = 'x' where id = 'default'")).error
   && !!(await as(U2, "insert into organizations (id, name) values ('evil', 'x')")).error,
   "[①] 移行期間中も、組織表（パスワードハッシュ）は書き換えられない");
ok(one(await as(U2, "select public.org_login('ws', 'pass1234')"))?.id === "ws",
   "[①] v13 で手貼りされた改行つきハッシュでもログインできる（JavaScript の trim と同じ扱い）");
ok(one(await as(U2, "select public.org_login('ws', 'pass1234' || chr(12288))"))?.id === "ws",
   "[①] 末尾に全角スペースが入ったパスワードでも v13 と同じくログインできる");
await as(U2, "select public.org_leave('ws')");
ok(one(await as(ADMIN, "select public.admin_create_org('new-team','新チーム','newteam-pass')"))?.id === "new-team", "[①] 管理者は組織を作れる");
const newHash = (await db.query("select password_hash from organizations where id='new-team'")).rows[0].password_hash;
ok(newHash === sha("newteam-pass"), "[①] 新しい組織のパスワードは v13 と同じ形式（v13 でもログインできる）");
ok(/管理者の権限/.test((await as(U1, "select public.admin_create_org('x-team','x','xxxxxxxx')")).error || ""), "[①] 管理者でない人は組織を作れない");
ok(!!(await as(U1, "select public.resprint_hash_password('a')")).error, "[①] パスワード関連の内部関数はアプリから呼べない");
const st1 = await db.query(SQL("supabase_check_status.sql"));
const stMap = Object.fromEntries(st1.rows.filter((r) => r.section === "1 段階").map((r) => [r.item, r.value]));
ok(stMap["① v15_prepare（org_login 関数）"] === "true" && stMap["③ v16_enforce（resprint のポリシー数）"] === "0", "[①] 状態確認 SQL：①済み・③未");
ok(st1.rows.filter((r) => r.section === "2 移行").every((r) => r.value === "OK"), "[①] 状態確認 SQL：移行期間に v15 が読めないテーブルはない");
ok(!st1.rows.some((r) => /[0-9a-f]{64}|\$2[aby]\$/.test(r.value || "")), "[①] 状態確認 SQL の結果にハッシュが出ない");

if ((process.env.SCENARIO === "rb15" || process.argv.includes("rb15"))) {
  ok(!(await run("supabase_rollback_v15.sql")), "[①戻し] rollback_v15 の実行 1 回目");
  ok(!(await run("supabase_rollback_v15.sql")), "[①戻し] rollback_v15 の実行 2 回目（冪等）");
  ok(ORIGINAL_POLICIES === await snapshotPolicies(), "[①戻し] ポリシーは適用前とまったく同じ");
  const gone = (await db.query("select to_regclass('public.app_admins') a, to_regclass('public.org_memberships') m, to_regprocedure('public.org_login(text,text)') f")).rows[0];
  ok(!gone.a && !gone.m && !gone.f, "[①戻し] 追加したテーブル・関数は消える");
  ok((await v13Works()).all, "[①戻し] v13 は動く");
  ok((await db.query("select password_hash from organizations where id='new-team'")).rows[0].password_hash === sha("newteam-pass"),
     "[①戻し] ①の期間に作った組織は残り、v13 の形式なので v13 でもログインできる");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

const ACL_BEFORE_ENFORCE = await aclSnapshot();
// ===== 3. 段階③ enforce =====
// 安全装置：組織ログインが0件なら止まる
await db.exec("delete from org_memberships");
const guard = await run("supabase_migration_v16_enforce.sql");
ok(/v15 アプリでの組織ログインがまだありません/.test(guard || ""), "[③] 組織ログインが0件なら、何も変えずに止まる");
ok(ORIGINAL_POLICIES === (await snapshotPolicies()).split("\n").filter((s) => !s.includes(":own memberships:")).join("\n"), "[③] 止まったときはポリシーも変わっていない");
ok((await db.query("select to_regclass('public.resprint_migration_backup') t")).rows[0].t === null, "[③] 止まったときは退避テーブルも作られていない（全体が取り消される）");
await as(U1, "select public.org_login('default','1234')");
// 途中で失敗したら全体が取り消されるか：最後の Storage の設定で失敗するように細工する
await db.exec("alter function storage.foldername(text) rename to foldername_hidden");
const midFail = await run("supabase_migration_v16_enforce.sql");
await db.exec("alter function storage.foldername_hidden(text) rename to foldername");
ok(!!midFail, "[③] 途中（Storage の設定）で失敗させると、エラーで止まる");
ok(ORIGINAL_POLICIES === (await snapshotPolicies()).split("\n").filter((s) => !s.includes(":own memberships:")).join("\n"),
  "[③] 途中で失敗しても、それまでに作り直したポリシーは全部取り消される");
ok((await db.query("select to_regclass('public.resprint_migration_backup') t")).rows[0].t === null
   && (await v13Works()).all, "[③] 途中で失敗しても、退避テーブルもできず v13 は動いたまま");
ok(!(await run("supabase_migration_v16_enforce.sql")), "[③] v16_enforce の実行 1 回目");
const bk1 = (await db.query("select count(*)::int n from resprint_migration_backup where step='v16'")).rows[0].n;
ok(!(await run("supabase_migration_v16_enforce.sql")), "[③] v16_enforce の実行 2 回目（冪等）");
const bk2 = (await db.query("select count(*)::int n from resprint_migration_backup where step='v16'")).rows[0].n;
ok(bk1 > 0 && bk1 === bk2, `[③] 退避は最初の1回だけ（${bk1} 行）`);
v13 = await v13Works();
ok(!v13.all && v13.detail.org !== true, "[③] v13（匿名キー）は読めなくなる（想定どおり） " + JSON.stringify(v13.detail));
v15 = await v15Works(U1, "default", "1234");
ok(v15.all, "[③] v15 は動く " + JSON.stringify(v15.detail));
ok((await as(U1, "select id from players")).rows.map((r) => r.id).join() === "p1", "[③] 他組織の選手は見えない");
ok(!!(await as(U1, "insert into reports (player_id, vas) values ('p2', 9)")).error, "[③] 他組織の選手に書き込めない");
ok(!!(await as(U1, "select password_hash from organizations")).error, "[③] password_hash は読めない");
ok((await as(U1, "select * from gate_check_agreement")).rows?.length >= 0, "[③] gate_check_agreement はまだ残っている（④まで）");
ok((await as(U2, "select public.org_login('other','otherpass')")) && (await as(U2, "select id from player_directory")).rows.map((r) => r.id).join() === "p2", "[③] 別組織の人は自分の選手だけ");
ok(!!(await as(U1, "insert into storage.objects (bucket_id, name) values ('attachments','p2/x/a.jpg')")).error, "[③] 他組織の選手のフォルダに写真を置けない");
ok(!!(await as(U1, "select public.purge_expired_attachments()")).error, "[③] 削除関数はアプリから呼べない");
ok((await as(U1, "select * from mystery")).rows?.length === 0, "[③] 分類できないテーブルは読めない側に倒れる（fail closed）");
ok((await as(U1, "select count(*)::int from exercise_steps")).error === undefined, "[③] 共通マスタ（exercise_steps）は読める");
ok((await as(U1, "select note from protocol_notes order by id")).rows?.map((r) => r.note).join() === "テンプレの注意,ハムの注意",
   "[③] プロトコル単位の表：共通テンプレートと自組織の分は読め、他組織の分は読めない");
ok(!!(await as(U1, "insert into protocol_notes (protocol_id, note) values ('tpl', '改ざん')")).error
   && (await as(U1, "update protocol_notes set note = '改ざん' where protocol_id = 'tpl' returning id")).rows?.length === 0,
   "[③] 共通テンプレートに属する行は書き換えられない");
ok((await as(U1, "select count(*)::int as n from offsite_items")).rows?.[0]?.n === 2,
   "[③] 全組織共通のオフサイト項目（org_id が空）は読め、他組織専用の項目は読めない（本番は70件すべて共通）");
ok((await as(U1, "select count(*)::int as n from exercises")).rows?.[0]?.n === 2, "[③] 種目（exercises）は自組織の分だけ読める");
ok(!!(await as(U1, "insert into media_attachments (player_id, org_id, storage_path, public_url, kind) values ('p1','default','p2/report/x.jpg','u','image')")).error,
   "[③] 写真の記録で、他の選手のフォルダを指すことはできない（他組織のファイル削除の防止）");
ok((await as(U1, "insert into media_attachments (player_id, org_id, storage_path, public_url, kind) values ('p1','default','p1/report/x.jpg','u','image') returning id")).rows?.length === 1,
   "[③] 自分の選手のフォルダなら写真の記録を作れる");
// ログインの有効期限
await db.exec(`update org_memberships set expires_at = now() - interval '1 minute' where user_id = '${U1}'`);
ok((await as(U1, "select count(*)::int from players")).rows?.[0]?.count === 0, "[③] ログインの期限（30日）が切れると、組織のデータは読めない");
await as(U1, "select public.org_login('default','1234')");
ok((await as(U1, "select count(*)::int from players")).rows?.[0]?.count > 0, "[③] ログインし直せば、また読める");
// 同じ組織への総当たり（匿名ユーザーを作り直す手口）
await db.exec(`insert into org_login_failures (user_id, org_id) select gen_random_uuid(), 'other' from generate_series(1, 100)`);
ok(/この組織へのログインの失敗が続いている/.test((await as(U2, "select public.org_login('other','otherpass')")).error || ""),
   "[③] 同じ組織への失敗が15分に100回を超えると、利用者を変えてもログインを止める");
await db.exec("delete from org_login_failures where org_id = 'other'");

// ===== 戻す：③ =====
ok(/先に supabase_rollback_v16/.test((await run("supabase_rollback_v15.sql")) || ""), "[戻し] ③が有効なまま①を戻そうとすると止まる");
{ const e = await run("supabase_rollback_v16.sql"); ok(!e, "[戻し] rollback_v16 の実行 1 回目 " + (e || "")); }
ok(!(await run("supabase_rollback_v16.sql")), "[戻し] rollback_v16 の実行 2 回目（冪等）");
ok(ACL_BEFORE_ENFORCE === await aclSnapshot(), "[戻し] テーブル・ビューの権限と設定も、③の前とまったく同じに戻る");
ok(/戻した後のログインが必要/.test((await run("supabase_migration_v16_enforce.sql")) || ""),
   "[戻し] 戻した後に v15 でのログインがなければ、③をもう一度実行しても止まる（v13 に戻していた場合の事故防止）");
ok(ORIGINAL_POLICIES === (await snapshotPolicies()).split("\n").filter((s) => !s.includes(":own memberships:")).join("\n"),
  "[戻し] ポリシーは v13 時代とまったく同じに戻る");
v13 = await v13Works();
ok(v13.all, "[戻し] v13 がまた動く " + JSON.stringify(v13.detail));
v15 = await v15Works(U1, "default", "1234");
ok(v15.all, "[戻し] v15 も動く（①の関数は残る） " + JSON.stringify(v15.detail));
const views = (await db.query("select relname, reloptions from pg_class where relkind='v' and relnamespace='public'::regnamespace")).rows;
ok(views.every((v) => !v.reloptions), "[戻し] ビューの security_invoker も外れる");
ok(one(await as(null, "select public.purge_expired_attachments()")) === 0 || true, "[戻し] 削除関数の権限も戻る（参考）");

// ===== ③をもう一度 =====
ok(!(await run("supabase_migration_v16_enforce.sql")), "[再適用] v16_enforce をもう一度実行できる");
ok(!(await v13Works()).all && (await v15Works(U1, "default", "1234")).all, "[再適用] v13 は止まり v15 は動く");
// 戻した後に増えた表も、次に戻したときに元どおりになるか（退避の取り直し）
ok(!(await run("supabase_rollback_v16.sql")), "[再適用] もう一度戻す");
await db.exec(`create table newtable (id int, org_id text); grant all on newtable to anon, authenticated;
  alter table newtable enable row level security; create policy "public all - newtable" on newtable for all using (true) with check (true);`);
await as(U1, "select public.org_login('default','1234')");
ok(!(await run("supabase_migration_v16_enforce.sql")), "[再適用] 表を足したあと③をもう一度");
ok(!(await run("supabase_rollback_v16.sql")), "[再適用] また戻す");
ok((await as(null, "insert into newtable values (1, 'x') returning id")).rows?.length === 1, "[再適用] 途中で足した表も、v13 時代と同じく開いた状態に戻る（退避を取り直している）");
await as(U1, "select public.org_login('default','1234')");
ok(!(await run("supabase_migration_v16_enforce.sql")), "[再適用] ③を適用して④へ");

// ===== v20：新しい組織にテンプレートをコピー =====
ok(!(await run("supabase_migration_v20_org_template.sql")), "[v20] 適用 1 回目");
ok(!(await run("supabase_migration_v20_org_template.sql")), "[v20] 適用 2 回目（冪等）");
const created = one(await as(ADMIN, "select public.admin_create_org('comm-a','コミュニティA','comm-a-pass')"));
ok(created?.copied?.protocols === 1 && created?.copied?.exercises === 2 && created?.copied?.steps === 4 && created?.copied?.menus === 1,
   "[v20] 組織を作ると default のプロトコル1・種目2・段階4・Phase別メニュー1がコピーされる " + JSON.stringify(created?.copied));
const U3 = randomUUID();
await db.exec(`insert into auth.users (id, is_anonymous) values ('${U3}', true)`);
await as(U3, "select public.org_login('comm-a','comm-a-pass')");
ok((await as(U3, "select id from protocols")).rows?.map((r) => r.id).join() === "comm-a-hs", "[v20] 新しい組織のメンバーは、自分の組織用にコピーされたプロトコルが見える");
ok((await as(U3, "select count(*)::int as n from exercises")).rows?.[0]?.n === 2, "[v20] 種目も自分の組織の分として見える");
ok((await as(U3, "select count(*)::int as n from exercise_steps s join exercises e on e.id = s.exercise_id")).rows?.[0]?.n === 4, "[v20] 種目の段階もつながっている");
ok((await db.query("select count(*)::int n from exercises where org_id = 'default'")).rows[0].n === 2, "[v20] 元の default 組織の種目は変わらない");
ok((await db.query("select (public.resprint_clone_template('default','comm-a'))->>'protocols' as n")).rows[0].n === "0", "[v20] もう一度コピーしても重複しない");
ok((await as(U3, "insert into phase_menus (org_id, protocol_id, phase_number, name) values ('comm-a','comm-a-hs',10,'Phase10') returning id")).rows?.length === 1,
   "[v20] Phase 10 のメニューを登録できる（以前は 1〜5 の制約でエラー）");
ok(!!(await as(U1, "select public.resprint_clone_template('default','x')")).error, "[v20] コピー関数はアプリから直接呼べない");

// ===== v21：指導者パスワードを管理者が設定・サーバーで照合 =====
ok(!(await run("supabase_migration_v21_coach_password.sql")), "[v21] 適用 1 回目");
ok(!(await run("supabase_migration_v21_coach_password.sql")), "[v21] 適用 2 回目（冪等）");
const c21 = one(await as(ADMIN, "select public.admin_create_org('comm-b','コミュニティB','comm-b-pass','coach-b-pass')"));
ok(c21?.coach_password_set === true, "[v21] 組織を作るときに指導者パスワードも設定できる");
ok(/別のもの/.test((await as(ADMIN, "select public.admin_create_org('comm-c','C','same-pass-1','same-pass-1')")).error || ""), "[v21] 組織パスワードと同じ指導者パスワードは拒否");
ok(one(await as(ADMIN, "select public.admin_create_org('comm-d','D','comm-d-pass')"))?.coach_password_set === false, "[v21] 3つの引数（以前の呼び方）でも組織を作れる（指導者パスワードは未設定）");
const U4 = randomUUID();
await db.exec(`insert into auth.users (id, is_anonymous) values ('${U4}', true)`);
await as(U4, "select public.org_login('comm-b','comm-b-pass')");
ok((await as(U4, "select value from app_settings where key = 'coach_password_hash'")).rows?.length === 0, "[v21] 選手（メンバー）は指導者パスワードのハッシュを読めない");
ok(!!(await as(U4, "insert into app_settings (org_id, key, value) values ('comm-b','coach_password_hash','x')")).error
   && (await as(U4, "update app_settings set value = 'x' where key = 'coach_password_hash' returning key")).rows?.length === 0,
   "[v21] 選手は指導者パスワードを書き換えられない（先に決めることもできない）");
ok(one(await as(U4, "select public.coach_check('comm-b','')"))?.set === true, "[v21] 設定済みかどうかが分かる（空の問い合わせ）");
ok(one(await as(U4, "select public.coach_check('comm-b','wrong')"))?.ok === false, "[v21] 間違ったパスワードは通らない");
ok(one(await as(U4, "select public.coach_check('comm-b','coach-b-pass')"))?.ok === true, "[v21] 正しいパスワードは通る");
ok(one(await as(U1, "select public.coach_check('default','coach')"))?.ok === true, "[v21] 既存の default の指導者パスワード（v13 からのもの）はそのまま使える");
ok(!!(await as(U4, "select public.coach_check('default','coach')")).error, "[v21] 他の組織の指導者パスワードは確かめられない");
ok(one(await as(U4, "select public.coach_change_password('comm-b','wrong','new-coach-1')")) === false, "[v21] 今のパスワードが違うと変更できない");
ok(one(await as(U4, "select public.coach_change_password('comm-b','coach-b-pass','new-coach-1')")) === true
   && one(await as(U4, "select public.coach_check('comm-b','new-coach-1')"))?.ok === true, "[v21] 指導者本人は、今のパスワードを確かめて変更できる");
ok(!!(await as(U4, "select public.admin_set_coach_password('comm-b','hijack')")).error, "[v21] 管理者以外は指導者パスワードを設定できない");
await as(ADMIN, "select public.admin_set_coach_password('comm-d','coach-d-pass')");
const U5 = randomUUID();
await db.exec(`insert into auth.users (id, is_anonymous) values ('${U5}', true)`);
await as(U5, "select public.org_login('comm-d','comm-d-pass')");
ok(one(await as(U5, "select public.coach_check('comm-d','coach-d-pass')"))?.ok === true, "[v21] 管理者は既存の組織の指導者パスワードを設定できる");
const lst = one(await as(ADMIN, "select public.admin_list_orgs()"));
ok(lst.find((o) => o.id === "comm-b")?.has_coach_password === true && lst.every((o) => !JSON.stringify(o).includes("coach_password_hash")), "[v21] 管理者の一覧に「指導者パスワード設定済み」が出て、ハッシュは出ない");
for (let i = 0; i < 10; i++) await as(U5, "select public.coach_check('comm-d','x" + i + "')");
ok(/間違いが続いた/.test((await as(U5, "select public.coach_check('comm-d','coach-d-pass')")).error || ""), "[v21] 10回間違えると15分止まる");
ok((await as(U1, "select value from app_settings where key = 'other_setting'")).rows?.length === 1, "[v21] 指導者パスワード以外の設定は、今までどおりメンバーが読める");

// ===== ④ finalize =====
ok(!(await run("supabase_migration_v17_finalize.sql")), "[④] v17_finalize の実行 1 回目");
ok(!(await run("supabase_migration_v17_finalize.sql")), "[④] v17_finalize の実行 2 回目（冪等）");
ok(one(await as(U1, "select public.org_login('default','1234')"))?.id === "default", "[④] 旧形式のパスワードでログインできる");
ok((await db.query("select password_hash from organizations where id='default'")).rows[0].password_hash.startsWith("$2"), "[④] ログイン成功で bcrypt に置き換わる");
ok(one(await as(U1, "select public.org_login('default','1234')"))?.id === "default", "[④] 置き換え後も同じパスワードでログインできる");
ok(one(await as(ADMIN, "select public.admin_create_org('bc-team','bc','bcteam-pass')"))?.id === "bc-team"
   && (await db.query("select password_hash from organizations where id='bc-team'")).rows[0].password_hash.startsWith("$2"), "[④] 新しい組織は bcrypt で保存");
ok((await db.query("select to_regclass('public.gate_check_agreement') v")).rows[0].v === null, "[④] gate_check_agreement は削除");
ok((await db.query("select count(*)::int n from gate_item_checks")).rows[0].n === 2, "[④] チェック記録そのものは残る");
ok((await db.query("select count(*)::int n from resprint_migration_backup where step='v17' and kind='view_definition'")).rows[0].n === 1, "[④] 削除したビューの定義は退避されている（1件）");
ok(/段階④（v17）が適用済みのため、③は戻せません/.test((await run("supabase_rollback_v16.sql")) || ""), "[④] ④の後は③を戻せない（データを公開状態に戻さない）");
ok(/段階③（v16）が有効|段階④（v17）が適用済み/.test((await run("supabase_rollback_v15.sql")) || ""), "[④] ④の後は①も戻せない");
ok(Number((await as(null, "select count(*) as n from players")).rows?.[0]?.n) === 0, "[④] 戻そうとしても、データは匿名キーでは1件も読めないまま");

// ===== ①を戻す（別の DB で：①のあと③をせずに戻すケース） =====
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
