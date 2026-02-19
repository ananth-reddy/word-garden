
import React, { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";

const BUILD_ID = "20260218-004941";
const ACTIVE_PROFILE_KEY = "wg_active_profile_v1";
const PROG_PREFIX = "wg_progress_v1_";
const LEVELS = [
  { n: 1, name: "Beginner", key: "beginner" },
  { n: 2, name: "Intermediate", key: "intermediate" },
  { n: 3, name: "Advanced", key: "advanced" },
];

function todayStr() { return new Date().toISOString().slice(0, 10); }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function shuffle(arr) {
  const a = [...arr];
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function sample(arr, n){ return shuffle(arr).slice(0,n); }
function wordKey(w){ return (w?.id != null) ? String(w.id) : String(w.word); }

function freshProgress(){
  return {
    wordStats: {}, // id/word -> {seen, correct, wrong, mastered, nextReviewAt, lastSeenAt}
    currentLevel: 1,
    streak: 0,
    lastDate: null,
    accuracy: { correct: 0, total: 0 },
    placementDone: false,
    placementHistory: [], // [{date, score, level}]
    daily: {} // date -> {done:boolean, correct, total}
  };
}
function progressKey(code){ return `${PROG_PREFIX}${String(code||"").trim()}`; }
function loadProgress(code){
  try{ const raw = localStorage.getItem(progressKey(code)); return raw ? JSON.parse(raw) : null; }catch{ return null; }
}
function saveProgress(code, p){
  try{
    const now = new Date().toISOString();
    const out = { ...(p||{}), _updatedAt: now };
    localStorage.setItem(progressKey(code), JSON.stringify(out));
  }catch{
    // ignore storage failures
  }
}


async function apiListWords() {
  const res = await fetch("/.netlify/functions/list-words");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to load words");
  return Array.isArray(data) ? data : [];
}




function loadActiveProfile(){
  try{
    const raw = localStorage.getItem(ACTIVE_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch{ return null; }
}
function saveActiveProfile(profile){
  try{ localStorage.setItem(ACTIVE_PROFILE_KEY, JSON.stringify(profile)); }catch{}
}
function clearActiveProfile(){
  try{ localStorage.removeItem(ACTIVE_PROFILE_KEY); }catch{}
}

async function apiProfileGet(profileCode){
  const res = await fetch("/.netlify/functions/profile-get", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ profileCode })
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data?.error || "Profile lookup failed");
  return data;
}

async function apiProfileCreate({ profileCode, childName, password }){
  const res = await fetch("/.netlify/functions/profile-create", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ profileCode, childName, password })
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data?.error || "Profile create failed");
  return data;
}

async function apiProfileList({ password }){
  const res = await fetch("/.netlify/functions/profile-list", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ password })
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data?.error || "Profile list failed");
  return data;
}

async function apiGetProgress(profileCode){
  const res = await fetch("/.netlify/functions/sync-get", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ syncCode: profileCode })
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data?.error || "Sync get failed");
  return data;
}
async function apiSetProgress(profileCode, progress){
  const res = await fetch("/.netlify/functions/sync-set", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ syncCode: profileCode, progress })
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data?.error || "Sync set failed");
  return data;
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

// ---------- learning logic ----------
function computeAccuracy(acc){
  const total = acc?.total || 0;
  if (!total) return 0;
  return Math.round((acc.correct / total) * 100);
}
function masteredCount(prog){
  return Object.values(prog.wordStats || {}).filter(s => s.mastered).length;
}
function levelName(n){
  return (LEVELS.find(x => x.n === Number(n)) || LEVELS[0]).name;
}
function getDueReviewWords(words, prog){
  const now = Date.now();
  return words.filter(w => {
    const s = prog.wordStats?.[wordKey(w)];
    return s && !s.mastered && s.nextReviewAt && s.nextReviewAt <= now;
  });
}
function getUnseenWords(words, prog, level){
  return words.filter(w => Number(w.level) === Number(level) && !prog.wordStats?.[wordKey(w)]);
}
function scheduleNextReview(stat){
  const c = stat.correct || 0;
  const days = c >= 6 ? 14 : c >= 4 ? 7 : c >= 2 ? 2 : 1;
  return Date.now() + days*24*60*60*1000;
}

// Weak words: attempted >=2 and accuracy < 60% OR wrong >=2
function getWeakWords(words, prog){
  const out = [];
  for (const w of words){
    const s = prog.wordStats?.[wordKey(w)];
    if (!s) continue;
    const t = (s.correct||0) + (s.wrong||0);
    const pct = t ? (s.correct / t) : 0;
    if (t >= 2 && pct < 0.6) out.push(w);
    else if ((s.wrong||0) >= 2 && !s.mastered) out.push(w);
  }
  return out;
}

// Level up guard: (1) mastered >= 70% of level words, (2) overall accuracy >= 65%, (3) attempted >= 10 on that level
function shouldLevelUp(words, prog){
  const L = prog.currentLevel || 1;
  if (L >= 3) return false;
  const levelWords = words.filter(w => Number(w.level) === Number(L));
  if (!levelWords.length) return false;

  let mastered = 0, attempted = 0;
  for (const w of levelWords){
    const s = prog.wordStats?.[wordKey(w)];
    if (!s) continue;
    attempted += 1;
    if (s.mastered) mastered += 1;
  }
  const masteredPct = mastered / levelWords.length;
  const overallAcc = (prog.accuracy?.total || 0) ? (prog.accuracy.correct / prog.accuracy.total) : 0;
  return masteredPct >= 0.7 && overallAcc >= 0.65 && attempted >= 10;
}

