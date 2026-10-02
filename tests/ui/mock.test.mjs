// ============================================================
// 画面テスト（スマホ幅 390px）  npm run test:ui
//
//   本物の DB の代わりに、ブラウザの中で決まった応答を返して画面の動きを確かめる。
//   ・本番にも、ネットワークにも触れない（Supabase への通信はすべてこの中で横取りする）
//   ・自分でテスト用にビルドし（.test-dist/）、vite preview で配信してから Chrome で開く
//   ・Chrome は Mac に入っているものを使う（CHROME_PATH で変更可）
// ============================================================
import puppeteer from "puppeteer-core";
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const OUT = join(ROOT, ".test-dist");
const API = "http://127.0.0.1:59999";
const PORT = 5179;
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${l}`); };

execSync(`npx vite build --outDir ${JSON.stringify(OUT)} --emptyOutDir`, {
  cwd: ROOT, stdio: "ignore", env: { ...process.env, VITE_SUPABASE_URL: API, VITE_SUPABASE_ANON_KEY: "sb_publishable_test" },
});
const preview = spawn("npx", ["vite", "preview", "--outDir", OUT, "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
// Chrome のプロファイルはこのフォルダの中に作る（終わったら消す）
const profile = mkdtempSync(join(ROOT, ".test-profile-"));
let browser;
const cleanup = () => { try { preview.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} try { rmSync(OUT, { recursive: true, force: true }); } catch {} };
for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await sleep(250); }

// ---- 決まった応答（テスト用のデータ） ----
const now = new Date();
const iso = (d) => d.toISOString();
const dayStr = (offset) => new Date(now.getTime() + offset * 86400000).toISOString().slice(0, 10);
const phases = Array.from({ length: 10 }, (_, i) => ({ title: `フェーズ${i + 1}の名前`, conditions: [`条件A-${i + 1}`, `条件B-${i + 1}`] }));
const protocol = { id: "hs", org_id: "default", name: "ハムストリング肉離れ", total_weeks: 8, phases, video_url: null, classification_scheme: "hamstring" };
const exercises = [
  { id: 1, protocol_id: "hs", name: "Heel Dig ISO", intro_phase: 1, category: "isometric", continues: true, is_gate_exercise: true, sort_order: 10 },
  { id: 5, protocol_id: "hs", name: "Bilateral RDL", intro_phase: 3, category: "strength", continues: true, is_gate_exercise: true, sort_order: 50, prescription: "6〜10回×3set" },
  { id: 9, protocol_id: "hs", name: "Nordic Hamstring", intro_phase: 4, category: "eccentric", continues: true, is_gate_exercise: false, sort_order: 90 },
  { id: 10, protocol_id: "hs", name: "Jump Lv1", intro_phase: 5, category: "jump", continues: true, is_gate_exercise: false, sort_order: 100 },
];
const steps = [
  { id: 14, exercise_id: 5, step_order: 1, label: "Hip Hinge確認・軽負荷", target: "6〜10回×3set" },
  { id: 15, exercise_id: 5, step_order: 2, label: "高い努力度で実施", target: "6〜10回×3set" },
  { id: 16, exercise_id: 5, step_order: 3, label: "通常Strength水準の高負荷", target: "通常設定" },
];
function makeState({ phase = 5, injuryDaysAgo = 20, booked = false, checks = [] } = {}) {
  const st = {
    phase, checks, messages: [{ id: 5, player_id: "p-1", sender: "player", content: "よろしくお願いします", is_read: true, created_at: iso(now) }],
    consult: [], slots: [
      { id: "slot-1", org_id: "default", datetime: `${dayStr(3)} 18:00`, booked_by: booked ? "p-1" : null, matched_roles: ["coach", "doctor"], zoom_url: null },
    ],
    availability: [
      { id: 1, org_id: "default", role: "coach", datetime: `${dayStr(5)} 18:00` },
      { id: 2, org_id: "default", role: "doctor", datetime: `${dayStr(5)} 18:00` },
      { id: 3, org_id: "default", role: "trainer", datetime: `${dayStr(6)} 18:00` },
    ],
    injury: dayStr(-injuryDaysAgo), posts: [], patches: [],
  };
  st.player = () => ({ id: "p-1", org_id: "default", name: "山田 太郎", pin: "1111", protocol_id: "hs", current_phase: st.phase, checklist: [], sos: false,
    injury_date: st.injury, booked_slot_id: st.slots.find((s) => s.booked_by === "p-1")?.id ?? null,
    reports: [], messages: st.messages, treatments: [], phase_history: [], player_exercise_progress: [], consultation_requests: st.consult });
  return st;
}
function respond(st, url, method, body) {
  const u = new URL(url); const p = u.pathname;
  const json = body ? JSON.parse(body) : null;
  if (method !== "GET" && !p.startsWith("/auth/") && !p.includes("/rpc/")) (method === "POST" ? st.posts : st.patches).push({ p, q: u.search, b: json });
  if (p === "/auth/v1/signup") return { access_token: "t", refresh_token: "r", expires_in: 3600, user: { id: "00000000-0000-0000-0000-000000000001", is_anonymous: true } };
  if (p.startsWith("/auth/v1/")) return {};
  if (p === "/rest/v1/rpc/org_login") return { id: "default", name: "テスト組織" };
  if (p === "/rest/v1/rpc/org_renew") return true;
  if (p === "/rest/v1/rpc/coach_check") return { set: true, ok: json?.p_password === "coach" };
  if (p === "/rest/v1/organizations") return [{ id: "default", name: "テスト組織" }];
  if (p === "/rest/v1/protocols") return [protocol];
  if (p === "/rest/v1/player_directory") return [{ id: "p-1", name: "山田 太郎" }];
  if (p === "/rest/v1/exercises") return exercises;
  if (p === "/rest/v1/exercise_steps") return steps;
  if (p === "/rest/v1/gate_item_checks" && method === "GET") return st.checks;
  if (p === "/rest/v1/staff_availability" && method === "GET") return st.availability;
  if (p === "/rest/v1/slots") {
    if (method === "PATCH") { const id = /id=eq\.([^&]+)/.exec(u.search)?.[1]; const s = st.slots.find((x) => x.id === id); if (s) Object.assign(s, json); return s ? [s] : []; }
    if (method === "POST") { for (const r of json) st.slots.push({ id: `slot-${st.slots.length + 1}`, booked_by: null, zoom_url: null, ...r }); return st.slots; }
    return st.slots;
  }
  if (p === "/rest/v1/messages") {
    if (method === "POST") { const row = { id: 100 + st.messages.length, is_read: false, created_at: iso(new Date()), ...json }; st.messages.push(row); return [row]; }
    return st.messages;
  }
  if (p === "/rest/v1/players") {
    if (u.searchParams.get("select") === "pin") return [{ pin: "1111" }];
    if (method === "PATCH" && json?.current_phase) st.phase = json.current_phase;
    return [st.player()];
  }
  if (method !== "GET") return [Array.isArray(json) ? json[0] : json || {}];
  return [];
}
async function newPage(st, { seenGuide = true } = {}) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e)));
  await p.setRequestInterception(true);
  p.on("request", (r) => {
    if (!r.url().startsWith(API)) return r.continue();
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
    if (r.method() === "OPTIONS") return r.respond({ status: 204, headers: cors });
    r.respond({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(respond(st, r.url(), r.method(), r.postData())) });
  });
  await p.evaluateOnNewDocument((seen) => { try { localStorage.setItem("resprint.installGuideSeen", "1"); if (seen) localStorage.setItem("resprint.guideSeen.p-1", "1"); } catch {} }, seenGuide);
  return p;
}
const text = (p) => p.evaluate(() => document.body.innerText);
async function clickText(p, label, sel = "button") {
  for (const e of await p.$$(sel)) {
    const t = await e.evaluate((n) => (n.offsetParent !== null ? n.innerText.trim() : ""));
    if (t && t.includes(label)) { await e.click(); return; }
  }
  throw new Error("ボタンが見つからない: " + label);
}
async function orgLogin(p) {
  await p.goto(BASE, { waitUntil: "networkidle0" });
  await p.type('input[autocomplete="username"]', "default"); await p.type('input[type="password"]', "org-pass-1234");
  await p.keyboard.press("Enter"); await sleep(1200);
}
async function playerLogin(p) {
  await orgLogin(p);
  await clickText(p, "山田 太郎"); await sleep(400);
  await p.type('input[maxlength="4"]', "1111"); await p.keyboard.press("Enter"); await sleep(1500);
}
async function coachLogin(p) {
  await orgLogin(p);
  await clickText(p, "指導者"); await sleep(500);
  await p.type('input[type="password"]', "coach"); await p.keyboard.press("Enter"); await sleep(1500);
}
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function step(name, fn) { try { await fn(); } catch (e) { ok(false, `${name}: ${e.message}`); } }

try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile });

  await step("ログイン画面", async () => {
    const p = await newPage(makeState());
    await p.goto(BASE, { waitUntil: "networkidle0" });
    const btns = await p.$$eval("button", (a) => a.map((n) => n.innerText.trim()));
    ok(!btns.some((x) => x.includes("管理者")), "ログイン画面に「管理者」の切り替えが出ない");
    for (let i = 0; i < 5; i++) { await p.click("div.w-14.h-14"); await sleep(80); }
    await sleep(300);
    ok((await text(p)).includes("管理者ログイン"), "アイコンを5回タップすると管理者ログインが出る");
  });

  await step("選手：タブ・免責文・使い方", async () => {
    const p = await newPage(makeState({ injuryDaysAgo: 3 }), { seenGuide: false });
    await playerLogin(p);
    const tabs = await p.$$eval("nav button", (a) => a.map((n) => n.innerText.replace(/\d+/g, "").trim()));
    ok(tabs.join("/") === "ホーム/メニュー/日報/チャット/使い方/その他", "選手の下タブが6つ");
    let t = await text(p);
    ok(t.includes("毎日、日報を送る") && t.includes("Strength / Eccentric は続ける"), "初めてのログインでは「使い方」が開き、続ける種目の説明がある");
    for (const [label, want] of [["ホーム", false], ["メニュー", false], ["日報", false], ["チャット", false], ["その他", true]]) {
      await clickText(p, label, "nav button"); await sleep(400);
      ok((await text(p)).includes("このアプリは診断を行いません") === want && (await noOverflow(p)), `「${label}」：免責文は${want ? "出る" : "出ない"}・横にはみ出さない`);
    }
    await clickText(p, "ホーム", "nav button"); await sleep(300);
    ok(!(await text(p)).includes("面談をしましょう"), "受傷から2週間たっていない選手には、面談の案内は出ない");
    ok(p.errs.length === 0, "例外なし " + p.errs.join("|"));
  });

  await step("選手：面談の案内と予約", async () => {
    const st = makeState({ injuryDaysAgo: 20 });
    const p = await newPage(st);
    await playerLogin(p);
    let t = await text(p);
    ok(t.includes("面談をしましょう") && t.includes("受傷から20日"), "受傷から2週間を過ぎて面談がまだの選手に「面談をしましょう」が出る");
    ok(t.includes("面談の枠を選ぶ"), "公開中の枠があれば「面談の枠を選ぶ」が出る");
    ok(!t.includes("翌日の日報を待っています"), "「翌日」の自動項目は出ない");
    await clickText(p, "この枠で予約"); await sleep(1200);
    t = await text(p);
    ok(t.includes("面談が決まりました") && t.includes("面談の予定："), "予約すると「面談が決まりました」と予定が出て、案内は予定の表示に変わる");
    ok(!t.includes("面談をしましょう"), "予約後は「面談をしましょう」が消える");
    const msg = st.posts.find((x) => x.p === "/rest/v1/messages");
    ok(msg?.b?.sender === "player" && msg.b.content.includes("【面談の予約】"), "予約はチャットにも記録され、指導者に未読として届く");
    ok(await noOverflow(p), "横にはみ出さない");
  });

  await step("選手：Strength / Eccentric を続ける", async () => {
    const st = makeState({ phase: 5, injuryDaysAgo: 3, checks: [
      { id: 1, player_id: "p-1", phase_number: 5, item_index: 0, checker_role: "self", result: true, created_at: iso(now) },
      { id: 2, player_id: "p-1", phase_number: 5, item_index: 1, checker_role: "self", result: true, created_at: iso(now) },
    ] });
    const p = await newPage(st);
    await playerLogin(p);
    let t = await text(p);
    ok(t.includes("Strength / Eccentric は続ける") && t.includes("PHASE 4 から最後まで続ける"), "ホームに「続ける」の案内と、ロードマップの2本目の線が出る");
    const adv = async () => p.$$eval("button", (a) => a.find((n) => n.innerText.includes("次のPHASEへ進む"))?.disabled);
    ok((await adv()) === true, "条件がそろっても、確認のチェックを入れるまで次のPHASEへ進めない");
    await p.evaluate(() => [...document.querySelectorAll("label")].find((l) => l.innerText.includes("Strength / Eccentric は続け")).querySelector("input").click());
    await sleep(200);
    ok((await adv()) === false, "チェックを入れると進める");
    await clickText(p, "メニュー", "nav button"); await sleep(900);
    t = await text(p);
    const order = [t.indexOf("Strength / Eccentric は続ける"), t.indexOf("Bilateral RDL"), t.indexOf("Nordic Hamstring"), t.indexOf("そのほかの種目"), t.indexOf("Jump / Hop")];
    ok(order.every((x) => x > 0) && order[0] < order[1] && order[2] < order[3] && order[3] < order[4], "メニューの一番上に Strength / Eccentric が固定で開いて出る " + order.join(","));
    ok(t.includes("次のステップ：高い努力度で実施"), "負荷の次のステップが見える");
    ok(await noOverflow(p) && p.errs.length === 0, "横にはみ出さない・例外なし " + p.errs.join("|"));
  });

  await step("選手：PHASE 2 では案内を出さない", async () => {
    const p = await newPage(makeState({ phase: 2, injuryDaysAgo: 3 }));
    await playerLogin(p);
    const t = await text(p);
    ok(!t.includes("Strength / Eccentric は続ける") && t.includes("PHASE 4 から最後まで続ける"), "PHASE 3 までは案内を出さず、ロードマップの線だけ見せる");
    ok(!t.includes("ことを確認しました"), "PHASE 2→3 では確認のチェックは求めない");
  });

  await step("指導者", async () => {
    const st = makeState({ injuryDaysAgo: 20 });
    st.messages.push({ id: 6, player_id: "p-1", sender: "player", content: "【面談の予約】テスト", is_read: false, created_at: iso(now) });
    const p = await newPage(st);
    await coachLogin(p);
    const ctabs = await p.$$eval("nav button", (a) => a.map((n) => n.innerText.replace(/\d+/g, "").trim()));
    ok(ctabs.join("/") === "選手/プロトコル/メニュー/日程調整/その他", "指導者の下タブ");
    let t = await text(p);
    ok(t.includes("面談未実施") && t.includes("面談がまだ行われていません"), "受傷2週間・面談未実施の選手が、一覧と詳細で分かる");
    ok((await p.$$eval("nav button", (a) => a[0].innerText.replace(/\D/g, ""))) === "1", "対応が必要な人数がタブに出る");
    await clickText(p, "日程調整", "nav button"); await sleep(900);
    t = await text(p);
    ok(t.includes("2人以上") && (t.match(/公開対象/g) || []).length === 1, "コーチ＋ドクターの2人が一致した日時だけが公開対象（1人だけの日時は対象外）");
    await clickText(p, "自動照合して公開"); await sleep(900);
    const posted = st.posts.find((x) => x.p === "/rest/v1/slots");
    ok(posted?.b?.length === 1 && posted.b[0].matched_roles.sort().join() === "coach,doctor", "公開されるのは2人以上が一致した枠だけ");
    ok(await noOverflow(p) && p.errs.length === 0, "横にはみ出さない・例外なし " + p.errs.join("|"));
  });
} finally {
  try { await browser?.close(); } catch {}
  cleanup();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
