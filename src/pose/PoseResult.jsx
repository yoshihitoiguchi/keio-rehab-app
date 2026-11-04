// ============================================================
// カメラで測った値を「指定」と「実測」で並べて出す
//   合否や「次へ進むかどうか」は出さない。並べて見せるだけ。
//   保存した記録（GATE の添付）を出すときも、この部品を使う。
// ============================================================
import React, { useState } from "react";
import { specById } from "./measurement-specs.ts";
import { POSE_COPY, DISCLAIMER_MAIN } from "./copy.ts";

const fmtDeg = (v) => (v == null ? "—" : `${v}°`);
const rangeText = (arr, fmt) => {
  const xs = arr.filter((v) => v != null);
  if (!xs.length) return "—";
  const mn = Math.min(...xs);
  const mx = Math.max(...xs);
  return mn === mx ? fmt(mn) : `${fmt(mn)}〜${fmt(mx)}`;
};

function Row({ label, prescribed, measured, sub }) {
  return (
    <tr className="border-t border-slate-100 align-top">
      <th scope="row" className="text-left font-normal text-slate-500 py-2 pr-2 text-xs w-[34%]">
        {label}
      </th>
      <td className="py-2 pr-2 text-sm text-slate-600 w-[26%]">{prescribed}</td>
      <td className="py-2 text-sm font-bold text-slate-900 tabular-nums">
        {measured}
        {sub && <span className="block text-[11px] font-normal text-slate-500 mt-0.5">{sub}</span>}
      </td>
    </tr>
  );
}

