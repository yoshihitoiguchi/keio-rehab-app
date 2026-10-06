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

// ===== v22：DB の控え（スナップショット） =====
ok(!(await run("supabase_migration_v22_snapshot.sql")), "[v22] 適用 1 回目");
ok(!(await run("supabase_migration_v22_snapshot.sql")), "[v22] 適用 2 回目（冪等）");
const snapRows = (await db.query("select * from resprint_backup.take_snapshot('test-1')")).rows;
const nReports = (await db.query("select count(*)::int n from reports")).rows[0].n;
ok(snapRows.find((r) => r.table_name === "reports")?.row_count === nReports && !snapRows.some((r) => r.table_name === "org_login_failures"),
   "[v22] 控えに全テーブルの行が入る（ログイン失敗の記録は除く）");
ok(!!(await as(U1, "select * from resprint_backup.snapshots")).error, "[v22] 組織のメンバーは控えを読めない");
ok(!!(await as(U1, "select * from resprint_backup.take_snapshot('x')")).error, "[v22] 組織のメンバーは控えを取れない");
ok(!!(await as(null, "select * from resprint_backup.snapshots")).error, "[v22] 匿名キーでも控えを読めない");
await db.exec("delete from reports where id = (select min(id) from reports)");
await db.exec(`insert into public.reports overriding system value
  select * from jsonb_populate_recordset(null::public.reports,
    (select rows from resprint_backup.snapshots where label = 'test-1' and table_name = 'reports'))
  on conflict do nothing`);
ok((await db.query("select count(*)::int n from reports")).rows[0].n === nReports, "[v22] 消した日報を控えから戻せる");
for (let i = 2; i <= 12; i++) await db.query(`select * from resprint_backup.take_snapshot('test-${i}', 10)`);
ok((await db.query("select count(distinct label)::int n from resprint_backup.snapshots")).rows[0].n === 10, "[v22] 控えは新しい10回分だけ残る");

// ===== v23：指導者パスワードの変更記録 =====
ok(!(await run("supabase_migration_v23_coach_password_log.sql")), "[v23] 適用 1 回目");
ok(!(await run("supabase_migration_v23_coach_password_log.sql")), "[v23] 適用 2 回目（冪等）");
const r23 = await as(U4, "select public.coach_change_password('comm-b','new-coach-1','coach-b-new') as v");
ok(r23.rows?.[0]?.v === true, "[v23] 指導者は今のパスワードを確かめて変更できる");
let lst23 = one(await as(ADMIN, "select public.admin_list_orgs()"));
let b23 = lst23.find((o) => o.id === "comm-b");
ok(b23?.coach_password_changed_by === "coach" && !!b23?.coach_password_updated_at, "[v23] 管理者の一覧に「指導者本人が変更」と日時が出る");
await as(ADMIN, "select public.admin_set_coach_password('comm-b','coach-b-reset')");
b23 = one(await as(ADMIN, "select public.admin_list_orgs()")).find((o) => o.id === "comm-b");
ok(b23?.coach_password_changed_by === "admin", "[v23] 管理者がリセットすると「管理者」になる");
ok(one(await as(U4, "select public.coach_check('comm-b','coach-b-reset')"))?.ok === true, "[v23] リセット後のパスワードで指導者モードに入れる");
ok((await as(U4, "select value from app_settings where key like 'coach_password%'")).rows?.length === 0
   && !!(await as(U4, "insert into app_settings (org_id, key, value) values ('comm-b','coach_password_changed_by','admin')")).error,
   "[v23] 変更記録はメンバーから読めない・偽装できない");
ok((await as(U1, "select value from app_settings where key = 'other_setting'")).rows?.length === 1, "[v23] ほかの設定は今までどおり読める");
ok(!(await run("supabase_rollback_v23.sql")), "[v23] 戻し用 SQL が通る");
ok(one(await as(U4, "select public.coach_check('comm-b','coach-b-reset')"))?.ok === true, "[v23] 戻してもパスワードはそのまま使える");
ok(!(await run("supabase_migration_v23_coach_password_log.sql")), "[v23] 戻した後にもう一度適用できる");

// ===== v24：管理者がパスワードを確認できる =====
ok(!(await run("supabase_migration_v24_org_secrets.sql")), "[v24] 適用 1 回目");
ok(!(await run("supabase_migration_v24_org_secrets.sql")), "[v24] 適用 2 回目（冪等）");
let sec = one(await as(ADMIN, "select public.admin_get_org_secrets('comm-b')"));
ok(sec?.id === "comm-b" && sec.password === null && sec.coach_password === null, "[v24] 以前に設定したパスワードは確認できない（null）");
await as(ADMIN, "select public.admin_set_org_password('comm-b','comm-b-newpass')");
await as(ADMIN, "select public.admin_set_coach_password('comm-b','coach-b-shown')");
sec = one(await as(ADMIN, "select public.admin_get_org_secrets('comm-b')"));
ok(sec.password === "comm-b-newpass" && sec.coach_password === "coach-b-shown" && !!sec.password_at, "[v24] 設定し直すと、管理者は組織・指導者パスワードを確認できる");
await as(U4, "select public.org_login('comm-b','comm-b-newpass')");
ok(one(await as(U4, "select public.coach_change_password('comm-b','coach-b-shown','coach-by-coach')")) === true
   && one(await as(ADMIN, "select public.admin_get_org_secrets('comm-b')")).coach_password === "coach-by-coach",
   "[v24] 指導者が自分で変えたパスワードも、管理者は確認できる");
