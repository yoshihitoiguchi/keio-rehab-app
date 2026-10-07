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
  Smartphone,
  X,
  Home,
  MoreHorizontal,
  BookOpen,
  Bell,
  Repeat,
  Megaphone,
  HelpCircle,
  Download,
  Pencil,
  Save,
} from "lucide-react";
import {
  SUPABASE_URL,
  AUTH_LOST_EVENT,
  apiHeaders,
  currentAuth,
  hasAuthSession,
  ensureAnonymousSession,
  signInWithPassword,
  signOut,
} from "./lib/auth.js";
import { pushState, enablePush, disablePush, refreshPush } from "./lib/push.js";

// ============================================================
// Supabase 接続設定とログイン状態は src/lib/auth.js にまとめてある。
// REST・Storage には、ログイン中の利用者のトークンを付けて送る
// （RLS が「自分の組織のデータだけ」に絞る）。
// ============================================================
async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    body: options.body,
    headers: await apiHeaders({
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let serverMessage = null;
    try {
      serverMessage = JSON.parse(text).message || null;
    } catch {
      serverMessage = null;
    }
    // 画面に出す文は日本語にする。DB の関数が出した日本語の文があれば、それを使う
    const jp = serverMessage && /[ぁ-んァ-ン一-龥]/.test(serverMessage) ? serverMessage : null;
    const err = new Error(
      jp ||
        (res.status === 401 || res.status === 403
          ? "この操作はできません。ログインし直してからお試しください。"
          : res.status >= 500
          ? "サーバーが混み合っています。少し待ってからお試しください。"
          : `うまくいきませんでした（${res.status}）。もう一度お試しください。`)
    );
    err.status = res.status;
    err.serverMessage = serverMessage;
    err.detail = text || res.statusText; // 調査用（画面には出さない）
    throw err;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// DB の関数（RPC）を呼ぶ。関数が出した日本語のエラー文をそのまま画面に出せるようにする。
async function sbRpc(name, args = {}) {
  try {
    return await sb(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
  } catch (err) {
    if (err.status === 404) {
      throw new Error("サーバー側の準備（データベースの更新 v15）がまだ済んでいません。");
    }
    throw new Error(err.serverMessage || err.message);
  }
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

// ============================================================
// 写真・動画のアップロード（Supabase Storage）
//   スマホのカメラロールやカメラから直接送れるようにする。
//   動画は1本50MBまで、保存は90日（サーバー側で削除）。
// ============================================================
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB
const ATTACHMENT_BUCKET = "attachments";

function formatBytes(n) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${Math.round((n / 1024 / 1024) * 10) / 10}MB`;
}

async function uploadAttachment(file, { playerId, orgId, context, contextId }) {
  const isVideo = file.type.startsWith("video/");
  const kind = isVideo ? "video" : "image";
  const limit = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

  if (file.size > limit) {
    throw new Error(
      `${isVideo ? "動画" : "写真"}は${formatBytes(limit)}までです（選んだファイルは${formatBytes(file.size)}）`
    );
  }

  const ext = (file.name.split(".").pop() || (isVideo ? "mp4" : "jpg")).toLowerCase();
  const path = `${playerId}/${context}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${ATTACHMENT_BUCKET}/${encodeURI(path)}`,
    {
      method: "POST",
      headers: await apiHeaders({
        "Content-Type": file.type || "application/octet-stream",
      }),
      body: file,
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`アップロードに失敗しました: ${text || res.statusText}`);
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${ATTACHMENT_BUCKET}/${encodeURI(path)}`;

  const [row] = await sbInsert("media_attachments", {
    player_id: playerId,
    org_id: orgId || null,
    storage_path: path,
    public_url: publicUrl,
    mime_type: file.type || null,
    byte_size: file.size,
    kind,
    context,
    context_id: contextId != null ? String(contextId) : null,
  });

  return { id: row?.id ?? null, url: publicUrl, kind, size: file.size };
}

// 写真・動画を選んで送るボタン（スマホではカメラ／ライブラリが開く）
function MediaUploadButton({ playerId, orgId, context, contextId, onUploaded, label }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = React.useRef(null);

  const handleChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await uploadAttachment(file, { playerId, orgId, context, contextId });
      onUploaded?.(result);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <span className="inline-flex flex-col">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        onChange={handleChange}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center justify-center gap-1 min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-600 hover:text-blue-600 hover:border-blue-300 disabled:opacity-40"
      >
        {busy ? "アップロード中..." : label || "写真・動画を追加"}
      </button>
      {error && <span className="text-xs text-red-500 mt-1">{error}</span>}
    </span>
  );
}

// 添付のプレビュー（画像はそのまま、動画は再生できる形で出す）
function AttachmentPreview({ url, kind }) {
  if (!url) return null;
  if (kind === "video") {
    return (
      <video src={url} controls playsInline className="w-full max-w-xs rounded-lg mt-1.5 bg-black" />
    );
  }
  return <img src={url} alt="添付" className="w-full max-w-xs rounded-lg mt-1.5" />;
}

// 画面に出すリンクは http / https だけにする（javascript: などを埋め込まれても実行させない）
function safeHref(url) {
  const text = String(url || "").trim();
  if (!text) return undefined; // 空のときは「リンクなし」（以前は、いまのページの URL を返していた）
  try {
    const u = new URL(text); // http(s) で始まる完全な URL だけ
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

// 画面に出すエラー文。日本語の文（DB の関数や自分で書いたもの）はそのまま、それ以外は日本語の定型文にする
// （英語のエラー文をそのまま見せない）
function errText(err) {
  const m = String(err?.message || "");
  if (/[ぁ-んァ-ン一-龥]/.test(m)) return m;
  if (err instanceof TypeError && /fetch|load|network/i.test(m)) {
    return "通信できませんでした。電波のよいところで、もう一度お試しください。";
  }
  return "うまくいきませんでした。もう一度お試しください。";
}

// 画面右上に表示するビルド識別子。
// デプロイが反映されているかを一目で確認するためのもの。
const APP_BUILD = "v15.22";

// ==================================================================
// ログイン状態をこの端末に保存する（ホーム画面アプリ用）
//   毎回パスワードと暗証番号を入れ直さずに済むようにする。
//   保存先はこの端末のブラウザの中だけで、サーバーには送りません。
//   ・組織ログイン ... 30日間
//   ・選手ログイン ... 「自分の端末として記憶する」を選んだときだけ 30日間
//   共用端末ではチェックを外してください。ログアウトすると消えます。
// ==================================================================
const SESSION_DAYS = 30;
const ORG_SESSION_KEY = "resprint.org";
const PLAYER_SESSION_KEY = "resprint.player";

function readSession(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || !saved.expiresAt || Date.now() > saved.expiresAt) {
      window.localStorage.removeItem(key);
      return null;
    }
    return saved.value ?? null;
  } catch {
    // プライベートブラウズなどで localStorage が使えないことがある。
    // その場合は「保存されていない」として通常どおり動かす。
    return null;
  }
}

// ------------------------------------------------------------------
// 確認・入力・お知らせのダイアログ（ブラウザ標準の confirm / prompt / alert の代わり）
//   どこからでも await askConfirm(...) のように呼べる。表示は DialogHost（App の一番外）が行う。
// ------------------------------------------------------------------
let dialogOpener = null;
function openDialog(spec) {
  return new Promise((resolve) => {
    if (!dialogOpener) {
      resolve(spec.kind === "confirm" ? false : null);
      return;
    }
    dialogOpener({ ...spec, resolve });
  });
}
const askConfirm = (title, opts = {}) => openDialog({ kind: "confirm", title, ...opts }); // → true / false
const askText = (title, opts = {}) => openDialog({ kind: "text", title, ...opts }); // → 文字列 / null（やめる）
const showMessage = (title, opts = {}) => openDialog({ kind: "message", title, ...opts });

function DialogHost() {
  const [spec, setSpec] = useState(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    dialogOpener = (next) => {
      setValue(next.initial || "");
      setSpec(next);
    };
    return () => {
      dialogOpener = null;
    };
  }, []);
  if (!spec) return null;
  const close = (result) => {
    spec.resolve(result);
    setSpec(null);
  };
  const cancel = () => close(spec.kind === "confirm" ? false : null);
  const submit = () => close(spec.kind === "confirm" ? true : spec.kind === "text" ? value : null);
  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/50 flex items-end sm:items-center justify-center print:hidden"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && cancel()}
    >
      <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 safe-bottom">
        <p className="text-base font-bold text-slate-800">{spec.title}</p>
        {spec.body && <p className="text-sm text-slate-500 mt-2 leading-relaxed whitespace-pre-wrap">{spec.body}</p>}
        {spec.kind === "text" && spec.multiline && (
          <textarea
            autoFocus
            rows={4}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={spec.placeholder || ""}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mt-3"
          />
        )}
        {spec.kind === "text" && !spec.multiline && (
          <input
            autoFocus
            inputMode={spec.inputMode}
            maxLength={spec.maxLength}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => isEnterKey(e) && submit()}
            placeholder={spec.placeholder || ""}
            readOnly={spec.readOnly}
            onFocus={(e) => spec.readOnly && e.target.select()}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mt-3"
          />
        )}
        <div className="flex gap-2 mt-5">
          {spec.kind !== "message" && !spec.readOnly && (
            <button onClick={cancel} className="flex-1 py-3 rounded-lg border border-slate-300 text-slate-600 text-sm">
              やめる
            </button>
          )}
          <button
            onClick={spec.readOnly ? cancel : submit}
            className={`flex-1 py-3 rounded-lg text-white text-sm font-bold ${spec.danger ? "bg-red-600" : "bg-blue-600"}`}
          >
            {spec.okLabel || (spec.kind === "message" || spec.readOnly ? "閉じる" : "OK")}
          </button>
        </div>
      </div>
    </div>
  );
}

// Enter で送信する入力欄用。日本語入力の変換確定の Enter では送信しない
function isEnterKey(e) {
  return e.key === "Enter" && !e.nativeEvent?.isComposing && e.keyCode !== 229;
}

// ------------------------------------------------------------------
// 入力途中の下書き（日報・チャット）
//   アプリの更新や電池切れで画面が読み込み直されても、書きかけが消えないようにする。
//   この端末の中だけに保存し、送信したら消す。
// ------------------------------------------------------------------
function readDraft(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeDraft(key, value) {
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できなくても入力は続けられる
  }
}

function writeSession(key, value) {
  try {
    if (value === null || value === undefined) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(
      key,
      JSON.stringify({ value, expiresAt: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000 })
    );
  } catch {
    // 保存できなくても動作は続ける
  }
}

// ==================================================================
// 端末の見分け（ホーム画面への追加の案内に使う）
// ==================================================================
function isStandaloneApp() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

// iPadOS 13 以降の Safari は Mac と名乗るので、タッチ対応かどうかで見分ける
function isIOSDevice() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

function isAndroidDevice() {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

// LINE・Instagram などのアプリの中のブラウザ（ここからはホーム画面に追加できない）
function inAppBrowserName() {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/\bLine\//i.test(ua)) return "LINE";
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "Facebook";
  if (/MicroMessenger/i.test(ua)) return "WeChat";
  if (/KAKAOTALK/i.test(ua)) return "KakaoTalk";
  return null;
}

// Android の「アプリとして追加」の合図は、画面が出る前に来ることがあるので、ここで受け取っておく
let deferredInstallPrompt = null;
const INSTALLABLE_EVENT = "resprint:installable";
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    window.dispatchEvent(new Event(INSTALLABLE_EVENT));
  });
}

function useInstallPrompt() {
  const [prompt, setPrompt] = useState(() => deferredInstallPrompt);
  useEffect(() => {
    const on = () => setPrompt(deferredInstallPrompt);
    window.addEventListener(INSTALLABLE_EVENT, on);
    return () => window.removeEventListener(INSTALLABLE_EVENT, on);
  }, []);
  const install = async () => {
    const p = prompt || deferredInstallPrompt;
    if (!p) return false;
    p.prompt();
    const choice = await p.userChoice.catch(() => null);
    deferredInstallPrompt = null;
    setPrompt(null);
    return choice?.outcome === "accepted";
  };
  return { canInstall: Boolean(prompt), install };
}

