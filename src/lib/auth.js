// ============================================================
// Supabase の接続設定と、ログイン状態（Supabase Auth）の管理
//
//   @supabase/supabase-js は使わず、Auth の REST API を fetch で直接呼ぶ。
//
//   ・組織ログイン … 匿名サインインで「この端末の利用者」を作り、
//                    DB の org_login() でパスワードを照合してもらう。
//                    照合に通ると、その利用者が組織のメンバーとして記録され、
//                    RLS によって自分の組織のデータだけが読めるようになる。
//   ・管理者       … Supabase Auth のメールアドレスとパスワードでログインし、
//                    DB の app_admins に登録されているかを admin_whoami() で確認する。
//
//   ログイン状態（アクセストークン）はこの端末の localStorage に保存する。
//   localStorage が使えない環境では、タブを閉じるまでのメモリ保存で動く。
// ============================================================

// 本番の値。テスト用の Supabase プロジェクトで試すときは、
// .env.local に VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を書くと差し替えられる。
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://akvfrihatvfkrjzpxtcw.supabase.co";
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_c2dND4Q3D36SDX8JsxaWSA_ayFHmuSJ";

const AUTH_SESSION_KEY = "resprint.auth";

// 新形式の公開キー（sb_publishable_...）は JWT ではないので、Authorization に入れてはいけない。
// 旧形式（eyJ...）は 2026年末に廃止予定。どちらでも動くようにしておく。
const KEY_IS_JWT = SUPABASE_ANON_KEY.startsWith("eyJ");

// ログインが切れた（リフレッシュトークンが無効になった）ことをアプリに知らせるイベント
export const AUTH_LOST_EVENT = "resprint:auth-lost";

let memorySession = null;

// ・組織ログイン（匿名ユーザー）… 端末に保存して30日間使う
// ・管理者 … 全組織に及ぶ権限なので端末には保存しない（タブを閉じる・再読み込みで消える）
function loadSession() {
  if (memorySession && !memorySession.isAnonymous) return memorySession;
  try {
    // 組織ログインは毎回端末の保存から読む（別のタブがトークンを更新していることがあるため）
    const raw = window.localStorage.getItem(AUTH_SESSION_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && !saved.isAnonymous) {
      // 以前のバージョンで保存された管理者のログインは使わずに消す
      window.localStorage.removeItem(AUTH_SESSION_KEY);
      return null;
    }
    return saved || memorySession;
  } catch {
    return memorySession;
  }
}

function saveSession(session) {
  memorySession = session;
  try {
    if (session && session.isAnonymous) window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(AUTH_SESSION_KEY);
  } catch {
    // 保存できなくてもメモリ上では続ける
  }
}

function toSession(data) {
  if (!data || !data.access_token) return null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at
      ? data.expires_at * 1000
      : Date.now() + (data.expires_in || 3600) * 1000,
    userId: data.user?.id || null,
    isAnonymous: Boolean(data.user?.is_anonymous),
  };
}

// Auth API のエラーを、利用者に見せられる日本語にする
function authErrorMessage(status, body) {
  const code = body?.error_code || body?.code || "";
  const msg = body?.msg || body?.message || body?.error_description || body?.error || "";
  if (code === "anonymous_provider_disabled" || /anonymous/i.test(msg)) {
    return "サーバー側の準備（匿名サインインの有効化）がまだ済んでいません。管理者に連絡してください。";
  }
  if (code === "invalid_credentials" || /invalid login credentials/i.test(msg)) {
    return "メールアドレスまたはパスワードが違います。";
  }
  if (code === "email_not_confirmed") {
    return "このメールアドレスはまだ確認されていません。";
  }
  if (status === 429 || code === "over_request_rate_limit") {
    return "短時間に何度も試したため、しばらく待ってからお試しください。";
  }
  return `ログインに失敗しました（${status}${msg ? `: ${msg}` : ""}）`;
}

async function authFetch(path, { method = "POST", body, token } = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : KEY_IS_JWT ? { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {}),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = new Error(authErrorMessage(res.status, json));
    err.status = res.status;
    throw err;
  }
  return json;
}

// いまのログイン状態（なければ null）
export function currentAuth() {
  const s = loadSession();
  return s ? { userId: s.userId, isAnonymous: s.isAnonymous } : null;
}

export function hasAuthSession() {
  return Boolean(loadSession()?.refreshToken);
}

// 期限が近ければ更新してから、アクセストークンを返す。ログインしていなければ null。
let refreshing = null;
export async function getAccessToken() {
  const s = loadSession();
  if (!s) return null;
  if (s.expiresAt - Date.now() > 60 * 1000) return s.accessToken;

  if (!refreshing) {
    refreshing = (async () => {
      try {
        const data = await authFetch("token?grant_type=refresh_token", {
          body: { refresh_token: s.refreshToken },
        });
        const next = toSession(data);
        saveSession(next);
        return next?.accessToken || null;
      } catch (err) {
        // 通信できないだけなら、ログイン状態は消さない
        if (err.status && err.status >= 400 && err.status < 500) {
          saveSession(null);
          window.dispatchEvent(new Event(AUTH_LOST_EVENT));
          return null;
        }
        throw err;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

// REST / Storage に付けるヘッダー。
// ログイン中は利用者のトークン、未ログインなら匿名キーだけ（RLS で何も読めない）。
export async function apiHeaders(extra = {}) {
  const token = await getAccessToken();
  const auth = token
    ? { Authorization: `Bearer ${token}` }
    : KEY_IS_JWT
      ? { Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
      : {};
  return { apikey: SUPABASE_ANON_KEY, ...auth, ...extra };
}

// 組織ログイン用：この端末の匿名利用者を用意する
export async function ensureAnonymousSession() {
  const s = loadSession();
  if (s && s.isAnonymous) {
    const token = await getAccessToken();
    if (token) return;
  } else if (s) {
    // 管理者としてログインしたままなら、いったん抜ける
    await signOut();
  }
  const data = await authFetch("signup", { body: { data: {} } });
  const next = toSession(data);
  if (!next) throw new Error("匿名サインインに失敗しました。");
  saveSession(next);
}

// 管理者用：メールアドレスとパスワードでログイン
export async function signInWithPassword(email, password) {
  const s = loadSession();
  if (s) await signOut();
  const data = await authFetch("token?grant_type=password", {
    body: { email: email.trim(), password },
  });
  const next = toSession(data);
  if (!next) throw new Error("ログインに失敗しました。");
  saveSession(next);
}

// ログアウト（この端末のセッションだけ無効にする。失敗しても端末側は必ず消す）
//   scope を付けないと「全端末からログアウト」になり、管理者が他の端末からも締め出されるため local を指定する。
export async function signOut() {
  const s = loadSession();
  saveSession(null);
  if (!s) return;
  try {
    await authFetch("logout?scope=local", { token: s.accessToken });
  } catch {
    // 期限切れなどで失敗しても問題ない
  }
}