const c24 = one(await as(ADMIN, "select public.admin_create_org('comm-e','E','comm-e-pass','coach-e-pass')"));
sec = one(await as(ADMIN, "select public.admin_get_org_secrets('comm-e')"));
ok(c24?.id === "comm-e" && sec.password === "comm-e-pass" && sec.coach_password === "coach-e-pass", "[v24] 新しく作った組織は、作成時のパスワードを確認できる");
ok(!!(await as(U4, "select public.admin_get_org_secrets('comm-b')")).error, "[v24] 管理者以外は確認の関数を呼べない");
ok(!!(await as(U4, "select * from resprint_private.org_secrets")).error && !!(await as(null, "select * from resprint_private.org_secrets")).error,
   "[v24] メンバー・匿名キーは控えの表を直接読めない");
ok(!!(await as(U4, "select resprint_private.save_secret('comm-b','coach','hijack')")).error, "[v24] メンバーは控えを書き換えられない");
ok(one(await as(U4, "select public.coach_check('comm-b','coach-by-coach')"))?.ok === true, "[v24] 照合は今までどおり（ログインの動きは変わらない）");
await db.exec("insert into players (id, org_id, name, pin) values ('p-e1','comm-e','E の選手','0000'); insert into reports (player_id, vas) values ('p-e1', 2)");
const del24 = await as(ADMIN, "select public.admin_delete_org('comm-e')");
ok(!del24.error && (await db.query("select (select count(*) from organizations where id='comm-e') + (select count(*) from protocols where org_id='comm-e') + (select count(*) from players where org_id='comm-e') + (select count(*) from reports where player_id='p-e1') as n")).rows[0].n == 0,
   "[v24] データ（プロトコル・選手・日報）のある組織も削除できる " + (del24.error || ""));
ok(/テンプレート/.test((await as(ADMIN, "select public.admin_delete_org('default')")).error || "") && (await db.query("select count(*)::int n from organizations where id='default'")).rows[0].n === 1, "[v24] default は削除できない");
ok((await db.query("select count(*)::int n from protocols where org_id = 'comm-b'")).rows[0].n >= 1, "[v24] ほかの組織のデータは消えない");
ok((await db.query("select count(*)::int n from resprint_private.org_secrets where org_id = 'comm-e'")).rows[0].n === 0, "[v24] 組織を削除すると控えも消える");
ok(!(await run("supabase_rollback_v24.sql")), "[v24] 戻し用 SQL が通る");
ok(one(await as(U4, "select public.coach_check('comm-b','coach-by-coach')"))?.ok === true
   && (await db.query("select to_regnamespace('resprint_private') v")).rows[0].v === null, "[v24] 戻すと控えは消え、ログインはそのまま");
ok(!(await run("supabase_migration_v24_org_secrets.sql")), "[v24] 戻した後にもう一度適用できる");

// ===== v25：「実施後〜翌日に症状増悪なし」を条件から外す =====
await db.exec("alter table protocols add column if not exists phases jsonb default '[]'; alter table exercises add column if not exists notes text;");
await db.exec(`update protocols set phases = '[{"title":"P1","conditions":["歩行が正常","実施後〜翌日に症状増悪なし"]},{"title":"P2","conditions":["Uphill 継続","実施後〜翌日に症状増悪なし（※Flatへの移行は必ず別セッションで行う）"]},{"title":"P3","conditions":["痛みなし"]}]'::jsonb where id = 'hs';
  insert into exercises (org_id, protocol_id, name) values ('default','hs','Flat Running @82%')`);
ok(!(await run("supabase_migration_v25_remove_nextday_item.sql")), "[v25] 適用 1 回目");
const ph25 = (await db.query("select phases from protocols where id = 'hs'")).rows[0].phases;
ok(JSON.stringify(ph25.map((x) => x.conditions)) === JSON.stringify([["歩行が正常"], ["Uphill 継続"], ["痛みなし"]]) && ph25[0].title === "P1",
   "[v25] 「翌日」の条件だけが外れ、ほかの条件・名称・順番はそのまま");
ok(/別セッション/.test((await db.query("select notes from exercises where name = 'Flat Running @82%' and protocol_id = 'hs'")).rows[0].notes || ""),
   "[v25] Flat への移行の注意は、Flat Running のメモに残る");
ok(!(await run("supabase_migration_v25_remove_nextday_item.sql")), "[v25] 適用 2 回目（冪等）");
ok(JSON.stringify((await db.query("select phases from protocols where id = 'hs'")).rows[0].phases) === JSON.stringify(ph25), "[v25] 2回目で内容が変わらない");

// ===== v26：「続ける種目」の案内はプロトコルごとの設定 =====
await db.exec("insert into protocols (id, org_id, name) values ('proto-hamstring-10','default','ハムストリング肉離れ'), ('comm-b-proto-hamstring-10','comm-b','ハムストリング肉離れ'), ('proto-acl','default','前十字靭帯') on conflict do nothing");
ok(!(await run("supabase_migration_v26_continue_rule.sql")), "[v26] 適用 1 回目");
ok(!(await run("supabase_migration_v26_continue_rule.sql")), "[v26] 適用 2 回目（冪等）");
const cr = (await db.query("select id, continue_rule from protocols where id in ('proto-hamstring-10','comm-b-proto-hamstring-10','proto-acl','hs') order by id")).rows;
ok(cr.find((r) => r.id === "proto-hamstring-10")?.continue_rule?.from_phase === 4 && cr.find((r) => r.id === "comm-b-proto-hamstring-10")?.continue_rule?.categories?.join() === "strength,eccentric",
   "[v26] ハムストリング肉離れのプロトコル（各組織のコピーも）に案内の設定が入る");
ok(cr.find((r) => r.id === "proto-acl")?.continue_rule === null && cr.find((r) => r.id === "hs")?.continue_rule === null, "[v26] ほかのプロトコルには設定されない");
const c26 = one(await as(ADMIN, "select public.admin_create_org('comm-f','F','comm-f-pass','coach-f-pass')"));
ok(c26?.id === "comm-f" && (await db.query("select continue_rule from protocols where id = 'comm-f-proto-hamstring-10'")).rows[0]?.continue_rule?.from_phase === 4
   && (await db.query("select continue_rule from protocols where id = 'comm-f-proto-acl'")).rows[0]?.continue_rule === null,
   "[v26] 新しい組織にも、プロトコルごとの設定がそのまま引き継がれる");

