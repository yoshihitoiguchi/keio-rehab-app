// 送信役（api/push.js）のテスト  npm run test:api
//   実際の通知サービスには送らない（合言葉の確認と、宛先の絞り込みだけを確かめる）。
import webpush from "web-push";
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${l}`); };

const keys = webpush.generateVAPIDKeys();
process.env.PUSH_SECRET = "test-secret-123";
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
const { default: handler, endpointAllowed } = await import("../../api/push.js");

function call(method, headers, body) {
  return new Promise((resolve) => {
    const res = {
      code: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.code = c; return this; },
      json(obj) { resolve({ code: this.code, body: obj }); },
    };
    handler({ method, headers, body }, res);
  });
}
// 外へ出る通信は横取りする（通知サービスにも Supabase にも実際には送らない）
const sentTo = [];
webpush.sendNotification = async (sub) => {
  sentTo.push(sub.endpoint);
  if (sub.endpoint.includes("gone")) { const e = new Error("gone"); e.statusCode = 410; throw e; }
};
const reported = [];
globalThis.fetch = async (url, opts) => { reported.push({ url: String(url), body: JSON.parse(opts.body) }); return { ok: true }; };

ok((await call("GET", {}, null)).code === 405, "POST 以外は受け付けない");
ok((await call("POST", {}, { subscriptions: [] })).code === 401, "合言葉がなければ受け付けない");
ok((await call("POST", { "x-resprint-secret": "wrong" }, { subscriptions: [] })).code === 401, "合言葉が違えば受け付けない");
const good = { "x-resprint-secret": "test-secret-123" };
let r = await call("POST", good, { subscriptions: [], body: "テスト" });
ok(r.code === 200 && r.body.sent === 0, "合言葉が合えば受け付ける（宛先が空なら何も送らない）");
r = await call("POST", good, { body: "選手から新しいメッセージがあります", subscriptions: [
  { endpoint: "https://web.push.apple.com/abc", p256dh: "k", auth: "a" },
  { endpoint: "https://fcm.googleapis.com/fcm/send/gone-1", p256dh: "k", auth: "a" },
  { endpoint: "https://evil.example.com/hook", p256dh: "k", auth: "a" },
  { endpoint: "http://web.push.apple.com/plain", p256dh: "k", auth: "a" },
  { endpoint: "https://web.push.apple.com/nokeys" },
] });
ok(r.body.sent === 1 && r.body.failed === 1 && r.body.gone === 1, "通知サービスの宛先だけに送る（1件成功・1件は無効）");
ok(sentTo.length === 2 && !sentTo.some((e) => e.includes("evil") || e.startsWith("http://")), "ほかの URL・https でない宛先・鍵のない宛先には送らない");
ok(reported.length === 1 && reported[0].url.endsWith("/rest/v1/rpc/push_report_gone") && reported[0].body.p_endpoints.join() === "https://fcm.googleapis.com/fcm/send/gone-1",
   "使えなくなった宛先は DB に報告して消してもらう");
ok(endpointAllowed("https://updates.push.services.mozilla.com/wpush/v2/x") && !endpointAllowed("https://push.apple.com.evil.com/x") && !endpointAllowed("not a url"),
   "宛先の確認：似た名前の別ドメインは通さない");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
