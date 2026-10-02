/* ============================================================
   RE:SPRINT - Service Worker

   方針：かならずネットワークを先に見る（network-first）
     ・通信できるときは、いつも最新のファイルを使います。
       → デプロイした変更が「反映されない」ことが起きません。
     ・通信できないときだけ、前回の内容を表示します。

   キャッシュするのは「アプリ本体」だけ（許可リスト方式）
     ・ページ（index.html）、/assets/ の JS・CSS、アイコン、manifest
     ・Supabase への通信（別ドメイン）＝ 選手のデータ・写真・動画には一切触りません。
     ・送信系の通信（POST/PATCH など）や、ログイン情報付きの通信にも触りません。
     ・許可リストにない同じドメインのファイルも、キャッシュしません。
   ============================================================ */

const CACHE = "resprint-v15";
const SHELL_KEY = "/index.html";

const STATIC_FILES = new Set([
  "/manifest.json",
  "/favicon-32.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
]);

function isAppFile(url) {
  return url.pathname.startsWith("/assets/") || STATIC_FILES.has(url.pathname);
}

self.addEventListener("install", () => {
  // 新しい内容をすぐ有効にする
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 古いバージョンのキャッシュ（v14 までは同じドメインの全ファイルを入れていた）を消す
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // 読み取り以外（日報の送信、写真のアップロードなど）はそのまま通す
  if (req.method !== "GET") return;
  // ログイン情報の付いた通信はそのまま通す
  if (req.headers.has("authorization")) return;

  // 別ドメイン（Supabase のデータ・写真・動画、YouTube など）はそのまま通す
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isPage = req.mode === "navigate";
  if (!isPage && !isAppFile(url)) return;

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === "basic") {
          const cache = await caches.open(CACHE);
          // ページはどのURLで開いても同じ index.html なので、1つの鍵で保存する
          await cache.put(isPage ? SHELL_KEY : req, res.clone());
        }
        return res;
      } catch (err) {
        // ここに来るのは圏外・機内モードなどのとき
        const cache = await caches.open(CACHE);
        const cached = await cache.match(isPage ? SHELL_KEY : req);
        if (cached) return cached;
        throw err;
      }
    })()
  );
});

/* ------------------------------------------------------------
   プッシュ通知（v15.10）
     送信役（/api/push）から届いた短い定型文を、通知として出す。
     通知を押すと、開いているアプリを前に出す（なければ開く）。
   ------------------------------------------------------------ */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "RE:SPRINT", {
      body: data.body || "新しいお知らせがあります",
      tag: data.tag || "resprint",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    })()
  );
});
