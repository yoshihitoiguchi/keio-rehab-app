// ============================================================
// カメラで測る種目の計算テスト  npm run test:pose
//   作った座標（横から見た寝た姿勢）で、角度・回数・秒数が正しく出るかを確かめる。
//   カメラ・ネットワーク・DB には触れない。
// ============================================================
import { analyze, angleDeg, zigzag, frameFromLandmarks } from "../../src/pose/analyze.ts";
import { specById, specForGateText, MEASUREMENT_SPECS } from "../../src/pose/measurement-specs.ts";
import { readFileSync, readdirSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${l}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const ASPECT = 16 / 9;
const rad = (d) => (d * Math.PI) / 180;
// 横から見た寝た姿勢の33点。右脚がカメラ側（左脚は見えにくい）
function pose(hipFlex, kneeFlex, noise = 0) {
  const n = () => (Math.random() - 0.5) * noise;
  const L = 0.25; // 体の長さ（高さ基準）
  const hip = [0.5, 0.65];
  const toNorm = ([x, y]) => [x / ASPECT, y];
  const H = [hip[0] * ASPECT, hip[1]];
  const sh = [H[0] - L, H[1]];
  const th = rad(hipFlex);
  const knee = [H[0] + L * 0.9 * Math.cos(th), H[1] - L * 0.9 * Math.sin(th)];
  const sa = th - rad(kneeFlex);
  const ankle = [knee[0] + L * 0.9 * Math.cos(sa), knee[1] - L * 0.9 * Math.sin(sa)];
  const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  const put = (i, p, v = 0.95) => { const q = toNorm(p); lms[i] = { x: q[0] + n(), y: q[1] + n(), visibility: v }; };
  put(12, sh); put(24, H); put(26, knee); put(28, ankle); put(30, [ankle[0] - 0.02, ankle[1] + 0.01]); put(32, [ankle[0] + 0.03, ankle[1] - 0.02]);
  put(11, sh, 0.3); put(23, H, 0.3); put(25, knee, 0.3); put(27, ankle, 0.3);
  return lms;
}
function frames(fn, seconds, fps = 30, noise = 0.002) {
  const out = [];
  for (let k = 0; k <= seconds * fps; k++) {
    const t = k / fps;
    const [hf, kf] = fn(t);
    out.push(frameFromLandmarks(pose(hf, kf, noise), t));
  }
  return out;
}

// --- 角度 ---
ok(near(angleDeg([0, 0, 1], [1, 0, 1], [1, 1, 1], 1), 90, 1e-6), "角度：直角は90°");
const f0 = frameFromLandmarks(pose(50, 60), 0);
{
  const r = analyze(specById("heel-dig-iso"), null, [f0, { ...f0, t: 0.1 }], ASPECT);
  ok(r.side === "right", "よく見えている側（右）を選ぶ");
}

// --- zigzag ---
const zz = zigzag([0, 10, 0, 10, 0, 3, 0], 5);
ok(zz.filter((p) => p.kind === "max").length === 2, "zigzag：振れ幅より小さい揺れは数えない");

// --- Heel Dig ISO：90°・60°・30° を各5秒保持 ×2回 ---
{
  const seq = [90, 90, 60, 60, 30, 30];
  const fn = (t) => {
    const slot = Math.floor(t / 7); const local = t - slot * 7;
    const target = seq[Math.min(slot, seq.length - 1)];
    const prev = slot === 0 ? 10 : seq[slot - 1];
    // 2秒で動いて5秒保持
    const kf = local < 2 ? prev + (target - prev) * (local / 2) : target;
    return [45, kf];
  };
  const r = analyze(specById("heel-dig-iso"), null, frames(fn, 42), ASPECT);
  const counts = r.byTarget.map((b) => b.holds.length);
  ok(JSON.stringify(r.byTarget.map((b) => b.targetDeg)) === "[90,60,30]", "Heel Dig ISO：指定は 90°・60°・30°");
  // 同じ角度が続くところは1つの保持になる（90°×2 は 12秒の保持1回）
  ok(counts.every((c) => c >= 1), `Heel Dig ISO：各角度の保持を見つける（${counts.join("/")}）`);
  const h60 = r.byTarget[1].holds[0];
  ok(h60 && near(h60.kneeFlexionDeg, 60, 3), `Heel Dig ISO：60°の保持の実測（${h60?.kneeFlexionDeg}°）`);
  ok(h60 && near(h60.seconds, 12, 1.5), `Heel Dig ISO：60°の保持の秒数（${h60?.seconds}秒）`);
}
{
  // 5秒保持 → 力を抜く を5回
  const fn = (t) => { const local = t % 7; return [45, local < 5 ? 30 : 30 + 25 * Math.sin(Math.PI * (local - 5) / 2)]; };
  const r = analyze(specById("heel-dig-iso"), null, frames(fn, 35), ASPECT);
  ok(r.reps === 5, `Heel Dig ISO：5秒保持×5回の回数（${r.reps}）`);
  ok(r.byTarget[2].holds.every((h) => near(h.seconds, 5, 0.8)), `Heel Dig ISO：保持の秒数はどれも約5秒（${r.byTarget[2].holds.map((h) => h.seconds).join(",")}）`);
}

{
  // 関節の位置がぶれても（座標に ±0.6% のゆれ）、5秒保持×3回を数えられる
  const fn = (t) => { const local = t % 7; return [45, local < 5 ? 60 : 60 + 25 * Math.sin(Math.PI * (local - 5) / 2)]; };
  const r = analyze(specById("heel-dig-iso"), null, frames(fn, 21, 30, 0.012), ASPECT);
  ok(r.reps === 3 && r.byTarget[1].holds.every((h) => near(h.seconds, 5, 1) && near(h.kneeFlexionDeg, 60, 4)),
    `Heel Dig ISO：座標がぶれても保持を数えられる（${r.holds.map((h) => h.kneeFlexionDeg + "°/" + h.seconds + "秒").join(", ")}）`);
}

// --- Hip Lift：10回、上で股関節屈曲 5°、膝屈曲 30°（Long Lever） ---
{
  const fn = (t) => { const ph = (t % 3) / 3; const lift = (1 - Math.cos(2 * Math.PI * ph)) / 2; return [55 - 50 * lift, 30]; };
  const hit = specForGateText("Long Lever Hip Lift 屈曲30°・両脚 10回×3set");
  ok(hit?.spec.id === "hip-lift" && hit?.variant?.id === "long-lever", "GATE の文面から Long Lever Hip Lift を見つける");
  const r = analyze(hit.spec, hit.variant, frames(fn, 30.5), ASPECT);
  ok(r.reps === 10, `Hip Lift：回数（${r.reps}）`);
  ok(r.repDetails.every((d) => near(d.hipFlexionDeg, 5, 4)), `Hip Lift：持ち上げたときの股関節の角度（${r.repDetails.map((d) => d.hipFlexionDeg).join(",")}）`);
  ok(r.repDetails.every((d) => near(d.kneeFlexionDeg, 30, 4)), `Hip Lift：持ち上げたときの膝の屈曲角（${r.repDetails[0]?.kneeFlexionDeg}）`);
  ok(JSON.stringify(r.prescribed.kneeFlexionDeg) === "[30]", "Long Lever の指定は膝屈曲30°");
  const plain = specForGateText("Double-leg Hip Lift 10回×3setを痛みなく実施可能");
  ok(plain?.spec.id === "hip-lift" && plain.variant === null, "Double-leg Hip Lift は Long Lever として扱わない");
}

// --- Slider：8往復。伸ばすのに 3秒、最後の0.5秒で急に伸びる ---
{
  const cycle = 5; // 伸ばす3秒 + 戻す2秒
  const fn = (t) => {
    const local = t % cycle;
    let kf;
    if (local < 3) {
      // 2.5秒で 90→60、残り0.5秒で 60→5（終盤が速い）
      kf = local < 2.5 ? 90 - 30 * (local / 2.5) : 60 - 55 * ((local - 2.5) / 0.5);
    } else kf = 5 + 85 * ((local - 3) / 2);
    return [5, kf];
  };
  const r = analyze(specById("slider"), null, frames(fn, 40.2), ASPECT);
  ok(r.reps === 8, `Slider：回数（${r.reps}）`);
  ok(r.eccentrics.every((e) => near(e.seconds, 3, 0.4)), `Slider：Eccentric局面の秒数（${r.eccentrics.map((e) => e.seconds).join(",")}）`);
  ok(r.eccentrics.every((e) => e.lateMeanVel > e.earlyMeanVel * 2), `Slider：終盤の角速度が前半より速いことが数値に出る（前半 ${r.eccentrics[0]?.earlyMeanVel} / 終盤 ${r.eccentrics[0]?.lateMeanVel} °/秒）`);
}

// --- 文言：使ってはいけない表現・合否の言葉を使わない ---
{
  const BANNED = ["判定", "トリアージ", "診断します", "診断結果", "問題ありません", "練習してOK", "練習可", "合格", "不合格", "クリア", "進んでよい", "進んでOK", "達成"];
  const dir = new URL("../../src/pose/", import.meta.url);
  const files = readdirSync(dir).map((f) => new URL(f, dir));
  files.push(new URL("../../src/pose-demo/main.jsx", import.meta.url));
  const hits = [];
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    for (const w of BANNED) if (s.includes(w)) hits.push(`${f.pathname.split("/").slice(-2).join("/")}: ${w}`);
  }
  ok(hits.length === 0, `カメラ計測の画面に使ってはいけない表現がない${hits.length ? "（" + hits.join(", ") + "）" : ""}`);
}
ok(MEASUREMENT_SPECS.every((s) => s.version >= 1 && s.guide.requiredPoints.length > 0), "どの種目にも撮影ガイドと版がある");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
