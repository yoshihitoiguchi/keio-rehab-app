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
  CalendarDays,
  ArrowRight,
  Timer,
  Flame,
  ShieldCheck,
  Trash2,
  LogOut,
  Loader2,
  Info,
  MessageCircle,
  KeyRound,
  UserRound,
  TrendingUp,
} from "lucide-react";

// ============================================================
// Supabase 接続設定（確定した本番の値）
// ============================================================
const SUPABASE_URL = "https://akvfrihatvfkrjzpxtcw.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrdmZyaWhhdHZma3JqenB4dGN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjk4NDEsImV4cCI6MjEwNDcwNTg0MX0.LUUpqkDo61LfV6vK5RSfYGyb7is93WrvQeikTiV1uIg";

// ---- Supabase REST(PostgREST) 薄いラッパー ----
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
const sbInsert = (table, body) => sb(table, { method: "POST", body: JSON.stringify(body) });
const sbUpdate = (table, id, body) =>
  sb(`${table}?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
const sbDelete = (table, id) =>
  sb(`${table}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", prefer: "return=minimal" });

// ---- DBの行(snake_case) <-> アプリ内部表現(camelCase) の変換 ----
function normalizeProtocol(row) {
  return { id: row.id, name: row.name, totalWeeks: row.total_weeks, phases: row.phases || [] };
}
function normalizeMessage(row) {
  return { id: row.id, sender: row.sender, content: row.content, createdAt: row.created_at };
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
    injuryDate: row.injury_date,
    completedAt: row.completed_at,
    reports: (row.reports || [])
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((r) => ({ date: r.date, vas: r.vas, mental: r.mental, honne: r.honne })),
    messages: (row.messages || [])
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(normalizeMessage),
  };
}
function normalizeSlot(row) {
  return { id: row.id, datetime: row.datetime, bookedBy: row.booked_by };
}

const MENTAL_FACES = ["😞", "😕", "😐", "🙂", "😄"];
const PLAYER_FIELDS = "*,reports(*),messages(*)";
const PLAYER_EMBED_ORDER = "&reports.order=created_at.asc&messages.order=created_at.asc";

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
  return Math.max(0, Math.round(perPhase * (5 - currentPhase + 1)));
}
function daysSince(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

// ==================================================================
export default function RehabApp() {
  const [mode, setMode] = useState("player"); // 'player' | 'coach' | 'coach-login'
  const [coachAuthed, setCoachAuthed] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);

  // 全モード共通・非機密の公開データ
  const [masterProtocols, setMasterProtocols] = useState([]);
  const [slots, setSlots] = useState([]);
  const [playerDirectory, setPlayerDirectory] = useState([]); // [{id, name}] のみ

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // 指導者モード専用：認証後にのみ取得する全選手データ
  const [coachPlayers, setCoachPlayers] = useState([]);
  const [coachLoading, setCoachLoading] = useState(false);

  // 選手モード専用：PIN認証後にのみ保持する「自分自身」のデータ
  const [myPlayer, setMyPlayer] = useState(null);

  const loadPublicData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [protocolRows, slotRows, dirRows] = await Promise.all([
        sbSelect("protocols", "?select=*&order=name.asc"),
        sbSelect("slots", "?select=*&order=datetime.asc"),
        sbSelect("player_directory", "?select=*&order=name.asc"),
      ]);
      setMasterProtocols(protocolRows.map(normalizeProtocol));
      setSlots(slotRows.map(normalizeSlot));
      setPlayerDirectory(dirRows);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPublicData();
  }, []);

  const loadCoachPlayers = async () => {
    setCoachLoading(true);
    try {
      const rows = await sbSelect(
        "players",
        `?select=${PLAYER_FIELDS}${PLAYER_EMBED_ORDER}&order=name.asc`
      );
      setCoachPlayers(rows.map(normalizePlayer));
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setCoachLoading(false);
    }
  };

  const handleSwitchMode = (target) => {
    if (target === "coach" && !coachAuthed) {
      setMode("coach-login");
      return;
    }
    setMode(target);
  };

  const handlePasswordSubmit = async () => {
    if (pwInput === "1234") {
      setCoachAuthed(true);
      setPwError(false);
      setPwInput("");
      setMode("coach");
      await loadCoachPlayers();
    } else {
      setPwError(true);
    }
  };

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
              <span className="text-xs text-red-300 max-w-[200px] truncate" title={loadError}>
                同期エラー
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
          <button onClick={loadPublicData} className="font-bold underline shrink-0 ml-3">
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
            coachPlayers={coachPlayers}
            setCoachPlayers={setCoachPlayers}
            coachLoading={coachLoading}
            slots={slots}
            setSlots={setSlots}
          />
        )}

        {!loading && mode === "player" && (
          <PlayerMode
            masterProtocols={masterProtocols}
            playerDirectory={playerDirectory}
            setPlayerDirectory={setPlayerDirectory}
            slots={slots}
            setSlots={setSlots}
            myPlayer={myPlayer}
            setMyPlayer={setMyPlayer}
          />
        )}
      </main>
    </div>
  );
}

