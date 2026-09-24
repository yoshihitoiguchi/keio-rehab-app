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
  ArrowLeft,
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
  FlaskConical,
  Printer,
  Dumbbell,
  ScanLine,
  Stethoscope,
  Layers,
  Ban,
  Scale,
  Gauge,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

// ============================================================
// Supabase 接続設定（確定した本番の値）
// ============================================================
const SUPABASE_URL = "https://akvfrihatvfkrjzpxtcw.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrdmZyaWhhdHZma3JqenB4dGN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjk4NDEsImV4cCI6MjEwNDcwNTg0MX0.LUUpqkDo61LfV6vK5RSfYGyb7is93WrvQeikTiV1uIg";

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
const sbUpsert = (table, body, onConflictColumns) =>
  sb(`${table}?on_conflict=${encodeURIComponent(onConflictColumns)}`, {
    method: "POST",
    body: JSON.stringify(body),
    prefer: "resolution=merge-duplicates,return=representation",
  });

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
    // PHASE数はプロトコルごとに可変（ハムストリングは10 PHASE）
    phaseCount: (row.phases || []).length || 5,
    classificationScheme: row.classification_scheme || null,
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
    painType: row.pain_type || null,
    videoUrl: row.video_url || null,
    timestampNote: row.timestamp_note || null,
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
function normalizePhaseHistoryEntry(row) {
  return {
    id: row.id,
    phaseNumber: row.phase_number,
    enteredAt: row.entered_at,
    leftAt: row.left_at,
  };
}
function normalizeMenu(row) {
  return {
    id: row.id,
    protocolId: row.protocol_id,
    phaseNumber: row.phase_number,
    name: row.name,
    youtubeUrl: row.youtube_url || null,
    ngCompensation: row.ng_compensation || null,
    alternativeMenu: row.alternative_menu || null,
  };
}
// 要件①②⑥⑦：種目マスター（導入フェーズ〜終了フェーズ・進行ステップ・GATE対象可否）
function normalizeExercise(row) {
  return {
    id: row.id,
    protocolId: row.protocol_id,
    name: row.name,
    introducedPhase: row.introduced_phase,
    endPhase: row.end_phase, // null = 終了しない（継続）
    isGateExercise: row.is_gate_exercise,
    youtubeUrl: row.youtube_url || null,
    ngCompensation: row.ng_compensation || null,
    sessionNote: row.session_note || null,
    steps: row.steps || [], // [{label}] 順序=進行順
  };
}
function normalizeForbidden(row) {
  return { id: row.id, protocolId: row.protocol_id, phaseNumber: row.phase_number, name: row.name };
}
function normalizeExerciseProgress(row) {
  return { exerciseId: row.exercise_id, currentStep: row.current_step };
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
    imagingFindings: row.imaging_findings || "",
    bamicGrade: row.bamic_grade || null,
    hamstringMuscle: row.hamstring_muscle || null,
    hamstringLocation: row.hamstring_location || null,
    bodyWeightKg: row.body_weight_kg ?? null,
    baselineTimeSec: row.baseline_time_sec ?? null,
    baselineDistanceM: row.baseline_distance_m ?? null,
    supportStatus: row.support_status || "unresolved",
    supportAssigneeRole: row.support_assignee_role || null,
    reports: (row.reports || [])
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((r) => ({
        id: r.id,
        date: r.date,
        vas: r.vas,
        mental: r.mental,
        honne: r.honne,
        fatigue: r.fatigue ?? null,
        sleepQuality: r.sleep_quality ?? null,
        tenderness: r.tenderness ?? null,
        compensation: r.compensation ?? null,
        severeSymptom: r.severe_symptom ?? null,
        fear: r.fear ?? null,
        giveWayFootstrike: r.give_way_footstrike ?? null,
        rpe: r.rpe ?? null,
        triage: r.triage ?? null,
      })),
    messages: (row.messages || [])
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(normalizeMessage),
    treatments: (row.treatments || [])
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(normalizeTreatment),
    phaseHistory: (row.phase_history || [])
      .slice()
      .sort((a, b) => new Date(a.entered_at) - new Date(b.entered_at))
      .map(normalizePhaseHistoryEntry),
    exerciseProgress: (row.player_exercise_progress || []).map(normalizeExerciseProgress),
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
const PLAYER_FIELDS =
  "*,reports(*),messages(*),treatments(*),phase_history(*),player_exercise_progress(*)";
const PLAYER_EMBED_ORDER =
  "&reports.order=created_at.asc&messages.order=created_at.asc&treatments.order=created_at.asc&phase_history.order=entered_at.asc";

const TREATMENT_TYPES = [
  { value: "shockwave", label: "体外衝撃波" },
  { value: "lipus", label: "超音波(LIPUS)" },
  { value: "prp", label: "PRP療法" },
  { value: "hydrorelease", label: "エコー下ハイドロリリース" },
  { value: "insole", label: "インソール作成" },
  { value: "other", label: "その他" },
];
const TREATMENT_LABELS = Object.fromEntries(TREATMENT_TYPES.map((t) => [t.value, t.label]));

const PAIN_TYPES = [
  { value: "sharp", label: "鋭い痛み（ズキッ）" },
  { value: "dull", label: "鈍い痛み（重だるい）" },
  { value: "tightness", label: "つっぱり感" },
  { value: "numbness", label: "しびれ" },
  { value: "other", label: "その他" },
];
const PAIN_TYPE_LABELS = Object.fromEntries(PAIN_TYPES.map((p) => [p.value, p.label]));

// 要件②：実務的なトリアージ判定ロジック（前日比VAS急増・VAS7以上・歩行困難な鋭い痛みでSOS）
function computeTriage(vas, prevVas, compensation, severeSymptom) {
  const delta = prevVas === null || prevVas === undefined ? 0 : vas - prevVas;
  if (delta >= 3 || vas >= 7 || severeSymptom) return "red";
  if (compensation || (vas >= 4 && vas <= 6)) return "yellow";
  return "green";
}
const TRIAGE_INFO = {
  red: { label: "中止/SOS", bg: "bg-red-100", text: "text-red-700" },
  yellow: { label: "負荷・メニュー変更", bg: "bg-yellow-100", text: "text-yellow-700" },
  green: { label: "継続OK", bg: "bg-green-100", text: "text-green-700" },
};


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

// フェーズごとの色分け（赤→オレンジ→黄→黄緑→青→紫、最大10フェーズまで対応）
const PHASE_TEXT_COLORS = {
  1: "text-red-600",
  2: "text-orange-500",
  3: "text-amber-500",
  4: "text-yellow-600",
  5: "text-lime-600",
  6: "text-green-600",
  7: "text-teal-600",
  8: "text-cyan-600",
  9: "text-blue-600",
  10: "text-indigo-600",
};
const PHASE_BG_COLORS = {
  1: "bg-red-500",
  2: "bg-orange-500",
  3: "bg-amber-500",
  4: "bg-yellow-500",
  5: "bg-lime-500",
  6: "bg-green-500",
  7: "bg-teal-500",
  8: "bg-cyan-500",
  9: "bg-blue-500",
  10: "bg-indigo-500",
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
  return player.sos || r.triage === "red";
}
function phaseCountOf(protocol) {
  return protocol?.phaseCount || 5;
}
function phaseRange(protocol) {
  return Array.from({ length: phaseCountOf(protocol) }, (_, i) => i + 1);
}
function weeksRemaining(protocol, currentPhase) {
  if (!protocol) return 0;
  const n = phaseCountOf(protocol);
  const perPhase = protocol.totalWeeks / n;
  return Math.max(0, Math.round(perPhase * (n - currentPhase + 1)));
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
// 要件④：面談未定の黄色アラートのみ残す（3週間超の赤アラートはSOSと被るため廃止）
function meetingAlertLevel(player, slots) {
  if (!player.injuryDate) return null;
  const held = slots.some((s) => s.bookedBy === player.id && parseDatetime(s.datetime) <= new Date());
  if (held) return null;
  const elapsed = daysSince(player.injuryDate);
  if (elapsed >= 14) return "yellow";
  return null;
}
// 要件④：Phase5完遂から14日以上経過した選手は「復帰者リスト」へ自動的に移動する
function isGraduatedOut(player) {
  if (!player.completedAt) return false;
  return daysSince(player.completedAt) > 14;
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
// 要件②：選手自身のフェーズ滞在履歴から、各Phaseに何日いたか（現在進行中のPhaseは今日まで）を算出
function computeOwnPhaseDurations(phaseHistory) {
  const map = {};
  (phaseHistory || []).forEach((entry) => {
    const start = new Date(entry.enteredAt);
    const end = entry.leftAt ? new Date(entry.leftAt) : new Date();
    map[entry.phaseNumber] = Math.max(0, Math.round((end - start) / 86400000));
  });
  return map;
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
  const [phaseMenus, setPhaseMenus] = useState([]);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const [coachPlayers, setCoachPlayers] = useState([]);
  const [coachLoading, setCoachLoading] = useState(false);

  const [myPlayer, setMyPlayer] = useState(null);

  const loadPublicData = async (orgId) => {
    setLoading(true);
    setLoadError(null);
    try {
      const [protocolRows, slotRows, dirRows, menuRows] = await Promise.all([
        sbSelect("protocols", `?org_id=eq.${encodeURIComponent(orgId)}&select=*&order=name.asc`),
        sbSelect("slots", `?org_id=eq.${encodeURIComponent(orgId)}&select=*&order=datetime.asc`),
        sbSelect(
          "player_directory",
          `?org_id=eq.${encodeURIComponent(orgId)}&select=id,name&order=name.asc`
        ),
        sbSelect(
          "phase_menus",
          `?org_id=eq.${encodeURIComponent(orgId)}&select=*&order=phase_number.asc`
        ),
      ]);
      setMasterProtocols(protocolRows.map(normalizeProtocol));
      setSlots(slotRows.map(normalizeSlot));
      setPlayerDirectory(dirRows);
      setPhaseMenus(menuRows.map(normalizeMenu));
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
    setPhaseMenus([]);
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
            phaseMenus={phaseMenus}
            setPhaseMenus={setPhaseMenus}
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
            phaseMenus={phaseMenus}
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
function ChatPanel({ messages, myRole, title, onSend, roleOptions, hideHeader }) {
  const [text, setText] = useState("");
  const [role, setRole] = useState(roleOptions?.[0]?.value ?? null);
  const [sending, setSending] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [painType, setPainType] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [timestampNote, setTimestampNote] = useState("");

  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await onSend(text.trim(), role, {
        painType: painType || null,
        videoUrl: videoUrl.trim() || null,
        timestampNote: timestampNote.trim() || null,
      });
      setText("");
      setPainType("");
      setVideoUrl("");
      setTimestampNote("");
      setShowExtra(false);
    } catch (err) {
      alert(`送信に失敗しました: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={hideHeader ? "" : "bg-white rounded-2xl border border-slate-200 p-5 shadow-sm"}>
      {!hideHeader && (
        <p className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
          <MessageCircle size={16} className="text-blue-600" /> {title}
        </p>
      )}
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
              {(m.painType || m.videoUrl || m.timestampNote) && (
                <div
                  className={`mt-1.5 pt-1.5 border-t text-[11px] space-y-0.5 ${
                    m.sender === myRole ? "border-blue-400 text-blue-100" : "border-slate-300 text-slate-500"
                  }`}
                >
                  {m.painType && <p>痛みの種類：{PAIN_TYPE_LABELS[m.painType] || m.painType}</p>}
                  {m.timestampNote && <p>該当箇所：{m.timestampNote}</p>}
                  {m.videoUrl && (
                    <a
                      href={m.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={`flex items-center gap-1 underline ${
                        m.sender === myRole ? "text-white" : "text-blue-600"
                      }`}
                    >
                      <Video size={11} /> 動画を見る
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => setShowExtra((v) => !v)}
        className="text-[11px] text-blue-600 hover:underline mb-2"
      >
        {showExtra ? "詳細入力を閉じる" : "＋ 痛みの種類・動画リンクなど詳細を追加"}
      </button>
      {showExtra && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          <select
            value={painType}
            onChange={(e) => setPainType(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white"
          >
            <option value="">痛みの種類（任意）</option>
            {PAIN_TYPES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            value={timestampNote}
            onChange={(e) => setTimestampNote(e.target.value)}
            placeholder="例：0:30の動きを見てほしい"
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
          />
          <input
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="動画リンク（URL）"
            className="col-span-1 sm:col-span-2 border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
          />
        </div>
      )}

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
  phaseMenus,
  setPhaseMenus,
}) {
  const [subTab, setSubTab] = useState("players");

  const tabs = [
    { key: "players", label: "選手管理", icon: Users },
    { key: "protocols", label: "プロトコル管理", icon: ClipboardList },
    { key: "menus", label: "メニューライブラリ", icon: Dumbbell },
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
      {subTab === "menus" && (
        <MenuLibraryManagement
          orgId={orgId}
          masterProtocols={masterProtocols}
          phaseMenus={phaseMenus}
          setPhaseMenus={setPhaseMenus}
        />
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
            phaseMenus={phaseMenus}
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

// ---------- メニューライブラリ：Phaseごとの推奨メニュー・NG代償動作・代替メニュー ----------
function MenuLibraryManagement({ orgId, masterProtocols, phaseMenus, setPhaseMenus }) {
  const [protocolId, setProtocolId] = useState(masterProtocols[0]?.id ?? "");
  const [phaseNumber, setPhaseNumber] = useState(1);
  const [name, setName] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [ngCompensation, setNgCompensation] = useState("");
  const [alternativeMenu, setAlternativeMenu] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!protocolId && masterProtocols[0]) setProtocolId(masterProtocols[0].id);
  }, [masterProtocols, protocolId]);

  const handleAdd = async () => {
    if (!protocolId || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        org_id: orgId,
        protocol_id: protocolId,
        phase_number: phaseNumber,
        name: name.trim(),
        youtube_url: youtubeUrl.trim() || null,
        ng_compensation: ngCompensation.trim() || null,
        alternative_menu: alternativeMenu.trim() || null,
      };
      const [inserted] = await sbInsert("phase_menus", payload);
      setPhaseMenus((prev) => [...prev, normalizeMenu(inserted)]);
      setName("");
      setYoutubeUrl("");
      setNgCompensation("");
      setAlternativeMenu("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await sbDelete("phase_menus", id);
      setPhaseMenus((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const protocolName = (id) => masterProtocols.find((p) => p.id === id)?.name ?? "不明";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-3">
        <h3 className="font-bold text-slate-700 text-sm">登録済みメニュー ({phaseMenus.length})</h3>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const menusForPhase = phaseMenus.filter((m) => m.phaseNumber === n);
          if (menusForPhase.length === 0) return null;
          return (
            <div key={n} className="bg-white rounded-xl border border-slate-200 p-4">
              <p className={`text-xs font-bold mb-2 ${PHASE_TEXT_COLORS[n]}`}>Phase {n}</p>
              <div className="space-y-2">
                {menusForPhase.map((m) => (
                  <div key={m.id} className="bg-slate-50 rounded-lg p-3 text-xs">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-bold text-slate-700">{m.name}</p>
                        <p className="text-slate-400">{protocolName(m.protocolId)}</p>
                      </div>
                      <button onClick={() => handleDelete(m.id)} className="text-slate-400 hover:text-red-500">
                        <Trash2 size={13} />
                      </button>
                    </div>
                    {m.youtubeUrl && (
                      <p className="mt-1 text-blue-600 flex items-center gap-1">
                        <Youtube size={12} /> {m.youtubeUrl}
                      </p>
                    )}
                    {m.ngCompensation && (
                      <p className="mt-1 text-red-500">⚠️ NG代償動作：{m.ngCompensation}</p>
                    )}
                    {m.alternativeMenu && (
                      <p className="mt-1 text-slate-500">代替コソ練：{m.alternativeMenu}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {phaseMenus.length === 0 && <p className="text-sm text-slate-400">まだメニューが登録されていません。</p>}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 h-fit">
        <h3 className="font-bold text-slate-700 text-sm mb-4 flex items-center gap-1.5">
          <Dumbbell size={16} className="text-blue-600" /> 新しいメニューを追加
        </h3>
        <label className="text-xs text-slate-500">対象プロトコル</label>
        <select
          value={protocolId}
          onChange={(e) => setProtocolId(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 mb-3 bg-white"
        >
          {masterProtocols.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（全{p.phaseCount}段階）
            </option>
          ))}
          {masterProtocols.length === 0 && <option value="">プロトコル未登録</option>}
        </select>
        <label className="text-xs text-slate-500">対象Phase</label>
        <select
          value={phaseNumber}
          onChange={(e) => setPhaseNumber(Number(e.target.value))}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 mb-3 bg-white"
        >
          {phaseRange(masterProtocols.find((p) => p.id === protocolId)).map((n) => (
            <option key={n} value={n}>
              Phase {n}
            </option>
          ))}
        </select>
        <label className="text-xs text-slate-500">メニュー名</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例：チューブを使ったヒップヒンジ"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 mb-3"
        />
        <label className="text-xs text-slate-500 flex items-center gap-1">
          <Youtube size={12} className="text-red-500" /> YouTubeリンク（任意）
        </label>
        <input
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 mb-3"
        />
        <label className="text-xs text-slate-500">⚠️ 注意すべきNG代償動作</label>
        <textarea
          value={ngCompensation}
          onChange={(e) => setNgCompensation(e.target.value)}
          rows={2}
          placeholder="例：骨盤が後傾して腰が丸まる代償動作に注意"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 mb-3"
        />
        <label className="text-xs text-slate-500">患部外の代替コソ練メニュー（体幹等）</label>
        <textarea
          value={alternativeMenu}
          onChange={(e) => setAlternativeMenu(e.target.value)}
          rows={2}
          placeholder="例：プランク、上半身の自重トレーニング"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 mb-3"
        />
        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
        <button
          onClick={handleAdd}
          disabled={!protocolId || !name.trim() || saving}
          className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:bg-slate-300 flex items-center justify-center gap-2"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? "保存中..." : "メニューを追加する"}
        </button>
      </div>
    </div>
  );
}

// ---------- 選手・トレーナー共通：現在Phaseの推奨メニューカタログ表示 ----------
function PhaseMenuCatalog({ menus, protocolId, phaseNumber }) {
  const relevant = menus.filter((m) => m.protocolId === protocolId && m.phaseNumber === phaseNumber);
  if (relevant.length === 0) {
    return <p className="text-sm text-slate-400">このPhaseに登録されたメニューはまだありません。</p>;
  }
  return (
    <div className="space-y-3">
      {relevant.map((m) => (
        <div key={m.id} className="bg-slate-50 rounded-lg p-3 text-sm">
          <p className="font-bold text-slate-700">{m.name}</p>
          {m.youtubeUrl && (
            <a
              href={m.youtubeUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 flex items-center gap-1 text-blue-600 text-xs hover:underline"
            >
              <Youtube size={13} /> 動画を見る
            </a>
          )}
          {m.ngCompensation && (
            <p className="mt-1 text-xs text-red-500">⚠️ NG代償動作：{m.ngCompensation}</p>
          )}
          {m.alternativeMenu && (
            <p className="mt-1 text-xs text-slate-500">患部外の代替コソ練：{m.alternativeMenu}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- プロトコル管理(CMS) ----------
function ProtocolManagement({ orgId, masterProtocols, setMasterProtocols }) {
  // フェーズ数はプロトコルごとに自由（5段階でも10段階でもよい）
  const makePhase = (i) => ({ title: `フェーズ${i + 1}`, conditionsText: "" });
  const blankPhases = (n = 5) => Array.from({ length: n }, (_, i) => makePhase(i));

  const [name, setName] = useState("");
  const [totalWeeks, setTotalWeeks] = useState(8);
  const [videoUrl, setVideoUrl] = useState("");
  const [scheme, setScheme] = useState("");
  const [phaseForms, setPhaseForms] = useState(blankPhases(5));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const updatePhaseForm = (idx, field, value) => {
    setPhaseForms((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  };
  const addPhase = () => setPhaseForms((prev) => [...prev, makePhase(prev.length)]);
  const removePhase = (idx) =>
    setPhaseForms((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));

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
      classification_scheme: scheme || null,
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
      setScheme("");
      setPhaseForms(blankPhases(5));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProtocol = async (id, protoName) => {
    setError(null);
    try {
      const users = await sbSelect(
        "players",
        `?protocol_id=eq.${encodeURIComponent(id)}&org_id=eq.${encodeURIComponent(orgId)}&select=id,name`
      );
      const n = users?.length ?? 0;
      const warn =
        n > 0
          ? `\n\n注意：このプロトコルは現在 ${n}名 の選手が使用中です（${users
              .slice(0, 5)
              .map((u) => u.name)
              .join("、")}${n > 5 ? " ほか" : ""}）。\n削除すると、その選手のプロトコルは未設定になります。`
          : "";
      if (!window.confirm(`プロトコル「${protoName}」を削除しますか？${warn}\n\nこの操作は取り消せません。`)) return;
      await sbDelete("protocols", id);
      setMasterProtocols((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(`削除できませんでした: ${err.message}`);
    }
  };

  const handleUpdateScheme = async (id, value) => {
    setError(null);
    try {
      await sbUpdate("protocols", id, { classification_scheme: value || null });
      setMasterProtocols((prev) =>
        prev.map((p) => (p.id === id ? { ...p, classificationScheme: value || null } : p))
      );
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
          <ProtocolCard
            key={p.id}
            protocol={p}
            onDelete={handleDeleteProtocol}
            onSaveVideo={handleUpdateVideoUrl}
            onSaveScheme={handleUpdateScheme}
          />
        ))}
        {masterProtocols.length === 0 && (
          <p className="text-sm text-slate-400">まだプロトコルが登録されていません。</p>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
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
          <div>
            <label className="text-xs text-slate-500">分類の分岐（任意）</label>
            <select
              value={scheme}
              onChange={(e) => setScheme(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 bg-white"
            >
              <option value="">なし</option>
              <option value="hamstring">ハムストリング（BAMIC × 損傷筋 × 部位）</option>
            </select>
            <p className="text-[10px] text-slate-400 mt-1">
              設定すると、このプロトコルを選んだ選手の詳細画面に分類の入力欄が出ます。
            </p>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-xs text-slate-500">
              フェーズ構成（全 {phaseForms.length} 段階）
            </label>
            <button
              onClick={addPhase}
              className="text-[11px] px-2.5 py-1 rounded-full border border-blue-200 text-blue-600 hover:bg-blue-50"
            >
              ＋ フェーズを追加
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
            {phaseForms.map((p, idx) => (
              <div key={idx} className="border border-slate-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-500">Phase {idx + 1} 名称</label>
                  {phaseForms.length > 1 && (
                    <button
                      onClick={() => removePhase(idx)}
                      className="text-slate-400 hover:text-red-500"
                      title="このフェーズを削除"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
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

function ProtocolCard({ protocol, onDelete, onSaveVideo, onSaveScheme }) {
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
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
              全 {protocol.phaseCount} 段階
            </span>
            {protocol.classificationScheme === "hamstring" && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                分類分岐あり
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => onDelete(protocol.id, protocol.name)}
          className="text-slate-400 hover:text-red-500 p-1"
          title="このプロトコルを削除"
        >
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
        <label className="text-xs text-slate-500">分類の分岐</label>
        <select
          value={protocol.classificationScheme || ""}
          onChange={(e) => onSaveScheme(protocol.id, e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs mt-1 bg-white"
        >
          <option value="">なし</option>
          <option value="hamstring">ハムストリング（BAMIC × 損傷筋 × 部位）</option>
        </select>
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
function PlayerManagement({ orgId, masterProtocols, coachPlayers, setCoachPlayers, slots, setSlots, phaseMenus }) {
  const [selectedId, setSelectedId] = useState(null);
  const [listView, setListView] = useState("active"); // 'active' | 'graduated'
  const [error, setError] = useState(null);

  const activePlayers = coachPlayers.filter((p) => !isGraduatedOut(p));
  const graduatedPlayers = coachPlayers.filter((p) => isGraduatedOut(p));
  const visiblePlayers = listView === "active" ? activePlayers : graduatedPlayers;

  useEffect(() => {
    if ((!selectedId || !visiblePlayers.some((p) => p.id === selectedId)) && visiblePlayers.length > 0) {
      setSelectedId(visiblePlayers[0].id);
    }
  }, [visiblePlayers, selectedId]);

  const sortedPlayers = [...visiblePlayers].sort((a, b) => a.currentPhase - b.currentPhase);
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
    const nextPhase = Math.min(phaseCountOf(protocol), player.currentPhase + 1);
    const nextConditionsCount = protocol?.phases[nextPhase - 1]?.conditions.length ?? 0;
    const nextChecklist = Array(nextConditionsCount).fill(false);
    const now = new Date().toISOString();
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
      // 要件②：フェーズ滞在履歴を記録（前のフェーズを閉じて、新しいフェーズを開始）
      await sb(
        `phase_history?player_id=eq.${encodeURIComponent(playerId)}&phase_number=eq.${player.currentPhase}&left_at=is.null`,
        { method: "PATCH", body: JSON.stringify({ left_at: now }), prefer: "return=minimal" }
      );
      await sbInsert("phase_history", {
        player_id: playerId,
        protocol_id: player.protocolId,
        phase_number: nextPhase,
        entered_at: now,
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const markCompleted = async (playerId) => {
    const player = coachPlayers.find((p) => p.id === playerId);
    const now = new Date().toISOString();
    setCoachPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, completedAt: now } : p)));
    try {
      await sbUpdate("players", playerId, { completed_at: now });
      if (player) {
        await sb(
          `phase_history?player_id=eq.${encodeURIComponent(playerId)}&phase_number=eq.${player.currentPhase}&left_at=is.null`,
          { method: "PATCH", body: JSON.stringify({ left_at: now }), prefer: "return=minimal" }
        );
      }
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

  const sendCoachMessage = async (playerId, content, staffRole, extra = {}) => {
    const [inserted] = await sbInsert("messages", {
      player_id: playerId,
      sender: "staff",
      staff_role: staffRole,
      content,
      pain_type: extra.painType || null,
      video_url: extra.videoUrl || null,
      timestamp_note: extra.timestampNote || null,
    });
    // 要件⑤：誰かが返信したら自動で「〇〇（役職）が対応中」を全スタッフに共有する
    await sbUpdate("players", playerId, { support_status: "in_progress", support_assignee_role: staffRole });
    setCoachPlayers((prev) =>
      prev.map((p) =>
        p.id === playerId
          ? {
              ...p,
              messages: [...p.messages, normalizeMessage(inserted)],
              supportStatus: "in_progress",
              supportAssigneeRole: staffRole,
            }
          : p
      )
    );
  };

  const resolveChatStatus = async (playerId) => {
    await sbUpdate("players", playerId, { support_status: "resolved", support_assignee_role: null });
    setCoachPlayers((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, supportStatus: "resolved", supportAssigneeRole: null } : p))
    );
  };

  const resolveSos = async (playerId) => {
    await sbUpdate("players", playerId, { sos: false });
    setCoachPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, sos: false } : p)));
  };

  const saveImagingFindings = async (playerId, text) => {
    await sbUpdate("players", playerId, { imaging_findings: text });
    setCoachPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, imagingFindings: text } : p)));
  };

  // 要件②：前日比VAS急増・代償動作・歩行困難な鋭い痛みから自動トリアージを記録する
  const assessReport = async (playerId, reportId, vas, prevVas, compensation, severeSymptom) => {
    const triage = computeTriage(vas, prevVas, compensation, severeSymptom);
    await sbUpdate("reports", reportId, { compensation, severe_symptom: severeSymptom, triage });
    setCoachPlayers((prev) =>
      prev.map((p) =>
        p.id === playerId
          ? {
              ...p,
              reports: p.reports.map((r) =>
                r.id === reportId ? { ...r, compensation, severeSymptom, triage } : r
              ),
            }
          : p
      )
    );
    return triage;
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
        <div className="flex border-b border-slate-200">
          <button
            onClick={() => setListView("active")}
            className={`flex-1 text-xs font-bold py-2.5 ${
              listView === "active" ? "text-blue-700 border-b-2 border-blue-600" : "text-slate-400"
            }`}
          >
            現役選手 ({activePlayers.length})
          </button>
          <button
            onClick={() => setListView("graduated")}
            className={`flex-1 text-xs font-bold py-2.5 ${
              listView === "graduated" ? "text-blue-700 border-b-2 border-blue-600" : "text-slate-400"
            }`}
          >
            復帰者リスト ({graduatedPlayers.length})
          </button>
        </div>
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <p className="text-sm font-bold text-slate-700">
            {listView === "active" ? "現役選手一覧" : "復帰者リスト"} ({visiblePlayers.length})・Phase昇順
          </p>
          <ul className="text-[10px] text-slate-500 mt-1.5 space-y-1">
            <li className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> 完全復帰（14日間はここに表示）
            </li>
            <li className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" /> 受傷2週間・面談未定
            </li>
            <li className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> SOS・要対応
            </li>
          </ul>
        </div>
        <ul className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
          {sortedPlayers.map((p) => {
            const alert = isAlert(p);
            const r = latestReport(p);
            const unread = p.messages.filter((m) => m.sender === "player" && !m.isRead).length;
            const meetingLevel = meetingAlertLevel(p, slots);
            const isCompleted = Boolean(p.completedAt);
            const rowBg = alert
              ? "bg-red-50"
              : isCompleted
              ? "bg-green-50"
              : meetingLevel === "yellow"
              ? "bg-yellow-50"
              : selectedId === p.id
              ? "bg-blue-50"
              : "";
            const nameColor = alert ? "text-red-700" : isCompleted ? "text-green-700" : "text-slate-800";
            // 要件③：未対応のSOS・新着チャットを一目でわかるようにする
            const needsAttention = p.sos || (unread > 0 && p.supportStatus !== "in_progress" && p.supportStatus !== "resolved");
            return (
              <li key={p.id}>
                <button
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors ${rowBg}`}
                >
                  <div>
                    <p className={`text-sm font-semibold ${nameColor}`}>{p.name}</p>
                    <p className="text-xs text-slate-400">
                      {protocolOf(p)?.name ?? "未設定"} ・{" "}
                      <span className={`font-bold ${PHASE_TEXT_COLORS[p.currentPhase]}`}>
                        Phase {p.currentPhase}/{phaseCountOf(protocolOf(p))}
                      </span>
                    </p>
                    {p.supportStatus && p.supportStatus !== "unresolved" && (
                      <p
                        className={`text-[10px] font-bold mt-0.5 ${
                          p.supportStatus === "resolved" ? "text-green-600" : "text-blue-600"
                        }`}
                      >
                        {p.supportStatus === "resolved"
                          ? "解決済み"
                          : `対応中：${CHAT_STAFF_ROLE_LABELS[p.supportAssigneeRole] || "スタッフ"}`}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {needsAttention && (
                      <span className="bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        新着/未対応
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
          {visiblePlayers.length === 0 && (
            <li className="px-4 py-6 text-sm text-slate-400 text-center">
              {listView === "active" ? "選手が登録されていません" : "復帰者はまだいません"}
            </li>
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
            orgId={orgId}
            player={selectedPlayer}
            protocol={protocolOf(selectedPlayer)}
            allPlayers={coachPlayers}
            slots={slots}
            phaseMenus={phaseMenus}
            toggleChecklist={toggleChecklist}
            advancePhase={advancePhase}
            markCompleted={markCompleted}
            onDelete={() => deletePlayer(selectedPlayer.id, selectedPlayer.name)}
            onSendMessage={(content, role, extra) => sendCoachMessage(selectedPlayer.id, content, role, extra)}
            onSaveZoomUrl={saveZoomUrl}
            onAddTreatments={(types, note, date) => addTreatments(selectedPlayer.id, types, note, date)}
            onDeleteTreatment={(id) => deleteTreatment(selectedPlayer.id, id)}
            onSaveImagingFindings={(text) => saveImagingFindings(selectedPlayer.id, text)}
            onAssessReport={(reportId, vas, prevVas, compensation, severeSymptom) =>
              assessReport(selectedPlayer.id, reportId, vas, prevVas, compensation, severeSymptom)
            }
            onResolveSos={() => resolveSos(selectedPlayer.id)}
            onResolveChatStatus={() => resolveChatStatus(selectedPlayer.id)}
            setCoachPlayers={setCoachPlayers}
          />
        )}
      </div>
    </div>
  );
}

function PlayerDetailPanel({
  orgId,
  player,
  protocol,
  allPlayers,
  slots,
  phaseMenus,
  toggleChecklist,
  advancePhase,
  markCompleted,
  onDelete,
  onSendMessage,
  onSaveZoomUrl,
  onAddTreatments,
  onDeleteTreatment,
  onSaveImagingFindings,
  onAssessReport,
  onResolveSos,
  onResolveChatStatus,
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
                Phase {player.currentPhase}/{phaseCountOf(protocol)}
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
              <span className="bg-green-100 text-green-700 text-xs font-bold px-3 py-1.5 rounded-full">
                完全復帰
              </span>
            ) : (
              isAlert(player) && (
                <span className="flex items-center gap-2 bg-red-100 text-red-700 text-xs font-bold px-3 py-1.5 rounded-full">
                  要確認（SOS）
                  {player.sos && (
                    <button
                      onClick={onResolveSos}
                      className="underline hover:no-underline text-red-800"
                      title="SOSを対応済みにする"
                    >
                      対応済みにする
                    </button>
                  )}
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
          {report && (
            <TrainerAssessment
              key={report.id}
              report={report}
              prevVas={player.reports.length > 1 ? player.reports[player.reports.length - 2].vas : null}
              onAssess={onAssessReport}
            />
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

          {player.currentPhase < phaseCountOf(protocol) && (
            <button
              onClick={() => advancePhase(player.id)}
              disabled={!allChecked}
              className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              次のフェーズへ進める <ArrowRight size={16} />
            </button>
          )}
          {player.currentPhase >= phaseCountOf(protocol) && !player.completedAt && (
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

        <ImagingFindingsCard player={player} onSave={onSaveImagingFindings} />

        <AthleteMetricsCard
          player={player}
          onSaved={(patch) =>
            setCoachPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, ...patch } : p)))
          }
        />

        <HamstringClassificationCard
          orgId={orgId}
          player={player}
          protocol={protocol}
          onSaved={(patch) =>
            setCoachPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, ...patch } : p)))
          }
        />

        <CumulativeMenuPanel player={player} protocol={protocol} />

        <OffsiteTrainingPanel orgId={orgId} player={player} />

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
            <Dumbbell size={16} className="text-blue-600" /> 現在Phaseの推奨メニュー
          </h4>
          <PhaseMenuCatalog menus={phaseMenus} protocolId={player.protocolId} phaseNumber={player.currentPhase} />
        </div>

        <TreatmentCard player={player} onAddTreatments={onAddTreatments} onDeleteTreatment={onDeleteTreatment} />

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
              <MessageCircle size={16} className="text-blue-600" /> {player.name} さんとのチャット
            </p>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                  player.supportStatus === "resolved"
                    ? "bg-green-100 text-green-700"
                    : player.supportStatus === "in_progress"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {player.supportStatus === "resolved"
                  ? "解決済み"
                  : player.supportStatus === "in_progress"
                  ? `対応中：${CHAT_STAFF_ROLE_LABELS[player.supportAssigneeRole] || "スタッフ"}`
                  : "未対応"}
              </span>
              {player.supportStatus !== "resolved" && (
                <button
                  onClick={onResolveChatStatus}
                  className="text-xs text-slate-400 hover:text-green-600 underline"
                >
                  解決済みにする
                </button>
              )}
            </div>
          </div>
          <ChatPanel
            messages={player.messages}
            myRole="staff"
            title=""
            roleOptions={CHAT_STAFF_ROLES}
            onSend={onSendMessage}
            hideHeader
          />
        </div>

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
// ---------- トレーナーによる圧痛・代償動作の評価と自動トリアージ ----------
function TrainerAssessment({ report, prevVas, onAssess }) {
  const [compensation, setCompensation] = useState(Boolean(report.compensation));
  const [severeSymptom, setSevereSymptom] = useState(Boolean(report.severeSymptom));
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(report.triage || null);

  const handleAssess = async () => {
    setSaving(true);
    try {
      const triage = await onAssess(report.id, report.vas, prevVas, compensation, severeSymptom);
      setResult(triage);
    } finally {
      setSaving(false);
    }
  };

  const delta = prevVas === null || prevVas === undefined ? null : report.vas - prevVas;

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <p className="text-xs font-bold text-slate-600 mb-2 flex items-center gap-1.5">
        <Stethoscope size={14} className="text-blue-600" /> トレーナー評価（自動トリアージ）
      </p>
      {delta !== null && (
        <p className="text-[11px] text-slate-400 mb-2">
          前回VAS {prevVas} → 今回VAS {report.vas}（{delta >= 0 ? "+" : ""}
          {delta}）
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={compensation} onChange={(e) => setCompensation(e.target.checked)} />
          代償動作あり
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={severeSymptom} onChange={(e) => setSevereSymptom(e.target.checked)} />
          歩行困難な鋭い痛みがある
        </label>
        <button
          onClick={handleAssess}
          disabled={saving}
          className="ml-auto px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 disabled:bg-slate-300"
        >
          {saving ? "判定中..." : "評価して記録"}
        </button>
      </div>
      {result && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${TRIAGE_INFO[result].bg} ${TRIAGE_INFO[result].text}`}>
          {TRIAGE_INFO[result].label}
        </div>
      )}
    </div>
  );
}

// ---------- 画像診断所見（MRI・エコー等）の記述フィールド ----------
function ImagingFindingsCard({ player, onSave }) {
  const [text, setText] = useState(player.imagingFindings || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(text);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
        <ScanLine size={16} className="text-blue-600" /> 画像診断所見（MRI・エコー等）
      </h4>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="例：MRIにて大腿二頭筋長頭近位部に軽度の腱付着部損傷を認める。腱実質内の高信号変化は軽微。"
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 disabled:bg-slate-300"
        >
          {saving ? "保存中..." : "保存"}
        </button>
        {saved && <span className="text-xs text-green-600">保存しました</span>}
      </div>
    </div>
  );
}

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
        <FlaskConical size={16} className="text-blue-600" /> 治療介入の記録
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
            Phase {player.currentPhase}/{phaseCountOf(protocol)}（{phaseInfo?.title}）
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
  phaseMenus,
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
      phaseMenus={phaseMenus}
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
      // 要件②：フェーズ滞在履歴の記録を開始（Phase1に入った日時）
      await sbInsert("phase_history", {
        player_id: inserted.id,
        protocol_id: protocolId,
        phase_number: 1,
        entered_at: new Date().toISOString(),
      });
      setPlayerDirectory((prev) => [...prev, { id: inserted.id, name: inserted.name }]);
      setMyPlayer(normalizePlayer({ ...inserted, reports: [], messages: [], treatments: [], phase_history: [] }));
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
              {p.name}（全{p.phaseCount}段階）
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

// ---------- 要件②：全組織横断のPhase別タイムライン比較 ----------
function PhaseTimelineComparison({ player, protocol }) {
  const [globalAvg, setGlobalAvg] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    if (protocol?.name) {
      sbSelect(
        "protocol_phase_avg_duration",
        `?protocol_name=eq.${encodeURIComponent(protocol.name)}&select=*&order=phase_number.asc`
      )
        .then((rows) => {
          if (active) setGlobalAvg(rows);
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLoading(false);
        });
    } else {
      setLoading(false);
    }
    return () => {
      active = false;
    };
  }, [protocol?.name]);

  const ownDurations = computeOwnPhaseDurations(player.phaseHistory);
  const maxDays = Math.max(
    1,
    ...phaseRange(protocol).map((n) => Math.max(ownDurations[n] || 0, globalAvg.find((g) => g.phase_number === n)?.avg_days || 0))
  );
  const hasAnyGlobal = globalAvg.some((g) => g.sample_size > 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
        <Layers size={16} className="text-blue-600" /> 先輩たちとのPhase別タイムライン比較
      </p>
      {loading ? (
        <p className="text-xs text-slate-400">読み込み中...</p>
      ) : (
        <>
          {!hasAnyGlobal && (
            <p className="text-xs text-slate-400 mb-3">
              全組織でこのプロトコルを完遂した実績がまだ十分ではないため、参考値として表示しています。
            </p>
          )}
          <div className="space-y-3">
            {phaseRange(protocol).map((n) => {
              const own = ownDurations[n];
              const g = globalAvg.find((x) => x.phase_number === n);
              return (
                <div key={n}>
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className={`font-bold ${PHASE_TEXT_COLORS[n]}`}>Phase {n}</span>
                    <span className="text-slate-400">
                      {own !== undefined ? `あなた: ${own}日` : "未到達"}
                      {g && g.sample_size > 0 ? ` ／ 全組織平均: ${g.avg_days}日（${g.sample_size}件）` : ""}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${PHASE_BG_COLORS[n]}`}
                        style={{ width: `${own !== undefined ? Math.min(100, (own / maxDays) * 100) : 0}%` }}
                      />
                    </div>
                    <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-slate-400"
                        style={{ width: `${g && g.sample_size > 0 ? Math.min(100, (g.avg_days / maxDays) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 mt-3 text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> あなた（上段）
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" /> 全組織平均（下段）
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function PlayerPersonalDashboard({ orgId, player, protocol, setMyPlayer, slots, setSlots, phaseMenus, onLogout }) {
  const [tab, setTab] = useState("dashboard"); // 'dashboard' | 'report'
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
  const progressPct = ((player.currentPhase - 1) / phaseCountOf(protocol)) * 100;
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

  const sendPlayerMessage = async (content, _role, extra = {}) => {
    const [inserted] = await sbInsert("messages", {
      player_id: player.id,
      sender: "player",
      content,
      pain_type: extra.painType || null,
      video_url: extra.videoUrl || null,
      timestamp_note: extra.timestampNote || null,
    });
    setMyPlayer((prev) => ({ ...prev, messages: [...prev.messages, normalizeMessage(inserted)] }));
    // 要件⑤：解決済みだった会話に新しいメッセージが来たら「未対応」に戻す
    if (player.supportStatus === "resolved") {
      await sbUpdate("players", player.id, { support_status: "unresolved", support_assignee_role: null });
      setMyPlayer((prev) => ({ ...prev, supportStatus: "unresolved", supportAssigneeRole: null }));
    }
  };

  const addPlayerTreatments = async (types, note, treatedDate) => {
    const payload = types.map((type) => ({
      player_id: player.id,
      org_id: orgId,
      type,
      note: note || null,
      treated_date: treatedDate || null,
    }));
    const inserted = await sbInsert("treatments", payload);
    setMyPlayer((prev) => ({ ...prev, treatments: [...prev.treatments, ...inserted.map(normalizeTreatment)] }));
  };

  const deletePlayerTreatment = async (id) => {
    await sbDelete("treatments", id);
    setMyPlayer((prev) => ({ ...prev, treatments: prev.treatments.filter((t) => t.id !== id) }));
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

      {/* 要件①：閲覧用の「ダッシュボード」と入力用の「日報・SOS送信」をタブで分離 */}
      <div className="flex bg-slate-200 rounded-full p-1 gap-1">
        <button
          onClick={() => setTab("dashboard")}
          className={`flex-1 py-2 rounded-full text-sm font-bold transition-colors ${
            tab === "dashboard" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"
          }`}
        >
          ダッシュボード
        </button>
        <button
          onClick={() => setTab("report")}
          className={`flex-1 py-2 rounded-full text-sm font-bold transition-colors ${
            tab === "report" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"
          }`}
        >
          日報・SOS送信
        </button>
      </div>

      {tab === "dashboard" && (
        <>
          <UsageGuide />

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-slate-700">復帰ロードマップ</p>
              <span className={`text-xs font-bold ${PHASE_TEXT_COLORS[player.currentPhase]}`}>
                現在のステップ：{player.currentPhase}/{phaseCountOf(protocol)}
              </span>
            </div>
            <p className="text-2xl font-extrabold text-slate-800 mb-1">全体復帰まであと {remainingWeeks} 週間</p>
            <p className="text-xs text-slate-400 mb-3">{protocol?.name}</p>

            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
              {phaseRange(protocol).map((n) => (
                <div
                  key={n}
                  className={`h-full flex-1 ${n <= player.currentPhase ? PHASE_BG_COLORS[n] : "bg-transparent"}`}
                />
              ))}
            </div>
            <div className="flex justify-between mt-2">
              {phaseRange(protocol).map((n) => (
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

          <PhaseTimelineComparison player={player} protocol={protocol} />

          <CumulativeMenuPanel player={player} protocol={protocol} readOnly />

          <OffsiteTrainingPanel orgId={orgId} player={player} readOnly />

          <HamstringClassificationCard orgId={orgId} player={player} protocol={protocol} readOnly />

          <AthleteMetricsCard
            player={player}
            onSaved={(patch) => setMyPlayer((prev) => ({ ...prev, ...patch }))}
          />

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
              <Dumbbell size={16} className="text-blue-600" /> 現在Phaseの推奨メニュー
            </p>
            <PhaseMenuCatalog menus={phaseMenus} protocolId={player.protocolId} phaseNumber={player.currentPhase} />
          </div>

          <TreatmentCard player={player} onAddTreatments={addPlayerTreatments} onDeleteTreatment={deletePlayerTreatment} />

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
        </>
      )}

      {tab === "report" && (
        <>
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
            <div className="grid grid-cols-5 gap-1 text-center mt-2 mb-4">
              {[
                { v: 0, label: "完全に無痛・全く気にならない" },
                { v: 3, label: "痛みはあるが、練習には集中できる（許容範囲）" },
                { v: 5, label: "痛みが気になって思い通りの動きができない（代償動作が出る）" },
                { v: 8, label: "これ以上やると確実に悪化する・かばうことすらできない" },
                { v: 10, label: "これまで経験した最大の痛み・激痛" },
              ].map((a) => (
                <div key={a.v}>
                  <p className="text-xs font-bold text-blue-600">{a.v}</p>
                  <p className="text-[8px] leading-tight text-blue-700 mt-0.5">{a.label}</p>
                </div>
              ))}
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
        </>
      )}
    </div>
  );
}

// ============================================================
// 患部外トレーニング / ハムストリング分類 / 累積メニュー
// （元 RehabModules.jsx。単一ファイルで動かすため統合）
// ============================================================
// ============================================================
// 定数
// ============================================================
const LOAD_LABELS = {
  unloaded: "免荷で可",
  partial: "部分荷重",
  full: "全荷重",
};
const LOAD_BADGE = {
  unloaded: "bg-green-100 text-green-700",
  partial: "bg-amber-100 text-amber-700",
  full: "bg-red-100 text-red-700",
};
const REGION_LABELS = {
  whole_body: "全身",
  upper_body: "上半身",
  hip: "股関節",
  trunk: "体幹",
  spine: "脊柱・骨盤",
  thorax: "胸椎・胸郭",
  knee: "膝",
  foot_ankle: "足部・足関節",
  calf: "下腿・ふくらはぎ",
  single_leg: "片脚支持",
  sprint: "スプリント",
};

// 傷害別プリセット（高野さんの「疲労骨折は免荷だけ、ふくらはぎはカーフ系」という運用をそのまま形に）
const OFFSITE_PRESETS = [
  { key: "all", label: "すべて表示", load: "all", region: "all" },
  { key: "stress_fracture", label: "疲労骨折（免荷のみ）", load: "unloaded", region: "all" },
  { key: "calf", label: "下腿・ふくらはぎ", load: "all", region: "calf" },
  { key: "foot_ankle", label: "足部・足関節", load: "all", region: "foot_ankle" },
  { key: "knee", label: "膝", load: "all", region: "knee" },
  { key: "hamstring", label: "ハムストリング（患部ライン優先）", load: "all", region: "all" },
];

const BAMIC_GRADES = ["0a", "0b", "1a", "1b", "1c", "2a", "2b", "2c", "3a", "3b", "3c", "4"];
const BAMIC_NOTES = {
  a: "a：筋膜／筋周膜",
  b: "b：筋腱移行部",
  c: "c：腱内（intratendinous）",
};
const HAMSTRING_MUSCLES = [
  { value: "semimembranosus", label: "半膜様筋" },
  { value: "semitendinosus", label: "半腱様筋" },
  { value: "biceps_femoris", label: "大腿二頭筋" },
];
const HAMSTRING_LOCATIONS = [
  { value: "proximal", label: "近位" },
  { value: "mid_distal", label: "中間位〜遠位" },
];
const MUSCLE_LABELS = Object.fromEntries(HAMSTRING_MUSCLES.map((m) => [m.value, m.label]));
const LOCATION_LABELS = Object.fromEntries(HAMSTRING_LOCATIONS.map((l) => [l.value, l.label]));

// ============================================================
// 換算ヘルパー（DBに換算結果は持たず、表示のたびに計算する）
// ============================================================
function toActualLoadKg(percentBw, bodyWeightKg) {
  if (!percentBw || !bodyWeightKg) return null;
  return Math.round(((Number(bodyWeightKg) * Number(percentBw)) / 100) * 10) / 10;
}
function toActualTimeSec(percentSpeed, baselineTimeSec) {
  if (!percentSpeed || !baselineTimeSec) return null;
  return Math.round((Number(baselineTimeSec) / (Number(percentSpeed) / 100)) * 100) / 100;
}

// ============================================================
// 選手の基準値（体重・基準タイム）— 本人も指導者も編集できる
// ============================================================
function AthleteMetricsCard({ player, onSaved }) {
  const [weight, setWeight] = useState(player.bodyWeightKg ?? "");
  const [time, setTime] = useState(player.baselineTimeSec ?? "");
  const [dist, setDist] = useState(player.baselineDistanceM ?? 100);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const patch = {
        body_weight_kg: weight === "" ? null : Number(weight),
        baseline_time_sec: time === "" ? null : Number(time),
        baseline_distance_m: dist === "" ? null : Number(dist),
      };
      await sbUpdate("players", player.id, patch);
      onSaved?.({
        bodyWeightKg: patch.body_weight_kg,
        baselineTimeSec: patch.baseline_time_sec,
        baselineDistanceM: patch.baseline_distance_m,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert(`保存に失敗しました: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5">
        <Scale size={16} className="text-blue-600" /> 基準値（%BW・走速度%の換算に使用）
      </p>
      <p className="text-[11px] text-slate-400 mb-3">
        ここを更新すると、メニューの「+10%BW」「@82%」などが自動で実数に変換されます。
      </p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-slate-500">体重 (kg)</label>
          <input
            type="number"
            step="0.1"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mt-0.5"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500">基準タイム (秒)</label>
          <input
            type="number"
            step="0.01"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mt-0.5"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500">その距離 (m)</label>
          <input
            type="number"
            value={dist}
            onChange={(e) => setDist(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mt-0.5"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 disabled:bg-slate-300"
        >
          {saving ? "保存中..." : "保存"}
        </button>
        {saved && <span className="text-xs text-green-600">保存しました</span>}
      </div>
    </div>
  );
}

// ============================================================
// ハムストリング分類の分岐（BAMIC × 筋 × 部位）
//   プロトコル一覧は増やさず、ハムストリングを選んだ選手にだけ出す
// ============================================================
function HamstringClassificationCard({ orgId, player, protocol, readOnly, onSaved }) {
  const [grade, setGrade] = useState(player.bamicGrade ?? "");
  const [muscle, setMuscle] = useState(player.hamstringMuscle ?? "");
  const [location, setLocation] = useState(player.hamstringLocation ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [stats, setStats] = useState(null);

  const isHamstring = protocol?.classificationScheme === "hamstring";

  useEffect(() => {
    let active = true;
    if (!isHamstring || !player.bamicGrade || !player.hamstringMuscle || !player.hamstringLocation) {
      setStats(null);
      return;
    }
    sbSelect(
      "hamstring_recovery_by_classification",
      `?org_id=eq.${encodeURIComponent(orgId)}` +
        `&bamic_grade=eq.${encodeURIComponent(player.bamicGrade)}` +
        `&hamstring_muscle=eq.${encodeURIComponent(player.hamstringMuscle)}` +
        `&hamstring_location=eq.${encodeURIComponent(player.hamstringLocation)}&select=*`
    )
      .then((rows) => {
        if (active) setStats(rows?.[0] ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [orgId, isHamstring, player.bamicGrade, player.hamstringMuscle, player.hamstringLocation]);

  if (!isHamstring) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const patch = {
        bamic_grade: grade || null,
        hamstring_muscle: muscle || null,
        hamstring_location: location || null,
      };
      await sbUpdate("players", player.id, patch);
      onSaved?.({
        bamicGrade: patch.bamic_grade,
        hamstringMuscle: patch.hamstring_muscle,
        hamstringLocation: patch.hamstring_location,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert(`保存に失敗しました: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const summary =
    player.bamicGrade && player.hamstringMuscle && player.hamstringLocation
      ? `BAMIC ${player.bamicGrade}／${MUSCLE_LABELS[player.hamstringMuscle]}／${
          LOCATION_LABELS[player.hamstringLocation]
        }`
      : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5">
        <Activity size={16} className="text-blue-600" /> ハムストリング損傷の分類
      </p>
      <p className="text-[11px] text-slate-400 mb-3">
        プロトコルの中身は共通です。部位・重症度別に復帰期間を追跡するために記録します。
      </p>

      {readOnly ? (
        <p className="text-sm text-slate-700">{summary ?? "未登録（指導者が入力します）"}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-slate-500">BAMIC</label>
              <select
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mt-0.5 bg-white"
              >
                <option value="">未選択</option>
                {BAMIC_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500">損傷筋</label>
              <select
                value={muscle}
                onChange={(e) => setMuscle(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mt-0.5 bg-white"
              >
                <option value="">未選択</option>
                {HAMSTRING_MUSCLES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500">部位</label>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mt-0.5 bg-white"
              >
                <option value="">未選択</option>
                {HAMSTRING_LOCATIONS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[10px] text-slate-400 mt-2">
            {BAMIC_NOTES.a}／{BAMIC_NOTES.b}／{BAMIC_NOTES.c}
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 disabled:bg-slate-300"
            >
              {saving ? "保存中..." : "分類を保存"}
            </button>
            {saved && <span className="text-xs text-green-600">保存しました</span>}
          </div>
        </>
      )}

      {stats && stats.sample_size > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs text-blue-600 flex items-start gap-1">
            <TrendingUp size={14} className="shrink-0 mt-0.5" />
            同じ分類（{summary}）で完遂した過去{stats.sample_size}人の受傷〜完遂日数は
            平均 {stats.avg_days}日（最短 {stats.min_days}日 / 最長 {stats.max_days}日）でした。
          </p>
        </div>
      )}
      {summary && (!stats || stats.sample_size === 0) && (
        <p className="text-[11px] text-slate-400 mt-3 pt-3 border-t border-slate-100">
          この分類で完遂した選手のデータはまだありません。蓄積されると平均復帰期間が表示されます。
        </p>
      )}
    </div>
  );
}

// ============================================================
// 患部外トレーニング（11領域）
//   coach: 領域・項目を選手ごとに処方 / player: 処方されたものを閲覧
// ============================================================
function OffsiteTrainingPanel({ orgId, player, readOnly, onChanged }) {
  const [domains, setDomains] = useState([]);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState([]); // item_id の配列
  const [loading, setLoading] = useState(true);
  const [loadFilter, setLoadFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      sbSelect(
        "offsite_domains",
        `?or=(org_id.is.null,org_id.eq.${encodeURIComponent(orgId)})&select=*&order=sort_order.asc`
      ),
      sbSelect("offsite_items", `?select=*&order=sort_order.asc`),
      sbSelect(
        "player_offsite_selections",
        `?player_id=eq.${encodeURIComponent(player.id)}&select=item_id`
      ),
    ])
      .then(([d, i, s]) => {
        if (!active) return;
        setDomains(d || []);
        setItems(i || []);
        setSelected((s || []).map((r) => r.item_id));
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [orgId, player.id]);

  const applyPreset = (preset) => {
    setLoadFilter(preset.load);
    setRegionFilter(preset.region);
  };

  const toggle = async (itemId) => {
    const isSelected = selected.includes(itemId);
    setSelected((prev) => (isSelected ? prev.filter((x) => x !== itemId) : [...prev, itemId]));
    try {
      if (isSelected) {
        await sb_deleteSelection(player.id, itemId);
      } else {
        await sbInsert("player_offsite_selections", { player_id: player.id, item_id: itemId });
      }
      onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  };

  const visibleItems = (domainId) =>
    items.filter((it) => {
      if (it.domain_id !== domainId) return false;
      if (readOnly && !selected.includes(it.id)) return false;
      if (loadFilter === "unloaded" && it.load_type !== "unloaded") return false;
      if (loadFilter === "unloaded_partial" && it.load_type === "full") return false;
      if (regionFilter !== "all" && it.region !== regionFilter) return false;
      return true;
    });

  const regionsInUse = Array.from(new Set(items.map((i) => i.region).filter(Boolean)));

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex items-center gap-2 text-slate-400 text-sm">
        <Loader2 size={16} className="animate-spin" /> 患部外トレーニングを読み込み中...
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5">
        <Dumbbell size={16} className="text-blue-600" /> 患部外トレーニング（全11領域）
      </p>
      <p className="text-[11px] text-slate-400 mb-3">
        走練習が制限される期間を利用して、普段十分に取り組みにくい身体機能を改善します。
        {readOnly ? "指導者が選んだ領域が表示されます。" : "選手ごとに必要な領域だけを選択してください。"}
      </p>

      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      {!readOnly && (
        <>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {OFFSITE_PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => applyPreset(p)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  loadFilter === p.load && regionFilter === p.region
                    ? "border-blue-500 bg-blue-50 text-blue-700 font-bold"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <select
              value={loadFilter}
              onChange={(e) => setLoadFilter(e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white"
            >
              <option value="all">荷重：すべて</option>
              <option value="unloaded">免荷で可能なものだけ</option>
              <option value="unloaded_partial">免荷＋部分荷重まで</option>
            </select>
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white"
            >
              <option value="all">部位：すべて</option>
              {regionsInUse.map((r) => (
                <option key={r} value={r}>
                  {REGION_LABELS[r] ?? r}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className="space-y-3">
        {domains.map((d) => {
          const list = visibleItems(d.id);
          if (list.length === 0) return null;
          return (
            <div key={d.id} className="border border-slate-200 rounded-lg p-3">
              <p className="text-xs font-bold text-slate-700">
                {d.code}｜{d.title}
              </p>
              {d.purpose && <p className="text-[10px] text-slate-400 mt-0.5">{d.purpose}</p>}
              <div className="mt-2 space-y-1">
                {list.map((it) => {
                  const isOn = selected.includes(it.id);
                  const row = (
                    <>
                      <span className="flex-1 text-left">
                        <span className="text-xs text-slate-700">
                          {it.category ? `${it.category} ` : ""}
                          {it.name}
                        </span>
                        {it.examples && (
                          <span className="block text-[10px] text-slate-400">{it.examples}</span>
                        )}
                        {it.notes && (
                          <span className="block text-[10px] text-amber-600">※{it.notes}</span>
                        )}
                      </span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                          LOAD_BADGE[it.load_type]
                        }`}
                      >
                        {LOAD_LABELS[it.load_type]}
                      </span>
                    </>
                  );
                  return readOnly ? (
                    <div key={it.id} className="flex items-start gap-2 px-2 py-1.5 rounded bg-slate-50">
                      {row}
                    </div>
                  ) : (
                    <button
                      key={it.id}
                      onClick={() => toggle(it.id)}
                      className={`w-full flex items-start gap-2 px-2 py-1.5 rounded border transition-colors ${
                        isOn ? "border-blue-400 bg-blue-50" : "border-transparent hover:bg-slate-50"
                      }`}
                    >
                      {isOn ? (
                        <CheckCircle2 size={14} className="text-blue-600 shrink-0 mt-0.5" />
                      ) : (
                        <Circle size={14} className="text-slate-300 shrink-0 mt-0.5" />
                      )}
                      {row}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {domains.every((d) => visibleItems(d.id).length === 0) && (
          <p className="text-xs text-slate-400">
            {readOnly
              ? "まだ患部外トレーニングが処方されていません。"
              : "この条件に一致する項目がありません。フィルタを変更してください。"}
          </p>
        )}
      </div>

      {!readOnly && (
        <p className="text-[10px] text-slate-400 mt-3">選択中：{selected.length}項目</p>
      )}
    </div>
  );
}

// player_offsite_selections は複合キーなので id 指定の sbDelete が使えない
async function sb_deleteSelection(playerId, itemId) {
  return sb(
    `player_offsite_selections?player_id=eq.${encodeURIComponent(playerId)}&item_id=eq.${itemId}`,
    { method: "DELETE", prefer: "return=minimal" }
  );
}

// ============================================================
// 累積メニュー
//   「PHASEが進んでも前PHASEのTrainingを終了するわけではない」
//   今日のメニュー = intro_phase <= 現在PHASE かつ 未終了 の和集合
// ============================================================
function CumulativeMenuPanel({ player, protocol, readOnly, onChanged }) {
  const [exercises, setExercises] = useState([]);
  const [steps, setSteps] = useState([]);
  const [progress, setProgress] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    if (!protocol?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      sbSelect(
        "exercises",
        `?protocol_id=eq.${encodeURIComponent(protocol.id)}&select=*&order=sort_order.asc`
      ),
      sbSelect("exercise_steps", `?select=*&order=step_order.asc`),
      sbSelect(
        "player_exercise_progress",
        `?player_id=eq.${encodeURIComponent(player.id)}&select=*`
      ),
    ])
      .then(([e, s, p]) => {
        if (!active) return;
        setExercises(e || []);
        setSteps(s || []);
        setProgress(p || []);
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [protocol?.id, player.id]);

  const progressOf = (exId) => progress.find((p) => p.exercise_id === exId);
  const stepsOf = (exId) => steps.filter((s) => s.exercise_id === exId);

  const saveProgress = async (exId, patch) => {
    const existing = progressOf(exId);
    try {
      const row = {
        player_id: player.id,
        exercise_id: exId,
        current_step: patch.current_step ?? existing?.current_step ?? 1,
        terminated: patch.terminated ?? existing?.terminated ?? false,
        updated_at: new Date().toISOString(),
      };
      const [saved] = await sbUpsert("player_exercise_progress", row, "player_id,exercise_id");
      setProgress((prev) => {
        const others = prev.filter((p) => p.exercise_id !== exId);
        return [...others, saved];
      });
      onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  };

  const current = exercises.filter(
    (e) => e.intro_phase <= player.currentPhase && !progressOf(e.id)?.terminated
  );
  const upcoming = exercises.filter((e) => e.intro_phase > player.currentPhase);
  const terminated = exercises.filter((e) => progressOf(e.id)?.terminated);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex items-center gap-2 text-slate-400 text-sm">
        <Loader2 size={16} className="animate-spin" /> メニューを読み込み中...
      </div>
    );
  }
  if (exercises.length === 0) return null;

  const renderExercise = (e) => {
    const prog = progressOf(e.id);
    const exSteps = stepsOf(e.id);
    const stepIdx = (prog?.current_step ?? 1) - 1;
    const step = exSteps[stepIdx] ?? null;
    const loadKg = toActualLoadKg(step?.load_percent_bw, player.bodyWeightKg);
    const timeSec = toActualTimeSec(step?.speed_percent, player.baselineTimeSec);

    return (
      <div key={e.id} className="border border-slate-200 rounded-lg p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <p className="text-xs font-bold text-slate-700">{e.name}</p>
            <p className="text-[10px] text-slate-400">
              PHASE {e.intro_phase} 導入
              {e.continues ? "・以降も継続" : ""}
              {e.prescription ? `・${e.prescription}` : ""}
            </p>
          </div>
          {!e.is_gate_exercise && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
              GATE種目外
            </span>
          )}
        </div>

        {e.notes && <p className="text-[10px] text-amber-600 mt-1">※{e.notes}</p>}

        {exSteps.length > 0 && (
          <div className="mt-2 bg-slate-50 rounded px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1">
                <p className="text-[10px] text-slate-400">
                  ステップ {stepIdx + 1}/{exSteps.length}
                </p>
                <p className="text-xs text-slate-700">{step?.label ?? "—"}</p>
                {step?.target && <p className="text-[10px] text-slate-500">{step.target}</p>}
                {loadKg !== null && (
                  <p className="text-[10px] text-blue-600">
                    {step.load_percent_bw}%BW → 約 {loadKg}kg
                  </p>
                )}
                {timeSec !== null && (
                  <p className="text-[10px] text-blue-600">
                    {step.speed_percent}% → {player.baselineDistanceM ?? 100}m 約 {timeSec}秒
                  </p>
                )}
                {(step?.load_percent_bw && !player.bodyWeightKg) ||
                (step?.speed_percent && !player.baselineTimeSec) ? (
                  <p className="text-[10px] text-slate-400">
                    体重・基準タイムを入力すると実数に換算されます
                  </p>
                ) : null}
              </div>
              {!readOnly && (
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => saveProgress(e.id, { current_step: Math.max(1, stepIdx) })}
                    disabled={stepIdx <= 0}
                    className="p-1 rounded border border-slate-200 text-slate-500 disabled:opacity-30 hover:bg-white"
                    title="前のステップへ"
                  >
                    <ArrowLeft size={12} />
                  </button>
                  <button
                    onClick={() =>
                      saveProgress(e.id, { current_step: Math.min(exSteps.length, stepIdx + 2) })
                    }
                    disabled={stepIdx >= exSteps.length - 1}
                    className="p-1 rounded border border-slate-200 text-blue-600 disabled:opacity-30 hover:bg-white"
                    title="次のステップへ"
                  >
                    <ArrowRight size={12} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {!readOnly && (
          <button
            onClick={() => saveProgress(e.id, { terminated: !prog?.terminated })}
            className="text-[10px] text-slate-400 hover:text-red-500 underline mt-1.5"
          >
            {prog?.terminated ? "メニューに戻す" : "この種目を終了する"}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5">
          <Dumbbell size={16} className="text-blue-600" /> 今日のメニュー（PHASE {player.currentPhase}時点）
        </p>
        <p className="text-[11px] text-slate-400 mb-3">
          PHASEが進んでも前PHASEのTrainingは終了しません。解禁済みの種目がすべて表示されます。
        </p>
        <div className="space-y-2">{current.map(renderExercise)}</div>
      </div>

      {upcoming.length > 0 && (
        <div className="bg-white rounded-2xl border border-red-100 p-5 shadow-sm">
          <p className="text-sm font-bold text-red-600 mb-1 flex items-center gap-1.5">
            <Ban size={16} /> まだ行わない種目
          </p>
          <p className="text-[11px] text-slate-400 mb-3">
            GATEを通過するまで実施しません。やることリストより、やってはいけないリストのほうが現場では効きます。
          </p>
          <ul className="space-y-1">
            {upcoming.map((e) => (
              <li key={e.id} className="text-xs text-slate-600 flex items-center justify-between bg-red-50 rounded px-2 py-1.5">
                <span>{e.name}</span>
                <span className="text-[10px] text-red-500 font-bold shrink-0 ml-2">
                  PHASE {e.intro_phase} で解禁
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!readOnly && terminated.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-bold text-slate-500 mb-2">終了した種目（{terminated.length}）</p>
          <div className="space-y-2">{terminated.map(renderExercise)}</div>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
