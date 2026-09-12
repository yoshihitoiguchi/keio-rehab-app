import React, { useState, useEffect } from "react";
import {
  Activity,
  Lock,
  ClipboardList,
  Users,
  AlertTriangle,
  CheckCircle2,
  Circle,
  PlusCircle,
  Send,
  CalendarClock,
  ArrowRight,
  Timer,
  Flame,
  ShieldCheck,
  Trash2,
  ChevronLeft,
  Loader2,
  WifiOff,
  Settings,
} from "lucide-react";

// ============================================================
// Supabase 接続設定
// ここにあなたのプロジェクトのURLとanonキーを入れてください
// (Supabaseダッシュボード > Project Settings > API から取得)
// ============================================================
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";

const SUPABASE_CONFIGURED =
  !SUPABASE_URL.includes("YOUR-PROJECT-REF") &&
  !SUPABASE_ANON_KEY.includes("YOUR-ANON-PUBLIC-KEY");

// ---- Supabase REST(PostgREST) 薄いラッパー ----
// @supabase/supabase-js は使わず、標準fetchでREST APIを直接叩きます。
async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    body: options.body,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase error ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const sbSelect = (table, query = "") => sb(`${table}${query}`);
const sbInsert = (table, body) =>
  sb(table, { method: "POST", body: JSON.stringify(body) });
const sbUpdate = (table, id, body) =>
  sb(`${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
const sbDelete = (table, id) =>
  sb(`${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    prefer: "return=minimal",
  });

// ---- DBの行(snake_case) <-> アプリ内部表現(camelCase) の変換 ----
function normalizeProtocol(row) {
  return {
    id: row.id,
    name: row.name,
    totalWeeks: row.total_weeks,
    phases: row.phases || [],
  };
}
function normalizePlayer(row) {
  return {
    id: row.id,
    name: row.name,
    protocolId: row.protocol_id,
    currentPhase: row.current_phase,
    checklist: row.checklist || [],
    sos: row.sos,
    bookedSlotId: row.booked_slot_id,
    reports: (row.reports || [])
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((r) => ({ date: r.date, vas: r.vas, mental: r.mental, honne: r.honne })),
  };
}
function normalizeSlot(row) {
  return { id: row.id, datetime: row.datetime, bookedBy: row.booked_by };
}

const MENTAL_FACES = ["😞", "😕", "😐", "🙂", "😄"];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function latestReport(player) {
  if (!player.reports.length) return null;
  return player.reports[player.reports.length - 1];
}

function isAlert(player) {
  const r = latestReport(player);
  if (!r) return player.sos;
  return player.sos || r.vas >= 7;
}

function weeksRemaining(protocol, currentPhase) {
  if (!protocol) return 0;
  const perPhase = protocol.totalWeeks / 5;
  const remaining = Math.round(perPhase * (5 - currentPhase + 1));
  return Math.max(0, remaining);
}

