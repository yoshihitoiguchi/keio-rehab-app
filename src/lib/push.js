// ============================================================
// プッシュ通知（アプリを閉じていても届く通知）の端末側
//
//   ・「通知を受け取る」を押した端末だけが対象。端末ごと・役割ごと（選手／指導者）に登録する。
//   ・登録先は DB の push_subscribe()（v27）。宛先は API に公開されない表に入る。
//   ・iPhone は、ホーム画面に追加したアプリから開いたときだけ使える（Safari のままでは使えない）。
//   ・通知を出すのは Service Worker（public/sw.js）。本番ビルドでしか登録されないので、開発中は使えない。
// ============================================================

// 送信役（api/push.js）の VAPID_PUBLIC_KEY と同じ値。公開してよい鍵（秘密鍵は Vercel の環境変数にだけある）
export const VAPID_PUBLIC_KEY =
  "BO74VDlqvsBhYlZmK3HFAsDw9mJDsXSCIJrWuqyF_iYEM5BkUhvzUZ_HmnhK66Km2K_-sYp1UGYrvyxdDDc-F_I";

// この端末で通知をオンにした役割を覚えておく（アプリを開いたときに登録を更新するため）
const flagKey = (role) => `resprint.push.${role}`;
function readFlag(role) {
  try {
    return window.localStorage.getItem(flagKey(role)) === "1";
  } catch {
    return false;
  }
}
function writeFlag(role, on) {
  try {
    if (on) window.localStorage.setItem(flagKey(role), "1");
    else window.localStorage.removeItem(flagKey(role));
  } catch {
    // 覚えられなくても動く
  }
}

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function keyToBytes(base64url) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error("この画面では通知を使えません（アプリを開き直してからお試しください）。");
  return reg;
}

// いまの状態：'unsupported'（使えない端末）/ 'denied'（端末の設定で拒否）/ 'on' / 'off'
export async function pushState(role) {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return sub && Notification.permission === "granted" && readFlag(role) ? "on" : "off";
  } catch {
    return "off";
  }
}

// 通知をオンにする。rpc は App.jsx の sbRpc（DB の関数を呼ぶ）
export async function enablePush(rpc, { orgId, role, playerId }) {
  if (!pushSupported()) throw new Error("この端末・ブラウザは通知に対応していません。");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("通知が許可されませんでした。端末の設定で、このアプリの通知を許可してください。");
  }
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY) }));
  await register(rpc, sub, { orgId, role, playerId });
  writeFlag(role, true);
}

async function register(rpc, sub, { orgId, role, playerId }) {
  const json = sub.toJSON();
  await rpc("push_subscribe", {
    p_org_id: orgId,
    p_role: role,
    p_player_id: role === "player" ? playerId : null,
    p_endpoint: json.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
  });
}

// 通知をオフにする（role を省くと、この端末の登録をすべて消す）
export async function disablePush(rpc, role) {
  if (role) writeFlag(role, false);
  else ["player", "coach"].forEach((r) => writeFlag(r, false));
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) await rpc("push_unsubscribe", { p_endpoint: sub.endpoint, p_role: role || null });
  } catch {
    // 消せなくても、端末側の覚えは消してある
  }
}

// アプリを開いたとき：オンにしてある端末の登録を最新にする（宛先が変わっていても届くように）
export async function refreshPush(rpc, { orgId, role, playerId }) {
  if (!pushSupported() || !readFlag(role) || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) await register(rpc, sub, { orgId, role, playerId });
  } catch {
    // 更新できなくても、次に開いたときにまた試す
  }
}
