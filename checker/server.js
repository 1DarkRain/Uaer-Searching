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

// يرجع true = متاح، false = مأخوذ، ويرمي خطأ إذا ما قدر يتأكد
async function checkDiscord(u, tries = 0) {
  const r = await fetch("https://discord.com/api/v9/unique-username/username-attempt-unauthed", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ username: u }),
  });
  if (r.status === 429) {
    const j = await r.json().catch(() => ({}));
    if (tries < 2) {
      await sleep(Math.min(j.retry_after || 2, 10) * 1000); // ننتظر المدة اللي يطلبها ديسكورد ونعيد
      return checkDiscord(u, tries + 1);
    }
    throw new Error("rate_limited");
  }
  if (!r.ok) throw new Error("http_" + r.status);
  const j = await r.json();
  if (typeof j.taken !== "boolean") throw new Error("bad_response");
  return !j.taken;
}

// طابور واحد مع فاصل زمني عشان ما يوقفك ديسكورد
const GAP = 1000;
let last = 0;
let chain = Promise.resolve();
function run(fn) {
  const job = chain.then(async () => {
    const wait = Math.max(0, last + GAP - Date.now());
    if (wait) await sleep(wait);
    try { return await fn(); } finally { last = Date.now(); }
  });
  chain = job.catch(() => {});
  return job;
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
