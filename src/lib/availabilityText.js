// ============================================================
// 面談の空き日程を、自由に書いた文から1時間ごとの枠に直す
//
//   例）「11月5日 13時〜17時 OK」 → 11/5 の 13:00・14:00・15:00・16:00
//       「11/6, 11/7 10-12時」     → 11/6 と 11/7 の 10:00・11:00
//       「11月8日 9時半〜12時」    → 10:00・11:00（枠は毎時ちょうどに始める）
//
//   ・面談はおよそ40分なので、枠は1時間ごと。終わりの時刻までに1時間とれる時刻だけを枠にする
//   ・年を書かなければ今年。今日より前の日付なら来年とみなす
//   ・過ぎた時刻の枠は作らない
//   ・時刻だけの行（「13時」）は、その時刻から1時間の枠を1つ作る
// ============================================================

const pad = (n) => String(n).padStart(2, "0");

// 全角の数字・記号を半角に。波線やダッシュの仲間は「~」にそろえる
function normalizeText(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/[〜～~―ー−–—‐]/g, "~")
    .replace(/から/g, "~")
    .replace(/まで/g, " ");
}

// 時刻の書き方：13 / 13時 / 13時半 / 13時30分 / 13:30
const TIME = String.raw`(\d{1,2})(?:\s*:\s*(\d{2})|\s*時\s*(半|(\d{1,2})\s*分)?)?`;
// 日付の書き方：2026年11月5日 / 2026/11/5 / 2026-11-05 / 11月5日 / 11/5（曜日の括弧は読み飛ばす）
//   年のない「11-5」は時間帯（11時〜5時）と紛れるので、日付としては読まない
const WEEKDAY = String.raw`(?:\s*[(（][^)）]*[)）])?`;
const DATE = String.raw`(\d{4})\s*[年/\-.]\s*(\d{1,2})\s*[月/\-.]\s*(\d{1,2})\s*日?${WEEKDAY}|(\d{1,2})\s*[月/]\s*(\d{1,2})\s*日?${WEEKDAY}`;

function toMinutes(h, mm, half, m2) {
  const hour = Number(h);
  let minute = 0;
  if (mm != null) minute = Number(mm);
  else if (half === "半") minute = 30;
  else if (m2 != null) minute = Number(m2);
  if (hour > 24 || minute > 59) return null;
  return hour * 60 + minute;
}

// 文を「日付」と「時間帯」の並びとして読む
function tokenize(text) {
  const re = new RegExp(`(${DATE})|(${TIME})(?:\\s*[~\\-]\\s*(${TIME}))?`, "g");
  const tokens = [];
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) {
      const withYear = m[2] != null;
      tokens.push({
        type: "date",
        year: withYear ? Number(m[2]) : null,
        month: Number(withYear ? m[3] : m[5]),
        day: Number(withYear ? m[4] : m[6]),
        raw: m[0],
      });
    } else {
      // 時刻の候補。「時」も「:」もなく、範囲にもなっていないただの数字は時刻とみなさない
      const startRaw = m[7];
      const hasEnd = m[12] != null;
      const looksLikeTime = /[時:]/.test(startRaw) || hasEnd;
      if (!looksLikeTime) continue;
      const start = toMinutes(m[8], m[9], m[10], m[11]);
      const end = hasEnd ? toMinutes(m[13], m[14], m[15], m[16]) : null;
      tokens.push({ type: "range", start, end, raw: m[0] });
    }
  }
  return tokens;
}

function resolveDate({ year, month, day }, now) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let y = year ?? now.getFullYear();
  let d = new Date(y, month - 1, day);
  if (d.getMonth() !== month - 1) return null; // 2月30日など
  if (year == null && d < today) {
    y += 1;
    d = new Date(y, month - 1, day);
    if (d.getMonth() !== month - 1) return null;
  }
  return `${y}-${pad(month)}-${pad(day)}`;
}

// 1つの時間帯を、毎時ちょうどに始まる1時間の枠に分ける
function hourlyStarts(start, end) {
  if (start == null) return [];
  if (end == null) {
    // 時刻だけ：その時刻から1時間（毎時ちょうどでなければ、そのままの時刻で1枠）
    return start + 60 <= 24 * 60 ? [start] : [];
  }
  const out = [];
  for (let t = Math.ceil(start / 60) * 60; t + 60 <= end; t += 60) out.push(t);
  return out;
}

/**
 * @param {string} text 自由に書いた空き日程
 * @param {Date} [now] 今の時刻（テスト用）
 * @returns {{ slots: string[], problems: string[] }}
 *   slots は "YYYY-MM-DD HH:MM" の並び（重複なし・時刻順）。problems は読めなかった部分の説明
 */
export function parseAvailabilityText(text, now = new Date()) {
  const problems = [];
  const found = new Set();
  const lines = normalizeText(text).split(/\n+/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const tokens = tokenize(line);
    let dates = []; // いま時間帯をあてはめる日付
    let datesUsed = false; // その日付に時間帯を1つでもあてはめたか
    const flushUnused = () => {
      if (dates.length && !datesUsed) problems.push(`${dates.map(shortDate).join("・")} の時間が書かれていません`);
    };
    for (const tk of tokens) {
      if (tk.type === "date") {
        if (datesUsed) {
          dates = [];
          datesUsed = false;
        }
        const ds = resolveDate(tk, now);
        if (!ds) problems.push(`「${tk.raw.trim()}」は日付として読めません`);
        else dates.push(ds);
        continue;
      }
      if (!dates.length) {
        problems.push(`「${tk.raw.trim()}」の日付が分かりません`);
        continue;
      }
      datesUsed = true;
      if (tk.start == null || (tk.end != null && tk.end <= tk.start) || (tk.end == null && tk.raw.includes("~"))) {
        problems.push(`「${tk.raw.trim()}」は時間として読めません`);
        continue;
      }
      const starts = hourlyStarts(tk.start, tk.end);
      if (!starts.length) {
        problems.push(`「${tk.raw.trim()}」は1時間に足りません`);
        continue;
      }
      for (const ds of dates) {
        for (const t of starts) {
          const dt = `${ds} ${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
          if (new Date(dt.replace(" ", "T")) <= now) continue; // 過ぎた時刻
          found.add(dt);
        }
      }
    }
    flushUnused();
  }
  return { slots: Array.from(found).sort(), problems };
}

function shortDate(ds) {
  const [, m, d] = ds.split("-").map(Number);
  return `${m}/${d}`;
}

// 枠の見出し用："2026-11-05 13:00" → "11/5(木) 13:00〜14:00"
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
export function slotLabel(dt) {
  const [ds, hm] = dt.split(" ");
  const [y, m, d] = ds.split("-").map(Number);
  const w = WEEK[new Date(y, m - 1, d).getDay()];
  const [h, mi] = hm.split(":").map(Number);
  const endH = h + 1;
  return `${m}/${d}(${w}) ${pad(h)}:${pad(mi)}〜${pad(endH)}:${pad(mi)}`;
}
