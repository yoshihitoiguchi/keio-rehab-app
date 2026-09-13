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
  Settings,
  History,
  CalendarRange,
  Video,
  Youtube,
  Building2,
  Trophy,
  Link as LinkIcon,
  Syringe,
  Printer,
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
// on_conflict列（カンマ区切り可）でINSERT/UPDATEを自動判定するupsert
const sbUpsert = (table, body, onConflictColumns) =>
  sb(`${table}?on_conflict=${encodeURIComponent(onConflictColumns)}`, {
    method: "POST",
    body: JSON.stringify(body),
    prefer: "resolution=merge-duplicates,return=representation",
  });

// ---- パスワードのハッシュ化（SHA-256、平文は保存・送信しない） ----
async function sha256Hex(text) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error(
      "このページはHTTPS接続ではないため、パスワードのハッシュ化機能（Web Crypto API）が利用できません。"
    );
  }
  const normalized = String(text).trim();
  const enc = new TextEncoder().encode(normalized);
  const digest = await window.crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toLowerCase();
}

// 組織スコープのapp_settingsから指定キーの値を1件取得（無ければnull）
async function fetchSetting(orgId, key) {
  const rows = await sbSelect(
    "app_settings",
    `?org_id=eq.${encodeURIComponent(orgId)}&key=eq.${encodeURIComponent(key)}&select=value`
  );
  if (!rows || rows.length === 0) return null;
  const value = rows[0].value;
  return value === null || value === undefined ? null : String(value).trim().toLowerCase();
}

// ---- DBの行(snake_case) <-> アプリ内部表現(camelCase) の変換 ----
function normalizeProtocol(row) {
  return {
    id: row.id,
    name: row.name,
    totalWeeks: row.total_weeks,
    phases: row.phases || [],
    videoUrl: row.video_url || null,
  };
}
function normalizeMessage(row) {
  return {
    id: row.id,
    sender: row.sender,
    staffRole: row.staff_role,
    isRead: row.is_read,
    content: row.content,
    createdAt: row.created_at,
  };
}
function normalizeTreatment(row) {
  return {
    id: row.id,
    type: row.type,
    note: row.note,
    treatedDate: row.treated_date,
    createdAt: row.created_at,
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
    injuryDate: row.injury_date,
    completedAt: row.completed_at,
    reports: (row.reports || [])
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((r) => ({
        date: r.date,
        vas: r.vas,
        mental: r.mental,
        honne: r.honne,
        fatigue: r.fatigue ?? null,
        sleepQuality: r.sleep_quality ?? null,
      })),
    messages: (row.messages || [])
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(normalizeMessage),
    treatments: (row.treatments || [])
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(normalizeTreatment),
  };
}
function normalizeSlot(row) {
  return {
    id: row.id,
    datetime: row.datetime,
    bookedBy: row.booked_by,
    matchedRoles: row.matched_roles || [],
    zoomUrl: row.zoom_url || null,
  };
}

const MENTAL_FACES = ["😞", "😕", "😐", "🙂", "😄"];
const PLAYER_FIELDS = "*,reports(*),messages(*),treatments(*)";
const PLAYER_EMBED_ORDER =
  "&reports.order=created_at.asc&messages.order=created_at.asc&treatments.order=created_at.asc";

const TREATMENT_TYPES = [
  { value: "shockwave", label: "体外衝撃波" },
  { value: "lipus", label: "超音波(LIPUS)" },
  { value: "prp", label: "PRP療法" },
  { value: "hydrorelease", label: "エコー下ハイドロリリース" },
  { value: "injection", label: "注射(ステロイド/ヒアルロン酸等)" },
  { value: "insole", label: "インソール作成" },
  { value: "other", label: "その他" },
];
const TREATMENT_LABELS = Object.fromEntries(TREATMENT_TYPES.map((t) => [t.value, t.label]));


const SCHEDULING_ROLES = [
  { value: "coach", label: "コーチ" },
  { value: "trainer", label: "トレーナー" },
  { value: "doctor", label: "ドクター" },
];
const SCHEDULING_ROLE_LABELS = { coach: "コーチ", trainer: "トレーナー", doctor: "ドクター" };

const CHAT_STAFF_ROLES = [
  { value: "coach", label: "コーチ" },
  { value: "student_trainer", label: "学生トレーナー" },
  { value: "trainer", label: "トレーナー" },
  { value: "doctor", label: "医師" },
];
const CHAT_STAFF_ROLE_LABELS = {
  coach: "コーチ",
  student_trainer: "学生トレーナー",
  trainer: "トレーナー",
  doctor: "医師",
};

// フェーズごとの色分け（赤→オレンジ→黄→黄緑→青）
const PHASE_TEXT_COLORS = {
  1: "text-red-600",
  2: "text-orange-500",
  3: "text-amber-500",
  4: "text-lime-600",
  5: "text-blue-600",
};
const PHASE_BG_COLORS = {
  1: "bg-red-500",
  2: "bg-orange-500",
  3: "bg-amber-500",
  4: "bg-lime-500",
  5: "bg-blue-500",
};

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
function parseDatetime(str) {
  return new Date(str.replace(" ", "T"));
}
function diffDaysBetween(dateStr, datetimeStr) {
  return Math.floor((parseDatetime(datetimeStr) - new Date(dateStr)) / 86400000);
}
function meetingAlertLevel(player, slots) {
  if (!player.injuryDate) return null;
  const held = slots.some((s) => s.bookedBy === player.id && parseDatetime(s.datetime) <= new Date());
  if (held) return null;
  const elapsed = daysSince(player.injuryDate);
  if (elapsed >= 21) return "red";
  if (elapsed >= 14) return "yellow";
  return null;
}
// 要件⑤：同じプロトコルを完遂した「過去の全選手」から、受傷日→完遂日の平均日数を
// 実データ（injury_date, completed_at）のみを用いて厳密に計算する（モックなし）。
// coachPlayersは指導者が既に読み込んでいる同一組織の全選手データなのでJS側で直接計算できる。
function computeAvgRecoveryFromPlayers(players, protocolId) {
  const completed = players.filter(
    (p) => p.protocolId === protocolId && p.injuryDate && p.completedAt
  );
  if (completed.length === 0) return null;
  const totalDays = completed.reduce((sum, p) => {
    const injury = new Date(p.injuryDate);
    const done = new Date(p.completedAt);
    const days = Math.round((done - injury) / 86400000);
    return sum + days;
  }, 0);
  return {
    avgDays: Math.round((totalDays / completed.length) * 10) / 10,
    sampleSize: completed.length,
  };
}
function getYouTubeEmbedUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    let videoId = null;
    if (u.hostname.includes("youtu.be")) {
      videoId = u.pathname.slice(1);
    } else if (u.hostname.includes("youtube.com")) {
      videoId = u.searchParams.get("v");
      if (!videoId && u.pathname.startsWith("/embed/")) videoId = u.pathname.split("/")[2];
    }
    return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
  } catch {
    return null;
  }
}