// ==================================================================
export default function App() {
  const [mode, setMode] = useState("player"); // 'player' | 'coach' | 'coach-login'
  const [coachAuthed, setCoachAuthed] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);

  const [masterProtocols, setMasterProtocols] = useState([]);
  const [players, setPlayers] = useState([]);
  const [slots, setSlots] = useState([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [myPlayerId, setMyPlayerId] = useState(null);

  const refetchAll = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [protocolRows, playerRows, slotRows] = await Promise.all([
        sbSelect("protocols", "?select=*&order=name.asc"),
        sbSelect(
          "players",
          "?select=*,reports(*)&reports.order=created_at.asc&order=name.asc"
        ),
        sbSelect("slots", "?select=*&order=datetime.asc"),
      ]);
      setMasterProtocols(protocolRows.map(normalizeProtocol));
      setPlayers(playerRows.map(normalizePlayer));
      setSlots(slotRows.map(normalizeSlot));
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (SUPABASE_CONFIGURED) refetchAll();
    else setLoading(false);
  }, []);

  const handleSwitchMode = (target) => {
    if (target === "coach" && !coachAuthed) {
      setMode("coach-login");
      return;
    }
    setMode(target);
  };

  const handlePasswordSubmit = () => {
    if (pwInput === "1234") {
      setCoachAuthed(true);
      setMode("coach");
      setPwError(false);
      setPwInput("");
    } else {
      setPwError(true);
    }
  };

  if (!SUPABASE_CONFIGURED) {
    return <SupabaseSetupNotice />;
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* ---------- ヘッダー / モード切替 ---------- */}
      <header className="bg-slate-900 text-white sticky top-0 z-20 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Flame className="text-orange-400" size={22} />
            <span className="font-bold tracking-tight text-lg">
              RE:SPRINT <span className="text-slate-400 font-normal text-sm">Rehab Progress</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            {loadError && (
              <span className="flex items-center gap-1 text-xs text-red-300">
                <WifiOff size={14} /> 同期エラー
              </span>
            )}
            {loading && <Loader2 size={16} className="animate-spin text-slate-400" />}
            <div className="flex bg-slate-800 rounded-full p-1 gap-1">
              <button
                onClick={() => handleSwitchMode("player")}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  mode === "player" ? "bg-blue-600 text-white" : "text-slate-300 hover:text-white"
                }`}
              >
                🏃‍♂️ 選手モード
              </button>
              <button
                onClick={() => handleSwitchMode("coach")}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  mode === "coach" || mode === "coach-login"
                    ? "bg-blue-600 text-white"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                📋 指導者モード
              </button>
            </div>
          </div>
        </div>
      </header>

      {loadError && (
        <div className="bg-red-50 border-b border-red-200 text-red-600 text-xs px-4 py-2 flex items-center justify-between">
          <span>データの取得に失敗しました: {loadError}</span>
          <button onClick={refetchAll} className="font-bold underline shrink-0 ml-3">
            再試行
          </button>
        </div>
      )}

      <main className="flex-1">
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-2">
            <Loader2 className="animate-spin" size={24} />
            <p className="text-sm">Supabaseからデータを読み込み中...</p>
          </div>
        )}

        {!loading && mode === "coach-login" && (
          <PasswordGate
            pwInput={pwInput}
            setPwInput={setPwInput}
            pwError={pwError}
            onSubmit={handlePasswordSubmit}
            onCancel={() => setMode("player")}
          />
        )}

        {!loading && mode === "coach" && coachAuthed && (
          <CoachDashboard
            masterProtocols={masterProtocols}
            setMasterProtocols={setMasterProtocols}
            players={players}
            setPlayers={setPlayers}
            slots={slots}
            setSlots={setSlots}
          />
        )}

        {!loading && mode === "player" && (
          <PlayerMode
            masterProtocols={masterProtocols}
            players={players}
            setPlayers={setPlayers}
            slots={slots}
            setSlots={setSlots}
            myPlayerId={myPlayerId}
            setMyPlayerId={setMyPlayerId}
          />
        )}
      </main>
    </div>
  );
}

// ==================================================================
// Supabase未設定の場合の案内画面
// ==================================================================
function SupabaseSetupNotice() {
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="max-w-lg bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
        <div className="flex items-center gap-2 mb-3">
          <Settings className="text-blue-600" size={22} />
          <h2 className="font-bold text-lg text-slate-800">Supabaseの接続設定が必要です</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          このファイルの先頭にある <code className="bg-slate-100 px-1 rounded">SUPABASE_URL</code>{" "}
          と <code className="bg-slate-100 px-1 rounded">SUPABASE_ANON_KEY</code> を、
          あなたのSupabaseプロジェクトの値に置き換えてください（Project Settings → API）。
        </p>
        <p className="text-sm text-slate-500 mb-2">
          また、対応するテーブル（protocols / players / reports / slots）を
          あわせて用意した SQL で作成しておく必要があります。
        </p>
        <p className="text-xs text-slate-400">
          設定が完了すると、このままこの画面は表示されなくなり、通常のアプリが起動します。
        </p>
      </div>
    </div>
  );
}

// ==================================================================
// パスワードゲート
// ==================================================================
function PasswordGate({ pwInput, setPwInput, pwError, onSubmit, onCancel }) {
  return (
    <div className="max-w-sm mx-auto mt-16 bg-white rounded-2xl shadow-lg p-8 border border-slate-200">
      <div className="flex flex-col items-center gap-3 mb-6">
        <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center">
          <Lock className="text-blue-600" size={26} />
        </div>
        <h2 className="text-lg font-bold text-slate-800">指導者モードへのログイン</h2>
        <p className="text-sm text-slate-500 text-center">
          選手の医療情報を含みます。パスワードを入力してください。
        </p>
      </div>
      <input
        type="password"
        value={pwInput}
        onChange={(e) => setPwInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        placeholder="パスワード"
        className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
        autoFocus
      />
      {pwError && (
        <p className="text-red-500 text-sm mt-2 text-center">
          パスワードが違います。もう一度お試しください。
        </p>
      )}
      <div className="flex gap-2 mt-5">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium"
        >
          戻る
        </button>
        <button
          onClick={onSubmit}
          className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium"
        >
          ログイン
        </button>
      </div>
      <p className="text-xs text-slate-400 text-center mt-4">デモ用パスワード: 1234</p>
    </div>
  );
}

// ==================================================================
// 指導者モード
// ==================================================================
function CoachDashboard({
  masterProtocols,
  setMasterProtocols,
  players,
  setPlayers,
  slots,
  setSlots,
}) {
  const [subTab, setSubTab] = useState("players"); // 'players' | 'protocols'

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex gap-2 mb-6 border-b border-slate-300">
        <button
          onClick={() => setSubTab("players")}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            subTab === "players"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Users size={16} /> 選手管理
        </button>
        <button
          onClick={() => setSubTab("protocols")}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            subTab === "protocols"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <ClipboardList size={16} /> プロトコル管理
        </button>
      </div>

      {subTab === "protocols" && (
        <ProtocolManagement
          masterProtocols={masterProtocols}
          setMasterProtocols={setMasterProtocols}
        />
      )}
      {subTab === "players" && (
        <PlayerManagement
          masterProtocols={masterProtocols}
          players={players}
          setPlayers={setPlayers}
          slots={slots}
          setSlots={setSlots}
        />
      )}
    </div>
  );
}

// ---------- ① プロトコル管理(CMS) : Supabase連携 ----------
function ProtocolManagement({ masterProtocols, setMasterProtocols }) {
  const blankPhases = () =>
    Array.from({ length: 5 }, (_, i) => ({
      title: `フェーズ${i + 1}`,
      conditionsText: "",
    }));

  const [name, setName] = useState("");
  const [totalWeeks, setTotalWeeks] = useState(8);
  const [phaseForms, setPhaseForms] = useState(blankPhases());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const updatePhaseForm = (idx, field, value) => {
    setPhaseForms((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  };

  const handleAddProtocol = async () => {
    if (!name.trim()) return;
    const phases = phaseForms.map((p) => ({
      title: p.title.trim() || "無題フェーズ",
      conditions: p.conditionsText.split("\n").map((c) => c.trim()).filter(Boolean),
    }));
    const payload = {
      id: `proto-${Date.now()}`,
      name: name.trim(),
      total_weeks: Number(totalWeeks) || 8,
      phases,
    };
    setSaving(true);
    setError(null);
    try {
      const [inserted] = await sbInsert("protocols", payload);
      setMasterProtocols((prev) => [...prev, normalizeProtocol(inserted)]);
      setName("");
      setTotalWeeks(8);
      setPhaseForms(blankPhases());
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProtocol = async (id) => {
    try {
      await sbDelete("protocols", id);
      setMasterProtocols((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 既存プロトコル一覧 */}
      <div className="space-y-4">
        <h3 className="font-bold text-slate-700 text-sm">
          登録済みプロトコル ({masterProtocols.length})
        </h3>
        {masterProtocols.map((p) => (
          <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-bold text-slate-800">{p.name}</p>
                <p className="text-xs text-slate-400">標準復帰期間: 約{p.totalWeeks}週間</p>
              </div>
              <button
                onClick={() => handleDeleteProtocol(p.id)}
                className="text-slate-400 hover:text-red-500 p-1"
                title="削除"
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {p.phases.map((ph, i) => (
                <div key={i} className="text-xs bg-slate-50 rounded-lg px-3 py-2">
                  <p className="font-semibold text-slate-600">
                    Phase {i + 1}: {ph.title}
                  </p>
                  <ul className="mt-1 list-disc list-inside text-slate-500">
                    {ph.conditions.map((c, j) => (
                      <li key={j}>{c}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}
        {masterProtocols.length === 0 && (
          <p className="text-sm text-slate-400">まだプロトコルが登録されていません。</p>
        )}
      </div>

      {/* 新規追加フォーム */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 h-fit">
        <h3 className="font-bold text-slate-700 text-sm mb-4 flex items-center gap-1.5">
          <PlusCircle size={16} className="text-blue-600" /> 新しい怪我の種類を追加
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500">怪我の名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：前十字靭帯損傷"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">標準復帰期間（週）</label>
            <input
              type="number"
              value={totalWeeks}
              onChange={(e) => setTotalWeeks(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
            {phaseForms.map((p, idx) => (
              <div key={idx} className="border border-slate-200 rounded-lg p-3">
                <label className="text-xs text-slate-500">Phase {idx + 1} 名称</label>
                <input
                  value={p.title}
                  onChange={(e) => updatePhaseForm(idx, "title", e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mt-1 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <label className="text-xs text-slate-500">クリア条件（1行に1つ）</label>
                <textarea
                  value={p.conditionsText}
                  onChange={(e) => updatePhaseForm(idx, "conditionsText", e.target.value)}
                  rows={3}
                  placeholder={"例：\n他動ROMが健側90%以上\n軽いジョグで痛みなし"}
                  className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ))}
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            onClick={handleAddProtocol}
            disabled={!name.trim() || saving}
            className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "保存中..." : "プロトコルを追加する"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- ② 選手管理（2ペイン） : Supabase連携 ----------
function PlayerManagement({ masterProtocols, players, setPlayers, slots, setSlots }) {
  const [selectedId, setSelectedId] = useState(players[0]?.id ?? null);
  const [newSlotTime, setNewSlotTime] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedId && players.length > 0) setSelectedId(players[0].id);
  }, [players, selectedId]);

  const selectedPlayer = players.find((p) => p.id === selectedId) || null;
  const protocolOf = (p) => masterProtocols.find((mp) => mp.id === p.protocolId);

  const toggleChecklist = async (playerId, idx) => {
    const player = players.find((p) => p.id === playerId);
    if (!player) return;
    const nextChecklist = [...player.checklist];
    nextChecklist[idx] = !nextChecklist[idx];
    setPlayers((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, checklist: nextChecklist } : p))
    );
    try {
      await sbUpdate("players", playerId, { checklist: nextChecklist });
    } catch (err) {
      setError(err.message);
    }
  };

  const advancePhase = async (playerId) => {
    const player = players.find((p) => p.id === playerId);
    if (!player) return;
    const protocol = masterProtocols.find((mp) => mp.id === player.protocolId);
    const nextPhase = Math.min(5, player.currentPhase + 1);
    const nextConditionsCount = protocol?.phases[nextPhase - 1]?.conditions.length ?? 0;
    const patch = {
      currentPhase: nextPhase,
      checklist: Array(nextConditionsCount).fill(false),
      sos: false,
    };
    setPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, ...patch } : p)));
    try {
      await sbUpdate("players", playerId, {
        current_phase: nextPhase,
        checklist: patch.checklist,
        sos: false,
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const addSlot = async () => {
    if (!newSlotTime.trim()) return;
    const payload = {
      id: `slot-${Date.now()}`,
      datetime: newSlotTime.trim(),
      booked_by: null,
    };
    try {
      const [inserted] = await sbInsert("slots", payload);
      setSlots((prev) => [...prev, normalizeSlot(inserted)]);
      setNewSlotTime("");
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      {/* 左ペイン：選手リスト */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden h-fit">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <p className="text-sm font-bold text-slate-700">選手一覧 ({players.length})</p>
        </div>
        <ul className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
          {players.map((p) => {
            const alert = isAlert(p);
            const r = latestReport(p);
            return (
              <li key={p.id}>
                <button
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors ${
                    selectedId === p.id ? "bg-blue-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {alert && <AlertTriangle size={16} className="text-red-500 shrink-0" />}
                    <div>
                      <p
                        className={`text-sm font-semibold ${
                          alert ? "text-red-600" : "text-slate-800"
                        }`}
                      >
                        {p.name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {protocolOf(p)?.name ?? "未設定"} ・ Phase {p.currentPhase}/5
                      </p>
                    </div>
                  </div>
                  {r && (
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        r.vas >= 7
                          ? "bg-red-100 text-red-600"
                          : r.vas >= 4
                          ? "bg-orange-100 text-orange-600"
                          : "bg-green-100 text-green-600"
                      }`}
                    >
                      VAS {r.vas}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {players.length === 0 && (
            <li className="px-4 py-6 text-sm text-slate-400 text-center">選手が登録されていません</li>
          )}
        </ul>
      </div>

      {/* 右ペイン：詳細・承認 */}
      <div>
        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
        {!selectedPlayer && (
          <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 text-sm">
            左のリストから選手を選択してください
          </div>
        )}
        {selectedPlayer && (
          <PlayerDetailPanel
            player={selectedPlayer}
            protocol={protocolOf(selectedPlayer)}
            slots={slots}
            newSlotTime={newSlotTime}
            setNewSlotTime={setNewSlotTime}
            addSlot={addSlot}
            toggleChecklist={toggleChecklist}
            advancePhase={advancePhase}
          />
        )}
      </div>
    </div>
  );
}

