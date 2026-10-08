// سيرفر فحص اليوزرات - Node.js 18+ بدون أي مكتبات
const http = require("http");
const PORT = process.env.PORT || 8080;
const ORIGIN = process.env.ALLOWED_ORIGIN || "*"; // ضع رابط موقعك هنا لحمايته
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const RULES = {
  discord: /^(?!.*\.\.)[a-z0-9_.]{2,32}$/,
  instagram: /^[a-z0-9._]{1,30}$/,
  snapchat: /^[a-z][a-z0-9._-]{1,13}[a-z0-9]$/,
};

// يرجع true = متاح، false = مأخوذ، ويرمي خطأ إذا ما قدر يتأكد
const checkers = {
  async discord(u) {
    const r = await fetch("https://discord.com/api/v9/unique-username/username-attempt-unauthed", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ username: u }),
    });
    if (r.status === 429) throw new Error("rate_limited");
    if (!r.ok) throw new Error("http_" + r.status);
    const j = await r.json();
    if (typeof j.taken !== "boolean") throw new Error("bad_response");
    return !j.taken;
  },
  async snapchat(u) {
    const r = await fetch("https://www.snapchat.com/add/" + encodeURIComponent(u), {
      headers: { "User-Agent": UA, "Accept-Language": "en" },
    });
    if (r.status === 404) return true;
    if (r.status === 200) return false;
    if (r.status === 429) throw new Error("rate_limited");
    throw new Error("http_" + r.status);
  },
  async instagram(u) {
    const r = await fetch("https://www.instagram.com/" + encodeURIComponent(u) + "/", {
      headers: { "User-Agent": UA, "Accept-Language": "en" },
    });
    if (r.status === 404) return true;
    if (r.status === 429) throw new Error("rate_limited");
    if (r.status === 200) {
      if (r.url.includes("/accounts/login")) throw new Error("login_wall");
      const t = (await r.text()).toLowerCase();
      if (t.includes("(@" + u + ")")) return false;
      throw new Error("unclear");
    }
    throw new Error("http_" + r.status);
  },
};

// طابور لكل منصة مع فاصل زمني عشان ما ينحظر السيرفر
const gap = { discord: 1000, instagram: 2500, snapchat: 800 };
const last = {};
const chain = { discord: Promise.resolve(), instagram: Promise.resolve(), snapchat: Promise.resolve() };
function run(p, fn) {
  const job = chain[p].then(async () => {
    const wait = Math.max(0, (last[p] || 0) + gap[p] - Date.now());
    if (wait) await sleep(wait);
    try { return await fn(); } finally { last[p] = Date.now(); }
  });
  chain[p] = job.catch(() => {});
  return job;
}

function send(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(obj));
}

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method === "GET") return send(res, 200, { ok: true });
  if (req.method !== "POST") return send(res, 405, { error: "method" });

  let body = "";
  for await (const c of req) { body += c; if (body.length > 2000) return send(res, 413, { error: "too_big" }); }
  let platform, username;
  try { ({ platform, username } = JSON.parse(body)); } catch { return send(res, 400, { error: "bad_json" }); }

  username = String(username || "").toLowerCase();
  if (!checkers[platform]) return send(res, 400, { error: "bad_platform" });
  if (!RULES[platform].test(username)) return send(res, 200, { available: false, reason: "invalid_for_platform" });

  try {
    const available = await run(platform, () => checkers[platform](username));
    send(res, 200, { available });
  } catch (e) {
    send(res, 200, { available: null, error: e.message });
  }
}).listen(PORT, () => console.log("checker on " + PORT));