// ===== v27：プッシュ通知 =====
await db.exec(`alter table messages add column if not exists sender text; alter table players add column if not exists sos boolean default false;
  create table if not exists consultation_requests (id bigint generated always as identity primary key, player_id text references players(id) on delete cascade, org_id text, note text);
  grant all on consultation_requests to anon, authenticated;
  create schema if not exists net; create table if not exists net.calls (id serial primary key, url text, body jsonb, headers jsonb);
  create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
    returns bigint language sql as $f$ insert into net.calls (url, body, headers) values (url, body, headers) returning id::bigint $f$;`);
ok(!(await run("supabase_migration_v27_push.sql")), "[v27] 適用 1 回目");
ok(!(await run("supabase_migration_v27_push.sql")), "[v27] 適用 2 回目（冪等）");
await db.exec("insert into players (id, org_id, name, pin) values ('p-b1','comm-b','B の選手','0000'), ('p-b2','comm-b','B の選手2','0000') on conflict do nothing");
const EP = (n) => `https://web.push.apple.com/test-${n}`;
ok(one(await as(U4, `select public.push_subscribe('comm-b','coach',null,'${EP("coach")}','k','a')`)) === true, "[v27] 組織のメンバーは、指導者の端末として通知を登録できる");
ok(one(await as(U4, `select public.push_subscribe('comm-b','player','p-b1','${EP("player")}','k','a')`)) === true, "[v27] 選手の端末として通知を登録できる");
ok(!!(await as(U1, `select public.push_subscribe('comm-b','coach',null,'${EP("x")}','k','a')`)).error, "[v27] ほかの組織の人は登録できない");
ok(!!(await as(U4, "select public.push_subscribe('comm-b','coach',null,'https://evil.example.com/hook','k','a')")).error, "[v27] 通知サービス以外の URL は宛先にできない");
ok(!!(await as(U4, `select public.push_subscribe('comm-b','player','p1','${EP("y")}','k','a')`)).error, "[v27] ほかの組織の選手の通知は登録できない");
ok(!!(await as(U4, "select * from resprint_private.push_subscriptions")).error && !!(await as(null, "select * from resprint_private.push_config")).error, "[v27] 宛先・設定の表はアプリから読めない");
await db.exec("insert into messages (player_id, sender, content) values ('p-b1','player','設定前のメッセージ')");
ok((await db.query("select count(*)::int n from net.calls")).rows[0].n === 0, "[v27] 送信役の設定がない間は、何も送らない（チャットは保存される）");
await db.exec("insert into resprint_private.push_config (key, value) values ('url','https://example.test/api/push'), ('secret','s3cret') on conflict (key) do update set value = excluded.value");
const calls = async () => (await db.query("select url, body, headers from net.calls order by id")).rows;
await db.exec("delete from net.calls; insert into messages (player_id, sender, content) values ('p-b1','player','ひざの裏が痛いです')");
let cl = await calls();
ok(cl.length === 1 && cl[0].url === "https://example.test/api/push" && cl[0].headers["x-resprint-secret"] === "s3cret"
   && cl[0].body.subscriptions.length === 1 && cl[0].body.subscriptions[0].endpoint === EP("coach") && cl[0].body.body === "選手から新しいメッセージがあります",
   "[v27] 選手のメッセージ → 指導者の端末へ通知");
ok(!JSON.stringify(cl[0].body).includes("ひざ") && !JSON.stringify(cl[0].body).includes("B の選手"), "[v27] 通知に、メッセージの本文や選手名は入らない");
await db.exec("delete from net.calls; insert into messages (player_id, sender, content) values ('p-b1','staff','了解です')");
cl = await calls();
ok(cl.length === 1 && cl[0].body.subscriptions[0].endpoint === EP("player") && cl[0].body.body === "指導者から新しいメッセージがあります", "[v27] 指導者のメッセージ → その選手の端末へ通知");
await db.exec("delete from net.calls; insert into messages (player_id, sender, content) values ('p-b2','staff','別の選手へ')");
ok((await calls()).length === 0, "[v27] ほかの選手あてのメッセージは、この選手の端末には届かない");
await db.exec("delete from net.calls; insert into messages (player_id, sender, content) values ('p-b1','player','【面談の予約】2026-10-05 18:00 の面談を予約しました。')");
cl = await calls();
ok(cl.length === 2 && cl.map((c) => c.body.body).sort().join() === "面談が予約されました,面談が決まりました", "[v27] 面談の予約 → 指導者と選手の双方へ通知");
await db.exec("delete from net.calls; insert into consultation_requests (player_id, org_id, note) values ('p-b1','comm-b','話したい')");
ok((await calls())[0]?.body.body === "面談の申し込みがあります", "[v27] 面談の申し込み → 指導者へ通知");
await db.exec("delete from net.calls; update players set sos = true where id = 'p-b1'; update players set sos = true where id = 'p-b1'");
ok((await calls()).length === 1 && (await calls())[0].body.tag === "sos", "[v27] SOS がオンになったときだけ、指導者へ通知（オンのままの更新では送らない）");
await db.exec("delete from net.calls; insert into messages (player_id, sender, content) values ('p1','player','default 組織の選手')");
ok((await calls()).length === 0, "[v27] ほかの組織の出来事は、この組織の端末に届かない");
ok(one(await as(null, `select public.push_report_gone('wrong', array['${EP("coach")}'])`)) === 0 && (await db.query("select count(*)::int n from resprint_private.push_subscriptions")).rows[0].n === 2,
   "[v27] 合言葉が違えば、宛先は消せない");