function PlayerDetailPanel({
  player,
  protocol,
  slots,
  newSlotTime,
  setNewSlotTime,
  addSlot,
  toggleChecklist,
  advancePhase,
}) {
  const report = latestReport(player);
  const phaseInfo = protocol?.phases[player.currentPhase - 1];
  const allChecked = player.checklist.length > 0 && player.checklist.every(Boolean);
  const bookedSlot = slots.find((s) => s.id === player.bookedSlotId);

  return (
    <div className="space-y-5">
      {/* ヘッダー */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-lg text-slate-800">{player.name}</h3>
          <p className="text-sm text-slate-400">
            {protocol?.name ?? "未設定"} ・ 現在 Phase {player.currentPhase}/5：{phaseInfo?.title}
          </p>
        </div>
        {isAlert(player) && (
          <span className="flex items-center gap-1 bg-red-100 text-red-600 text-xs font-bold px-3 py-1.5 rounded-full">
            <AlertTriangle size={14} /> 要確認
          </span>
        )}
      </div>

      {/* 本日の日報 */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h4 className="text-sm font-bold text-slate-700 mb-3">本日の日報</h4>
        {!report && <p className="text-sm text-slate-400">まだ報告がありません。</p>}
        {report && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <p className="text-xs text-slate-400 mb-1">痛み(VAS)</p>
              <p
                className={`text-2xl font-bold ${
                  report.vas >= 7
                    ? "text-red-500"
                    : report.vas >= 4
                    ? "text-orange-500"
                    : "text-green-600"
                }`}
              >
                {report.vas}
              </p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <p className="text-xs text-slate-400 mb-1">メンタル</p>
              <p className="text-2xl">{MENTAL_FACES[report.mental - 1]}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center flex flex-col justify-center">
              <p className="text-xs text-slate-400 mb-1">SOS</p>
              <p className={`text-sm font-bold ${player.sos ? "text-red-500" : "text-slate-400"}`}>
                {player.sos ? "あり" : "なし"}
              </p>
            </div>
            <div className="col-span-3 bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">本音・言い訳</p>
              <p className="text-sm text-slate-700">{report.honne || "（未記入）"}</p>
            </div>
          </div>
        )}
      </div>

      {/* クリア条件チェック */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h4 className="text-sm font-bold text-slate-700 mb-3">
          Phase {player.currentPhase} クリア条件の確認
        </h4>
        <div className="space-y-2">
          {phaseInfo?.conditions.map((c, idx) => (
            <button
              key={idx}
              onClick={() => toggleChecklist(player.id, idx)}
              className="w-full flex items-center gap-2.5 text-left px-3 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50"
            >
              {player.checklist[idx] ? (
                <CheckCircle2 size={18} className="text-green-600 shrink-0" />
              ) : (
                <Circle size={18} className="text-slate-300 shrink-0" />
              )}
              <span className={`text-sm ${player.checklist[idx] ? "text-slate-800" : "text-slate-500"}`}>
                {c}
              </span>
            </button>
          ))}
          {(!phaseInfo || phaseInfo.conditions.length === 0) && (
            <p className="text-sm text-slate-400">このフェーズに条件は設定されていません。</p>
          )}
        </div>
        <button
          onClick={() => advancePhase(player.id)}
          disabled={!allChecked || player.currentPhase >= 5}
          className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          {player.currentPhase >= 5 ? (
            <>
              <ShieldCheck size={16} /> 全フェーズ完了済み
            </>
          ) : (
            <>
              次のフェーズへ進める <ArrowRight size={16} />
            </>
          )}
        </button>
      </div>

      {/* 面談枠登録 */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
          <CalendarClock size={16} className="text-blue-600" /> 面談可能枠の登録
        </h4>
        {bookedSlot && (
          <p className="text-xs text-green-600 bg-green-50 rounded-lg px-3 py-2 mb-3">
            この選手は {bookedSlot.datetime} に面談予約済みです。
          </p>
        )}
        <div className="flex gap-2 mb-3">
          <input
            value={newSlotTime}
            onChange={(e) => setNewSlotTime(e.target.value)}
            placeholder="例：2026-09-20 15:00"
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={addSlot}
            className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700"
          >
            枠を追加
          </button>
        </div>
        <ul className="space-y-1.5">
          {slots.map((s) => (
            <li key={s.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2">
              <span className="text-slate-600 flex items-center gap-1.5">
                <Timer size={12} /> {s.datetime}
              </span>
              <span className={`font-bold ${s.bookedBy ? "text-orange-500" : "text-slate-400"}`}>
                {s.bookedBy ? "予約済み" : "空き"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ==================================================================
// 選手モード
// ==================================================================
function PlayerMode({ masterProtocols, players, setPlayers, slots, setSlots, myPlayerId, setMyPlayerId }) {
  const myPlayer = players.find((p) => p.id === myPlayerId) || null;

  if (!myPlayer) {
    return (
      <PlayerRegistration
        masterProtocols={masterProtocols}
        players={players}
        setPlayers={setPlayers}
        setMyPlayerId={setMyPlayerId}
      />
    );
  }

  return (
    <PlayerPersonalDashboard
      player={myPlayer}
      protocol={masterProtocols.find((mp) => mp.id === myPlayer.protocolId)}
      setPlayers={setPlayers}
      slots={slots}
      setSlots={setSlots}
      onSwitchDemoPlayer={() => setMyPlayerId(null)}
    />
  );
}

function PlayerRegistration({ masterProtocols, players, setPlayers, setMyPlayerId }) {
  const [name, setName] = useState("");
  const [protocolId, setProtocolId] = useState(masterProtocols[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!protocolId && masterProtocols[0]) setProtocolId(masterProtocols[0].id);
  }, [masterProtocols, protocolId]);

  const handleRegister = async () => {
    if (!name.trim() || !protocolId) return;
    const initialChecklist = Array(
      masterProtocols.find((p) => p.id === protocolId)?.phases[0]?.conditions.length ?? 0
    ).fill(false);
    const payload = {
      id: `player-${Date.now()}`,
      name: name.trim(),
      protocol_id: protocolId,
      current_phase: 1,
      checklist: initialChecklist,
      sos: false,
      booked_slot_id: null,
    };
    setSaving(true);
    setError(null);
    try {
      const [inserted] = await sbInsert("players", payload);
      const newPlayer = normalizePlayer({ ...inserted, reports: [] });
      setPlayers((prev) => [...prev, newPlayer]);
      setMyPlayerId(newPlayer.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-8">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="text-blue-600" size={22} />
          <h2 className="font-bold text-lg text-slate-800">はじめまして</h2>
        </div>
        <p className="text-sm text-slate-500 mb-5">
          復帰までの道のりを一緒に管理しましょう。まずは登録から。
        </p>

        <label className="text-xs text-slate-500">名前</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例：鈴木 颯太"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mt-1 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <label className="text-xs text-slate-500">怪我の種類</label>
        <select
          value={protocolId}
          onChange={(e) => setProtocolId(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mt-1 mb-5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {masterProtocols.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {masterProtocols.length === 0 && <option value="">プロトコル未登録</option>}
        </select>

        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

        <button
          onClick={handleRegister}
          disabled={!name.trim() || !protocolId || saving}
          className="w-full py-3 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 disabled:bg-slate-300 flex items-center justify-center gap-2"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? "登録中..." : "登録してはじめる"}
        </button>

        {players.length > 0 && (
          <div className="mt-6 pt-5 border-t border-slate-100">
            <p className="text-xs text-slate-400 mb-2">デモ：既存の選手として見る</p>
            <div className="flex flex-wrap gap-2">
              {players.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setMyPlayerId(p.id)}
                  className="text-xs px-3 py-1.5 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerPersonalDashboard({ player, protocol, setPlayers, slots, setSlots, onSwitchDemoPlayer }) {
  const [vas, setVas] = useState(3);
  const [mental, setMental] = useState(3);
  const [honne, setHonne] = useState("");
  const [sos, setSos] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const phaseInfo = protocol?.phases[player.currentPhase - 1];
  const remainingWeeks = weeksRemaining(protocol, player.currentPhase);
  const progressPct = ((player.currentPhase - 1) / 5) * 100;
  const bookedSlot = slots.find((s) => s.id === player.bookedSlotId);
  const availableSlots = slots.filter((s) => !s.bookedBy);

  const handleSubmitReport = async () => {
    setSending(true);
    setError(null);
    const newReport = { date: todayStr(), vas, mental, honne: honne.trim() };
    try {
      await sbInsert("reports", {
        player_id: player.id,
        date: newReport.date,
        vas: newReport.vas,
        mental: newReport.mental,
        honne: newReport.honne,
      });
      await sbUpdate("players", player.id, { sos });
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === player.id ? { ...p, sos, reports: [...p.reports, newReport] } : p
        )
      );
      setSent(true);
      setHonne("");
      setSos(false);
      setTimeout(() => setSent(false), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleBookSlot = async (slotId) => {
    setError(null);
    try {
      await sbUpdate("slots", slotId, { booked_by: player.id });
      await sbUpdate("players", player.id, { booked_slot_id: slotId });
      setSlots((prev) => prev.map((s) => (s.id === slotId ? { ...s, bookedBy: player.id } : s)));
      setPlayers((prev) =>
        prev.map((p) => (p.id === player.id ? { ...p, bookedSlotId: slotId } : p))
      );
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">おかえりなさい</p>
          <h2 className="font-bold text-xl text-slate-800">{player.name} さん</h2>
        </div>
        <button
          onClick={onSwitchDemoPlayer}
          className="text-xs text-slate-400 flex items-center gap-1 hover:text-slate-600"
        >
          <ChevronLeft size={14} /> 切替
        </button>
      </div>

      {/* ロードマップ */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-bold text-slate-700">復帰ロードマップ</p>
          <span className="text-xs font-bold text-blue-600">
            現在のステップ：{player.currentPhase}/5
          </span>
        </div>
        <p className="text-2xl font-extrabold text-slate-800 mb-1">
          全体復帰まであと {remainingWeeks} 週間
        </p>
        <p className="text-xs text-slate-400 mb-3">{protocol?.name}</p>

        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-orange-400 rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex justify-between mt-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={`text-[10px] font-bold ${
                n <= player.currentPhase ? "text-blue-600" : "text-slate-300"
              }`}
            >
              P{n}
            </span>
          ))}
        </div>

        <div className="mt-4 bg-slate-50 rounded-lg p-3">
          <p className="text-xs font-bold text-slate-600 mb-1">現在：{phaseInfo?.title}</p>
          <ul className="text-xs text-slate-500 list-disc list-inside space-y-0.5">
            {phaseInfo?.conditions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* コンディション入力 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p className="text-sm font-bold text-slate-700 mb-4">今日のコンディション報告</p>

        <label className="text-xs text-slate-500 flex justify-between">
          <span>痛みの強さ（VAS）</span>
          <span className="font-bold text-blue-600">{vas}</span>
        </label>
        <input
          type="range"
          min={0}
          max={10}
          value={vas}
          onChange={(e) => setVas(Number(e.target.value))}
          className="w-full mt-2 accent-blue-600"
        />
        <div className="flex justify-between text-[10px] text-slate-400 mb-4">
          <span>0（痛みなし）</span>
          <span>10（最悪）</span>
        </div>

        <label className="text-xs text-slate-500">今日の気分</label>
        <div className="flex justify-between mt-2 mb-4">
          {MENTAL_FACES.map((face, i) => (
            <button
              key={i}
              onClick={() => setMental(i + 1)}
              className={`w-11 h-11 rounded-full text-xl flex items-center justify-center border-2 transition-colors ${
                mental === i + 1 ? "border-blue-500 bg-blue-50" : "border-transparent bg-slate-50"
              }`}
            >
              {face}
            </button>
          ))}
        </div>

        <label className="text-xs text-slate-500">本音・言い訳（自由記述）</label>
        <textarea
          value={honne}
          onChange={(e) => setHonne(e.target.value)}
          rows={3}
          placeholder="今日感じたことを正直に書いてください"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mt-1 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <button
          onClick={() => setSos((v) => !v)}
          className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold mb-3 border-2 transition-colors ${
            sos ? "border-red-500 bg-red-50 text-red-600" : "border-slate-200 text-slate-400"
          }`}
        >
          <AlertTriangle size={16} /> {sos ? "🆘 SOSを送信します" : "🆘 SOSを送る（緊急時）"}
        </button>

        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

        <button
          onClick={handleSubmitReport}
          disabled={sending}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 disabled:bg-slate-300"
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {sending ? "送信中..." : "指導者に送信する"}
        </button>
        {sent && (
          <p className="text-xs text-green-600 text-center mt-2">
            送信しました。指導者からの確認をお待ちください。
          </p>
        )}
      </div>

      {/* 面談予約 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5">
          <CalendarClock size={16} className="text-blue-600" />
          監督・トレーナーとの戦略ミーティング
        </p>
        <p className="text-xs text-slate-400 mb-3">受傷2週目の面談を目安に予約しましょう。</p>

        {bookedSlot ? (
          <div className="bg-blue-50 rounded-lg px-4 py-3 text-sm text-blue-700 font-bold">
            予約済み：{bookedSlot.datetime}
          </div>
        ) : (
          <div className="space-y-2">
            {availableSlots.length === 0 && (
              <p className="text-xs text-slate-400">現在予約可能な枠がありません。</p>
            )}
            {availableSlots.map((s) => (
              <button
                key={s.id}
                onClick={() => handleBookSlot(s.id)}
                className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50 text-sm"
              >
                <span className="text-slate-600">{s.datetime}</span>
                <span className="text-blue-600 font-bold text-xs">この枠で予約</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
