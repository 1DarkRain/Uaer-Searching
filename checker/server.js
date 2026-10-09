// سيرفر فحص يوزرات ديسكورد + يقدّم صفحة الموقع نفسها - Node.js 18+ بدون أي مكتبات
const http = require("http");
const fs = require("fs");
const path = require("path");
const PORT = process.env.PORT || 8080;
const ORIGIN = process.env.ALLOWED_ORIGIN || "*"; // ضع رابط موقعك هنا لحمايته
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// قواعد يوزر ديسكورد: 2-32 خانة، حروف صغيرة وأرقام و _ و . ولا نقطتين متتاليتين
const RULE = /^(?!.*\.\.)[a-z0-9_.]{2,32}$/;

let GAP = 300;      // فاصل بين بدايات الطلبات (ملّي ثانية)، يتكيّف تلقائيًا
let okStreak = 0;
let nextStart = 0;

// يرجع true = متاح، false = مأخوذ، ويرمي خطأ إذا ما قدر يتأكد
async function checkDiscord(u, tries = 0) {
  const r = await fetch("https://discord.com/api/v9/unique-username/username-attempt-unauthed", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ username: u }),
  });
  if (r.status === 429) {
    GAP = Math.min(GAP * 2, 3000); okStreak = 0;
    const j = await r.json().catch(() => ({}));
    if (tries < 2) {
      const w = Math.min(j.retry_after || 2, 10) * 1000;
      nextStart = Math.max(nextStart, Date.now() + w); // نوقف الباقي أيضًا طول المدة
      await sleep(w); // ننتظر المدة اللي يطلبها ديسكورد ونعيد
      return checkDiscord(u, tries + 1);
    }
    throw new Error("rate_limited");
  }
  if (!r.ok) throw new Error("http_" + r.status);
  const j = await r.json();
  if (typeof j.taken !== "boolean") throw new Error("bad_response");
  if (++okStreak % 20 === 0) GAP = Math.max(300, Math.round(GAP * 0.8));
  return !j.taken;
}

// جدولة: كل طلب يحجز موعد بدء (بفاصل GAP)، والطلبات تتداخل بدل ما تنتظر بعضها
async function run(fn) {
  const startAt = Math.max(Date.now(), nextStart);
  nextStart = startAt + GAP;
  const wait = startAt - Date.now();
  if (wait > 0) await sleep(wait);
  return fn();
}

function send(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
  });
  res.end(JSON.stringify(obj));
}

let PAGE = "";
try { PAGE = fs.readFileSync(path.join(__dirname, "index.html"), "utf8"); } catch {}

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method === "GET") {
    if (req.url.startsWith("/debug")) {
      const u = (new URL(req.url, "http://x").searchParams.get("username") || "abcd12").toLowerCase();
      try {
        const r = await fetch("https://discord.com/api/v9/unique-username/username-attempt-unauthed", {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": UA },
          body: JSON.stringify({ username: u }),
        });
        return send(res, 200, { username: u, status: r.status, body: (await r.text()).slice(0, 600) });
      } catch (e) { return send(res, 200, { username: u, error: String(e && e.cause ? e.cause.code || e.cause.message : e.message) }); }
    }
    if (req.url === "/health" || !PAGE) return send(res, 200, { ok: true });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(PAGE);
  }
  if (req.method !== "POST") return send(res, 405, { error: "method" });

  let body = "";
  for await (const c of req) { body += c; if (body.length > 2000) return send(res, 413, { error: "too_big" }); }
  let username;
  try { ({ username } = JSON.parse(body)); } catch { return send(res, 400, { error: "bad_json" }); }

  username = String(username || "").toLowerCase();
  if (!RULE.test(username)) return send(res, 200, { available: false, reason: "invalid_for_discord" });

  try {
    const available = await run(() => checkDiscord(username));
    send(res, 200, { available, confidence: "high" });
  } catch (e) {
    send(res, 200, { available: null, error: e.message });
  }
}).listen(PORT, () => console.log("discord checker on " + PORT));