function speak(text, lang){
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

// ---------- UI primitives ----------
function Card({ children }){ return <div className="card">{children}</div>; }
function Badge({ label, value }){
  return (
    <div className="badge">
      <div className="badgeVal">{value}</div>
      <div className="badgeLab">{label}</div>
    </div>
  );
}
function Header(){
  return (
    <div style={{ textAlign:"center", marginBottom: 16 }}>
      <div style={{ fontSize: 46, marginBottom: 6 }}>🌿</div>
      <div className="h1">
        Word <span className="garden">Garden</span>
      </div>
      <div className="subtitle">Grow your English vocabulary</div>
    </div>
  );
}

// ---------- Screens ----------
function HomeScreen({ prog, wordsCount, onStart, onProgress, onDaily, onWeak, onPlacement, onSkipPlacement }){
  const acc = computeAccuracy(prog.accuracy);
  const mastered = masteredCount(prog);
  const lvlName = levelName(prog.currentLevel || 1);

  const pct = wordsCount ? Math.round((mastered/wordsCount)*100) : 0;

  return (
    <div className="page">
      <div className="container">
        <Header />

        <Card>
          <div className="row">
            <Badge label="Mastered" value={mastered} />
            <Badge label="Streak" value={`${prog.streak}d`} />
            <Badge label="Accuracy" value={`${acc}%`} />
          </div>

          <div className="small" style={{ marginTop: 14 }}>
            Progress — {mastered} of {wordsCount} words mastered
          </div>
          <div className="progressLine"><div className="progressFill" style={{ width: `${pct}%` }} /></div>

          {!prog.placementDone ? (
            <>
              <div className="cardInner" style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 900, color:"var(--ink)" }}>Start with a placement test</div>
                <div className="small" style={{ marginTop: 6 }}>
                  A quick 10-question test finds the right starting level for you.
                </div>
              </div>
              <button className="btnPrimary" onClick={onPlacement}>Take Placement Test →</button>
              <button className="btnSecondary" onClick={onSkipPlacement}>Skip — Start at Level 1</button>
            </>
          ) : (
            <>
              <div className="kvRow" style={{ marginTop: 10 }}>
                <div className="small">Current level</div>
                <strong>{lvlName}</strong>
              </div>
              <button className="btnPrimary" onClick={onStart}>Start Learning</button>
              <button className="btnSecondary" onClick={onProgress}>View Progress →</button>
              <button className="btnGhost" onClick={onDaily}>Daily challenge (5)</button>
              <button className="btnGhost" onClick={onWeak}>Practice weak words</button>
              <div className="small" style={{ textAlign:"center", marginTop: 12 }}>
                Build {BUILD_ID}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function WordIntroScreen({ word, total, idx, onHome, onReady, showNew=true }){
  return (
    <div className="page">
      <div className="container">
        <div className="topNav">
          <button className="backBtn" onClick={onHome}>← Home</button>
          <div className="small">{idx}/{total}</div>
        </div>

        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div className="label">{showNew ? "✨ New word" : "🔁 Review"}</div>
            <span className="pill pillLevel">Level {word.level}</span>
          </div>

          <div style={{ marginTop: 10 }} className="wordTitle">{word.word}</div>

          <div style={{ display:"flex", gap:10, marginTop: 10 }}>
            <button className="miniBtn" onClick={() => speak(word.word, "en-US")}>🔈 US</button>
            <button className="miniBtn" onClick={() => speak(word.word, "en-GB")}>🔈 GB</button>
          </div>

          <div className="section">
            <div className="sectionTitle">Definition</div>
            <div style={{ marginTop: 6, fontSize: 16 }}>{word.definition}</div>
          </div>

          <div className="section">
            <div className="sectionTitle">🇸🇪 Swedish</div>
            <div style={{ marginTop: 6, fontSize: 16, fontStyle:"italic" }}>{word.swedish}</div>
          </div>

          <div className="section">
            <div className="sectionTitle">Example</div>
            <div style={{ marginTop: 6, fontSize: 16 }}>{word.sentence?.replace("___", `"${word.word}"`)}</div>
          </div>

          <button className="btnPrimary" onClick={onReady}>I'm ready — test me →</button>
        </Card>
      </div>
    </div>
  );
}

function DefinitionMCQScreen({ word, choices, idx, total, onHome, onPick }){
  return (
    <div className="page">
      <div className="container">
        <div className="topNav">
          <button className="backBtn" onClick={onHome}>← Home</button>
          <div className="small">{idx}/{total}</div>
        </div>

        <Card>
          <div className="label">Choose the correct definition</div>

          <div style={{ display:"flex", alignItems:"center", gap:10, marginTop: 10 }}>
            <div className="wordTitle" style={{ fontSize: 40 }}>{word.word}</div>
            <button className="miniBtn miniBtnMuted" onClick={() => speak(word.word, "en-US")}>🔈 US</button>
            <button className="miniBtn miniBtnMuted" onClick={() => speak(word.word, "en-GB")}>🔈 GB</button>
          </div>

          <div style={{ marginTop: 4 }}>
            {choices.map((c, i) => (
              <button key={i} className="choice" onClick={() => onPick(c)}>{c}</button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ProgressScreen({ prog, words, onHome, onRetakePlacement, onParentMode }){
  const mastered = masteredCount(prog);
  const acc = computeAccuracy(prog.accuracy);

  const perLevel = useMemo(() => {
    const out = {1:{total:0, mastered:0},2:{total:0, mastered:0},3:{total:0, mastered:0}};
    for (const w of words){
      const L = Number(w.level)||1;
      out[L].total += 1;
      const s = prog.wordStats?.[wordKey(w)];
      if (s?.mastered) out[L].mastered += 1;
    }
    return out;
  }, [words, prog]);

  const wordRows = useMemo(() => {
    // show first 30 most recent seen words
    const items = [];
    for (const w of words){
      const s = prog.wordStats?.[wordKey(w)];
      if (!s) continue;
      items.push({ w, s });
    }
    items.sort((a,b) => (b.s.lastSeenAt||0) - (a.s.lastSeenAt||0));
    return items.slice(0, 30);
  }, [words, prog]);

  const confidenceDot = (s) => {
    const t = (s.correct||0)+(s.wrong||0);
    const pct = t ? (s.correct/t) : 0;
    if (t < 2) return "dotRed";
    if (pct >= 0.8) return "dotGreen";
    if (pct >= 0.5) return "dotYellow";
    return "dotRed";
  };

  return (
    <div className="page">
      <div className="container">
        <button className="backBtn" onClick={onHome}>← Back</button>
        <div style={{ marginTop: 8, marginBottom: 12 }} className="h1" >
          <span style={{ fontSize: 30 }}>Your Progress</span>
        </div>

        <Card>
          <div className="row">
            <Badge label="Mastered" value={mastered} />
            <Badge label="Streak" value={`${prog.streak}d`} />
            <Badge label="Accuracy" value={`${acc}%`} />
          </div>

          <div className="small" style={{ marginTop: 16 }}>
            Overall ({mastered}/{words.length})
          </div>
          <div className="progressLine">
            <div className="progressFill" style={{ width: `${words.length ? Math.round((mastered/words.length)*100) : 0}%` }} />
          </div>

          <div className="small" style={{ marginTop: 12 }}>
            Beginner — {perLevel[1].mastered}/{perLevel[1].total}
          </div>
          <div className="progressLine">
            <div className="progressFill" style={{ width: `${perLevel[1].total ? Math.round((perLevel[1].mastered/perLevel[1].total)*100) : 0}%` }} />
          </div>

          <div className="small" style={{ marginTop: 12 }}>
            Intermediate — {perLevel[2].mastered}/{perLevel[2].total}
          </div>
          <div className="progressLine">
            <div className="progressFill" style={{ width: `${perLevel[2].total ? Math.round((perLevel[2].mastered/perLevel[2].total)*100) : 0}%` }} />
          </div>

          <div className="small" style={{ marginTop: 12 }}>
            Advanced — {perLevel[3].mastered}/{perLevel[3].total}
          </div>
          <div className="progressLine">
            <div className="progressFill" style={{ width: `${perLevel[3].total ? Math.round((perLevel[3].mastered/perLevel[3].total)*100) : 0}%` }} />
          </div>

          <div className="hr" />

          <div className="label">Placement test history</div>
          <div style={{ marginTop: 8 }}>
            {(prog.placementHistory || []).slice(-5).reverse().map((h, i) => (
              <div key={i} className="kvRow" style={{ padding:"6px 0" }}>
                <div className="small">{h.date}</div>
                <div className="small"><b>{h.score}/10</b> → {levelName(h.level)}</div>
              </div>
            ))}
            {(!prog.placementHistory || !prog.placementHistory.length) && (
              <div className="small" style={{ marginTop: 6 }}>No placement tests taken yet.</div>
            )}
          </div>

          <div className="hr" />

          <div className="label">Word by word</div>

          <table className="table">
            <tbody>
              {wordRows.map(({w,s}) => {
                const t = (s.correct||0)+(s.wrong||0);
                return (
                  <tr key={wordKey(w)} className="tr">
                    <td className="td" style={{ fontWeight: 900 }}>{w.word}</td>
                    <td className="td" style={{ textAlign:"right" }}>
                      <button className="miniBtn miniBtnMuted" onClick={()=>speak(w.word,"en-US")} title="US">🔈 US</button>{" "}
                      <button className="miniBtn miniBtnMuted" onClick={()=>speak(w.word,"en-GB")} title="GB">🔈 GB</button>
                    </td>
                    <td className="td" style={{ textAlign:"right", fontWeight: 800 }}>{s.correct||0}/{t||0}</td>
                    <td className="td" style={{ width: 30 }}>
                      <span className={`dot ${confidenceDot(s)}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <button className="btnSecondary" onClick={onRetakePlacement}>Retake Placement Test</button>
          <button className="btnGhost" onClick={onParentMode}>Parent mode</button>
        </Card>
      </div>
    </div>
  );
}


function randomCode(){
  const a = Math.random().toString(36).slice(2,6).toUpperCase();
  const b = Math.random().toString(36).slice(2,6).toUpperCase();
  return `WG-${a}${b}`;
}
function CreateProfileForm({ onCreate }){
  const [childName, setChildName] = useState("");
  const [profileCode, setProfileCode] = useState(() => randomCode());
  return (
    <div style={{ marginTop: 12 }}>
      <input className="input" value={childName} onChange={(e)=>setChildName(e.target.value)} placeholder="Child name (e.g., Misha)" />
      <div style={{ marginTop: 10, display:"flex", gap:10 }}>
        <input className="input" value={profileCode} onChange={(e)=>setProfileCode(e.target.value)} placeholder="Profile code" />
        <button className="pill" onClick={() => setProfileCode(randomCode())} type="button">↻</button>
      </div>
      <button className="btnPrimary" style={{ marginTop: 12 }} onClick={() => onCreate({ childName, profileCode })} disabled={!childName.trim() || profileCode.trim().length<4}>
        Create profile
      </button>
    </div>
  );
}

function ParentModeScreen({ prog, words, onBack, onGenerate, generateStatus, onResetChild, activeProfile, onCreateProfile, onListProfiles, profiles, onSwitchProfile, onSignOut }){
  const mastered = masteredCount(prog);
  const weak = getWeakWords(words, prog).length;
  const total = words.length;

  return (
    <div className="page">
      <div className="container">
        <div className="topNav">
          <button className="backBtn" onClick={onBack}>← Home</button>
          <div className="pill">Parent mode</div>
        </div>

        <Card>
          <div style={{ fontFamily:"DM Serif Display, serif", fontSize: 28 }}>Parent dashboard</div>
          <div className="small" style={{ marginTop: 6 }}>Quick overview and controls.</div>

          <div className="row" style={{ marginTop: 14 }}>
            <Badge label="Total words" value={total} />
            <Badge label="Mastered" value={mastered} />
            <Badge label="Weak" value={weak} />
          </div>

          
          <div className="label">Child profile</div>
          <div className="small" style={{ marginTop: 6 }}>
            Active: <b>{activeProfile?.childName || "—"}</b> <span className="pill" style={{ marginLeft: 8 }}>{activeProfile?.profileCode || "—"}</span>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btnSecondary" onClick={onListProfiles}>Refresh profiles</button>
            <button className="btnGhost" onClick={onSignOut}>Switch child (enter code)</button>
          </div>

          {(profiles && profiles.length>0) && (
            <div style={{ marginTop: 10 }}>
              {profiles.map(p => (
                <button key={p.profile_code} className="choice" onClick={() => onSwitchProfile(p)}>
                  {p.child_name} — {p.profile_code}
                </button>
              ))}
            </div>
          )}

          <div className="hr" />

          <div className="label">Create a child profile</div>
          <div className="small" style={{ marginTop: 6 }}>
            Create once, then share the code with the child.
          </div>
          <CreateProfileForm onCreate={onCreateProfile} />

<div className="hr" />

          <div className="label">Controls</div>
          <button className="btnPrimary" onClick={onGenerate}>Generate 12 words for current level</button>
          {generateStatus && <div className="small" style={{ marginTop: 10 }}><b>Status:</b> {generateStatus}</div>}

          <button className="btnSecondary" onClick={onResetChild}>Reset child progress (this device)</button>
          <div className="small" style={{ marginTop: 10 }}>
            Note: generation requires the admin password (checked server-side).
          </div>
        </Card>
      </div>
    </div>
  );
}

function ParentGate({ onUnlock, onBack }){
  const [pw, setPw] = useState(() => sessionStorage.getItem("wg_parent_pw") || "");
  const [msg, setMsg] = useState("");
  const secret = "__LOCAL_PARENT_HINT__"; // not used for real auth; gate is local
  return (
    <div className="page">
      <div className="container">
        <div className="topNav">
          <button className="backBtn" onClick={onBack}>← Back</button>
        </div>
        <Card>
          <div style={{ fontFamily:"DM Serif Display, serif", fontSize: 28 }}>Parent mode</div>
          <div className="small" style={{ marginTop: 6 }}>Enter your parent password to continue.</div>

          <div className="hr" />

          <input className="input" type="password" value={pw} onChange={(e)=>setPw(e.target.value)} placeholder="Parent password" />
          <button className="btnPrimary" onClick={() => { sessionStorage.setItem("wg_parent_pw", pw); onUnlock(pw); }}>
            Unlock
          </button>
          {msg && <div className="small" style={{ marginTop: 10 }}>{msg}</div>}
          <div className="small" style={{ marginTop: 10 }}>
            Tip: this password is only to hide parent controls from kids. Admin generation still checks server-side.
          </div>
        </Card>
      </div>
    </div>
  );
}

// Placement: 10 definition->word questions, sets starting level; stores history
function PlacementScreen({ words, onDone, onBack }){
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
    for (const a of answers){
      s[a.level].t += 1;
      if (a.correct) s[a.level].c += 1;
    }
    return s;
  }, [answers]);

  const finish = () => {
    let level = 1;
    for (const L of [1,2,3]){
      const t = scoreByLevel[L].t || 0;
      const c = scoreByLevel[L].c || 0;
      if (t > 0 && (c/t) >= 0.7) level = L;
    }
    const correct = answers.filter(a => a.correct).length;
    onDone({ level, score: correct });
  };

  if (!quiz.length){
    return (
      <div className="page"><div className="container"><Card>
        <div className="topNav"><button className="backBtn" onClick={onBack}>← Back</button><div className="small">Placement</div></div>
        <div className="small">Not enough words loaded yet to run the placement test.</div>
      </Card></div></div>
    );
  }

  if (step >= quiz.length){
    return (
      <div className="page"><div className="container"><Card>
        <div className="topNav"><button className="backBtn" onClick={onBack}>← Back</button><div className="small">Placement</div></div>
        <div className="label">Done</div>
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
    <div className="page"><div className="container">
      <Card>
        <div className="topNav">
          <button className="backBtn" onClick={onBack}>← Back</button>
          <div className="small">Question {step+1}/10</div>
        </div>
        <div className="label">What word matches this meaning?</div>
        <div style={{ marginTop: 10, fontSize: 18, fontWeight: 900 }}>
          “{current.prompt}”
        </div>
        {current.choices.map((c) => (
          <button key={c} className="choice" onClick={() => choose(c)}>{c}</button>
        ))}
      </Card>
    </div></div>
  );
}

function DailyChallengeScreen({ words, prog, setProg, onHome }){
  const date = todayStr();
  const record = prog.daily?.[date] || { done:false, correct:0, total:0 };

  const [step, setStep] = useState(0);
  const [done, setDone] = useState(record.done);
  const [session, setSession] = useState([]);

  useEffect(() => {
    // 5 items: 2 due review + 3 unseen from current level
    const due = getDueReviewWords(words, prog);
    const unseen = getUnseenWords(words, prog, prog.currentLevel || 1);
    const pick = shuffle([...sample(due, Math.min(2,due.length)), ...sample(unseen, Math.min(3, unseen.length))]).slice(0,5);
    setSession(pick);
    setStep(0);
  }, [words.length]);

  const current = session[step];
  const [choices, setChoices] = useState([]);

  useEffect(() => {
    if (!current) return;
    const pool = words.filter(x => x.definition && x.word !== current.word);
    const wrongs = sample(pool, 3).map(x => x.definition);
    setChoices(shuffle([current.definition, ...wrongs]));
  }, [current?.word]);

  const mark = (correct) => {
    setProg(p => {
      // update global acc
      const next = { ...p };
      next.accuracy = { correct: (p.accuracy?.correct||0) + (correct?1:0), total: (p.accuracy?.total||0)+1 };

      // update word stat
      const k = wordKey(current);
      const prev = p.wordStats?.[k] || { seen:0, correct:0, wrong:0, mastered:false, nextReviewAt:0, lastSeenAt:0 };
      const ns = {
        ...prev,
        seen: (prev.seen||0)+1,
        correct: (prev.correct||0) + (correct?1:0),
        wrong: (prev.wrong||0) + (correct?0:1),
        lastSeenAt: Date.now(),
      };
      const t = ns.correct + ns.wrong;
      const pct = t ? (ns.correct/t) : 0;
      if (ns.correct >= 4 && pct >= 0.8) ns.mastered = true;
      ns.nextReviewAt = scheduleNextReview(ns);

      next.wordStats = { ...(p.wordStats||{}), [k]: ns };

      // daily record
      const dr = { ...(p.daily||{}) };
      const cur = dr[date] || { done:false, correct:0, total:0 };
      const upd = { ...cur, correct: cur.correct + (correct?1:0), total: cur.total+1, done: false };
      dr[date] = upd;
      next.daily = dr;

      return next;
    });

    if (step+1 >= 5){
      setDone(true);
      setProg(p => {
        const dr = { ...(p.daily||{}) };
        const cur = dr[date] || { done:false, correct:0, total:0 };
        dr[date] = { ...cur, done:true };
        return { ...p, daily: dr };
      });
    } else {
      setStep(s => s+1);
    }
  };

  if (done){
    return (
      <div className="page"><div className="container">
        <Card>
          <div className="topNav"><button className="backBtn" onClick={onHome}>← Home</button><div className="small">Daily challenge</div></div>
          <div style={{ fontFamily:"DM Serif Display, serif", fontSize: 28 }}>🌸 Bloomed!</div>
          <div className="small" style={{ marginTop: 8 }}>
            Completed today’s challenge: {record.correct || prog.daily?.[date]?.correct || 0}/{record.total || prog.daily?.[date]?.total || 5}
          </div>
          <button className="btnPrimary" onClick={onHome}>Done</button>
        </Card>
      </div></div>
    );
  }

  if (!current){
    return (
      <div className="page"><div className="container">
        <Card>
          <div className="topNav"><button className="backBtn" onClick={onHome}>← Home</button><div className="small">Daily challenge</div></div>
          <div className="small">Not enough words yet.</div>
        </Card>
      </div></div>
    );
  }

  return (
    <div className="page"><div className="container">
      <Card>
        <div className="topNav"><button className="backBtn" onClick={onHome}>← Home</button><div className="small">{step+1}/5</div></div>
        <div className="label">Daily challenge</div>
        <div className="wordTitle" style={{ fontSize: 38, marginTop: 8 }}>{current.word}</div>
        <div className="small" style={{ marginTop: 8 }}>Choose the correct definition:</div>
        {choices.map((c,i)=>(
          <button key={i} className="choice" onClick={() => mark(c === current.definition)}>{c}</button>
        ))}
      </Card>
    </div></div>
  );
}

function WeakWordsScreen({ words, prog, setProg, onHome }){
  const pool = useMemo(() => {
    const weak = getWeakWords(words, prog);
    return shuffle(weak).slice(0, 8);
  }, [words, prog]);

  const [step, setStep] = useState(0);
  const current = pool[step];

  const [choices, setChoices] = useState([]);

  useEffect(() => {
    if (!current) return;
    const poolDefs = words.filter(x => x.definition && x.word !== current.word);
    const wrongs = sample(poolDefs, 3).map(x => x.definition);
    setChoices(shuffle([current.definition, ...wrongs]));
  }, [current?.word]);

  const mark = (correct) => {
    setProg(p => {
      const next = { ...p };
      next.accuracy = { correct: (p.accuracy?.correct||0) + (correct?1:0), total: (p.accuracy?.total||0)+1 };
      const k = wordKey(current);
      const prev = p.wordStats?.[k] || { seen:0, correct:0, wrong:0, mastered:false, nextReviewAt:0, lastSeenAt:0 };
      const ns = {
        ...prev,
        seen: (prev.seen||0)+1,
        correct: (prev.correct||0) + (correct?1:0),
        wrong: (prev.wrong||0) + (correct?0:1),
        lastSeenAt: Date.now(),
      };
      const t = ns.correct + ns.wrong;
      const pct = t ? (ns.correct/t) : 0;
      if (ns.correct >= 4 && pct >= 0.8) ns.mastered = true;
      ns.nextReviewAt = scheduleNextReview(ns);
      next.wordStats = { ...(p.wordStats||{}), [k]: ns };
      return next;
    });

    if (step+1 >= pool.length) setStep(step+1);
    else setStep(s => s+1);
  };

  if (!pool.length){
    return (
      <div className="page"><div className="container">
        <Card>
          <div className="topNav"><button className="backBtn" onClick={onHome}>← Home</button><div className="small">Weak words</div></div>
          <div style={{ fontFamily:"DM Serif Display, serif", fontSize: 26 }}>All good</div>
          <div className="small" style={{ marginTop: 8 }}>No weak words yet. Keep practicing!</div>
        </Card>
      </div></div>
    );
  }

  if (!current){
    return (
      <div className="page"><div className="container">
        <Card>
          <div className="topNav"><button className="backBtn" onClick={onHome}>← Home</button><div className="small">Weak words</div></div>
          <div style={{ fontFamily:"DM Serif Display, serif", fontSize: 26 }}>Done</div>
          <div className="small" style={{ marginTop: 8 }}>Weak-word practice finished.</div>
          <button className="btnPrimary" onClick={onHome}>Done</button>
        </Card>
      </div></div>
    );
  }

  return (
    <div className="page"><div className="container">
      <Card>
        <div className="topNav"><button className="backBtn" onClick={onHome}>← Home</button><div className="small">{step+1}/{pool.length}</div></div>
        <div className="label">Practice your weak words</div>
        <div className="wordTitle" style={{ fontSize: 38, marginTop: 8 }}>{current.word}</div>
        <div className="small" style={{ marginTop: 8 }}>Choose the correct definition:</div>
        {choices.map((c,i)=>(
          <button key={i} className="choice" onClick={() => mark(c === current.definition)}>{c}</button>
        ))}
      </Card>
    </div></div>
  );
}

// Main learning flow: show word intro -> quiz (MCQ definition, or rotate types)
function LearningFlow({ words, prog, setProg, onHome }){
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState("intro"); // intro|quiz
  const [session, setSession] = useState([]);
  const [choices, setChoices] = useState([]);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    const level = prog.currentLevel || 1;
    const due = getDueReviewWords(words, prog);
    const unseen = getUnseenWords(words, prog, level);
    const pick = shuffle([...sample(unseen, Math.min(4, unseen.length)), ...sample(due, Math.min(2, due.length))]).slice(0,6);
    setSession(pick);
    setIndex(0);
    setPhase("intro");
    setFeedback("");
  }, [words.length, prog.currentLevel]);

  const current = session[index];

  useEffect(() => {
    if (!current) return;
    // Build MCQ definitions choices (matches screenshot)
    const pool = words.filter(x => x.definition && x.word !== current.word);
    const wrongs = sample(pool, 3).map(x => x.definition);
    setChoices(shuffle([current.definition, ...wrongs]));
  }, [current?.word, words.length]);

  const applyAnswer = (correct) => {
    setProg(p => {
      const next = { ...p };
      next.accuracy = { correct: (p.accuracy?.correct||0) + (correct?1:0), total: (p.accuracy?.total||0)+1 };

      const k = wordKey(current);
      const prev = p.wordStats?.[k] || { seen:0, correct:0, wrong:0, mastered:false, nextReviewAt:0, lastSeenAt:0 };
      const ns = {
        ...prev,
        seen: (prev.seen||0)+1,
        correct: (prev.correct||0) + (correct?1:0),
        wrong: (prev.wrong||0) + (correct?0:1),
        lastSeenAt: Date.now(),
      };
      const t = ns.correct + ns.wrong;
      const pct = t ? (ns.correct/t) : 0;
      if (ns.correct >= 4 && pct >= 0.8) ns.mastered = true;
      ns.nextReviewAt = scheduleNextReview(ns);

      next.wordStats = { ...(p.wordStats||{}), [k]: ns };

      // Level-up guard
      if (shouldLevelUp(words, next)) next.currentLevel = clamp((next.currentLevel||1)+1, 1, 3);

      return next;
    });

    setFeedback(correct ? "✅ Correct" : "❌ Not quite");
    setTimeout(() => {
      setFeedback("");
      if (index+1 >= session.length) {
        onHome();
      } else {
        setIndex(i => i+1);
        setPhase("intro");
      }
    }, 650);
  };

  if (!current){
    return (
      <div className="page"><div className="container">
        <Card>
          <div className="topNav"><button className="backBtn" onClick={onHome}>← Home</button><div className="small">Learning</div></div>
          <div className="small">No words available yet for this level.</div>
        </Card>
      </div></div>
    );
  }

  if (phase === "intro"){
    const showNew = !prog.wordStats?.[wordKey(current)];
    return (
      <WordIntroScreen
        word={current}
        idx={index}
        total={session.length}
        onHome={onHome}
        showNew={showNew}
        onReady={() => setPhase("quiz")}
      />
    );
  }

  return (
    <div>
      <DefinitionMCQScreen
        word={current}
        idx={index}
        total={session.length}
        onHome={onHome}
        choices={choices}
        onPick={(picked) => applyAnswer(picked === current.definition)}
      />
      {feedback && (
        <div style={{ position:"fixed", left:12, right:12, bottom:12 }}>
          <div className="card" style={{ padding: 14, textAlign:"center" }}>
            <div style={{ fontWeight: 900 }}>{feedback}</div>
          </div>
        </div>
      )}
    </div>
  );
}


function ProfileGateScreen({ onJoin, onGoParent }){
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const c = String(code||"").trim();
    if(c.length < 4) { setErr("Enter a valid profile code."); return; }
    setBusy(true); setErr("");
    try{
      const out = await apiProfileGet(c);
      if(!out?.found) { setErr("Profile code not found. Ask parent for a code."); return; }
      onJoin({ profileCode: c, childName: out.childName || "Child" });
    }catch(e){
      setErr(String(e?.message || e));
    }finally{
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="container">
        <Header />
        <Card>
          <div style={{ fontFamily:"DM Serif Display, serif", fontSize: 28 }}>Enter profile code</div>
          <div className="small" style={{ marginTop: 6 }}>
            Each child has a code. Enter it to open their Word Garden.
          </div>

          <div className="hr" />

          <input className="input" value={code} onChange={(e)=>setCode(e.target.value)} placeholder="Example: MISHA-2026" />
          <button className="btnPrimary" onClick={submit} disabled={busy}>{busy ? "Checking…" : "Continue"}</button>

          {err && <div className="small" style={{ marginTop: 10, color:"#8a2b2b" }}><b>Note:</b> {err}</div>}

          <div className="hr" />

          <button className="btnGhost" onClick={onGoParent}>🔒 Parent mode</button>
        </Card>
      </div>
    </div>
  );
}

// ---------- App ----------
export default function App(){
  const [activeProfile, setActiveProfile] = useState(() => loadActiveProfile());
  const [prog, setProg] = useState(() => {
    const ap = loadActiveProfile();
    const code = ap?.profileCode;
    return code ? (loadProgress(code) || freshProgress()) : freshProgress();
  });

  const syncingRef = useRef(false);
  const lastRemoteAtRef = useRef(null);

  const [words, setWords] = useState([]);
  const [view, setView] = useState(() => (loadActiveProfile()?.profileCode ? "loading" : "profile")); // profile|home|learn|progress|placement|daily|weak|parentGate|parent
  useEffect(() => {
    if (view === "loading" && !activeProfile?.profileCode) setView("profile");
  }, [view, activeProfile]);
  const [toast, setToast] = useState("");
  const [adminPw, setAdminPw] = useState(() => sessionStorage.getItem("wg_admin_pw") || "");
  const [generateStatus, setGenerateStatus] = useState("");

  const [profiles, setProfiles] = useState([]);


  const refreshWords = async () => {
    try{
      const list = await apiListWords();
      setWords(list);
    }catch(e){
      setToast(String(e?.message||e));
      setTimeout(() => setToast(""), 3500);
    }
  };

  const refreshProfiles = async () => {
    if (!adminPw?.trim()) { setToast("Enter parent password first (Parent mode → Unlock)."); setTimeout(()=>setToast(""), 2500); return; }
    try{
      const out = await apiProfileList({ password: adminPw });
      setProfiles(Array.isArray(out?.profiles) ? out.profiles : []);
    }catch(e){
      setToast(String(e?.message || e));
      setTimeout(()=>setToast(""), 3500);
    }
  };

  const createProfile = async ({ childName, profileCode }) => {
    if (!adminPw?.trim()) { alert("Unlock parent mode first."); return; }
    const name = String(childName||"").trim();
    const code = String(profileCode||"").trim();
    if(!name || code.length < 4) return;
    try{
      await apiProfileCreate({ childName: name, profileCode: code, password: adminPw });
      await refreshProfiles();
      alert(`Created profile for ${name}. Code: ${code}`);
    }catch(e){
      alert(String(e?.message || e));
    }
  };

  const switchProfile = (p) => {
    const profile = { profileCode: p.profile_code, childName: p.child_name };
    saveActiveProfile(profile);
    setActiveProfile(profile);
    setView("loading");
  };

  // streak update on app load
  useEffect(() => {
    const t = todayStr();
    if (prog.lastDate !== t){
      const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
      const newStreak = (prog.lastDate === yesterday) ? (prog.streak + 1) : 1;
      const next = { ...prog, lastDate: t, streak: newStreak };
      setProg(next);
      if(activeProfile?.profileCode) saveProgress(activeProfile.profileCode, next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if(activeProfile?.profileCode) saveProgress(activeProfile.profileCode, prog); }, [prog, activeProfile]);

  // When a profile is selected: load local progress + pull latest remote progress (if any)
  useEffect(() => {
    const code = activeProfile?.profileCode;
    if(!code) return;
    // load local first for instant UI
    const local = loadProgress(code) || freshProgress();
    setProg(local);

    (async () => {
      try{
        const remote = await apiGetProgress(code);
        if(!remote?.found) return;
        const remoteProg = remote.progress;
        const remoteAt = remote.updated_at || null;

        const localAt = local?._updatedAt || null;
        const pickRemote = remoteAt && (!localAt || new Date(remoteAt) > new Date(localAt));

        if(pickRemote && remoteProg){
          setProg(remoteProg);
          saveProgress(code, remoteProg);
        }
        lastRemoteAtRef.current = remoteAt;
      }catch(e){
        // ignore: offline / first run / transient
      }
    })();
  }, [activeProfile]);

  useEffect(() => {
    (async () => {
      await refreshWords();
      if (activeProfile?.profileCode) setView("home");
    })();
  }, [activeProfile]);
const onPlacementDone = ({ level, score }) => {
    setProg(p => {
      const next = { ...p, placementDone: true, currentLevel: clamp(level,1,3) };
      next.placementHistory = [...(p.placementHistory||[]), { date: todayStr(), score, level }];
      return next;
    });
    setView("home");
  };

  const skipPlacement = () => {
    setProg(p => ({ ...p, placementDone: true, currentLevel: 1 }));
    setView("home");
  };

  const doGenerate = async () => {
    if (!adminPw.trim()){
      const pw = prompt("Enter admin password (used for generation):");
      if (!pw) return;
      sessionStorage.setItem("wg_admin_pw", pw);
      setAdminPw(pw);
    }
    setGenerateStatus("Working…");
    try{
      const existing = words.map(w => String(w.word||""));
      const out = await apiGenerateWords({ level: prog.currentLevel || 1, existingWords: existing, password: (adminPw.trim() ? adminPw : (sessionStorage.getItem("wg_admin_pw")||"")) });
      setGenerateStatus(`Generated/saved ${Array.isArray(out)?out.length:0} words.`);
      await refreshWords();
    }catch(e){
      setGenerateStatus(String(e?.message||e));
    }
  };

  const resetChild = () => {
    if (!confirm("Reset all progress on this device?")) return;
    const next = freshProgress();
    setProg(next);
    if(activeProfile?.profileCode) saveProgress(activeProfile.profileCode, next);
    setView("home");
  };


  // Debounced progress sync (per child profile)
  useEffect(() => {
    const code = activeProfile?.profileCode;
    if(!code) return;
    let t = setTimeout(async () => {
      if(syncingRef.current) return;
      syncingRef.current = true;
      try{
        const stamped = { ...(prog||{}), _updatedAt: new Date().toISOString() };
        saveProgress(code, stamped);
        await apiSetProgress(code, stamped);
      }catch(e){
        // ignore transient sync errors
      }finally{
        syncingRef.current = false;
      }
    }, 900);
    return () => clearTimeout(t);
  }, [prog, activeProfile]);

  const signOut = () => {
    clearActiveProfile();
    setActiveProfile(null);
    setProg(freshProgress());
    setView("profile");
  };

  let screen = null;

  if (view === "profile"){
    screen = <ProfileGateScreen onJoin={(p)=>{ saveActiveProfile(p); setActiveProfile(p); setView("loading"); }} onGoParent={() => setView("parentGate")} />;
  } else if (view === "loading"){
    screen = <div className="page"><div className="container"><Card><div className="small">Loading…</div></Card></div></div>;
  } else if (view === "placement"){
    screen = <PlacementScreen words={words} onDone={onPlacementDone} onBack={() => setView("home")} />;
  } else if (view === "learn"){
    screen = <LearningFlow words={words} prog={prog} setProg={setProg} onHome={() => setView("home")} />;
  } else if (view === "daily"){
    screen = <DailyChallengeScreen words={words} prog={prog} setProg={setProg} onHome={() => setView("home")} />;
  } else if (view === "weak"){
    screen = <WeakWordsScreen words={words} prog={prog} setProg={setProg} onHome={() => setView("home")} />;
  } else if (view === "progress"){
    screen = (
      <ProgressScreen
        prog={prog}
        words={words}
        onHome={() => setView("home")}
        onRetakePlacement={() => setView("placement")}
        onParentMode={() => setView("parentGate")}
      />
    );
  } else if (view === "parentGate"){
    screen = <ParentGate onBack={() => setView("progress")} onUnlock={() => setView("parent")} />;
  } else if (view === "parent"){
    screen = (
      <ParentModeScreen
        prog={prog}
        words={words}
        onBack={() => setView("home")}
        onGenerate={doGenerate}
        generateStatus={generateStatus}
        onResetChild={resetChild}
        activeProfile={activeProfile}
        profiles={profiles}
        onListProfiles={refreshProfiles}
        onCreateProfile={createProfile}
        onSwitchProfile={switchProfile}
        onSignOut={signOut}
      />
    );
  } else {
    screen = (
      <>
        <HomeScreen
          prog={prog}
          wordsCount={words.length}
          onStart={() => setView("learn")}
          onProgress={() => setView("progress")}
          onDaily={() => setView("daily")}
          onWeak={() => setView("weak")}
          onPlacement={() => setView("placement")}
          onSkipPlacement={skipPlacement}
        />
        {toast && (
          <div style={{ position:"fixed", left:12, right:12, bottom:12 }}>
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontWeight: 900 }}>Note</div>
              <div className="small" style={{ marginTop: 6 }}>{toast}</div>
            </div>
          </div>
        )}
      </>
    );
  }

  return screen;
}
