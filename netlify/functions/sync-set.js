function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }

  const syncCode = String(body?.syncCode || "").trim();
  const progress = body?.progress;

  if (!syncCode || syncCode.length < 6) return json(400, { error: "Missing syncCode" });
  if (!progress || typeof progress !== "object") return json(400, { error: "Missing progress object" });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json(500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });

  try {
    const payload = [{ sync_code: syncCode, progress }];
    const resp = await fetch(`${url}/rest/v1/progress_sync?on_conflict=sync_code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": key,
        "authorization": `Bearer ${key}`,
        "Prefer": "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok) return json(502, { error: "Supabase upsert error", detail: data });
    return json(200, { ok: true, updated: true });
  } catch (e) {
    return json(500, { error: "Function exception", detail: String(e) });
  }
};