// ==================================================================
// パスワードゲート（指導者モード）
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
// チャットパネル（選手⇔指導者 共通コンポーネント）
// ==================================================================
function ChatPanel({ messages, myRole, title, onSend }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await onSend(text.trim());
      setText("");
    } catch (err) {
      alert(`送信に失敗しました: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
        <MessageCircle size={16} className="text-blue-600" /> {title}
      </p>
      <div className="max-h-64 overflow-y-auto space-y-2 mb-3 pr-1">
        {messages.length === 0 && (
          <p className="text-xs text-slate-400">まだメッセージはありません。</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender === myRole ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                m.sender === myRole ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="メッセージを入力"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleSend}
          disabled={sending}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:bg-slate-300"
        >
          送信
        </button>
      </div>
    </div>
  );
}

// ==================================================================
// 指導者モード
// ==================================================================
function CoachDashboard({
  masterProtocols,
  setMasterProtocols,
  coachPlayers,
  setCoachPlayers,
  coachLoading,
  slots,
  setSlots,
}) {
  const [subTab, setSubTab] = useState("players");

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
        <ProtocolManagement masterProtocols={masterProtocols} setMasterProtocols={setMasterProtocols} />
      )}
      {subTab === "players" &&
        (coachLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <Loader2 className="animate-spin" size={20} /> 選手データを読み込み中...
          </div>
        ) : (
          <PlayerManagement
            masterProtocols={masterProtocols}
            coachPlayers={coachPlayers}
            setCoachPlayers={setCoachPlayers}
            slots={slots}
            setSlots={setSlots}
          />
        ))}
    </div>
  );
}

// ---------- ① プロトコル管理(CMS) ----------
function ProtocolManagement({ masterProtocols, setMasterProtocols }) {
  const blankPhases = () =>
    Array.from({ length: 5 }, (_, i) => ({ title: `フェーズ${i + 1}`, conditionsText: "" }));

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

// ---------- 面談枠：年月日 + 時刻(30分単位) のプルダウン作成UI ----------
function SlotCreator({ onCreate }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [day, setDay] = useState(now.getDate());
  const [hour, setHour] = useState(10);
  const [minute, setMinute] = useState(0);

  const daysInMonth = new Date(year, month, 0).getDate();
  useEffect(() => {
    if (day > daysInMonth) setDay(daysInMonth);
  }, [daysInMonth, day]);

  const handleCreate = () => {
    const datetime = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
      2,
      "0"
    )} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    onCreate(datetime);
  };

  return (
    <div className="space-y-2 mb-3">
      <div className="grid grid-cols-3 gap-2">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white"
        >
          {[now.getFullYear(), now.getFullYear() + 1].map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m}月
            </option>
          ))}
        </select>
        <select
          value={day}
          onChange={(e) => setDay(Number(e.target.value))}
          className="border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white"
        >
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}日
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={hour}
          onChange={(e) => setHour(Number(e.target.value))}
          className="border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white"
        >
          {Array.from({ length: 24 }, (_, i) => i).map((h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, "0")}時
            </option>
          ))}
        </select>
        <select
          value={minute}
          onChange={(e) => setMinute(Number(e.target.value))}
          className="border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white"
        >
          {[0, 30].map((m) => (
            <option key={m} value={m}>
              {String(m).padStart(2, "0")}分
            </option>
          ))}
        </select>
      </div>
      <button
        onClick={handleCreate}
        className="w-full py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700"
      >
        この日時で枠を追加
      </button>
    </div>
  );
}

// ---------- ② 選手管理（2ペイン） ----------
function PlayerManagement({ masterProtocols, coachPlayers, setCoachPlayers, slots, setSlots }) {
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if ((!selectedId || !coachPlayers.some((p) => p.id === selectedId)) && coachPlayers.length > 0) {
      setSelectedId(coachPlayers[0].id);
    }
  }, [coachPlayers, selectedId]);

  // 要件⑤：フェーズが小さい選手から昇順で表示
  const sortedPlayers = [...coachPlayers].sort((a, b) => a.currentPhase - b.currentPhase);
  const selectedPlayer = coachPlayers.find((p) => p.id === selectedId) || null;
  const protocolOf = (p) => masterProtocols.find((mp) => mp.id === p.protocolId);

  const toggleChecklist = async (playerId, idx) => {
    const player = coachPlayers.find((p) => p.id === playerId);
    if (!player) return;
    const nextChecklist = [...player.checklist];
    nextChecklist[idx] = !nextChecklist[idx];
    setCoachPlayers((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, checklist: nextChecklist } : p))
    );
    try {
      await sbUpdate("players", playerId, { checklist: nextChecklist });
    } catch (err) {
      setError(err.message);
    }
  };

  const advancePhase = async (playerId) => {
    const player = coachPlayers.find((p) => p.id === playerId);
    if (!player) return;
    const protocol = masterProtocols.find((mp) => mp.id === player.protocolId);
    const nextPhase = Math.min(5, player.currentPhase + 1);
    const nextConditionsCount = protocol?.phases[nextPhase - 1]?.conditions.length ?? 0;
    const nextChecklist = Array(nextConditionsCount).fill(false);
    setCoachPlayers((prev) =>
      prev.map((p) =>
        p.id === playerId ? { ...p, currentPhase: nextPhase, checklist: nextChecklist, sos: false } : p
      )
    );
    try {
      await sbUpdate("players", playerId, {
        current_phase: nextPhase,
        checklist: nextChecklist,
        sos: false,
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const markCompleted = async (playerId) => {
    const now = new Date().toISOString();
    setCoachPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, completedAt: now } : p)));
    try {
      await sbUpdate("players", playerId, { completed_at: now });
    } catch (err) {
      setError(err.message);
    }
  };

  const addSlot = async (datetimeStr) => {
    const payload = { id: `slot-${Date.now()}`, datetime: datetimeStr, booked_by: null };
    try {
      const [inserted] = await sbInsert("slots", payload);
      setSlots((prev) => [...prev, normalizeSlot(inserted)]);
    } catch (err) {
      setError(err.message);
    }
  };

  // 要件⑥：選手の完全削除
  const deletePlayer = async (playerId, playerName) => {
    const confirmed = window.confirm(
      `本当に「${playerName}」選手のデータを完全に削除しますか？\nこの操作は取り消せません。`
    );
    if (!confirmed) return;
    try {
      await sbDelete("players", playerId);
      setCoachPlayers((prev) => prev.filter((p) => p.id !== playerId));
      if (selectedId === playerId) setSelectedId(null);
    } catch (err) {
      setError(err.message);
    }
  };

  // 要件⑦：チャットメッセージ送信（指導者側）
  const sendCoachMessage = async (playerId, content) => {
    const [inserted] = await sbInsert("messages", { player_id: playerId, sender: "coach", content });
    setCoachPlayers((prev) =>
      prev.map((p) =>
        p.id === playerId ? { ...p, messages: [...p.messages, normalizeMessage(inserted)] } : p
      )
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      {/* 左ペイン：選手リスト */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden h-fit">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <p className="text-sm font-bold text-slate-700">
            選手一覧 ({coachPlayers.length})・Phase昇順
          </p>
        </div>
        <ul className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
          {sortedPlayers.map((p) => {
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
                      <p className={`text-sm font-semibold ${alert ? "text-red-600" : "text-slate-800"}`}>
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
          {coachPlayers.length === 0 && (
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
            toggleChecklist={toggleChecklist}
            advancePhase={advancePhase}
            markCompleted={markCompleted}
            addSlot={addSlot}
            onDelete={() => deletePlayer(selectedPlayer.id, selectedPlayer.name)}
            onSendMessage={(content) => sendCoachMessage(selectedPlayer.id, content)}
            setCoachPlayers={setCoachPlayers}
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
  toggleChecklist,
  advancePhase,
  markCompleted,
  addSlot,
  onDelete,
  onSendMessage,
  setCoachPlayers,
}) {
  const report = latestReport(player);
  const phaseInfo = protocol?.phases[player.currentPhase - 1];
  const allChecked = player.checklist.length > 0 && player.checklist.every(Boolean);
  const bookedSlot = slots.find((s) => s.id === player.bookedSlotId);
  const [avg, setAvg] = useState(null);

  // チャットのポーリング更新（5秒ごと）
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const rows = await sbSelect(
          "messages",
          `?player_id=eq.${encodeURIComponent(player.id)}&order=created_at.asc`
        );
        const normalized = rows.map(normalizeMessage);
        setCoachPlayers((prev) =>
          prev.map((p) => (p.id === player.id ? { ...p, messages: normalized } : p))
        );
      } catch {
        // ポーリング失敗は無視（次回リトライ）
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [player.id, setCoachPlayers]);

  useEffect(() => {
    let active = true;
    if (protocol) {
      sbSelect("protocol_avg_recovery", `?protocol_id=eq.${encodeURIComponent(protocol.id)}&select=*`)
        .then((rows) => {
          if (active) setAvg(rows[0] || null);
        })
        .catch(() => {});
    } else {
      setAvg(null);
    }
    return () => {
      active = false;
    };
  }, [protocol?.id]);

  return (
    <div className="space-y-5">
      {/* ヘッダー */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-lg text-slate-800">{player.name}</h3>
          <p className="text-sm text-slate-400">
            {protocol?.name ?? "未設定"} ・ 現在 Phase {player.currentPhase}/5：{phaseInfo?.title}
          </p>
          {player.injuryDate && (
            <p className="text-xs text-slate-400 mt-1">
              受傷日：{player.injuryDate}（受傷から{daysSince(player.injuryDate)}日経過）
              {avg && avg.sample_size > 0 && (
                <span className="text-blue-500">
                  {" "}
                  ・ 過去{avg.sample_size}人の平均完遂日数：{avg.avg_days}日
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isAlert(player) && (
            <span className="flex items-center gap-1 bg-red-100 text-red-600 text-xs font-bold px-3 py-1.5 rounded-full">
              <AlertTriangle size={14} /> 要確認
            </span>
          )}
          <button
            onClick={onDelete}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 border border-slate-200 hover:border-red-300 rounded-full px-3 py-1.5"
            title="選手をデータベースから完全に削除する"
          >
            <Trash2 size={14} /> 削除
          </button>
        </div>
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
                  report.vas >= 7 ? "text-red-500" : report.vas >= 4 ? "text-orange-500" : "text-green-600"
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

        {player.currentPhase < 5 && (
          <button
            onClick={() => advancePhase(player.id)}
            disabled={!allChecked}
            className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            次のフェーズへ進める <ArrowRight size={16} />
          </button>
        )}

        {player.currentPhase >= 5 && !player.completedAt && (
          <button
            onClick={() => markCompleted(player.id)}
            disabled={!allChecked}
            className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-green-600 text-white font-bold text-sm hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            <ShieldCheck size={16} /> 完全復帰として記録する
          </button>
        )}

        {player.completedAt && (
          <div className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-green-50 text-green-700 font-bold text-sm">
            <ShieldCheck size={16} /> 完全復帰 記録済み（
            {new Date(player.completedAt).toLocaleDateString("ja-JP")}）
          </div>
        )}
      </div>

      {/* チャット */}
      <ChatPanel
        messages={player.messages}
        myRole="coach"
        title={`${player.name} さんとのチャット`}
        onSend={onSendMessage}
      />

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
        <SlotCreator onCreate={addSlot} />
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
// 選手モード（PIN認証つき）
// ==================================================================
function PlayerMode({
  masterProtocols,
  playerDirectory,
  setPlayerDirectory,
  slots,
  setSlots,
  myPlayer,
  setMyPlayer,
}) {
  if (!myPlayer) {
    return (
      <PlayerLogin
        masterProtocols={masterProtocols}
        playerDirectory={playerDirectory}
        setPlayerDirectory={setPlayerDirectory}
        setMyPlayer={setMyPlayer}
      />
    );
  }

  return (
    <PlayerPersonalDashboard
      player={myPlayer}
      protocol={masterProtocols.find((mp) => mp.id === myPlayer.protocolId)}
      setMyPlayer={setMyPlayer}
      slots={slots}
      setSlots={setSlots}
      onLogout={() => setMyPlayer(null)}
    />
  );
}

// ---------- 選手ログイン：名前選択 → PIN入力 ----------
function PlayerLogin({ masterProtocols, playerDirectory, setPlayerDirectory, setMyPlayer }) {
  const [screen, setScreen] = useState("select"); // 'select' | 'pin' | 'register'
  const [selectedDir, setSelectedDir] = useState(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);

  const handleSelectName = (dir) => {
    setSelectedDir(dir);
    setScreen("pin");
    setPin("");
    setError(null);
  };

  const handlePinSubmit = async () => {
    if (pin.length !== 4) {
      setError("4桁の暗証番号を入力してください");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const pinRows = await sbSelect(
        "players",
        `?id=eq.${encodeURIComponent(selectedDir.id)}&select=pin`
      );
      if (!pinRows[0] || pinRows[0].pin !== pin) {
        setError("暗証番号が違います");
        setChecking(false);
        return;
      }
      const fullRows = await sbSelect(
        "players",
        `?id=eq.${encodeURIComponent(selectedDir.id)}&select=${PLAYER_FIELDS}${PLAYER_EMBED_ORDER}`
      );
      setMyPlayer(normalizePlayer(fullRows[0]));
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  };

  if (screen === "register") {
    return (
      <PlayerRegisterForm
        masterProtocols={masterProtocols}
        setPlayerDirectory={setPlayerDirectory}
        setMyPlayer={setMyPlayer}
        onCancel={() => setScreen("select")}
      />
    );
  }

  if (screen === "pin") {
    return (
      <div className="max-w-sm mx-auto mt-16 bg-white rounded-2xl shadow-lg p-8 border border-slate-200">
        <div className="flex flex-col items-center gap-3 mb-6">
          <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center">
            <KeyRound className="text-blue-600" size={26} />
          </div>
          <h2 className="text-lg font-bold text-slate-800">{selectedDir.name} さん</h2>
          <p className="text-sm text-slate-500 text-center">4桁の暗証番号を入力してください</p>
        </div>
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          onKeyDown={(e) => e.key === "Enter" && handlePinSubmit()}
          placeholder="••••"
          className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-center text-2xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
        {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}
        <div className="flex gap-2 mt-5">
          <button
            onClick={() => setScreen("select")}
            className="flex-1 py-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium"
          >
            戻る
          </button>
          <button
            onClick={handlePinSubmit}
            disabled={checking}
            className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium disabled:bg-slate-300 flex items-center justify-center gap-2"
          >
            {checking && <Loader2 size={14} className="animate-spin" />}
            ログイン
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto mt-10 bg-white rounded-2xl shadow-lg p-8 border border-slate-200">
      <div className="flex items-center gap-2 mb-1">
        <UserRound className="text-blue-600" size={22} />
        <h2 className="font-bold text-lg text-slate-800">あなたの名前を選んでください</h2>
      </div>
      <p className="text-xs text-slate-400 mb-4">他の選手のデータは表示されません。</p>
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {playerDirectory.map((d) => (
          <button
            key={d.id}
            onClick={() => handleSelectName(d)}
            className="w-full text-left px-4 py-3 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50 text-sm font-medium text-slate-700"
          >
            {d.name}
          </button>
        ))}
        {playerDirectory.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-4">まだ選手が登録されていません。</p>
        )}
      </div>
      <button
        onClick={() => setScreen("register")}
        className="w-full mt-5 py-2.5 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700"
      >
        はじめて使う方はこちら（新規登録）
      </button>
    </div>
  );
}

// ---------- 選手 新規登録 ----------
function PlayerRegisterForm({ masterProtocols, setPlayerDirectory, setMyPlayer, onCancel }) {
  const [name, setName] = useState("");
  const [protocolId, setProtocolId] = useState(masterProtocols[0]?.id ?? "");
  const [injuryDate, setInjuryDate] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!protocolId && masterProtocols[0]) setProtocolId(masterProtocols[0].id);
  }, [masterProtocols, protocolId]);

  const handleRegister = async () => {
    if (!name.trim() || !protocolId) return;
    if (pin.length !== 4) {
      setError("暗証番号は4桁の数字で設定してください");
      return;
    }
    if (pin !== pinConfirm) {
      setError("暗証番号（確認）が一致しません");
      return;
    }
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
      injury_date: injuryDate || null,
      pin,
    };
    setSaving(true);
    setError(null);
    try {
      const [inserted] = await sbInsert("players", payload);
      setPlayerDirectory((prev) => [...prev, { id: inserted.id, name: inserted.name }]);
      setMyPlayer(normalizePlayer({ ...inserted, reports: [], messages: [] }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-8">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-5">
          <Activity className="text-blue-600" size={22} />
          <h2 className="font-bold text-lg text-slate-800">新規選手登録</h2>
        </div>

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
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mt-1 mb-4 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {masterProtocols.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {masterProtocols.length === 0 && <option value="">プロトコル未登録</option>}
        </select>

        <label className="text-xs text-slate-500">受傷日（あとから登録・変更も可能です）</label>
        <input
          type="date"
          value={injuryDate}
          onChange={(e) => setInjuryDate(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mt-1 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <label className="text-xs text-slate-500">暗証番号（4桁の数字）</label>
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="••••"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mt-1 mb-3 tracking-[0.4em] text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <label className="text-xs text-slate-500">暗証番号（確認）</label>
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pinConfirm}
          onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="••••"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mt-1 mb-5 tracking-[0.4em] text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium"
          >
            戻る
          </button>
          <button
            onClick={handleRegister}
            disabled={!name.trim() || !protocolId || saving}
            className="flex-1 py-3 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 disabled:bg-slate-300 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "登録中..." : "登録する"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- 使い方ガイド ----------
function UsageGuide() {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-sm font-bold text-blue-700"
      >
        <span className="flex items-center gap-1.5">
          <Info size={16} /> このアプリの使い方
        </span>
        <span className="text-xs font-normal">{open ? "閉じる" : "開く"}</span>
      </button>
      {open && (
        <ul className="mt-3 text-xs text-blue-700 space-y-1.5 list-disc list-inside">
          <li>「今日のコンディション報告」で毎日、痛みの強さ・気分・本音を入力して送信してください。</li>
          <li>
            強い不安や痛みがあるときは「🆘SOSを送る」をオンにしてから送信すると、指導者に赤いアラートで通知されます。
          </li>
          <li>「面談予約」から空いている枠をタップするだけで、監督・トレーナーとの面談を予約できます。</li>
          <li>「指導者とのチャット」から直接メッセージのやり取りができます。</li>
          <li>「受傷日」を登録すると、同じ怪我をした過去の選手たちの平均復帰期間が目安として表示されます。</li>
        </ul>
      )}
    </div>
  );
}

// ---------- 受傷日 登録 & 平均復帰期間 ----------
function InjuryDateCard({ player, protocol, setMyPlayer }) {
  const [date, setDate] = useState(player.injuryDate || "");
  const [saving, setSaving] = useState(false);
  const [avg, setAvg] = useState(null);

  useEffect(() => {
    let active = true;
    if (protocol) {
      sbSelect("protocol_avg_recovery", `?protocol_id=eq.${encodeURIComponent(protocol.id)}&select=*`)
        .then((rows) => {
          if (active) setAvg(rows[0] || null);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [protocol?.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await sbUpdate("players", player.id, { injury_date: date || null });
      setMyPlayer((prev) => ({ ...prev, injuryDate: date || null }));
    } catch (err) {
      alert(`保存に失敗しました: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const elapsed = daysSince(date);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
        <CalendarDays size={16} className="text-blue-600" /> 受傷日
      </p>
      <div className="flex gap-2 mb-2">
        <input
          type="date"
          value={date || ""}
          onChange={(e) => setDate(e.target.value)}
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:bg-slate-300"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
      {elapsed !== null && <p className="text-xs text-slate-500">受傷から {elapsed} 日経過しています。</p>}
      {avg && avg.sample_size > 0 && (
        <p className="text-xs text-blue-600 mt-2 flex items-start gap-1">
          <TrendingUp size={14} className="shrink-0 mt-0.5" />
          過去に同じ怪我を完遂した{avg.sample_size}人の平均は、受傷から約
          {Math.round((avg.avg_days / 7) * 10) / 10}週間（{avg.avg_days}日）でした。目安にしてください。
        </p>
      )}
    </div>
  );
}

