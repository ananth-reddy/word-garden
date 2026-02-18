// netlify/functions/list-words.js
function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

const CACHE_TTL_MS = 60 * 1000; // 60 sec
let cache = { ts: 0, data: null };

export default async (req) => {
  if (req.method !== "GET") return json(405, { error: "Method Not Allowed" });

  if (cache.data && (Date.now() - cache.ts) < CACHE_TTL_MS) return json(200, cache.data);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json(500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });

  try {
    const resp = await fetch(
      `${url}/rest/v1/words?select=id,word,level,definition,swedish,sentence,source,created_at&order=created_at.desc&limit=2000`,
      { headers: { "apikey": key, "authorization": `Bearer ${key}` } }
    );
    const data = await resp.json();
    if (!resp.ok) return json(502, { error: "Supabase error", detail: data });

    cache = { ts: Date.now(), data };
    return json(200, data);
  } catch (e) {
    return json(500, { error: "Function exception", detail: String(e) });
  }
};
