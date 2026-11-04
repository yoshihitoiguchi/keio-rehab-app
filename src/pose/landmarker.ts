// ============================================================
// MediaPipe Tasks Vision の PoseLandmarker（lite）を用意する
//   ・GPU で動かし、だめなら CPU に切り替える
//   ・wasm はこのアプリから配る（パッケージと同じ版になる）。モデルは Google の配布元から読む
//   ・映像も座標も外へは送らない（すべてブラウザの中で計算する）
// ============================================================
import { PoseLandmarker } from "@mediapipe/tasks-vision";
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";

export const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export type Delegate = "GPU" | "CPU";

let cached: { landmarker: PoseLandmarker; delegate: Delegate } | null = null;
let pending: Promise<{ landmarker: PoseLandmarker; delegate: Delegate }> | null = null;

async function create(delegate: Delegate) {
  return PoseLandmarker.createFromOptions(
    { wasmLoaderPath, wasmBinaryPath },
    {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }
  );
}

/** 一度作ったものは使い回す。prefer に "CPU" を渡すと CPU で作り直す */
export async function getPoseLandmarker(prefer: Delegate = "GPU") {
  if (cached && cached.delegate === prefer) return cached;
  if (pending && !cached) return pending;
  if (cached) {
    try {
      cached.landmarker.close();
    } catch {
      /* 閉じられなくても続ける */
    }
    cached = null;
  }
  pending = (async () => {
    if (prefer === "GPU") {
      try {
        const landmarker = await create("GPU");
        return { landmarker, delegate: "GPU" as Delegate };
      } catch {
        // GPU が使えない端末・ブラウザ
      }
    }
    const landmarker = await create("CPU");
    return { landmarker, delegate: "CPU" as Delegate };
  })();
  try {
    cached = await pending;
    return cached;
  } finally {
    pending = null;
  }
}
