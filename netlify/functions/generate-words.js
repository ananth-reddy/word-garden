// netlify/functions/generate-words.js
import crypto from "crypto";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const MAX_TOKENS_GUARD = 700;

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE = new Map();

const RATE = { perMinute: 6, perDay: 40 };
const RL = new Map();

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

function getIP(req) {
  return (
    req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

function rateLimit(ip) {
  const now = Date.now();
  const dayKey = new Date().toISOString().slice(0, 10);
  const cur = RL.get(ip) || { dayKey, dayCount: 0, minute: [] };

  if (cur.dayKey !== dayKey) {
    cur.dayKey = dayKey;
    cur.dayCount = 0;
    cur.minute = [];
  }

  cur.minute = cur.minute.filter((t) => now - t < 60 * 1000);
  if (cur.minute.length >= RATE.perMinute) {
    RL.set(ip, cur);
    return { ok: false, retryAfterSec: 60 - Math.floor((now - cur.minute[0]) / 1000) };
  }
  if (cur.dayCount >= RATE.perDay) {
    RL.set(ip, cur);
    return { ok: false, retryAfterSec: 60 * 60 };
  }

  cur.minute.push(now);
  cur.dayCount += 1;
  RL.set(ip, cur);
  return { ok: true };
}

function cacheKey(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}
function cacheGet(key) {
  const v = CACHE.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > CACHE_TTL_MS) { CACHE.delete(key); return null; }
  return v.data;
}
function cacheSet(key, data) { CACHE.set(key, { ts: Date.now(), data }); }

function checkPassword(password) {
  const secret = process.env.WORDGARDEN_ADMIN_PASSWORD;
  if (!secret) return { ok: false, status: 500, msg: "Missing WORDGARDEN_ADMIN_PASSWORD env var" };
  if (!password || String(password) !== String(secret)) return { ok: false, status: 401, msg: "Unauthorized" };
  return { ok: true };
}

async function supabaseUpsert(words) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const resp = await fetch(`${url}/rest/v1/words`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": key,
      "authorization": `Bearer ${key}`,
      "Prefer": "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(words)
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error("Supabase upsert error: " + JSON.stringify(data).slice(0, 500));
  return data;
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

  const ip = getIP(req);
  const rl = rateLimit(ip);
  if (!rl.ok) {
    return new Response(JSON.stringify({ error: "Rate limited" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": String(rl.retryAfterSec || 60) }
    });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return json(500, { error: "Missing ANTHROPIC_API_KEY env var" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }

  const pw = checkPassword(body?.password);
  if (!pw.ok) return json(pw.status, { error: pw.msg });

  const mode = body?.mode || "generate";
  const level = Number(body?.level ?? 1);
  const existingWords = Array.isArray(body?.existingWords) ? body.existingWords : [];

  if (mode !== "generate") return json(400, { error: "Only 'generate' supported" });
  if (![1,2,3].includes(level)) return json(400, { error: "level must be 1, 2, or 3" });

  const safeExisting = existingWords.map(w => String(w||"").trim().toLowerCase()).filter(Boolean).slice(0, 200);

  const levelDesc =
    level === 1 ? "easy (A1–A2 kid-friendly)" :
    level === 2 ? "intermediate (B1-ish for a motivated 10-year-old)" :
    "advanced (B2-ish, still kid-appropriate)";

  const prompt = `Generate 12 English vocabulary words at ${levelDesc}. Avoid these words: ${safeExisting.join(", ")}.
Return ONLY valid JSON array (no markdown). Each item must be:
{"word":"...","definition":"(max 12 words)","swedish":"...","sentence":"The ___ ...","level":${level}}
Make sure the sentence uses ___ as placeholder exactly once.`;

  const ck = cacheKey({ level, safeExisting, promptV: 1 });
  const cached = cacheGet(ck);
  if (cached) return json(200, cached);

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS_GUARD,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await resp.json();
    if (!resp.ok) return json(502, { error: "Anthropic error", detail: data });

    const text = (data.content || []).map(c => c.text || "").join("");
    const cleaned = String(text).replace(/```json|```/g, "").trim();

    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch { return json(502, { error: "Model returned non-JSON", raw: cleaned.slice(0, 2000) }); }

    if (!Array.isArray(parsed)) return json(502, { error: "Unexpected model output", raw: cleaned.slice(0, 2000) });

    const out = parsed.map(x => ({
      word: String(x.word || "").trim(),
      level: Number(x.level || level),
      definition: String(x.definition || "").trim(),
      swedish: String(x.swedish || "").trim(),
      sentence: String(x.sentence || "").trim(),
      source: "ai"
    })).filter(x => x.word && x.definition && x.swedish && x.sentence);

    const saved = await supabaseUpsert(out);
    cacheSet(ck, saved);
    return json(200, saved);
  } catch (e) {
    return json(500, { error: "Function exception", detail: String(e) });
  }
};
