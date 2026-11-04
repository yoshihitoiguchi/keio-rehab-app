// ============================================================
// 関節の座標から、角度・回数・秒数を出す
//
//   ・入力は MediaPipe Pose の点（0〜1 の座標）。横から撮った2次元で計算する。
//   ・出すのは測った値だけ。指定と比べて合否を決めることはしない（並べて見せるのは画面の役目）。
//   ・角度は整形外科の表記：膝の屈曲角 = 180° − ∠股関節-膝-足首（0° = 完全伸展）
//                          股関節の屈曲角 = 180° − ∠肩-股関節-膝（0° = 肩・股関節・膝が一直線）
// ============================================================
import {
  LM,
  SAVED_POINTS,
  prescribedOf,
  type MeasurementSpec,
  type PointName,
  type Prescribed,
  type Signal,
  type Variant,
} from "./measurement-specs.ts";

/** [x, y, visibility]（x・y は 0〜1） */
export type Pt = [number, number, number];
export type Side = "left" | "right";

export interface PoseFrame {
  /** 記録を始めてからの秒数 */
  t: number;
  left: Pt[];
  right: Pt[];
}

export interface RawLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

const INDEX: Record<Side, Record<PointName, number>> = {
  left: {
    shoulder: LM.leftShoulder,
    hip: LM.leftHip,
    knee: LM.leftKnee,
    ankle: LM.leftAnkle,
    heel: LM.leftHeel,
    foot: LM.leftFoot,
  },
  right: {
    shoulder: LM.rightShoulder,
    hip: LM.rightHip,
    knee: LM.rightKnee,
    ankle: LM.rightAnkle,
    heel: LM.rightHeel,
    foot: LM.rightFoot,
  },
};

const P = (name: PointName) => SAVED_POINTS.indexOf(name);

/** 見えているとみなす visibility の下限 */
export const MIN_VISIBILITY = 0.5;

export function frameFromLandmarks(lms: RawLandmark[], t: number): PoseFrame {
  const pick = (side: Side): Pt[] =>
    SAVED_POINTS.map((name) => {
      const p = lms[INDEX[side][name]];
      return p ? [p.x, p.y, p.visibility ?? 0] : [0, 0, 0];
    });
  return { t, left: pick("left"), right: pick("right") };
}

/** カメラ側の脚（股関節・膝・足首がよく見えている側） */
export function pickSide(frames: PoseFrame[]): Side {
  let l = 0;
  let r = 0;
  for (const f of frames) {
    for (const n of ["hip", "knee", "ankle"] as PointName[]) {
      l += f.left[P(n)][2];
      r += f.right[P(n)][2];
    }
  }
  return r > l ? "right" : "left";
}