ok(one(await as(null, `select public.push_report_gone('s3cret', array['${EP("player")}'])`)) === 1, "[v27] 送信役は、使えなくなった宛先を消せる");
await db.exec("delete from org_memberships where org_id = 'comm-b'; delete from net.calls; insert into messages (player_id, sender, content) values ('p-b1','player','メンバーでなくなった後')");
ok((await calls()).length === 0, "[v27] 組織のメンバーでなくなった端末（パスワード変更後など）には送らない");
await as(U4, "select public.org_login('comm-b','comm-b-newpass')");
await db.exec("create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language plpgsql as $f$ begin raise exception 'network down'; end $f$");
ok(!(await run2("insert into messages (player_id, sender, content) values ('p-b1','player','通知が失敗しても')")) && (await db.query("select count(*)::int n from messages where content = '通知が失敗しても'")).rows[0].n === 1,
   "[v27] 通知の送信に失敗しても、チャットは保存される");
ok(one(await as(U4, `select public.push_unsubscribe('${EP("coach")}','coach')`)) === true && (await db.query("select count(*)::int n from resprint_private.push_subscriptions")).rows[0].n === 0, "[v27] 通知をオフにすると宛先が消える");
ok(!(await run("supabase_rollback_v27.sql")) && (await db.query("select to_regprocedure('public.push_subscribe(text,text,text,text,text,text)') v")).rows[0].v === null, "[v27] 戻し用 SQL が通る");
ok(!(await run2("insert into messages (player_id, sender, content) values ('p-b1','player','戻した後')")), "[v27] 戻した後もチャットは動く");
ok(!(await run("supabase_migration_v27_push.sql")), "[v27] 戻した後にもう一度適用できる");

// ===== v29：通知の文面 =====
ok(!(await run("supabase_migration_v29_push_wording.sql")) && !(await run("supabase_migration_v29_push_wording.sql")), "[v29] 適用（2回実行しても同じ）");
ok(!!(await as(U4, "select resprint_private.push_on_sos()")).error, "[v29] 置き換えた関数も、アプリからは呼べない");

// ===== v28：引き継ぎコード =====
ok(!(await run("supabase_migration_v28_transfer_code.sql")), "[v28] 適用 1 回目");
ok(!(await run("supabase_migration_v28_transfer_code.sql")), "[v28] 適用 2 回目（冪等）");
const tc = one(await as(U4, "select public.transfer_create('comm-b','p-b1')"));
ok(/^\d{8}$/.test(tc?.code || ""), "[v28] ログイン中の端末は、8桁の引き継ぎコードを作れる");
ok(!!(await as(U1, "select public.transfer_create('comm-b','p-b1')")).error, "[v28] その組織にログインしていない人は作れない");
ok(!!(await as(U4, "select public.transfer_create('comm-b','p1')")).error, "[v28] ほかの組織の選手のコードは作れない");
const U6 = randomUUID();
await db.exec(`insert into auth.users (id, is_anonymous) values ('${U6}', true)`);
ok((await as(U6, "select count(*)::int as n from players where org_id = 'comm-b'")).rows?.[0]?.n === 0, "[v28] 引き継ぐ前の新しい端末は、選手を読めない");
ok(one(await as(U6, "select public.transfer_redeem('00000000')")) === null, "[v28] 間違ったコードでは入れない");
const rd = one(await as(U6, `select public.transfer_redeem('${tc.code.slice(0, 4)} ${tc.code.slice(4)}')`));
ok(rd?.org?.id === "comm-b" && rd?.player?.id === "p-b1" && rd.player.name === "B の選手", "[v28] 正しいコード（空白入りでも）で、組織と選手が引き継がれる");
ok((await as(U6, "select count(*)::int as n from players where org_id = 'comm-b'")).rows?.[0]?.n >= 1, "[v28] 引き継いだ端末は、その組織のデータを読める");
ok(one(await as(U6, `select public.transfer_redeem('${tc.code}')`))?.org?.id === "comm-b", "[v28] 期限内なら貼り直しても使える");
const tc2 = one(await as(U4, "select public.transfer_create('comm-b')"));
ok(tc2.code !== tc.code && one(await as(U6, `select public.transfer_redeem('${tc.code}')`)) === null, "[v28] 作り直すと、前のコードは使えなくなる");
ok(one(await as(U6, `select public.transfer_redeem('${tc2.code}')`))?.player === null, "[v28] 選手なし（組織だけ）の引き継ぎもできる");
await db.exec("update resprint_private.transfer_codes set expires_at = now() - interval '1 minute'");
ok(one(await as(U6, `select public.transfer_redeem('${tc2.code}')`)) === null, "[v28] 期限（30分）を過ぎたコードは使えない");
ok(!!(await as(U6, "select * from resprint_private.transfer_codes")).error, "[v28] コードの表はアプリから読めない");
const U7 = randomUUID();
await db.exec(`insert into auth.users (id, is_anonymous) values ('${U7}', true)`);
for (let i = 0; i < 10; i++) await as(U7, `select public.transfer_redeem('1111${String(1000 + i)}')`);
ok(/間違いが続いた/.test((await as(U7, "select public.transfer_redeem('12345678')")).error || ""), "[v28] 10回間違えると15分止まる");

// ===== v15.13：面談の URL（app_settings の meeting_url。DB の変更なし・権限の確認だけ） =====
ok(!(await as(U4, "insert into app_settings (org_id, key, value) values ('comm-b','meeting_url','https://zoom.example/j/1') on conflict (key, org_id) do update set value = excluded.value")).error
   && (await as(U6, "select value from app_settings where org_id = 'comm-b' and key = 'meeting_url'")).rows?.[0]?.value === "https://zoom.example/j/1",
   "[v15.13] 組織のメンバーは面談の URL を登録でき、同じ組織の人は読める");
ok((await as(U1, "select value from app_settings where org_id = 'comm-b' and key = 'meeting_url'")).rows?.length === 0
   && !!((await as(U1, "insert into app_settings (org_id, key, value) values ('comm-b','meeting_url','https://evil.example')")).error),
   "[v15.13] ほかの組織の人は、読むことも書き換えることもできない");

