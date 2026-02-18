import React, { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";

const BUILD_ID = "20260218-000818";

// ---------- storage ----------
const STORAGE_KEY = "wordgarden_progress_v6";

const freshProgress = () => ({
  wordStats: {}, // key -> { seen, correct, wrong, mastered, nextReviewAt }
  currentLevel: 1,
  streak: 0,
  lastDate: null,
  accuracy: { correct: 0, total: 0 },
  placementDone: false,
});

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
const todayStr = () => new Date().toISOString().slice(0, 10);

function wordKey(w) {
  return (w?.id != null) ? String(w.id) : String(w.word);
}

// ---------- API ----------
async function apiListWords() {
  const res = await fetch("/.netlify/functions/list-words");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to load words");
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

// ---------- helpers ----------
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sample(arr, n) { return shuffle(arr).slice(0, n); }

function computeAccuracy(acc) {
  const total = acc.total || 0;
  if (!total) return 0;
  return Math.round((acc.correct / total) * 100);
}

function getDueReviewWords(words, prog) {
  const now = Date.now();
  const due = [];
  for (const w of words) {
    const k = wordKey(w);
    const s = prog.wordStats?.[k];
    if (!s) continue;
    if (s.mastered) continue;
    if (s.nextReviewAt && s.nextReviewAt <= now) due.push(w);
  }
  return due;
}

function getUnseenWords(words, prog, level) {
  const out = [];
  for (const w of words) {
    if (Number(w.level) !== Number(level)) continue;
    const k = wordKey(w);
    if (!prog.wordStats?.[k]) out.push(w);
  }
  return out;
}

function scheduleNextReview(stat) {
  const c = stat.correct || 0;
  const days = c >= 6 ? 14 : c >= 4 ? 7 : c >= 2 ? 2 : 1;
  return Date.now() + days * 24 * 60 * 60 * 1000;
}

// ---------- UI components ----------
function Card({ children }) { return <div className="card">{children}</div>; }

function Badge({ label, value }) {
  return (
    <div className="badge">
      <div className="badgeVal">{value}</div>
      <div className="badgeLab">{label}</div>
    </div>
  );
}

function Toast({ text }) {
  if (!text) return null;
  return (
    <div className="toastWrap">
      <div className="toast">
        <div style={{ fontWeight: 900, color: "#5a2d2d" }}>Note</div>
        <div className="small" style={{ color: "#5a2d2d", marginTop: 6 }}>{text}</div>
      </div>
    </div>
  );
}

function Home({ prog, sharedCount, onStartPractice, onPlacement, onSkipPlacement, onWords, onProgress }) {
  const accuracy = computeAccuracy(prog.accuracy);
  const mastered = Object.values(prog.wordStats || {}).filter(s => s.mastered).length;

  return (
    <div className="page">
      <div className="container">
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 52, marginBottom: 8 }}>🌿</div>
          <div className="title">Word Garden</div>
          <div className="subtitle">Grow your English vocabulary <span className="small">· Build {BUILD_ID}</span></div>
        </div>

        <Card>
          <div className="row" style={{ marginBottom: 14 }}>
            <Badge label="Mastered" value={mastered} />
            <Badge label="Streak" value={`${prog.streak}d`} />
            <Badge label="Accuracy" value={`${accuracy}%`} />
          </div>

          <div className="small" style={{ marginTop: 4 }}>
            Progress — {mastered} of {sharedCount} words mastered
          </div>
          <div style={{ height: 8, background: "#eef2ef", borderRadius: 999, marginTop: 10, overflow: "hidden" }}>
            <div style={{ width: `${sharedCount ? Math.round((mastered/sharedCount)*100) : 0}%`, height: "100%", background: "#2d5a3d" }} />
          </div>

          {!prog.placementDone ? (
            <>
              <div style={{ background: "#eaf6ea", borderRadius: 16, padding: 14, marginTop: 14 }}>
                <div style={{ fontWeight: 900, color: "#2d5a3d" }}>Start with a placement test</div>
                <div className="small" style={{ marginTop: 6 }}>
                  A quick 10-question test finds the right starting level for you.
                </div>
              </div>
              <button className="btnPrimary" onClick={onPlacement}>Take Placement Test →</button>
              <button className="btnSecondary" onClick={onSkipPlacement}>Skip — Start at Level 1</button>
            </>
          ) : (
            <>
              <button className="btnPrimary" onClick={onStartPractice}>Start Practice</button>
              <button className="btnSecondary" onClick={onWords}>Word list</button>
              <button className="btnGhost" onClick={onProgress}>Progress</button>
              <div className="small" style={{ marginTop: 12 }}>
                Shared words available: <b>{sharedCount}</b>
              </div>
            </>
          )}
        </Card>

        <div className="small" style={{ textAlign: "center", marginTop: 16 }}>
          Tip: Safari → Share → <b>Add to Home Screen</b>
        </div>
      </div>
    </div>
  );
}