/** b を頂点とする角度（°）。aspect = 映像の幅 ÷ 高さ（x を実際の比率に直すため） */
export function angleDeg(a: Pt, b: Pt, c: Pt, aspect: number): number {
  const ax = (a[0] - b[0]) * aspect;
  const ay = a[1] - b[1];
  const cx = (c[0] - b[0]) * aspect;
  const cy = c[1] - b[1];
  const na = Math.hypot(ax, ay);
  const nc = Math.hypot(cx, cy);
  if (na === 0 || nc === 0) return NaN;
  const cos = Math.max(-1, Math.min(1, (ax * cx + ay * cy) / (na * nc)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** 1コマ分の屈曲角（見えていなければ null） */
export function flexionOf(f: PoseFrame, side: Side, signal: Signal, aspect: number): number | null {
  const pts = f[side];
  const names: PointName[] = signal === "kneeFlexion" ? ["hip", "knee", "ankle"] : ["shoulder", "hip", "knee"];
  const [a, b, c] = names.map((n) => pts[P(n)]);
  if (a[2] < MIN_VISIBILITY || b[2] < MIN_VISIBILITY || c[2] < MIN_VISIBILITY) return null;
  const ang = angleDeg(a, b, c, aspect);
  return Number.isFinite(ang) ? 180 - ang : null;
}

/** 短い欠け（maxGapSec 以下）を直線でつなぎ、前後 windowSec の平均でならす */
export function fillAndSmooth(
  values: (number | null)[],
  times: number[],
  windowSec = 0.1,
  maxGapSec = 0.3
): (number | null)[] {
  const n = values.length;
  const filled = values.slice();
  let i = 0;
  while (i < n) {
    if (filled[i] != null) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && filled[j] == null) j++;
    const prev = i - 1;
    if (prev >= 0 && j < n && times[j] - times[prev] <= maxGapSec) {
      const v0 = filled[prev] as number;
      const v1 = filled[j] as number;
      for (let k = i; k < j; k++) {
        const r = (times[k] - times[prev]) / (times[j] - times[prev]);
        filled[k] = v0 + (v1 - v0) * r;
      }
    }
    i = j;
  }
  const out: (number | null)[] = new Array(n).fill(null);
  let lo = 0;
  let hi = 0;
  for (let k = 0; k < n; k++) {
    if (filled[k] == null) continue;
    while (times[lo] < times[k] - windowSec) lo++;
    while (hi + 1 < n && times[hi + 1] <= times[k] + windowSec) hi++;
    let sum = 0;
    let cnt = 0;
    for (let m = lo; m <= hi; m++) {
      const v = filled[m];
      if (v != null) {
        sum += v;
        cnt++;
      }
    }
    out[k] = cnt ? sum / cnt : null;
  }
  return out;
}

export interface Pivot {
  i: number;
  kind: "max" | "min";
  /** 折り返したあと threshold 以上戻ったか（false は記録の最後でまだ折り返していないもの） */
  confirmed: boolean;
}

/** threshold 以上の振れだけを拾って、山と谷を交互に並べる */
export function zigzag(values: (number | null)[], threshold: number): Pivot[] {
  const pivots: Pivot[] = [];
  let dir = 0;
  let hi = -1;
  let lo = -1;
  let ext = -1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (dir === 0) {
      if (hi < 0 || v > (values[hi] as number)) hi = i;
      if (lo < 0 || v < (values[lo] as number)) lo = i;
      if ((values[hi] as number) - (values[lo] as number) >= threshold) {
        if (hi < lo) {
          pivots.push({ i: hi, kind: "max", confirmed: true });
          dir = -1;
          ext = lo;
        } else {
          pivots.push({ i: lo, kind: "min", confirmed: true });
          dir = 1;
          ext = hi;
        }
      }
    } else if (dir === -1) {
      if (v < (values[ext] as number)) ext = i;
      else if (v - (values[ext] as number) >= threshold) {
        pivots.push({ i: ext, kind: "min", confirmed: true });
        dir = 1;
        ext = i;
      }
    } else {
      if (v > (values[ext] as number)) ext = i;
      else if ((values[ext] as number) - v >= threshold) {
        pivots.push({ i: ext, kind: "max", confirmed: true });
        dir = -1;
        ext = i;
      }
    }
  }
  if (dir !== 0 && ext >= 0) pivots.push({ i: ext, kind: dir === -1 ? "min" : "max", confirmed: false });
  return pivots;
}

export interface Hold {
  startSec: number;
  seconds: number;
  kneeFlexionDeg: number;
}

/**
 * 角度がほとんど動いていない（角速度が maxVel °/秒 未満の）時間が minSec 以上続いたところ。
 * 角速度は前後 halfWindow 秒の差から出す（関節の位置の細かいぶれを拾わないため）。
 */
export function detectHolds(
  values: (number | null)[],
  times: number[],
  maxVel: number,
  minSec: number,
  halfWindow = 0.25,
  edgeDeg = 3
): Hold[] {
  const n = values.length;
  const still: boolean[] = new Array(n).fill(false);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    if (values[i] == null) continue;
    while (times[lo] < times[i] - halfWindow) lo++;
    while (hi + 1 < n && times[hi + 1] <= times[i] + halfWindow) hi++;
    let a = lo;
    while (a < i && values[a] == null) a++;
    let b = hi;
    while (b > i && values[b] == null) b--;
    if (times[b] - times[a] < halfWindow) continue;
    const vel = Math.abs(((values[b] as number) - (values[a] as number)) / (times[b] - times[a]));
    still[i] = vel < maxVel;
  }
  const holds: (Hold & { endIndex: number })[] = [];
  let i = 0;
  while (i < n) {
    if (!still[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && still[j + 1]) j++;
    let sum = 0;
    let cnt = 0;
    for (let k = i; k <= j; k++) {
      if (values[k] != null) {
        sum += values[k] as number;
        cnt++;
      }
    }
    const mean = cnt ? sum / cnt : 0;
    // 角速度の窓の分だけ短くなるので、角度が平均から edgeDeg 以内のところまで前後に広げる
    let a = i;
    let b = j;
    const prevEnd = holds.length ? holds[holds.length - 1].endIndex : -1;
    while (a - 1 > prevEnd && values[a - 1] != null && Math.abs((values[a - 1] as number) - mean) <= edgeDeg) a--;
    while (b + 1 < n && values[b + 1] != null && Math.abs((values[b + 1] as number) - mean) <= edgeDeg) b++;
    const seconds = times[b] - times[a];
    if (cnt && seconds >= minSec) {
      holds.push({ startSec: round(times[a], 2), seconds: round(seconds, 1), kneeFlexionDeg: round(mean, 0), endIndex: b });
    }
    i = Math.max(j, b) + 1;
  }
  return holds.map(({ endIndex, ...h }) => h);
}

export interface VelocityPoint {
  /** その Eccentric 局面の始まりからの秒数 */
  t: number;
  /** 膝が伸びていく角速度（°/秒） */
  v: number;
}

export interface Eccentric {
  startSec: number;
  seconds: number;
  fromDeg: number;
  toDeg: number;
  /** 前の 3/4 の時間の平均角速度（°/秒） */
  earlyMeanVel: number;
  /** 最後の 1/4 の時間の平均角速度（°/秒） */
  lateMeanVel: number;
  velocity: VelocityPoint[];
}

export interface RepDetail {
  atSec: number;
  hipFlexionDeg: number | null;
  kneeFlexionDeg: number | null;
}

export interface AnalysisResult {
  specId: string;
  specVersion: number;
  variantId: string | null;
  side: Side;
  durationSec: number;
  frameCount: number;
  fps: number;
  /** 測る角度が出せたコマの割合 */
  validRatio: number;
  prescribed: Prescribed;
  holds?: Hold[];
  byTarget?: { targetDeg: number; holds: Hold[] }[];
  otherHolds?: Hold[];
  reps?: number;
  repDetails?: RepDetail[];
  eccentrics?: Eccentric[];
  /** グラフ用（間引き済み） */
  series: { t: number[]; value: (number | null)[]; label: string };
}

export function round(v: number, d = 0): number {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

function downsample(t: number[], v: (number | null)[], max = 400) {
  if (t.length <= max) return { t: t.map((x) => round(x, 2)), value: v.map((x) => (x == null ? null : round(x, 1))) };
  const step = t.length / max;
  const ot: number[] = [];
  const ov: (number | null)[] = [];
  for (let k = 0; k < max; k++) {
    const i = Math.floor(k * step);
    ot.push(round(t[i], 2));
    ov.push(v[i] == null ? null : round(v[i] as number, 1));
  }
  return { t: ot, value: ov };
}

export function analyze(
  spec: MeasurementSpec,
  variant: Variant | null,
  frames: PoseFrame[],
  aspect: number
): AnalysisResult {
  const side = pickSide(frames);
  const times = frames.map((f) => f.t);
  const raw = frames.map((f) => flexionOf(f, side, spec.signal, aspect));
  const sig = fillAndSmooth(raw, times);
  const duration = frames.length ? times[times.length - 1] - times[0] : 0;
  const valid = raw.filter((v) => v != null).length;
  const prescribed = prescribedOf(spec, variant);
  const base: AnalysisResult = {
    specId: spec.id,
    specVersion: spec.version,
    variantId: variant?.id ?? null,
    side,
    durationSec: round(duration, 1),
    frameCount: frames.length,
    fps: duration > 0 ? round((frames.length - 1) / duration, 1) : 0,
    validRatio: frames.length ? round(valid / frames.length, 2) : 0,
    prescribed,
    series: {
      ...downsample(times, sig),
      label: spec.signal === "kneeFlexion" ? "膝の屈曲角" : "股関節の屈曲角",
    },
  };

  if (spec.mode === "hold") {
    const holds = detectHolds(sig, times, spec.tuning.holdMaxVelDegPerSec ?? 10, spec.tuning.holdMinSec ?? 1);
    const targets = prescribed.kneeFlexionDeg || [];
    const within = spec.tuning.nearestTargetWithinDeg ?? 15;
    const byTarget = targets.map((targetDeg) => ({ targetDeg, holds: [] as Hold[] }));
    const otherHolds: Hold[] = [];
    for (const h of holds) {
      let best = -1;
      let bestDiff = Infinity;
      targets.forEach((tg, k) => {
        const d = Math.abs(h.kneeFlexionDeg - tg);
        if (d < bestDiff) {
          bestDiff = d;
          best = k;
        }
      });
      if (best >= 0 && bestDiff <= within) byTarget[best].holds.push(h);
      else otherHolds.push(h);
    }
    return { ...base, holds, byTarget, otherHolds, reps: holds.length };
  }

  const amp = spec.tuning.repAmplitudeDeg ?? 20;
  const pivots = zigzag(sig, amp);

  if (spec.mode === "reps") {
    // 持ち上げると屈曲角が小さくなる → 谷が「持ち上げたところ」
    const knee = fillAndSmooth(
      frames.map((f) => flexionOf(f, side, "kneeFlexion", aspect)),
      times
    );
    const hip = spec.signal === "hipFlexion" ? sig : fillAndSmooth(frames.map((f) => flexionOf(f, side, "hipFlexion", aspect)), times);
    const repDetails: RepDetail[] = [];
    pivots.forEach((p, k) => {
      if (p.kind !== "min") return;
      if (k === 0 || pivots[k - 1].kind !== "max") return;
      repDetails.push({
        atSec: round(times[p.i], 1),
        hipFlexionDeg: hip[p.i] == null ? null : round(hip[p.i] as number, 0),
        kneeFlexionDeg: knee[p.i] == null ? null : round(knee[p.i] as number, 0),
      });
    });
    return { ...base, reps: repDetails.length, repDetails };
  }

  // eccentric：膝が伸びていく間（屈曲角の山 → 次の谷）
  const eccentrics: Eccentric[] = [];
  pivots.forEach((p, k) => {
    if (p.kind !== "max") return;
    const next = pivots[k + 1];
    if (!next || next.kind !== "min") return;
    const t0 = times[p.i];
    const seconds = times[next.i] - t0;
    if (seconds <= 0) return;
    const velocity: VelocityPoint[] = [];
    for (let i = p.i; i <= next.i; i++) {
      const a = Math.max(p.i, i - 1);
      const b = Math.min(next.i, i + 1);
      const va = sig[a];
      const vb = sig[b];
      if (va == null || vb == null || times[b] === times[a]) continue;
      velocity.push({ t: round(times[i] - t0, 2), v: round(-(vb - va) / (times[b] - times[a]), 0) });
    }
    const split = seconds * 0.75;
    const mean = (arr: VelocityPoint[]) => (arr.length ? arr.reduce((s, x) => s + x.v, 0) / arr.length : 0);
    eccentrics.push({
      startSec: round(t0, 1),
      seconds: round(seconds, 1),
      fromDeg: round(sig[p.i] as number, 0),
      toDeg: round(sig[next.i] as number, 0),
      earlyMeanVel: round(mean(velocity.filter((x) => x.t < split)), 0),
      lateMeanVel: round(mean(velocity.filter((x) => x.t >= split)), 0),
      velocity,
    });
  });
  return { ...base, reps: eccentrics.length, eccentrics };
}

/** いまの1コマで、枠に入っていない点（撮影ガイドの表示用） */
export function missingPoints(
  f: PoseFrame,
  side: Side,
  required: PointName[],
  margin = 0.02
): PointName[] {
  return required.filter((n) => {
    const p = f[side][P(n)];
    return p[2] < MIN_VISIBILITY || p[0] < margin || p[0] > 1 - margin || p[1] < margin || p[1] > 1 - margin;
  });
}

export const POINT_LABEL: Record<PointName, string> = {
  shoulder: "肩",
  hip: "股関節",
  knee: "膝",
  ankle: "足首",
  heel: "かかと",
  foot: "つま先",
};

/** 保存用：撮った側の6点を、最大 maxFps に間引いて小さくまとめる（動画は含めない） */
export function packLandmarks(frames: PoseFrame[], side: Side, aspect: number, maxFps = 15) {
  const t: number[] = [];
  const xyv: number[] = [];
  let last = -Infinity;
  for (const f of frames) {
    if (f.t - last < 1 / maxFps - 1e-6) continue;
    last = f.t;
    t.push(round(f.t, 3));
    for (const p of f[side]) xyv.push(round(p[0], 4), round(p[1], 4), round(p[2], 2));
  }
  return { format: 1, side, aspect: round(aspect, 4), points: [...SAVED_POINTS], t, xyv };
}

/** 保存用：グラフ用の系列や細かい角速度を除いた、測った値の要約 */
export function summarize(result: AnalysisResult) {
  const { series, eccentrics, ...rest } = result;
  return {
    ...rest,
    eccentrics: eccentrics?.map(({ velocity, ...e }) => ({
      ...e,
      velocity: velocity.filter((_, i) => i % 2 === 0),
    })),
  };
}