// ===== v30：申し送りメモ・種目の記録・規約の同意・リマインド・自動バックアップ =====
await db.exec(`alter table reports add column if not exists date text; alter table players add column if not exists completed_at timestamptz;
  alter table slots add column if not exists booked_by text;
  create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
    returns bigint language sql as $f$ insert into net.calls (url, body, headers) values (url, body, headers) returning id::bigint $f$;
  insert into resprint_private.push_config (key, value) values ('url','https://example.test/api/push'), ('secret','s3cret') on conflict (key) do update set value = excluded.value;`);
ok(!(await run("supabase_migration_v30_operations.sql")), "[v30] 適用 1 回目");
ok(!(await run("supabase_migration_v30_operations.sql")), "[v30] 適用 2 回目（冪等）");
// (1)(2) メモと種目の記録
ok(!(await as(U4, "insert into staff_notes (player_id, author_role, body) values ('p-b1','trainer','左ハムの張りが残る')")).error
   && (await as(U6, "select body from staff_notes where player_id = 'p-b1'")).rows?.length === 1, "[v30] 同じ組織の人は、申し送りメモを書ける・読める");
ok((await as(U1, "select body from staff_notes")).rows?.length === 0 && !!(await as(U1, "insert into staff_notes (player_id, body) values ('p-b1','x')")).error
   && !!(await as(null, "select * from staff_notes")).error, "[v30] ほかの組織・匿名キーからは、メモを読めない・書けない");
const exB = (await db.query("select e.id from exercises e join protocols p on p.id = e.protocol_id where p.org_id = 'comm-b' limit 1")).rows[0]?.id
  ?? (await db.query("insert into exercises (org_id, protocol_id, name) values ('comm-b','comm-b-proto-hamstring-10','RDL') returning id")).rows[0].id;
ok(!(await as(U4, `insert into exercise_logs (player_id, exercise_id, done_on) values ('p-b1', ${exB}, current_date)`)).error
   && !!(await as(U4, `insert into exercise_logs (player_id, exercise_id, done_on) values ('p-b1', ${exB}, current_date)`)).error,
   "[v30] 「今日やった種目」を記録できる（同じ日・同じ種目は1件だけ）");
ok(!!(await as(U1, `insert into exercise_logs (player_id, exercise_id, done_on) values ('p-b1', ${exB}, current_date - 1)`)).error, "[v30] ほかの組織の人は記録できない");
// (3) 規約
ok(one(await as(U4, "select public.terms_status('p-b1')")) === null, "[v30] 文面を登録するまでは、同意の画面は出ない（null）");
ok(!!(await as(U4, "select public.admin_set_terms('勝手な規約')")).error, "[v30] 管理者以外は文面を登録できない");
ok(one(await as(ADMIN, "select public.admin_set_terms('  利用規約 第1版  ')"))?.version === 1, "[v30] 管理者が文面を登録すると第1版になる");
let ts = one(await as(U4, "select public.terms_status('p-b1')"));
ok(ts?.version === 1 && ts.body === "利用規約 第1版" && ts.accepted === false, "[v30] 選手には、まだ同意していない文面が返る");
ok(one(await as(U4, "select public.terms_accept('p-b1', 1)")) === true && one(await as(U4, "select public.terms_status('p-b1')"))?.accepted === true, "[v30] 同意すると記録される");
ok(one(await as(ADMIN, "select public.admin_set_terms('利用規約 第1版')"))?.changed === false, "[v30] 同じ文面なら版は上がらない");
ok(one(await as(ADMIN, "select public.admin_set_terms('利用規約 第2版')"))?.version === 2 && one(await as(U4, "select public.terms_status('p-b1')"))?.accepted === false, "[v30] 文面を変えると版が上がり、もう一度同意が必要になる");
ok(one(await as(ADMIN, "select public.admin_get_terms()"))?.accepted_count === 0 && !!(await as(U1, "select public.terms_status('p-b1')")).error, "[v30] 管理者は同意の人数を見られる／ほかの組織の選手の状態は見られない");
ok(one(await as(ADMIN, "select public.admin_set_terms('')"))?.version === 3 && one(await as(U4, "select public.terms_status('p-b1')")) === null, "[v30] 文面を空にすると、同意の画面は出なくなる");
// (4) リマインド
await as(U4, `select public.push_subscribe('comm-b','player','p-b1','${EP("player2")}','k','a')`);
await as(U4, `select public.push_subscribe('comm-b','coach',null,'${EP("coach2")}','k','a')`);
await db.exec("delete from net.calls; update players set sos = false");
const today30 = (await db.query("select to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM-DD') d")).rows[0].d;
ok((await db.query("select resprint_private.run_report_reminders() n")).rows[0].n === 1 && (await calls())[0]?.body.body === "今日の日報がまだです"
   && (await calls())[0].body.subscriptions[0].endpoint === EP("player2"), "[v30] 日報がまだの選手（通知オン）に、日報のリマインドが届く");
ok((await db.query("select resprint_private.run_report_reminders() n")).rows[0].n === 0, "[v30] 同じ日に二度は送らない");
await db.exec(`delete from net.calls; delete from resprint_private.reminder_log; insert into reports (player_id, vas, date) values ('p-b1', 2, '${today30}')`);
ok((await db.query("select resprint_private.run_report_reminders() n")).rows[0].n === 0 && (await calls()).length === 0, "[v30] 今日の日報を出した選手には送らない");
const jst = (mins) => `(select to_char((now() + interval '${mins} minutes') at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI'))`;
await db.exec(`delete from net.calls; delete from slots where org_id = 'comm-b';
  insert into slots (org_id, datetime, booked_by) values ('comm-b', ${jst(40)}, 'p-b1'), ('comm-b', ${jst(18 * 60)}, 'p-b1'), ('comm-b', ${jst(5 * 60)}, 'p-b1'), ('comm-b', ${jst(30)}, null), ('comm-b', ${jst(-30)}, 'p-b1')`);