/** 1系列の折れ線（指で触れた位置の値を出す） */
export function LineChart({ points, xUnit = "秒", yUnit = "°", yLabel, refLines = [], shadeFrom = null, height = 150 }) {
  const [hover, setHover] = useState(null);
  const valid = points.filter((p) => p.y != null);
  if (valid.length < 2) return null;
  const W = 320;
  const H = height;
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const xs = valid.map((p) => p.x);
  const ys = [...valid.map((p) => p.y), ...refLines.map((r) => r.y)];
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs) || 1;
  const yMin = Math.min(0, Math.floor(Math.min(...ys) / 10) * 10);
  const yMax = Math.max(10, Math.ceil(Math.max(...ys) / 10) * 10);
  const sx = (x) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (y) => pad.t + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b);
  // 欠けたところで線を切る
  let d = "";
  let pen = false;
  for (const p of points) {
    if (p.y == null) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`;
    pen = true;
  }
  const ticks = [yMin, (yMin + yMax) / 2, yMax].map((v) => Math.round(v));
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = x0 + (((e.clientX - rect.left) / rect.width) * W - pad.l) / (W - pad.l - pad.r) * (x1 - x0);
    let best = valid[0];
    for (const p of valid) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
    setHover(best);
  };
  return (
    <figure className="mt-2">
      {yLabel && <figcaption className="text-[11px] text-slate-500 mb-0.5">{yLabel}</figcaption>}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={yLabel}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {shadeFrom != null && (
          <rect x={sx(shadeFrom)} y={pad.t} width={W - pad.r - sx(shadeFrom)} height={H - pad.t - pad.b} fill="#f1f5f9" />
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={pad.l - 4} y={sy(t) + 3} textAnchor="end" fontSize="9" fill="#64748b">
              {t}
            </text>
          </g>
        ))}
        {refLines.map((r) => (
          <g key={r.label}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(r.y)} y2={sy(r.y)} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3" />
            <text x={W - pad.r} y={sy(r.y) - 3} textAnchor="end" fontSize="9" fill="#475569">
              {r.label}
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke="#2563eb" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <text x={pad.l} y={H - 6} fontSize="9" fill="#64748b">
          {`${Math.round(x0 * 10) / 10}${xUnit}`}
        </text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" fontSize="9" fill="#64748b">
          {`${Math.round(x1 * 10) / 10}${xUnit}`}
        </text>
        {hover && (
          <g>
            <line x1={sx(hover.x)} x2={sx(hover.x)} y1={pad.t} y2={H - pad.b} stroke="#94a3b8" strokeWidth="1" />
            <circle cx={sx(hover.x)} cy={sy(hover.y)} r="4" fill="#2563eb" stroke="#fff" strokeWidth="2" />
            <text
              x={Math.min(Math.max(sx(hover.x), pad.l + 30), W - pad.r - 30)}
              y={pad.t + 9}
              textAnchor="middle"
              fontSize="10"
              fontWeight="bold"
              fill="#0f172a"
            >
              {`${hover.y}${yUnit}・${hover.x}${xUnit}`}
            </text>
          </g>
        )}
      </svg>
    </figure>
  );
}

function HeelDigRows({ r }) {
  const p = r.prescribed;
  return (
    <>
      {(r.byTarget || []).map((b) => (
        <Row
          key={b.targetDeg}
          label={`膝の屈曲角 ${b.targetDeg}°`}
          prescribed={`${b.targetDeg}°・${p.holdSec ?? "—"}秒`}
          measured={
            b.holds.length ? b.holds.map((h) => `${h.kneeFlexionDeg}°・${h.seconds}秒`).join(" / ") : "—"
          }
          sub={b.holds.length ? `${b.holds.length}回` : null}
        />
      ))}
      {r.otherHolds?.length > 0 && (
        <Row
          label="その他の角度"
          prescribed="—"
          measured={r.otherHolds.map((h) => `${h.kneeFlexionDeg}°・${h.seconds}秒`).join(" / ")}
        />
      )}
      <Row label="回数（保持した数）" prescribed="—" measured={`${r.reps ?? 0}回`} />
    </>
  );
}

function HipLiftRows({ r }) {
  const p = r.prescribed;
  const d = r.repDetails || [];
  return (
    <>
      <Row label="回数" prescribed={p.reps ? `${p.reps}回` : "—"} measured={`${r.reps ?? 0}回`} />
      <Row
        label="持ち上げたときの股関節の屈曲角"
        prescribed="—"
        measured={rangeText(d.map((x) => x.hipFlexionDeg), fmtDeg)}
        sub="0° = 肩・股関節・膝が一直線"
      />
      <Row
        label="持ち上げたときの膝の屈曲角"
        prescribed={p.kneeFlexionDeg?.length ? fmtDeg(p.kneeFlexionDeg[0]) : "—"}
        measured={rangeText(d.map((x) => x.kneeFlexionDeg), fmtDeg)}
      />
    </>
  );
}

function SliderRows({ r }) {
  const p = r.prescribed;
  const e = r.eccentrics || [];
  return (
    <>
      <Row label="回数" prescribed={p.reps ? `${p.reps}回` : "—"} measured={`${r.reps ?? 0}回`} />
      <Row
        label="Eccentric局面の秒数"
        prescribed="—"
        measured={e.length ? e.map((x) => x.seconds).join(" / ") + "秒" : "—"}
      />
    </>
  );
}

function SliderVelocity({ r }) {
  const e = r.eccentrics || [];
  const [sel, setSel] = useState(0);
  if (!e.length) return null;
  const cur = e[Math.min(sel, e.length - 1)];
  return (
    <div className="mt-3">
      <p className="text-xs font-bold text-slate-700">Eccentric局面の角速度</p>
      <div className="flex flex-wrap gap-1.5 mt-1.5" role="tablist">
        {e.map((_, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === sel}
            onClick={() => setSel(i)}
            className={`min-w-[36px] min-h-[32px] px-2 rounded-full text-xs border ${
              i === sel ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-300"
            }`}
          >
            {i + 1}回目
          </button>
        ))}
      </div>
      <LineChart
        points={(cur.velocity || []).map((v) => ({ x: v.t, y: v.v }))}
        yUnit="°/秒"
        yLabel={`膝が伸びていく速さ（°/秒）・${cur.fromDeg}°→${cur.toDeg}°・${cur.seconds}秒`}
        shadeFrom={cur.seconds * 0.75}
      />
      <table className="w-full text-xs mt-1">
        <thead>
          <tr className="text-slate-500">
            <th className="text-left font-normal py-1">回</th>
            <th className="text-right font-normal py-1">前の3/4の平均</th>
            <th className="text-right font-normal py-1">最後の1/4の平均</th>
          </tr>
        </thead>
        <tbody>
          {e.map((x, i) => (
            <tr key={i} className={`border-t border-slate-100 tabular-nums ${i === sel ? "font-bold text-slate-900" : "text-slate-700"}`}>
              <td className="py-1">{i + 1}回目</td>
              <td className="py-1 text-right">{x.earlyMeanVel}°/秒</td>
              <td className="py-1 text-right">{x.lateMeanVel}°/秒</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-slate-500 mt-1">グラフの灰色の部分が最後の1/4です。</p>
    </div>
  );
}

export default function PoseResult({ result, showChart = true }) {
  if (!result) return null;
  const spec = specById(result.specId);
  const variant = spec?.variants?.find((v) => v.id === result.variantId) || null;
  const title = [variant?.label, spec?.label].filter(Boolean).join(" ") || result.specId;
  const targets = result.prescribed?.kneeFlexionDeg || [];
  const series = result.series;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-bold text-slate-800">{title}</p>
        <p className="text-[11px] text-slate-500 tabular-nums">
          {result.side === "right" ? "右脚" : "左脚"}・{result.durationSec}秒
        </p>
      </div>
      <table className="w-full mt-1.5">
        <thead>
          <tr className="text-[11px] text-slate-500">
            <th className="text-left font-normal pb-1"></th>
            <th className="text-left font-normal pb-1">{POSE_COPY.prescribed}</th>
            <th className="text-left font-normal pb-1">{POSE_COPY.measured}</th>
          </tr>
        </thead>
        <tbody>
          {spec?.mode === "hold" && <HeelDigRows r={result} />}
          {spec?.mode === "reps" && <HipLiftRows r={result} />}
          {spec?.mode === "eccentric" && <SliderRows r={result} />}
        </tbody>
      </table>
      {showChart && series?.t?.length > 1 && (
        <LineChart
          points={series.t.map((t, i) => ({ x: t, y: series.value[i] }))}
          yLabel={`${series.label}（°）`}
          refLines={spec?.signal === "kneeFlexion" ? targets.map((t) => ({ y: t, label: `指定 ${t}°` })) : []}
        />
      )}
      {showChart && spec?.mode === "eccentric" && <SliderVelocity r={result} />}
      {result.validRatio < 0.7 && <p className="text-[11px] text-amber-700 mt-2">{POSE_COPY.lowQuality}</p>}
      <p className="text-[11px] text-slate-500 mt-2">{POSE_COPY.accuracyNote}</p>
      <p className="text-[11px] text-slate-500 mt-1">{DISCLAIMER_MAIN}</p>
    </div>
  );
}

