// ============================================================
// スマホのカメラで種目を撮り、関節の位置から角度・回数・秒数を測る
//   ・横から撮る前提。全身が入る枠と、高さ・距離の目安を出す
//   ・計算はすべてブラウザの中。動画は初期設定では残さない（allowVideo のときだけ選べる）
//   ・終わったら onDone({ result, measured, landmarks, videoFile }) を呼ぶ。保存は呼んだ側が行う
// ============================================================
import React, { useEffect, useRef, useState } from "react";
import { getPoseLandmarker } from "./landmarker.ts";
import {
  analyze,
  frameFromLandmarks,
  flexionOf,
  missingPoints,
  packLandmarks,
  summarize,
  POINT_LABEL,
} from "./analyze.ts";
import { SAVED_POINTS, prescribedOf } from "./measurement-specs.ts";
import { POSE_COPY, notInFrame } from "./copy.ts";
import PoseResult from "./PoseResult.jsx";

const MAX_SECONDS = 120;
const COUNTDOWN = 3;
const FRAME_INSET = 0.04; // 枠の余白（映像の幅・高さに対する割合）

function pickRecorderType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["video/mp4", "video/webm;codecs=vp9", "video/webm"]) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return "";
}

export function CaptureGuide({ spec, variant }) {
  const g = spec.guide;
  const p = prescribedOf(spec, variant);
  const pres = [];
  if (p.kneeFlexionDeg?.length) pres.push(`膝の屈曲角 ${p.kneeFlexionDeg.map((d) => `${d}°`).join("・")}`);
  if (p.holdSec) pres.push(`${p.holdSec}秒保持`);
  if (p.reps) pres.push(`${p.reps}回${p.sets ? `×${p.sets}set` : ""}`);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-bold text-slate-700">{POSE_COPY.guideTitle}</p>
      <div className="flex gap-3 mt-2 items-center">
        {/* 横から撮る図：スマホと体の位置 */}
        <svg viewBox="0 0 120 64" className="w-28 shrink-0" aria-hidden="true">
          <line x1="4" y1="54" x2="116" y2="54" stroke="#cbd5e1" strokeWidth="1.5" />
          <rect x="44" y="20" width="70" height="30" rx="3" fill="none" stroke="#22c55e" strokeWidth="1.2" strokeDasharray="3 2" />
          <circle cx="52" cy="46" r="3.5" fill="#334155" />
          <path d="M55 47 L78 47 L90 38 L104 50" fill="none" stroke="#334155" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="8" y="36" width="6" height="11" rx="1.5" fill="#2563eb" />
          <line x1="14" y1="41" x2="42" y2="41" stroke="#93c5fd" strokeWidth="1" strokeDasharray="2 2" />
          <text x="26" y="36" fontSize="7" textAnchor="middle" fill="#475569">2〜3m</text>
        </svg>
        <ul className="text-xs text-slate-700 space-y-1">
          <li>{g.view}</li>
          <li>{g.orientation}</li>
          <li>高さ：{g.height}</li>
          <li>距離：{g.distance}</li>
        </ul>
      </div>
      {pres.length > 0 && (
        <p className="text-[11px] text-slate-500 mt-2">
          {POSE_COPY.prescribed}：{pres.join("・")}
        </p>
      )}
    </div>
  );
}