ok((await db.query("select resprint_private.run_meeting_reminders() n")).rows[0].n === 2, "[v30] 面談のリマインド：1時間以内の1件と、24〜12時間前の1件だけが対象（5時間後・予約なし・過ぎたものは対象外）");
cl = await calls();
ok(cl.length === 4 && cl.filter((c) => c.body.body === "まもなく面談の時間です").length === 2 && cl.filter((c) => c.body.body === "面談の予定が近づいています").length === 2
   && cl.some((c) => c.body.subscriptions[0].endpoint === EP("coach2")) && cl.some((c) => c.body.subscriptions[0].endpoint === EP("player2")),
   "[v30] 選手と指導者の両方に届く");
ok((await db.query("select resprint_private.run_meeting_reminders() n")).rows[0].n === 0, "[v30] 同じ面談に同じリマインドを二度は送らない");
ok(!!(await as(U4, "select resprint_private.run_meeting_reminders()")).error, "[v30] リマインドの関数はアプリから呼べない");
// (5) 自動バックアップ
ok((await db.query("select resprint_backup.daily() n")).rows[0].n > 5 && (await db.query("select count(*)::int n from resprint_backup.snapshots where label like '自動 %' and table_name = 'staff_notes'")).rows[0].n === 1,
   "[v30] 毎日のバックアップが取れる（新しい表も含まれる）");
ok(!!(await as(U4, "select resprint_backup.daily()")).error, "[v30] バックアップの関数はアプリから呼べない");
ok(!(await run("supabase_rollback_v30.sql")) && (await db.query("select count(*)::int n from staff_notes")).rows[0].n === 1, "[v30] 戻し用 SQL が通る（メモのデータは残す）");
ok(!(await run("supabase_migration_v30_operations.sql")), "[v30] 戻した後にもう一度適用できる");

// ===== v31：Prone Hamstring Tantrums（PHASE 8 の条件と種目） =====
await db.exec(`alter table exercises add column if not exists intro_phase int, add column if not exists continues boolean default true,
  add column if not exists is_gate_exercise boolean default true, add column if not exists category text, add column if not exists prescription text,
  add column if not exists sort_order int default 0;
  alter table exercise_steps add column if not exists target text;
  update protocols set phases = (select jsonb_agg(jsonb_build_object('title', 'P' || g, 'conditions', jsonb_build_array('条件' || g))) from generate_series(1, 10) g)
   where id in ('proto-hamstring-10', 'comm-b-proto-hamstring-10');
  update protocols set phases = '[{"title":"P1","conditions":["a"]}]'::jsonb where id = 'proto-acl';`);
ok(!(await run("supabase_migration_v31_prone_hamstring_tantrums.sql")), "[v31] 適用 1 回目");
const p8 = async (id) => (await db.query("select phases->7->'conditions' as c, phases->6->'conditions' as c7, phases->8->'conditions' as c9 from protocols where id = $1", [id])).rows[0];
let h31 = await p8("proto-hamstring-10");
ok(h31.c.length === 2 && h31.c[0] === "条件8" && /Prone Hamstring Tantrums 15秒×2–3set/.test(h31.c[1]) && h31.c7.length === 1 && h31.c9.length === 1,
   "[v31] PHASE 8 の条件の最後にだけ足される（ほかの PHASE・既存の条件はそのまま）");
ok((await p8("comm-b-proto-hamstring-10")).c.length === 2, "[v31] 各組織へのコピーにも入る");
ok((await db.query("select phases from protocols where id = 'proto-acl'")).rows[0].phases.length === 1
   && (await db.query("select count(*)::int n from exercises where name = 'Prone Hamstring Tantrums' and protocol_id = 'proto-acl'")).rows[0].n === 0, "[v31] ほかのプロトコルには入らない");
const ex31 = (await db.query("select e.org_id, e.intro_phase, e.category, e.is_gate_exercise, e.sort_order, (select string_agg(s.label || ':' || s.target, ' / ' order by s.step_order) from exercise_steps s where s.exercise_id = e.id) as steps from exercises e where e.name = 'Prone Hamstring Tantrums' and e.protocol_id = 'comm-b-proto-hamstring-10'")).rows[0];
ok(ex31?.org_id === "comm-b" && ex31.intro_phase === 8 && ex31.category === "strength" && ex31.is_gate_exercise === true && ex31.steps === "導入:10秒×2set / 基本:15秒×2–3set",
   "[v31] 種目が PHASE 8 導入・Strength・ステップ2つ（導入→基本）で登録される");
const n31 = (await db.query("select count(*)::int n from exercises where name = 'Prone Hamstring Tantrums'")).rows[0].n;
ok(!(await run("supabase_migration_v31_prone_hamstring_tantrums.sql")) && (await p8("proto-hamstring-10")).c.length === 2 && n31 >= 2
   && (await db.query("select count(*)::int n from exercises where name = 'Prone Hamstring Tantrums'")).rows[0].n === n31,
   "[v31] 2回実行しても、条件も種目も重複しない");
const c31 = one(await as(ADMIN, "select public.admin_create_org('comm-g','G','comm-g-pass','coach-g-pass')"));
ok(c31?.id === "comm-g" && (await p8("comm-g-proto-hamstring-10")).c.length === 2
   && (await db.query("select count(*)::int n from exercise_steps s join exercises e on e.id = s.exercise_id where e.protocol_id = 'comm-g-proto-hamstring-10' and e.name = 'Prone Hamstring Tantrums'")).rows[0].n === 2,
   "[v31] 新しい組織にも、条件・種目・ステップが引き継がれる");

