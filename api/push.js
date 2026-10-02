// ============================================================
// プッシュ通知の送信役（Vercel の関数。https://<本番>/api/push）
//
//   DB のトリガー（v27：resprint_private.push_send）から呼ばれ、渡された宛先へ通知を送る。
//   ・合言葉（x-resprint-secret）が合わない呼び出しは受け付けない。
//   ・宛先は、主要なブラウザの通知サービスだけ（それ以外の URL へは送らない）。
//   ・通知の中身は、DB が決めた短い定型文だけ（選手名・本文は入っていない）。
//   ・使えなくなった宛先（端末側で通知をやめた等）は、DB に知らせて消してもらう。
//
//   Vercel の環境変数（リポジトリには書かない）：
//     PUSH_SECRET        DB 側の resprint_private.push_config の secret と同じ値
//     VAPID_PUBLIC_KEY   src/lib/push.js の VAPID_PUBLIC_KEY と同じ値
//     VAPID_PRIVATE_KEY  その秘密鍵
// ============================================================
import { timingSafeEqual } from "node:crypto";
import webpush from "web-push";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://akvfrihatvfkrjzpxtcw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_c2dND4Q3D36SDX8JsxaWSA_ayFHmuSJ";
const SUBJECT = process.env.VAPID_SUBJECT || "https://keio-rehab-app.vercel.app";
const ALLOWED_HOST = /(^|\.)(push\.apple\.com|googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;
const MAX_SUBSCRIPTIONS = 500;

function sameSecret(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

export function endpointAllowed(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && ALLOWED_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  const secret = process.env.PUSH_SECRET;
  if (!secret || !sameSecret(req.headers["x-resprint-secret"], secret)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return res.status(500).json({ error: "VAPID keys are not configured" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const subs = (Array.isArray(body.subscriptions) ? body.subscriptions : [])
    .filter((s) => s && endpointAllowed(s.endpoint) && s.p256dh && s.auth)
    .slice(0, MAX_SUBSCRIPTIONS);
  const payload = JSON.stringify({
    title: String(body.title || "RE:SPRINT").slice(0, 60),
    body: String(body.body || "").slice(0, 120),
    tag: String(body.tag || "resprint").slice(0, 40),
    url: "/",
  });

  webpush.setVapidDetails(SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const gone = [];
  let sent = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60, urgency: "high" }
        );
        sent++;
      } catch (err) {
        failed++;
        // 404 / 410：その端末では通知が使えなくなった（アプリを消した・通知をやめた）
        if (err && (err.statusCode === 404 || err.statusCode === 410)) gone.push(s.endpoint);
      }
    })
  );

  if (gone.length > 0) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/push_report_gone`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ p_secret: secret, p_endpoints: gone }),
      });
    } catch {
      // 消せなくても、次に送ったときにまた報告する
    }
  }
  return res.status(200).json({ sent, failed, gone: gone.length });
}
