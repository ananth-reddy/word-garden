
import React, { useEffect, useRef, useState } from "react";
import "./styles.css";

const BUILD_ID = "20260217-230536";

// ---------- storage ----------
const STORAGE_KEY = "wordgarden_progress_v5";
const loadProgress = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const saveProgress = (p) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch {}
};
const freshProgress = () => ({
  masteredIds: [],
  seenIds: [],
  currentLevel: 1,
  streak: 0,
  lastDate: null,
});
const todayStr = () => new Date().toISOString().slice(0, 10);

// ---------- api ----------
async function apiListWords() {
  const res = await fetch("/.netlify/functions/list-words");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to load shared words");
  return Array.isArray(data) ? data : [];
}

async function apiGenerateWords({ level, existingWords, password }) {
  const res = await fetch("/.netlify/functions/generate-words", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "generate", level, existingWords, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Generate failed");
  return data;
}

// ---------- ui primitives ----------
const S = {
  page: { minHeight: "100vh", display: "flex", justifyContent: "center", padding: "18px 14px" },
  container: { width: "100%", maxWidth: 560 },
  card: { background: "#fff", borderRadius: 20, padding: "22px 20px", boxShadow: "0 2px 20px rgba(0,0,0,0.06)" },
  title: { fontFamily: "'DM Serif Display',serif", fontSize: 36, color: "#2d5a3d", letterSpacing: "-0.01em", margin: 0 },
  subtitle: { fontSize: 15, color: "#7a9a82", marginTop: 6, lineHeight: 1.5 },
  small: { fontSize: 12, color: "#7a9a82", lineHeight: 1.5 },
  qlabel: { fontSize: 12, color: "#aabfae", textTransform: "uppercase", letterSpacing: "0.10em", fontWeight: 600 },
  primaryBtn: { width: "100%", border: "none", borderRadius: 14, padding: "14px 16px", fontSize: 15, fontWeight: 700, cursor: "pointer", background: "#2d5a3d", color: "#fff", boxShadow: "0 8px 18px rgba(45,90,61,0.18)", marginTop: 10 },
  secondaryBtn: { width: "100%", border: "1px solid #dbe6dd", borderRadius: 14, padding: "13px 16px", fontSize: 15, fontWeight: 700, cursor: "pointer", background: "#fff", color: "#2d5a3d", marginTop: 10 },
  linkBtn: { border: "none", background: "transparent", color: "#2d5a3d", fontWeight: 700, cursor: "pointer", padding: "8px 10px", borderRadius: 10 },
  input: { width: "100%", border: "1px solid #dbe6dd", borderRadius: 14, padding: "14px 14px", fontSize: 15, outline: "none" },
  badge: { textAlign: "center", padding: "10px 0", background: "#f5f7f5", borderRadius: 12, flex: 1 },
};

function Badge({ label, value }) {
  return (
    <div style={S.badge}>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#2d5a3d", fontFamily: "'DM Serif Display',serif" }}>{value}</div>
      <div style={{ fontSize: 10, color: "#7a9a82", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
    </div>
  );
}

function Card({ children }) {
  return <div style={S.card}>{children}</div>;
}

function LockButton({ onTap }) {
  return (
    <button
      onClick={onTap}
      title="Admin"
      style={{
        border: "none",
        background: "#f5f7f5",
        borderRadius: 10,
        padding: "6px 10px",
        cursor: "pointer",
        fontWeight: 800,
        color: "#2d5a3d",
      }}
    >
      🔒
    </button>
  );
}

function Home({ prog, sharedCount, onProgress }) {
  return (
    <div style={S.page}>
      <div style={S.container}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 52, marginBottom: 8 }}>🌿</div>
          <h1 style={S.title}>Word Garden</h1>
          <p style={S.subtitle}>
            Clean & focused vocabulary practice. <span style={{ fontSize: 12 }}>Build {BUILD_ID}</span>
          </p>
        </div>

        <Card>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <Badge label="Streak" value={`${prog.streak}🔥`} />
            <Badge label="Seen" value={`${prog.seenIds.length}`} />
            <Badge label="Level" value={`L${prog.currentLevel}`} />
          </div>

          <p style={S.small}>
            Shared words available: <b>{sharedCount}</b>
          </p>

          <button onClick={onProgress} style={S.primaryBtn}>Progress</button>
        </Card>

        <p style={{ ...S.small, textAlign: "center", marginTop: 18 }}>
          Tip: Safari → Share → <b>Add to Home Screen</b>
        </p>
      </div>
    </div>
  );
}

function Progress({ prog, shared, onBack }) {
  const [tapCount, setTapCount] = useState(0);
  const [adminRevealed, setAdminRevealed] = useState(false);

  const [password, setPassword] = useState(() => sessionStorage.getItem("wg_admin_pw") || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const tapTimer = useRef(null);

  const onLockTap = () => {
    setTapCount((c) => {
      const next = c + 1;
      if (next === 1) {
        if (tapTimer.current) clearTimeout(tapTimer.current);
        tapTimer.current = setTimeout(() => setTapCount(0), 2000);
      }
      if (next >= 3) {
        if (tapTimer.current) clearTimeout(tapTimer.current);
        setAdminRevealed(true);
        return 0;
      }
      return next;
    });
  };

  const savePw = () => {
    sessionStorage.setItem("wg_admin_pw", password);
    setMsg("Password saved for this tab. Now click Generate to verify.");
  };

  const doGenerate = async () => {
    if (!password.trim()) return alert("Enter admin password first.");
    setBusy(true);
    setMsg("");
    try {
      const existing = shared.map((w) => w.word);
      const out = await apiGenerateWords({ level: prog.currentLevel, existingWords: existing, password });
      setMsg(`Generated and saved ${out.length} words.`);
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.page}>
      <div style={S.container}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 22, color: "#2d5a3d", margin: 0 }}>Progress</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <LockButton onTap={onLockTap} />
              <button onClick={onBack} style={S.linkBtn}>Back</button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <Badge label="Mastered" value={`${prog.masteredIds.length}`} />
            <Badge label="Seen" value={`${prog.seenIds.length}`} />
            <Badge label="Level" value={`L${prog.currentLevel}`} />
          </div>

          <p style={S.small}>
            Shared words available: <b>{shared.length}</b>
          </p>
          <p style={{ ...S.small, marginTop: 6 }}>
            Build: <b>{BUILD_ID}</b>
          </p>

          {adminRevealed && (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #eef2ef" }}>
              <p style={{ ...S.qlabel, marginBottom: 8 }}>Admin</p>
              <p style={S.small}>Tap 🔒 3 times to reveal. Password is checked server-side.</p>

              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Admin password"
                style={{ ...S.input, marginTop: 10 }}
              />
              <button onClick={savePw} style={S.secondaryBtn} disabled={!password.trim()}>Save password</button>
              <button onClick={doGenerate} style={S.primaryBtn} disabled={busy || !password.trim()}>
                {busy ? "Working…" : "Generate words now"}
              </button>

              {msg && (
                <p style={{ ...S.small, marginTop: 10 }}>
                  <b>Status:</b> {msg}
                </p>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function App() {
  const [prog, setProg] = useState(() => loadProgress() || freshProgress());
  const [shared, setShared] = useState([]);
  const [view, setView] = useState("loading");
  const [err, setErr] = useState("");

  useEffect(() => {
    const t = todayStr();
    if (prog.lastDate !== t) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const newStreak = prog.lastDate === yesterday ? prog.streak + 1 : 1;
      const next = { ...prog, lastDate: t, streak: newStreak };
      setProg(next);
      saveProgress(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const words = await apiListWords();
        setShared(words);
      } catch (e) {
        setErr(String(e?.message || e));
        setShared([]);
      } finally {
        setView("home");
      }
    })();
  }, []);

  useEffect(() => {
    saveProgress(prog);
  }, [prog]);

  if (view === "loading") {
    return (
      <div style={S.page}>
        <div style={S.container}>
          <Card>
            <p style={S.subtitle}>Loading…</p>
          </Card>
        </div>
      </div>
    );
  }

  if (view === "progress") {
    return <Progress prog={prog} shared={shared} onBack={() => setView("home")} />;
  }

  return (
    <>
      <Home prog={prog} sharedCount={shared.length} onProgress={() => setView("progress")} />
      {err && (
        <div style={{ position: "fixed", left: 12, right: 12, bottom: 12 }}>
          <div style={{ ...S.card, padding: 14, borderLeft: "6px solid #c85" }}>
            <p style={{ margin: 0, fontWeight: 800, color: "#5a2d2d" }}>Connection warning</p>
            <p style={{ margin: "6px 0 0 0", ...S.small, color: "#5a2d2d" }}>{err}</p>
          </div>
        </div>
      )}
    </>
  );
}
