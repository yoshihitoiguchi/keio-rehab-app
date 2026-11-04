// ============================================================
// カメラ計測の画面の文言
//   CLAUDE.md の「使ってはいけない文言」に従う（tests/pose/analyze.test.mjs が確かめる）。
//   合否や「次へ進むかどうか」を表す言葉は使わない。出すのは「指定」と「実測」だけ。
// ============================================================
export { DISCLAIMER_MAIN } from "../lib/disclaimer.js";

export const POSE_COPY = {
  measureButton: "カメラで測る",
  guideTitle: "撮り方",
  startCamera: "カメラを起動",
  useFile: "撮った動画で測る",
  switchCamera: "カメラを切り替え",
  startRecording: "記録を始める",
  stopRecording: "記録を止める",
  retake: "撮り直す",
  useThis: "この記録を添付する",
  cancel: "やめる",
  loadingModel: "姿勢を読み取る準備をしています...",
  inFrame: "全身が枠に入っています",
  rotateHint: "スマホを横向きにすると、全身が入りやすくなります",
  saveVideo: "動画も添付する",
  noVideoNote: "動画は保存しません。関節の座標と測った値だけを保存します。",
  prescribed: "指定",
  measured: "実測",
  accuracyNote: "カメラで測った値は目安です。撮る向きや距離で数度ずれることがあります。",
  lowQuality: "読み取れなかった時間が長いため、値がずれている可能性があります。",
  cameraError: "カメラを起動できませんでした。ブラウザの設定でカメラを許可してください。",
  modelError: "姿勢を読み取る準備ができませんでした。通信状態を確かめて、もう一度開いてください。",
} as const;

export const notInFrame = (labels: string[]) => `${labels.join("・")}が枠に入っていません`;