// ==================================================================
export default function RehabApp() {
  const [org, setOrg] = useState(null); // { id, name } | null

  const [mode, setMode] = useState("player"); // 'player' | 'coach' | 'coach-login'
  const [coachAuthed, setCoachAuthed] = useState(false);

  const [masterProtocols, setMasterProtocols] = useState([]);
  const [slots, setSlots] = useState([]);
  const [playerDirectory, setPlayerDirectory] = useState([]);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const [coachPlayers, setCoachPlayers] = useState([]);
  const [coachLoading, setCoachLoading] = useState(false);

  const [myPlayer, setMyPlayer] = useState(null);

  const loadPublicData = async (orgId) => {
    setLoading(true);
    setLoadError(null);
    try {
      const [protocolRows, slotRows, dirRows] = await Promise.all([
        sbSelect("protocols", `?org_id=eq.${encodeURIComponent(orgId)}&select=*&order=name.asc`),
        sbSelect("slots", `?org_id=eq.${encodeURIComponent(orgId)}&select=*&order=datetime.asc`),
        sbSelect(
          "player_directory",
          `?org_id=eq.${encodeURIComponent(orgId)}&select=id,name&order=name.asc`
        ),
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
    if (org) loadPublicData(org.id);
  }, [org?.id]);

  const loadCoachPlayers = async () => {
    if (!org) return;
    setCoachLoading(true);
    try {
      const rows = await sbSelect(
        "players",
        `?org_id=eq.${encodeURIComponent(org.id)}&select=${PLAYER_FIELDS}${PLAYER_EMBED_ORDER}&order=name.asc`
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

  const handleCoachAuthed = async () => {
    setCoachAuthed(true);
    setMode("coach");
    await loadCoachPlayers();
  };

  const handleSwitchOrg = () => {
    setOrg(null);
    setMode("player");
    setCoachAuthed(false);
    setCoachPlayers([]);
    setMyPlayer(null);
    setMasterProtocols([]);
    setSlots([]);
    setPlayerDirectory([]);
  };

  if (!org) {
    return <OrgLogin onAuthed={setOrg} />;
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col print:bg-white print:block">
      <header className="bg-slate-900 text-white sticky top-0 z-20 shadow-md print:hidden">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Flame className="text-orange-400" size={22} />
            <span className="font-bold tracking-tight text-lg">
              RE:SPRINT <span className="text-slate-400 font-normal text-sm">Rehab Progress</span>
            </span>
            <span className="hidden sm:flex items-center gap-1 ml-2 text-xs text-slate-400 border-l border-slate-700 pl-3">
              <Building2 size={12} /> {org.name}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {loadError && (
              <span className="text-xs text-red-300 max-w-[160px] truncate" title={loadError}>
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
            <button
              onClick={handleSwitchOrg}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
              title="別の組織に切り替える"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </header>

      {loadError && (
        <div className="bg-red-50 border-b border-red-200 text-red-600 text-xs px-4 py-2 flex items-center justify-between print:hidden">
          <span>データの取得に失敗しました: {loadError}</span>
          <button onClick={() => loadPublicData(org.id)} className="font-bold underline shrink-0 ml-3">
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
          <PasswordGate orgId={org.id} onAuthed={handleCoachAuthed} onCancel={() => setMode("player")} />
        )}

        {!loading && mode === "coach" && coachAuthed && (
          <CoachDashboard
            orgId={org.id}
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
            orgId={org.id}
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
// 組織（テナント）ログイン
// ==================================================================
function OrgLogin({ onAuthed }) {
  const [orgCode, setOrgCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [debugInfo, setDebugInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleLogin = async () => {
    setError(null);
    setDebugInfo(null);
    if (!orgCode.trim()) {
      setError("組織ID（組織コード）を入力してください。");
      return;
    }
    setBusy(true);
    try {
      const rows = await sbSelect(
        "organizations",
        `?id=eq.${encodeURIComponent(orgCode.trim())}&select=id,name,password_hash`
      );
      if (!rows || rows.length === 0) {
        setError("その組織IDは見つかりませんでした。");
        setBusy(false);
        return;
      }
      const row = rows[0];
      const storedHash = row.password_hash ? String(row.password_hash).trim().toLowerCase() : null;
      const inputHash = await sha256Hex(password);
      if (!storedHash) {
        setError("この組織にはパスワードが設定されていません。管理者にご確認ください。");
        setBusy(false);
        return;
      }
      if (storedHash !== inputHash) {
        setError("パスワードが違います。下記のハッシュ値を比較してください。");
        setDebugInfo({ inputHash, storedHash });
        setBusy(false);
        return;
      }
      onAuthed({ id: row.id, name: row.name });
    } catch (err) {
      setError(`ログインに失敗しました: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg p-8 border border-slate-200">
        <div className="flex flex-col items-center gap-3 mb-6">
          <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center">
            <Building2 className="text-blue-600" size={26} />
          </div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-1.5">
            <Flame className="text-orange-400" size={18} /> RE:SPRINT
          </h2>
          <p className="text-sm text-slate-500 text-center">
            所属する組織のIDとパスワードを入力してください。
          </p>
        </div>
        <label className="text-xs text-slate-500">組織ID（組織コード）</label>
        <input
          value={orgCode}
          onChange={(e) => setOrgCode(e.target.value)}
          placeholder="例：default"
          className="w-full border border-slate-300 rounded-lg px-4 py-2.5 mt-1 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
        <label className="text-xs text-slate-500">パスワード</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          placeholder="組織パスワード"
          className="w-full border border-slate-300 rounded-lg px-4 py-2.5 mt-1 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {error && <p className="text-red-500 text-sm mb-2 text-center">{error}</p>}
        {debugInfo && (
          <div className="mb-3 bg-slate-50 border border-slate-200 rounded-lg p-3 text-[10px] font-mono text-slate-500 space-y-1">
            <p className="break-all">
              入力ハッシュ: <span className="text-slate-700">{debugInfo.inputHash}</span>
            </p>
            <p className="break-all">
              DBハッシュ: <span className="text-slate-700">{debugInfo.storedHash}</span>
            </p>
          </div>
        )}
        <button
          onClick={handleLogin}
          disabled={busy}
          className="w-full py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium disabled:bg-slate-300 flex items-center justify-center gap-2"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          ログイン
        </button>
        <p className="text-xs text-slate-400 text-center mt-4">
          初めての場合は組織ID「default」・初期パスワード「1234」でログインできます。
        </p>
      </div>
    </div>
  );
}

// ==================================================================
// パスワードゲート（指導者モード・組織スコープ）
// ==================================================================
function PasswordGate({ orgId, onAuthed, onCancel }) {
  const [phase, setPhase] = useState("checking"); // 'checking' | 'setup' | 'login'
  const [pwInput, setPwInput] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [error, setError] = useState(null);
  const [debugInfo, setDebugInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  const checkExistingPassword = async () => {
    setPhase("checking");
    setError(null);
    try {
      const hash = await fetchSetting(orgId, "coach_password_hash");
      setPhase(hash ? "login" : "setup");
    } catch (err) {
      setError(`設定の確認に失敗しました（${err.message}）。`);
      setPhase("login");
    }
  };

  useEffect(() => {
    checkExistingPassword();
  }, [orgId]);

  const handleSetup = async () => {
    setError(null);
    setDebugInfo(null);
    if (pwInput.trim().length < 4) {
      setError("4文字以上のパスワードを設定してください。");
      return;
    }
    if (pwInput !== pwConfirm) {
      setError("確認用パスワードが一致しません。");
      return;
    }
    setBusy(true);
    try {
      const hash = await sha256Hex(pwInput);
      await sbUpsert("app_settings", { org_id: orgId, key: "coach_password_hash", value: hash }, "org_id,key");
      onAuthed();
    } catch (err) {
      setError(`パスワードの保存に失敗しました: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async () => {
    setError(null);
    setDebugInfo(null);
    setBusy(true);
    try {
      let storedHash;
      try {
        storedHash = await fetchSetting(orgId, "coach_password_hash");
      } catch (fetchErr) {
        setError(`データベースからハッシュ値を取得できませんでした（${fetchErr.message}）`);
        setBusy(false);
        return;
      }

      const inputHash = await sha256Hex(pwInput);

      if (!storedHash) {
        setError("データベースからハッシュ値を取得できませんでした（app_settingsに行が存在しません）。");
        setDebugInfo({ inputHash, storedHash: "(該当行なし)" });
        setBusy(false);
        return;
      }

      if (storedHash === inputHash) {
        setPwInput("");
        setDebugInfo(null);
        onAuthed();
      } else {
        setError("パスワードが一致しません。下記のハッシュ値を比較してください。");
        setDebugInfo({ inputHash, storedHash });
      }
    } catch (err) {
      setError(`認証中にエラーが発生しました: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const DebugBox = () =>
    debugInfo && (
      <div className="mt-3 bg-slate-50 border border-slate-200 rounded-lg p-3 text-[10px] font-mono text-slate-500 space-y-1">
        <p className="break-all">
          入力ハッシュ: <span className="text-slate-700">{debugInfo.inputHash}</span>
        </p>
        <p className="break-all">
          DBハッシュ: <span className="text-slate-700">{debugInfo.storedHash}</span>
        </p>
      </div>
    );

  if (phase === "checking") {
    return (
      <div className="max-w-sm mx-auto mt-16 flex flex-col items-center gap-2 text-slate-400">
        <Loader2 className="animate-spin" size={22} />
        <p className="text-sm">確認中...</p>
      </div>
    );
  }

  if (phase === "setup") {
    return (
      <div className="max-w-sm mx-auto mt-16 bg-white rounded-2xl shadow-lg p-8 border border-slate-200">
        <div className="flex flex-col items-center gap-3 mb-6">
          <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center">
            <KeyRound className="text-blue-600" size={26} />
          </div>
          <h2 className="text-lg font-bold text-slate-800">指導者パスワードの初回設定</h2>
          <p className="text-sm text-slate-500 text-center">
            この組織ではまだ指導者パスワードが設定されていません。
          </p>
        </div>
        <label className="text-xs text-slate-500">新しいパスワード</label>
        <input
          type="password"
          value={pwInput}
          onChange={(e) => setPwInput(e.target.value)}
          placeholder="4文字以上"
          className="w-full border border-slate-300 rounded-lg px-4 py-2.5 mt-1 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
        <label className="text-xs text-slate-500">新しいパスワード（確認）</label>
        <input
          type="password"
          value={pwConfirm}
          onChange={(e) => setPwConfirm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSetup()}
          placeholder="もう一度入力"
          className="w-full border border-slate-300 rounded-lg px-4 py-2.5 mt-1 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {error && <p className="text-red-500 text-sm mb-2 text-center">{error}</p>}
        <div className="flex gap-2 mt-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium"
          >
            戻る
          </button>
          <button
            onClick={handleSetup}
            disabled={busy}
            className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium disabled:bg-slate-300 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            設定してログイン
          </button>
        </div>
      </div>
    );
  }

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
        onKeyDown={(e) => e.key === "Enter" && handleLogin()}
        placeholder="パスワード"
        className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
        autoFocus
      />
      {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}
      <DebugBox />
      <div className="flex gap-2 mt-5">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium"
        >
          戻る
        </button>
        <button
          onClick={handleLogin}
          disabled={busy}
          className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium disabled:bg-slate-300 flex items-center justify-center gap-2"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          ログイン
        </button>
      </div>
      <button
        onClick={() => {
          setError(null);
          setDebugInfo(null);
          setPhase("setup");
        }}
        className="w-full mt-3 text-xs text-slate-400 hover:text-slate-600 underline"
      >
        パスワードが分からない場合／未設定の場合はこちら（再設定）
      </button>
    </div>
  );
}

// ==================================================================
// チャットパネル（選手⇔スタッフ 共通コンポーネント）
// ==================================================================
function ChatPanel({ messages, myRole, title, onSend, roleOptions }) {
  const [text, setText] = useState("");
  const [role, setRole] = useState(roleOptions?.[0]?.value ?? null);
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await onSend(text.trim(), role);
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
              {m.sender === "staff" && m.staffRole && (
                <p
                  className={`text-[10px] font-bold mb-0.5 ${
                    m.sender === myRole ? "text-blue-100" : "text-slate-500"
                  }`}
                >
                  {CHAT_STAFF_ROLE_LABELS[m.staffRole] || "スタッフ"}
                </p>
              )}
              {m.content}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {roleOptions && (
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-2 text-xs bg-white shrink-0"
          >
            {roleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
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
  orgId,
  masterProtocols,
  setMasterProtocols,
  coachPlayers,
  setCoachPlayers,
  coachLoading,
  slots,
  setSlots,
}) {
  const [subTab, setSubTab] = useState("players");

  const tabs = [
    { key: "players", label: "選手管理", icon: Users },
    { key: "protocols", label: "プロトコル管理", icon: ClipboardList },
    { key: "scheduling", label: "日程調整", icon: CalendarRange },
    { key: "settings", label: "設定", icon: Settings },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex gap-2 mb-6 border-b border-slate-300 flex-wrap print:hidden">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                subTab === t.key
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      {subTab === "protocols" && (
        <ProtocolManagement orgId={orgId} masterProtocols={masterProtocols} setMasterProtocols={setMasterProtocols} />
      )}
      {subTab === "scheduling" && <CoachScheduling orgId={orgId} slots={slots} setSlots={setSlots} />}
      {subTab === "settings" && <CoachSettings orgId={orgId} />}
      {subTab === "players" &&
        (coachLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <Loader2 className="animate-spin" size={20} /> 選手データを読み込み中...
          </div>
        ) : (
          <PlayerManagement
            orgId={orgId}
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

// ---------- 設定：指導者パスワードの変更 ----------
function CoachSettings({ orgId }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [debugInfo, setDebugInfo] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleChange = async () => {
    setError(null);
    setDebugInfo(null);
    setSuccess(false);
    if (next.length < 4) {
      setError("新しいパスワードは4文字以上にしてください");
      return;
    }
    if (next !== confirm) {
      setError("新しいパスワード（確認）が一致しません");
      return;
    }
    setSaving(true);
    try {
      const storedHash = await fetchSetting(orgId, "coach_password_hash");
      const currentHash = await sha256Hex(current);
      if (!storedHash) {
        setError("現在のパスワードのハッシュ値をデータベースから取得できませんでした。");
        setDebugInfo({ inputHash: currentHash, storedHash: "(該当行なし)" });
        setSaving(false);
        return;
      }
      if (storedHash !== currentHash) {
        setError("現在のパスワードが違います。下記のハッシュ値を比較してください。");
        setDebugInfo({ inputHash: currentHash, storedHash });
        setSaving(false);
        return;
      }
      const newHash = await sha256Hex(next);
      await sbUpsert("app_settings", { org_id: orgId, key: "coach_password_hash", value: newHash }, "org_id,key");
      setSuccess(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md bg-white rounded-xl border border-slate-200 p-6">
      <h3 className="font-bold text-slate-700 text-sm mb-4 flex items-center gap-1.5">
        <KeyRound size={16} className="text-blue-600" /> 指導者パスワードの変更
      </h3>
      <label className="text-xs text-slate-500">現在のパスワード</label>
      <input
        type="password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <label className="text-xs text-slate-500">新しいパスワード</label>
      <input
        type="password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <label className="text-xs text-slate-500">新しいパスワード（確認）</label>
      <input
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
      {debugInfo && (
        <div className="mb-3 bg-slate-50 border border-slate-200 rounded-lg p-3 text-[10px] font-mono text-slate-500 space-y-1">
          <p className="break-all">
            入力ハッシュ: <span className="text-slate-700">{debugInfo.inputHash}</span>
          </p>
          <p className="break-all">
            DBハッシュ: <span className="text-slate-700">{debugInfo.storedHash}</span>
          </p>
        </div>
      )}
      {success && <p className="text-xs text-green-600 mb-2">パスワードを変更しました。</p>}
      <button
        onClick={handleChange}
        disabled={saving}
        className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:bg-slate-300 flex items-center justify-center gap-2"
      >
        {saving && <Loader2 size={14} className="animate-spin" />}
        {saving ? "変更中..." : "パスワードを変更する"}
      </button>
    </div>
  );
}

// ---------- 日程調整：3者の空き時間登録 → 自動照合 → 公開 ----------
function CoachScheduling({ orgId, slots, setSlots }) {
  const [availability, setAvailability] = useState([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState("coach");
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [day, setDay] = useState(now.getDate());
  const [hour, setHour] = useState(10);
  const [minute, setMinute] = useState(0);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  const loadAvailability = async () => {
    setLoading(true);
    try {
      const rows = await sbSelect(
        "staff_availability",
        `?org_id=eq.${encodeURIComponent(orgId)}&select=*&order=datetime.asc`
      );
      setAvailability(rows);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAvailability();
  }, [orgId]);

  const daysInMonth = new Date(year, month, 0).getDate();
  useEffect(() => {
    if (day > daysInMonth) setDay(daysInMonth);
  }, [daysInMonth, day]);

  const handleAddAvailability = async () => {
    const datetime = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
      2,
      "0"
    )} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    setSaving(true);
    setError(null);
    try {
      const [inserted] = await sbInsert("staff_availability", { role, datetime, org_id: orgId });
      setAvailability((prev) => [...prev, inserted].sort((a, b) => a.datetime.localeCompare(b.datetime)));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAvailability = async (id) => {
    try {
      await sbDelete("staff_availability", id);
      setAvailability((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const grouped = {};
  availability.forEach((a) => {
    if (!grouped[a.datetime]) grouped[a.datetime] = new Set();
    grouped[a.datetime].add(a.role);
  });

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const matched = Object.entries(grouped)
        .filter(([, roleSet]) => roleSet.has("coach") && roleSet.has("trainer"))
        .map(([datetime, roleSet]) => ({
          org_id: orgId,
          datetime,
          matched_roles: Array.from(roleSet),
        }));
      if (matched.length > 0) {
        await sb("slots?on_conflict=org_id,datetime", {
          method: "POST",
          body: JSON.stringify(matched),
          prefer: "resolution=merge-duplicates,return=representation",
        });
      }
      const rows = await sbSelect("slots", `?org_id=eq.${encodeURIComponent(orgId)}&select=*&order=datetime.asc`);
      setSlots(rows.map(normalizeSlot));
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-xl border border-slate-200 p-5 h-fit">
        <h3 className="font-bold text-slate-700 text-sm mb-4">面談可能日時の登録</h3>
        <label className="text-xs text-slate-500">立場</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 mb-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {SCHEDULING_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-3 gap-2 mb-2">
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
        <div className="grid grid-cols-2 gap-2 mb-3">
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
        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
        <button
          onClick={handleAddAvailability}
          disabled={saving}
          className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:bg-slate-300 flex items-center justify-center gap-2"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? "登録中..." : "この日時を空き時間として登録"}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-700 text-sm">登録済みの空き時間と自動照合</h3>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="text-xs px-3 py-1.5 rounded-full bg-slate-800 text-white font-medium hover:bg-slate-700 disabled:bg-slate-300 flex items-center gap-1 shrink-0"
          >
            {syncing && <Loader2 size={12} className="animate-spin" />} 自動照合して公開
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          コーチとトレーナーの空き時間が一致した日時（ドクターも一致すればさらに確実）だけが、
          選手側で予約できる面談枠として公開されます。
        </p>
        {loading ? (
          <p className="text-sm text-slate-400">読み込み中...</p>
        ) : (
          <ul className="space-y-2 max-h-72 overflow-y-auto">
            {Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([datetime, roleSet]) => {
                const roles = Array.from(roleSet);
                const qualifies = roleSet.has("coach") && roleSet.has("trainer");
                return (
                  <li
                    key={datetime}
                    className={`rounded-lg px-3 py-2 text-xs border ${
                      qualifies ? "border-green-200 bg-green-50" : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-700">{datetime}</span>
                      {qualifies && <span className="text-green-600 font-bold">公開対象</span>}
                    </div>
                    <p className="text-slate-500 mt-1">
                      {roles.map((r) => SCHEDULING_ROLE_LABELS[r]).join(" / ")}
                    </p>
                  </li>
                );
              })}
            {availability.length === 0 && <p className="text-sm text-slate-400">まだ登録がありません。</p>}
          </ul>
        )}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <p className="text-xs text-slate-400 mb-2">個別の空き時間を削除</p>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {availability.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-1.5"
              >
                <span>
                  {SCHEDULING_ROLE_LABELS[a.role]} ・ {a.datetime}
                </span>
                <button onClick={() => handleDeleteAvailability(a.id)} className="text-slate-400 hover:text-red-500">
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ---------- プロトコル管理(CMS) ----------
function ProtocolManagement({ orgId, masterProtocols, setMasterProtocols }) {
  const blankPhases = () =>
    Array.from({ length: 5 }, (_, i) => ({ title: `フェーズ${i + 1}`, conditionsText: "" }));

  const [name, setName] = useState("");
  const [totalWeeks, setTotalWeeks] = useState(8);
  const [videoUrl, setVideoUrl] = useState("");
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
      org_id: orgId,
      name: name.trim(),
      total_weeks: Number(totalWeeks) || 8,
      video_url: videoUrl.trim() || null,
      phases,
    };
    setSaving(true);
    setError(null);
    try {
      const [inserted] = await sbInsert("protocols", payload);
      setMasterProtocols((prev) => [...prev, normalizeProtocol(inserted)]);
      setName("");
      setTotalWeeks(8);
      setVideoUrl("");
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

  const handleUpdateVideoUrl = async (id, url) => {
    try {
      await sbUpdate("protocols", id, { video_url: url.trim() || null });
      setMasterProtocols((prev) =>
        prev.map((p) => (p.id === id ? { ...p, videoUrl: url.trim() || null } : p))
      );
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
          <ProtocolCard key={p.id} protocol={p} onDelete={handleDeleteProtocol} onSaveVideo={handleUpdateVideoUrl} />
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
          <div>
            <label className="text-xs text-slate-500 flex items-center gap-1">
              <Youtube size={12} className="text-red-500" /> 参考動画URL（YouTube・任意）
            </label>
            <input
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
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

function ProtocolCard({ protocol, onDelete, onSaveVideo }) {
  const [videoUrl, setVideoUrl] = useState(protocol.videoUrl || "");
  const [savingVideo, setSavingVideo] = useState(false);

  const handleSave = async () => {
    setSavingVideo(true);
    await onSaveVideo(protocol.id, videoUrl);
    setSavingVideo(false);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-bold text-slate-800">{protocol.name}</p>
          <p className="text-xs text-slate-400">標準復帰期間: 約{protocol.totalWeeks}週間</p>
        </div>
        <button onClick={() => onDelete(protocol.id)} className="text-slate-400 hover:text-red-500 p-1" title="削除">
          <Trash2 size={16} />
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {protocol.phases.map((ph, i) => (
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
      <div className="mt-3 pt-3 border-t border-slate-100">
        <label className="text-xs text-slate-500 flex items-center gap-1">
          <Youtube size={12} className="text-red-500" /> 参考動画URL
        </label>
        <div className="flex gap-2 mt-1">
          <input
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSave}
            disabled={savingVideo}
            className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 disabled:bg-slate-300"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- 選手管理（2ペイン） ----------
function PlayerManagement({ orgId, masterProtocols, coachPlayers, setCoachPlayers, slots, setSlots }) {
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if ((!selectedId || !coachPlayers.some((p) => p.id === selectedId)) && coachPlayers.length > 0) {
      setSelectedId(coachPlayers[0].id);
    }
  }, [coachPlayers, selectedId]);

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

  const sendCoachMessage = async (playerId, content, staffRole) => {
    const [inserted] = await sbInsert("messages", {
      player_id: playerId,
      sender: "staff",
      staff_role: staffRole,
      content,
    });
    setCoachPlayers((prev) =>
      prev.map((p) =>
        p.id === playerId ? { ...p, messages: [...p.messages, normalizeMessage(inserted)] } : p
      )
    );
  };

  const saveZoomUrl = async (slotId, url) => {
    await sbUpdate("slots", slotId, { zoom_url: url.trim() || null });
    setSlots((prev) => prev.map((s) => (s.id === slotId ? { ...s, zoomUrl: url.trim() || null } : s)));
  };

  const addTreatments = async (playerId, types, note, treatedDate) => {
    const payload = types.map((type) => ({
      player_id: playerId,
      org_id: orgId,
      type,
      note: note || null,
      treated_date: treatedDate || null,
    }));
    const inserted = await sbInsert("treatments", payload);
    setCoachPlayers((prev) =>
      prev.map((p) =>
        p.id === playerId
          ? { ...p, treatments: [...p.treatments, ...inserted.map(normalizeTreatment)] }
          : p
      )
    );
  };

  const deleteTreatment = async (playerId, treatmentId) => {
    await sbDelete("treatments", treatmentId);
    setCoachPlayers((prev) =>
      prev.map((p) =>
        p.id === playerId ? { ...p, treatments: p.treatments.filter((t) => t.id !== treatmentId) } : p
      )
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 print:block">
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden h-fit print:hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <p className="text-sm font-bold text-slate-700">
            選手一覧 ({coachPlayers.length})・Phase昇順
          </p>
          <p className="text-[10px] text-slate-400 mt-1">
            🟡 受傷2週間・面談未実施　🔴 受傷3週間・面談未実施　🟢 完全復帰
          </p>
        </div>
        <ul className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
          {sortedPlayers.map((p) => {
            const alert = isAlert(p);
            const r = latestReport(p);
            const unread = p.messages.filter((m) => m.sender === "player" && !m.isRead).length;
            const meetingLevel = meetingAlertLevel(p, slots);
            const isCompleted = Boolean(p.completedAt);
            const rowBg = isCompleted
              ? "bg-green-50"
              : meetingLevel === "red"
              ? "bg-red-50"
              : meetingLevel === "yellow"
              ? "bg-yellow-50"
              : selectedId === p.id
              ? "bg-blue-50"
              : "";
            return (
              <li key={p.id}>
                <button
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors ${rowBg}`}
                >
                  <div className="flex items-center gap-2">
                    {isCompleted ? (
                      <Trophy size={16} className="text-green-600 shrink-0" />
                    ) : (
                      alert && <AlertTriangle size={16} className="text-red-500 shrink-0" />
                    )}
                    <div>
                      <p
                        className={`text-sm font-semibold ${
                          isCompleted ? "text-green-700" : alert ? "text-red-600" : "text-slate-800"
                        }`}
                      >
                        {p.name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {protocolOf(p)?.name ?? "未設定"} ・{" "}
                        <span className={`font-bold ${PHASE_TEXT_COLORS[p.currentPhase]}`}>
                          Phase {p.currentPhase}/5
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {p.treatments.length > 0 && (
                      <span className="flex items-center gap-0.5 bg-purple-100 text-purple-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        <Syringe size={10} /> {p.treatments.length}
                      </span>
                    )}
                    {unread > 0 && (
                      <span className="flex items-center gap-0.5 bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        <MessageCircle size={10} /> {unread}
                      </span>
                    )}
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
                  </div>
                </button>
              </li>
            );
          })}
          {coachPlayers.length === 0 && (
            <li className="px-4 py-6 text-sm text-slate-400 text-center">選手が登録されていません</li>
          )}
        </ul>
      </div>

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
            allPlayers={coachPlayers}
            slots={slots}
            toggleChecklist={toggleChecklist}
            advancePhase={advancePhase}
            markCompleted={markCompleted}
            onDelete={() => deletePlayer(selectedPlayer.id, selectedPlayer.name)}
            onSendMessage={(content, role) => sendCoachMessage(selectedPlayer.id, content, role)}
            onSaveZoomUrl={saveZoomUrl}
            onAddTreatments={(types, note, date) => addTreatments(selectedPlayer.id, types, note, date)}
            onDeleteTreatment={(id) => deleteTreatment(selectedPlayer.id, id)}
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
  allPlayers,
  slots,
  toggleChecklist,
  advancePhase,
  markCompleted,
  onDelete,
  onSendMessage,
  onSaveZoomUrl,
  onAddTreatments,
  onDeleteTreatment,
  setCoachPlayers,
}) {
  const report = latestReport(player);
  const phaseInfo = protocol?.phases[player.currentPhase - 1];
  const allChecked = player.checklist.length > 0 && player.checklist.every(Boolean);

  // 要件⑤：同一組織内の実データ（injury_date・completed_at）から直接JavaScriptで算出。
  // モックではなく、指導者が読み込んでいる実際の選手一覧が計算元になる。
  const avg = protocol ? computeAvgRecoveryFromPlayers(allPlayers, protocol.id) : null;

  useEffect(() => {
    const markRead = async () => {
      try {
        await sb(
          `messages?player_id=eq.${encodeURIComponent(player.id)}&sender=eq.player&is_read=eq.false`,
          { method: "PATCH", body: JSON.stringify({ is_read: true }), prefer: "return=minimal" }
        );
        setCoachPlayers((prev) =>
          prev.map((p) =>
            p.id === player.id
              ? { ...p, messages: p.messages.map((m) => (m.sender === "player" ? { ...m, isRead: true } : m)) }
              : p
          )
        );
      } catch {
        // 既読反映の失敗は致命的ではないため無視
      }
    };
    markRead();
  }, [player.id]);

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
        // ポーリング失敗は無視
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [player.id, setCoachPlayers]);

  const myMeetings = slots
    .filter((s) => s.bookedBy === player.id)
    .slice()
    .sort((a, b) => a.datetime.localeCompare(b.datetime));

  return (
    <>
      <div className="space-y-5 print:hidden">
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-lg text-slate-800">{player.name}</h3>
            <p className="text-sm text-slate-400">
              {protocol?.name ?? "未設定"} ・ 現在{" "}
              <span className={`font-bold ${PHASE_TEXT_COLORS[player.currentPhase]}`}>
                Phase {player.currentPhase}/5
              </span>
              ：{phaseInfo?.title}
            </p>
            {player.injuryDate && (
              <p className="text-xs text-slate-400 mt-1">
                受傷日：{player.injuryDate}（受傷から{daysSince(player.injuryDate)}日経過）
                {avg && (
                  <span className="text-blue-500"> ・ 過去{avg.sampleSize}人の平均完遂日数：{avg.avgDays}日</span>
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {player.completedAt ? (
              <span className="flex items-center gap-1 bg-green-100 text-green-700 text-xs font-bold px-3 py-1.5 rounded-full">
                <Trophy size={14} /> 完全復帰
              </span>
            ) : (
              isAlert(player) && (
                <span className="flex items-center gap-1 bg-red-100 text-red-600 text-xs font-bold px-3 py-1.5 rounded-full">
                  <AlertTriangle size={14} /> 要確認
                </span>
              )
            )}
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 rounded-full px-3 py-1.5"
              title="レポートを印刷 / PDF出力"
            >
              <Printer size={14} /> レポート出力
            </button>
            <button
              onClick={onDelete}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 border border-slate-200 hover:border-red-300 rounded-full px-3 py-1.5"
              title="選手をデータベースから完全に削除する"
            >
              <Trash2 size={14} /> 削除
            </button>
          </div>
        </div>

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
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-400 mb-1">疲労度</p>
                <p className="text-2xl font-bold text-orange-500">{report.fatigue ?? "-"}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-400 mb-1">睡眠の質</p>
                <p className="text-2xl font-bold text-blue-500">{report.sleepQuality ?? "-"}</p>
              </div>
              <div className="col-span-3 bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">本音・言い訳</p>
                <p className="text-sm text-slate-700">{report.honne || "（未記入）"}</p>
              </div>
            </div>
          )}
          {player.reports.length > 1 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs font-bold text-slate-600 mb-2">コンディション推移（直近14件）</p>
              <SimpleTrendChart reports={player.reports} />
            </div>
          )}
        </div>

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
                <span className={`text-sm ${player.checklist[idx] ? "text-slate-800" : "text-slate-500"}`}>{c}</span>
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
              <Trophy size={16} /> 完全復帰 記録済み（{new Date(player.completedAt).toLocaleDateString("ja-JP")}）
            </div>
          )}
        </div>

        <TreatmentCard player={player} onAddTreatments={onAddTreatments} onDeleteTreatment={onDeleteTreatment} />

        <ChatPanel
          messages={player.messages}
          myRole="staff"
          title={`${player.name} さんとのチャット`}
          roleOptions={CHAT_STAFF_ROLES}
          onSend={onSendMessage}
        />

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
            <History size={16} className="text-blue-600" /> 面談履歴（{myMeetings.length}件）
          </h4>
          {myMeetings.length === 0 && (
            <p className="text-sm text-slate-400">まだ面談の予約・実施履歴がありません。</p>
          )}
          <ul className="space-y-2">
            {myMeetings.map((s) => {
              const held = parseDatetime(s.datetime) <= new Date();
              const daysAfter = player.injuryDate ? diffDaysBetween(player.injuryDate, s.datetime) : null;
              return <MeetingRow key={s.id} slot={s} held={held} daysAfter={daysAfter} onSaveZoomUrl={onSaveZoomUrl} />;
            })}
          </ul>
          <p className="text-[10px] text-slate-400 mt-3">
            面談枠の登録・公開は「日程調整」タブから行えます。
          </p>
        </div>
      </div>

      <PrintSummary player={player} protocol={protocol} phaseInfo={phaseInfo} avg={avg} myMeetings={myMeetings} />
    </>
  );
}

// ---------- コンディション推移の簡易折れ線グラフ（外部ライブラリ不使用） ----------
function SimpleTrendChart({ reports }) {
  const width = 320;
  const height = 110;
  const padding = 8;
  const recent = reports.slice(-14);
  if (recent.length < 2) return <p className="text-xs text-slate-400">グラフ表示には2件以上のデータが必要です。</p>;

  const xStep = (width - padding * 2) / (recent.length - 1);
  const toX = (i) => padding + i * xStep;
  const toY = (v) => height - padding - (v / 10) * (height - padding * 2);

  const series = [
    { key: "vas", color: "#ef4444", label: "痛み(VAS)" },
    { key: "fatigue", color: "#f97316", label: "疲労度" },
    { key: "sleepQuality", color: "#3b82f6", label: "睡眠の質" },
  ];

  const buildPath = (key) => {
    const points = recent
      .map((r, i) => ({ x: toX(i), y: r[key] === null || r[key] === undefined ? null : toY(r[key]) }))
      .filter((p) => p.y !== null);
    if (points.length === 0) return null;
    return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  };

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-28">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#e2e8f0" strokeWidth="1" />
        <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="2,2" />
        {series.map((s) => {
          const d = buildPath(s.key);
          return d ? <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth="2" /> : null;
        })}
      </svg>
      <div className="flex gap-3 mt-1 flex-wrap">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1 text-[10px] text-slate-500">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- 治療介入の記録 ----------
function TreatmentCard({ player, onAddTreatments, onDeleteTreatment }) {
  const [selected, setSelected] = useState([]);
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const toggle = (val) => setSelected((prev) => (prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]));

  const handleSubmit = async () => {
    if (selected.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await onAddTreatments(selected, note.trim(), date);
      setSelected([]);
      setNote("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await onDeleteTreatment(id);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
        <Syringe size={16} className="text-blue-600" /> 治療介入の記録
      </h4>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {TREATMENT_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => toggle(t.value)}
            className={`flex items-center gap-2 text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
              selected.includes(t.value)
                ? "border-blue-500 bg-blue-50 text-blue-700 font-bold"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {selected.includes(t.value) ? (
              <CheckCircle2 size={14} className="shrink-0" />
            ) : (
              <Circle size={14} className="shrink-0 text-slate-300" />
            )}
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2 mb-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="メモ（任意）"
          className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
      <button
        onClick={handleSubmit}
        disabled={selected.length === 0 || saving}
        className="w-full py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:bg-slate-300"
      >
        {saving ? "記録中..." : "選択した処置を記録する"}
      </button>

      {player.treatments.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-1.5">
          <p className="text-xs text-slate-400 mb-1">介入履歴（{player.treatments.length}件）</p>
          {player.treatments
            .slice()
            .reverse()
            .map((t) => (
              <div key={t.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-1.5">
                <span>
                  {t.treatedDate || "日付未記録"} ・{" "}
                  <span className="font-bold text-blue-600">{TREATMENT_LABELS[t.type] || t.type}</span>
                  {t.note ? ` ・ ${t.note}` : ""}
                </span>
                <button onClick={() => handleDelete(t.id)} className="text-slate-400 hover:text-red-500 shrink-0 ml-2">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ---------- 印刷/PDF出力用サマリー（画面には表示されず、印刷時のみ表示） ----------
function PrintSummary({ player, protocol, phaseInfo, avg, myMeetings }) {
  const recentReports = player.reports.slice(-10);
  return (
    <div className="hidden print:block p-6 text-black text-sm">
      <style>{"@media print { @page { size: A4; margin: 14mm; } }"}</style>
      <div className="flex items-center justify-between border-b-2 border-black pb-2 mb-4">
        <h1 className="text-xl font-bold">リハビリ進捗レポート</h1>
        <p className="text-xs">出力日: {new Date().toLocaleDateString("ja-JP")}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4 text-xs">
        <div className="space-y-1">
          <p>
            <span className="font-bold">氏名：</span>
            {player.name}
          </p>
          <p>
            <span className="font-bold">プロトコル：</span>
            {protocol?.name ?? "未設定"}
          </p>
          <p>
            <span className="font-bold">現在フェーズ：</span>
            Phase {player.currentPhase}/5（{phaseInfo?.title}）
          </p>
        </div>
        <div className="space-y-1">
          <p>
            <span className="font-bold">受傷日：</span>
            {player.injuryDate || "未登録"}
          </p>
          <p>
            <span className="font-bold">完全復帰：</span>
            {player.completedAt ? new Date(player.completedAt).toLocaleDateString("ja-JP") : "未完遂"}
          </p>
          {avg && (
            <p>
              <span className="font-bold">過去の平均完遂日数：</span>
              {avg.avgDays}日（サンプル{avg.sampleSize}人）
            </p>
          )}
        </div>
      </div>

      <h2 className="font-bold border-b border-black mb-1 mt-3 text-sm">治療介入歴</h2>
      {player.treatments.length === 0 ? (
        <p className="text-xs mb-2">記録なし</p>
      ) : (
        <table className="w-full text-xs mb-2 border-collapse">
          <thead>
            <tr className="text-left border-b border-slate-400">
              <th className="py-0.5 pr-2">日付</th>
              <th className="py-0.5 pr-2">種別</th>
              <th className="py-0.5">メモ</th>
            </tr>
          </thead>
          <tbody>
            {player.treatments.map((t) => (
              <tr key={t.id} className="border-b border-slate-200">
                <td className="py-0.5 pr-2">{t.treatedDate || "-"}</td>
                <td className="py-0.5 pr-2">{TREATMENT_LABELS[t.type] || t.type}</td>
                <td className="py-0.5">{t.note || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="font-bold border-b border-black mb-1 mt-3 text-sm">最近のコンディション推移</h2>
      {recentReports.length === 0 ? (
        <p className="text-xs mb-2">記録なし</p>
      ) : (
        <table className="w-full text-xs mb-2 border-collapse">
          <thead>
            <tr className="text-left border-b border-slate-400">
              <th className="py-0.5 pr-2">日付</th>
              <th className="py-0.5 pr-2">VAS</th>
              <th className="py-0.5 pr-2">疲労度</th>
              <th className="py-0.5">睡眠の質</th>
            </tr>
          </thead>
          <tbody>
            {recentReports.map((r, i) => (
              <tr key={i} className="border-b border-slate-200">
                <td className="py-0.5 pr-2">{r.date}</td>
                <td className="py-0.5 pr-2">{r.vas}</td>
                <td className="py-0.5 pr-2">{r.fatigue ?? "-"}</td>
                <td className="py-0.5">{r.sleepQuality ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="font-bold border-b border-black mb-1 mt-3 text-sm">面談履歴</h2>
      {myMeetings.length === 0 ? (
        <p className="text-xs">記録なし</p>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left border-b border-slate-400">
              <th className="py-0.5 pr-2">日時</th>
              <th className="py-0.5">状態</th>
            </tr>
          </thead>
          <tbody>
            {myMeetings.map((s) => (
              <tr key={s.id} className="border-b border-slate-200">
                <td className="py-0.5 pr-2">{s.datetime}</td>
                <td className="py-0.5">{parseDatetime(s.datetime) <= new Date() ? "実施済み" : "予定"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MeetingRow({ slot, held, daysAfter, onSaveZoomUrl }) {
  const [zoomUrl, setZoomUrl] = useState(slot.zoomUrl || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveZoomUrl(slot.id, zoomUrl);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="bg-slate-50 rounded-lg px-3 py-2 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-slate-600">{slot.datetime}</span>
        <span className="flex items-center gap-2">
          {daysAfter !== null && <span className="text-slate-400">受傷後{daysAfter}日</span>}
          <span className={`font-bold ${held ? "text-green-600" : "text-blue-500"}`}>
            {held ? "実施済み" : "予定"}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Video size={12} className="text-slate-400 shrink-0" />
        <input
          value={zoomUrl}
          onChange={(e) => setZoomUrl(e.target.value)}
          placeholder="オンライン会議URL（Zoomなど）"
          className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-2.5 py-1 rounded-lg bg-slate-800 text-white text-[11px] font-medium hover:bg-slate-700 disabled:bg-slate-300 shrink-0"
        >
          保存
        </button>
      </div>
    </li>
  );
}

// ==================================================================
// 選手モード（PIN認証つき）
// ==================================================================
function PlayerMode({
  orgId,
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
        orgId={orgId}
        masterProtocols={masterProtocols}
        playerDirectory={playerDirectory}
        setPlayerDirectory={setPlayerDirectory}
        setMyPlayer={setMyPlayer}
      />
    );
  }

  return (
    <PlayerPersonalDashboard
      orgId={orgId}
      player={myPlayer}
      protocol={masterProtocols.find((mp) => mp.id === myPlayer.protocolId)}
      setMyPlayer={setMyPlayer}
      slots={slots}
      setSlots={setSlots}
      onLogout={() => setMyPlayer(null)}
    />
  );
}

function PlayerLogin({ orgId, masterProtocols, playerDirectory, setPlayerDirectory, setMyPlayer }) {
  const [screen, setScreen] = useState("select");
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
        `?id=eq.${encodeURIComponent(selectedDir.id)}&org_id=eq.${encodeURIComponent(orgId)}&select=pin`
      );
      if (!pinRows[0] || pinRows[0].pin !== pin) {
        setError("暗証番号が違います");
        setChecking(false);
        return;
      }
      const fullRows = await sbSelect(
        "players",
        `?id=eq.${encodeURIComponent(selectedDir.id)}&org_id=eq.${encodeURIComponent(orgId)}&select=${PLAYER_FIELDS}${PLAYER_EMBED_ORDER}`
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
        orgId={orgId}
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

function PlayerRegisterForm({ orgId, masterProtocols, setPlayerDirectory, setMyPlayer, onCancel }) {
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
      org_id: orgId,
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
      setMyPlayer(normalizePlayer({ ...inserted, reports: [], messages: [], treatments: [] }));
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
          <li>「面談予約」から公開されている枠をタップするだけで、面談を予約できます。</li>
          <li>予約後にZoom等のURLが設定されると「面談に参加」ボタンから直接参加できます。</li>
          <li>「指導者とのチャット」から直接メッセージのやり取りができます（返信者の立場も表示されます）。</li>
          <li>「受傷日」を登録すると、同じ怪我をした過去の選手たちの平均復帰期間が目安として表示されます。</li>
        </ul>
      )}
    </div>
  );
}

function InjuryDateCard({ orgId, player, protocol, setMyPlayer }) {
  const [date, setDate] = useState(player.injuryDate || "");
  const [saving, setSaving] = useState(false);
  const [avg, setAvg] = useState(null);

  useEffect(() => {
    let active = true;
    if (protocol) {
      sbSelect(
        "protocol_avg_recovery",
        `?org_id=eq.${encodeURIComponent(orgId)}&protocol_id=eq.${encodeURIComponent(protocol.id)}&select=*`
      )
        .then((rows) => {
          if (active) setAvg(rows[0] || null);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [protocol?.id, orgId]);

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
      {avg && avg.sample_size > 0 ? (
        <p className="text-xs text-blue-600 mt-2 flex items-start gap-1">
          <TrendingUp size={14} className="shrink-0 mt-0.5" />
          過去に同じ怪我を完遂した{avg.sample_size}人の平均は、受傷から約
          {Math.round((avg.avg_days / 7) * 10) / 10}週間（{avg.avg_days}日）でした。目安にしてください。
        </p>
      ) : (
        <p className="text-xs text-slate-400 mt-2">
          まだ同じプロトコルを完遂した選手のデータがないため、平均値はまだ表示できません。
        </p>
      )}
    </div>
  );
}

function PlayerPersonalDashboard({ orgId, player, protocol, setMyPlayer, slots, setSlots, onLogout }) {
  const [vas, setVas] = useState(3);
  const [fatigue, setFatigue] = useState(3);
  const [sleepQuality, setSleepQuality] = useState(7);
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
  const embedUrl = getYouTubeEmbedUrl(protocol?.videoUrl);

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
    const newReport = { date: todayStr(), vas, mental, honne: honne.trim(), fatigue, sleepQuality };
    try {
      await sbInsert("reports", {
        player_id: player.id,
        date: newReport.date,
        vas: newReport.vas,
        mental: newReport.mental,
        honne: newReport.honne,
        fatigue: newReport.fatigue,
        sleep_quality: newReport.sleepQuality,
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
        <button onClick={onLogout} className="text-xs text-slate-400 flex items-center gap-1 hover:text-slate-600">
          <LogOut size={14} /> ログアウト
        </button>
      </div>

      <UsageGuide />

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-bold text-slate-700">復帰ロードマップ</p>
          <span className={`text-xs font-bold ${PHASE_TEXT_COLORS[player.currentPhase]}`}>
            現在のステップ：{player.currentPhase}/5
          </span>
        </div>
        <p className="text-2xl font-extrabold text-slate-800 mb-1">全体復帰まであと {remainingWeeks} 週間</p>
        <p className="text-xs text-slate-400 mb-3">{protocol?.name}</p>

        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
          {[1, 2, 3, 4, 5].map((n) => (
            <div
              key={n}
              className={`h-full flex-1 ${n <= player.currentPhase ? PHASE_BG_COLORS[n] : "bg-transparent"}`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={`text-[10px] font-bold ${n <= player.currentPhase ? PHASE_TEXT_COLORS[n] : "text-slate-300"}`}
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

      {protocol?.videoUrl && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
            <Youtube size={16} className="text-red-500" /> リハビリ参考動画
          </p>
          {embedUrl ? (
            <div className="aspect-video w-full rounded-lg overflow-hidden bg-slate-100">
              <iframe
                src={embedUrl}
                title="リハビリ参考動画"
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <a
              href={protocol.videoUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 py-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm text-blue-600 font-medium"
            >
              <LinkIcon size={14} /> 動画リンクを開く
            </a>
          )}
        </div>
      )}

      <InjuryDateCard orgId={orgId} player={player} protocol={protocol} setMyPlayer={setMyPlayer} />

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

        <label className="text-xs text-slate-500 flex justify-between">
          <span>疲労度</span>
          <span className="font-bold text-orange-500">{fatigue}</span>
        </label>
        <input
          type="range"
          min={0}
          max={10}
          value={fatigue}
          onChange={(e) => setFatigue(Number(e.target.value))}
          className="w-full mt-2 accent-orange-500"
        />
        <div className="flex justify-between text-[10px] text-slate-400 mb-4">
          <span>0（疲労なし）</span>
          <span>10（極度の疲労）</span>
        </div>

        <label className="text-xs text-slate-500 flex justify-between">
          <span>睡眠の質</span>
          <span className="font-bold text-blue-500">{sleepQuality}</span>
        </label>
        <input
          type="range"
          min={0}
          max={10}
          value={sleepQuality}
          onChange={(e) => setSleepQuality(Number(e.target.value))}
          className="w-full mt-2 accent-blue-500"
        />
        <div className="flex justify-between text-[10px] text-slate-400 mb-4">
          <span>0（最悪）</span>
          <span>10（最高）</span>
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

      <ChatPanel messages={player.messages} myRole="player" title="指導者とのチャット" onSend={sendPlayerMessage} />

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5">
          <CalendarClock size={16} className="text-blue-600" />
          面談予約
        </p>
        <p className="text-xs text-slate-400 mb-3">
          コーチ・トレーナーなどの日程調整により公開された枠から選べます。
        </p>

        {bookedSlot ? (
          <div className="bg-blue-50 rounded-lg px-4 py-3 space-y-2">
            <p className="text-sm text-blue-700 font-bold">予約済み：{bookedSlot.datetime}</p>
            {bookedSlot.zoomUrl ? (
              <a
                href={bookedSlot.zoomUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700"
              >
                <Video size={16} /> 面談に参加
              </a>
            ) : (
              <p className="text-xs text-blue-500">オンライン会議URLは指導者側で準備中です。</p>
            )}
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
                <span className="text-left">
                  <span className="block text-slate-600">{s.datetime}</span>
                  <span className="block text-[10px] text-slate-400">
                    {(s.matchedRoles || []).map((r) => SCHEDULING_ROLE_LABELS[r]).join("・")}
                  </span>
                </span>
                <span className="text-blue-600 font-bold text-xs shrink-0">この枠で予約</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
