// ============================================================
// カメラで測る種目の設定（種目IDごとに「何を測るか」）
//
//   ・数値（指定の角度・回数・秒数）は作者の指示（2026-11-04）とプロトコルの GATE の文面のとおり。
//     Claude が医学的な内容を足さない。値を変えるときは作者に確かめる。
//   ・ここにあるのは「何を測って、どの指定と並べるか」だけ。合否や「次へ進むかどうか」は決めない。
//     進むのは今までどおり、選手本人が GATE を確認して「確認して次のPHASEへ進む」を押したとき。
//   ・角度は整形外科の表記（0° = 完全伸展）。横から撮った2次元の座標で測る。
//   ・version は保存した記録に一緒に残す。測り方を変えたら上げる。
// ============================================================

/** MediaPipe Pose の点の番号 */
export const LM = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFoot: 31,
  rightFoot: 32,
} as const;

/** 保存する点（撮った側の6点）。動画は保存しない。 */
export const SAVED_POINTS = ["shoulder", "hip", "knee", "ankle", "heel", "foot"] as const;
export type PointName = (typeof SAVED_POINTS)[number];

export type Mode = "hold" | "reps" | "eccentric";
export type Signal = "kneeFlexion" | "hipFlexion";

export interface CaptureGuide {
  /** スマホの向き */
  orientation: string;
  /** スマホの高さの目安 */
  height: string;
  /** 距離の目安 */
  distance: string;
  /** 撮る向き・姿勢 */
  view: string;
  /** 枠に入っていてほしい点 */
  requiredPoints: PointName[];
}

export interface Variant {
  id: string;
  label: string;
  /** GATE の文面にこの語があれば、この種類として測る */
  gateTextPattern?: RegExp;
  prescribed: Prescribed;
}

export interface Prescribed {
  /** 指定の膝屈曲角（°） */
  kneeFlexionDeg?: number[];
  /** 指定の保持時間（秒） */
  holdSec?: number;
  /** 指定の回数（1セット） */
  reps?: number;
  /** 指定のセット数 */
  sets?: number;
}

export interface MeasurementSpec {
  id: string;
  version: number;
  label: string;
  /** DB の exercises.name（種目名）。ここに一致する種目にだけ「カメラで測る」を出す */
  exerciseNames: string[];
  /** GATE の条件の文面がこれに当たれば「カメラで測る」を出す */
  gateTextPattern: RegExp;
  mode: Mode;
  /** 回数・保持を数えるもとにする角度 */
  signal: Signal;
  /** 画面に並べる値の名前 */
  measures: string[];
  guide: CaptureGuide;
  prescribed: Prescribed;
  variants?: Variant[];
  /** 数え方の細かい設定 */
  tuning: {
    /** 1回と数える角度の振れ幅（°） */
    repAmplitudeDeg?: number;
    /** 保持とみなす角速度の上限（°/秒） */
    holdMaxVelDegPerSec?: number;
    /** 保持として残す最短の秒数 */
    holdMinSec?: number;
    /** 指定の角度に寄せて並べる幅（°）。これより離れた保持は「その他の角度」に出す */
    nearestTargetWithinDeg?: number;
  };
}

const FLOOR_GUIDE: CaptureGuide = {
  orientation: "スマホは横向き",
  height: "床から 30〜50cm（寝た姿勢の腰の高さ）",
  distance: "体から 2〜3m 離す",
  view: "体の真横から。測る脚をカメラ側にする",
  requiredPoints: ["shoulder", "hip", "knee", "ankle"],
};

export const MEASUREMENT_SPECS: MeasurementSpec[] = [
  {
    id: "heel-dig-iso",
    version: 1,
    label: "Heel Dig ISO",
    exerciseNames: ["Heel Dig ISO"],
    gateTextPattern: /Heel\s*Dig\s*ISO/i,
    mode: "hold",
    signal: "kneeFlexion",
    measures: ["膝の屈曲角（股関節-膝-足首）", "保持の秒数", "回数"],
    guide: FLOOR_GUIDE,
    prescribed: { kneeFlexionDeg: [90, 60, 30], holdSec: 5 },
    tuning: { holdMaxVelDegPerSec: 10, holdMinSec: 1, nearestTargetWithinDeg: 15 },
  },
  {
    id: "hip-lift",
    version: 1,
    label: "Hip Lift",
    exerciseNames: ["Double-leg Hip Lift", "Long Lever Hip Lift"],
    gateTextPattern: /Hip\s*Lift/i,
    mode: "reps",
    signal: "hipFlexion",
    measures: ["回数", "持ち上げたときの股関節の角度（肩-股関節-膝）", "持ち上げたときの膝の屈曲角"],
    guide: FLOOR_GUIDE,
    prescribed: { reps: 10, sets: 3 },
    variants: [
      {
        id: "long-lever",
        label: "Long Lever",
        gateTextPattern: /Long\s*Lever/i,
        prescribed: { reps: 10, sets: 3, kneeFlexionDeg: [30] },
      },
    ],
    tuning: { repAmplitudeDeg: 15 },
  },
  {
    id: "slider",
    version: 1,
    label: "Slider",
    exerciseNames: ["Slider"],
    gateTextPattern: /Slider/i,
    mode: "eccentric",
    signal: "kneeFlexion",
    measures: ["回数", "Eccentric局面（膝が伸びていく間）の秒数", "角速度の変化"],
    guide: { ...FLOOR_GUIDE, requiredPoints: ["shoulder", "hip", "knee", "ankle", "heel"] },
    prescribed: { reps: 8, sets: 3 },
    tuning: { repAmplitudeDeg: 30 },
  },
];

export function specById(id: string): MeasurementSpec | null {
  return MEASUREMENT_SPECS.find((s) => s.id === id) || null;
}

/** GATE の条件の文面から、測れる種目を探す（なければ null） */
export function specForGateText(text: string): { spec: MeasurementSpec; variant: Variant | null } | null {
  const t = String(text || "");
  for (const spec of MEASUREMENT_SPECS) {
    if (!spec.gateTextPattern.test(t)) continue;
    const variant = (spec.variants || []).find((v) => v.gateTextPattern?.test(t)) || null;
    return { spec, variant };
  }
  return null;
}

/** 種類があればその指定、なければ種目の指定 */
export function prescribedOf(spec: MeasurementSpec, variant: Variant | null): Prescribed {
  return variant ? variant.prescribed : spec.prescribed;
}
