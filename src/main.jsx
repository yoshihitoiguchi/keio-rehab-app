import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { SUPABASE_URL } from "./lib/auth.js";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// ------------------------------------------------------------------
// ホーム画面アプリ（PWA）の登録
//   ・Android で「アプリをインストール」を出すために必要
//   ・圏外のときに前回の画面を表示するために必要
//   ・sw.js は「通信できるときは必ず最新を取りに行く」設定なので、
//     デプロイした変更が古いまま残ることはありません。
//   ・開発サーバー（npm run dev）では登録しない。
//     開発中のファイルがキャッシュされて、確認を混乱させないため。
// ------------------------------------------------------------------
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 登録できなくても、アプリは通常どおり動きます
    });
  });
  // v15.6 から：新しい内容が有効になっても、勝手に読み込み直さない。
  // 入力中の選手の画面が突然切り替わらないよう、「更新する」ボタン（App.jsx の UpdateNotice）で案内する。
} else if ("serviceWorker" in navigator) {
  // 開発サーバーで以前に登録されたものがあれば外す
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
}

// 開発サーバーが本番の Supabase につながっているときは、画面の上に常に表示する
// （試しに登録・削除したものが本番データになるため）
if (import.meta.env.DEV && SUPABASE_URL.includes("akvfrihatvfkrjzpxtcw")) {
  const bar = document.createElement("div");
  bar.textContent = "開発中：本番のデータベースに接続しています。登録・削除は本番のデータに反映されます。";
  bar.setAttribute("role", "status");
  bar.style.cssText =
    "position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#b91c1c;color:#fff;" +
    "font:12px/1.4 sans-serif;padding:6px 12px calc(6px + env(safe-area-inset-bottom));text-align:center;";
  document.body.appendChild(bar);
}
