function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }

  const password = String(body?.password || "").trim();
  const expected = String(process.env.WORDGARDEN_ADMIN_PASSWORD || "").trim();
  if (!expected) return json(500, { error: "Missing WORDGARDEN_ADMIN_PASSWORD" });
  if (!password || password !== expected) return json(401, { error: "Unauthorized" });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json(500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });

  try {
    const resp = await fetch(`${url}/rest/v1/profiles?select=profile_code,child_name,created_at&order=created_at.desc&limit=100`, {
      headers: { "apikey": key, "authorization": `Bearer ${key}` }
    });
    const data = await resp.json();
    if (!resp.ok) return json(502, { error: "Supabase error", detail: data });
    return json(200, { profiles: Array.isArray(data) ? data : [] });
  } catch (e) {
    return json(500, { error: "Function exception", detail: String(e) });
  }
};