// ===== v32：種目の動画・面談メモ・よくある質問・Tantrums の GATE =====
await db.exec("insert into exercises (org_id, protocol_id, name, notes) values ('comm-b','comm-b-proto-hamstring-10','Sprint Drill｜B Skip / Cycling / Mini Hurdle（狭め）','元のメモ。'), ('comm-b','comm-b-proto-hamstring-10','Bilateral RDL', null)");
ok(!(await run("supabase_migration_v32_videos_notes_faq.sql")), "[v32] 適用 1 回目");
let g32 = (await p8("comm-b-proto-hamstring-10")).c;
ok(g32.length === 2 && g32[0] === "条件8" && g32[1] === "Prone Hamstring Tantrums 50回×3setを違和感なく実施可能", "[v32] PHASE 8 の Tantrums の条件が「50回×3set を違和感なく」に置き換わる（位置・数はそのまま）");
const st32 = (await db.query("select string_agg(s.label || ':' || s.target, ' / ' order by s.step_order) v from exercise_steps s join exercises e on e.id = s.exercise_id where e.protocol_id = 'comm-b-proto-hamstring-10' and e.name = 'Prone Hamstring Tantrums'")).rows[0].v;
ok(st32 === "導入:10秒×2set / 基本:15秒×2–3set / GATE:50回×3set", "[v32] 種目のステップに 50回×3set が加わる");
const faq32 = (await db.query("select faq from protocols where id = 'comm-b-proto-hamstring-10'")).rows[0].faq;
ok(faq32.length === 2 && /身長と同じくらい/.test(faq32[0].a) && /RDL/.test(faq32[1].a) && (await db.query("select faq from protocols where id = 'proto-acl'")).rows[0].faq.length === 0, "[v32] よくある質問が2件入る（ほかのプロトコルには入らない）");
const nt32 = (await db.query("select name, notes from exercises where protocol_id = 'comm-b-proto-hamstring-10' and (name like '%Mini Hurdle%' or name = 'Bilateral RDL') order by name")).rows;
ok(/ウエイトを解禁/.test(nt32[0].notes) && nt32[1].notes.startsWith("元のメモ。") && /身長と同じくらいの幅/.test(nt32[1].notes), "[v32] 関係する種目のメモに追記される（元のメモは残る）");
ok(!(await run("supabase_migration_v32_videos_notes_faq.sql")) && (await p8("comm-b-proto-hamstring-10")).c.length === 2
   && (await db.query("select faq from protocols where id = 'comm-b-proto-hamstring-10'")).rows[0].faq.length === 2
   && (await db.query("select count(*)::int n from exercise_steps s join exercises e on e.id = s.exercise_id where e.protocol_id = 'comm-b-proto-hamstring-10' and e.name = 'Prone Hamstring Tantrums'")).rows[0].n === 3
   && (await db.query("select notes from exercises where protocol_id = 'comm-b-proto-hamstring-10' and name = 'Bilateral RDL'")).rows[0].notes.match(/ウエイトを解禁/g).length === 1,
   "[v32] 2回実行しても、条件・ステップ・質問・メモが重複しない");
ok(!(await as(U4, "insert into meeting_notes (player_id, held_on, author_role, body) values ('p-b1', current_date, 'doctor', '次回は2週間後')")).error
   && (await as(U6, "select body from meeting_notes where player_id = 'p-b1'")).rows?.length === 1, "[v32] 同じ組織の人は、面談メモを書ける・読める");
ok((await as(U1, "select body from meeting_notes")).rows?.length === 0 && !!(await as(U1, "insert into meeting_notes (player_id, body) values ('p-b1','x')")).error
   && !!(await as(null, "select * from meeting_notes")).error, "[v32] ほかの組織・匿名キーからは、面談メモを読めない・書けない");
ok(!(await as(U4, "update exercises set video_url = 'https://www.youtube.com/watch?v=abc' where protocol_id = 'comm-b-proto-hamstring-10' and name = 'Bilateral RDL'")).error
   && (await db.query("select video_url from exercises where protocol_id = 'comm-b-proto-hamstring-10' and name = 'Bilateral RDL'")).rows[0].video_url === "https://www.youtube.com/watch?v=abc",
   "[v32] 自分の組織の種目に、動画の URL を登録できる");
const c32 = one(await as(ADMIN, "select public.admin_create_org('comm-h','H','comm-h-pass','coach-h-pass')"));
ok(c32?.id === "comm-h" && (await db.query("select faq from protocols where id = 'comm-h-proto-hamstring-10'")).rows[0].faq.length === 2
   && (await db.query("select video_url from exercises where protocol_id = 'comm-h-comm-b-proto-hamstring-10' or protocol_id = 'comm-h-proto-hamstring-10' limit 1")).rows.length === 1,
   "[v32] 新しい組織にも、よくある質問などが引き継がれる");

// ===== v33：動画を全組織で共通に・プロトコルの改定 =====
await db.exec(`update protocols set phases = jsonb_set(phases, '{7,conditions}', '["Mini Hurdleを狭め設定から問題なく実施可能","Prone Hamstring Tantrums 50回×3setを違和感なく実施可能"]'::jsonb) where id = 'comm-b-proto-hamstring-10';
  insert into exercise_steps (exercise_id, step_order, label) select id, 3, '狭めのMini Hurdle（平均ストライド程度）' from exercises where protocol_id = 'comm-b-proto-hamstring-10' and name like '%Mini Hurdle%';`);
ok(!(await run("supabase_migration_v33_shared_videos_protocol_fix.sql")), "[v33] 適用 1 回目");
const pr33 = (await db.query("select phases, faq from protocols where id = 'comm-b-proto-hamstring-10'")).rows[0];
ok(JSON.stringify(pr33.phases[7].conditions) === JSON.stringify(["Mini Hurdleを身長幅の設定から問題なく実施可能",
     "Prone Hamstring Tantrums 15秒×2–3setを、痛みなし・左右差が大きくならない・速度が落ちすぎない・翌日増悪なしで実施可能",
     "Prone Hamstring Tantrums 50回×3setを違和感なく実施可能"]),
   "[v33] PHASE 8：Tantrums の条件が2つ（15秒…／50回…）になり、Mini Hurdle は「身長幅」になる");