export default function PoseCapture({ spec, variant = null, allowVideo = false, allowFile = false, onDone, onCancel }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const lmRef = useRef(null); // { landmarker, delegate }
  const framesRef = useRef([]);
  const recRef = useRef({ on: false, t0: 0 });
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const lastVideoTimeRef = useRef(-1);
  const lastTsRef = useRef(0);
  const sideRef = useRef("right");
  const fileUrlRef = useRef(null);
  const sourceRef = useRef("camera"); // 描画の繰り返しの中から読むので ref にも持つ

  const [stage, setStage] = useState("guide"); // guide | loading | live | countdown | recording | result
  const [facing, setFacing] = useState("environment");
  const [source, setSource] = useState("camera"); // camera | file
  const [error, setError] = useState(null);
  const [delegate, setDelegate] = useState(null);
  const [status, setStatus] = useState({ missing: [], knee: null, hip: null, portrait: false, fps: 0 });
  const [count, setCount] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN);
  const [saveVideo, setSaveVideo] = useState(false);
  const [done, setDone] = useState(null);

  const stopStream = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (fileUrlRef.current) {
      URL.revokeObjectURL(fileUrlRef.current);
      fileUrlRef.current = null;
    }
  };
  useEffect(() => stopStream, []);

  const aspectOf = () => {
    const v = videoRef.current;
    return v && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9;
  };

  const draw = (lms) => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || !v.videoWidth) return;
    if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
    }
    const ctx = c.getContext("2d");
    const W = c.width;
    const H = c.height;
    ctx.clearRect(0, 0, W, H);
    const f = lms ? frameFromLandmarks(lms, 0) : null;
    const side = sideRef.current;
    const missing = f ? missingPoints(f, side, spec.guide.requiredPoints) : spec.guide.requiredPoints;
    // 全身が入る枠
    const lw = Math.max(2, W / 320);
    ctx.setLineDash([lw * 6, lw * 4]);
    ctx.lineWidth = lw * 1.5;
    ctx.strokeStyle = missing.length ? "rgba(245,158,11,0.95)" : "rgba(34,197,94,0.95)";
    ctx.strokeRect(W * FRAME_INSET, H * FRAME_INSET, W * (1 - 2 * FRAME_INSET), H * (1 - 2 * FRAME_INSET));
    ctx.setLineDash([]);
    if (!f) return;
    // 撮った側の関節を線でつなぐ
    const pts = f[side];
    const order = SAVED_POINTS;
    ctx.lineWidth = lw * 2;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    let started = false;
    order.forEach((n, i) => {
      const p = pts[i];
      if (p[2] < 0.5) {
        started = false;
        return;
      }
      if (!started) ctx.moveTo(p[0] * W, p[1] * H);
      else ctx.lineTo(p[0] * W, p[1] * H);
      started = true;
    });
    ctx.stroke();
    order.forEach((n, i) => {
      const p = pts[i];
      if (p[2] < 0.5) return;
      ctx.beginPath();
      ctx.arc(p[0] * W, p[1] * H, lw * 4, 0, Math.PI * 2);
      ctx.fillStyle = "#2563eb";
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    });
    const aspect = W / H;
    const knee = flexionOf(f, side, "kneeFlexion", aspect);
    const hip = flexionOf(f, side, "hipFlexion", aspect);
    ctx.font = `bold ${Math.round(H / 22)}px sans-serif`;
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "rgba(15,23,42,0.8)";
    ctx.lineWidth = lw * 2;
    const label = (txt, p) => {
      ctx.strokeText(txt, p[0] * W + lw * 8, p[1] * H - lw * 6);
      ctx.fillText(txt, p[0] * W + lw * 8, p[1] * H - lw * 6);
    };
    if (knee != null) label(`${Math.round(knee)}°`, pts[SAVED_POINTS.indexOf("knee")]);
    if (hip != null && spec.signal === "hipFlexion") label(`${Math.round(hip)}°`, pts[SAVED_POINTS.indexOf("hip")]);
    return { missing, knee, hip };
  };

  const loop = () => {
    const v = videoRef.current;
    const lm = lmRef.current;
    rafRef.current = requestAnimationFrame(loop);
    if (!v || !lm || v.readyState < 2) return;
    if (v.currentTime === lastVideoTimeRef.current) return;
    lastVideoTimeRef.current = v.currentTime;
    // detectForVideo の時刻は必ず増えていくこと
    const ts = Math.max(performance.now(), lastTsRef.current + 1);
    lastTsRef.current = ts;
    let res;
    try {
      res = lm.landmarker.detectForVideo(v, ts);
    } catch (err) {
      if (lm.delegate === "GPU") {
        // GPU で動かなかった → CPU に切り替える
        lmRef.current = null;
        getPoseLandmarker("CPU")
          .then((x) => {
            lmRef.current = x;
            setDelegate(x.delegate);
          })
          .catch(() => setError(POSE_COPY.modelError));
      } else setError(POSE_COPY.modelError);
      return;
    }
    const lms = res?.landmarks?.[0] || null;
    // カメラ側の脚を、見えている度合いで少しずつ決める
    if (lms) {
      const f = frameFromLandmarks(lms, 0);
      const vis = (s) => ["hip", "knee", "ankle"].reduce((a, n) => a + f[s][SAVED_POINTS.indexOf(n)][2], 0);
      if (vis("left") > vis("right") + 0.3) sideRef.current = "left";
      else if (vis("right") > vis("left") + 0.3) sideRef.current = "right";
    }
    const info = draw(lms) || { missing: spec.guide.requiredPoints, knee: null, hip: null };
    const rec = recRef.current;
    if (rec.on) {
      const t = sourceRef.current === "file" ? v.currentTime - rec.t0 : (ts - rec.t0) / 1000;
      framesRef.current.push(frameFromLandmarks(lms || [], t));
    }
    const now = performance.now();
    if (!loop.lastUi || now - loop.lastUi > 250) {
      const fr = framesRef.current;
      setStatus({
        missing: info.missing,
        knee: info.knee,
        hip: info.hip,
        portrait: v.videoHeight > v.videoWidth,
        fps: loop.lastUi ? Math.round((loop.frames || 0) / ((now - loop.lastUi) / 1000)) : 0,
      });
      loop.frames = 0;
      loop.lastUi = now;
      if (rec.on) {
        setElapsed(fr.length ? fr[fr.length - 1].t : 0);
        if (fr.length > 10) {
          try {
            setCount(analyze(spec, variant, fr, aspectOf()).reps ?? null);
          } catch {
            /* 途中の集計は表示だけなので失敗しても続ける */
          }
        }
        if (fr.length && fr[fr.length - 1].t >= MAX_SECONDS) stopRecording();
      }
    }
    loop.frames = (loop.frames || 0) + 1;
  };

  const prepareModel = async () => {
    if (lmRef.current) return;
    const x = await getPoseLandmarker("GPU");
    lmRef.current = x;
    setDelegate(x.delegate);
  };

  const startCamera = async (nextFacing = facing) => {
    setError(null);
    setStage("loading");
    setSource("camera");
    sourceRef.current = "camera";
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      v.srcObject = stream;
      v.muted = true;
      await v.play();
    } catch {
      setError(POSE_COPY.cameraError);
      setStage("guide");
      return;
    }
    try {
      await prepareModel();
    } catch {
      setError(POSE_COPY.modelError);
      setStage("guide");
      stopStream();
      return;
    }
    lastVideoTimeRef.current = -1;
    setStage("live");
    rafRef.current = requestAnimationFrame(loop);
  };

  // 撮った動画ファイルで測る（試すとき用。動画はどこにも送らない）
  const startFile = async (file) => {
    if (!file) return;
    setError(null);
    setStage("loading");
    setSource("file");
    sourceRef.current = "file";
    stopStream();
    try {
      await prepareModel();
    } catch {
      setError(POSE_COPY.modelError);
      setStage("guide");
      return;
    }
    const v = videoRef.current;
    v.srcObject = null;
    fileUrlRef.current = URL.createObjectURL(file);
    v.src = fileUrlRef.current;
    v.muted = true;
    v.onended = () => recRef.current.on && stopRecording();
    lastVideoTimeRef.current = -1;
    framesRef.current = [];
    setCount(null);
    setElapsed(0);
    try {
      await v.play();
    } catch {
      setError(POSE_COPY.cameraError);
      setStage("guide");
      return;
    }
    recRef.current = { on: true, t0: v.currentTime };
    setStage("recording");
    rafRef.current = requestAnimationFrame(loop);
  };

  const beginRecording = () => {
    framesRef.current = [];
    chunksRef.current = [];
    setCount(null);
    setElapsed(0);
    if (allowVideo && saveVideo && streamRef.current) {
      const type = pickRecorderType();
      if (type != null) {
        try {
          const rec = new MediaRecorder(streamRef.current, type ? { mimeType: type } : undefined);
          rec.ondataavailable = (e) => e.data?.size && chunksRef.current.push(e.data);
          rec.start(1000);
          recorderRef.current = rec;
        } catch {
          recorderRef.current = null;
        }
      }
    }
    recRef.current = { on: true, t0: performance.now() };
    setStage("recording");
  };

  const startRecording = () => {
    setStage("countdown");
    let n = COUNTDOWN;
    setCountdown(n);
    const timer = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(timer);
        beginRecording();
      } else setCountdown(n);
    }, 1000);
  };

  const stopRecording = async () => {
    if (!recRef.current.on) return;
    recRef.current.on = false;
    let videoFile = null;
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      await new Promise((resolve) => {
        rec.onstop = resolve;
        rec.stop();
      });
      const type = rec.mimeType || "video/webm";
      const blob = new Blob(chunksRef.current, { type });
      const ext = type.includes("mp4") ? "mp4" : "webm";
      videoFile = new File([blob], `${spec.id}.${ext}`, { type });
    }
    recorderRef.current = null;
    const frames = framesRef.current;
    const aspect = aspectOf();
    stopStream();
    const result = analyze(spec, variant, frames, aspect);
    setDone({
      result,
      measured: summarize(result),
      landmarks: packLandmarks(frames, result.side, aspect),
      videoFile,
      delegate: lmRef.current?.delegate || delegate,
    });
    setStage("result");
  };

  const retake = () => {
    setDone(null);
    setStage("guide");
  };

  const live = stage === "live" || stage === "countdown" || stage === "recording" || stage === "loading";
  const missingLabels = status.missing.map((n) => POINT_LABEL[n]);

  return (
    <div className="space-y-3">
      {stage === "guide" && (
        <>
          <CaptureGuide spec={spec} variant={variant} />
          {allowVideo ? (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={saveVideo} onChange={(e) => setSaveVideo(e.target.checked)} className="w-5 h-5" />
              {POSE_COPY.saveVideo}
            </label>
          ) : null}
          {!saveVideo && <p className="text-[11px] text-slate-500">{POSE_COPY.noVideoNote}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => startCamera()}
              className="flex-1 min-h-[44px] px-4 rounded-lg bg-blue-600 text-white font-bold text-sm"
            >
              {POSE_COPY.startCamera}
            </button>
            {allowFile && (
              <label className="flex-1 min-h-[44px] px-4 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm flex items-center justify-center cursor-pointer">
                {POSE_COPY.useFile}
                <input type="file" accept="video/*" className="hidden" onChange={(e) => startFile(e.target.files?.[0])} />
              </label>
            )}
            {onCancel && (
              <button type="button" onClick={onCancel} className="min-h-[44px] px-4 rounded-lg border border-slate-300 text-slate-600 text-sm">
                {POSE_COPY.cancel}
              </button>
            )}
          </div>
        </>
      )}

      <div className={live ? "" : "hidden"}>
        <div className="relative w-full overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} playsInline muted autoPlay className="block w-full h-auto" />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          {stage === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-sm px-4 text-center min-h-[200px]">
              {POSE_COPY.loadingModel}
            </div>
          )}
          {stage === "countdown" && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-6xl font-bold bg-black/30">
              {countdown}
            </div>
          )}
          {stage === "recording" && (
            <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/60 text-white text-xs font-bold rounded-full px-2.5 py-1 tabular-nums">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              {Math.floor(elapsed)}秒{count != null ? `・${count}回` : ""}
            </div>
          )}
        </div>
        {stage !== "loading" && (
          <div className="mt-2 space-y-1">
            <p className={`text-sm font-bold ${status.missing.length ? "text-amber-700" : "text-green-700"}`}>
              {status.missing.length ? notInFrame(missingLabels) : POSE_COPY.inFrame}
            </p>
            {status.portrait && source === "camera" && <p className="text-xs text-slate-600">{POSE_COPY.rotateHint}</p>}
            <p className="text-xs text-slate-600 tabular-nums">
              膝の屈曲角 {status.knee == null ? "—" : `${Math.round(status.knee)}°`}
              {spec.signal === "hipFlexion" && `・股関節の屈曲角 ${status.hip == null ? "—" : `${Math.round(status.hip)}°`}`}
            </p>
            <p className="text-[10px] text-slate-400 tabular-nums">
              {delegate || "—"}・{status.fps}fps
            </p>
          </div>
        )}
        {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
        <div className="flex flex-wrap gap-2 mt-2">
          {stage === "live" && (
            <>
              <button type="button" onClick={startRecording} className="flex-1 min-h-[44px] px-4 rounded-lg bg-red-600 text-white font-bold text-sm">
                {POSE_COPY.startRecording}
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = facing === "environment" ? "user" : "environment";
                  setFacing(next);
                  startCamera(next);
                }}
                className="min-h-[44px] px-3 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm"
              >
                {POSE_COPY.switchCamera}
              </button>
            </>
          )}
          {stage === "recording" && (
            <button type="button" onClick={stopRecording} className="flex-1 min-h-[44px] px-4 rounded-lg bg-slate-800 text-white font-bold text-sm">
              {POSE_COPY.stopRecording}
            </button>
          )}
          {(stage === "live" || stage === "loading") && (
            <button
              type="button"
              onClick={() => {
                stopStream();
                setStage("guide");
              }}
              className="min-h-[44px] px-3 rounded-lg border border-slate-300 text-slate-600 text-sm"
            >
              {POSE_COPY.cancel}
            </button>
          )}
        </div>
      </div>

      {stage === "result" && done && (
        <>
          <PoseResult result={done.result} />
          {done.videoFile && <p className="text-[11px] text-slate-500">動画 {Math.round(done.videoFile.size / 1024 / 102.4) / 10}MB</p>}
          <div className="flex flex-wrap gap-2">
            {onDone && (
              <button type="button" onClick={() => onDone(done)} className="flex-1 min-h-[44px] px-4 rounded-lg bg-blue-600 text-white font-bold text-sm">
                {POSE_COPY.useThis}
              </button>
            )}
            <button type="button" onClick={retake} className="min-h-[44px] px-4 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm">
              {POSE_COPY.retake}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
