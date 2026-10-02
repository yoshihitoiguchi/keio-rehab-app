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
const protocol = { id: "hs", org_id: "default", name: "ハムストリング肉離れ", total_weeks: 8, phases, video_url: null, classification_scheme: "hamstring", continue_rule: CONTINUE_RULE };
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
    reports: st.reports || [], messages: st.messages, treatments: [], phase_history: [], player_exercise_progress: [], consultation_requests: st.consult });
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
  if (p === "/rest/v1/rpc/transfer_create") { st.transferCreated = (st.transferCreated || 0) + 1; return { code: "48151623", expires_at: iso(new Date(Date.now() + 1800000)) }; }
  if (p === "/rest/v1/rpc/transfer_redeem") return json?.p_code === "48151623" ? { org: { id: "default", name: "テスト組織" }, player: { id: "p-1", name: "山田 太郎" } } : null;
  if (p === "/rest/v1/organizations") return [{ id: "default", name: "テスト組織" }];
  if (p === "/rest/v1/protocols") return [protocol, otherProtocol];
  if (p === "/rest/v1/player_directory") return [{ id: "p-1", name: "山田 太郎" }];
  if (p === "/rest/v1/exercises") return exercises.map((e) => ({ ...e, protocol_id: st.protocolId }));
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

  await step("表記の統一", async () => {
    const bad = /Phase |フェーズ|スタッフ|Supabase|おかえりなさい|🏃|📋|📎|⚠️|v15\./;
    const p = await newPage(makeState({ injuryDaysAgo: 20 }));
    await p.goto(BASE, { waitUntil: "networkidle0" });
    ok(!bad.test(await text(p)), "ログイン画面に、古い表記・絵文字・ビルド番号が出ない");
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
    ok((await text(p)).includes("選手からメッセージ・面談の申し込み・面談の予約・SOS"), "指導者の「その他」に通知の設定が出る");
    await clickText(p, "日程調整", "nav button"); await sleep(900);
    t = await text(p);
    ok(t.includes("2人以上") && (t.match(/公開対象/g) || []).length === 1, "コーチ＋ドクターの2人が一致した日時だけが公開対象（1人だけの日時は対象外）");
    ok(t.includes("決まった面談") && t.includes("公開中の枠（まだ予約なし）1件"), "日程調整に、決まった面談と公開中の枠の一覧がある");
    await clickText(p, "自動照合して公開"); await sleep(900);
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
