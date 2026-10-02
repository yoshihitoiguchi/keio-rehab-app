// ============================================================
// 本番の状態を確かめる（読み取りのみ。データの読み書きはしない）
//
//   npm run check:prod
//
//   ・公開中のアプリのビルドスタンプ
//   ・Supabase の匿名サインインが有効か
//   ・段階①（v15_prepare）が適用済みか … org_login 関数があるか
//   ・段階③（v16_enforce）が適用済みか … 匿名キーで組織表を読めなくなっているか
//
//   どの問い合わせも「0件だけ取得（limit=0）」か「権限がなくて実行されない呼び出し」で、
//   選手のデータは1件も取得しません。
// ============================================================

const SITE = process.env.CHECK_SITE || "https://keio-rehab-app.vercel.app";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://akvfrihatvfkrjzpxtcw.supabase.co";
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_c2dND4Q3D36SDX8JsxaWSA_ayFHmuSJ";
// 新形式の公開キー（sb_publishable_...）は Authorization に入れない
const H = ANON.startsWith("eyJ") ? { apikey: ANON, Authorization: `Bearer ${ANON}` } : { apikey: ANON };

async function safe(fn) {
  try {
    return await fn();
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

const out = [];
const row = (item, value, note = "") => out.push({ item, value, note });

// 1. 公開中のアプリ
const site = await safe(async () => {
  const html = await (await fetch(SITE, { cache: "no-store" })).text();
  const js = html.match(/\/assets\/index-[^"]+\.js/)?.[0];
  const code = js ? await (await fetch(SITE + js)).text() : "";
  // v15.14 から、ビルド番号は "v15.14" のように番号だけ（それ以前は "v15.13 (説明)" の形）
  const build = code.match(/"(v1\d(?:\.\d+)?(?: \([^)"]{1,40}\))?)"/)?.[1] || "(不明)";
  const sw = (await fetch(SITE + "/sw.js", { cache: "no-store" })).status;
  return { build, sw };
});
row("公開中のビルド", site.build ?? site.error);
row("sw.js（ホーム画面アプリ）", site.sw === 200 ? "あり" : `なし（${site.sw ?? site.error}）`, "v15 を公開すると「あり」になる");

// 2. 匿名サインイン
const auth = await safe(async () => (await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: ANON } })).json());
const anonOn = auth?.external?.anonymous_users;
row("匿名サインイン", anonOn === true ? "有効" : anonOn === false ? "無効" : `不明（${auth.error || ""}）`,
  "v15 アプリの公開前に「有効」にする");

// 3. 段階①：org_login 関数の有無（匿名キーには実行権限がないので、実行はされない）
const rpc = await safe(async () => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/org_login`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ p_org_id: "__check__", p_password: "__check__" }),
  });
  return { status: r.status, body: await r.text() };
});
let prepared = "不明";
if (rpc.status === 404 || /PGRST202|Could not find the function/.test(rpc.body || "")) prepared = "未適用";
else if (rpc.status === 401 || rpc.status === 403 || /permission denied/.test(rpc.body || "")) prepared = "適用済み";
else if (rpc.status === 200) prepared = "要確認（匿名キーで実行できてしまう）";
row("段階① v15_prepare", prepared, `HTTP ${rpc.status ?? rpc.error}`);

// 4. 段階③：匿名キーで組織表を読めるか（0件だけ取得）
const org = await safe(async () => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/organizations?select=id&limit=0`, { headers: H });
  return { status: r.status, body: await r.text() };
});
const enforced = org.status === 200 ? "未適用（v13 が動く状態）" : /permission denied|42501/.test(org.body || "") ? "適用済み（v13 は動かない）" : "不明";
row("段階③ v16_enforce", enforced, `HTTP ${org.status ?? org.error}`);

// 表示
console.log(`\n本番の状態（${new Date().toLocaleString("ja-JP")}）\n`);
for (const r of out) console.log(`  ・${r.item}：${r.value}${r.note ? `（${r.note}）` : ""}`);

// 次にやること
const b = site.build || "";
let next;
if (prepared === "未適用") next = "段階①：supabase_migration_v15_prepare.sql を適用する";
else if (anonOn !== true) next = "Supabase で匿名サインインを有効にする";
else if (!b.startsWith("v15")) next = "段階②：v15 アプリを公開する";
else if (enforced.startsWith("未適用")) next = "v15 アプリでログインを確認し、段階③：supabase_migration_v16_enforce.sql を適用する";
else next = "段階③まで完了。数週間問題がなければ段階④（v17_finalize）";
console.log(`\n  次にやること： ${next}\n`);