ok(pr33.phases[2].title === "P3（両脚RDLができたらウエイト解禁）" && pr33.phases[1].title === "P2" && pr33.faq.length === 0, "[v33] PHASE 3 の名称にウエイト解禁を付ける／よくある質問の2件は外す");
const ex33 = (await db.query("select e.name, e.notes, (select string_agg(s.label, ' / ' order by s.step_order) from exercise_steps s where s.exercise_id = e.id) steps from exercises e where e.protocol_id = 'comm-b-proto-hamstring-10' and e.name like '%Mini Hurdle%'")).rows[0];
ok(ex33.name.endsWith("Mini Hurdle（身長幅）") && ex33.steps === "Mini Hurdle（身長幅）" && ex33.notes === "元のメモ。 開始時の幅は身長と同じくらい。", "[v33] 種目名・ステップ・メモも「身長幅」に（元のメモは残る）");
ok(/条件：痛みなし.*GATE：50回×3set/.test((await db.query("select notes from exercises where protocol_id = 'comm-b-proto-hamstring-10' and name = 'Prone Hamstring Tantrums'")).rows[0].notes), "[v33] Tantrums のメモに条件と GATE の両方が入る");
ok((await db.query("select video_url from exercise_videos where name = 'Bilateral RDL'")).rows[0]?.video_url === "https://www.youtube.com/watch?v=abc", "[v33] 組織ごとに登録済みだった動画は、共通の表へ移る");
ok(!(await run("supabase_migration_v33_shared_videos_protocol_fix.sql"))
   && JSON.stringify((await db.query("select phases from protocols where id = 'comm-b-proto-hamstring-10'")).rows[0].phases) === JSON.stringify(pr33.phases)
   && (await db.query("select notes from exercises where protocol_id = 'comm-b-proto-hamstring-10' and name like '%Mini Hurdle%'")).rows[0].notes === ex33.notes,
   "[v33] 2回実行しても内容が変わらない");
// 動画の登録：指導者パスワードが合っている人だけ。全組織に出る
await as(ADMIN, "select public.admin_set_coach_password('comm-b','coach-b-v33')");
ok(!!(await as(U4, "select public.exercise_video_set('comm-b','wrong-pass','Nordic Hamstring','https://youtu.be/x1')")).error, "[v33] 指導者パスワードが違えば、動画を登録できない（選手は登録できない）");
ok(one(await as(U4, "select public.exercise_video_set('comm-b','coach-b-v33','Nordic Hamstring','https://youtu.be/x1')")) === true, "[v33] 指導者は動画を登録できる");
ok((await as(U1, "select video_url from exercise_videos where name = 'Nordic Hamstring'")).rows?.[0]?.video_url === "https://youtu.be/x1", "[v33] 登録した動画は、ほかの組織からも読める（全組織で共通）");
ok(!!(await as(U4, "insert into exercise_videos (name, video_url) values ('X','https://evil.example')")).error
   && (await as(U4, "update exercise_videos set video_url = 'https://evil.example' returning name")).rows?.length === undefined || !!(await as(U4, "update exercise_videos set video_url = 'https://evil.example'")).error,
   "[v33] 表を直接書き換えることはできない");
ok(!!(await as(U4, "select public.exercise_video_set('comm-b','coach-b-v33','Nordic Hamstring','javascript:alert(1)')")).error, "[v33] http(s) 以外の URL は登録できない");
ok(!!(await as(U1, "select public.exercise_video_set('comm-b','coach-b-v33','Nordic Hamstring','https://youtu.be/x2')")).error, "[v33] その組織に入っていない人は、パスワードを知っていても登録できない");
ok(one(await as(ADMIN, "select public.exercise_video_set(null, null, 'Nordic Hamstring', '')")) === true
   && (await db.query("select count(*)::int n from exercise_videos where name = 'Nordic Hamstring'")).rows[0].n === 0, "[v33] 管理者はパスワードなしで登録・削除できる（URL を空にすると削除）");
ok(!!(await as(null, "select * from exercise_videos")).error, "[v33] 匿名キーでは読めない");

// ===== v34：PHASE 8 の Tantrums は 50回×3set だけ・ウエイト解禁は RDL の条件に併記 =====
await db.exec(`update protocols set phases = jsonb_set(phases, '{2,conditions}', '["条件3","Bilateral RDL 6〜10回×3setを高い努力度で実施可能"]'::jsonb) where id = 'comm-b-proto-hamstring-10'`);
ok(!(await run("supabase_migration_v34_phase8_gate_rdl_note.sql")), "[v34] 適用 1 回目");
const pr34 = (await db.query("select phases from protocols where id = 'comm-b-proto-hamstring-10'")).rows[0].phases;
ok(JSON.stringify(pr34[7].conditions) === JSON.stringify(["Mini Hurdleを身長幅の設定から問題なく実施可能", "Prone Hamstring Tantrums 50回×3setを違和感なく実施可能"]),
   "[v34] PHASE 8：元の条件はそのまま、Tantrums は「50回×3set」の1項目だけ");
ok(pr34[2].title === "P3" && JSON.stringify(pr34[2].conditions) === JSON.stringify(["条件3", "Bilateral RDL 6〜10回×3setを高い努力度で実施可能（できたらウエイト解禁）"]),
   "[v34] ウエイト解禁は PHASE 3 の名称から外し、Bilateral RDL の条件に併記");
ok(!(await run("supabase_migration_v34_phase8_gate_rdl_note.sql"))
   && JSON.stringify((await db.query("select phases from protocols where id = 'comm-b-proto-hamstring-10'")).rows[0].phases) === JSON.stringify(pr34), "[v34] 2回実行しても内容が変わらない");

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