// ==================================================================
// 招待リンク
//   管理者が組織ごとに発行し、LINE などでメンバーに送る。
//   開くだけで組織ログインが済む（組織ID とパスワードを URL の # 以降に入れる）。
//   # 以降はサーバーに送られない。読み取ったらすぐアドレス欄から消す。
//   iPhone はホーム画面のアプリと Safari でログインが別なので、
//   ホーム画面のアプリではリンクを「貼り付けて」入れるようにしている。
// ==================================================================
function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(token) {
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function makeInviteLink(orgId, password) {
  const token = toBase64Url(JSON.stringify({ o: orgId, p: password }));
  return `${window.location.origin}/#join=${token}`;
}

// 招待リンク（またはその一部）から { o: 組織ID, p: パスワード } を取り出す。読めなければ null
function parseInvite(text) {
  const m = String(text || "").match(/join=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const v = JSON.parse(fromBase64Url(m[1]));
    return v && typeof v.o === "string" && typeof v.p === "string" ? v : null;
  } catch {
    return null;
  }
}

// ページを開いたときの URL に招待が入っていれば取り出す（読むだけ。消すのは clearInviteFromUrl）
function readInviteFromUrl() {
  if (typeof window === "undefined") return null;
  return parseInvite(window.location.hash);
}

// アドレス欄から招待の情報（パスワードを含む）を消す
function clearInviteFromUrl() {
  if (typeof window === "undefined" || !window.location.hash.includes("join=")) return;
  // LINE などの中で開いたときは残す（「Safari で開く」を押したときに招待がそのまま引き継がれるように）
  if (inAppBrowserName()) return;
  try {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch {
    window.location.hash = "";
  }
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
    // よくある質問（プロトコルごと。指導者が編集する）
    faq: (Array.isArray(row.faq) ? row.faq : []).filter((f) => f && typeof f.q === "string" && typeof f.a === "string"),
    // 「続ける種目」の案内（設定のあるプロトコルだけ。なければ null）
    continueRule: normalizeContinueRule(row.continue_rule),
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
        fear: r.fear_level ?? null,
        slippingContact: r.slipping_contact ?? null,
        rpe: r.rpe ?? null,
        selfCompensation: r.self_compensation ?? null,
        selfSevereSymptom: r.self_severe_symptom ?? null,
        observedBy: r.observed_by ?? null,
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
    reportComments: row.report_comments || [],
    consultations: (row.consultation_requests || [])
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(normalizeConsultation),
  };
}
// 面談の申し込み。status：requested（未対応）→ closed（対応済み）
function normalizeConsultation(row) {
  return { id: row.id, note: row.note || "", status: row.status || "requested", createdAt: row.created_at };
}
function pendingConsultations(player) {
  return (player?.consultations || []).filter((c) => c.status !== "closed");
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

// 痛みの目盛りの説明（医師とコーチが定めた目安の言葉。値によって文面を変えるものではない）
const VAS_ANCHORS = [
  { v: 0, label: "完全に無痛・全く気にならない" },
  { v: 3, label: "痛みはあるが、練習には集中できる（許容範囲）" },
  { v: 5, label: "痛みが気になって思い通りの動きができない（代償動作が出る）" },
  { v: 8, label: "これ以上やると確実に悪化する・かばうことすらできない" },
  { v: 10, label: "これまで経験した最大の痛み・激痛" },
];
const MENTAL_FACES = ["😞", "😕", "😐", "🙂", "😄"];
const PLAYER_FIELDS =
  "*,reports(*),messages(*),treatments(*),phase_history(*),player_exercise_progress(*),consultation_requests(*),report_comments(*)";
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

// ============================================================
// アプリは判定しない。入力と、それに当てはまるプロトコルの基準を並べて示す。
// 文言は医師・コーチが定めた原文のまま使う（言い換えない）。
// ============================================================
const STOP_CRITERIA = [
  {
    id: "vas7",
    text: "痛みが7以上の日は、その日のメニューを中止する",
    match: (r) => r.vas >= 7,
    fact: (r) => `痛み ${r.vas}`,
  },
  {
    id: "vas_jump",
    text: "痛みが前日から3以上増えた日は、その日のメニューを中止する",
    match: (r) => r.prevVas !== null && r.prevVas !== undefined && r.vas - r.prevVas >= 3,
    fact: (r) => `前日 ${r.prevVas} → 今日 ${r.vas}`,
  },
  {
    id: "severe",
    text: "歩行が困難な鋭い痛みがある日は、その日のメニューを中止する",
    match: (r) => Boolean(r.severeSymptom),
    fact: () => "歩行が困難な鋭い痛み あり",
  },
];
const REDUCE_CRITERIA = [
  {
    id: "vas46",
    text: "痛みが4〜6の日は、負荷・メニューを下げる",
    match: (r) => r.vas >= 4 && r.vas <= 6,
    fact: (r) => `痛み ${r.vas}`,
  },
  {
    id: "comp",
    text: "代償動作がある日は、負荷・メニューを下げる",
    match: (r) => Boolean(r.compensation),
    fact: () => "代償動作 あり",
  },
];
// 中止の基準を先に置く
function matchedCriteria(r) {
  return [...STOP_CRITERIA, ...REDUCE_CRITERIA]
    .filter((c) => c.match(r))
    .map((c) => ({ id: c.id, text: c.text, fact: c.fact(r) }));
}

// 入力内容に関係なく常に出す注記（出し分けない）
const DISCLAIMER_MAIN =
  "このアプリは診断を行いません。表示される基準は、医師とコーチが定めた目安です。診断と治療方針は診断した医師に従ってください。";
const DISCLAIMER_SYMPTOM =
  "しびれ、安静時や夜間の痛み、練習中の急な強い痛みなど、気になる症状があるときは医療機関に相談してください。";

function StandingNotice() {
  return (
    <div className="bg-slate-100 border border-slate-200 rounded-xl p-3 space-y-1">
      <p className="text-[11px] text-slate-600 leading-relaxed">{DISCLAIMER_MAIN}</p>
      <p className="text-[11px] text-slate-600 leading-relaxed">{DISCLAIMER_SYMPTOM}</p>
    </div>
  );
}

// 「今日の入力に当てはまる基準」を並べて示すだけのコンポーネント
function CriteriaResult({ report, staffView }) {
  const matched = matchedCriteria(report);
  return (
    <div className="space-y-2">
      {!staffView && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          <p className="text-xs text-blue-700 font-bold">指導者に送信しました</p>
        </div>
      )}
      <div>
        {!staffView && <p className="text-xs font-bold text-slate-700 mb-1.5">今日の入力に当てはまる基準</p>}
        {matched.length === 0 ? (
          <div className="border border-slate-200 rounded-lg px-3 py-2">
            <p className="text-sm text-slate-700">継続</p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {matched.map((c) => (
              <li key={c.id} className="border border-slate-200 rounded-lg px-3 py-2">
                <p className="text-sm text-slate-800">{c.text}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">— {c.fact}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* 基準を出す場所には、入力内容にかかわらず同じ注記を添える */}
      <p className="text-[11px] text-slate-500 leading-relaxed">{DISCLAIMER_MAIN}</p>
    </div>
  );
}


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

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// 今日の日付（端末の時刻）。以前は UTC で作っていて、朝9時までは前日の日付になっていた
function todayStr() {
  return localDateStr(new Date());
}
function reportedToday(player) {
  return (player?.reports || []).some((r) => r.date === todayStr());
}
// 日報を何日続けて送っているか（今日まだなら、昨日までの連続）
function reportStreak(reports) {
  const days = new Set((reports || []).map((r) => r.date).filter(Boolean));
  const d = new Date();
  if (!days.has(localDateStr(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(localDateStr(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
function latestReport(player) {
  if (!player.reports.length) return null;
  return player.reports[player.reports.length - 1];
}
// SOSは「選手からスタッフへの連絡」。判定ではない。
function isAlert(player) {
  return Boolean(player.sos);
}
// 分類バリアントの短縮ラベル（例：BAMIC 2b / 大腿二頭筋 / 近位）
function classificationLabel(player) {
  if (!player?.bamicGrade || !player?.hamstringMuscle || !player?.hamstringLocation) return null;
  const m = { semimembranosus: "半膜様筋", semitendinosus: "半腱様筋", biceps_femoris: "大腿二頭筋" };
  const l = { proximal: "近位", mid_distal: "中間位〜遠位" };
  return `BAMIC ${player.bamicGrade} / ${m[player.hamstringMuscle] ?? player.hamstringMuscle} / ${l[player.hamstringLocation] ?? player.hamstringLocation}`;
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
// 面談の枠を公開する条件：コーチ・トレーナー・ドクターのうち、この人数以上の空きが一致した日時
const MEETING_MIN_STAFF = 2;
function matchedStaffCount(roleSet) {
  return ["coach", "trainer", "doctor"].filter((r) => roleSet.has(r)).length;
}
// 受傷からこの日数を過ぎても面談をしていない選手に、面談の案内を出す（チームの決まり。症状の入力とは関係しない）
const MEETING_REMINDER_DAYS = 14;
function meetingAlertLevel(player, slots) {
  if (!player.injuryDate || player.completedAt) return null;
  const held = slots.some((s) => s.bookedBy === player.id && parseDatetime(s.datetime) <= new Date());
  if (held) return null;
  const elapsed = daysSince(player.injuryDate);
  if (elapsed >= MEETING_REMINDER_DAYS) return "yellow";
  return null;
}
// これからの面談の予約（あれば、その枠）
function upcomingMeeting(player, slots) {
  return (
    slots
      .filter((s) => s.bookedBy === player.id && parseDatetime(s.datetime) > new Date())
      .sort((a, b) => a.datetime.localeCompare(b.datetime))[0] || null
  );
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
      if (!videoId && (u.pathname.startsWith("/embed/") || u.pathname.startsWith("/shorts/"))) videoId = u.pathname.split("/")[2];
    }
    return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
  } catch {
    return null;
  }
}

// ==================================================================
// ==================================================================
// 新しいバージョンのお知らせ
//   公開のたびに画面を勝手に読み込み直すと、日報やチャットを書いている途中の選手が困る。
//   そこで、新しい版が出たら「更新する」ボタンを出し、押したときだけ読み込み直す。
//   ・アプリを30分以上使っていなかった（裏に回っていた）ときは、戻ってきたときに自動で更新する
//     （書きかけの日報・チャットは端末に下書きとして残るので消えない）
//   ・確認は /version.json（ビルドごとに変わる）を見るだけ。開発サーバーでは行わない。
// ==================================================================
const COACH_REFRESH_INTERVAL = 60 * 1000;
const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000;

// ホーム画面のアイコンに、未読・要対応の数を付ける（対応している端末だけ。アプリが動いている間に更新される）
function setIconBadge(count) {
  try {
    if (count > 0) navigator.setAppBadge?.(count);
    else navigator.clearAppBadge?.();
  } catch {
    // 対応していない端末では何もしない
  }
}
const AUTO_RELOAD_AFTER_HIDDEN = 30 * 60 * 1000;

async function fetchLatestBuild() {
  const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data?.build === "string" ? data.build : null;
}

function UpdateNotice() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD) return undefined;
    let hiddenAt = null;
    let latestKnown = false;
    const check = async () => {
      try {
        const latest = await fetchLatestBuild();
        latestKnown = Boolean(latest && latest !== __BUILD_ID__);
        if (latestKnown) setAvailable(true);
      } catch {
        // 圏外などでは何もしない
      }
      return latestKnown;
    };
    const onVisibility = async () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const longAway = hiddenAt && Date.now() - hiddenAt >= AUTO_RELOAD_AFTER_HIDDEN;
      hiddenAt = null;
      if ((await check()) && longAway) window.location.reload();
    };
    check();
    const timer = setInterval(check, UPDATE_CHECK_INTERVAL);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (!available) return null;
  return (
    <div
      role="status"
      className="fixed z-40 left-3 right-3 bottom-[calc(72px+env(safe-area-inset-bottom,0px))] sm:left-auto sm:right-4 sm:w-80 bg-slate-900 text-white rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 print:hidden"
    >
      <p className="text-xs flex-1 leading-snug">
        新しいバージョンがあります。日報・チャットの書きかけは消えません。
      </p>
      <button
        onClick={() => window.location.reload()}
        className="shrink-0 px-3 py-2 rounded-lg bg-blue-500 text-white text-xs font-bold"
      >
        更新する
      </button>
    </div>
  );
}

export default function App() {
  return (
    <>
      <RehabApp />
      <UpdateNotice />
      <DialogHost />
    </>
  );
}

function RehabApp() {
  // この端末に保存された組織ログインがあれば、それで始める。
  // v14 以前に保存されたもの（サーバー側のログイン状態がない）は使わず、ログインし直してもらう。
  const [org, setOrgState] = useState(() =>
    hasAuthSession() && currentAuth()?.isAnonymous ? readSession(ORG_SESSION_KEY) : null
  ); // { id, name } | null
  const setOrg = (next) => {
    writeSession(ORG_SESSION_KEY, next ? { id: next.id, name: next.name } : null);
    setOrgState(next);
  };

  // 招待リンクで開かれたとき（読み取ったらアドレス欄からは消える）
  const [invite, setInvite] = useState(() => readInviteFromUrl());
  useEffect(() => {
    clearInviteFromUrl();
  }, []);

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
      const [orgRows, protocolRows, slotRows, dirRows, menuRows] = await Promise.all([
        sbSelect("organizations", `?id=eq.${encodeURIComponent(orgId)}&select=id,name`),
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
      // この端末に保存されていた組織が、管理者によって削除されている場合は
      // 保存を消してログイン画面に戻す
      // （パスワードの変更で入り直しになった場合も、RLS により空になるのでここに来る）
      // （この端末の匿名ユーザーは、どの組織のメンバーでもなくなっているので、そのまま使い回す）
      if (!orgRows.length) {
        handleSwitchOrg({ skipServer: true });
        return;
      }
      setMasterProtocols(protocolRows.map(normalizeProtocol));
      setSlots(slotRows.map(normalizeSlot));
      setPlayerDirectory(dirRows);
      setPhaseMenus(menuRows.map(normalizeMenu));
    } catch (err) {
      setLoadError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (org) loadPublicData(org.id);
  }, [org?.id]);

  // 開くたびにログインの期限（30日）を延ばす。使い続けている限りログインし直しは不要
  useEffect(() => {
    if (!org) return;
    sbRpc("org_renew", { p_org_id: org.id })
      .then((ok) => {
        if (ok === false) handleSwitchOrg({ skipServer: true }); // 期限切れ・パスワード変更
        else writeSession(ORG_SESSION_KEY, { id: org.id, name: org.name });
      })
      .catch(() => {
        // 通信できないときなどは、そのまま使う
      });
  }, [org?.id]);

  // 別の組織の招待リンクで開かれたら、いまの組織から抜けて招待先に入る
  useEffect(() => {
    if (!invite || !org) return;
    if (org.id === invite.o) setInvite(null);
    else handleSwitchOrg();
  }, [invite, org?.id]);

  // ログインの有効期限が切れて更新もできなかったら、ログイン画面に戻す
  useEffect(() => {
    const onLost = () => handleSwitchOrg({ skipServer: true });
    window.addEventListener(AUTH_LOST_EVENT, onLost);
    return () => window.removeEventListener(AUTH_LOST_EVENT, onLost);
  }, []);

  // silent：画面を切り替えずに、裏で最新の状態に更新する（新着のチャット・面談の申し込み・予約を拾う）
  const loadCoachPlayers = async ({ silent = false } = {}) => {
    if (!org) return;
    if (!silent) setCoachLoading(true);
    try {
      const rows = await sbSelect(
        "players",
        `?org_id=eq.${encodeURIComponent(org.id)}&select=${PLAYER_FIELDS}${PLAYER_EMBED_ORDER}&order=name.asc`
      );
      setCoachPlayers(rows.map(normalizePlayer));
      if (silent) {
        const slotRows = await sbSelect("slots", `?org_id=eq.${encodeURIComponent(org.id)}&select=*&order=datetime.asc`);
        setSlots(slotRows.map(normalizeSlot));
      }
    } catch (err) {
      if (!silent) setLoadError(errText(err));
    } finally {
      if (!silent) setCoachLoading(false);
    }
  };

  // 指導者モードを開いている間は、1分ごと（と、画面に戻ったとき）に新着を確認する
  useEffect(() => {
    if (mode !== "coach" || !coachAuthed || !org) return undefined;
    const refresh = () => {
      if (document.visibilityState === "visible") loadCoachPlayers({ silent: true });
    };
    const timer = setInterval(refresh, COACH_REFRESH_INTERVAL);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [mode, coachAuthed, org?.id]);

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

  // 組織から抜ける。
  //   ・サーバー側のメンバー記録を消す。この端末の匿名ユーザーは次のログインで使い回す
  //     （匿名サインインは同じ回線から1時間30回までなので、作り直しを減らす）
  //   ・メンバー記録を消せなかったときは、匿名ユーザーごと破棄する
  //     （共用端末で、次に使う人に前の組織の権限が残らないように）
  const handleSwitchOrg = ({ skipServer = false } = {}) => {
    if (!skipServer && org) {
      // この端末の通知の登録を消してから、組織を抜ける（別の組織に入り直した端末へ通知が行かないように）
      disablePush(sbRpc)
        .catch(() => {})
        .then(() => sbRpc("org_leave", { p_org_id: org.id }))
        .catch(() => signOut());
    } else {
      disablePush(sbRpc).catch(() => {});
    }
    setOrg(null);
    writeSession(PLAYER_SESSION_KEY, null); // 端末に保存した選手ログインも消す
    setMode("player");
    setCoachAuthed(false);
    coachSecret = "";
    setCoachPlayers([]);
    setMyPlayer(null);
    setMasterProtocols([]);
    setSlots([]);
    setPlayerDirectory([]);
    setPhaseMenus([]);
  };

  if (!org) {
    return (
      <OrgLogin
        invite={invite}
        onAuthed={(next) => {
          setInvite(null);
          setOrg(next);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col print:bg-white print:block">
      <header className="bg-slate-900 text-white sticky top-0 z-20 shadow-md print:hidden safe-top safe-x">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2 px-3 sm:px-4 pb-3">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <Flame className="text-orange-400 shrink-0" size={22} />
            <span className="font-bold tracking-tight text-lg whitespace-nowrap">
              RE:SPRINT{" "}
              <span className="hidden sm:inline text-slate-400 font-normal text-sm">Rehab Progress</span>
            </span>
            <span className="hidden sm:flex items-center gap-1 ml-2 text-xs text-slate-400 border-l border-slate-700 pl-3">
              <Building2 size={12} /> {org.name}
            </span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {loadError && (
              <span className="hidden sm:inline text-xs text-red-300 max-w-[160px] truncate" title={loadError}>
                同期エラー
              </span>
            )}
            {loading && <Loader2 size={16} className="animate-spin text-slate-400" />}
            <div className="flex bg-slate-800 rounded-full p-1 gap-1">
              <button
                onClick={() => handleSwitchMode("player")}
                className={`px-3 sm:px-4 min-h-[36px] py-1.5 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
                  mode === "player" ? "bg-blue-600 text-white" : "text-slate-300 hover:text-white"
                }`}
              >
                選手
              </button>
              <button
                onClick={() => handleSwitchMode("coach")}
                className={`px-3 sm:px-4 min-h-[36px] py-1.5 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
                  mode === "coach" || mode === "coach-login"
                    ? "bg-blue-600 text-white"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                指導者
              </button>
            </div>
            <button
              onClick={() => handleSwitchOrg()}
              className="p-2.5 -mr-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 flex items-center"
              title="別の組織に切り替える"
              aria-label="ログアウトして別の組織に切り替える"
            >
              <LogOut size={16} />
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

      <main className="flex-1 safe-bottom safe-x">
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-2">
            <Loader2 className="animate-spin" size={24} />
            <p className="text-sm">読み込み中</p>
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
// 組織（テナント）ログインと管理者
//
//   どちらも権限の確認はサーバー（DB の関数と RLS）で行う。
//   画面側のチェックは入力ミスを早めに知らせるためだけのもの。
//
//   ・組織ログイン：org_login(組織ID, パスワード) が照合し、
//     成功するとこの端末の利用者が組織のメンバーになる。
//   ・管理者：Supabase Auth のメールアドレスとパスワードでログインし、
//     所有者が app_admins に登録した人だけが組織を追加・管理できる。
//     画面から自分を管理者にする手段はない（supabase_setup_admin.sql を参照）。
// ==================================================================
const ORG_ID_PATTERN = /^[A-Za-z0-9_-]{2,40}$/;
const ORG_PASSWORD_MIN = 8;

// 組織パスワードは、v13 と同じく JavaScript の trim() で前後の空白を除いてから送る。
// （DB の trim() は半角スペースしか除かないため、全角スペースや改行が残ると
//   v13 で設定したパスワードと一致しなくなる）
const normalizeOrgPassword = (pw) => String(pw ?? "").trim();

// 管理者ログインは隠し入口にする（管理者は所有者1人だけのため）。
//   ・ログイン画面のアイコンを5回続けてタップする
//   ・または、アドレスの末尾に #admin を付けて開く
//   権限の確認はサーバー側（admin_whoami）なので、入口を隠すのは画面を簡単にするためだけ。
const ADMIN_TAPS = 5;
function isAdminHash() {
  return typeof window !== "undefined" && window.location.hash === "#admin";
}

// ログイン画面の外枠（組織ログインと管理者で共通）。
// 中で定義すると入力のたびにフォーカスが外れるので、モジュールレベルに置く。
function LoginShell({ mode, onChangeMode, children }) {
  const taps = React.useRef({ n: 0, t: 0 });
  const handleLogoTap = () => {
    if (mode === "admin") return;
    const now = Date.now();
    taps.current = now - taps.current.t < 800 ? { n: taps.current.n + 1, t: now } : { n: 1, t: now };
    if (taps.current.n >= ADMIN_TAPS) {
      taps.current = { n: 0, t: 0 };
      onChangeMode("admin");
    }
  };
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4 py-8 safe-top safe-bottom safe-x">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg p-6 sm:p-8 border border-slate-200">
        <div className="flex flex-col items-center gap-3 mb-5">
          <div
            onClick={handleLogoTap}
            className={`w-14 h-14 rounded-full flex items-center justify-center select-none ${
              mode === "admin" ? "bg-slate-800" : "bg-blue-50"
            }`}
          >
            {mode === "admin" ? (
              <Settings className="text-white" size={24} />
            ) : (
              <Building2 className="text-blue-600" size={26} />
            )}
          </div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-1.5">
            <Flame className="text-orange-400" size={18} /> RE:SPRINT
          </h2>
          {mode === "admin" && <p className="text-xs font-bold text-slate-500">管理者ログイン</p>}
        </div>
        {children}
        {mode === "admin" && (
          <button
            type="button"
            onClick={() => onChangeMode("org")}
            className="w-full mt-3 py-2 text-xs text-slate-400 hover:text-slate-600 underline"
          >
            組織ログインに戻る
          </button>
        )}
      </div>
    </div>
  );
}

function AdminLogin({ onChangeMode, onAuthed }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleLogin = async () => {
    setError(null);
    if (!email.trim() || !pw) {
      setError("メールアドレスとパスワードを入力してください。");
      return;
    }
    setBusy(true);
    try {
      await signInWithPassword(email, pw);
      const isAdmin = await sbRpc("admin_whoami");
      if (isAdmin !== true) {
        await signOut();
        setError("このアカウントは管理者として登録されていません。");
        return;
      }
      setPw("");
      onAuthed();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <LoginShell mode="admin" onChangeMode={onChangeMode}>
      <label className="text-xs text-slate-500">メールアドレス</label>
      <input
        type="email"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full border border-slate-300 rounded-lg px-4 py-2.5 mt-1 mb-3 focus:outline-none focus:ring-2 focus:ring-slate-500"
        autoFocus
      />
      <label className="text-xs text-slate-500">パスワード</label>
      <input
        type="password"
        autoComplete="current-password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => isEnterKey(e) && handleLogin()}
        className="w-full border border-slate-300 rounded-lg px-4 py-2.5 mt-1 mb-3 focus:outline-none focus:ring-2 focus:ring-slate-500"
      />
      {error && <p className="text-red-500 text-sm mb-2 text-center">{error}</p>}
      <button
        onClick={handleLogin}
        disabled={busy}
        className="w-full py-2.5 rounded-lg bg-slate-800 text-white text-sm font-bold hover:bg-slate-700 disabled:bg-slate-300 flex items-center justify-center gap-2"
      >
        {busy && <Loader2 size={14} className="animate-spin" />}
        {busy ? "確認中..." : "管理者としてログイン"}
      </button>
    </LoginShell>
  );
}

// 招待リンクの表示（コピー・共有）
function InviteLinkCard({ invite, onClose }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const message = `RE:SPRINT「${invite.name}」への招待です。\nこのリンクを開くとログインできます。\n${invite.link}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      askText("このリンクをコピーしてください", { initial: invite.link, readOnly: true });
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: `RE:SPRINT ${invite.name}`, text: message });
    } catch {
      // 共有をやめたときなど
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-blue-200 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
          <LinkIcon size={16} className="text-blue-600" /> 「{invite.name}」の招待リンク
        </p>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2.5 -m-2" aria-label="閉じる">
          <X size={16} />
        </button>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed mb-2">
        このリンクを LINE などでメンバーに送ってください。開くだけでこの組織にログインできます。
        リンクにはパスワードが含まれるので、メンバー以外には渡さないでください。
        パスワードを変更すると、このリンクは使えなくなります。
      </p>
      <p className="text-[11px] font-mono break-all bg-slate-50 border border-slate-200 rounded-lg p-2 mb-3 select-all">
        {invite.link}
      </p>
      <div className="flex gap-2">
        <button
          onClick={copy}
          className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          {copied ? "コピーしました" : "リンクをコピー"}
        </button>
        {canShare && (
          <button
            onClick={share}
            className="flex-1 py-2 rounded-lg border border-blue-600 text-blue-700 text-sm font-medium hover:bg-blue-50"
          >
            LINE などで送る
          </button>
        )}
      </div>
    </div>
  );
}

// 組織の追加・一覧（管理者としてログインしているときだけ表示される）
// 管理者用：組織のID・パスワードの控えを表示する（v24）
//   控えは、v24 以降に設定・変更されたパスワードだけ。それ以前のものは「未記録」になる。
function SecretRow({ label, value, at, mono = true, emptyNote }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // コピーできない環境では、長押しで選択してもらう
    }
  };
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="min-w-0">
        <p className="text-[11px] text-slate-500">
          {label}
          {value && at ? `（${formatDateTimeJa(at)} 設定）` : ""}
        </p>
        {value ? (
          <p className={`text-sm text-slate-800 break-all select-all ${mono ? "font-mono" : ""}`}>{value}</p>
        ) : (
          <p className="text-xs text-orange-600">{emptyNote}</p>
        )}
      </div>
      {value && (
        <button
          onClick={copy}
          className="shrink-0 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-600 hover:bg-slate-50"
        >
          {copied ? "コピーしました" : "コピー"}
        </button>
      )}
    </div>
  );
}

function OrgSecretsPanel({ org, data }) {
  return (
    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2 divide-y divide-blue-100">
      <SecretRow label="組織ID" value={org.id} />
      <SecretRow
        label="組織パスワード"
        value={data.password}
        at={data.password_at}
        emptyNote="未記録です。「パスワード変更」で設定し直すと、以後ここに表示されます。"
      />
      <SecretRow
        label="指導者パスワード"
        value={data.coach_password}
        at={data.coach_password_at}
        emptyNote={
          org.has_coach_password
            ? "未記録です。「指導者パスワードをリセット」で設定し直すと、以後ここに表示されます。"
            : "まだ設定されていません。"
        }
      />
      <p className="text-[10px] text-slate-400 pt-1.5">
        管理者だけに表示されます。
      </p>
    </div>
  );
}

function OrgManager({ onBack }) {
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgPw, setOrgPw] = useState("");
  const [orgPwConfirm, setOrgPwConfirm] = useState("");
  const [coachPw, setCoachPw] = useState("");
  const [coachPwConfirm, setCoachPwConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [invite, setInvite] = useState(null); // { name, link }
  // 組織ごとの「ID・パスワードを確認」の表示（開いたものだけ読み込む。画面を離れると消える）
  const [secrets, setSecrets] = useState({}); // { [orgId]: { password, coach_password, ... } | "loading" }

  const fetchSecrets = (id) => sbRpc("admin_get_org_secrets", { p_id: id });
  const toggleSecrets = async (org) => {
    if (secrets[org.id]) {
      setSecrets((prev) => ({ ...prev, [org.id]: undefined }));
      return;
    }
    setError(null);
    setSecrets((prev) => ({ ...prev, [org.id]: "loading" }));
    try {
      const data = await fetchSecrets(org.id);
      setSecrets((prev) => ({ ...prev, [org.id]: data || {} }));
    } catch (err) {
      setSecrets((prev) => ({ ...prev, [org.id]: undefined }));
      setError(errText(err));
    }
  };
  // パスワードを変えたあとは、開いている表示を閉じる（古い値を見せない）
  const clearSecrets = (id) => setSecrets((prev) => ({ ...prev, [id]: undefined }));

  const load = async () => {
    setLoading(true);
    try {
      const rows = await sbRpc("admin_list_orgs");
      setOrgs(rows || []);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    setError(null);
    setDone(null);
    const id = orgId.trim();
    if (!ORG_ID_PATTERN.test(id)) {
      setError("組織IDは半角英数字・ハイフン・アンダースコアで2〜40文字にしてください。");
      return;
    }
    if (!orgName.trim()) {
      setError("組織名を入力してください。");
      return;
    }
    if (orgPw.trim().length < ORG_PASSWORD_MIN) {
      setError(`組織パスワードは${ORG_PASSWORD_MIN}文字以上にしてください。`);
      return;
    }
    if (orgPw !== orgPwConfirm) {
      setError("組織パスワード（確認）が一致しません。");
      return;
    }
    if (coachPw.trim().length < 4) {
      setError("指導者パスワードは4文字以上にしてください（選手が指導者モードに入れないようにするため）。");
      return;
    }
    if (coachPw !== coachPwConfirm) {
      setError("指導者パスワード（確認）が一致しません。");
      return;
    }
    if (normalizeOrgPassword(coachPw) === normalizeOrgPassword(orgPw)) {
      setError("指導者パスワードは、組織パスワードと別のものにしてください。");
      return;
    }
    // 重複の最終確認はサーバー側で行う（ここは早めに知らせるためだけ）
    if (orgs.some((o) => o.id.toLowerCase() === id.toLowerCase())) {
      setError(`組織ID「${id}」はすでに使われています。`);
      return;
    }
    setSaving(true);
    try {
      const row = await sbRpc("admin_create_org", {
        p_id: id,
        p_name: orgName.trim(),
        p_password: normalizeOrgPassword(orgPw),
        p_coach_password: normalizeOrgPassword(coachPw),
      });
      const c = row.copied || {};
      setDone(
        `組織「${row.name}」を追加しました。` +
          (c.protocols
            ? `プロトコル${c.protocols}件・種目メニュー${c.exercises}件をテンプレートからコピーしました。`
            : "") +
          "下の招待リンクをメンバーに送ってください。指導者パスワードは指導者にだけ伝えてください。"
      );
      setInvite({ name: row.name, link: makeInviteLink(row.id, normalizeOrgPassword(orgPw)) });
      setOrgId("");
      setOrgName("");
      setOrgPw("");
      setOrgPwConfirm("");
      setCoachPw("");
      setCoachPwConfirm("");
      await load();
    } catch (err) {
      setError(`追加できませんでした: ${errText(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async (org) => {
    setError(null);
    setDone(null);
    const next = await askText(`「${org.name}」の組織パスワードを変更`, {
      body: `${ORG_PASSWORD_MIN}文字以上。変更すると、この組織でログイン中の端末はすべて入り直しになります。`,
      placeholder: "新しい組織パスワード",
      okLabel: "変更する",
    });
    if (next === null) return;
    if (next.trim().length < ORG_PASSWORD_MIN) {
      setError(`パスワードは${ORG_PASSWORD_MIN}文字以上にしてください。`);
      return;
    }
    try {
      await sbRpc("admin_set_org_password", { p_id: org.id, p_password: normalizeOrgPassword(next) });
      setDone(`「${org.name}」のパスワードを変更しました。新しい招待リンクを送ってください。`);
      clearSecrets(org.id);
      setInvite({ name: org.name, link: makeInviteLink(org.id, normalizeOrgPassword(next)) });
      await load();
    } catch (err) {
      setError(errText(err));
    }
  };

  // 指導者パスワードの設定・変更（管理者だけができる）
  const handleSetCoachPassword = async (org) => {
    setError(null);
    setDone(null);
    const next = await askText(`「${org.name}」の指導者パスワード`, {
      body: "4文字以上。今のパスワードが分からなくても上書きできます。指導者にだけ伝えてください。",
      placeholder: "新しい指導者パスワード",
      okLabel: "設定する",
    });
    if (next === null) return;
    if (normalizeOrgPassword(next).length < 4) {
      setError("指導者パスワードは4文字以上にしてください。");
      return;
    }
    try {
      await sbRpc("admin_set_coach_password", { p_id: org.id, p_password: normalizeOrgPassword(next) });
      setDone(`「${org.name}」の指導者パスワードを設定しました。`);
      clearSecrets(org.id);
      await load();
    } catch (err) {
      setError(errText(err));
    }
  };

  // 既存の組織の招待リンクを作る。パスワードの控え（v24）があればそれを使い、なければ入力してもらう
  const handleMakeInvite = async (org) => {
    setError(null);
    try {
      const saved = await fetchSecrets(org.id);
      if (saved?.password) {
        setInvite({ name: org.name, link: makeInviteLink(org.id, saved.password) });
        return;
      }
    } catch {
      // 控えを読めないときは、入力してもらう
    }
    const pw = await askText(`「${org.name}」の組織パスワード`, {
      body: "招待リンクを作るために使います。",
      placeholder: "組織パスワード",
      okLabel: "リンクを作る",
    });
    if (!pw || !normalizeOrgPassword(pw)) return;
    setInvite({ name: org.name, link: makeInviteLink(org.id, normalizeOrgPassword(pw)) });
  };

  const handleDelete = async (org) => {
    setError(null);
    setDone(null);
    const n = org.player_count ?? 0;
    const warn =
      n > 0
        ? `\n\n注意：この組織には ${n}名 の選手が登録されています。削除すると選手データも一緒に消えます。`
        : "";
    const sure = await askConfirm(`組織「${org.name}」を削除しますか？`, {
      body: `${warn.trim() ? warn.trim() + "\n" : ""}この操作は取り消せません。`,
      okLabel: "削除する",
      danger: true,
    });
    if (!sure) return;
    try {
      await sbRpc("admin_delete_org", { p_id: org.id });
      setDone(`組織「${org.name}」を削除しました。`);
      await load();
    } catch (err) {
      setError(`削除できませんでした: ${errText(err)}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 safe-top safe-bottom safe-x">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Settings size={20} className="text-slate-600" /> 組織の管理
          </h2>
          <button
            onClick={onBack}
            className="text-xs text-slate-500 hover:text-slate-700 underline flex items-center gap-1 shrink-0"
          >
            <LogOut size={12} /> 管理者をログアウト
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        {done && (
          <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            {done}
          </p>
        )}
        {invite && <InviteLinkCard invite={invite} onClose={() => setInvite(null)} />}

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
            <PlusCircle size={16} className="text-blue-600" /> 組織を追加する
          </p>

          <label className="text-xs text-slate-500">組織ID（ログインに使います）</label>
          <input
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            placeholder="例：keio-track"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={40}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 mb-1 font-mono"
          />
          <p className="text-[10px] text-slate-400 mb-3">
            半角英数字・ハイフン・アンダースコアで2〜40文字。あとから変更できません。
          </p>

          <label className="text-xs text-slate-500">組織名（画面に表示されます）</label>
          <input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="例：慶應義塾大学競走部"
            maxLength={100}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 mb-3"
          />

          <label className="text-xs text-slate-500">組織パスワード</label>
          <input
            type="password"
            autoComplete="new-password"
            value={orgPw}
            onChange={(e) => setOrgPw(e.target.value)}
            placeholder={`${ORG_PASSWORD_MIN}文字以上`}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 mb-3"
          />

          <label className="text-xs text-slate-500">組織パスワード（確認）</label>
          <input
            type="password"
            autoComplete="new-password"
            value={orgPwConfirm}
            onChange={(e) => setOrgPwConfirm(e.target.value)}
            placeholder="もう一度入力"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 mb-4"
          />

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-4">
            <p className="text-xs font-bold text-amber-800 mb-1">指導者パスワード</p>
            <p className="text-[11px] text-amber-800/80 leading-relaxed mb-2">
              指導者モード（選手の医療情報を含む画面）に入るためのパスワードです。組織パスワードとは別のものにして、指導者にだけ伝えてください。
            </p>
            <input
              type="password"
              autoComplete="new-password"
              value={coachPw}
              onChange={(e) => setCoachPw(e.target.value)}
              placeholder="4文字以上"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2 bg-white"
            />
            <input
              type="password"
              autoComplete="new-password"
              value={coachPwConfirm}
              onChange={(e) => setCoachPwConfirm(e.target.value)}
              onKeyDown={(e) => isEnterKey(e) && handleCreate()}
              placeholder="もう一度入力"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
            />
          </div>

          <button
            onClick={handleCreate}
            disabled={saving}
            className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:bg-slate-300 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "追加中..." : "組織を追加する"}
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-sm font-bold text-slate-700 mb-3">
            登録済みの組織（{orgs.length}）
          </p>
          {loading ? (
            <p className="text-sm text-slate-400 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> 読み込み中...
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {orgs.map((o) => (
                <li key={o.id} className="py-3">
                 <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 break-words">{o.name}</p>
                    <p className="text-[11px] text-slate-400 font-mono break-all">{o.id}</p>
                    <p className="text-[10px] text-slate-400">選手 {o.player_count ?? 0}名</p>
                    {!o.has_password && (
                      <p className="text-[10px] text-orange-600">パスワード未設定（ログインできません）</p>
                    )}
                    {o.has_coach_password === false && (
                      <p className="text-[10px] text-orange-600">指導者パスワード未設定（指導者モードに入れません）</p>
                    )}
                    {o.has_coach_password && o.coach_password_updated_at && (
                      <p
                        className={`text-[10px] ${
                          o.coach_password_changed_by === "coach" ? "text-orange-600 font-bold" : "text-slate-400"
                        }`}
                      >
                        指導者パスワード：{formatDateTimeJa(o.coach_password_updated_at)}に
                        {o.coach_password_changed_by === "coach" ? "指導者が変更" : o.coach_password_changed_by === "admin" ? "管理者が設定" : "設定"}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 sm:justify-end sm:max-w-[60%]">
                    <button
                      onClick={() => toggleSecrets(o)}
                      className="text-xs font-bold text-blue-700 border border-blue-200 rounded-lg px-2.5 py-2 bg-blue-50"
                    >
                      {secrets[o.id] ? "確認を閉じる" : "ID・パスワードを確認"}
                    </button>
                    <button
                      onClick={() => handleMakeInvite(o)}
                      className="text-xs text-blue-700 border border-blue-200 rounded-lg px-2.5 py-2 bg-white"
                    >
                      招待リンク
                    </button>
                    <button
                      onClick={() => handleResetPassword(o)}
                      className="text-xs text-slate-600 border border-slate-200 rounded-lg px-2.5 py-2 bg-white"
                    >
                      パスワード変更
                    </button>
                    <button
                      onClick={() => handleSetCoachPassword(o)}
                      className="text-xs text-slate-600 border border-slate-200 rounded-lg px-2.5 py-2 bg-white"
                    >
                      {o.has_coach_password ? "指導者パスワードをリセット" : "指導者パスワードを設定"}
                    </button>
                    {o.id !== "default" && (
                      <button
                        onClick={() => handleDelete(o)}
                        className="text-slate-400 hover:text-red-500 p-2"
                        title="この組織を削除"
                        aria-label={`${o.name}を削除`}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                 </div>
                  {secrets[o.id] === "loading" && (
                    <p className="mt-2 text-xs text-slate-400 flex items-center gap-2">
                      <Loader2 size={12} className="animate-spin" /> 読み込み中...
                    </p>
                  )}
                  {secrets[o.id] && secrets[o.id] !== "loading" && <OrgSecretsPanel org={o} data={secrets[o.id]} />}
                </li>
              ))}
              {orgs.length === 0 && (
                <li className="py-3 text-sm text-slate-400">まだ組織がありません。</li>
              )}
            </ul>
          )}
        </div>
        <TermsEditor />
        <p className="text-center text-[11px] text-slate-400">{APP_BUILD}</p>
      </div>
    </div>
  );
}

// ==================================================================
// ホーム画面への追加をすすめる案内
//   iPhone は「共有 → ホーム画面に追加」しかないので、その手順を出す。
//   Android・PCのChromeは、ボタン一つで追加できる。
//   すでにホーム画面から開いているときは表示しない。
// ==================================================================
const INSTALL_HINT_KEY = "resprint.installHintClosed";

function InstallHint({ className = "mt-5" }) {
  const { canInstall, install } = useInstallPrompt();
  const [closed, setClosed] = useState(() => {
    try {
      return window.localStorage.getItem(INSTALL_HINT_KEY) === "1";
    } catch {
      return false;
    }
  });

  const standalone = isStandaloneApp();
  const isIOS = isIOSDevice();

  const handleClose = () => {
    try {
      window.localStorage.setItem(INSTALL_HINT_KEY, "1");
    } catch {
      // 保存できなくても閉じられる
    }
    setClosed(true);
  };

  if (standalone || closed) return null;
  if (!isIOS && !canInstall) return null; // 追加できない環境では出さない

  return (
    <div className={`${className} rounded-xl border border-slate-200 bg-slate-50 p-3 text-left`}>
      <div className="flex items-start gap-2">
        <Smartphone size={16} className="text-blue-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-xs font-bold text-slate-700">ホーム画面に追加できます</p>
          {isIOS ? (
            <>
              <ol className="text-[11px] text-slate-500 leading-relaxed mt-1 list-decimal list-inside space-y-0.5">
                <li>
                  Safari の<span className="font-medium text-slate-600">共有ボタン</span>
                  （□に↑。iPhone は画面下、iPad は画面上）を押す
                </li>
                <li>
                  <span className="font-medium text-slate-600">「ホーム画面に追加」</span>
                  を選ぶ（見当たらなければ一覧を下にスクロール）
                </li>
                <li>右上の「追加」を押す</li>
              </ol>
              <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
                ホーム画面の RE:SPRINT アイコンから、アプリのように全画面で開けます。
              </p>
              <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
                ※ iPhone はホーム画面のアプリと Safari でログインが別です。アイコンから初めて開いたときは、
                招待リンク（または引き継ぎコード）をコピーして「貼り付けて入る」を押してください（最初の1回だけ）。
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
                アプリとして追加すると、次からURLを開かずに使えます。
              </p>
              <button
                onClick={install}
                className="mt-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700"
              >
                ホーム画面に追加
              </button>
            </>
          )}
        </div>
        <button
          onClick={handleClose}
          className="text-slate-300 hover:text-slate-500 shrink-0 p-2.5 -m-2"
          title="今後表示しない"
          aria-label="この案内を今後表示しない"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

// ==================================================================
// 「ホーム画面に追加」の全画面案内（InstallGate）で使う部品
//   iPhone：引き継ぎコードをコピー → 共有 →「ホーム画面に追加」→ アイコンから開いて貼り付け
//   Android：追加できるならボタン1つで追加。できなければメニューからの手順
//   LINE などの中のブラウザ：先に Safari／Chrome で開き直してもらう
// ==================================================================
function GuideStep({ n, title, children }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center">
        {n}
      </span>
      <div className="flex-1 pt-1">
        <p className="text-sm font-bold text-slate-800">{title}</p>
        {children && <div className="text-xs text-slate-500 leading-relaxed mt-1">{children}</div>}
      </div>
    </li>
  );
}

function ShareIconMark() {
  // iPhone の共有ボタン（□に↑）の見た目
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 align-middle border border-blue-500 rounded-sm mx-0.5 relative">
      <ArrowRight size={11} className="text-blue-500 -rotate-90" />
    </span>
  );
}

// 引き継ぎコード（8桁）。貼り付けた文字の中から探す（「1234 5678」のように空白が入っていてもよい）
function parseTransferCode(text) {
  const t = String(text || "");
  if (t.includes("join=")) return null; // 招待リンクは別扱い
  const m = t.match(/(?:^|\D)(\d{4})[\s-]?(\d{4})(?:\D|$)/);
  return m ? m[1] + m[2] : null;
}
const formatTransferCode = (code) => `${code.slice(0, 4)} ${code.slice(4)}`;

// スマホのブラウザで開いている選手に出す、全画面の「ホーム画面に追加」（v15.11）
//   使い方を最後まで読んだあと（2回目以降は開いたとき）に出る。追加するまで先へ進めない。
//   ただし、追加できない端末のために、下に小さく「今回だけブラウザで使う」を置く（作者の判断）。
//   iPhone は Safari とホーム画面のアプリでログインが別なので、引き継ぎコードでそのまま引き継ぐ。
const INSTALL_SKIP_KEY = "resprint.installSkip";
function needsInstall() {
  return (isIOSDevice() || isAndroidDevice()) && !isStandaloneApp();
}
function installSkipped() {
  try {
    return window.sessionStorage.getItem(INSTALL_SKIP_KEY) === "1";
  } catch {
    return false;
  }
}
function InstallGate({ orgId, player, onSkip }) {
  const { canInstall, install } = useInstallPrompt();
  const [installed, setInstalled] = useState(false);
  const [code, setCode] = useState(null);
  const [codeError, setCodeError] = useState(null);
  const [copied, setCopied] = useState(false);
  const ios = isIOSDevice();
  const inApp = inAppBrowserName();
  const needsCode = ios || Boolean(inApp); // Android のホーム画面アプリはログインがそのまま残る
  const requested = React.useRef(false);

  const makeCode = async () => {
    setCodeError(null);
    setCopied(false);
    try {
      const r = await sbRpc("transfer_create", { p_org_id: orgId, p_player_id: player?.id ?? null });
      setCode(r?.code || null);
    } catch (err) {
      setCodeError(errText(err));
    }
  };
  useEffect(() => {
    if (!needsCode || requested.current) return;
    requested.current = true; // 二重に作ると先のコードが無効になるので、1回だけ
    makeCode();
  }, [needsCode]);

  const copyText = code ? `RE:SPRINT 引き継ぎコード：${formatTransferCode(code)}` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
    } catch {
      await askText("このコードをコピーしてください", { initial: copyText, readOnly: true });
    }
    setCopied(true);
  };
  const doInstall = async () => {
    const ok = await install();
    if (ok) setInstalled(true);
  };
  const skip = () => {
    try {
      window.sessionStorage.setItem(INSTALL_SKIP_KEY, "1");
    } catch {
      // 覚えられなくても、この画面は閉じる
    }
    onSkip();
  };

  const codeBox = (
    <div className="mt-2">
      {code ? (
        <>
          <p className="text-2xl font-mono font-bold tracking-widest text-slate-800 text-center bg-slate-100 rounded-xl py-3 select-all">
            {formatTransferCode(code)}
          </p>
          <button
            onClick={copy}
            className={`mt-2 w-full py-3 rounded-xl text-sm font-bold ${
              copied ? "bg-green-600 text-white" : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {copied ? "コピーしました" : "引き継ぎコードをコピーする"}
          </button>
          <p className="text-[11px] text-slate-400 mt-1.5">
            30分だけ有効です。
            <button onClick={makeCode} className="underline ml-1">
              作り直す
            </button>
          </p>
        </>
      ) : codeError ? (
        <p className="text-xs text-red-500">
          コードを作れませんでした：{codeError}
          <button onClick={makeCode} className="underline ml-1">
            もう一度
          </button>
        </p>
      ) : (
        <p className="text-xs text-slate-400 flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> コードを用意しています...
        </p>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-y-auto print:hidden" role="dialog" aria-modal="true">
      <div className="max-w-md mx-auto px-6 pt-10 pb-10 safe-top safe-bottom">
        <div className="flex flex-col items-center text-center mb-6">
          <img src="/apple-touch-icon.png" alt="" className="w-20 h-20 rounded-2xl shadow mb-4" />
          <h2 className="text-xl font-bold text-slate-800">ホーム画面に追加してください</h2>
          <p className="text-sm text-slate-500 mt-2 leading-relaxed">
            RE:SPRINT は、ホーム画面のアイコンから開いて使います。
            アイコンを押すだけで開け、通知も受け取れるようになります（1分で終わります）。
          </p>
        </div>

        {inApp ? (
          <ol className="space-y-5">
            <GuideStep n={1} title={`${inApp} の中では追加できません`}>
              {ios ? (
                <>画面の右下（または右上）の「…」や共有ボタンから、<b>「Safari で開く」</b>を選んでください。</>
              ) : (
                <>画面の右上の「︙」から、<b>「他のアプリで開く」→ Chrome</b> を選んでください。</>
              )}
            </GuideStep>
            <GuideStep n={2} title="開き直した画面で、引き継ぎコードを貼り付ける">
              下のコードをコピーしておき、開き直したログイン画面の<b>「貼り付けて入る」</b>を押すと、そのまま続きから使えます。
              {codeBox}
            </GuideStep>
          </ol>
        ) : ios ? (
          <ol className="space-y-5">
            <GuideStep n={1} title="引き継ぎコードをコピーする">
              ホーム画面のアプリで最初に1回だけ使います（パスワードや暗証番号の入れ直しは要りません）。
              {codeBox}
            </GuideStep>
            <GuideStep n={2} title="共有ボタンから「ホーム画面に追加」">
              Safari の画面の下（iPad は上）にある共有ボタン
              <ShareIconMark />
              を押し、一覧から<b>「ホーム画面に追加」</b>を選んで、右上の<b>「追加」</b>を押します。
              見当たらないときは一覧を下にスクロールしてください。
            </GuideStep>
            <GuideStep n={3} title="ホーム画面のアイコンから開いて、貼り付ける">
              RE:SPRINT のアイコンを開き、<b>「貼り付けて入る」</b>を押します。
              {player ? `${player.name} さんのまま、続きから使えます。` : "この組織にログインしたまま、続きから使えます。"}
            </GuideStep>
          </ol>
        ) : canInstall && !installed ? (
          <ol className="space-y-5">
            <GuideStep n={1} title="下のボタンを押して「インストール」を選ぶ">
              <button
                onClick={doInstall}
                className="mt-2 w-full py-3.5 rounded-xl bg-blue-600 text-white text-base font-bold hover:bg-blue-700"
              >
                ホーム画面に追加する
              </button>
            </GuideStep>
            <GuideStep n={2} title="ホーム画面の RE:SPRINT アイコンから開く">
              ログインしたままなので、アイコンを押すだけで続きから使えます。
            </GuideStep>
          </ol>
        ) : installed ? (
          <div className="text-center py-6">
            <CheckCircle2 size={40} className="text-green-600 mx-auto" />
            <p className="text-base font-bold text-green-700 mt-3">追加しました</p>
            <p className="text-sm text-slate-500 mt-1">
              このページを閉じて、ホーム画面の RE:SPRINT アイコンから開いてください。
            </p>
          </div>
        ) : (
          <ol className="space-y-5">
            <GuideStep n={1} title="ブラウザの右上「︙」を押す" />
            <GuideStep n={2} title="「ホーム画面に追加」（または「アプリをインストール」）を選ぶ" />
            <GuideStep n={3} title="ホーム画面の RE:SPRINT アイコンから開く">
              ログインしたままなので、アイコンを押すだけで続きから使えます。
            </GuideStep>
          </ol>
        )}

        <div className="mt-10 pt-4 border-t border-slate-100 text-center">
          <button onClick={skip} className="text-xs text-slate-400 underline py-2 px-3">
            今回だけブラウザで使う
          </button>
          <p className="text-[10px] text-slate-300 mt-1">
            追加できない端末のための入口です。次に開いたときは、またこの画面が出ます。
          </p>
        </div>
      </div>
    </div>
  );
}

function OrgLogin({ onAuthed, invite }) {
  // 'org' | 'admin' | 'admin-panel'。#admin で開いたときは管理者ログインから
  const [screen, setScreen] = useState(() => (isAdminHash() ? "admin" : "org"));
  const [orgCode, setOrgCode] = useState("");
  const [password, setPassword] = useState("");
  const [inviteText, setInviteText] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const loginWith = async (id, pw, { fromInvite = false } = {}) => {
    setError(null);
    if (!String(id || "").trim() || !pw) {
      setError("組織IDとパスワードを入力してください。");
      return;
    }
    setBusy(true);
    try {
      await ensureAnonymousSession();
      const org = await sbRpc("org_login", {
        p_org_id: String(id).trim(),
        p_password: normalizeOrgPassword(pw),
      });
      if (!org || !org.id) {
        setError(
          fromInvite
            ? "この招待リンクは使えません（組織のパスワードが変更された可能性があります）。管理者に新しいリンクをもらってください。"
            : "組織IDまたはパスワードが違います。"
        );
        return;
      }
      setPassword("");
      setInviteText("");
      onAuthed({ id: org.id, name: org.name });
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = () => loginWith(orgCode, password);

  // 引き継ぎコード（ブラウザ側で作った8桁）で入る：組織と選手のログインがそのまま引き継がれる
  const loginWithTransfer = async (code) => {
    setError(null);
    setBusy(true);
    try {
      await ensureAnonymousSession();
      const r = await sbRpc("transfer_redeem", { p_code: code });
      if (!r || !r.org) {
        setError("引き継ぎコードが違うか、期限（30分）が切れています。ブラウザ側の画面で作り直してください。");
        return;
      }
      if (r.player) {
        // 選手のログインも引き継ぐ（暗証番号の入れ直しは不要）
        writeSession(PLAYER_SESSION_KEY, { orgId: r.org.id, id: r.player.id, name: r.player.name });
      }
      setInviteText("");
      onAuthed({ id: r.org.id, name: r.org.name });
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const handleInvite = (text) => {
    const inv = parseInvite(text);
    if (inv) {
      loginWith(inv.o, inv.p, { fromInvite: true });
      return;
    }
    const code = parseTransferCode(text);
    if (code) {
      loginWithTransfer(code);
      return;
    }
    setError("招待リンク・引き継ぎコードを読み取れませんでした。コピーしたものをそのまま貼り付けてください。");
  };

  const pasteInvite = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInviteText(text);
      handleInvite(text);
    } catch {
      setError("貼り付けできませんでした。下の欄に長押しで貼り付けてください。");
    }
  };

  // 招待リンクで開かれたら、そのままログインする
  useEffect(() => {
    if (invite) loginWith(invite.o, invite.p, { fromInvite: true });
  }, [invite]);

  // 管理者をログアウトして組織ログインに戻る
  const leaveAdmin = async () => {
    await signOut();
    if (isAdminHash()) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setScreen("org");
  };

  if (screen === "admin-panel") {
    return <OrgManager onBack={leaveAdmin} />;
  }

  if (screen === "admin") {
    return (
      <AdminLogin
        onChangeMode={(m) => {
          if (m !== "admin" && isAdminHash()) {
            window.history.replaceState(null, "", window.location.pathname + window.location.search);
          }
          setScreen(m === "admin" ? "admin" : "org");
        }}
        onAuthed={() => setScreen("admin-panel")}
      />
    );
  }

  return (
    <LoginShell mode="org" onChangeMode={(m) => setScreen(m)}>
      {busy && invite && (
        <p className="text-sm text-blue-600 text-center mb-3 flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> 招待リンクでログインしています...
        </p>
      )}
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 mb-5">
        <p className="text-xs font-bold text-blue-700 mb-2">招待リンク・引き継ぎコードで入る</p>
        <button
          type="button"
          onClick={pasteInvite}
          disabled={busy}
          className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:bg-slate-300 mb-2"
        >
          貼り付けて入る
        </button>
        <input
          value={inviteText}
          onChange={(e) => {
            setInviteText(e.target.value);
            if (parseInvite(e.target.value) || parseTransferCode(e.target.value)) handleInvite(e.target.value);
          }}
          placeholder="ここに長押しで貼り付け"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full border border-blue-200 rounded-lg px-3 py-2 text-xs bg-white"
        />
      </div>

      <p className="text-xs text-slate-400 text-center mb-3">または</p>

      <label className="text-xs text-slate-500">組織ID</label>
      <input
        value={orgCode}
        onChange={(e) => setOrgCode(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="username"
        className="w-full border border-slate-300 rounded-lg px-4 py-2.5 mt-1 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <label className="text-xs text-slate-500">パスワード</label>
      <input
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => isEnterKey(e) && handleLogin()}
        placeholder="組織パスワード"
        className="w-full border border-slate-300 rounded-lg px-4 py-2.5 mt-1 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {error && <p className="text-red-500 text-sm mb-2 text-center">{error}</p>}
      <button
        onClick={handleLogin}
        disabled={busy}
        className="w-full py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium disabled:bg-slate-300 flex items-center justify-center gap-2"
      >
        {busy && <Loader2 size={14} className="animate-spin" />}
        ログイン
      </button>
    </LoginShell>
  );
}

// ==================================================================
// パスワードゲート（指導者モード・組織スコープ）
// ==================================================================
// 指導者モードに入ったときのパスワード。メモリにだけ持つ（端末には保存しない。再読み込みで消える）
let coachSecret = "";

function PasswordGate({ orgId, onAuthed, onCancel }) {
  // 照合はサーバーの中（coach_check）で行う。ハッシュはアプリからは読めない（v21）
  const [phase, setPhase] = useState("checking"); // 'checking' | 'unset' | 'login'
  const [pwInput, setPwInput] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setPhase("checking");
    setError(null);
    sbRpc("coach_check", { p_org_id: orgId, p_password: "" })
      .then((r) => active && setPhase(r?.set ? "login" : "unset"))
      .catch((err) => {
        if (!active) return;
        setError(errText(err));
        setPhase("login");
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  const handleLogin = async () => {
    setError(null);
    if (!pwInput) {
      setError("パスワードを入力してください。");
      return;
    }
    setBusy(true);
    try {
      const r = await sbRpc("coach_check", { p_org_id: orgId, p_password: pwInput });
      if (r?.ok) {
        coachSecret = pwInput;
        setPwInput("");
        onAuthed();
      } else if (r && !r.set) {
        setPhase("unset");
      } else {
        setError("パスワードが違います。");
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  if (phase === "checking") {
    return (
      <div className="max-w-sm mx-auto mt-16 flex flex-col items-center gap-2 text-slate-400">
        <Loader2 className="animate-spin" size={22} />
        <p className="text-sm">確認中...</p>
      </div>
    );
  }

  if (phase === "unset") {
    return (
      <div className="max-w-sm mx-auto mt-16 mx-4 sm:mx-auto bg-white rounded-2xl shadow-lg p-8 border border-slate-200">
        <div className="flex flex-col items-center gap-3 mb-4">
          <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center">
            <KeyRound className="text-amber-600" size={26} />
          </div>
          <h2 className="text-lg font-bold text-slate-800">指導者パスワードが未設定です</h2>
          <p className="text-sm text-slate-500 text-center leading-relaxed">
            この組織の指導者パスワードは、まだ設定されていません。
            管理者に設定を依頼してください（管理者画面の組織一覧から設定できます）。
          </p>
        </div>
        <button
          onClick={onCancel}
          className="w-full py-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium"
        >
          戻る
        </button>
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
        autoComplete="current-password"
        value={pwInput}
        onChange={(e) => setPwInput(e.target.value)}
        onKeyDown={(e) => isEnterKey(e) && handleLogin()}
        placeholder="パスワード"
        className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
        autoFocus
      />
      {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}
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
      <p className="mt-4 text-[11px] text-slate-400 text-center leading-relaxed">
        パスワードが分からない場合は、管理者に再設定を依頼してください。
      </p>
    </div>
  );
}

// ==================================================================
// チャットパネル（選手⇔スタッフ 共通コンポーネント）
// ==================================================================
// アプリから送った写真・動画（attachments バケット）かどうか。そうならチャット内にそのまま表示する
function uploadedMediaKind(url) {
  if (!url || !String(url).includes(`/storage/v1/object/public/${ATTACHMENT_BUCKET}/`)) return null;
  return /\.(mp4|mov|webm|m4v|qt)(\?|$)/i.test(url) ? "video" : "image";
}

function ChatPanel({ messages, myRole, title, onSend, roleOptions, hideHeader, playerId, orgId, draftKey, tall }) {
  const [text, setText] = useState(() => (draftKey && readDraft(draftKey)?.text) || "");
  const listRef = React.useRef(null);
  // 書きかけのメッセージは端末に残す（更新・再読み込みで消えないように）
  useEffect(() => {
    if (draftKey) writeDraft(draftKey, text.trim() ? { text } : null);
  }, [draftKey, text]);
  // 新しいメッセージが来たら一番下（最新）を表示する
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);
  const [attachment, setAttachment] = useState(null); // { url, kind } 送信前の写真・動画
  const [role, setRole] = useState(roleOptions?.[0]?.value ?? null);
  const [sending, setSending] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [painType, setPainType] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [timestampNote, setTimestampNote] = useState("");

  const handleSend = async () => {
    if (!text.trim() && !attachment) return;
    setSending(true);
    try {
      const body = text.trim() || (attachment?.kind === "video" ? "（動画）" : "（写真）");
      await onSend(body, role, {
        painType: painType || null,
        videoUrl: attachment?.url || videoUrl.trim() || null,
        timestampNote: timestampNote.trim() || null,
      });
      setText("");
      setAttachment(null);
      setPainType("");
      setVideoUrl("");
      setTimestampNote("");
      setShowExtra(false);
    } catch (err) {
      showMessage("送信できませんでした", { body: errText(err) });
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
      <div ref={listRef} className={`${tall ? "max-h-[55vh]" : "max-h-64"} overflow-y-auto overscroll-contain space-y-2 mb-3 pr-1`}>
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
                  {CHAT_STAFF_ROLE_LABELS[m.staffRole] || "指導者"}
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
                  {m.videoUrl && uploadedMediaKind(m.videoUrl) && (
                    <AttachmentPreview url={m.videoUrl} kind={uploadedMediaKind(m.videoUrl)} />
                  )}
                  {m.videoUrl && !uploadedMediaKind(m.videoUrl) && (
                    <a
                      href={safeHref(m.videoUrl)}
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
        className="text-xs text-blue-600 hover:underline mb-1 py-2"
      >
        {showExtra ? "詳細入力を閉じる" : "＋ 痛みの種類・動画リンクなど詳細を追加"}
      </button>
      {showExtra && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          <select
            value={painType}
            onChange={(e) => setPainType(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-2.5 text-sm bg-white"
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
            className="border border-slate-300 rounded-lg px-3 py-2.5 text-sm"
          />
          <input
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="動画リンク（URL）"
            className="col-span-1 sm:col-span-2 border border-slate-300 rounded-lg px-3 py-2.5 text-sm"
          />
        </div>
      )}

      {attachment && (
        <div className="mb-2 flex items-start gap-2">
          <div className="flex-1">
            <AttachmentPreview url={attachment.url} kind={attachment.kind} />
          </div>
          <button
            type="button"
            onClick={() => setAttachment(null)}
            className="text-slate-400 hover:text-red-500 p-2.5 -m-1"
            aria-label="添付を取り消す"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {playerId && (
        <div className="mb-2">
          <MediaUploadButton
            playerId={playerId}
            orgId={orgId}
            context="message"
            label={attachment ? "別の写真・動画に差し替える" : "写真・動画を添付"}
            onUploaded={(r) => setAttachment({ url: r.url, kind: r.kind })}
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {roleOptions && (
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label="送信者の立場"
            className="w-full sm:w-auto border border-slate-300 rounded-lg px-3 py-2.5 text-sm bg-white shrink-0"
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
          onKeyDown={(e) => isEnterKey(e) && handleSend()}
          placeholder="メッセージを入力"
          className="flex-1 min-w-0 border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleSend}
          disabled={sending}
          className="px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:bg-slate-300"
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
  const [installSkip, setInstallSkip] = useState(() => installSkipped());
  // 画面下のタブ（選手画面と同じ形）。読み込み直しても同じタブに戻る
  const COACH_TAB_KEY = "resprint.coachTab";
  const [subTab, setSubTabState] = useState(() => {
    try {
      const t = window.sessionStorage.getItem(COACH_TAB_KEY);
      return ["players", "protocols", "menus", "scheduling", "settings"].includes(t) ? t : "players";
    } catch {
      return "players";
    }
  });
  const setSubTab = (t) => {
    setSubTabState(t);
    try {
      window.sessionStorage.setItem(COACH_TAB_KEY, t);
    } catch {
      // 覚えられなくても動く
    }
    window.scrollTo(0, 0);
  };

  // 対応が必要な選手の数（SOS・面談の申し込み・未読のチャット）
  const attention = coachPlayers.filter(
    (p) =>
      !p.completedAt &&
      (p.sos ||
        pendingConsultations(p).length > 0 ||
        p.messages.some((m) => m.sender === "player" && !m.isRead) ||
        (meetingAlertLevel(p, slots) === "yellow" && !upcomingMeeting(p, slots)))
  ).length;
  useEffect(() => {
    setIconBadge(attention);
    return () => setIconBadge(0);
  }, [attention]);
  // 通知をオンにしてある端末は、開くたびに登録を最新にする
  useEffect(() => {
    refreshPush(sbRpc, { orgId, role: "coach" });
  }, [orgId]);

  const tabs = [
    { key: "players", label: "選手", icon: Users, badge: attention },
    { key: "protocols", label: "プロトコル", icon: ClipboardList },
    { key: "menus", label: "メニュー", icon: Dumbbell },
    { key: "scheduling", label: "日程調整", icon: CalendarRange },
    { key: "settings", label: "その他", icon: MoreHorizontal },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 pt-4 sm:pt-6 pb-28">
      <nav
        className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 print:hidden safe-nav"
        aria-label="指導者メニュー"
      >
        <BottomTabs tabs={tabs} active={subTab} onChange={setSubTab} />
      </nav>

      {/* スマホのブラウザで開いているとき：指導者も、まずホーム画面への追加（最優先）。通知の案内はそのあと */}
      {needsInstall() && !installSkip ? (
        <InstallGate orgId={orgId} player={null} onSkip={() => setInstallSkip(true)} />
      ) : (
        <NotifyPrompt orgId={orgId} role="coach" />
      )}

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
      {subTab === "scheduling" && (
        <div className="space-y-6">
          <MeetingsBoard
            orgId={orgId}
            slots={slots}
            setSlots={setSlots}
            coachPlayers={coachPlayers}
            setCoachPlayers={setCoachPlayers}
            onOpenPlayers={() => setSubTab("players")}
          />
          <CoachScheduling orgId={orgId} slots={slots} setSlots={setSlots} />
        </div>
      )}
      {subTab === "settings" && (
        <div className="max-w-md mx-auto space-y-5">
          <NotifyToggle orgId={orgId} role="coach" />
          <MeetingUrlSetting orgId={orgId} />
          <ExportCard players={coachPlayers} protocols={masterProtocols} loading={coachLoading} />
          <CoachSettings orgId={orgId} />
          {/* 免責文は「その他」の一番下に、常に同じ文面で出す */}
          <StandingNotice />
          <p className="text-center text-[11px] text-slate-400">{APP_BUILD}</p>
        </div>
      )}
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
  const [success, setSuccess] = useState(false);

  const handleChange = async () => {
    setError(null);
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
      // 今のパスワードの確認と変更は、サーバーの中で行う（v21）
      const changed = await sbRpc("coach_change_password", {
        p_org_id: orgId,
        p_current: current,
        p_new: next,
      });
      if (!changed) {
        setError("現在のパスワードが違います。");
        return;
      }
      coachSecret = next;
      setSuccess(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(errText(err));
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
// ---------- 面談で使うオンライン会議の URL（組織ごとの設定） ----------
//   指導者が「いつも使う URL」（Zoom のパーソナルミーティングなど）を1つ登録しておくと、
//   選手が面談の枠を予約したときに、その URL が面談に自動で付く（v15.13）。
//   保存先は app_settings の key = 'meeting_url'。同じ組織の人（選手を含む）は読める（参加に必要なため）。
const MEETING_URL_KEY = "meeting_url";
async function fetchMeetingUrl(orgId) {
  const rows = await sbSelect(
    "app_settings",
    `?org_id=eq.${encodeURIComponent(orgId)}&key=eq.${MEETING_URL_KEY}&select=value`
  );
  const value = rows?.[0]?.value || "";
  return safeHref(value) ? value : "";
}

function MeetingUrlSetting({ orgId }) {
  const [url, setUrl] = useState("");
  const [savedUrl, setSavedUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    fetchMeetingUrl(orgId)
      .then((v) => {
        if (!active) return;
        setUrl(v);
        setSavedUrl(v);
      })
      .catch((err) => active && setError(errText(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [orgId]);

  const save = async () => {
    const value = url.trim();
    setError(null);
    setDone(false);
    if (value && !safeHref(value)) {
      setError("https:// で始まる URL を貼り付けてください。");
      return;
    }
    setSaving(true);
    try {
      await sbUpsert("app_settings", { org_id: orgId, key: MEETING_URL_KEY, value }, "key,org_id");
      setSavedUrl(value);
      setDone(true);
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5">
        <Video size={16} className="text-blue-600" /> 面談で使うオンライン会議の URL
        {savedUrl && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">登録済み</span>
        )}
      </p>
      <p className="text-xs text-slate-400 mb-3 leading-relaxed">
        登録しておくと、選手が面談を予約したときに自動で付きます。
      </p>
      <input
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setDone(false);
        }}
        placeholder={loading ? "読み込み中..." : "https://zoom.us/j/..."}
        disabled={loading}
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm"
      />
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      {done && (
        <p className="text-xs text-green-600 mt-2">
          {savedUrl ? "保存しました。これから予約される面談に自動で付きます。" : "登録を消しました。"}
        </p>
      )}
      <button
        onClick={save}
        disabled={saving || loading || url.trim() === savedUrl}
        className="mt-3 w-full py-3 rounded-lg bg-slate-800 text-white text-sm font-bold disabled:bg-slate-300"
      >
        {saving ? "保存中..." : "保存する"}
      </button>
      <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
        予約済みの面談には反映されません。Zoom は待機室をオンにしておくと安心です。
      </p>
    </div>
  );
}

// ---------- 日程調整：決まった面談・公開中の枠の一覧 ----------
//   ・これからの面談：選手名・日時・参加できるスタッフ・オンライン会議URL・予約の取り消し
//   ・公開中の枠：まだ予約のない枠（公開をやめられる）
//   ・終わった面談：日時を過ぎたもの
function MeetingsBoard({ orgId, slots, setSlots, coachPlayers, setCoachPlayers, onOpenPlayers }) {
  const [error, setError] = useState(null);
  // 組織に登録してある「いつもの URL」（未入力の面談に、ボタン1つで入れられるように）
  const [defaultUrl, setDefaultUrl] = useState("");
  useEffect(() => {
    let active = true;
    fetchMeetingUrl(orgId)
      .then((v) => active && setDefaultUrl(v))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [orgId]);
  const [busyId, setBusyId] = useState(null);
  const [showPast, setShowPast] = useState(false);
  const now = new Date();
  const byTime = (a, b) => a.datetime.localeCompare(b.datetime);
  const isFuture = (s) => parseDatetime(s.datetime) > now;
  const upcoming = slots.filter((s) => s.bookedBy && isFuture(s)).sort(byTime);
  const open = slots.filter((s) => !s.bookedBy && isFuture(s)).sort(byTime);
  const past = slots.filter((s) => s.bookedBy && !isFuture(s)).sort(byTime).reverse();
  const playerOf = (id) => coachPlayers.find((p) => p.id === id) || null;
  const rolesOf = (s) => (s.matchedRoles || []).map((r) => SCHEDULING_ROLE_LABELS[r] || r).join("・");

  const saveZoomUrl = async (slotId, url) => {
    setError(null);
    try {
      await sbUpdate("slots", slotId, { zoom_url: url.trim() || null });
      setSlots((prev) => prev.map((s) => (s.id === slotId ? { ...s, zoomUrl: url.trim() || null } : s)));
    } catch (err) {
      setError(errText(err));
    }
  };

  // 予約の取り消し：枠を空きに戻し、選手にチャットで知らせる（通知も届く）
  const cancelBooking = async (slot) => {
    const player = playerOf(slot.bookedBy);
    const name = player?.name ?? "この選手";
    const sure = await askConfirm("面談の予約を取り消しますか？", {
      body: `${name}・${slot.datetime}\n枠は空きに戻り、選手にはチャットで知らせます。`,
      okLabel: "取り消す",
      danger: true,
    });
    if (!sure) return;
    setBusyId(slot.id);
    setError(null);
    try {
      await sbUpdate("slots", slot.id, { booked_by: null });
      if (player) {
        await sbUpdate("players", player.id, { booked_slot_id: null });
        const [msg] = await sbInsert("messages", {
          player_id: player.id,
          sender: "staff",
          staff_role: "coach",
          content: `【面談の取り消し】${slot.datetime} の面談の予約を取り消しました。あらためて日程を相談させてください。`,
        });
        setCoachPlayers((prev) =>
          prev.map((p) =>
            p.id === player.id
              ? { ...p, bookedSlotId: null, messages: msg ? [...p.messages, normalizeMessage(msg)] : p.messages }
              : p
          )
        );
      }
      setSlots((prev) => prev.map((s) => (s.id === slot.id ? { ...s, bookedBy: null } : s)));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusyId(null);
    }
  };

  // 公開をやめる（まだ予約のない枠だけ）
  const removeOpenSlot = async (slot) => {
    if (!(await askConfirm("この枠の公開をやめますか？", { body: slot.datetime, okLabel: "公開をやめる" }))) return;
    setBusyId(slot.id);
    setError(null);
    try {
      await sbDelete("slots", slot.id);
      setSlots((prev) => prev.filter((s) => s.id !== slot.id));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="font-bold text-slate-700 text-sm mb-1 flex items-center gap-1.5">
        <CalendarClock size={16} className="text-blue-600" /> 決まった面談
        <span className="text-xs font-normal text-slate-400">これから {upcoming.length}件</span>
      </h3>
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      {upcoming.length === 0 ? (
        <p className="text-sm text-slate-400 py-2">これからの面談の予約はありません。</p>
      ) : (
        <ul className="space-y-2 mt-2">
          {upcoming.map((s) => {
            const player = playerOf(s.bookedBy);
            return (
              <li key={s.id} className="border border-blue-200 bg-blue-50/50 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800">{s.datetime}</p>
                    <p className="text-sm text-slate-700 break-words">{player?.name ?? "（選手が見つかりません）"}</p>
                    <p className="text-[11px] text-slate-500">
                      {rolesOf(s) || "参加者未設定"}
                      {player?.injuryDate ? `・受傷後${diffDaysBetween(player.injuryDate, s.datetime)}日` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => cancelBooking(s)}
                    disabled={busyId === s.id}
                    className="shrink-0 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-600 hover:text-red-600 hover:border-red-300 disabled:opacity-40"
                  >
                    予約を取り消す
                  </button>
                </div>
                <MeetingUrlField key={`${s.id}:${s.zoomUrl || ""}`} slot={s} onSave={saveZoomUrl} defaultUrl={defaultUrl} />
              </li>
            );
          })}
        </ul>
      )}

      <h4 className="font-bold text-slate-600 text-xs mt-5 mb-1">公開中の枠（まだ予約なし）{open.length}件</h4>
      {open.length === 0 ? (
        <p className="text-xs text-slate-400">公開中の枠はありません。</p>
      ) : (
        <ul className="space-y-1.5">
          {open.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2">
              <span className="text-sm text-slate-700">
                {s.datetime}
                <span className="block text-[11px] text-slate-400">{rolesOf(s)}</span>
              </span>
              <button
                onClick={() => removeOpenSlot(s)}
                disabled={busyId === s.id}
                className="shrink-0 px-3 py-2 rounded-lg text-xs text-slate-500 border border-slate-200 hover:text-red-600 hover:border-red-300 disabled:opacity-40"
              >
                公開をやめる
              </button>
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <div className="mt-5">
          <button onClick={() => setShowPast((v) => !v)} className="text-xs text-blue-600 underline py-2">
            終わった面談 {past.length}件を{showPast ? "閉じる" : "見る"}
          </button>
          {showPast && (
            <ul className="space-y-1 mt-1">
              {past.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-3 py-2 text-xs">
                  <span className="text-slate-600">
                    {s.datetime}・{playerOf(s.bookedBy)?.name ?? "（選手が見つかりません）"}
                  </span>
                  <span className="font-bold text-green-600 shrink-0">実施済み</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// オンライン会議URLの入力（面談1件ごと）
function MeetingUrlField({ slot, onSave, defaultUrl }) {
  const [url, setUrl] = useState(slot.zoomUrl || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
   <div className="mt-2">
    {!slot.zoomUrl && defaultUrl && (
      <button
        onClick={() => onSave(slot.id, defaultUrl)}
        className="mb-2 w-full py-2 rounded-lg border border-blue-200 bg-white text-xs font-bold text-blue-700"
      >
        登録してあるいつもの URL を入れる
      </button>
    )}
    <div className="flex items-center gap-2">
      <Video size={14} className="text-slate-400 shrink-0" />
      <input
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setSaved(false);
        }}
        placeholder="オンライン会議URL（Zoomなど・任意）"
        className="flex-1 min-w-0 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
      />
      <button
        onClick={async () => {
          setSaving(true);
          await onSave(slot.id, url);
          setSaving(false);
          setSaved(true);
        }}
        disabled={saving}
        className="shrink-0 px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-medium disabled:bg-slate-300"
      >
        {saved ? "保存済み" : "保存"}
      </button>
    </div>
   </div>
  );
}

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
      setError(errText(err));
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
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAvailability = async (id) => {
    try {
      await sbDelete("staff_availability", id);
      setAvailability((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(errText(err));
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
        .filter(([, roleSet]) => matchedStaffCount(roleSet) >= MEETING_MIN_STAFF)
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
      setError(errText(err));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-xl border border-slate-200 p-5 h-fit">
        <h3 className="font-bold text-slate-700 text-sm mb-4">空いている日時を登録</h3>
        <label className="text-xs text-slate-500">だれの予定か</label>
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
        <label className="text-xs text-slate-500">日付</label>
        <input
          type="date"
          value={`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`}
          min={localDateStr(now)}
          onChange={(e) => {
            const [y, m, d] = e.target.value.split("-").map(Number);
            if (!y || !m || !d) return;
            setYear(y);
            setMonth(m);
            setDay(d);
          }}
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mt-1 mb-3 bg-white"
        />
        <label className="text-xs text-slate-500">時刻</label>
        <div className="grid grid-cols-2 gap-2 mt-1 mb-3">
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
          {saving ? "登録中..." : "登録する"}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-bold text-slate-700 text-sm mb-2">登録済みの日時</h3>
        <p className="text-xs text-slate-400 mb-3">
          コーチ・トレーナー・ドクターのうち <span className="font-bold text-slate-600">2人以上</span>
          が空いている日時が公開されます。
        </p>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="w-full mb-4 py-3 rounded-lg bg-slate-800 text-white text-sm font-bold disabled:bg-slate-300 flex items-center justify-center gap-2"
        >
          {syncing && <Loader2 size={14} className="animate-spin" />} そろった日時を公開する
        </button>
        {loading ? (
          <p className="text-sm text-slate-400">読み込み中...</p>
        ) : (
          <ul className="space-y-2 max-h-72 overflow-y-auto">
            {Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([datetime, roleSet]) => {
                const roles = Array.from(roleSet);
                const qualifies = matchedStaffCount(roleSet) >= MEETING_MIN_STAFF;
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
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await sbDelete("phase_menus", id);
      setPhaseMenus((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      setError(errText(err));
    }
  };

  const protocolName = (id) => masterProtocols.find((p) => p.id === id)?.name ?? "不明";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-3">
        <h3 className="font-bold text-slate-700 text-sm">登録済みメニュー ({phaseMenus.length})</h3>
        {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => {
          const menusForPhase = phaseMenus.filter((m) => m.phaseNumber === n);
          if (menusForPhase.length === 0) return null;
          return (
            <div key={n} className="bg-white rounded-xl border border-slate-200 p-4">
              <p className={`text-xs font-bold mb-2 ${PHASE_TEXT_COLORS[n]}`}>PHASE {n}</p>
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
                      <p className="mt-1 text-red-500">NG代償動作：{m.ngCompensation}</p>
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
        <label className="text-xs text-slate-500">対象の PHASE</label>
        <select
          value={phaseNumber}
          onChange={(e) => setPhaseNumber(Number(e.target.value))}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 mb-3 bg-white"
        >
          {phaseRange(masterProtocols.find((p) => p.id === protocolId)).map((n) => (
            <option key={n} value={n}>
              PHASE {n}
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
        <label className="text-xs text-slate-500">注意すべきNG代償動作</label>
        <textarea
          value={ngCompensation}
          onChange={(e) => setNgCompensation(e.target.value)}
          rows={2}
          placeholder="例：骨盤が後傾して腰が丸まる代償動作に注意"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 mb-3"
        />
        <label className="text-xs text-slate-500">患部外でできる代わりのメニュー</label>
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

// ---------- 選手・トレーナー共通：いまの PHASE のメニューカタログ表示 ----------
function PhaseMenuCatalog({ menus, protocolId, phaseNumber }) {
  const relevant = menus.filter((m) => m.protocolId === protocolId && m.phaseNumber === phaseNumber);
  if (relevant.length === 0) {
    return <p className="text-sm text-slate-400">この PHASE のメニューは、まだありません。</p>;
  }
  return (
    <div className="space-y-3">
      {relevant.map((m) => (
        <div key={m.id} className="bg-slate-50 rounded-lg p-3 text-sm">
          <p className="font-bold text-slate-700">{m.name}</p>
          {m.youtubeUrl && (
            <a
              href={safeHref(m.youtubeUrl)}
              target="_blank"
              rel="noreferrer"
              className="mt-1 flex items-center gap-1 text-blue-600 text-xs hover:underline"
            >
              <Youtube size={13} /> 動画を見る
            </a>
          )}
          {m.ngCompensation && (
            <p className="mt-1 text-xs text-red-500">NG代償動作：{m.ngCompensation}</p>
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
  const makePhase = (i) => ({ title: "", conditionsText: "" });
  const blankPhases = (n = 5) => Array.from({ length: n }, (_, i) => makePhase(i));

  const [name, setName] = useState("");
  const [totalWeeks, setTotalWeeks] = useState(8);
  const [videoUrl, setVideoUrl] = useState("");
  const [scheme, setScheme] = useState("");
  const [phaseForms, setPhaseForms] = useState(blankPhases(5));
  const [showAdd, setShowAdd] = useState(false);
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
      title: p.title.trim() || "（名称なし）",
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
      setShowAdd(false);
    } catch (err) {
      setError(errText(err));
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
      const sure = await askConfirm(`プロトコル「${protoName}」を削除しますか？`, {
        body: `${warn.trim() ? warn.trim() + "\n" : ""}この操作は取り消せません。`,
        okLabel: "削除する",
        danger: true,
      });
      if (!sure) return;
      await sbDelete("protocols", id);
      setMasterProtocols((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(`削除できませんでした: ${errText(err)}`);
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
      setError(errText(err));
    }
  };

  // 登録済みのプロトコルの中身（標準復帰期間・各フェーズの名称と条件）を書き換える。
  // フェーズの数は変えない（選手の現在の PHASE や記録とずれないように）。
  const handleUpdateContent = async (id, totalWeeks, phases) => {
    setError(null);
    await sbUpdate("protocols", id, { total_weeks: totalWeeks, phases });
    setMasterProtocols((prev) =>
      prev.map((p) => (p.id === id ? { ...p, totalWeeks, phases, phaseCount: phases.length || p.phaseCount } : p))
    );
  };

  // よくある質問の保存（失敗は呼び出し側で表示する）
  const handleUpdateFaq = async (id, faq) => {
    await sbUpdate("protocols", id, { faq });
    setMasterProtocols((prev) => prev.map((p) => (p.id === id ? { ...p, faq } : p)));
  };

  const handleUpdateVideoUrl = async (id, url) => {
    try {
      await sbUpdate("protocols", id, { video_url: url.trim() || null });
      setMasterProtocols((prev) =>
        prev.map((p) => (p.id === id ? { ...p, videoUrl: url.trim() || null } : p))
      );
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <h3 className="font-bold text-slate-700 text-sm">
          プロトコル {masterProtocols.length}件
        </h3>
        {masterProtocols.map((p) => (
          <ProtocolCard
            key={p.id}
            protocol={p}
            onDelete={handleDeleteProtocol}
            onSaveVideo={handleUpdateVideoUrl}
            onSaveScheme={handleUpdateScheme}
            onSaveContent={handleUpdateContent}
            onSaveFaq={handleUpdateFaq}
          />
        ))}
        {masterProtocols.length === 0 && (
          <p className="text-sm text-slate-400">まだプロトコルが登録されていません。</p>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      {!showAdd && (
        <button
          onClick={() => setShowAdd(true)}
          className="h-fit w-full py-3 rounded-xl border border-dashed border-slate-300 text-sm font-bold text-slate-600 flex items-center justify-center gap-1.5"
        >
          <PlusCircle size={16} className="text-blue-600" /> プロトコルを追加
        </button>
      )}
      <div className={`bg-white rounded-xl border border-slate-200 p-5 h-fit ${showAdd ? "" : "hidden"}`}>
        <h3 className="font-bold text-slate-700 text-sm mb-4 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <PlusCircle size={16} className="text-blue-600" /> プロトコルを追加
          </span>
          <button onClick={() => setShowAdd(false)} className="text-slate-400 p-2 -m-2" aria-label="閉じる">
            <X size={16} />
          </button>
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
            <label className="text-xs text-slate-500">全体復帰までの期間（週）</label>
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
          </div>

          <div className="flex items-center justify-between">
            <label className="text-xs text-slate-500">
              PHASE の構成（全 {phaseForms.length} 段階）
            </label>
            <button
              onClick={addPhase}
              className="text-[11px] px-2.5 py-1 rounded-full border border-blue-200 text-blue-600 hover:bg-blue-50"
            >
              PHASE を追加
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
            {phaseForms.map((p, idx) => (
              <div key={idx} className="border border-slate-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-500">PHASE {idx + 1} 名称</label>
                  {phaseForms.length > 1 && (
                    <button
                      onClick={() => removePhase(idx)}
                      className="text-slate-400 hover:text-red-500"
                      title="この PHASE を削除"
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

function ProtocolCard({ protocol, onDelete, onSaveVideo, onSaveScheme, onSaveContent, onSaveFaq }) {
  const [videoUrl, setVideoUrl] = useState(protocol.videoUrl || "");
  const [savingVideo, setSavingVideo] = useState(false);
  // 中身の編集（フェーズの数は変えない）
  const [editing, setEditing] = useState(false);
  const [showPhases, setShowPhases] = useState(false);
  const [weeksDraft, setWeeksDraft] = useState(String(protocol.totalWeeks ?? 8));
  const [phaseDrafts, setPhaseDrafts] = useState([]);
  const [savingContent, setSavingContent] = useState(false);
  const [contentError, setContentError] = useState(null);

  const startEdit = () => {
    setWeeksDraft(String(protocol.totalWeeks ?? 8));
    setPhaseDrafts(
      protocol.phases.map((ph) => ({ title: ph.title || "", conditionsText: (ph.conditions || []).join("\n") }))
    );
    setContentError(null);
    setEditing(true);
  };
  const updateDraft = (idx, field, value) =>
    setPhaseDrafts((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));

  const saveContent = async () => {
    const weeks = Number(weeksDraft);
    if (!Number.isFinite(weeks) || weeks < 1 || weeks > 104) {
      setContentError("標準復帰期間は1〜104週で入力してください。");
      return;
    }
    // 元のフェーズの情報（他の項目があれば）を残したまま、名称と条件だけ差し替える
    const phases = protocol.phases.map((ph, i) => ({
      ...ph,
      title: phaseDrafts[i]?.title.trim() || ph.title || "（名称なし）",
      conditions: (phaseDrafts[i]?.conditionsText || "").split("\n").map((c) => c.trim()).filter(Boolean),
    }));
    setSavingContent(true);
    setContentError(null);
    try {
      await onSaveContent(protocol.id, Math.round(weeks), phases);
      setEditing(false);
    } catch (err) {
      setContentError(`保存できませんでした: ${errText(err)}`);
    } finally {
      setSavingContent(false);
    }
  };

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
          <p className="text-xs text-slate-400">全体復帰までの期間: 約{protocol.totalWeeks}週間</p>
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
        <div className="flex items-center gap-1 shrink-0">
          {!editing && (
            <button
              onClick={startEdit}
              className="flex items-center gap-1 px-3 py-2 rounded-lg border border-blue-200 text-blue-600 text-xs font-bold hover:bg-blue-50"
            >
              <Pencil size={13} /> 編集
            </button>
          )}
          <button
            onClick={() => onDelete(protocol.id, protocol.name)}
            className="text-slate-400 hover:text-red-500 p-2.5"
            title="このプロトコルを削除"
            aria-label="このプロトコルを削除"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      {editing && (
        <div className="mt-3 space-y-3 border border-blue-200 bg-blue-50/40 rounded-lg p-3">
          <div>
            <label className="text-xs font-bold text-slate-600">全体復帰までの期間（週）</label>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={104}
              value={weeksDraft}
              onChange={(e) => setWeeksDraft(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mt-1 bg-white"
            />
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            PHASE の数（{protocol.phases.length}）は変わりません。条件の順番を入れ替えると、記録済みの「できた」とずれます。
          </p>
          {phaseDrafts.map((p, idx) => (
            <div key={idx} className="bg-white border border-slate-200 rounded-lg p-3">
              <label className="text-xs text-slate-500">PHASE {idx + 1} 名称</label>
              <input
                value={p.title}
                onChange={(e) => updateDraft(idx, "title", e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1 mb-2"
              />
              <label className="text-xs text-slate-500">条件（1行に1つ）</label>
              <textarea
                value={p.conditionsText}
                onChange={(e) => updateDraft(idx, "conditionsText", e.target.value)}
                rows={Math.max(3, p.conditionsText.split("\n").length + 1)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1"
              />
            </div>
          ))}
          {contentError && <p className="text-xs text-red-500">{contentError}</p>}
          <div className="flex gap-2 sticky bottom-20">
            <button
              onClick={() => setEditing(false)}
              disabled={savingContent}
              className="flex-1 py-3 rounded-lg border border-slate-300 bg-white text-slate-600 text-sm"
            >
              やめる
            </button>
            <button
              onClick={saveContent}
              disabled={savingContent}
              className="flex-1 py-3 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:bg-slate-300 flex items-center justify-center gap-1.5"
            >
              {savingContent ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {savingContent ? "保存中..." : "保存する"}
            </button>
          </div>
        </div>
      )}
      {!editing && (
        <button
          onClick={() => setShowPhases((v) => !v)}
          className="mt-3 w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-50 text-sm text-slate-600"
        >
          PHASE と条件
          {showPhases ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      )}
      <div className={`mt-2 space-y-2 ${editing || !showPhases ? "hidden" : ""}`}>
        {protocol.phases.map((ph, i) => (
          <div key={i} className="text-xs bg-slate-50 rounded-lg px-3 py-2">
            <p className="font-semibold text-slate-600">
              PHASE {i + 1}: {ph.title}
            </p>
            <ul className="mt-1 list-disc list-inside text-slate-500">
              {ph.conditions.map((c, j) => (
                <li key={j}>{c}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <FaqEditor protocol={protocol} onSave={onSaveFaq} />
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
  const detailRef = React.useRef(null);
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
      setError(errText(err));
    }
  };

  // 自動では進めない。人が確認したときだけ呼ばれ、確認者と日時を残す。
  // PHASEを進める／復帰を記録するのは選手本人だけにした（指導者側からは行わない）。
  // スタッフはGATE項目のチェックと観察の記録を担当する。

  // 選手が暗証番号を忘れたとき：指導者が新しい4桁を決めて、本人に伝える
  const resetPin = async (target) => {
    const next = await askText(`${target.name} の暗証番号を再設定`, {
      body: "新しい暗証番号（数字4桁）を決めて、本人に伝えてください。",
      placeholder: "数字4桁",
      inputMode: "numeric",
      maxLength: 4,
      okLabel: "再設定する",
    });
    if (next === null) return;
    if (!/^\d{4}$/.test(next.trim())) {
      setError("暗証番号は数字4桁で入力してください。");
      return;
    }
    try {
      await sbUpdate("players", target.id, { pin: next.trim() });
      setError(null);
      showMessage("暗証番号を再設定しました", { body: `${target.name} に新しい暗証番号を伝えてください。` });
    } catch (err) {
      setError(errText(err));
    }
  };

  const deletePlayer = async (playerId, playerName) => {
    const confirmed = await askConfirm(`「${playerName}」のデータを削除しますか？`, {
      body: "日報・チャットなどの記録もすべて消えます。この操作は取り消せません。",
      okLabel: "削除する",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await sbDelete("players", playerId);
      setCoachPlayers((prev) => prev.filter((p) => p.id !== playerId));
      if (selectedId === playerId) setSelectedId(null);
    } catch (err) {
      setError(errText(err));
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

  const closeConsultation = async (playerId, requestId) => {
    await sbUpdate("consultation_requests", requestId, { status: "closed" });
    setCoachPlayers((prev) =>
      prev.map((p) =>
        p.id === playerId
          ? { ...p, consultations: (p.consultations || []).map((c) => (c.id === requestId ? { ...c, status: "closed" } : c)) }
          : p
      )
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

  // 判定はしない。観察した事実だけを記録する。
  const assessReport = async (playerId, reportId, compensation, severeSymptom, observerName) => {
    await sbUpdate("reports", reportId, {
      compensation,
      severe_symptom: severeSymptom,
      observed_by: observerName || null,
    });
    setCoachPlayers((prev) =>
      prev.map((p) =>
        p.id === playerId
          ? {
              ...p,
              reports: p.reports.map((r) =>
                r.id === reportId
                  ? { ...r, compensation, severeSymptom, observedBy: observerName || null }
                  : r
              ),
            }
          : p
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
            {listView === "active" ? "現役選手" : "復帰者"} {visiblePlayers.length}名
            {listView === "active" && visiblePlayers.length > 0 && (
              <span className="font-normal text-slate-500 ml-2">
                今日の日報 {visiblePlayers.filter((p) => reportedToday(p)).length}/{visiblePlayers.length}
              </span>
            )}
          </p>
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
                  onClick={() => {
                    setSelectedId(p.id);
                    // スマホ（1列表示）では、選んだ選手の詳細まで画面を送る
                    if (window.matchMedia("(max-width: 1023px)").matches) {
                      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                    }
                  }}
                  className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors ${rowBg}`}
                >
                  <div>
                    <p className={`text-sm font-semibold ${nameColor}`}>{p.name}</p>
                    <p className="text-xs text-slate-400">
                      {protocolOf(p)?.name ?? "未設定"} ・{" "}
                      <span className={`font-bold ${PHASE_TEXT_COLORS[p.currentPhase]}`}>
                        PHASE {p.currentPhase}/{phaseCountOf(protocolOf(p))}
                      </span>
                    </p>
                    {classificationLabel(p) && (
                      <p className="text-[10px] text-blue-600 mt-0.5">{classificationLabel(p)}</p>
                    )}
                    {p.supportStatus && p.supportStatus !== "unresolved" && (
                      <p
                        className={`text-[10px] font-bold mt-0.5 ${
                          p.supportStatus === "resolved" ? "text-green-600" : "text-blue-600"
                        }`}
                      >
                        {p.supportStatus === "resolved"
                          ? "解決済み"
                          : `対応中：${CHAT_STAFF_ROLE_LABELS[p.supportAssigneeRole] || "指導者"}`}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1 shrink-0 max-w-[55%]">
                    {needsAttention && (
                      <span className="bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        新着/未対応
                      </span>
                    )}
                    {pendingConsultations(p).length > 0 && (
                      <span className="bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        面談希望
                      </span>
                    )}
                    {meetingLevel === "yellow" &&
                      (upcomingMeeting(p, slots) ? (
                        <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                          面談予定
                        </span>
                      ) : (
                        <span className="bg-yellow-400 text-yellow-900 text-[10px] font-bold px-2 py-0.5 rounded-full">
                          面談未実施
                        </span>
                      ))}
                    {unread > 0 && (
                      <span className="flex items-center gap-0.5 bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        <MessageCircle size={10} /> {unread}
                      </span>
                    )}
                    {!isCompleted && !reportedToday(p) && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-slate-300 text-slate-500">
                        日報なし
                      </span>
                    )}
                    {r && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        痛み {r.vas}
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
        {listView === "active" && <BroadcastBox players={visiblePlayers} setCoachPlayers={setCoachPlayers} />}
      </div>

      <div ref={detailRef} className="scroll-mt-20">
        {selectedPlayer && (
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="lg:hidden mb-3 flex items-center gap-1 text-sm text-blue-600 py-2 print:hidden"
          >
            <ChevronUp size={16} /> 選手一覧に戻る
          </button>
        )}
        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
        {!selectedPlayer && (
          <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 text-sm">
            リストから選手を選択してください
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
            onDelete={() => deletePlayer(selectedPlayer.id, selectedPlayer.name)}
            onResetPin={() => resetPin(selectedPlayer)}
            onSendMessage={(content, role, extra) => sendCoachMessage(selectedPlayer.id, content, role, extra)}
            onSaveZoomUrl={saveZoomUrl}
            onAddTreatments={(types, note, date) => addTreatments(selectedPlayer.id, types, note, date)}
            onDeleteTreatment={(id) => deleteTreatment(selectedPlayer.id, id)}
            onSaveImagingFindings={(text) => saveImagingFindings(selectedPlayer.id, text)}
            onAssessReport={(reportId, compensation, severeSymptom, observerName) =>
              assessReport(selectedPlayer.id, reportId, compensation, severeSymptom, observerName)
            }
            onResolveSos={() => resolveSos(selectedPlayer.id)}
            onCloseConsultation={(requestId) => closeConsultation(selectedPlayer.id, requestId)}
            onResolveChatStatus={() => resolveChatStatus(selectedPlayer.id)}
            setCoachPlayers={setCoachPlayers}
          />
        )}
      </div>
    </div>
  );
}

const DETAIL_TABS = [
  { key: "report", label: "日報" },
  { key: "gate", label: "GATE" },
  { key: "menu", label: "メニュー" },
  { key: "record", label: "記録" },
  { key: "chat", label: "チャット" },
];

function PlayerDetailPanel({
  orgId,
  player,
  protocol,
  allPlayers,
  slots,
  phaseMenus,
  toggleChecklist,
  onDelete,
  onSendMessage,
  onSaveZoomUrl,
  onAddTreatments,
  onDeleteTreatment,
  onSaveImagingFindings,
  onAssessReport,
  onResolveSos,
  onResolveChatStatus,
  onCloseConsultation,
  onResetPin,
  setCoachPlayers,
}) {
  const report = latestReport(player);
  const phaseInfo = protocol?.phases[player.currentPhase - 1];

  // 要件⑤：同一組織内の実データ（injury_date・completed_at）から直接JavaScriptで算出。
  // モックではなく、指導者が読み込んでいる実際の選手一覧が計算元になる。
  const avg = protocol ? computeAvgRecoveryFromPlayers(allPlayers, protocol.id) : null;

  // 詳細の中のタブ。選手を切り替えたら「日報」に戻す
  const [dtab, setDtab] = useState("report");
  useEffect(() => setDtab("report"), [player.id]);
  const unreadChat = player.messages.filter((m) => m.sender === "player" && !m.isRead).length;

  // チャットのタブを開いたときに、選手からのメッセージを既読にする
  useEffect(() => {
    if (dtab !== "chat" || unreadChat === 0) return;
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
  }, [player.id, dtab, unreadChat]);

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
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-bold text-lg text-slate-800">{player.name}</h3>
            <p className="text-sm text-slate-400">
              {protocol?.name ?? "未設定"} ・ 現在{" "}
              <span className={`font-bold ${PHASE_TEXT_COLORS[player.currentPhase]}`}>
                PHASE {player.currentPhase}/{phaseCountOf(protocol)}
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
          <div className="flex flex-wrap items-center gap-2 shrink-0">
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
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 rounded-full px-3 py-2"
              title="レポートを印刷 / PDF出力"
            >
              <Printer size={14} /> レポート出力
            </button>
            <button
              onClick={onResetPin}
              className="flex items-center gap-1 text-xs text-slate-600 border border-slate-200 rounded-full px-3 py-2"
            >
              <KeyRound size={14} /> 暗証番号を再設定
            </button>
            <button
              onClick={onDelete}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 border border-slate-200 hover:border-red-300 rounded-full px-3 py-2"
              title="選手をデータベースから完全に削除する"
            >
              <Trash2 size={14} /> 削除
            </button>
          </div>
        </div>

        {/* 詳細は5つに分けて表示する（1ページに並べると長く、チャットが一番下になってしまうため） */}
        <div className="flex gap-1 bg-slate-200 rounded-full p-1 sticky top-[60px] z-10 overflow-x-auto no-scrollbar">
          {DETAIL_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setDtab(t.key)}
              className={`flex-1 min-w-[56px] py-2 rounded-full text-sm font-bold whitespace-nowrap flex items-center justify-center gap-1 ${
                dtab === t.key ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"
              }`}
            >
              {t.label}
              {t.key === "chat" && unreadChat > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] leading-[18px] text-center">
                  {unreadChat > 9 ? "9+" : unreadChat}
                </span>
              )}
            </button>
          ))}
        </div>

        {dtab === "report" && (
          <>
          <MeetingReminder player={player} slots={slots} viewer="staff" />

          <ConsultationInbox player={player} onClose={onCloseConsultation} />

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h4 className="text-sm font-bold text-slate-700 mb-3">本日の日報</h4>
            {!report && <p className="text-sm text-slate-400">まだ報告がありません。</p>}
            {report && (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-400 mb-1">痛み(VAS)</p>
                  <p className="text-2xl font-bold text-slate-800">{report.vas}</p>
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
                {report.rpe != null && (
                  <div className="bg-slate-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-slate-400 mb-1">RPE</p>
                    <p className="text-2xl font-bold text-slate-800">{report.rpe}</p>
                  </div>
                )}
                {report.fear != null && (
                  <div className="bg-slate-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-slate-400 mb-1">恐怖心</p>
                    <p className="text-2xl font-bold text-slate-800">{report.fear}</p>
                  </div>
                )}
                {report.slippingContact != null && (
                  <div className="bg-slate-50 rounded-lg p-3 text-center flex flex-col justify-center">
                    <p className="text-xs text-slate-400 mb-1">抜ける接地</p>
                    <p className="text-sm font-bold text-slate-700">{report.slippingContact ? "あり" : "なし"}</p>
                  </div>
                )}
              </div>
            )}
            {report && <ReportThread player={player} viewer="staff" />}
            {report && (
              <ObservationRecord
                key={report.id}
                report={{
                  ...report,
                  prevVas:
                    player.reports.length > 1 ? player.reports[player.reports.length - 2].vas : null,
                }}
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
          </>
        )}

        {dtab === "gate" && (
          <>
          <GatePanel
            orgId={orgId}
            player={player}
            protocol={protocol}
            phaseInfo={phaseInfo}
            viewerRole="staff"
          />
          </>
        )}

        {dtab === "menu" && (
          <>
          <AthleteMetricsCard
            player={player}
            onSaved={(patch) =>
              setCoachPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, ...patch } : p)))
            }
          />

          <CumulativeMenuPanel player={player} protocol={protocol} />

          <OffsiteTrainingPanel orgId={orgId} player={player} />

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
              <Dumbbell size={16} className="text-blue-600" /> いまの PHASE のメニュー
            </h4>
            <PhaseMenuCatalog menus={phaseMenus} protocolId={player.protocolId} phaseNumber={player.currentPhase} />
          </div>
          </>
        )}

        {dtab === "record" && (
          <>
          <MeetingNotes player={player} viewer="staff" />

          <StaffNotes player={player} />

          <ImagingFindingsCard player={player} onSave={onSaveImagingFindings} />

          <HamstringClassificationCard
            orgId={orgId}
            player={player}
            protocol={protocol}
            onSaved={(patch) =>
              setCoachPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, ...patch } : p)))
            }
          />

          <TreatmentCard player={player} onAddTreatments={onAddTreatments} onDeleteTreatment={onDeleteTreatment} />

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
          </div>
          </>
        )}

        {dtab === "chat" && (
          <>
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                <MessageCircle size={16} className="text-blue-600" /> チャット
              </p>
              <div className="flex items-center gap-2 shrink-0">
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
                    ? `対応中：${CHAT_STAFF_ROLE_LABELS[player.supportAssigneeRole] || "指導者"}`
                    : "未対応"}
                </span>
                {player.supportStatus !== "resolved" && (
                  <button
                    onClick={onResolveChatStatus}
                    className="text-xs text-slate-500 border border-slate-200 rounded-full px-2.5 py-1"
                  >
                    解決済みにする
                  </button>
                )}
              </div>
            </div>
            <ChatPanel
              playerId={player.id}
              orgId={orgId}
              messages={player.messages}
              myRole="staff"
              title=""
              roleOptions={CHAT_STAFF_ROLES}
              onSend={onSendMessage}
              hideHeader
            />
          </div>
          </>
        )}
      </div>

      <PrintSummary player={player} protocol={protocol} phaseInfo={phaseInfo} avg={avg} myMeetings={myMeetings} />
    </>
  );
}

// ---------- コンディション推移の簡易折れ線グラフ（外部ライブラリ不使用） ----------
function SimpleTrendChart({ reports, limit = 14 }) {
  const width = 320;
  const height = 110;
  const padding = 8;
  const recent = limit ? reports.slice(-limit) : reports;
  if (recent.length < 2) return <p className="text-xs text-slate-400">記録が2件になるとグラフが出ます。</p>;

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
// ---------- 観察の記録（代償動作・歩行が困難な鋭い痛み） ----------
// ============================================================
// GATE：項目ごとに「できた／できていない」を本人・スタッフが記録する。
//   ・文言は原案のまま表示する（言い換えない・条件を足さない）
//   ・誰か一人が「できた」とチェックすれば満たしたものとして扱う
//   ・「できていない」の記録も消さずに残して見えるようにする
//   ・「実施後〜翌日に症状増悪なし」は翌日の日報から自動で見る
//   ・フェーズは自動で進めない。条件がそろったら人が確認して進める
// ============================================================
function isNextDayItem(text) {
  return text.includes("実施後") && text.includes("翌日");
}

// 面談の申し込み（選手 → 指導者）
//   申し込みは種類を分けない（誰と話すかは指導者側で決める。動画はチャットで送れる）。
//   DB の kind 列には、既存の制約に合う 'coach' を入れる。
//   医師との相談（kind: 'doctor'）は、公開範囲（健康医療相談／オンライン診療）が決まるまで出さない。
const CONSULTATION_KIND_DEFAULT = "coach";

function formatDateTimeJa(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function ConsultationRequestCard({ orgId, player, setMyPlayer }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const pending = pendingConsultations(player);

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      const [row] = await sbInsert("consultation_requests", {
        player_id: player.id,
        org_id: orgId,
        kind: CONSULTATION_KIND_DEFAULT,
        note: note.trim() || null,
      });
      if (row && setMyPlayer) {
        setMyPlayer((prev) => ({ ...prev, consultations: [...(prev.consultations || []), normalizeConsultation(row)] }));
      }
      setNote("");
      setOpen(false);
    } catch (err) {
      setError(errText(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5">
        <MessageCircle size={16} className="text-blue-600" /> 面談を申し込む
      </p>
      <p className="text-xs text-slate-400 mb-3">
        指導者に通知が届きます。
      </p>
      {pending.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {pending.map((c) => (
            <div key={c.id} className="bg-blue-50 rounded-lg px-3 py-2">
              <p className="text-xs font-bold text-blue-700">申し込み済み（{formatDateTimeJa(c.createdAt)}）・指導者からの連絡待ち</p>
              {c.note && <p className="text-xs text-blue-700/80 mt-0.5 whitespace-pre-wrap">{c.note}</p>}
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full py-3 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
        >
          {pending.length ? "もう一度申し込む" : "面談を申し込む"}
        </button>
      ) : (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="話したいこと・都合のよい日時など（任意）"
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setOpen(false)}
              className="flex-1 py-3 rounded-lg border border-slate-300 text-slate-600 text-sm"
            >
              やめる
            </button>
            <button
              onClick={submit}
              disabled={sending}
              className="flex-1 py-3 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:bg-slate-300"
            >
              {sending ? "送信中..." : "申し込む"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 選手ホームの一番上：今日やること（日報がまだなら送る／済みなら済みと分かる）と、連続記録
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
function TodayCard({ player, onReport, onMenu }) {
  const done = reportedToday(player);
  const streak = reportStreak(player.reports);
  const now = new Date();
  return (
    <div className="bg-slate-900 text-white rounded-2xl p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-slate-300">
          {now.getMonth() + 1}月{now.getDate()}日（{WEEKDAYS[now.getDay()]}）
        </p>
        {streak >= 2 && <p className="text-xs font-bold text-amber-300">日報 {streak}日連続</p>}
      </div>
      {done ? (
        <p className="mt-3 text-base font-bold flex items-center gap-2">
          <CheckCircle2 size={20} className="text-green-400" /> 今日の日報は送信済み
        </p>
      ) : (
        <button
          onClick={onReport}
          className="mt-3 w-full py-3.5 rounded-xl bg-white text-slate-900 font-bold text-base flex items-center justify-center gap-2"
        >
          <Send size={18} /> 今日の日報を送る
        </button>
      )}
      <button onClick={onMenu} className="mt-3 w-full py-2.5 rounded-xl border border-slate-600 text-sm text-slate-200 flex items-center justify-center gap-1">
        今日のメニュー <ArrowRight size={14} />
      </button>
    </div>
  );
}

// 受傷から2週間を過ぎて、まだ面談をしていない選手への案内（選手・指導者の両方に出す）
//   受傷日からの日数だけで出す。日報の内容（痛みなど）とは関係しない。
function MeetingReminder({ player, slots, viewer, hasOpenSlots, onGoBooking, onGoRequest }) {
  if (meetingAlertLevel(player, slots) !== "yellow") return null;
  const upcoming = upcomingMeeting(player, slots);
  const days = daysSince(player.injuryDate);
  if (upcoming) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-2">
        <CalendarClock size={18} className="text-blue-600 shrink-0 mt-0.5" />
        <p className="text-sm text-blue-800">
          <span className="font-bold">面談の予定：{upcoming.datetime}</span>
          <span className="block text-xs text-blue-700 mt-0.5">受傷から{days}日。初回の面談はこの日時に行います。</span>
        </p>
      </div>
    );
  }
  return (
    <div className="bg-yellow-50 border-2 border-yellow-300 rounded-2xl p-4" role="alert">
      <p className="text-sm font-bold text-yellow-900 flex items-center gap-1.5">
        <Bell size={18} className="shrink-0" />
        {viewer === "self" ? "面談をしましょう" : "面談がまだ行われていません"}
      </p>
      <p className="text-xs text-yellow-900/80 mt-1 leading-relaxed">
        受傷から{days}日がたちました。チームでは、受傷から{MEETING_REMINDER_DAYS}日を目安に、
        {viewer === "self" ? "指導者との面談を行うことにしています。" : "選手との面談を行うことにしています。日程調整で枠を公開するか、チャットで日時を相談してください。"}
      </p>
      {viewer === "self" && (
        <div className="flex gap-2 mt-3">
          {hasOpenSlots && (
            <button onClick={onGoBooking} className="flex-1 py-2.5 rounded-lg bg-yellow-500 text-white text-sm font-bold">
              面談の枠を選ぶ
            </button>
          )}
          <button
            onClick={onGoRequest}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold ${
              hasOpenSlots ? "border border-yellow-400 text-yellow-900 bg-white" : "bg-yellow-500 text-white"
            }`}
          >
            面談を申し込む
          </button>
        </div>
      )}
    </div>
  );
}

// 指導者側：選手からの面談の申し込み（未対応のものを上に出す）
function ConsultationInbox({ player, onClose }) {
  const pending = pendingConsultations(player);
  const [busy, setBusy] = useState(null);
  if (pending.length === 0) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
      <p className="text-sm font-bold text-amber-800 flex items-center gap-1.5 mb-2">
        <CalendarClock size={16} /> 面談の申し込み（{pending.length}件）
      </p>
      <div className="space-y-2">
        {pending.map((c) => (
          <div key={c.id} className="bg-white rounded-lg border border-amber-200 px-3 py-2.5">
            <p className="text-xs text-slate-500">{formatDateTimeJa(c.createdAt)} に申し込み</p>
            <p className="text-sm text-slate-800 whitespace-pre-wrap mt-0.5">{c.note || "（メモなし）"}</p>
            <button
              onClick={async () => {
                setBusy(c.id);
                try {
                  await onClose(c.id);
                } finally {
                  setBusy(null);
                }
              }}
              disabled={busy === c.id}
              className="mt-2 px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold disabled:bg-slate-300"
            >
              対応済みにする
            </button>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-amber-700/80 mt-2">日程はチャットや「日程調整」で相談してください。</p>
    </div>
  );
}

function GatePanel({
  orgId,
  player,
  protocol,
  phaseInfo,
  viewerRole, // 'self' | 'staff'
  onAdvance,
  onComplete,
  ackText, // 進む前に本人に確かめてもらう一文（あれば、チェックするまで進めない）
}) {
  const [ack, setAck] = useState(false);
  useEffect(() => setAck(false), [player.currentPhase]);
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyIdx, setBusyIdx] = useState(null);
  // 項目ごとに、次のチェックへ添付する写真・動画を持つ
  const [pendingMedia, setPendingMedia] = useState({});
  const [checkerName, setCheckerName] = useState("");
  const [error, setError] = useState(null);

  const items = phaseInfo?.conditions ?? [];
  const phase = player.currentPhase;

  const load = async () => {
    setLoading(true);
    try {
      const rows = await sbSelect(
        "gate_item_checks",
        `?player_id=eq.${encodeURIComponent(player.id)}&phase_number=eq.${phase}` +
          `&select=*&order=created_at.desc`
      );
      setChecks(rows || []);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [player.id, phase]);

  const latestFor = (idx, role) =>
    checks.find((c) => c.item_index === idx && c.checker_role === role) || null;

  // 翌日の日報：このフェーズで最初にチェックした日より後の日報を探す
  const firstCheckDate = checks.length
    ? checks.map((c) => c.created_at).sort()[0].slice(0, 10)
    : null;
  const nextDayReport = firstCheckDate
    ? player.reports.slice().reverse().find((r) => r.date > firstCheckDate) || null
    : null;
  const nextDayStop = nextDayReport
    ? matchedCriteria({
        vas: nextDayReport.vas,
        prevVas: null,
        compensation: nextDayReport.compensation || nextDayReport.selfCompensation,
        severeSymptom: nextDayReport.severeSymptom || nextDayReport.selfSevereSymptom,
      }).filter((c) => STOP_CRITERIA.some((sc) => sc.id === c.id))
    : [];

  const itemState = (idx, text) => {
    if (isNextDayItem(text)) {
      if (!nextDayReport) return { ok: false, note: "翌日の日報を待っています", auto: true };
      if (nextDayStop.length > 0)
        return {
          ok: false,
          note: `翌日の日報が中止の基準に当てはまりました（${nextDayStop[0].fact}）`,
          auto: true,
        };
      return { ok: true, note: `翌日の日報（${nextDayReport.date}）を確認`, auto: true };
    }
    const self = latestFor(idx, "self");
    const staff = latestFor(idx, "staff");
    const ok = self?.result === true || staff?.result === true;
    const notes = [];
    if (self) notes.push(`本人：${self.result ? "できた" : "できていない"}`);
    if (staff)
      notes.push(`指導者：${staff.result ? "できた" : "できていない"}${staff.checker_name ? `（${staff.checker_name}）` : ""}`);
    return { ok, note: notes.join(" / "), auto: false, self, staff };
  };

  const states = items.map((t, i) => itemState(i, t));
  const satisfied = states.filter((st) => st.ok).length;
  const allOk = items.length > 0 && states.every((st) => st.ok);
  const missing = states
    .map((st, i) => (st.ok ? null : st.auto ? st.note : items[i]))
    .filter(Boolean);

  const record = async (idx, result) => {
    setBusyIdx(idx);
    setError(null);
    const media = pendingMedia[idx] || null;
    try {
      const [row] = await sbInsert("gate_item_checks", {
        player_id: player.id,
        phase_number: phase,
        item_index: idx,
        checker_role: viewerRole,
        checker_name: checkerName.trim() || null,
        result,
        video_url: media?.url || null,
        attachment_id: media?.id || null,
      });
      setChecks((prev) => [row, ...prev]);
      setPendingMedia((prev) => {
        const next = { ...prev };
        delete next[idx];
        return next;
      });
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusyIdx(null);
    }
  };

  const isLastPhase = phase >= phaseCountOf(protocol);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h4 className="text-sm font-bold text-slate-700 mb-1">
        PHASE {phase} の GATE（{satisfied}/{items.length}）
      </h4>

      {loading && <p className="text-xs text-slate-400">読み込み中...</p>}
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      <div className="space-y-2">
        {items.map((text, idx) => {
          const st = states[idx];
          return (
            <div
              key={idx}
              className={`rounded-lg border px-3 py-2.5 ${
                st.ok ? "border-green-200 bg-green-50" : "border-slate-200"
              }`}
            >
              <div className="flex items-start gap-2">
                {st.ok ? (
                  <CheckCircle2 size={18} className="text-green-600 shrink-0 mt-0.5" />
                ) : (
                  <Circle size={18} className="text-slate-300 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  {/* 原案の文言をそのまま表示する */}
                  <p className="text-sm text-slate-800">{text}</p>
                  {st.note && <p className="text-[11px] text-slate-500 mt-0.5">{st.note}</p>}
                  {(st.self?.video_url || st.staff?.video_url) && (
                    <AttachmentPreview
                      url={st.self?.video_url || st.staff?.video_url}
                      kind={
                        (st.self?.video_url || st.staff?.video_url || "").match(
                          /\.(mp4|mov|webm)$/i
                        )
                          ? "video"
                          : "image"
                      }
                    />
                  )}
                </div>
              </div>

              {!st.auto && (
                <div className="mt-2 ml-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => record(idx, true)}
                      disabled={busyIdx === idx}
                      className="text-sm min-h-[36px] px-4 py-1.5 rounded-full border border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-40"
                    >
                      できた
                    </button>
                    <button
                      onClick={() => record(idx, false)}
                      disabled={busyIdx === idx}
                      className="text-sm min-h-[36px] px-4 py-1.5 rounded-full border border-slate-300 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                    >
                      できていない
                    </button>
                    <MediaUploadButton
                      playerId={player.id}
                      orgId={orgId}
                      context="gate_check"
                      contextId={`${phase}-${idx}`}
                      label="写真・動画を追加（任意）"
                      onUploaded={(m) => setPendingMedia((prev) => ({ ...prev, [idx]: m }))}
                    />
                  </div>
                  {pendingMedia[idx] && (
                    <div className="mt-1.5">
                      <p className="text-[10px] text-green-600">
                        添付を用意しました（{formatBytes(pendingMedia[idx].size)}）。
                        「できた」「できていない」を押すと一緒に記録されます。
                      </p>
                      <AttachmentPreview url={pendingMedia[idx].url} kind={pendingMedia[idx].kind} />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {items.length === 0 && (
          <p className="text-sm text-slate-400">この PHASE に条件はありません。</p>
        )}
      </div>

      {/* 確認した人の名前は、スタッフが記録するときだけ（選手本人は、ログインしている本人なので不要） */}
      {viewerRole === "staff" && (
        <input
          value={checkerName}
          onChange={(e) => setCheckerName(e.target.value)}
          placeholder="確認した人（任意）"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mt-3"
        />
      )}

      {viewerRole === "staff" && !allOk && missing.length > 0 && (
        <div className="mt-3 bg-slate-50 rounded-lg px-3 py-2">
          <p className="text-xs font-bold text-slate-600 mb-1">足りないもの</p>
          <ul className="text-xs text-slate-500 list-disc list-inside space-y-0.5">
            {missing.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {/* PHASEを進めるのは選手本人だけ。スタッフは項目のチェックと観察の記録を行う。 */}
      {viewerRole === "self" && !isLastPhase && ackText && (
        <label className="mt-4 flex items-start gap-3 border-2 border-emerald-300 bg-emerald-50 rounded-lg p-3 text-sm text-emerald-900">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            className="mt-0.5 w-5 h-5 shrink-0 accent-emerald-600"
          />
          <span className="leading-snug">{ackText}</span>
        </label>
      )}
      {viewerRole === "self" && !isLastPhase && (
        <button
          onClick={() => onAdvance("self", checkerName.trim())}
          disabled={!allOk || (Boolean(ackText) && !ack)}
          className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          確認して次のPHASEへ進む <ArrowRight size={16} />
        </button>
      )}
      {viewerRole === "self" && isLastPhase && !player.completedAt && onComplete && (
        <button
          onClick={() => onComplete()}
          disabled={!allOk}
          className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-green-600 text-white font-bold text-sm hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          <ShieldCheck size={16} /> 確認して復帰を記録する
        </button>
      )}
      {viewerRole === "staff" && !player.completedAt && (
        <p className="mt-4 text-[11px] text-slate-400 text-center">
          {allOk
            ? "条件はそろっています。次のPHASEへ進むのは選手本人の操作です。"
            : "PHASEを進めるのは選手本人の操作です。"}
        </p>
      )}
      {player.completedAt && (
        <div className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-green-50 text-green-700 font-bold text-sm">
          <Trophy size={16} /> 復帰 記録済み（{new Date(player.completedAt).toLocaleDateString("ja-JP")}）
        </div>
      )}
    </div>
  );
}

function ObservationRecord({ report, onAssess }) {
  const [compensation, setCompensation] = useState(Boolean(report.compensation));
  const [severeSymptom, setSevereSymptom] = useState(Boolean(report.severeSymptom));
  const [observer, setObserver] = useState(report.observedBy || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onAssess(report.id, compensation, severeSymptom, observer.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <p className="text-xs font-bold text-slate-600 mb-1 flex items-center gap-1.5">
        <Stethoscope size={14} className="text-blue-600" /> 基準チェック（観察の記録）
      </p>
      <p className="text-[10px] text-slate-400 mb-2">
        選手本人の申告とは別に保存されます。
      </p>
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={compensation} onChange={(e) => setCompensation(e.target.checked)} />
          代償動作あり
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={severeSymptom} onChange={(e) => setSevereSymptom(e.target.checked)} />
          歩行が困難な鋭い痛みあり
        </label>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={observer}
          onChange={(e) => setObserver(e.target.value)}
          placeholder="観察した人（任意）"
          className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 disabled:bg-slate-300 shrink-0"
        >
          {saving ? "記録中..." : "観察を記録"}
        </button>
        {saved && <span className="text-xs text-green-600 shrink-0">記録しました</span>}
      </div>

      <div className="mt-3">
        <p className="text-[10px] text-slate-400 mb-1">この日の入力に当てはまる基準</p>
        <CriteriaResult
          staffView
          report={{
            vas: report.vas,
            prevVas: report.prevVas ?? null,
            compensation: compensation || report.selfCompensation,
            severeSymptom: severeSymptom || report.selfSevereSymptom,
          }}
        />
      </div>
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
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await onDeleteTreatment(id);
    } catch (err) {
      setError(errText(err));
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
            <span className="font-bold">いまの PHASE：</span>
            PHASE {player.currentPhase}/{phaseCountOf(protocol)}（{phaseInfo?.title}）
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
      onLogout={() => {
        disablePush(sbRpc, "player").catch(() => {}); // この選手あての通知を、この端末では止める
        writeSession(PLAYER_SESSION_KEY, null); // 端末の記憶も消す
        setMyPlayer(null);
      }}
    />
  );
}

function PlayerLogin({ orgId, masterProtocols, playerDirectory, setPlayerDirectory, setMyPlayer }) {
  const [screen, setScreen] = useState("select");
  const [selectedDir, setSelectedDir] = useState(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);
  // 自分の端末なら、次回から名前と暗証番号の入力を省く
  const [remember, setRemember] = useState(true);

  // この端末に保存された選手ログインがあれば、それで復帰する
  const savedLogin = readSession(PLAYER_SESSION_KEY);
  const hasSavedLogin = Boolean(savedLogin && savedLogin.orgId === orgId && savedLogin.id);
  const [restoring, setRestoring] = useState(hasSavedLogin);
  // 通信できずに復帰できなかったとき（保存は消さずに、もう一度試せるようにする）
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [restoreTry, setRestoreTry] = useState(0);

  useEffect(() => {
    const saved = readSession(PLAYER_SESSION_KEY);
    if (!saved || saved.orgId !== orgId || !saved.id) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await sbSelect(
          "players",
          `?id=eq.${encodeURIComponent(saved.id)}&org_id=eq.${encodeURIComponent(orgId)}&select=${PLAYER_FIELDS}${PLAYER_EMBED_ORDER}`
        );
        if (cancelled) return;
        if (rows[0]) {
          writeSession(PLAYER_SESSION_KEY, saved); // 使うたびに保存期限を延ばす
          setMyPlayer(normalizePlayer(rows[0]));
          return; // この画面は閉じられる
        }
        writeSession(PLAYER_SESSION_KEY, null); // 選手が削除されている
      } catch {
        // 通信できないとき：ログインの保存は消さず、「もう一度試す」を出す
        if (!cancelled) setRestoreFailed(true);
        return;
      }
      if (!cancelled) setRestoring(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, restoreTry]);

  const handleForgetDevice = () => {
    writeSession(PLAYER_SESSION_KEY, null);
    setRestoreFailed(false);
    setRestoring(false);
  };

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
      writeSession(
        PLAYER_SESSION_KEY,
        remember ? { orgId, id: selectedDir.id, name: selectedDir.name } : null
      );
      setMyPlayer(normalizePlayer(fullRows[0]));
    } catch (err) {
      setError(errText(err));
    } finally {
      setChecking(false);
    }
  };

  if (restoring) {
    return (
      <div className="max-w-sm mx-auto mt-16 bg-white rounded-2xl shadow-lg p-8 border border-slate-200 text-center">
        {restoreFailed ? (
          <>
            <p className="text-sm text-slate-600">
              通信できませんでした。電波のよいところで、もう一度お試しください。
            </p>
            <button
              onClick={() => {
                setRestoreFailed(false);
                setRestoreTry((n) => n + 1);
              }}
              className="mt-4 w-full py-3 rounded-lg bg-blue-600 text-white font-bold text-sm"
            >
              もう一度試す
            </button>
          </>
        ) : (
          <>
            <Loader2 className="animate-spin text-blue-600 mx-auto" size={26} />
            <p className="mt-4 text-sm text-slate-600">
              <span className="font-bold text-slate-800">{savedLogin?.name}</span> さんとして開いています
            </p>
          </>
        )}
        <button
          onClick={handleForgetDevice}
          className="mt-4 px-3 py-2 text-xs text-slate-400 hover:text-slate-600 underline"
        >
          別の人でログインする
        </button>
      </div>
    );
  }

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
          onKeyDown={(e) => isEnterKey(e) && handlePinSubmit()}
          placeholder="••••"
          className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-center text-2xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
        {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}
        <label className="flex items-start gap-2 mt-4 cursor-pointer">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-blue-600"
          />
          <span className="text-xs text-slate-600 leading-relaxed">
            この端末を自分の端末として記憶する
            <span className="block text-slate-400">
              次回から名前と暗証番号の入力を省きます。共用の端末ではチェックを外してください。
            </span>
          </span>
        </label>
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
  // 分類の分岐（プロトコル選択に応じて出す）
  const [bamic, setBamic] = useState("");
  const [muscle, setMuscle] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const selectedProtocol = masterProtocols.find((p) => p.id === protocolId) ?? null;
  const needsHamstring = selectedProtocol?.classificationScheme === "hamstring";

  useEffect(() => {
    if (!protocolId && masterProtocols[0]) setProtocolId(masterProtocols[0].id);
  }, [masterProtocols, protocolId]);

  // プロトコルを変えたら分類をリセット（前の選択が残らないように）
  useEffect(() => {
    setBamic("");
    setMuscle("");
    setLocation("");
  }, [protocolId]);

  const handleRegister = async () => {
    if (!name.trim() || !protocolId) return;
    if (needsHamstring && (!bamic || !muscle || !location)) {
      setError("BAMIC分類・損傷筋・部位をすべて選択してください");
      return;
    }
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
      bamic_grade: needsHamstring ? bamic : null,
      hamstring_muscle: needsHamstring ? muscle : null,
      hamstring_location: needsHamstring ? location : null,
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
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-8">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-5">
          <Activity className="text-blue-600" size={22} />
          <h2 className="font-bold text-lg text-slate-800">はじめての登録</h2>
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

        {needsHamstring && (
          <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 mb-4">
            <p className="text-xs font-bold text-blue-700 mb-1">損傷の分類</p>
            <p className="text-[10px] text-blue-600 mb-2">
              わかる範囲で。あとで指導者が入力できます。
            </p>
            <label className="text-[10px] text-slate-600">BAMIC分類</label>
            <select
              value={bamic}
              onChange={(e) => setBamic(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mt-0.5 mb-2 bg-white"
            >
              <option value="">選択してください</option>
              {BAMIC_GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <label className="text-[10px] text-slate-600">損傷筋</label>
            <select
              value={muscle}
              onChange={(e) => setMuscle(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mt-0.5 mb-2 bg-white"
            >
              <option value="">選択してください</option>
              {HAMSTRING_MUSCLES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <label className="text-[10px] text-slate-600">部位</label>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mt-0.5 bg-white"
            >
              <option value="">選択してください</option>
              {HAMSTRING_LOCATIONS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500 mt-2">
              {BAMIC_NOTES.a}／{BAMIC_NOTES.b}／{BAMIC_NOTES.c}
            </p>
          </div>
        )}

        <label className="text-xs text-slate-500">受傷日</label>
        <input
          type="date"
          value={injuryDate}
          onChange={(e) => setInjuryDate(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mt-1 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <label className="text-xs text-slate-500">暗証番号（数字4桁）</label>
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

// ------------------------------------------------------------------
// 選手の「使い方」タブ（イラスト付き）
//   初めてログインした端末では、最初にこのタブを開く。
//   イラストは画面の一部を簡略化して描いたもの（画像ファイルは使わない）。
// ------------------------------------------------------------------
const PLAYER_TAB_DEFS = [
  { key: "home", label: "ホーム", icon: Home },
  { key: "menu", label: "メニュー", icon: Dumbbell },
  { key: "report", label: "日報", icon: Send },
  { key: "chat", label: "連絡・面談", icon: MessageCircle }, // チャットと、面談の申し込み
  { key: "guide", label: "使い方", icon: BookOpen },
  { key: "more", label: "その他", icon: MoreHorizontal },
];

// 画面下のタブを小さく描き、押す場所を示す
function GuideMiniNav({ active }) {
  return (
    <div className="grid grid-cols-6 bg-white rounded-lg border border-slate-200 mt-3" aria-hidden="true">
      {PLAYER_TAB_DEFS.map((t) => {
        const Icon = t.icon;
        const on = t.key === active;
        return (
          <div
            key={t.key}
            className={`relative flex flex-col items-center py-1.5 text-[9px] font-bold ${on ? "text-blue-600" : "text-slate-300"}`}
          >
            <Icon size={14} />
            {t.label}
            {on && <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-orange-400 animate-ping" />}
          </div>
        );
      })}
    </div>
  );
}

function GuideCard({ n, title, tab, onGo, goLabel, children, art }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="bg-gradient-to-br from-blue-50 to-slate-50 px-5 pt-4 pb-3">{art}</div>
      <div className="p-5 pt-4">
        <p className="text-base font-bold text-slate-800 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center shrink-0">
            {n}
          </span>
          {title}
        </p>
        <div className="text-sm text-slate-600 leading-relaxed mt-2 space-y-1">{children}</div>
        {tab && <GuideMiniNav active={tab} />}
        {onGo && (
          <button
            onClick={onGo}
            className="mt-3 w-full py-2.5 rounded-lg border border-blue-200 text-blue-700 text-sm font-bold hover:bg-blue-50 flex items-center justify-center gap-1"
          >
            {goLabel} <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function UsageGuideTab({ onGoTab, protocol, onReachEnd }) {
  // 一番下まで読んだら知らせる
  const endRef = React.useRef(null);
  useEffect(() => {
    const el = endRef.current;
    if (!el || !onReachEnd || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onReachEnd();
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // 「続ける種目」の説明は、その設定を持つプロトコルの選手にだけ出す
  const rule = protocol?.continueRule ?? null;
  const total = protocol ? phaseCountOf(protocol) : 0;
  let no = 0;
  return (
    <>
      <div className="bg-blue-600 text-white rounded-2xl p-5 shadow-sm">
        <p className="text-lg font-bold flex items-center gap-2">
          <BookOpen size={20} /> 使い方
        </p>
        <p className="text-sm text-blue-100 mt-1 leading-relaxed">
          毎日の日報と、段階ごとのチェックで、復帰までの道のりを指導者と共有します。
          画面の下のタブで切り替えます。
        </p>
      </div>

      <GuideCard
        n={++no}
        title="毎日、日報を送る"
        tab="report"
        onGo={() => onGoTab("report")}
        goLabel="日報を書く"
        art={
          <div className="space-y-2" aria-hidden="true">
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>痛みの強さ</span>
              <span className="font-bold text-blue-600">3</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 relative">
              <div className="absolute inset-y-0 left-0 w-[30%] rounded-full bg-blue-500" />
              <div className="absolute top-1/2 left-[30%] -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border-2 border-blue-500" />
            </div>
            <div className="flex justify-between pt-1 text-lg">
              {MENTAL_FACES.map((f, i) => (
                <span key={i} className={i === 2 ? "rounded-full bg-blue-100 ring-2 ring-blue-400" : "opacity-50"}>
                  {f}
                </span>
              ))}
            </div>
            <div className="rounded-lg bg-blue-600 text-white text-[11px] font-bold text-center py-1.5 flex items-center justify-center gap-1">
              <Send size={11} /> 指導者に送信する
            </div>
          </div>
        }
      >
        <p>痛み・疲労・睡眠・気分を、スライダーと顔のボタンで選んで送信します。1分ほどで終わります。</p>
        <p>書きかけでアプリを閉じても、その日のうちなら続きから書けます。</p>
      </GuideCard>

      <GuideCard
        n={++no}
        title="困ったときは SOS"
        tab="report"
        art={
          <div className="rounded-lg border-2 border-red-400 bg-red-50 text-red-600 text-xs font-bold text-center py-2 flex items-center justify-center gap-1.5" aria-hidden="true">
            <AlertTriangle size={14} /> 指導者に連絡します
          </div>
        }
      >
        <p>強い不安や痛みがあるときは、日報の「指導者に連絡する（SOS）」をオンにして送信します。</p>
      </GuideCard>

      <GuideCard
        n={++no}
        title="GATE で段階を進める"
        tab="home"
        onGo={() => onGoTab("home")}
        goLabel="ホームを見る"
        art={
          <div className="space-y-1.5" aria-hidden="true">
            {["条件 1", "条件 2"].map((c, i) => (
              <div key={c} className="flex items-center gap-2 bg-white rounded-lg border border-slate-200 px-2.5 py-1.5">
                {i === 0 ? <CheckCircle2 size={14} className="text-green-600" /> : <Circle size={14} className="text-slate-300" />}
                <span className="text-[11px] text-slate-600 flex-1">{c}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${i === 0 ? "border-green-300 text-green-700 bg-green-50" : "border-green-300 text-green-700"}`}>
                  できた
                </span>
              </div>
            ))}
            <div className="rounded-lg bg-slate-800 text-white text-[11px] font-bold text-center py-1.5">
              確認して次のPHASEへ進む →
            </div>
          </div>
        }
      >
        <p>ホームには、いまの PHASE の条件（GATE）が並びます。できた項目は「できた」を押して記録します。</p>
        <p>全部そろったら、自分で「次のPHASEへ進む」を押します。自動では進みません。</p>
      </GuideCard>

      <GuideCard
        n={++no}
        title="今日のメニューを見る"
        tab="menu"
        onGo={() => onGoTab("menu")}
        goLabel="メニューを見る"
        art={
          <div className="space-y-1.5" aria-hidden="true">
            {["Heel Dig ISO", "Double-leg Hip Lift"].map((m) => (
              <div key={m} className="bg-white rounded-lg border border-slate-200 px-2.5 py-1.5">
                <p className="text-[11px] font-bold text-slate-700">{m}</p>
                <p className="text-[10px] text-slate-400">ステップ 1/3 ・ 10回×2set</p>
              </div>
            ))}
          </div>
        }
      >
        <p>いまの PHASE までに始まった種目が、全部表示されます（前の PHASE の種目も続けます）。</p>
        <p>体重や基準タイムを入れると、「+10%BW」「@82%」などが実際の重さ・タイムに換算されます。</p>
      </GuideCard>

      {rule && (
        <GuideCard
          n={++no}
          title={rule.title}
          tab="menu"
          art={
            <div aria-hidden="true">
              <div className="flex h-3 gap-px">
                {Array.from({ length: total }, (_, i) => (
                  <span key={i} className={`flex-1 bg-slate-300 ${i === 0 ? "rounded-l-full" : ""} ${i === total - 1 ? "rounded-r-full" : ""}`} />
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-0.5 mb-1.5">PHASE 1 → {total}</p>
              <div className="flex h-3 gap-px">
                {Array.from({ length: total }, (_, i) => (
                  <span
                    key={i}
                    className={`flex-1 ${i + 1 < rule.fromPhase ? "bg-transparent" : "bg-emerald-500"} ${
                      i + 1 === rule.fromPhase ? "rounded-l-full" : ""
                    } ${i === total - 1 ? "rounded-r-full" : ""}`}
                  />
                ))}
              </div>
              <p className="text-[10px] font-bold text-emerald-700 mt-0.5">
                {rule.label}（PHASE {rule.fromPhase} から最後まで）
              </p>
            </div>
          }
        >
          <p>{rule.text}</p>
          <p>PHASE {rule.fromPhase} 以降、メニューの一番上に緑の枠でいつも表示されます。種目ごとの「ステップ」が、負荷を上げていく段階です。</p>
        </GuideCard>
      )}

      <GuideCard
        n={++no}
        title="指導者と連絡をとる"
        tab="chat"
        onGo={() => onGoTab("chat")}
        goLabel="連絡・面談を開く"
        art={
          <div className="space-y-1.5" aria-hidden="true">
            <div className="flex justify-end">
              <span className="bg-blue-600 text-white text-[11px] rounded-2xl px-3 py-1.5">フォームを見てください</span>
            </div>
            <div className="flex">
              <span className="bg-white border border-slate-200 text-slate-700 text-[11px] rounded-2xl px-3 py-1.5">
                <span className="block text-[9px] text-slate-400 font-bold">トレーナー</span>
                確認しました！
              </span>
            </div>
          </div>
        }
      >
        <p>「連絡・面談」タブのチャットで、メッセージや写真・動画を送れます。指導者から返信があると、タブに赤い数字が付きます。</p>
      </GuideCard>

      <GuideCard
        n={++no}
        title="面談の申し込み・予約"
        tab="chat"
        onGo={() => onGoTab("chat")}
        goLabel="連絡・面談を開く"
        art={
          <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 flex items-center justify-between" aria-hidden="true">
            <span className="text-[11px] text-slate-600 flex items-center gap-1">
              <CalendarClock size={12} className="text-blue-600" /> 10/3（金）18:00
            </span>
            <span className="text-[10px] font-bold text-blue-600">この枠で予約</span>
          </div>
        }
      >
        <p>話を聞いてほしいときは「連絡・面談」タブの「面談を申し込む」から。指導者に通知が届きます。</p>
        <p>公開されている面談の枠があれば、ホームの「面談予約」から選べます。受傷から2週間たっても面談がまだのときは、ホームに案内が出ます。</p>
      </GuideCard>

      <GuideCard
        n={++no}
        title="通知をオンにする"
        tab="more"
        art={
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-3 py-2 flex items-center gap-2" aria-hidden="true">
            <img src="/icon-192.png" alt="" className="w-7 h-7 rounded-md" />
            <div>
              <p className="text-[11px] font-bold text-slate-700">RE:SPRINT</p>
              <p className="text-[11px] text-slate-500">指導者から新しいメッセージがあります</p>
            </div>
          </div>
        }
      >
        <p>指導者から返信が来たとき・面談が決まったときに、スマホに通知が届きます。最初に出る画面で「通知を受け取る」を押してください。</p>
        <p>通知には内容は表示されません。あとから「その他」タブで切り替えられます。</p>
      </GuideCard>

      <GuideCard
        n={++no}
        title="受傷日を登録する"
        tab="more"
        art={
          <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 text-[11px] text-slate-600 flex items-center gap-1.5" aria-hidden="true">
            <CalendarDays size={12} className="text-blue-600" /> 受傷日 2026-09-10 ・ 受傷から19日
          </div>
        }
      >
        <p>「その他」で受傷日を登録すると、同じ怪我を完遂した先輩たちの平均期間が目安として表示されます。</p>
      </GuideCard>

      {/* ここまで読んだことを知るための目印。スマホのブラウザでは、ここで「ホーム画面に追加」の画面に切り替わる */}
      <div ref={endRef} className="h-px" aria-hidden="true" />
    </>
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
      showMessage("保存できませんでした", { body: errText(err) });
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
          {avg.sample_size < 3 && "（件数が少ないため参考値）"}
          過去に同じ怪我を完遂した{avg.sample_size}人の平均は、受傷から約
          {Math.round((avg.avg_days / 7) * 10) / 10}週間（{avg.avg_days}日）でした。目安にしてください。
        </p>
      ) : (
        <p className="text-xs text-slate-400 mt-2">
          完遂した選手の平均は、まだありません。
        </p>
      )}
    </div>
  );
}

// ---------- 要件②：Phase別タイムライン比較（v19 から自分の組織の中だけの集計） ----------
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
  // 自分か先輩の記録がある PHASE だけ並べる（空の棒を並べない）
  const shownPhases = phaseRange(protocol).filter(
    (n) => ownDurations[n] !== undefined || globalAvg.some((g) => g.phase_number === n && g.sample_size > 0)
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
        <Layers size={16} className="text-blue-600" /> 先輩との PHASE 別の日数
      </p>
      {loading ? (
        <p className="text-xs text-slate-400">読み込み中...</p>
      ) : (
        <>

          {shownPhases.length === 0 && <p className="text-sm text-slate-400">まだ記録がありません。</p>}
          <div className="space-y-3">
            {shownPhases.map((n) => {
              const own = ownDurations[n];
              const g = globalAvg.find((x) => x.phase_number === n);
              return (
                <div key={n}>
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className={`font-bold ${PHASE_TEXT_COLORS[n]}`}>PHASE {n}</span>
                    <span className="text-slate-400">
                      {own !== undefined ? `あなた: ${own}日` : ""}
                      {g && g.sample_size > 0
                        ? ` ／ 平均: ${g.avg_days}日（${g.sample_size}件${
                            g.sample_size < 3 ? "・件数が少ないため参考値" : ""
                          }）`
                        : ""}
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
          <div className={`flex gap-4 mt-3 text-[10px] text-slate-400 ${shownPhases.length === 0 ? "hidden" : ""}`}>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> あなた（上段）
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" /> 先輩の平均（下段）
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function PlayerPersonalDashboard({ orgId, player, protocol, setMyPlayer, slots, setSlots, phaseMenus, onLogout }) {
  // 画面下のタブ：'home' | 'menu' | 'report' | 'chat' | 'guide' | 'more'
  // 更新などで読み込み直しても同じタブに戻れるよう、このタブの間だけ覚えておく
  // この端末で初めてこの選手としてログインしたときは「使い方」を開く
  const TAB_KEY = "resprint.playerTab";
  const guideSeenKey = `resprint.guideSeen.${player.id}`;
  // 初めてこの選手として開いたか（この画面を開いている間は変わらない）
  const [firstVisit] = useState(() => readDraft(guideSeenKey) === null);
  // 使い方を一番下まで読んだか／「今回だけブラウザで使う」を選んだか
  const [guideRead, setGuideRead] = useState(false);
  const [installSkip, setInstallSkip] = useState(() => installSkipped());
  useEffect(() => {
    if (firstVisit) writeDraft(guideSeenKey, 1);
  }, []);
  const [tab, setTab] = useState(() => {
    if (firstVisit) return "guide";
    try {
      const t = window.sessionStorage.getItem(TAB_KEY);
      return PLAYER_TAB_DEFS.some((d) => d.key === t) ? t : "home";
    } catch {
      return "home";
    }
  });
  const changeTab = (t) => {
    setTab(t);
    try {
      window.sessionStorage.setItem(TAB_KEY, t);
    } catch {
      // 覚えられなくても動く
    }
    window.scrollTo(0, 0);
  };

  // チャット：スタッフからの未読（この端末で最後に見たメッセージより新しいもの）
  const seenKey = `resprint.chatSeen.${player.id}`;
  const lastStaffId = Math.max(0, ...player.messages.filter((m) => m.sender === "staff").map((m) => Number(m.id) || 0));
  const [seenId, setSeenId] = useState(() => {
    const saved = readDraft(seenKey);
    if (saved !== null) return Number(saved) || 0;
    // この端末で初めて開いたとき（v15.6 に更新した直後など）は、それまでのメッセージを既読として扱う
    writeDraft(seenKey, lastStaffId);
    return lastStaffId;
  });
  const unreadStaff = tab === "chat" ? 0 : player.messages.filter((m) => m.sender === "staff" && Number(m.id) > seenId).length;
  // 日報へのコメント：指導者からの未読（この端末で最後に見たコメントより新しいもの）
  const commentSeenKey = `resprint.reportSeen.${player.id}`;
  const staffComments = (player.reportComments || []).filter((c) => c.sender !== "player");
  const lastCommentId = Math.max(0, ...staffComments.map((c) => Number(c.id) || 0));
  const [seenCommentId, setSeenCommentId] = useState(() => Number(readDraft(commentSeenKey)) || 0);
  const unreadComments = tab === "report" ? 0 : staffComments.filter((c) => Number(c.id) > seenCommentId).length;
  useEffect(() => {
    if (tab === "report" && lastCommentId > seenCommentId) {
      setSeenCommentId(lastCommentId);
      writeDraft(commentSeenKey, lastCommentId);
    }
  }, [tab, lastCommentId]);
  useEffect(() => {
    setIconBadge(unreadStaff + unreadComments);
    return () => setIconBadge(0);
  }, [unreadStaff, unreadComments]);
  // 通知をオンにしてある端末は、開くたびに登録を最新にする
  useEffect(() => {
    refreshPush(sbRpc, { orgId, role: "player", playerId: player.id });
  }, [orgId, player.id]);
  useEffect(() => {
    if (tab === "chat" && lastStaffId > seenId) {
      setSeenId(lastStaffId);
      writeDraft(seenKey, lastStaffId);
    }
  }, [tab, lastStaffId]);

  // 日報の書きかけ（その日のうちなら、読み込み直しても残す）
  const reportDraftKey = `resprint.draft.report.${player.id}`;
  const [draft0] = useState(() => {
    const d = readDraft(reportDraftKey);
    return d && d.date === todayStr() ? d : {};
  });
  const [vas, setVas] = useState(draft0.vas ?? 3);
  const [fatigue, setFatigue] = useState(draft0.fatigue ?? 3);
  const [sleepQuality, setSleepQuality] = useState(draft0.sleepQuality ?? 7);
  const [mental, setMental] = useState(draft0.mental ?? 3);
  const [honne, setHonne] = useState(draft0.honne ?? "");
  const [sos, setSos] = useState(draft0.sos ?? false);
  // 本人の申告（スタッフがいない選手でも基準を出せるように）
  const [selfCompensation, setSelfCompensation] = useState(draft0.selfCompensation ?? false);
  const [selfSevereSymptom, setSelfSevereSymptom] = useState(draft0.selfSevereSymptom ?? false);
  // PHASEで出し分ける項目
  const [fearLevel, setFearLevel] = useState(draft0.fearLevel ?? 0);
  const [slippingContact, setSlippingContact] = useState(draft0.slippingContact ?? false);
  const [rpe, setRpe] = useState(draft0.rpe ?? 70);
  const draftTouched = React.useRef(false);
  useEffect(() => {
    if (!draftTouched.current) {
      draftTouched.current = true; // 最初の表示では保存しない
      return;
    }
    writeDraft(reportDraftKey, {
      date: todayStr(),
      vas,
      fatigue,
      sleepQuality,
      mental,
      honne,
      sos,
      selfCompensation,
      selfSevereSymptom,
      fearLevel,
      slippingContact,
      rpe,
    });
  }, [vas, fatigue, sleepQuality, mental, honne, sos, selfCompensation, selfSevereSymptom, fearLevel, slippingContact, rpe]);
  // 送信結果（基準の提示に使う）
  const [submitted, setSubmitted] = useState(null);
  // 日報に添える写真・動画（任意）
  const [reportMedia, setReportMedia] = useState(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  // 面談を予約した直後のお知らせ（日時）
  const [bookedNotice, setBookedNotice] = useState(null);

  const phaseInfo = protocol?.phases[player.currentPhase - 1];
  const continueRule = activeContinueRule(protocol, player.currentPhase);
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
    const prevVas = player.reports.length ? player.reports[player.reports.length - 1].vas : null;
    const newReport = {
      date: todayStr(),
      vas,
      mental,
      honne: honne.trim(),
      fatigue,
      sleepQuality,
      selfCompensation,
      selfSevereSymptom,
    };
    try {
      await sbInsert("reports", {
        player_id: player.id,
        date: newReport.date,
        vas: newReport.vas,
        mental: newReport.mental,
        honne: newReport.honne,
        fatigue: newReport.fatigue,
        sleep_quality: newReport.sleepQuality,
        self_compensation: selfCompensation,
        self_severe_symptom: selfSevereSymptom,
        fear_level: player.currentPhase >= 5 ? fearLevel : null,
        slipping_contact: player.currentPhase >= 6 ? slippingContact : null,
        rpe: player.currentPhase >= 7 ? rpe : null,
        attachment_id: reportMedia?.id ?? null,
      });
      await sbUpdate("players", player.id, { sos });
      setMyPlayer((prev) => ({ ...prev, sos, reports: [...prev.reports, newReport] }));
      // 判定はしない。当てはまる基準を並べて示すためのデータだけ保持する。
      setSubmitted({
        vas,
        prevVas,
        compensation: selfCompensation,
        severeSymptom: selfSevereSymptom,
      });
      setSent(true);
      writeDraft(reportDraftKey, null); // 送信できたので下書きを消す
      setHonne("");
      setSos(false);
      setSelfCompensation(false);
      setSelfSevereSymptom(false);
      setReportMedia(null);
    } catch (err) {
      setError(errText(err));
    } finally {
      setSending(false);
    }
  };

  const handleBookSlot = async (slotId) => {
    setError(null);
    try {
      // 組織に「いつもの URL」が登録してあり、この枠にまだ URL がなければ、予約と同時に付ける
      const current = slots.find((s) => s.id === slotId);
      let autoUrl = null;
      if (current && !current.zoomUrl) {
        try {
          autoUrl = (await fetchMeetingUrl(orgId)) || null;
        } catch {
          autoUrl = null; // 読めなくても、予約はそのまま進める
        }
      }
      await sbUpdate("slots", slotId, autoUrl ? { booked_by: player.id, zoom_url: autoUrl } : { booked_by: player.id });
      await sbUpdate("players", player.id, { booked_slot_id: slotId });
      setSlots((prev) =>
        prev.map((s) => (s.id === slotId ? { ...s, bookedBy: player.id, zoomUrl: autoUrl || s.zoomUrl } : s))
      );
      setMyPlayer((prev) => ({ ...prev, bookedSlotId: slotId }));
      // 面談が決まったことを、チャットにも残す（指導者には未読として届き、双方があとから見返せる）
      const slot = slots.find((s) => s.id === slotId);
      if (slot) {
        try {
          await sendPlayerMessage(`【面談の予約】${slot.datetime} の面談を予約しました。`);
        } catch {
          // チャットに残せなくても、予約そのものは完了している
        }
      }
      setBookedNotice(slot ? slot.datetime : null);
    } catch (err) {
      setError(errText(err));
    }
  };

  // 本人が確認してフェーズを進める（自動では進めない）
  const advanceOwnPhase = async (role, nm) => {
    const nextPhase = Math.min(phaseCountOf(protocol), player.currentPhase + 1);
    const nextCount = protocol?.phases[nextPhase - 1]?.conditions.length ?? 0;
    const now = new Date().toISOString();
    try {
      await sbUpdate("players", player.id, {
        current_phase: nextPhase,
        checklist: Array(nextCount).fill(false),
      });
      await sb(
        `phase_history?player_id=eq.${encodeURIComponent(player.id)}&phase_number=eq.${player.currentPhase}&left_at=is.null`,
        { method: "PATCH", body: JSON.stringify({ left_at: now }), prefer: "return=minimal" }
      );
      await sbInsert("phase_history", {
        player_id: player.id,
        protocol_id: player.protocolId,
        phase_number: nextPhase,
        entered_at: now,
      });
      await sbInsert("phase_advances", {
        player_id: player.id,
        from_phase: player.currentPhase,
        to_phase: nextPhase,
        confirmed_by_role: role,
        confirmed_by_name: nm || null,
        confirmed_at: now,
      });
      setMyPlayer((prev) => ({ ...prev, currentPhase: nextPhase, checklist: Array(nextCount).fill(false) }));
    } catch (err) {
      setError(errText(err));
    }
  };

  const completeOwn = async () => {
    const now = new Date().toISOString();
    try {
      await sbUpdate("players", player.id, { completed_at: now });
      setMyPlayer((prev) => ({ ...prev, completedAt: now }));
    } catch (err) {
      setError(errText(err));
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

  const TABS = PLAYER_TAB_DEFS.map((t) => (t.key === "chat" ? { ...t, badge: unreadStaff } : t.key === "report" ? { ...t, badge: unreadComments } : t));

  return (
    <div className="max-w-md mx-auto px-4 pt-5 pb-28 space-y-5">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="font-bold text-xl text-slate-800 truncate">{player.name}</h2>
        </div>
        <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full bg-white border border-slate-200 ${PHASE_TEXT_COLORS[player.currentPhase]}`}>
          PHASE {player.currentPhase}/{phaseCountOf(protocol)}
        </span>
      </div>

      {tab === "home" && (
        <>
          <TodayCard player={player} onReport={() => changeTab("report")} onMenu={() => changeTab("menu")} />

          {bookedNotice && (
            <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex items-start gap-2">
              <CheckCircle2 size={18} className="text-green-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-bold text-green-800">面談が決まりました：{bookedNotice}</p>
                <p className="text-xs text-green-700 mt-0.5">指導者にも通知しました（チャットにも記録が残ります）。</p>
              </div>
              <button onClick={() => setBookedNotice(null)} className="text-green-600 p-2 -m-2" aria-label="閉じる">
                <X size={16} />
              </button>
            </div>
          )}

          <MeetingReminder
            player={player}
            slots={slots}
            viewer="self"
            hasOpenSlots={availableSlots.length > 0}
            onGoBooking={() => document.getElementById("meeting-booking")?.scrollIntoView({ behavior: "smooth", block: "center" })}
            onGoRequest={() => changeTab("chat")}
          />

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-700 mb-2">復帰ロードマップ</p>
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

            <ContinuingLane protocol={protocol} currentPhase={player.currentPhase} />

            <p className="mt-4 text-sm font-bold text-slate-700">
              <span className={PHASE_TEXT_COLORS[player.currentPhase]}>PHASE {player.currentPhase}</span>　{phaseInfo?.title}
            </p>
          </div>

          {continueRule && (
            <button
              onClick={() => changeTab("menu")}
              className="w-full text-left border-2 border-emerald-300 bg-emerald-50 rounded-2xl p-4"
            >
              <p className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
                <Repeat size={16} /> {continueRule.title}
              </p>
              <p className="text-xs text-emerald-800/90 leading-relaxed mt-1">{continueRule.text}</p>
              <p className="text-xs font-bold text-emerald-700 mt-2 flex items-center gap-1">
                メニューで種目と負荷のステップを見る <ArrowRight size={13} />
              </p>
            </button>
          )}

          <GatePanel
            orgId={orgId}
            player={player}
            protocol={protocol}
            phaseInfo={phaseInfo}
            viewerRole="self"
            onAdvance={(role, nm) => advanceOwnPhase(role, nm)}
            onComplete={completeOwn}
            ackText={
              // このプロトコルに「続ける種目」の設定があり、次の PHASE がその対象になるとき：確かめてから進む
              protocol?.continueRule && player.currentPhase + 1 >= protocol.continueRule.fromPhase
                ? protocol.continueRule.ack
                : null
            }
          />

          <div id="meeting-booking" className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm scroll-mt-24">
            <p className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5">
              <CalendarClock size={16} className="text-blue-600" />
              面談予約
            </p>
            <p className="text-xs text-slate-400 mb-3">
              枠を選ぶと面談が決まります。
            </p>

            {bookedSlot ? (
              <div className="bg-blue-50 rounded-lg px-4 py-3 space-y-2">
                <p className="text-sm text-blue-700 font-bold">予約済み：{bookedSlot.datetime}</p>
                {bookedSlot.zoomUrl ? (
                  <a
                    href={safeHref(bookedSlot.zoomUrl)}
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

      {tab === "menu" && (
        <>
          <CumulativeMenuPanel player={player} protocol={protocol} readOnly />

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
                  href={safeHref(protocol.videoUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 py-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm text-blue-600 font-medium"
                >
                  <LinkIcon size={14} /> 動画リンクを開く
                </a>
              )}
            </div>
          )}

          <AthleteMetricsCard
            player={player}
            onSaved={(patch) => setMyPlayer((prev) => ({ ...prev, ...patch }))}
          />

          <OffsiteTrainingPanel orgId={orgId} player={player} readOnly />

          {phaseMenus.some((m) => m.protocolId === player.protocolId && m.phaseNumber === player.currentPhase) && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <p className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
                <Dumbbell size={16} className="text-blue-600" /> いまの PHASE のメニュー
              </p>
              <PhaseMenuCatalog menus={phaseMenus} protocolId={player.protocolId} phaseNumber={player.currentPhase} />
            </div>
          )}

          <FaqList faq={protocol?.faq} />
        </>
      )}

      {tab === "report" && (
        <>
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-700 mb-3">今日のコンディション報告</p>

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
            {/* 目盛りの説明（スマホでも読める大きさで、いまの値に近いものを強調する） */}
            <div className="mt-2 mb-4 space-y-1">
              {VAS_ANCHORS.map((a, i) => {
                const next = VAS_ANCHORS[i + 1]?.v ?? 11;
                const current = vas >= a.v && vas < next;
                return (
                  <p
                    key={a.v}
                    className={`flex gap-2 text-xs leading-snug rounded-md px-2 py-1 ${
                      current ? "bg-blue-50 text-blue-800 font-bold" : "text-slate-400"
                    }`}
                  >
                    <span className="w-5 shrink-0 text-right">{a.v}</span>
                    <span>{a.label}</span>
                  </p>
                );
              })}
            </div>

            <label className="text-xs text-slate-500 flex justify-between">
              <span>疲労度</span>
              <span className="font-bold text-blue-600">{fatigue}</span>
            </label>
            <input
              type="range"
              min={0}
              max={10}
              value={fatigue}
              onChange={(e) => setFatigue(Number(e.target.value))}
              className="w-full mt-2 accent-blue-600"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mb-4">
              <span>0（疲労なし）</span>
              <span>10（極度の疲労）</span>
            </div>

            <label className="text-xs text-slate-500 flex justify-between">
              <span>睡眠の質</span>
              <span className="font-bold text-blue-600">{sleepQuality}</span>
            </label>
            <input
              type="range"
              min={0}
              max={10}
              value={sleepQuality}
              onChange={(e) => setSleepQuality(Number(e.target.value))}
              className="w-full mt-2 accent-blue-600"
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

            <label className="text-xs text-slate-500">本音</label>
            <textarea
              value={honne}
              onChange={(e) => setHonne(e.target.value)}
              rows={3}
              placeholder="今日感じたことを正直に書いてください"
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mt-1 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <div className="border border-slate-200 rounded-lg p-3 mb-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-600">写真・動画（任意）</p>
                <MediaUploadButton
                  playerId={player.id}
                  orgId={orgId}
                  context="report"
                  contextId={todayStr()}
                  onUploaded={(m) => setReportMedia(m)}
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                写真 10MB・動画 50MB まで。90日間保存。
              </p>
              {reportMedia && (
                <div className="mt-1.5">
                  <AttachmentPreview url={reportMedia.url} kind={reportMedia.kind} />
                  <button
                    onClick={() => setReportMedia(null)}
                    className="text-xs text-slate-400 hover:text-red-500 underline mt-1 py-2"
                  >
                    取り消す
                  </button>
                </div>
              )}
            </div>

            <div className="border border-slate-200 rounded-lg p-3 mb-3 space-y-2">
              <p className="text-xs font-bold text-slate-600">今日の状態</p>
              <label className="flex items-start gap-3 text-sm text-slate-700 py-1.5">
                <input
                  type="checkbox"
                  checked={selfSevereSymptom}
                  onChange={(e) => setSelfSevereSymptom(e.target.checked)}
                  className="mt-0.5 w-5 h-5 shrink-0 accent-blue-600"
                />
                歩行が困難な鋭い痛みがある
              </label>
              <label className="flex items-start gap-3 text-sm text-slate-700 py-1.5">
                <input
                  type="checkbox"
                  checked={selfCompensation}
                  onChange={(e) => setSelfCompensation(e.target.checked)}
                  className="mt-0.5 w-5 h-5 shrink-0 accent-blue-600"
                />
                かばう動き（代償動作）が出ている
              </label>

              {player.currentPhase >= 5 && (
                <div className="pt-2 border-t border-slate-100">
                  <label className="text-xs text-slate-500 flex justify-between">
                    <span>恐怖心</span>
                    <span className="font-bold text-slate-600">{fearLevel}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    value={fearLevel}
                    onChange={(e) => setFearLevel(Number(e.target.value))}
                    className="w-full mt-1 accent-blue-600"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>0（なし）</span>
                    <span>10（強い）</span>
                  </div>
                </div>
              )}

              {player.currentPhase >= 6 && (
                <div className="pt-2 border-t border-slate-100">
                  <label className="flex items-start gap-3 text-sm text-slate-700 py-1.5">
                    <input
                      type="checkbox"
                      checked={slippingContact}
                      onChange={(e) => setSlippingContact(e.target.checked)}
                      className="mt-0.5 w-5 h-5 shrink-0 accent-blue-600"
                    />
                    抜ける接地が出た
                  </label>
                  <p className="text-[11px] text-slate-400 mt-1 ml-8">
                    抜ける接地＝地面を蹴る → 脚が流れる → 前接地になる接地。
                  </p>
                </div>
              )}

              {player.currentPhase >= 7 && (
                <div className="pt-2 border-t border-slate-100">
                  <label className="text-xs text-slate-500 flex justify-between">
                    <span>主観的努力度</span>
                    <span className="font-bold text-slate-600">{rpe}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={rpe}
                    onChange={(e) => setRpe(Number(e.target.value))}
                    className="w-full mt-1 accent-blue-600"
                  />
                </div>
              )}
            </div>

            <button
              onClick={() => setSos((v) => !v)}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold mb-3 border-2 transition-colors ${
                sos ? "border-red-500 bg-red-50 text-red-600" : "border-slate-200 text-slate-400"
              }`}
            >
              <AlertTriangle size={16} />
              {sos ? "指導者に連絡します（SOS）" : "指導者に連絡する（SOS）"}
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
            {sent && submitted && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <CriteriaResult report={submitted} />
              </div>
            )}
          </div>

          <ReportThread player={player} viewer="self" />

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
              <TrendingUp size={16} className="text-blue-600" /> これまでの記録
            </p>
            <SimpleTrendChart reports={player.reports} />
          </div>

        </>
      )}

      {tab === "chat" && (
        <>
          <ChatPanel
            playerId={player.id}
            orgId={orgId}
            messages={player.messages}
            myRole="player"
            title="指導者とのチャット"
            draftKey={`resprint.draft.chat.${player.id}`}
            tall
            onSend={sendPlayerMessage}
          />

          <ConsultationRequestCard orgId={orgId} player={player} setMyPlayer={setMyPlayer} />

          <MeetingNotes player={player} viewer="self" />
        </>
      )}

      {tab === "more" && (
        <>
          <RecoverySummary player={player} protocol={protocol} />

          <InjuryDateCard orgId={orgId} player={player} protocol={protocol} setMyPlayer={setMyPlayer} />

          <PhaseTimelineComparison player={player} protocol={protocol} />

          <HamstringClassificationCard orgId={orgId} player={player} protocol={protocol} readOnly />

          <TreatmentCard player={player} onAddTreatments={addPlayerTreatments} onDeleteTreatment={deletePlayerTreatment} />

          <NotifyToggle orgId={orgId} role="player" playerId={player.id} />

          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50"
          >
            <LogOut size={16} /> この端末から選手ログアウト
          </button>

          {/* 免責文は「その他」の一番下に、入力内容にかかわらず常に同じ文面で出す */}
          <StandingNotice />
          <p className="text-center text-[11px] text-slate-400">{APP_BUILD}</p>
        </>
      )}

      {/* 利用規約への同意（文面が登録されていて、まだ同意していないときだけ） */}
      <TermsGate playerId={player.id} />

      {tab === "guide" && (
        <UsageGuideTab onGoTab={changeTab} protocol={protocol} onReachEnd={() => setGuideRead(true)} />
      )}

      {/* スマホのブラウザで開いているとき：ホーム画面に追加するまで、この画面で止める
          （初めての選手は、使い方を最後まで読むまでは出さない） */}
      {needsInstall() && !installSkip && !(firstVisit && tab === "guide" && !guideRead) && (
        <InstallGate orgId={orgId} player={player} onSkip={() => setInstallSkip(true)} />
      )}

      {/* 通知の案内：ホーム画面への追加が済んでいる（または対象外の）端末で、使い方を読んだあとに出す */}
      {!(needsInstall() && !installSkip) && !(firstVisit && tab === "guide" && !guideRead) && (
        <NotifyPrompt orgId={orgId} role="player" playerId={player.id} />
      )}

      {/* 画面下のタブ（親指で届く位置） */}
      <nav
        className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 print:hidden safe-nav"
        aria-label="選手メニュー"
      >
        <BottomTabs tabs={TABS} active={tab} onChange={changeTab} />
      </nav>
    </div>
  );
}

// 「通知を受け取る」の切り替え（選手・指導者の「その他」タブ）
//   アプリを閉じていても、端末に通知が届くようにする。端末ごとに本人が許可する必要がある。
//   通知の文面は短い定型文だけ（選手名・メッセージの本文は出さない）。
const NOTIFY_EVENTS = {
  player: "指導者からメッセージ・日報へのコメントが届いたとき、面談が決まったとき・近づいたとき、夜8時に日報がまだのとき",
  coach: "選手からメッセージ・日報への返信・面談の申し込み・面談の予約・SOS があったとき、面談が近づいたとき",
};
function NotifyToggle({ orgId, role, playerId }) {
  const [state, setState] = useState("loading"); // loading | unsupported | denied | on | off
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    pushState(role).then((st) => active && setState(st));
    return () => {
      active = false;
    };
  }, [role]);

  const turnOn = async () => {
    setBusy(true);
    setError(null);
    try {
      await enablePush(sbRpc, { orgId, role, playerId });
      setState("on");
    } catch (err) {
      setError(errText(err));
      setState(await pushState(role));
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true);
    setError(null);
    await disablePush(sbRpc, role);
    setState(await pushState(role));
    setBusy(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5">
        <Bell size={16} className="text-blue-600" /> 通知
        {state === "on" && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">オン</span>
        )}
      </p>
      <p className="text-xs text-slate-400 mb-3 leading-relaxed">
        {NOTIFY_EVENTS[role]}に通知します。内容は表示されません。
      </p>
      {state === "loading" && <p className="text-xs text-slate-400">確認中...</p>}
      {state === "unsupported" && (
        <p className="text-xs text-slate-500 leading-relaxed bg-slate-50 rounded-lg px-3 py-2">
          {isIOSDevice() && !isStandaloneApp()
            ? "iPhone・iPad では、ホーム画面に追加したアプリから開くと通知を受け取れます（「使い方」タブに追加の手順があります）。"
            : "この端末・ブラウザでは通知を使えません。"}
        </p>
      )}
      {state === "denied" && (
        <p className="text-xs text-orange-600 leading-relaxed bg-orange-50 rounded-lg px-3 py-2">
          この端末の設定で、通知が許可されていません。端末の「設定」→「通知」から RE:SPRINT の通知を許可してから、もう一度お試しください。
        </p>
      )}
      {state === "off" && (
        <button
          onClick={turnOn}
          disabled={busy}
          className="w-full py-3 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:bg-slate-300 flex items-center justify-center gap-2"
        >
          {busy && <Loader2 size={14} className="animate-spin" />} 通知を受け取る
        </button>
      )}
      {state === "on" && (
        <button
          onClick={turnOff}
          disabled={busy}
          className="w-full py-3 rounded-lg border border-slate-300 text-slate-600 text-sm disabled:opacity-50"
        >
          通知をやめる
        </button>
      )}
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  );
}

// 通知の案内（全画面）。通知をまだオンにしていない端末で、最初に大きく出す（v15.12）
//   ・通知を使える端末だけ（iPhone はホーム画面のアプリ。端末の設定で拒否されているときは出さない）
//   ・「あとで」で閉じられる（そのタブを閉じるまで出ない）。次に開いたときは、オンにするまでまた出る
//   ・あとから「その他」タブでも切り替えられる（NotifyToggle）
const NOTIFY_SKIP_KEY = "resprint.notifySkip";
function NotifyPrompt({ orgId, role, playerId }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    let skipped = false;
    try {
      skipped = window.sessionStorage.getItem(`${NOTIFY_SKIP_KEY}.${role}`) === "1";
    } catch {
      skipped = false;
    }
    if (!skipped) pushState(role).then((st) => active && setShow(st === "off"));
    return () => {
      active = false;
    };
  }, [role]);

  const close = () => {
    try {
      window.sessionStorage.setItem(`${NOTIFY_SKIP_KEY}.${role}`, "1");
    } catch {
      // 覚えられなくても、この画面は閉じる
    }
    setShow(false);
  };
  const turnOn = async () => {
    setBusy(true);
    setError(null);
    try {
      await enablePush(sbRpc, { orgId, role, playerId });
      setDone(true);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!show) return null;
  return (
    <div className="fixed inset-0 z-40 bg-white overflow-y-auto print:hidden" role="dialog" aria-modal="true">
      <div className="max-w-md mx-auto px-6 pt-14 pb-10 safe-top safe-bottom text-center">
        <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-5">
          <Bell size={36} className="text-blue-600" />
        </div>
        {done ? (
          <>
            <h2 className="text-xl font-bold text-slate-800">通知をオンにしました</h2>
            <p className="text-sm text-slate-500 mt-2">この端末に通知が届くようになりました。</p>
            <button onClick={() => setShow(false)} className="mt-8 w-full py-3.5 rounded-xl bg-blue-600 text-white font-bold">
              はじめる
            </button>
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold text-slate-800">通知をオンにしてください</h2>
            <p className="text-sm text-slate-500 mt-2 leading-relaxed">
              {NOTIFY_EVENTS[role]}に、この端末へお知らせします。大事な連絡を見逃さないために、オンにしておいてください。
            </p>
            <div className="mt-5 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3 text-left" aria-hidden="true">
              <img src="/icon-192.png" alt="" className="w-9 h-9 rounded-lg" />
              <div>
                <p className="text-xs font-bold text-slate-700">RE:SPRINT</p>
                <p className="text-xs text-slate-500">
                  {role === "coach" ? "選手から新しいメッセージがあります" : "指導者から新しいメッセージがあります"}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              通知には、名前やメッセージの内容は表示されません。
            </p>
            <button
              onClick={turnOn}
              disabled={busy}
              className="mt-7 w-full py-3.5 rounded-xl bg-blue-600 text-white font-bold disabled:bg-slate-300 flex items-center justify-center gap-2"
            >
              {busy && <Loader2 size={16} className="animate-spin" />} 通知を受け取る
            </button>
            <p className="text-xs text-slate-400 mt-2">次に出る確認で「許可」を押してください。</p>
            {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
            <button onClick={close} className="mt-8 text-xs text-slate-400 underline py-2 px-3">
              あとで
            </button>
            <p className="text-[10px] text-slate-300 mt-1">「その他」タブから、いつでも切り替えられます。</p>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// 利用規約・個人情報の取り扱いへの同意（選手。v30）
//   文面は管理者が登録する。登録がなければ何も出ない。文面が変わると、もう一度出る。
// ------------------------------------------------------------------
function TermsGate({ playerId }) {
  const [terms, setTerms] = useState(null); // { version, body } | null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    let active = true;
    sbRpc("terms_status", { p_player_id: playerId })
      .then((r) => active && setTerms(r && typeof r.body === "string" && r.body && r.accepted === false ? r : null))
      .catch(() => {}); // 読めないときは出さない（アプリは使える）
    return () => {
      active = false;
    };
  }, [playerId]);
  if (!terms) return null;
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await sbRpc("terms_accept", { p_player_id: playerId, p_version: terms.version });
      setTerms(null);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[55] bg-white flex flex-col print:hidden" role="dialog" aria-modal="true">
      <div className="max-w-md w-full mx-auto flex-1 min-h-0 flex flex-col px-5 safe-top">
        <h2 className="text-lg font-bold text-slate-800 pt-6 pb-3">利用規約・個人情報の取り扱い</h2>
        <div className="flex-1 min-h-0 overflow-y-auto border border-slate-200 rounded-xl p-4 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
          {terms.body}
        </div>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        <div className="py-4 safe-bottom">
          <button
            onClick={accept}
            disabled={busy}
            className="w-full py-3.5 rounded-xl bg-blue-600 text-white font-bold disabled:bg-slate-300"
          >
            同意して使う
          </button>
        </div>
      </div>
    </div>
  );
}

// 管理者：規約の文面の登録
function TermsEditor() {
  const [body, setBody] = useState("");
  const [info, setInfo] = useState(null); // { version, accepted_count }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const load = () =>
    sbRpc("admin_get_terms")
      .then((r) => {
        setBody(r?.body || "");
        setInfo(r || null);
      })
      .catch((err) => setError(errText(err)))
      .finally(() => setLoading(false));
  useEffect(() => {
    load();
  }, []);
  const save = async () => {
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const r = await sbRpc("admin_set_terms", { p_body: body });
      setMsg(r?.changed ? "保存しました。選手には次に開いたときに表示されます。" : "変更はありません。");
      await load();
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h3 className="font-bold text-slate-700 text-sm mb-1">利用規約・個人情報の取り扱い</h3>
      <p className="text-xs text-slate-400 mb-3">
        {info?.body
          ? `第${info.version}版・同意済み ${info.accepted_count}名。文面を変えると、全員にもう一度表示されます。`
          : "文面を登録すると、選手に最初の1回だけ表示して同意を記録します。空のままなら何も出ません。"}
      </p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        disabled={loading}
        placeholder="ここに文面を貼り付け"
        className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm"
      />
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      {msg && <p className="text-xs text-green-600 mt-2">{msg}</p>}
      <button
        onClick={save}
        disabled={saving || loading}
        className="mt-3 px-4 py-2.5 rounded-lg bg-slate-800 text-white text-sm font-bold disabled:bg-slate-300"
      >
        {saving ? "保存中..." : "保存する"}
      </button>
    </div>
  );
}

// 指導者：組織の選手全員へのお知らせ（各選手のチャットに同じ文を入れる。通知も届く）
function BroadcastBox({ players, setCoachPlayers }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [role, setRole] = useState(CHAT_STAFF_ROLES[0].value);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const targets = players.filter((p) => !p.completedAt);
  if (targets.length === 0) return null;
  const send = async () => {
    const content = text.trim();
    if (!content) return;
    const sure = await askConfirm(`${targets.length}名に送りますか？`, { body: content, okLabel: "送る" });
    if (!sure) return;
    setSending(true);
    setError(null);
    try {
      const rows = await sbInsert(
        "messages",
        targets.map((p) => ({ player_id: p.id, sender: "staff", staff_role: role, content }))
      );
      const byPlayer = {};
      (rows || []).forEach((r) => {
        (byPlayer[r.player_id] = byPlayer[r.player_id] || []).push(normalizeMessage(r));
      });
      setCoachPlayers((prev) =>
        prev.map((p) => (byPlayer[p.id] ? { ...p, messages: [...p.messages, ...byPlayer[p.id]] } : p))
      );
      setText("");
      setOpen(false);
    } catch (err) {
      setError(errText(err));
    } finally {
      setSending(false);
    }
  };
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-2.5 text-sm font-bold text-blue-700 border-t border-slate-200 flex items-center justify-center gap-1.5"
      >
        <Megaphone size={15} /> 全員に連絡
      </button>
    );
  }
  return (
    <div className="border-t border-slate-200 p-3 space-y-2 bg-slate-50">
      <p className="text-xs font-bold text-slate-600">現役の選手 {targets.length}名のチャットに送ります</p>
      <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm bg-white">
        {CHAT_STAFF_ROLES.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}として送る
          </option>
        ))}
      </select>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="お知らせの内容"
        className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => setOpen(false)} className="flex-1 py-2.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-600">
          やめる
        </button>
        <button
          onClick={send}
          disabled={sending || !text.trim()}
          className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:bg-slate-300"
        >
          {sending ? "送信中..." : "送る"}
        </button>
      </div>
    </div>
  );
}

// 指導者どうしの申し送りメモ（選手の画面には出さない）
function StaffNotes({ player }) {
  const [notes, setNotes] = useState([]);
  const [text, setText] = useState("");
  const [role, setRole] = useState(CHAT_STAFF_ROLES[0].value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    let active = true;
    setNotes([]);
    sbSelect("staff_notes", `?player_id=eq.${encodeURIComponent(player.id)}&select=*&order=created_at.desc`)
      .then((rows) => active && setNotes(rows || []))
      .catch((err) => active && setError(errText(err)));
    return () => {
      active = false;
    };
  }, [player.id]);
  const add = async () => {
    const body = text.trim();
    if (!body) return;
    setSaving(true);
    setError(null);
    try {
      const [row] = await sbInsert("staff_notes", { player_id: player.id, author_role: role, body });
      setNotes((prev) => [row, ...prev]);
      setText("");
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id) => {
    if (!(await askConfirm("このメモを削除しますか？", { okLabel: "削除する", danger: true }))) return;
    try {
      await sbDelete("staff_notes", id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(errText(err));
    }
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h4 className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5">
        <ClipboardList size={16} className="text-blue-600" /> 申し送りメモ
      </h4>
      <p className="text-xs text-slate-400 mb-3">指導者どうしの引き継ぎ用です。選手の画面には出ません。</p>
      <div className="flex gap-2 mb-2">
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="書く人の立場" className="border border-slate-300 rounded-lg px-2 py-2.5 text-sm bg-white shrink-0">
          {CHAT_STAFF_ROLES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          onClick={add}
          disabled={saving || !text.trim()}
          className="ml-auto px-4 py-2.5 rounded-lg bg-slate-800 text-white text-sm font-bold disabled:bg-slate-300"
        >
          残す
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="例：左ハムの張りが残る。次回は RDL の負荷を据え置き"
        className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm"
      />
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      <ul className="mt-3 space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="bg-slate-50 rounded-lg px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-slate-500">
                {CHAT_STAFF_ROLE_LABELS[n.author_role] || "指導者"}・{formatDateTimeJa(n.created_at)}
              </p>
              <button onClick={() => remove(n.id)} className="text-slate-300 hover:text-red-500 p-2 -m-2" aria-label="このメモを削除">
                <Trash2 size={14} />
              </button>
            </div>
            <p className="text-sm text-slate-800 whitespace-pre-wrap mt-0.5">{n.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 記録の書き出し（CSV）。表計算ソフトでそのまま開ける形（先頭に BOM）
function downloadCsv(filename, header, rows) {
  const esc = (v) => {
    const t = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const text = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function buildExports(players, protocols, anonymous) {
  const nameOf = (p, i) => (anonymous ? `選手${String(i + 1).padStart(3, "0")}` : p.name);
  const protoOf = (p) => protocols.find((m) => m.id === p.protocolId)?.name || "";
  const dateOnly = (iso) => (iso ? String(iso).slice(0, 10) : "");
  const daysBetween = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 86400000) : "");
  return {
    players: {
      file: "選手一覧.csv",
      header: ["選手", "プロトコル", "PHASE", "受傷日", "復帰日", "受傷から復帰までの日数", "BAMIC", "損傷筋", "部位"],
      rows: players.map((p, i) => [
        nameOf(p, i), protoOf(p), p.currentPhase, p.injuryDate || "", dateOnly(p.completedAt),
        daysBetween(p.injuryDate, p.completedAt), p.bamicGrade || "",
        MUSCLE_LABELS[p.hamstringMuscle] || p.hamstringMuscle || "", LOCATION_LABELS[p.hamstringLocation] || p.hamstringLocation || "",
      ]),
    },
    reports: {
      file: "日報.csv",
      header: ["選手", "日付", "痛み", "疲労度", "睡眠の質", "気分", "恐怖心", "抜ける接地", "RPE", "本音"],
      rows: players.flatMap((p, i) =>
        p.reports.map((r) => [nameOf(p, i), r.date || "", r.vas ?? "", r.fatigue ?? "", r.sleepQuality ?? "", r.mental ?? "", r.fear ?? "", r.slippingContact == null ? "" : r.slippingContact ? "あり" : "なし", r.rpe ?? "", anonymous ? "" : r.honne || ""])
      ),
    },
    phases: {
      file: "PHASEの日数.csv",
      header: ["選手", "PHASE", "開始日", "終了日", "日数"],
      rows: players.flatMap((p, i) =>
        p.phaseHistory.map((h) => [nameOf(p, i), h.phaseNumber, dateOnly(h.enteredAt), dateOnly(h.leftAt), daysBetween(h.enteredAt, h.leftAt)])
      ),
    },
    treatments: {
      file: "治療の記録.csv",
      header: ["選手", "日付", "処置", "メモ"],
      rows: players.flatMap((p, i) =>
        p.treatments.map((t) => [nameOf(p, i), t.treatedDate || dateOnly(t.createdAt), TREATMENT_LABELS[t.type] || t.type, anonymous ? "" : t.note || ""])
      ),
    },
  };
}
function ExportCard({ players, protocols, loading }) {
  const [anonymous, setAnonymous] = useState(true);
  const data = buildExports(players, protocols, anonymous);
  const items = [
    ["players", "選手一覧"],
    ["reports", "日報"],
    ["phases", "PHASE の日数"],
    ["treatments", "治療の記録"],
  ];
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
        <Download size={16} className="text-blue-600" /> 記録の書き出し
      </p>
      <label className="flex items-start gap-3 text-sm text-slate-700 mb-3">
        <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} className="mt-0.5 w-5 h-5 shrink-0 accent-blue-600" />
        名前を番号に置き換える（自由記述も外す）
      </label>
      <div className="grid grid-cols-2 gap-2">
        {items.map(([key, label]) => (
          <button
            key={key}
            disabled={loading || data[key].rows.length === 0}
            onClick={() => downloadCsv(data[key].file, data[key].header, data[key].rows)}
            className="py-2.5 rounded-lg border border-slate-300 text-sm text-slate-700 disabled:opacity-40"
          >
            {label}
            <span className="block text-[11px] text-slate-400">{data[key].rows.length}件</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// 復帰した選手：復帰までの記録（PHASE ごとの日数と、日報の推移）
function RecoverySummary({ player, protocol }) {
  if (!player.completedAt) return null;
  const durations = computeOwnPhaseDurations(player.phaseHistory);
  const total =
    player.injuryDate ? Math.max(0, Math.round((new Date(player.completedAt) - new Date(player.injuryDate)) / 86400000)) : null;
  const phases = phaseRange(protocol).filter((n) => durations[n] !== undefined);
  const max = Math.max(1, ...phases.map((n) => durations[n]));
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5">
        <Trophy size={16} className="text-amber-500" /> 復帰までの記録
      </p>
      {total !== null && (
        <p className="text-2xl font-extrabold text-slate-800">
          {total}
          <span className="text-sm font-bold text-slate-500 ml-1">日（受傷から復帰まで）</span>
        </p>
      )}
      <div className="space-y-2 mt-3">
        {phases.map((n) => (
          <div key={n}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className={`font-bold ${PHASE_TEXT_COLORS[n]}`}>PHASE {n}</span>
              <span className="text-slate-500">{durations[n]}日</span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full ${PHASE_BG_COLORS[n]}`} style={{ width: `${Math.max(4, (durations[n] / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs font-bold text-slate-600 mt-4 mb-2">日報の推移（全期間）</p>
      <SimpleTrendChart reports={player.reports} limit={null} />
    </div>
  );
}

// ------------------------------------------------------------------
// 種目の動きを確認する（v32）
//   指導者が種目ごとに動画の URL を登録できる。登録があればその動画を、なければ種目名で YouTube を検索した結果を開く。
// ------------------------------------------------------------------
function exerciseSearchUrl(name) {
  // 「Jump Lv3｜SL Hop 前後・左右」→「SL Hop 前後・左右」のように、種目名の部分だけで探す
  const q = String(name || "").split("｜").pop().replace(/[（(].*?[）)]/g, " ").replace(/\s+/g, " ").trim();
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q + " exercise")}`;
}

function ExerciseVideo({ exercise, videoUrl, canEdit, onSaved }) {
  const [open, setOpen] = useState(false);
  const url = safeHref(videoUrl);
  const embed = getYouTubeEmbedUrl(url);
  const linkClass = "inline-flex items-center gap-1 min-h-[36px] px-3 rounded-full border border-red-200 bg-white text-xs font-bold text-red-600";

  const edit = async () => {
    const next = await askText(`${exercise.name} の動画`, {
      body: "YouTube などの URL を貼り付けてください。すべての組織の同じ種目に出ます。空にすると、種目名での検索に戻ります。",
      initial: videoUrl || "",
      placeholder: "https://www.youtube.com/watch?v=...",
      okLabel: "保存する",
    });
    if (next === null) return;
    const value = next.trim();
    if (value && !safeHref(value)) {
      showMessage("保存できませんでした", { body: "https:// で始まる URL を貼り付けてください。" });
      return;
    }
    try {
      await sbRpc("exercise_video_set", { p_org_id: exercise.org_id, p_coach_password: coachSecret, p_name: exercise.name, p_url: value });
      onSaved?.(exercise.name, value || null);
    } catch (err) {
      showMessage("保存できませんでした", { body: errText(err) });
    }
  };

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        {embed ? (
          <button onClick={() => setOpen((v) => !v)} className={linkClass} aria-expanded={open}>
            <Youtube size={14} /> {open ? "動画を閉じる" : "動きを見る"}
          </button>
        ) : (
          <a href={url || exerciseSearchUrl(exercise.name)} target="_blank" rel="noreferrer" className={linkClass}>
            <Youtube size={14} /> 動きを見る
          </a>
        )}
        {canEdit && (
          <button onClick={edit} className="min-h-[36px] px-3 rounded-full border border-slate-200 bg-white text-xs text-slate-500">
            {url ? "動画を変更" : "動画を登録"}
          </button>
        )}
      </div>
      {open && embed && (
        <div className="mt-2 aspect-video w-full rounded-lg overflow-hidden bg-black">
          <iframe
            src={embed}
            title={`${exercise.name} の動画`}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// 面談メモ（v32）：面談の内容を指導者が書き、選手本人と指導者が読む
// ------------------------------------------------------------------
function MeetingNotes({ player, viewer }) {
  const [notes, setNotes] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [role, setRole] = useState(CHAT_STAFF_ROLES[0].value);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const staff = viewer === "staff";

  useEffect(() => {
    let active = true;
    setNotes([]);
    setLoaded(false);
    sbSelect("meeting_notes", `?player_id=eq.${encodeURIComponent(player.id)}&select=*&order=held_on.desc.nullslast,created_at.desc`)
      .then((rows) => active && setNotes(rows || []))
      .catch((err) => active && staff && setError(errText(err)))
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [player.id]);

  const add = async () => {
    const body = text.trim();
    if (!body) return;
    setSaving(true);
    setError(null);
    try {
      const [row] = await sbInsert("meeting_notes", { player_id: player.id, held_on: date || null, author_role: role, body });
      setNotes((prev) => [row, ...prev]);
      setText("");
      setOpen(false);
      // 選手に知らせる（チャットに1行残す。通知も届く）
      try {
        await sbInsert("messages", {
          player_id: player.id,
          sender: "staff",
          staff_role: role,
          content: `【面談の記録】${date ? date + " の" : ""}面談のメモを追加しました。「連絡・面談」で読めます。`,
        });
      } catch {
        // 知らせられなくても、メモは保存できている
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id) => {
    if (!(await askConfirm("この面談メモを削除しますか？", { body: "選手の画面からも消えます。", okLabel: "削除する", danger: true }))) return;
    try {
      await sbDelete("meeting_notes", id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(errText(err));
    }
  };

  // 選手側：メモがまだなければカードごと出さない
  if (!staff && (!loaded || notes.length === 0)) return null;

  return (
    <div className={`bg-white border border-slate-200 p-5 ${staff ? "rounded-xl" : "rounded-2xl shadow-sm"}`}>
      <p className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5">
        <History size={16} className="text-blue-600" /> 面談メモ
      </p>
      {staff && <p className="text-xs text-slate-400 mb-3">選手本人も読めます。</p>}
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
      {staff &&
        (open ? (
          <div className="space-y-2 mb-3">
            <div className="flex gap-2">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="面談の日" className="flex-1 min-w-0 border border-slate-300 rounded-lg px-3 py-2.5 text-sm bg-white" />
              <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="書く人の立場" className="border border-slate-300 rounded-lg px-2 py-2.5 text-sm bg-white">
                {CHAT_STAFF_ROLES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="面談の内容を貼り付け"
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm"
            />
            <div className="flex gap-2">
              <button onClick={() => setOpen(false)} className="flex-1 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-600">
                やめる
              </button>
              <button onClick={add} disabled={saving || !text.trim()} className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:bg-slate-300">
                {saving ? "保存中..." : "保存して選手に知らせる"}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setOpen(true)} className="w-full mb-3 py-2.5 rounded-lg border border-dashed border-slate-300 text-sm font-bold text-slate-600">
            面談メモを追加
          </button>
        ))}
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="bg-slate-50 rounded-lg px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-slate-600">
                {n.held_on || formatDateTimeJa(n.created_at)}
                <span className="font-normal text-slate-400 ml-1.5">{CHAT_STAFF_ROLE_LABELS[n.author_role] || "指導者"}</span>
              </p>
              {staff && (
                <button onClick={() => remove(n.id)} className="text-slate-300 hover:text-red-500 p-2 -m-2" aria-label="この面談メモを削除">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed mt-1">{n.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------
// よくある質問（v32）：プロトコルごと。指導者がプロトコルの画面で編集し、選手はメニューで読む
// ------------------------------------------------------------------
function FaqList({ faq }) {
  const [openIdx, setOpenIdx] = useState(null);
  if (!faq || faq.length === 0) return null;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1.5">
        <HelpCircle size={16} className="text-blue-600" /> よくある質問
      </p>
      <ul className="divide-y divide-slate-100">
        {faq.map((f, i) => (
          <li key={i}>
            <button
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
              aria-expanded={openIdx === i}
              className="w-full flex items-center justify-between gap-2 py-3 text-left text-sm font-bold text-slate-700"
            >
              {f.q}
              {openIdx === i ? <ChevronUp size={16} className="shrink-0 text-slate-400" /> : <ChevronDown size={16} className="shrink-0 text-slate-400" />}
            </button>
            {openIdx === i && <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap pb-3">{f.a}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FaqEditor({ protocol, onSave }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const faq = protocol.faq || [];
  const save = async (next) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(protocol.id, next);
      return true;
    } catch (err) {
      setError(errText(err));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const add = async () => {
    if (!q.trim() || !a.trim()) return;
    if (await save([...faq, { q: q.trim(), a: a.trim() }])) {
      setQ("");
      setA("");
    }
  };
  const remove = async (idx) => {
    if (!(await askConfirm("この質問を削除しますか？", { body: faq[idx].q, okLabel: "削除する", danger: true }))) return;
    save(faq.filter((_, i) => i !== idx));
  };
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-50 text-sm text-slate-600"
      >
        よくある質問 {faq.length}件
        <ChevronDown size={16} />
      </button>
    );
  }
  return (
    <div className="mt-2 rounded-lg bg-slate-50/60 border border-slate-100 p-3">
      <button onClick={() => setOpen(false)} className="w-full flex items-center justify-between text-xs font-bold text-slate-600 mb-2">
        よくある質問（選手のメニューに出ます）
        <ChevronUp size={16} />
      </button>
      <ul className="space-y-1.5 mb-2">
        {faq.map((f, i) => (
          <li key={i} className="bg-white border border-slate-100 rounded-lg px-3 py-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-700">{f.q}</p>
              <p className="text-xs text-slate-500 whitespace-pre-wrap mt-0.5">{f.a}</p>
            </div>
            <button onClick={() => remove(i)} disabled={saving} className="text-slate-300 hover:text-red-500 p-2 -m-1 shrink-0" aria-label="この質問を削除">
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="質問" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-1.5" />
      <textarea value={a} onChange={(e) => setA(e.target.value)} rows={2} placeholder="答え" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      <button onClick={add} disabled={saving || !q.trim() || !a.trim()} className="mt-1.5 px-4 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold disabled:bg-slate-300">
        質問を追加
      </button>
    </div>
  );
}

// ------------------------------------------------------------------
// 日報の「本音」へのコメント・返信（v35）：チャットとは別に、日報1件ごとに残す
// ------------------------------------------------------------------
const COMMENT_AUTHOR_KEY = "resprint.commentAuthor"; // この端末で最後に使った立場と名前
function readCommentAuthor() {
  try {
    const v = JSON.parse(localStorage.getItem(COMMENT_AUTHOR_KEY) || "null");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function ReportThread({ player, viewer }) {
  const staff = viewer === "staff";
  const saved = staff ? readCommentAuthor() : {};
  const [comments, setComments] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState(null); // 入力欄を開いている日報
  const [showAll, setShowAll] = useState(false);
  const [text, setText] = useState("");
  const [role, setRole] = useState(CHAT_STAFF_ROLES.some((o) => o.value === saved.role) ? saved.role : CHAT_STAFF_ROLES[0].value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setComments([]);
    setLoaded(false);
    setOpenId(null);
    sbSelect("report_comments", `?player_id=eq.${encodeURIComponent(player.id)}&select=*&order=created_at.asc`)
      .then((rows) => active && setComments(rows || []))
      .catch((err) => active && staff && setError(errText(err)))
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [player.id]);

  const of = (reportId) => comments.filter((c) => String(c.report_id) === String(reportId));
  const all = player.reports.slice().reverse(); // 新しい順
  // 指導者：本音かコメントのある日報（最新の日報は必ず）。選手：コメントのある日報だけ
  const list = all.filter((r, i) => of(r.id).length > 0 || (staff && (i === 0 || (r.honne || "").trim())));
  const shown = showAll ? list.slice(0, 30) : list.slice(0, 3);

  const send = async (report) => {
    const body = text.trim();
    if (!body) return;
    setSaving(true);
    setError(null);
    try {
      const [row] = await sbInsert("report_comments", {
        report_id: report.id,
        player_id: player.id,
        sender: staff ? "staff" : "player",
        author_role: staff ? role : null,
        author_name: null,
        body,
      });
      setComments((prev) => [...prev, row]);
      setText("");
      setOpenId(null);
      if (staff) {
        try {
          localStorage.setItem(COMMENT_AUTHOR_KEY, JSON.stringify({ role }));
        } catch {
          // 保存できなくても、次回入力し直すだけ
        }
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id) => {
    if (!(await askConfirm("このコメントを削除しますか？", { body: "選手の画面からも消えます。", okLabel: "削除する", danger: true }))) return;
    try {
      await sbDelete("report_comments", id);
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(errText(err));
    }
  };

  if (!staff && (!loaded || list.length === 0)) return null;
  if (staff && list.length === 0) return null;

  return (
    <div className={staff ? "mt-3" : "bg-white rounded-2xl border border-slate-200 p-5 shadow-sm"}>
      <p className={`font-bold text-slate-700 mb-2 flex items-center gap-1.5 ${staff ? "text-xs" : "text-sm"}`}>
        <MessageCircle size={staff ? 14 : 16} className="text-blue-600" /> {staff ? "本音とコメント" : "日報へのコメント"}
      </p>
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
      <ul className="space-y-2">
        {shown.map((r) => (
          <li key={r.id} className="bg-slate-50 rounded-lg p-3">
            <p className="text-[11px] font-bold text-slate-500">{r.date}</p>
            <p className={`text-sm whitespace-pre-wrap leading-relaxed mt-0.5 ${(r.honne || "").trim() ? "text-slate-800" : "text-slate-400"}`}>
              {(r.honne || "").trim() || "本音の記入なし"}
            </p>
            {of(r.id).map((c) => (
              <div key={c.id} className={`mt-2 rounded-lg px-3 py-2 border ${c.sender === "player" ? "bg-white border-slate-200 ml-6" : "bg-blue-50 border-blue-100 mr-6"}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-500">
                    <span className="font-bold text-slate-700">
                      {c.sender === "player" ? (staff ? player.name : "自分") : CHAT_STAFF_ROLE_LABELS[c.author_role] || "指導者"}
                    </span>
                    {c.sender !== "player" && c.author_name && <span className="ml-1">{c.author_name}</span>}
                    <span className="ml-1.5">{formatDateTimeJa(c.created_at)}</span>
                  </p>
                  {staff && c.sender !== "player" && (
                    <button onClick={() => remove(c.id)} className="text-slate-300 hover:text-red-500 p-2 -m-2" aria-label="このコメントを削除">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed mt-0.5">{c.body}</p>
              </div>
            ))}
            {openId === r.id ? (
              <div className="mt-2 space-y-2">
                {staff && (
                  <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="書く人の立場" className="border border-slate-300 rounded-lg px-2 py-2.5 text-sm bg-white">
                    {CHAT_STAFF_ROLES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder={staff ? "コメント" : "返信"}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm bg-white"
                />
                <div className="flex gap-2">
                  <button onClick={() => { setOpenId(null); setError(null); }} className="flex-1 py-2.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-600">
                    やめる
                  </button>
                  <button onClick={() => send(r)} disabled={saving || !text.trim()} className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:bg-slate-300">
                    {saving ? "送信中..." : "送る"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setOpenId(r.id); setText(""); setError(null); }}
                className="mt-2 min-h-[36px] px-3 rounded-full border border-slate-300 bg-white text-xs font-bold text-slate-600"
              >
                {staff ? "コメントする" : "返信する"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {!showAll && list.length > 3 && (
        <button onClick={() => setShowAll(true)} className="mt-2 w-full py-2.5 rounded-lg bg-slate-50 text-xs font-bold text-slate-600">
          以前の日報を見る
        </button>
      )}
    </div>
  );
}

// 画面下のタブの中身（選手・指導者で共通）
function BottomTabs({ tabs, active, onChange }) {
  return (
    <div className="max-w-md mx-auto grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map((t) => {
        const Icon = t.icon;
        const on = active === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            aria-current={on ? "page" : undefined}
            className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-bold whitespace-nowrap ${
              on ? "text-blue-600" : "text-slate-400"
            }`}
          >
            <Icon size={22} strokeWidth={on ? 2.4 : 2} />
            {t.label}
            {t.badge > 0 && (
              <span className="absolute top-1.5 left-1/2 ml-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] leading-[18px] text-center">
                {t.badge > 9 ? "9+" : t.badge}
              </span>
            )}
          </button>
        );
      })}
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
      // 変更の履歴を残す
      await sbInsert("player_metric_history", {
        player_id: player.id,
        body_weight_kg: patch.body_weight_kg,
        baseline_time_sec: patch.baseline_time_sec,
        baseline_distance_m: patch.baseline_distance_m,
      });
      onSaved?.({
        bodyWeightKg: patch.body_weight_kg,
        baselineTimeSec: patch.baseline_time_sec,
        baselineDistanceM: patch.baseline_distance_m,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      showMessage("保存できませんでした", { body: errText(err) });
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
        メニューの「+10%BW」「@82%」を、実際の重さ・タイムに換算します。
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

  const [cohorts, setCohorts] = useState([]);
  const [showCohorts, setShowCohorts] = useState(false);

  // 組織内の全分類バリアントの実績（比較用）
  useEffect(() => {
    let active = true;
    if (!isHamstring) {
      setCohorts([]);
      return;
    }
    sbSelect(
      "hamstring_recovery_by_classification",
      `?org_id=eq.${encodeURIComponent(orgId)}&select=*&order=avg_days.asc`
    )
      .then((rows) => {
        if (active) setCohorts(rows || []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [orgId, isHamstring, player.completedAt]);

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
      showMessage("保存できませんでした", { body: errText(err) });
    } finally {
      setSaving(false);
    }
  };

  const summary =
    player.bamicGrade && player.hamstringMuscle && player.hamstringLocation
      ? `BAMIC ${player.bamicGrade}／${MUSCLE_LABELS[player.hamstringMuscle] ?? player.hamstringMuscle ?? "—"}／${
          LOCATION_LABELS[player.hamstringLocation] ?? player.hamstringLocation ?? "—"
        }`
      : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5">
        <Activity size={16} className="text-blue-600" /> ハムストリング損傷の分類
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
            {stats.sample_size < 3 && "件数が少ないため参考値です。"}
          </p>
        </div>
      )}
      {summary && (!stats || stats.sample_size === 0) && (
        <p className="text-[11px] text-slate-400 mt-3 pt-3 border-t border-slate-100">
          この分類の完遂データは、まだありません。
        </p>
      )}

      {cohorts.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <button
            onClick={() => setShowCohorts((v) => !v)}
            className="text-[11px] text-blue-600 hover:underline"
          >
            {showCohorts ? "分類別の比較を閉じる" : `分類別の比較を見る（${cohorts.length}分類）`}
          </button>
          {showCohorts && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr className="text-left border-b border-slate-200 text-slate-500">
                    <th className="py-1 pr-2">BAMIC</th>
                    <th className="py-1 pr-2">損傷筋</th>
                    <th className="py-1 pr-2">部位</th>
                    <th className="py-1 pr-2 text-right">平均</th>
                    <th className="py-1 pr-2 text-right">範囲</th>
                    <th className="py-1 text-right">n</th>
                  </tr>
                </thead>
                <tbody>
                  {cohorts.map((c, i) => {
                    const isMine =
                      c.bamic_grade === player.bamicGrade &&
                      c.hamstring_muscle === player.hamstringMuscle &&
                      c.hamstring_location === player.hamstringLocation;
                    return (
                      <tr
                        key={i}
                        className={`border-b border-slate-100 ${
                          isMine ? "bg-blue-50 font-bold text-blue-700" : "text-slate-600"
                        }`}
                      >
                        <td className="py-1 pr-2">{c.bamic_grade ?? "—"}</td>
                        <td className="py-1 pr-2">{MUSCLE_LABELS[c.hamstring_muscle] ?? "—"}</td>
                        <td className="py-1 pr-2">{LOCATION_LABELS[c.hamstring_location] ?? "—"}</td>
                        <td className="py-1 pr-2 text-right">{c.avg_days}日</td>
                        <td className="py-1 pr-2 text-right">
                          {c.min_days}〜{c.max_days}
                        </td>
                        <td className="py-1 text-right">
                          {c.sample_size}
                          {c.sample_size < 3 && (
                            <span className="block text-[9px] text-slate-400">参考値</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-[10px] text-slate-400 mt-1">
                完遂した選手のみ集計。青がこの選手の分類。
              </p>
            </div>
          )}
        </div>
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
      .catch((err) => active && setError(errText(err)))
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
      setError(errText(err));
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
    if (readOnly) return null;
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex items-center gap-2 text-slate-400 text-sm">
        <Loader2 size={16} className="animate-spin" /> 読み込み中
      </div>
    );
  }

  // 選手側：まだ何も選ばれていなければ、カードごと出さない
  if (readOnly && selected.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
        <Dumbbell size={16} className="text-blue-600" /> 患部外トレーニング
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
              ? "まだ選ばれていません。"
              : "この条件に合う項目はありません。"}
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
// ------------------------------------------------------------------
// 「続ける種目」の案内（プロトコルごとの設定）
//   例：ハムストリング肉離れのプロトコルでは、PHASE 4 以降の Strength / Eccentric を、
//       Jump・Jog・Running を始めたあとも続け、負荷を少しずつ上げていく。
//   この案内は **プロトコル自身の設定（protocols.continue_rule）** に書いてあるときだけ出す。
//   設定のないプロトコル（ほかの怪我のプロトコル）では、どの画面にも何も出ない。
//   文面も設定に入っているものをそのまま表示する（入力内容によって変えない）。
//     continue_rule = { from_phase, categories: [種目のカテゴリ], label, title, text, ack }
// ------------------------------------------------------------------
function normalizeContinueRule(raw) {
  if (!raw || typeof raw !== "object") return null;
  const fromPhase = Number(raw.from_phase);
  const categories = Array.isArray(raw.categories) ? raw.categories.filter((c) => typeof c === "string") : [];
  if (!Number.isFinite(fromPhase) || fromPhase < 1 || categories.length === 0 || !raw.text) return null;
  const label = String(raw.label || categories.map((c) => CATEGORY_LABELS[c] ?? c).join(" / "));
  return {
    fromPhase,
    categories,
    label,
    title: String(raw.title || `${label} は続ける`),
    text: String(raw.text),
    ack: String(raw.ack || `次のPHASEに進んでも、${label} は続けることを確認しました`),
  };
}
// この選手のいまの PHASE で、案内を出すか
function activeContinueRule(protocol, currentPhase) {
  const rule = protocol?.continueRule;
  return rule && currentPhase >= rule.fromPhase ? rule : null;
}

// ロードマップの下に出す2本目の線：PHASE 4 から最後まで続くことを絵で見せる
function ContinuingLane({ protocol, currentPhase }) {
  const rule = protocol?.continueRule;
  if (!rule) return null;
  const n = phaseCountOf(protocol);
  if (n <= rule.fromPhase) return null;
  const active = currentPhase >= rule.fromPhase;
  return (
    <div className="mt-3">
      <div className="flex w-full h-5 gap-px">
        {phaseRange(protocol).map((ph) => (
          <div
            key={ph}
            className={`flex-1 ${ph === n ? "rounded-r-full" : ""} ${ph === rule.fromPhase ? "rounded-l-full" : ""} ${
              ph < rule.fromPhase ? "bg-transparent" : ph <= currentPhase ? "bg-emerald-500" : "bg-emerald-200"
            }`}
          />
        ))}
      </div>
      <p className={`text-xs font-bold mt-1 flex items-center gap-1 ${active ? "text-emerald-700" : "text-slate-400"}`}>
        <Repeat size={13} className="shrink-0" /> {rule.label}：PHASE {rule.fromPhase} から最後まで続ける
      </p>
    </div>
  );
}

const CATEGORY_LABELS = {
  isometric: "等尺性収縮",
  strength: "Strength",
  eccentric: "Eccentric",
  jump: "Jump / Hop",
  sprint_drill: "Sprint Drill",
  running: "Running",
};

// PHASE 10 では37種目になるため、カテゴリでまとめる。
// その段階で追加された種目は開き、継続中のものは畳む。
function MenuByCategory({ exercises, currentPhase, renderExercise, continueRule }) {
  const [openKeys, setOpenKeys] = useState(null);

  const groups = {};
  exercises.forEach((e) => {
    const key = e.category || "other";
    (groups[key] = groups[key] || []).push(e);
  });
  // 「続ける種目」は上に固定して、いつも開いたままにする（畳めない）
  const pinnedKeys = continueRule ? continueRule.categories.filter((k) => groups[k]) : [];
  const keys = Object.keys(groups).filter((k) => !pinnedKeys.includes(k));

  // 初期状態：今のPHASEで追加された種目を含むカテゴリだけ開く
  const defaultOpen = keys.filter((k) => groups[k].some((e) => e.intro_phase === currentPhase));
  const open = openKeys ?? defaultOpen;
  const toggle = (k) =>
    setOpenKeys(open.includes(k) ? open.filter((x) => x !== k) : [...open, k]);

  return (
    <div className="space-y-2">
      {pinnedKeys.length > 0 && (
        <div className="border-2 border-emerald-300 bg-emerald-50/60 rounded-xl p-3">
          <p className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
            <Repeat size={15} /> {continueRule.title}
          </p>
          <p className="text-xs text-emerald-800/90 leading-relaxed mt-1 mb-2">{continueRule.text}</p>
          {pinnedKeys.map((k) => (
            <div key={k} className="mt-2">
              <p className="text-xs font-bold text-emerald-900 mb-1.5">
                {CATEGORY_LABELS[k] ?? k}
                <span className="font-normal text-emerald-700 ml-1.5">{groups[k].length}種目</span>
                <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-600 text-white">継続</span>
              </p>
              <div className="space-y-2">{groups[k].map(renderExercise)}</div>
            </div>
          ))}
        </div>
      )}
      {pinnedKeys.length > 0 && keys.length > 0 && (
        <p className="text-xs font-bold text-slate-500 pt-2">そのほかの種目</p>
      )}
      {keys.map((k) => {
        const list = groups[k];
        const newCount = list.filter((e) => e.intro_phase === currentPhase).length;
        const isOpen = open.includes(k);
        return (
          <div key={k} className="border border-slate-200 rounded-lg">
            <button
              onClick={() => toggle(k)}
              className="w-full flex items-center justify-between px-3 py-2 text-left"
            >
              <span className="text-xs font-bold text-slate-700">
                {CATEGORY_LABELS[k] ?? "その他"}
                <span className="font-normal text-slate-400 ml-1.5">{list.length}種目</span>
                {newCount > 0 && (
                  <span className="ml-1.5 text-[10px] font-bold text-blue-600">
                    今回追加 {newCount}
                  </span>
                )}
              </span>
              <span className="text-[10px] text-slate-400">{isOpen ? "畳む" : "開く"}</span>
            </button>
            {isOpen && <div className="px-3 pb-3 space-y-2">{list.map(renderExercise)}</div>}
          </div>
        );
      })}
    </div>
  );
}

function CumulativeMenuPanel({ player, protocol, readOnly, onChanged }) {
  const [exercises, setExercises] = useState([]);
  const [steps, setSteps] = useState([]);
  const [progress, setProgress] = useState([]);
  const [logs, setLogs] = useState([]);
  const [videos, setVideos] = useState({}); // 種目名 → 動画の URL（全組織で共通）
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
      // 「今日やった」の記録（直近7日分）。読めなくてもメニューは出す
      sbSelect(
        "exercise_logs",
        `?player_id=eq.${encodeURIComponent(player.id)}&done_on=gte.${localDateStr(new Date(Date.now() - 6 * 86400000))}&select=exercise_id,done_on`
      ).catch(() => []),
      // 種目の動画（読めなくてもメニューは出す）
      sbSelect("exercise_videos", "?select=name,video_url").catch(() => []),
    ])
      .then(([e, s, p, l, v]) => {
        if (!active) return;
        setVideos(Object.fromEntries((v || []).map((x) => [x.name, x.video_url])));
        setExercises(e || []);
        setSteps(s || []);
        setProgress(p || []);
        setLogs(l || []);
      })
      .catch((err) => active && setError(errText(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [protocol?.id, player.id]);

  const progressOf = (exId) => progress.find((p) => p.exercise_id === exId);
  // 「今日やった」：選手が自分で付ける。指導者は、今日と直近7日の回数を見られる
  const today = todayStr();
  const doneToday = (exId) => logs.some((l) => l.exercise_id === exId && l.done_on === today);
  const doneCount = (exId) => logs.filter((l) => l.exercise_id === exId).length;
  const toggleDone = async (exId) => {
    const was = doneToday(exId);
    // 先に画面を変えて、失敗したら戻す
    setLogs((prev) =>
      was ? prev.filter((l) => !(l.exercise_id === exId && l.done_on === today)) : [...prev, { exercise_id: exId, done_on: today }]
    );
    try {
      if (was) {
        await sb(
          `exercise_logs?player_id=eq.${encodeURIComponent(player.id)}&exercise_id=eq.${exId}&done_on=eq.${today}`,
          { method: "DELETE", prefer: "return=minimal" }
        );
      } else {
        await sbUpsert("exercise_logs", { player_id: player.id, exercise_id: exId, done_on: today }, "player_id,exercise_id,done_on");
      }
    } catch (err) {
      setLogs((prev) =>
        was ? [...prev, { exercise_id: exId, done_on: today }] : prev.filter((l) => !(l.exercise_id === exId && l.done_on === today))
      );
      setError(errText(err));
    }
  };
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
      setError(errText(err));
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
      <div key={e.id} className="border border-slate-200 bg-white rounded-lg p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <p className="text-xs font-bold text-slate-700">{e.name}</p>
            <p className="text-[10px] text-slate-400">
              PHASE {e.intro_phase} 導入
              {e.continues ? "・以降も継続" : ""}
              {e.prescription ? `・${e.prescription}` : ""}
              {!e.is_gate_exercise ? "・GATE種目外" : ""}
            </p>
          </div>
          {readOnly ? (
            <button
              onClick={() => toggleDone(e.id)}
              aria-pressed={doneToday(e.id)}
              className={`shrink-0 min-h-[36px] px-3 rounded-full text-xs font-bold border flex items-center gap-1 ${
                doneToday(e.id) ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-slate-300 text-slate-500"
              }`}
            >
              {doneToday(e.id) && <CheckCircle2 size={14} />}
              {doneToday(e.id) ? "今日やった" : "やった"}
            </button>
          ) : (
            <span
              className={`shrink-0 text-[11px] font-bold px-2 py-1 rounded-full ${
                doneToday(e.id) ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              {doneToday(e.id) ? "今日 実施" : "今日 未実施"}・7日で{doneCount(e.id)}回
            </span>
          )}
        </div>

        {e.notes && <p className="text-[11px] text-amber-700 mt-1 leading-relaxed">※{e.notes}</p>}

        <ExerciseVideo
          exercise={e}
          videoUrl={videos[e.name] || null}
          canEdit={!readOnly}
          onSaved={(name, url) => setVideos((prev) => ({ ...prev, [name]: url }))}
        />

        {exSteps.length > 0 && (
          <div className="mt-2 bg-slate-50 rounded px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1">
                <p className="text-[10px] text-slate-400">
                  ステップ {stepIdx + 1}/{exSteps.length}
                </p>
                {/* 負荷の段階：いまどこまで上げたかを目で見えるようにする */}
                <div className="flex gap-0.5 my-1" aria-hidden="true">
                  {exSteps.map((st, i) => (
                    <span
                      key={st.id ?? i}
                      className={`h-1.5 flex-1 rounded-full ${i <= stepIdx ? "bg-emerald-500" : "bg-slate-200"}`}
                    />
                  ))}
                </div>
                <p className="text-xs text-slate-700">{step?.label ?? "—"}</p>
                {step?.target && <p className="text-[10px] text-slate-500">{step.target}</p>}
                {step?.load_percent_bw != null && (
                  <p className="text-[10px] text-blue-600">
                    {loadKg !== null
                      ? `${step.load_percent_bw}%BW（${loadKg}kg）`
                      : `${step.load_percent_bw}%BW`}
                  </p>
                )}
                {step?.speed_percent != null && (
                  <p className="text-[10px] text-blue-600">
                    {timeSec !== null
                      ? `${step.speed_percent}%（${player.baselineDistanceM ?? 100}m ${timeSec}秒）`
                      : `${step.speed_percent}%`}
                  </p>
                )}
                {exSteps[stepIdx + 1] && (
                  <p className="text-[10px] text-emerald-700 mt-0.5">
                    次のステップ：{exSteps[stepIdx + 1].label}
                    {exSteps[stepIdx + 1].target ? `（${exSteps[stepIdx + 1].target}）` : ""}
                  </p>
                )}
                {((step?.load_percent_bw != null && !player.bodyWeightKg) ||
                  (step?.speed_percent != null && !player.baselineTimeSec)) && (
                  <p className="text-[10px] text-slate-400">
                    体重・基準タイムを入れると実数で表示
                  </p>
                )}
              </div>
              {!readOnly && (
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => saveProgress(e.id, { current_step: Math.max(1, stepIdx) })}
                    disabled={stepIdx <= 0}
                    className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-30"
                    title="前のステップへ"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <button
                    onClick={() =>
                      saveProgress(e.id, { current_step: Math.min(exSteps.length, stepIdx + 2) })
                    }
                    disabled={stepIdx >= exSteps.length - 1}
                    className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-blue-600 disabled:opacity-30"
                    title="次のステップへ"
                  >
                    <ArrowRight size={16} />
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
          前の PHASE の種目も続けます。
        </p>
        <MenuByCategory
          exercises={current}
          currentPhase={player.currentPhase}
          renderExercise={renderExercise}
          continueRule={activeContinueRule(protocol, player.currentPhase)}
        />
      </div>

      {upcoming.length > 0 && (
        <div className="bg-white rounded-2xl border border-red-100 p-5 shadow-sm">
          <p className="text-sm font-bold text-red-600 mb-1 flex items-center gap-1.5">
            <Ban size={16} /> まだ行わない種目
          </p>
          <ul className="space-y-1 mt-3">
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
