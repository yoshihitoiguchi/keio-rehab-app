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
const phases = Array.from({ length: 10 }, (_, i) => ({ title: `段階${i + 1}の名前`, conditions: [`条件A-${i + 1}`, `条件B-${i + 1}`] }));
const CONTINUE_RULE = { from_phase: 4, categories: ["strength", "eccentric"], label: "Strength / Eccentric", title: "Strength / Eccentric は続ける",
  text: "PHASE 4 以降の Strength / Eccentric は、Jump・Jog・Running を始めたあとも続けます。負荷は少しずつ上げていきます。",
  ack: "次のPHASEに進んでも、Strength / Eccentric は続け、負荷を少しずつ上げていくことを確認しました" };
const protocol = { id: "hs", org_id: "default", name: "ハムストリング肉離れ", total_weeks: 8, phases, video_url: null, classification_scheme: "hamstring", continue_rule: CONTINUE_RULE,
  faq: [{ q: "Mini Hurdle の「狭め」はどのくらい？", a: "身長と同じくらいの幅です。" }] };
// 「続ける種目」の設定がないプロトコル（ほかの怪我）。分類はハムストリングと同じでも、案内は出ないこと
const otherProtocol = { ...protocol, id: "other", name: "前十字靭帯損傷", continue_rule: null };
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
function makeState({ phase = 5, injuryDaysAgo = 20, booked = false, checks = [], protocolId = "hs" } = {}) {
  const st = {
    phase, checks, protocolId, messages: [{ id: 5, player_id: "p-1", sender: "player", content: "よろしくお願いします", is_read: true, created_at: iso(now) }],
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
  st.player = () => ({ id: "p-1", org_id: "default", name: "山田 太郎", pin: "1111", protocol_id: st.protocolId, current_phase: st.phase, checklist: [], sos: false,
    injury_date: st.injury, booked_slot_id: st.slots.find((s) => s.booked_by === "p-1")?.id ?? null,
    completed_at: st.completedAt || null, reports: st.reports || [], messages: st.messages, treatments: [], phase_history: st.phaseHistory || [], player_exercise_progress: [], report_comments: st.reportComments || [], consultation_requests: st.consult });
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
  if (p === "/rest/v1/rpc/terms_status") return st.terms ? { version: st.terms.version, body: st.terms.body, accepted: Boolean(st.termsAccepted) } : null;
  if (p === "/rest/v1/rpc/terms_accept") { st.termsAccepted = json.p_version; return true; }
  if (p === "/rest/v1/staff_notes") {
    if (method === "POST") { const row = { id: 50 + (st.notes || []).length, created_at: iso(new Date()), ...json }; st.notes = [row, ...(st.notes || [])]; return [row]; }
    if (method === "DELETE") { st.notes = []; return null; }
    return st.notes || [];
  }
  if (p === "/rest/v1/exercise_logs") {
    if (method === "POST") { st.logs = [...(st.logs || []), json]; return [json]; }
    if (method === "DELETE") { st.logs = []; return null; }
    return st.logs || [];
  }
  if (p === "/rest/v1/rpc/transfer_create") { st.transferCreated = (st.transferCreated || 0) + 1; return { code: "48151623", expires_at: iso(new Date(Date.now() + 1800000)) }; }
  if (p === "/rest/v1/rpc/transfer_redeem") return json?.p_code === "48151623" ? { org: { id: "default", name: "テスト組織" }, player: { id: "p-1", name: "山田 太郎" } } : null;
  if (p === "/rest/v1/organizations") return [{ id: "default", name: "テスト組織" }];
  if (p === "/rest/v1/protocols") return [protocol, otherProtocol];
  if (p === "/rest/v1/player_directory") return [{ id: "p-1", name: "山田 太郎" }];
  if (p === "/rest/v1/exercises") return exercises.map((e) => ({ ...e, org_id: "default", protocol_id: st.protocolId }));
  if (p === "/rest/v1/exercise_videos") return Object.entries(st.videos || {}).map(([name, video_url]) => ({ name, video_url }));
  if (p === "/rest/v1/rpc/exercise_video_set") { st.videoSets = [...(st.videoSets || []), json]; return true; }
  if (p === "/rest/v1/report_comments") {
    if (method === "POST") { const row = { id: 90 + (st.reportComments || []).length, created_at: iso(new Date()), ...json }; st.reportComments = [...(st.reportComments || []), row]; return [row]; }
    return st.reportComments || [];
  }
  if (p === "/rest/v1/meeting_notes") {
    if (method === "POST") { const row = { id: 70 + (st.meetingNotes || []).length, created_at: iso(new Date()), ...json }; st.meetingNotes = [row, ...(st.meetingNotes || [])]; return [row]; }
    return st.meetingNotes || [];
  }
  if (p === "/rest/v1/exercise_steps") return steps;
  if (p === "/rest/v1/gate_item_checks" && method === "GET") return st.checks;
  if (p === "/rest/v1/app_settings") {
    if (method === "POST") { st.meetingUrl = json.value; return [json]; }
    return st.meetingUrl ? [{ value: st.meetingUrl }] : [];
  }
  if (p === "/rest/v1/staff_availability" && method === "GET") return st.availability;
  if (p === "/rest/v1/slots") {
    if (method === "PATCH") { const id = /id=eq\.([^&]+)/.exec(u.search)?.[1]; const s = st.slots.find((x) => x.id === id); if (s) Object.assign(s, json); return s ? [s] : []; }
    if (method === "POST") { for (const r of json) st.slots.push({ id: `slot-${st.slots.length + 1}`, booked_by: null, zoom_url: null, ...r }); return st.slots; }
    return st.slots;
  }
  if (p === "/rest/v1/reports" && method === "POST") { st.reports = [...(st.reports || []), { id: 900, created_at: iso(new Date()), ...json }]; return [json]; }
  if (p === "/rest/v1/messages") {
    if (method === "POST" && Array.isArray(json)) { const rows = json.map((j, i) => ({ id: 300 + i, is_read: false, created_at: iso(new Date()), ...j })); st.messages.push(...rows); return rows; }
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
// skipInstall：スマホのブラウザで出る「ホーム画面に追加」の全画面を、あらかじめ「今回だけブラウザで使う」にしておく
// skipNotify：通知の案内（全画面）を、あらかじめ「あとで」にしておく
async function newPage(st, { seenGuide = true, skipInstall = true, skipNotify = true } = {}) {
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
  await p.evaluateOnNewDocument((seen, skip, skipN) => { try {
    if (seen) localStorage.setItem("resprint.guideSeen.p-1", "1");
    if (skip) sessionStorage.setItem("resprint.installSkip", "1");
    if (skipN) { sessionStorage.setItem("resprint.notifySkip.player", "1"); sessionStorage.setItem("resprint.notifySkip.coach", "1"); }
  } catch {} }, seenGuide, skipInstall, skipNotify);
  return p;
}
const text = (p) => p.evaluate(() => document.body.innerText);
async function clickText(p, label, sel = "button") {
  for (const e of await p.$$(sel)) {
    const t = await e.evaluate((n) => (n.offsetParent !== null ? n.innerText.trim() : ""));
    // 画面下の固定タブに重なる位置でも押せるよう、要素を画面の中ほどへ送ってから押す
    if (t && t.includes(label)) { await e.evaluate((n) => n.scrollIntoView({ block: "center" })); await e.click(); return; }
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
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, timeout: 180000, protocolTimeout: 180000 });

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
    ok(tabs.join("/") === "ホーム/メニュー/日報/連絡・面談/使い方/その他", "選手の下タブが6つ（チャットは「連絡・面談」に）");
    let t = await text(p);
    ok(t.includes("毎日、日報を送る") && t.includes("Strength / Eccentric は続ける"), "初めてのログインでは「使い方」が開き、続ける種目の説明がある");
    for (const [label, want] of [["ホーム", false], ["メニュー", false], ["日報", false], ["連絡・面談", false], ["その他", true]]) {
      await clickText(p, label, "nav button"); await sleep(400);
      ok((await text(p)).includes("このアプリは診断を行いません") === want && (await noOverflow(p)), `「${label}」：免責文は${want ? "出る" : "出ない"}・横にはみ出さない`);
    }
    await clickText(p, "ホーム", "nav button"); await sleep(300);
    ok(!(await text(p)).includes("面談をしましょう"), "受傷から2週間たっていない選手には、面談の案内は出ない");
    ok(p.errs.length === 0, "例外なし " + p.errs.join("|"));
  });

  await step("選手：ホーム画面への追加（全画面）と引き継ぎコード", async () => {
    const st = makeState({ injuryDaysAgo: 3 });
    const p = await newPage(st, { seenGuide: false, skipInstall: false });
    await playerLogin(p);
    let t = await text(p);
    ok(t.includes("毎日、日報を送る") && !t.includes("ホーム画面に追加してください"), "初めての選手：使い方を読んでいる間は、追加の画面は出ない");
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sleep(1200);
    t = await text(p);
    ok(t.includes("ホーム画面に追加してください") && t.includes("引き継ぎコードをコピーする"), "使い方を一番下まで読むと、全画面の「ホーム画面に追加してください」に切り替わる");
    ok(t.includes("4815 1623") && st.transferCreated === 1, "iPhone では引き継ぎコードが1回だけ作られて表示される");
    ok(await p.evaluate(() => !document.elementFromPoint(195, 820).closest("nav")), "追加の画面が全体を覆い、下のタブは押せない");
    ok(await noOverflow(p), "横にはみ出さない");
    await clickText(p, "今回だけブラウザで使う"); await sleep(500);
    t = await text(p);
    ok(!t.includes("ホーム画面に追加してください") && t.includes("毎日、日報を送る"), "「今回だけブラウザで使う」で先へ進める");
    await clickText(p, "ホーム", "nav button"); await sleep(400);
    ok(!(await text(p)).includes("あなたの名前") && !(await p.$('input[placeholder^="あなたの名前"]')), "GATE に「あなたの名前」の入力欄は出ない");
    ok(p.errs.length === 0, "例外なし " + p.errs.join("|"));

    // 2回目以降（使い方は既読）：開いたらすぐ追加の画面
    const p2 = await newPage(makeState({ injuryDaysAgo: 3 }), { seenGuide: true, skipInstall: false });
    await playerLogin(p2);
    ok((await text(p2)).includes("ホーム画面に追加してください"), "登録済みの選手がスマホのブラウザで開くと、すぐ追加の画面になる");

    // ホーム画面のアプリ側：引き継ぎコードを貼ると、組織・選手のログインがそのまま引き継がれる
    const p3 = await newPage(makeState({ injuryDaysAgo: 3 }));
    await p3.goto(BASE, { waitUntil: "networkidle0" });
    t = await text(p3);
    ok(t.includes("招待リンク・引き継ぎコードで入る") && t.includes("貼り付けて入る"), "ログイン画面に、引き継ぎコードの貼り付け口がある");
    const box = 'input[placeholder^="ここに長押し"]';
    await p3.type(box, "RE:SPRINT 引き継ぎコード：9999 9999"); await sleep(1200);
    ok((await text(p3)).includes("引き継ぎコードが違うか"), "違うコードでは入れず、案内が出る");
    await p3.click(box, { clickCount: 3 }); await p3.keyboard.press("Backspace");
    await p3.type(box, "RE:SPRINT 引き継ぎコード：4815 1623"); await sleep(2500);
    t = await text(p3);
    ok(t.includes("山田 太郎") && t.includes("今日の日報を送る") && !t.includes("あなたの名前を選んでください"), "正しいコードを貼ると、暗証番号なしでその選手の画面が開く");
    ok(p3.errs.length === 0, "例外なし " + p3.errs.join("|"));
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

  await step("選手：ほかのプロトコルには「続ける種目」の案内を出さない", async () => {
    const st = makeState({ phase: 5, injuryDaysAgo: 3, protocolId: "other", checks: [
      { id: 1, player_id: "p-1", phase_number: 5, item_index: 0, checker_role: "self", result: true, created_at: iso(now) },
      { id: 2, player_id: "p-1", phase_number: 5, item_index: 1, checker_role: "self", result: true, created_at: iso(now) },
    ] });
    const p = await newPage(st, { seenGuide: false });
    await playerLogin(p);
    let t = await text(p);
    ok(t.includes("毎日、日報を送る") && !t.includes("Strength / Eccentric") && !t.includes("続ける"), "使い方タブ：設定のないプロトコルの選手には、続ける種目の説明が出ない");
    const nums = await p.$$eval("span.rounded-full.bg-blue-600", (a) => a.map((n) => n.innerText.trim()).filter((x) => /^\d+$/.test(x)));
    ok(nums.join() === "1,2,3,4,5,6,7,8", "使い方の番号は 1〜8 で続く " + nums.join());
    await clickText(p, "ホーム", "nav button"); await sleep(500);
    t = await text(p);
    ok(!t.includes("Strength / Eccentric") && !t.includes("から最後まで続ける") && !t.includes("ことを確認しました"), "ホーム：案内・ロードマップの2本目の線・確認のチェックが出ない");
    ok((await p.$$eval("button", (a) => a.find((n) => n.innerText.includes("次のPHASEへ進む"))?.disabled)) === false, "条件がそろえば、チェックなしでそのまま進める");
    await clickText(p, "メニュー", "nav button"); await sleep(900);
    t = await text(p);
    ok(t.includes("Bilateral RDL") === false || !t.includes("そのほかの種目"), "メニュー：緑の固定枠は出ず、今までどおりのカテゴリ表示");
    ok(!t.includes("は続ける") && p.errs.length === 0, "メニューに案内の文が出ない・例外なし " + p.errs.join("|"));
  });

  await step("通知の案内（最初に全画面）と、連絡・面談タブ", async () => {
    // 初めての選手：使い方を読んでいる間は出ない → 読み終えて追加の画面を抜けると、通知の案内が出る
    const st = makeState({ injuryDaysAgo: 3 });
    const p = await newPage(st, { seenGuide: false, skipInstall: false, skipNotify: false });
    await playerLogin(p);
    ok(!(await text(p)).includes("通知をオンにしてください"), "使い方を読んでいる間は、通知の案内は出ない");
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sleep(1200);
    let t = await text(p);
    ok(t.includes("ホーム画面に追加してください") && !t.includes("通知をオンにしてください"), "先に「ホーム画面に追加」の画面が出る（通知の案内はまだ）");
    await clickText(p, "今回だけブラウザで使う"); await sleep(900);
    t = await text(p);
    ok(t.includes("通知をオンにしてください") && t.includes("通知を受け取る") && t.includes("名前やメッセージの内容は表示されません"), "そのあと、全画面で通知の案内が出る");
    ok(await p.evaluate(() => !document.elementFromPoint(195, 820).closest("nav")) && (await noOverflow(p)), "通知の案内が全体を覆う・横にはみ出さない");
    await clickText(p, "あとで"); await sleep(400);
    ok(!(await text(p)).includes("通知をオンにしてください"), "「あとで」で閉じられる");
    // 連絡・面談タブ：チャットと面談の申し込み
    await clickText(p, "連絡・面談", "nav button"); await sleep(600);
    t = await text(p);
    ok(t.includes("指導者とのチャット") && t.includes("面談を申し込む"), "「連絡・面談」タブに、チャットと面談の申し込みがある");
    await clickText(p, "面談を申し込む"); await sleep(300);
    await p.type('textarea[placeholder^="話したいこと"]', "来週話したい");
    for (const e of await p.$$("button")) if ((await e.evaluate((n) => n.innerText.trim())) === "申し込む") { await e.click(); break; }
    await sleep(800);
    ok(st.posts.some((x) => x.p === "/rest/v1/consultation_requests" && x.b.note === "来週話したい") && (await text(p)).includes("申し込み済み"), "このタブから面談を申し込める");
    await clickText(p, "その他", "nav button"); await sleep(500);
    ok(!(await text(p)).includes("面談を申し込む"), "「その他」からは面談の申し込みがなくなった（移動）");
    ok(p.errs.length === 0, "例外なし " + p.errs.join("|"));

    // 登録済みの選手（追加は済み扱い）：開いたらすぐ通知の案内
    const p2 = await newPage(makeState({ injuryDaysAgo: 3 }), { skipNotify: false });
    await playerLogin(p2);
    ok((await text(p2)).includes("通知をオンにしてください"), "通知がまだオフの選手には、開いたときに通知の案内が出る");
    // 指導者：スマホのブラウザでは、まずホーム画面への追加（通知の案内は、そのあと）
    const p4 = await newPage(makeState({ injuryDaysAgo: 3 }), { skipInstall: false, skipNotify: false });
    await coachLogin(p4);
    t = await text(p4);
    ok(t.includes("ホーム画面に追加してください") && !t.includes("通知をオンにしてください") && t.includes("4815 1623"), "指導者モードでも、スマホのブラウザでは先に「ホーム画面に追加」が出る");
    await clickText(p4, "今回だけブラウザで使う"); await sleep(900);
    ok((await text(p4)).includes("通知をオンにしてください"), "追加の画面を抜けると、通知の案内が出る");
    // 指導者にも出る
    const p3 = await newPage(makeState({ injuryDaysAgo: 3 }), { skipNotify: false });
    await coachLogin(p3);
    t = await text(p3);
    ok(t.includes("通知をオンにしてください") && t.includes("選手から新しいメッセージがあります"), "指導者モードでも、最初に通知の案内が出る");
  });

  await step("面談の URL を自動で付ける", async () => {
    // 指導者が「いつもの URL」を登録する
    const st = makeState({ injuryDaysAgo: 20 });
    const c = await newPage(st);
    await coachLogin(c);
    await clickText(c, "その他", "nav button"); await sleep(900);
    ok((await text(c)).includes("面談で使うオンライン会議の URL"), "指導者の「その他」に、面談の URL の登録欄がある");
    ok(!/[A-Za-z]{4,} [a-z]{3,} [a-z]{3,}/.test((await text(c)).replace(/RE:SPRINT|Zoom|https?:\S+/g, "")), "URL が未登録でも、英語のエラー文は出ない");
    await c.type('input[placeholder^="https://zoom.us"]', "javascript:alert(1)");
    await clickText(c, "保存する"); await sleep(400);
    ok((await text(c)).includes("https:// で始まる URL") && !st.meetingUrl, "URL でないものは保存できない");
    await c.click('input[placeholder^="https://zoom.us"]', { clickCount: 3 }); await c.keyboard.press("Backspace");
    await c.type('input[placeholder^="https://zoom.us"]', "https://zoom.example/j/123?pwd=abc");
    await clickText(c, "保存する"); await sleep(700);
    const saved = st.posts.find((x) => x.p === "/rest/v1/app_settings");
    ok(saved?.b?.key === "meeting_url" && saved.b.value === "https://zoom.example/j/123?pwd=abc" && saved.q.includes("on_conflict=key%2Corg_id") && (await text(c)).includes("登録済み"),
       "URL を登録できる（組織ごとの設定として保存）");
    ok(c.errs.length === 0, "例外なし " + c.errs.join("|"));

    // 選手が予約すると、その URL が面談に付く
    const p = await newPage(st);
    await playerLogin(p);
    await clickText(p, "この枠で予約"); await sleep(1500);
    const patch = st.patches.find((x) => x.p === "/rest/v1/slots" && x.b.booked_by === "p-1");
    ok(patch?.b?.zoom_url === "https://zoom.example/j/123?pwd=abc", "選手が予約すると、登録してある URL が面談に自動で付く");
    const href = await p.$$eval("a", (a) => a.find((n) => n.innerText.includes("面談に参加"))?.href);
    ok(href === "https://zoom.example/j/123?pwd=abc", "選手のホームに「面談に参加」ボタンが出る");
    ok(p.errs.length === 0, "例外なし " + p.errs.join("|"));

    // 登録がない組織では、今までどおり URL なしで予約される
    const st2 = makeState({ injuryDaysAgo: 20 });
    const p2 = await newPage(st2);
    await playerLogin(p2);
    await clickText(p2, "この枠で予約"); await sleep(1500);
    const patch2 = st2.patches.find((x) => x.p === "/rest/v1/slots" && x.b.booked_by === "p-1");
    ok(patch2 && !("zoom_url" in patch2.b) && (await text(p2)).includes("オンライン会議URLは指導者側で準備中です"), "登録がなければ、今までどおり（URL は指導者があとで入れる）");

    // すでに予約済みで URL のない面談：指導者がボタン1つで入れられる
    const st3 = makeState({ injuryDaysAgo: 20, booked: true });
    st3.meetingUrl = "https://zoom.example/j/999";
    const c3 = await newPage(st3);
    await coachLogin(c3);
    await clickText(c3, "日程調整", "nav button"); await sleep(1000);
    await clickText(c3, "登録してあるいつもの URL を入れる"); await sleep(700);
    ok(st3.patches.some((x) => x.p === "/rest/v1/slots" && x.b.zoom_url === "https://zoom.example/j/999")
       && (await c3.$eval('input[placeholder^="オンライン会議URL"]', (i) => i.value)) === "https://zoom.example/j/999", "予約済みの面談にも、ボタン1つでいつもの URL を入れられる");
  });

  await step("今日やること・連続記録・記録のグラフ", async () => {
    const st = makeState({ injuryDaysAgo: 3 });
    const day = (off) => { const d = new Date(Date.now() + off * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    st.reports = [-3, -2, -1].map((o, i) => ({ id: i + 1, player_id: "p-1", date: day(o), vas: 4 - i, mental: 3, fatigue: 3, sleep_quality: 7, created_at: new Date(Date.now() + o * 86400000).toISOString() }));
    const p = await newPage(st);
    await playerLogin(p);
    let t = await text(p);
    ok(t.includes("今日の日報を送る") && t.includes("日報 3日連続") && !t.includes("おかえりなさい"), "ホームの一番上に「今日の日報を送る」と連続記録が出る");
    const firstCard = await p.evaluate(() => document.querySelector("main .bg-slate-900")?.innerText.includes("今日の日報を送る"));
    ok(firstCard === true, "「今日やること」は濃い色のカードで目立たせている");
    await clickText(p, "今日の日報を送る"); await sleep(500);
    t = await text(p);
    ok(t.includes("今日のコンディション報告") && t.includes("これまでの記録") && (await p.$$("svg polyline, svg path")).length > 0, "日報タブに移動し、これまでの記録のグラフがある");
    await clickText(p, "指導者に送信する"); await sleep(1200);
    await clickText(p, "ホーム", "nav button"); await sleep(500);
    t = await text(p);
    ok(t.includes("今日の日報は送信済み") && t.includes("日報 4日連続") && !t.includes("今日の日報を送る"), "送ると「送信済み」に変わり、連続記録が伸びる");
    ok(p.errs.length === 0, "例外なし " + p.errs.join("|"));

    // 指導者：今日まだ日報がない選手が分かる
    const st2 = makeState({ injuryDaysAgo: 3 });
    const c = await newPage(st2);
    await coachLogin(c);
    t = await text(c);
    ok(t.includes("今日の日報 0/1") && t.includes("日報なし"), "指導者の一覧に「今日の日報 0/1」と「日報なし」が出る");
  });

  await step("指導者：選手の詳細をタブで分ける", async () => {
    const st = makeState({ injuryDaysAgo: 3 });
    st.messages.push({ id: 6, player_id: "p-1", sender: "player", content: "質問があります", is_read: false, created_at: iso(now) });
    const c = await newPage(st);
    await coachLogin(c);
    let t = await text(c);
    const chips = await c.$$eval("button", (a) => a.map((n) => n.innerText.replace(/\d+/g, "").trim()).filter((x) => ["日報", "GATE", "メニュー", "記録", "チャット"].includes(x)));
    ok(["日報", "GATE", "記録", "チャット"].every((x) => chips.includes(x)), "選手の詳細に「日報／GATE／メニュー／記録／チャット」の切り替えがある");
    ok(t.includes("本日の日報") && !t.includes("治療介入の記録") && !t.includes("さんとのチャット"), "最初は日報だけが出る（1ページに全部は並べない）");
    ok(!st.patches.some((x) => x.p === "/rest/v1/messages"), "選手を開いただけでは、チャットを既読にしない");
    const h1 = await c.evaluate(() => document.documentElement.scrollHeight);
    ok(h1 < 2600, "詳細の長さが短くなった（" + h1 + "px。以前は約4,700px）");
    await clickText(c, "チャット"); await sleep(900);
    t = await text(c);
    ok(t.includes("質問があります") && st.patches.some((x) => x.p === "/rest/v1/messages" && x.b.is_read === true), "チャットのタブを開くと、メッセージが見えて既読になる");
    await clickText(c, "記録"); await sleep(500);
    ok((await text(c)).includes("治療介入の記録"), "記録のタブに、治療の記録などがある");
    ok(await noOverflow(c) && c.errs.length === 0, "横にはみ出さない・例外なし " + c.errs.join("|"));

    // 選手側：重複していた表示・空のカードが出ない
    const p = await newPage(makeState({ injuryDaysAgo: 3 }));
    await playerLogin(p);
    t = await text(p);
    ok(!t.includes("足りないもの") && !t.includes("現在のステップ"), "選手ホーム：条件の繰り返し表示をやめた");
    await clickText(p, "メニュー", "nav button"); await sleep(900);
    t = await text(p);
    ok(!t.includes("患部外トレーニング") && !t.includes("いまの PHASE のメニュー"), "メニュー：中身のないカードは出さない");
    await clickText(p, "その他", "nav button"); await sleep(900);
    ok(!(await text(p)).includes("未到達"), "その他：記録のない PHASE の空の棒を並べない");
  });

  await step("指導者：プロトコルと日程調整の画面", async () => {
    const c = await newPage(makeState({ injuryDaysAgo: 3 }));
    await coachLogin(c);
    await clickText(c, "プロトコル", "nav button"); await sleep(800);
    let t = await text(c);
    ok(!t.includes("条件A-1") && t.includes("PHASE と条件") && !t.includes("怪我の名称"), "プロトコル：PHASE の一覧と追加フォームは、最初は畳んである");
    const h = await c.evaluate(() => document.documentElement.scrollHeight);
    ok(h < 1400, "プロトコルの画面が短くなった（" + h + "px。以前は約3,000px）");
    await clickText(c, "PHASE と条件"); await sleep(300);
    ok((await text(c)).includes("条件A-1"), "押すと PHASE と条件が開く");
    await clickText(c, "プロトコルを追加"); await sleep(300);
    ok((await text(c)).includes("怪我の名称"), "「プロトコルを追加」で追加フォームが開く");
    await clickText(c, "日程調整", "nav button"); await sleep(800);
    ok((await c.$$('input[type="date"]')).length === 1 && (await c.$$("select")).length <= 3, "日程調整：日付は1つの入力欄で選べる（年・月・日の3つのプルダウンをやめた）");
    ok(await noOverflow(c) && c.errs.length === 0, "横にはみ出さない・例外なし " + c.errs.join("|"));
  });

  await step("運用の機能（v15.18）", async () => {
    // 規約の同意
    const st = makeState({ injuryDaysAgo: 3 });
    st.terms = { version: 2, body: "これはテスト用の規約の文面です。" };
    const p = await newPage(st);
    await playerLogin(p);
    let t = await text(p);
    ok(t.includes("利用規約・個人情報の取り扱い") && t.includes("これはテスト用の規約の文面です。") && t.includes("同意して使う"), "規約の文面が登録されていると、選手に同意の画面が出る");
    await clickText(p, "同意して使う"); await sleep(700);
    ok(st.termsAccepted === 2 && !(await text(p)).includes("同意して使う"), "同意すると記録され、画面が閉じる");
    await p.reload({ waitUntil: "networkidle0" }); await sleep(1500);
    ok(!(await text(p)).includes("同意して使う"), "同意済みなら、次からは出ない");
    // 今日やった種目
    await clickText(p, "メニュー", "nav button"); await sleep(900);
    await clickText(p, "やった"); await sleep(600);
    ok(st.logs?.length === 1 && st.logs[0].player_id === "p-1" && /^\d{4}-\d{2}-\d{2}$/.test(st.logs[0].done_on) && (await text(p)).includes("今日やった"), "メニューの種目に「やった」を記録できる");
    ok(await noOverflow(p) && p.errs.length === 0, "横にはみ出さない・例外なし " + p.errs.join("|"));

    // 復帰した選手：復帰までの記録
    const stR = makeState({ injuryDaysAgo: 40, phase: 10 });
    stR.completedAt = iso(now);
    stR.phaseHistory = [{ id: 1, phase_number: 1, entered_at: iso(new Date(Date.now() - 40 * 86400000)), left_at: iso(new Date(Date.now() - 30 * 86400000)) }];
    const pr = await newPage(stR);
    await playerLogin(pr);
    await clickText(pr, "その他", "nav button"); await sleep(700);
    t = await text(pr);
    ok(t.includes("復帰までの記録") && t.includes("40") && t.includes("受傷から復帰まで"), "復帰した選手に、復帰までの記録が出る");

    // 指導者：暗証番号の再設定・申し送りメモ・全員に連絡・書き出し
    const st2 = makeState({ injuryDaysAgo: 3 });
    st2.logs = [{ exercise_id: 5, done_on: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })() }];
    const c = await newPage(st2);
    await coachLogin(c);
    await clickText(c, "暗証番号を再設定"); await sleep(400);
    await c.type('[role="dialog"] input', "12a4");
    await clickText(c, "再設定する", '[role="dialog"] button'); await sleep(500);
    ok(!st2.patches.some((x) => x.b && x.b.pin) && (await text(c)).includes("数字4桁で入力"), "数字4桁でない暗証番号は受け付けない");
    await clickText(c, "暗証番号を再設定"); await sleep(400);
    await c.type('[role="dialog"] input', "4826");
    await clickText(c, "再設定する", '[role="dialog"] button'); await sleep(700);
    ok(st2.patches.some((x) => x.p === "/rest/v1/players" && x.b.pin === "4826") && (await text(c)).includes("暗証番号を再設定しました"), "指導者が選手の暗証番号を再設定できる");
    await clickText(c, "閉じる", '[role="dialog"] button'); await sleep(300);
    await clickText(c, "全員に連絡"); await sleep(300);
    await c.type('textarea[placeholder="お知らせの内容"]', "明日の練習は15時からです");
    for (const e of await c.$$("button")) if ((await e.evaluate((n) => n.innerText.trim())) === "送る") { await e.click(); break; }
    await sleep(400);
    ok((await text(c)).includes("1名に送りますか？"), "全員への連絡は、送る前に人数を確かめる");
    await clickText(c, "送る", '[role="dialog"] button'); await sleep(800);
    const bc = st2.posts.find((x) => x.p === "/rest/v1/messages" && Array.isArray(x.b));
    ok(bc?.b?.length === 1 && bc.b[0].sender === "staff" && bc.b[0].content === "明日の練習は15時からです", "現役の選手全員のチャットに同じ文が入る");
    for (const e of await c.$$("button")) { const tt = await e.evaluate((x) => x.innerText.trim()); const inNav = await e.evaluate((x) => !!x.closest("nav")); if (tt === "記録" && !inNav) { await e.click(); break; } }
    await sleep(700);
    await c.type('textarea[placeholder^="例：左ハム"]', "張りが残る");
    await clickText(c, "残す"); await sleep(600);
    ok(st2.notes?.[0]?.body === "張りが残る" && st2.notes[0].player_id === "p-1" && (await text(c)).includes("選手の画面には出ません"), "申し送りメモを残せる");
    for (const e of await c.$$("button")) { const tt = await e.evaluate((x) => x.innerText.trim()); const inNav = await e.evaluate((x) => !!x.closest("nav")); if (tt === "メニュー" && !inNav) { await e.click(); break; } }
    await sleep(900);
    ok((await text(c)).includes("今日 実施・7日で1回") && (await text(c)).includes("今日 未実施"), "指導者は、種目ごとの実施状況を見られる");
    await clickText(c, "その他", "nav button"); await sleep(700);
    t = await text(c);
    ok(t.includes("記録の書き出し") && t.includes("名前を番号に置き換える"), "指導者の「その他」に、記録の書き出しがある");
    const csv = await c.evaluate(async () => {
      let captured = null;
      const orig = URL.createObjectURL;
      URL.createObjectURL = (blob) => { captured = blob; return orig.call(URL, blob); };
      [...document.querySelectorAll("button")].find((b) => b.innerText.includes("選手一覧")).click();
      await new Promise((r) => setTimeout(r, 200));
      URL.createObjectURL = orig;
      return captured ? await captured.text() : null;
    });
    ok(csv && csv.includes("選手,プロトコル,PHASE") && csv.includes("選手001") && !csv.includes("山田"), "書き出した CSV は、名前が番号に置き換わっている");
    ok(await noOverflow(c) && c.errs.length === 0, "横にはみ出さない・例外なし " + c.errs.join("|"));
  });

  await step("種目の動画・面談メモ・よくある質問（v15.19）", async () => {
    // 選手：動きを見る・よくある質問・面談メモ
    const st = makeState({ injuryDaysAgo: 3, phase: 5 });
    st.videos = { "Nordic Hamstring": "https://www.youtube.com/watch?v=abc123XYZ" };
    st.meetingNotes = [{ id: 1, player_id: "p-1", held_on: "2026-10-05", author_role: "doctor", body: "次回は2週間後。RDL の負荷は据え置き。", created_at: iso(now) }];
    const p = await newPage(st);
    await playerLogin(p);
    await clickText(p, "メニュー", "nav button"); await sleep(1000);
    const links = await p.$$eval("a", (a) => a.filter((n) => n.innerText.includes("動きを見る")).map((n) => n.href));
    ok(links.length >= 1 && links.some((h) => h.startsWith("https://www.youtube.com/results?search_query=Bilateral%20RDL")), "動画が未登録の種目は、「動きを見る」で種目名の YouTube 検索が開く");
    ok(links.every((h) => !h.includes("Jump%20Lv1%EF%BD%9C")) , "検索には、種目名の部分だけを使う");
    await clickText(p, "動きを見る"); await sleep(600);
    ok((await p.$$eval("iframe", (f) => f.map((x) => x.src))).some((x) => x === "https://www.youtube.com/embed/abc123XYZ"), "動画が登録された種目は、その場で動画が開く");
    ok(!(await text(p)).includes("動画を登録"), "選手には「動画を登録」は出ない");
    let t = await text(p);
    ok(t.includes("よくある質問") && t.includes("Mini Hurdle の「狭め」はどのくらい？") && !t.includes("身長と同じくらいの幅です。"), "メニューに「よくある質問」が出る（答えは畳んである）");
    await clickText(p, "Mini Hurdle の「狭め」はどのくらい？"); await sleep(300);
    ok((await text(p)).includes("身長と同じくらいの幅です。"), "質問を押すと答えが開く");
    await clickText(p, "連絡・面談", "nav button"); await sleep(800);
    t = await text(p);
    ok(t.includes("面談メモ") && t.includes("次回は2週間後。RDL の負荷は据え置き。") && t.includes("2026-10-05") && !t.includes("面談メモを追加"), "選手は「連絡・面談」で面談メモを読める（書き込みはできない）");
    ok(await noOverflow(p) && p.errs.length === 0, "横にはみ出さない・例外なし " + p.errs.join("|"));

    // 指導者：動画の登録・面談メモの追加・よくある質問の編集
    const st2 = makeState({ injuryDaysAgo: 3, phase: 5 });
    const c = await newPage(st2);
    await coachLogin(c);
    const inDetail = async (label) => { for (const e of await c.$$("button")) { const tt = await e.evaluate((x) => x.innerText.trim()); const inNav = await e.evaluate((x) => !!x.closest("nav")); if (tt === label && !inNav) { await e.evaluate((n) => n.scrollIntoView({ block: "center" })); await e.click(); return; } } throw new Error("no " + label); };
    await inDetail("メニュー"); await sleep(1000);
    await clickText(c, "動画を登録"); await sleep(400);
    await c.type('[role="dialog"] input', "https://youtu.be/QQQ111");
    await clickText(c, "保存する", '[role="dialog"] button'); await sleep(700);
    const vs = st2.videoSets?.[0];
    ok(vs?.p_url === "https://youtu.be/QQQ111" && vs.p_org_id === "default" && vs.p_coach_password === "coach" && typeof vs.p_name === "string" && vs.p_name.length > 0
       && !st2.patches.some((x) => x.p === "/rest/v1/exercises") && (await text(c)).includes("動画を変更"),
       "指導者は動画の URL を登録できる（種目名ごと・全組織で共通。指導者パスワードをサーバーが確かめる）");
    // 日報の恐怖心・抜ける接地が、指導者の画面に出る（v15.20 で修正）
    st2.reports = [{ id: 1, player_id: "p-1", date: ((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`)(new Date()), vas: 2, mental: 3, fatigue: 3, sleep_quality: 7, fear_level: 4, slipping_contact: true, rpe: 60, created_at: iso(new Date()) }];
    const c2 = await newPage(st2);
    await coachLogin(c2);
    const t2 = await text(c2);
    ok(/恐怖心\s*4/.test(t2) && /抜ける接地\s*あり/.test(t2) && /RPE\s*60/.test(t2), "指導者の日報に、恐怖心・抜ける接地・RPE が出る");
    await c2.close();
    await inDetail("記録"); await sleep(800);
    await clickText(c, "面談メモを追加"); await sleep(300);
    await c.type('textarea[placeholder="面談の内容を貼り付け"]', "痛みは落ち着いている。来週から Jog。");
    await clickText(c, "保存して選手に知らせる"); await sleep(1000);
    ok(st2.meetingNotes?.[0]?.body === "痛みは落ち着いている。来週から Jog。" && st2.meetingNotes[0].player_id === "p-1" && /^\d{4}-\d{2}-\d{2}$/.test(st2.meetingNotes[0].held_on), "指導者が面談メモを貼り付けて保存できる");
    ok(st2.posts.some((x) => x.p === "/rest/v1/messages" && !Array.isArray(x.b) && x.b.sender === "staff" && x.b.content.startsWith("【面談の記録】")) && (await text(c)).includes("選手本人も読めます"), "保存すると、選手にチャット（と通知）で知らされる");
    await clickText(c, "プロトコル", "nav button"); await sleep(800);
    await clickText(c, "よくある質問 1件"); await sleep(300);
    t = await text(c);
    ok(t.includes("よくある質問（選手のメニューに出ます）") && t.includes("Mini Hurdle の「狭め」はどのくらい？"), "プロトコルの画面で、よくある質問を開いて見られる");
    await c.type('input[placeholder="質問"]', "ウエイトはいつから解禁？");
    await c.type('textarea[placeholder="答え"]', "両脚の RDL ができるようになったら解禁です。");
    await clickText(c, "質問を追加"); await sleep(700);
    const fq = st2.patches.find((x) => x.p === "/rest/v1/protocols" && x.b.faq);
    ok(fq?.b?.faq?.length === 2 && fq.b.faq[1].q === "ウエイトはいつから解禁？", "よくある質問を追加できる");
    ok(await noOverflow(c) && c.errs.length === 0, "横にはみ出さない・例外なし " + c.errs.join("|"));
  });

  await step("日報の本音へのコメント・返信（v15.21）", async () => {
    const today = ((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`)(new Date());
    const st = makeState({ injuryDaysAgo: 3, phase: 5 });
    st.reports = [{ id: 1, player_id: "p-1", date: today, vas: 2, mental: 3, fatigue: 3, sleep_quality: 7, honne: "正直、走るのが少し怖いです", created_at: iso(new Date()) }];
    // 指導者：本音にコメントする（立場と名前つき）
    const c = await newPage(st);
    await coachLogin(c);
    let t = await text(c);
    ok(t.includes("本音とコメント") && t.includes("正直、走るのが少し怖いです"), "指導者の日報に、本音とコメントの欄が出る");
    await clickText(c, "コメントする"); await sleep(300);
    await c.type('textarea[placeholder="コメント"]', "怖さがあるのは自然です。");
    ok(!(await c.$('input[aria-label="書く人の名前"]')), "名前の入力欄はない（チャットと同じく立場を選ぶ）");
    await c.select('select[aria-label="書く人の立場"]', "doctor");
    await clickText(c, "送る"); await sleep(800);
    const rc = st.reportComments?.[0];
    ok(rc?.report_id === 1 && rc.player_id === "p-1" && rc.sender === "staff" && rc.author_role === "doctor" && !rc.author_name && rc.body === "怖さがあるのは自然です。", "コメントが、立場つきで日報に残る");
    t = await text(c);
    ok(/医師\s*\d+\/\d+/.test(t) && t.includes("怖さがあるのは自然です。") && !st.posts.some((x) => x.p === "/rest/v1/messages"), "誰のコメントかが表示される（チャットには入らない）");
    ok(await noOverflow(c) && c.errs.length === 0, "横にはみ出さない・例外なし " + c.errs.join("|"));
    await c.close();
    // 選手：日報タブで読んで、返信する
    const p = await newPage(st);
    await playerLogin(p);
    const badge = () => p.$$eval("nav button", (bs) => { const b = bs.find((x) => x.innerText.includes("日報")); return b?.querySelector("span.bg-red-500")?.innerText || ""; });
    ok((await badge()) === "1", "選手の「日報」タブに、未読のコメントの数が出る");
    await clickText(p, "日報", "nav button"); await sleep(800);
    await clickText(p, "ホーム", "nav button"); await sleep(400);
    ok((await badge()) === "", "日報タブを開くと、未読の数が消える");
    await clickText(p, "日報", "nav button"); await sleep(800);
    t = await text(p);
    ok(t.includes("日報へのコメント") && /医師\s*\d+\/\d+/.test(t) && t.includes("怖さがあるのは自然です。") && t.includes("正直、走るのが少し怖いです"), "選手は日報タブで、誰からのコメントかと内容を読める");
    await clickText(p, "返信する"); await sleep(300);
    await p.type('textarea[placeholder="返信"]', "ありがとうございます。");
    await clickText(p, "送る"); await sleep(800);
    const rp = st.reportComments?.[1];
    ok(rp?.sender === "player" && rp.report_id === 1 && rp.body === "ありがとうございます。" && !rp.author_name && (await text(p)).includes("ありがとうございます。"), "選手は返信できる");
    ok(!(await p.$('button[aria-label="このコメントを削除"]')), "選手には削除のボタンは出ない");
    ok(await noOverflow(p) && p.errs.length === 0, "横にはみ出さない・例外なし " + p.errs.join("|"));
    await p.close();
    // コメントのない選手には、カードを出さない
    const st0 = makeState({ injuryDaysAgo: 3, phase: 5 });
    st0.reports = st.reports;
    const p0 = await newPage(st0);
    await playerLogin(p0);
    await clickText(p0, "日報", "nav button"); await sleep(800);
    ok(!(await text(p0)).includes("日報へのコメント"), "コメントがまだない選手には、カードを出さない");
    await p0.close();
  });

  await step("表記の統一", async () => {
    const bad = /Phase |フェーズ|スタッフ|Supabase|おかえりなさい|🏃|📋|📎|⚠️|v15\./;
    const p = await newPage(makeState({ injuryDaysAgo: 20 }));
    await p.goto(BASE, { waitUntil: "networkidle0" });
    ok(!bad.test(await text(p)), "ログイン画面に、古い表記・絵文字・ビルド番号が出ない");
    ok(!(await text(p)).includes("ホーム画面に追加できます") && (await p.evaluate(() => document.documentElement.scrollHeight)) <= 844, "ログイン画面が1画面に収まる（長い案内の箱をなくした）");
    await p.type('input[autocomplete="username"]', "default"); await p.type('input[type="password"]', "org-pass-1234");
    await p.keyboard.press("Enter"); await sleep(1200);
    await clickText(p, "山田 太郎"); await sleep(400);
    await p.type('input[maxlength="4"]', "1111"); await p.keyboard.press("Enter"); await sleep(1500);
    for (const label of ["ホーム", "メニュー", "日報", "連絡・面談", "使い方"]) {
      await clickText(p, label, "nav button"); await sleep(500);
      const m = (await text(p)).match(bad);
      ok(!m, `選手「${label}」：表記がそろっている ${m ? "→ " + m[0] : ""}`);
    }
    const c = await newPage(makeState({ injuryDaysAgo: 20 }));
    await coachLogin(c);
    for (const label of ["選手", "プロトコル", "メニュー", "日程調整"]) {
      await clickText(c, label, "nav button"); await sleep(700);
      const m = (await text(c)).match(bad);
      ok(!m, `指導者「${label}」：表記がそろっている ${m ? "→ " + m[0] : ""}`);
    }
  });

  await step("面談の案内から申し込みへ", async () => {
    const p = await newPage(makeState({ injuryDaysAgo: 20 }));
    p.on("dialog", (d) => d.dismiss());
    await playerLogin(p);
    for (const e of await p.$$("button")) if ((await e.evaluate((n) => n.innerText.trim())) === "面談を申し込む") { await e.click(); break; }
    await sleep(600);
    ok((await text(p)).includes("指導者とのチャット"), "ホームの「面談を申し込む」で、連絡・面談タブへ移動する");
  });

  await step("通知のボタン", async () => {
    const p = await newPage(makeState({ injuryDaysAgo: 3 }));
    await playerLogin(p);
    await clickText(p, "その他", "nav button"); await sleep(1200);
    let t = await text(p);
    ok(t.includes("通知") && (t.includes("通知を受け取る") || t.includes("通知を使えません") || t.includes("通知が許可されていません")), "選手の「その他」に通知の設定が出る");
    ok(t.includes("内容は表示されません"), "通知に内容が出ないことを説明している");
    ok(await noOverflow(p) && p.errs.length === 0, "横にはみ出さない・例外なし " + p.errs.join("|"));
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
    await clickText(p, "その他", "nav button"); await sleep(1000);
    ok((await text(p)).includes("選手からメッセージ・日報への返信・面談の申し込み・面談の予約・SOS"), "指導者の「その他」に通知の設定が出る");
    await clickText(p, "日程調整", "nav button"); await sleep(900);
    t = await text(p);
    ok(t.includes("2人以上") && (t.match(/公開対象/g) || []).length === 1, "コーチ＋ドクターの2人が一致した日時だけが公開対象（1人だけの日時は対象外）");
    ok(t.includes("決まった面談") && t.includes("公開中の枠（まだ予約なし）1件"), "日程調整に、決まった面談と公開中の枠の一覧がある");
    await clickText(p, "そろった日時を公開する"); await sleep(900);
    const posted = st.posts.find((x) => x.p === "/rest/v1/slots");
    ok(posted?.b?.length === 1 && posted.b[0].matched_roles.sort().join() === "coach,doctor", "公開されるのは2人以上が一致した枠だけ");
    ok(await noOverflow(p) && p.errs.length === 0, "横にはみ出さない・例外なし " + p.errs.join("|"));
  });

  await step("指導者：決まった面談の管理", async () => {
    const st = makeState({ injuryDaysAgo: 20, booked: true });
    const p = await newPage(st);
    const native = []; p.on("dialog", async (d) => { native.push(d.message()); await d.accept(); });
    await coachLogin(p);
    await clickText(p, "日程調整", "nav button"); await sleep(900);
    let t = await text(p);
    ok(t.includes("これから 1件") && t.includes("山田 太郎") && t.includes("コーチ・ドクター") && t.includes("受傷後23日"), "決まった面談に、日時・選手名・参加スタッフ・受傷後の日数が出る");
    await p.type('input[placeholder^="オンライン会議URL"]', "https://zoom.example/j/1");
    await clickText(p, "保存"); await sleep(600);
    ok(st.patches.some((x) => x.p === "/rest/v1/slots" && x.b.zoom_url === "https://zoom.example/j/1"), "オンライン会議URLを保存できる");
    await clickText(p, "予約を取り消す"); await sleep(400);
    t = await text(p);
    ok(native.length === 0 && t.includes("面談の予約を取り消しますか？") && !!(await p.$('[role="dialog"]')), "確認は、ブラウザ標準ではなくアプリの中の画面で出る");
    await clickText(p, "取り消す", '[role="dialog"] button'); await sleep(1200);
    t = await text(p);
    ok(st.patches.some((x) => x.p === "/rest/v1/slots" && x.b.booked_by === null)
       && st.patches.some((x) => x.p === "/rest/v1/players" && x.b.booked_slot_id === null), "予約を取り消すと、枠が空きに戻る（確認つき）");
    ok(st.posts.some((x) => x.p === "/rest/v1/messages" && x.b.sender === "staff" && x.b.content.includes("【面談の取り消し】")), "取り消しは選手にチャットで知らされる");
    ok(t.includes("これから 0件") && t.includes("公開中の枠（まだ予約なし）1件"), "一覧がすぐ更新される（枠は公開中に戻る）");
    await clickText(p, "公開をやめる"); await sleep(400);
    await clickText(p, "公開をやめる", '[role="dialog"] button'); await sleep(800);
    ok((await text(p)).includes("公開中の枠（まだ予約なし）0件"), "予約のない枠は、公開をやめられる");
    ok(await noOverflow(p) && p.errs.length === 0, "横にはみ出さない・例外なし " + p.errs.join("|"));
  });
} finally {
  try { await browser?.close(); } catch {}
  cleanup();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
