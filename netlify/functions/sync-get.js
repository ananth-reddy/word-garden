function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }

  const syncCode = String(body?.syncCode || "").trim();
  if (!syncCode || syncCode.length < 6) return json(400, { error: "Missing syncCode" });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json(500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });

  try {
    const resp = await fetch(`${url}/rest/v1/progress_sync?select=sync_code,progress,updated_at&sync_code=eq.${encodeURIComponent(syncCode)}&limit=1`, {
      headers: { "apikey": key, "authorization": `Bearer ${key}` }
    });
    const data = await resp.json();
    if (!resp.ok) return json(502, { error: "Supabase error", detail: data });
    if (!Array.isArray(data) || data.length === 0) return json(200, { found: false });
    return json(200, { found: true, progress: data[0].progress, updated_at: data[0].updated_at });
  } catch (e) {
    return json(500, { error: "Function exception", detail: String(e) });
  }
};