function WordsScreen({ words, onBack }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return words;
    return words.filter(w =>
      String(w.word).toLowerCase().includes(s) ||
      String(w.definition||"").toLowerCase().includes(s) ||
      String(w.swedish||"").toLowerCase().includes(s)
    );
  }, [words, q]);

  const byLevel = useMemo(() => {
    const m = { 1: [], 2: [], 3: [] };
    for (const w of filtered) {
      const L = Number(w.level)||1;
      if (!m[L]) m[L] = [];
      m[L].push(w);
    }
    return m;
  }, [filtered]);

  const Row = ({ w }) => (
    <div style={{ padding: "12px 0", borderBottom: "1px solid #eef2ef" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:10 }}>
        <div style={{ fontWeight: 900, color:"#2d5a3d", fontSize: 16 }}>{w.word}</div>
        <span className="pill">L{w.level}</span>
      </div>
      <div className="small" style={{ marginTop: 6 }}><b>Meaning:</b> {w.definition}</div>
      <div className="small" style={{ marginTop: 4 }}><b>Swedish:</b> {w.swedish}</div>
      <div className="small" style={{ marginTop: 4 }}><b>Sentence:</b> {w.sentence}</div>
    </div>
  );

  return (
    <div className="page">
      <div className="container">
        <Card>
          <div className="topbar">
            <div className="h2">Word list</div>
            <button className="iconBtn" onClick={onBack}>Back</button>
          </div>

          <div className="hr" />

          <input className="input" value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search word, meaning, or Swedish…" />

          <div className="small" style={{ marginTop: 10 }}>
            Showing <b>{filtered.length}</b> words
          </div>

          <div className="hr" />

          {[1,2,3].map(L => (
            <div key={L} style={{ marginTop: 6 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                <div style={{ fontWeight: 900, color:"#2d5a3d" }}>Level {L}</div>
                <div className="small">{byLevel[L]?.length || 0}</div>
              </div>
              <div style={{ marginTop: 8 }}>
                {(byLevel[L] || []).slice(0, 300).map(w => <Row key={wordKey(w)} w={w} />)}
                {(byLevel[L] || []).length > 300 && (
                  <div className="small" style={{ paddingTop: 10 }}>Showing first 300. Refine search to see more.</div>
                )}
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function Placement({ words, onDone, onBack }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [quiz, setQuiz] = useState([]);

  useEffect(() => {
    const L1 = words.filter(w => Number(w.level)===1);
    const L2 = words.filter(w => Number(w.level)===2);
    const L3 = words.filter(w => Number(w.level)===3);
    const q = [
      ...sample(L1, 4).map(w => ({ w, level:1 })),
      ...sample(L2, 3).map(w => ({ w, level:2 })),
      ...sample(L3, 3).map(w => ({ w, level:3 })),
    ].filter(x => x.w && x.w.definition);

    const built = q.slice(0,10).map(({w, level}) => {
      const pool = words.filter(x => x.definition && x.word && x.word !== w.word);
      const wrongs = sample(pool, 3).map(x => x.word);
      const choices = shuffle([w.word, ...wrongs]);
      return { level, prompt: w.definition, answer: w.word, choices };
    });
    setQuiz(built);
  }, [words]);

  const current = quiz[step];

  const scoreByLevel = useMemo(() => {
    const s = {1:{c:0,t:0},2:{c:0,t:0},3:{c:0,t:0}};
    for (const a of answers) {
      s[a.level].t += 1;
      if (a.correct) s[a.level].c += 1;
    }
    return s;
  }, [answers]);

  const finish = () => {
    let level = 1;
    for (const L of [1,2,3]) {
      const t = scoreByLevel[L].t || 0;
      const c = scoreByLevel[L].c || 0;
      if (t > 0 && (c / t) >= 0.7) level = L;
    }
    onDone(level);
  };

  if (!quiz.length) {
    return (
      <div className="page"><div className="container"><Card>
        <div className="topbar"><div className="h2">Placement test</div><button className="iconBtn" onClick={onBack}>Back</button></div>
        <div className="hr" />
        <div className="small">Not enough words loaded yet to run the test.</div>
      </Card></div></div>
    );
  }

  if (!current) {
    return (
      <div className="page"><div className="container"><Card>
        <div className="topbar"><div className="h2">Placement result</div><button className="iconBtn" onClick={onBack}>Back</button></div>
        <div className="hr" />
        <button className="btnPrimary" onClick={finish}>See result</button>
      </Card></div></div>
    );
  }

  const choose = (choice) => {
    const correct = choice === current.answer;
    setAnswers(a => [...a, { level: current.level, correct }]);
    setStep(s => s + 1);
  };

  return (
    <div className="page">
      <div className="container">
        <Card>
          <div className="topbar">
            <div className="h2">Placement test</div>
            <button className="iconBtn" onClick={onBack}>Back</button>
          </div>

          <div className="small" style={{ marginTop: 8 }}>
            Question {step + 1} / {quiz.length}
          </div>

          <div className="hr" />

          <div className="small" style={{ color:"#2d5a3d", fontWeight: 900 }}>What word matches this meaning?</div>
          <div style={{ marginTop: 10, fontSize: 18, fontWeight: 800, color:"#2d5a3d" }}>
            “{current.prompt}”
          </div>

          <div style={{ marginTop: 6 }}>
            {current.choices.map(c => (
              <button key={c} className="choice" onClick={() => choose(c)}>{c}</button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Practice({ words, prog, setProg, onBack }) {
  const [session, setSession] = useState(null);
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState("intro");
  const [answerText, setAnswerText] = useState("");
  const [feedback, setFeedback] = useState("");

  const pool = useMemo(() => {
    const level = prog.currentLevel || 1;
    const due = getDueReviewWords(words, prog);
    const unseen = getUnseenWords(words, prog, level);
    const duePick = sample(due, Math.min(3, due.length));
    const unseenPick = sample(unseen, Math.min(5, unseen.length));
    return shuffle([...duePick, ...unseenPick]).slice(0, 8);
  }, [words, prog]);

  useEffect(() => {
    setSession(pool);
    setIdx(0);
    setMode("intro");
    setAnswerText("");
    setFeedback("");
  }, [pool.length]);

  const current = session?.[idx];

  const bumpAccuracy = (correct) => {
    setProg(p => ({
      ...p,
      accuracy: {
        correct: (p.accuracy?.correct || 0) + (correct ? 1 : 0),
        total: (p.accuracy?.total || 0) + 1,
      }
    }));
  };

  const updateWordStat = (w, correct) => {
    setProg(p => {
      const k = wordKey(w);
      const prev = p.wordStats?.[k] || { seen:0, correct:0, wrong:0, mastered:false, nextReviewAt:0 };
      const nextStat = {
        ...prev,
        seen: prev.seen + 1,
        correct: prev.correct + (correct ? 1 : 0),
        wrong: prev.wrong + (correct ? 0 : 1),
      };
      const total = nextStat.correct + nextStat.wrong;
      const pct = total ? (nextStat.correct/total) : 0;
      if (nextStat.correct >= 4 && pct >= 0.8) nextStat.mastered = true;
      nextStat.nextReviewAt = scheduleNextReview(nextStat);

      return { ...p, wordStats: { ...(p.wordStats || {}), [k]: nextStat } };
    });
  };

  const question = useMemo(() => {
    if (!current) return null;
    const types = ["mcq", "type_def", "fill_blank", "sv_to_en"];
    const t = types[(idx + (prog.streak||0)) % types.length];

    if (t === "mcq") {
      const poolWords = words.filter(x => x.word && x.word !== current.word);
      const wrongs = sample(poolWords, 3).map(x => x.word);
      const choices = shuffle([current.word, ...wrongs]);
      return { type: "mcq", prompt: current.definition, choices, answer: current.word, help: "Choose the correct word." };
    }
    if (t === "type_def") return { type: "type_def", prompt: current.definition, answer: current.word, help: "Type the word that matches the meaning." };
    if (t === "fill_blank") return { type: "fill_blank", prompt: current.sentence, answer: current.word, help: "Type the missing word." };
    return { type: "sv_to_en", prompt: current.swedish, answer: current.word, help: "Translate Swedish → English." };
  }, [current, idx, words, prog.streak]);

  const nextWord = () => {
    setFeedback("");
    setAnswerText("");
    if (!session) return;
    if (idx + 1 >= session.length) setMode("done");
    else { setIdx(i => i + 1); setMode("intro"); }
  };

  const submit = (val) => {
    const guess = String(val || answerText || "").trim().toLowerCase();
    const truth = String(question.answer).trim().toLowerCase();
    const correct = guess === truth;

    bumpAccuracy(correct);
    updateWordStat(current, correct);
    setFeedback(correct ? "✅ Correct!" : `❌ Not quite. Correct: ${question.answer}`);
    setTimeout(() => nextWord(), 900);
  };

  if (!session || !session.length) {
    return (
      <div className="page"><div className="container"><Card>
        <div className="topbar"><div className="h2">Practice</div><button className="iconBtn" onClick={onBack}>Back</button></div>
        <div className="hr" />
        <div className="small">No words available for this level yet.</div>
      </Card></div></div>
    );
  }

  if (mode === "done") {
    return (
      <div className="page"><div className="container"><Card>
        <div className="topbar"><div className="h2">Nice work</div><button className="iconBtn" onClick={onBack}>Back</button></div>
        <div className="hr" />
        <div className="small">Practice session complete.</div>
        <button className="btnPrimary" onClick={onBack}>Done</button>
      </Card></div></div>
    );
  }

  if (!current) return null;

  return (
    <div className="page">
      <div className="container">
        <Card>
          <div className="topbar">
            <div className="h2">Practice</div>
            <button className="iconBtn" onClick={onBack}>Back</button>
          </div>

          <div className="small" style={{ marginTop: 8 }}>
            Word {idx + 1} / {session.length} <span className="pill" style={{ marginLeft: 8 }}>L{current.level}</span>
          </div>

          <div className="hr" />

          {mode === "intro" ? (
            <>
              <div style={{ fontWeight: 900, color:"#2d5a3d", fontSize: 22 }}>{current.word}</div>
              <div className="small" style={{ marginTop: 6 }}><b>Meaning:</b> {current.definition}</div>
              <div className="small" style={{ marginTop: 6 }}><b>Swedish:</b> {current.swedish}</div>
              <div className="small" style={{ marginTop: 6 }}><b>Sentence:</b> {current.sentence}</div>
              <button className="btnPrimary" onClick={() => { setMode("question"); setFeedback(""); setAnswerText(""); }}>
                Start question →
              </button>
            </>
          ) : (
            <>
              <div className="small" style={{ color:"#2d5a3d", fontWeight: 900 }}>{question.help}</div>
              <div style={{ marginTop: 10, fontSize: 18, fontWeight: 800, color:"#2d5a3d" }}>
                {question.type === "fill_blank" ? question.prompt : `“${question.prompt}”`}
              </div>

              {question.type === "mcq" ? (
                <div style={{ marginTop: 6 }}>
                  {question.choices.map(c => (
                    <button key={c} className="choice" onClick={() => submit(c)}>{c}</button>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <input
                    className="input"
                    value={answerText}
                    onChange={(e)=>setAnswerText(e.target.value)}
                    placeholder="Type your answer…"
                    autoCapitalize="none"
                    autoCorrect="off"
                    onKeyDown={(e)=>{ if (e.key === "Enter") submit(); }}
                  />
                  <button className="btnPrimary" onClick={() => submit()}>Check</button>
                  <button className="btnSecondary" onClick={() => submit(question.answer)}>Show answer</button>
                </div>
              )}

              {feedback && <div className="small" style={{ marginTop: 10, fontWeight: 900, color:"#2d5a3d" }}>{feedback}</div>}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function Progress({ prog, shared, onBack, onRefreshShared }) {
  const [adminRevealed, setAdminRevealed] = useState(false);
  const [password, setPassword] = useState(() => sessionStorage.getItem("wg_admin_pw") || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const tapTimer = useRef(null);

  const mastered = Object.values(prog.wordStats || {}).filter(s => s.mastered).length;

  const onLockTap = () => {
    setMsg("");
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {}, 0);
    // simple: 3 taps within 2 seconds
    window.__wg_taps = (window.__wg_taps || 0) + 1;
    if (window.__wg_taps === 1) {
      setTimeout(() => { window.__wg_taps = 0; }, 2000);
    }
    if (window.__wg_taps >= 3) {
      window.__wg_taps = 0;
      setAdminRevealed(true);
    }
  };

  const savePw = () => {
    sessionStorage.setItem("wg_admin_pw", password);
    setMsg("Password saved for this tab.");
  };

  const doGenerate = async () => {
    if (!password.trim()) return alert("Enter admin password first.");
    setBusy(true);
    setMsg("");
    try {
      const existing = shared.map((w) => w.word);
      const out = await apiGenerateWords({ level: prog.currentLevel, existingWords: existing, password });
      setMsg(`Generated and saved ${out.length} words.`);
      onRefreshShared?.();
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="container">
        <Card>
          <div className="topbar">
            <div className="h2">Progress</div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <button className="iconBtn" onClick={onLockTap} title="Admin">🔒</button>
              <button className="iconBtn" onClick={onBack}>Back</button>
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <Badge label="Mastered" value={mastered} />
            <Badge label="Seen" value={Object.keys(prog.wordStats||{}).length} />
            <Badge label="Level" value={`L${prog.currentLevel}`} />
          </div>

          <div className="small" style={{ marginTop: 12 }}>Shared words available: <b>{shared.length}</b></div>
          <div className="small" style={{ marginTop: 6 }}>Build: <b>{BUILD_ID}</b></div>

          {adminRevealed && (
            <>
              <div className="hr" />
              <div style={{ fontWeight: 900, color:"#aabfae", letterSpacing:"0.12em" }}>ADMIN</div>
              <div className="small" style={{ marginTop: 8 }}>Tap 🔒 3 times to reveal. Password is checked server-side.</div>

              <input
                type="password"
                className="input"
                value={password}
                onChange={(e)=>setPassword(e.target.value)}
                placeholder="Admin password"
                style={{ marginTop: 12 }}
              />
              <button className="btnSecondary" onClick={savePw} disabled={!password.trim()}>Save password</button>
              <button className="btnPrimary" onClick={doGenerate} disabled={busy || !password.trim()}>
                {busy ? "Working…" : "Generate words now"}
              </button>

              {msg && <div className="small" style={{ marginTop: 10 }}><b>Status:</b> {msg}</div>}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function App() {
  const [prog, setProg] = useState(() => loadProgress() || freshProgress());
  const [shared, setShared] = useState([]);
  const [view, setView] = useState("loading"); // loading|home|placement|practice|words|progress
  const [toast, setToast] = useState("");

  const refreshShared = async () => {
    try {
      const words = await apiListWords();
      setShared(words);
    } catch (e) {
      setToast(String(e?.message || e));
      setTimeout(() => setToast(""), 4000);
    }
  };

  // streak update
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

  // load shared
  useEffect(() => {
    (async () => {
      try {
        const words = await apiListWords();
        setShared(words);
      } catch (e) {
        setToast(String(e?.message || e));
        setShared([]);
      } finally {
        setView("home");
      }
    })();
  }, []);

  useEffect(() => { saveProgress(prog); }, [prog]);

  const onPlacementDone = (level) => {
    setProg(p => ({ ...p, currentLevel: clamp(level,1,3), placementDone: true }));
    setView("home");
  };

  const skipPlacement = () => {
    setProg(p => ({ ...p, currentLevel: 1, placementDone: true }));
    setView("home");
  };

  if (view === "loading") {
    return (
      <div className="page"><div className="container"><Card>
        <div className="small">Loading…</div>
      </Card></div></div>
    );
  }

  if (view === "placement") return <Placement words={shared} onDone={onPlacementDone} onBack={() => setView("home")} />;
  if (view === "practice") return <Practice words={shared} prog={prog} setProg={setProg} onBack={() => setView("home")} />;
  if (view === "words") return <WordsScreen words={shared} onBack={() => setView("home")} />;
  if (view === "progress") return <Progress prog={prog} shared={shared} onBack={() => setView("home")} onRefreshShared={refreshShared} />;

  return (
    <>
      <Home
        prog={prog}
        sharedCount={shared.length}
        onStartPractice={() => setView("practice")}
        onPlacement={() => setView("placement")}
        onSkipPlacement={skipPlacement}
        onWords={() => setView("words")}
        onProgress={() => setView("progress")}
      />
      <Toast text={toast} />
    </>
  );
}