function PlayerPersonalDashboard({ player, protocol, setMyPlayer, slots, setSlots, onLogout }) {
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

  // チャットのポーリング更新（5秒ごと）
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const rows = await sbSelect(
          "messages",
          `?player_id=eq.${encodeURIComponent(player.id)}&order=created_at.asc`
        );
        const normalized = rows.map(normalizeMessage);
        setMyPlayer((prev) => (prev ? { ...prev, messages: normalized } : prev));
      } catch {
        // ポーリング失敗は無視
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [player.id, setMyPlayer]);

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
      setMyPlayer((prev) => ({ ...prev, sos, reports: [...prev.reports, newReport] }));
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
      setMyPlayer((prev) => ({ ...prev, bookedSlotId: slotId }));
    } catch (err) {
      setError(err.message);
    }
  };

  const sendPlayerMessage = async (content) => {
    const [inserted] = await sbInsert("messages", { player_id: player.id, sender: "player", content });
    setMyPlayer((prev) => ({ ...prev, messages: [...prev.messages, normalizeMessage(inserted)] }));
  };

  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">おかえりなさい</p>
          <h2 className="font-bold text-xl text-slate-800">{player.name} さん</h2>
        </div>
        <button
          onClick={onLogout}
          className="text-xs text-slate-400 flex items-center gap-1 hover:text-slate-600"
        >
          <LogOut size={14} /> ログアウト
        </button>
      </div>

      <UsageGuide />

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
              className={`text-[10px] font-bold ${n <= player.currentPhase ? "text-blue-600" : "text-slate-300"}`}
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

      <InjuryDateCard player={player} protocol={protocol} setMyPlayer={setMyPlayer} />

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

      {/* チャット */}
      <ChatPanel messages={player.messages} myRole="player" title="指導者とのチャット" onSend={sendPlayerMessage} />

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
