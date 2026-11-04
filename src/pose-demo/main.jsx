// ============================================================
// /pose-demo：カメラ計測を試すページ
//   ・ログイン不要。何も保存しない（DB にもストレージにも送らない）
//   ・iPhone の Safari・Android の Chrome で、カメラ・読み取りの速さ・測った値を確かめる
// ============================================================
import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import "../index.css";
import PoseCapture from "../pose/PoseCapture.jsx";
import { specById } from "../pose/measurement-specs.ts";

const CHOICES = [
  { key: "heel-dig-iso", label: "Heel Dig ISO", spec: "heel-dig-iso", variant: null },
  { key: "hip-lift", label: "Double-leg Hip Lift", spec: "hip-lift", variant: null },
  { key: "long-lever", label: "Long Lever Hip Lift", spec: "hip-lift", variant: "long-lever" },
  { key: "slider", label: "Slider", spec: "slider", variant: null },
];

const kb = (obj) => `${Math.round(new Blob([JSON.stringify(obj)]).size / 102.4) / 10}KB`;

function Demo() {
  const [key, setKey] = useState(CHOICES[0].key);
  const [saved, setSaved] = useState(null);
  const [round, setRound] = useState(0);
  const choice = CHOICES.find((c) => c.key === key);
  const spec = specById(choice.spec);
  const variant = spec.variants?.find((v) => v.id === choice.variant) || null;

  return (
    <div className="max-w-xl mx-auto px-4 pb-16" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
      <h1 className="text-lg font-bold text-slate-900">カメラ計測の試験</h1>
      <p className="text-xs text-slate-500 mt-0.5">このページでは何も保存しません。</p>

      <div className="flex flex-wrap gap-1.5 mt-3" role="tablist" aria-label="種目">
        {CHOICES.map((c) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={c.key === key}
            onClick={() => {
              setKey(c.key);
              setSaved(null);
              setRound((n) => n + 1);
            }}
            className={`min-h-[36px] px-3 rounded-full text-sm border ${
              c.key === key ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-700 border-slate-300"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <PoseCapture
          key={`${key}-${round}`}
          spec={spec}
          variant={variant}
          allowFile
          onDone={(d) => setSaved(d)}
        />
      </div>

      {saved && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-sm font-bold text-slate-800">アプリで添付するときに保存される内容</p>
          <ul className="text-xs text-slate-600 mt-1 space-y-0.5">
            <li>測った値：{kb(saved.measured)}</li>
            <li>
              関節の座標：{kb(saved.landmarks)}（{saved.landmarks.t.length}コマ・{saved.landmarks.points.length}点）
            </li>
            <li>動画：保存しない</li>
            <li>読み取り：{saved.delegate}</li>
          </ul>
          <details className="mt-2">
            <summary className="text-xs text-blue-700 cursor-pointer min-h-[32px] flex items-center">測った値を開く</summary>
            <pre className="text-[10px] leading-snug bg-slate-50 rounded p-2 overflow-x-auto max-h-72">
              {JSON.stringify(saved.measured, null, 1)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Demo />);
