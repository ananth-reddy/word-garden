import React, { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";

const BUILD_ID = "20260219-improved";
const STORAGE_KEY = "wordgarden_progress_v7";

const LEVELS = [
  { n: 1, name: "Beginner",     key: "beginner"     },
  { n: 2, name: "Intermediate", key: "intermediate" },
  { n: 3, name: "Advanced",     key: "advanced"     },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function todayStr()     { return new Date().toISOString().slice(0, 10); }
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
function wordKey(w)     { return (w?.id != null) ? String(w.id) : String(w.word); }

// ─── Progress ─────────────────────────────────────────────────────────────────
function freshProgress() {
  return {
    wordStats: {},
    currentLevel: 1,
    streak: 0,
    lastDate: null,
    accuracy: { correct: 0, total: 0 },
    placementDone: false,
    placementHistory: [],
    daily: {},
  };
}
function loadProgress()        { try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
function saveProgress(p)       { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch {} }
function computeAccuracy(acc)  { const t = acc?.total || 0; return t ? Math.round((acc.correct / t) * 100) : 0; }
function masteredCount(prog)   { return Object.values(prog.wordStats || {}).filter(s => s.mastered).length; }
function levelName(n)          { return (LEVELS.find(x => x.n === Number(n)) || LEVELS[0]).name; }

// ─── API ──────────────────────────────────────────────────────────────────────
async function apiListWords() {
  const res  = await fetch("/.netlify/functions/list-words");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to load words");
  return Array.isArray(data) ? data : [];
}
async function apiGenerateWords({ level, existingWords, password }) {
  const res  = await fetch("/.netlify/functions/generate-words", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "generate", level, existingWords, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Generate failed");
  return data;
}

// ─── Learning logic ───────────────────────────────────────────────────────────
function getDueReviewWords(words, prog) {
  const now = Date.now();
  return words.filter(w => {
    const s = prog.wordStats?.[wordKey(w)];
    return s && !s.mastered && s.nextReviewAt && s.nextReviewAt <= now;
  });
}
function getUnseenWords(words, prog, level) {
  return words.filter(w => Number(w.level) === Number(level) && !prog.wordStats?.[wordKey(w)]);
}
function scheduleNextReview(stat) {
  const c    = stat.correct || 0;
  const days = c >= 6 ? 14 : c >= 4 ? 7 : c >= 2 ? 2 : 1;
  return Date.now() + days * 24 * 60 * 60 * 1000;
}
function getWeakWords(words, prog) {
  return words.filter(w => {
    const s = prog.wordStats?.[wordKey(w)];
    if (!s) return false;
    const t   = (s.correct || 0) + (s.wrong || 0);
    const pct = t ? s.correct / t : 0;
    return (t >= 2 && pct < 0.6) || ((s.wrong || 0) >= 2 && !s.mastered);
  });
}
function shouldLevelUp(words, prog) {
  const L = prog.currentLevel || 1;
  if (L >= 3) return false;
  const lw = words.filter(w => Number(w.level) === Number(L));
  if (!lw.length) return false;
  let mastered = 0, attempted = 0;
  for (const w of lw) {
    const s = prog.wordStats?.[wordKey(w)];
    if (!s) continue;
    attempted++;
    if (s.mastered) mastered++;
  }
  const overallAcc = prog.accuracy?.total ? (prog.accuracy.correct / prog.accuracy.total) : 0;
  return (mastered / lw.length) >= 0.7 && overallAcc >= 0.65 && attempted >= 10;
}

// ─── FIX 1: Question type rotation ───────────────────────────────────────────
// Rotates through 4 types based on how many times the word has been seen:
//   0 → multiple_choice   (word shown → pick definition)
//   1 → swedish_english   (Swedish shown → pick English word)
//   2 → fill_blank        (sentence with blank → pick word)
//   3 → type_word         (definition shown → type the word)
//   4+ continues rotating
function pickQuestionType(stat) {
  const seen = stat?.seen || 0;
  const types = ["multiple_choice", "swedish_english", "fill_blank", "type_word"];
  return types[seen % 4];
}

// ─── Speech ───────────────────────────────────────────────────────────────────
function speak(text, lang) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u   = new SpeechSynthesisUtterance(text);
  u.lang    = lang;
  u.rate    = 0.85;
  const vs  = window.speechSynthesis.getVoices();
  const v   = vs.find(v => v.lang === lang) || vs.find(v => v.lang.startsWith(lang.split("-")[0]));
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

// ─── UI Primitives ────────────────────────────────────────────────────────────
function Card({ children, style }) { return <div className="card" style={style}>{children}</div>; }
function Badge({ label, value }) {
  return (
    <div className="badge">
      <div className="badgeVal">{value}</div>
      <div className="badgeLab">{label}</div>
    </div>
  );
}
function Header() {
  return (
    <div style={{ textAlign: "center", marginBottom: 16 }}>
      <div style={{ fontSize: 46, marginBottom: 6 }}>🌿</div>
      <div className="h1">Word <span className="garden">Garden</span></div>
      <div className="subtitle">Grow your English vocabulary</div>
    </div>
  );
}

// FIX 5: SpeakButtons with autoPlay prop — triggers US pronunciation on mount
function SpeakButtons({ word, autoPlay = false }) {
  const [active, setActive] = useState(null);
  useEffect(() => {
    if (!autoPlay || !word) return;
    const t = setTimeout(() => {
      speak(word, "en-US");
      setActive("us");
      setTimeout(() => setActive(null), 1200);
    }, 500);
    return () => clearTimeout(t);
  }, [word, autoPlay]);
  const handle = (lang, key) => {
    setActive(key);
    speak(word, lang);
    setTimeout(() => setActive(null), 1000);
  };
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <button className={`miniBtn${active === "us" ? " miniBtnActive" : ""}`} onClick={() => handle("en-US", "us")}>🔈 US</button>
      <button className={`miniBtn${active === "gb" ? " miniBtnActive" : ""}`} onClick={() => handle("en-GB", "gb")}>🔈 GB</button>
    </div>
  );
}

// ─── FIX 2: Review Card shown after every answer ──────────────────────────────
function ReviewCard({ word, correct, onNext }) {
  return (
    <div className={`reviewCard ${correct ? "reviewCorrect" : "reviewWrong"}`}>
      <div style={{ fontWeight: 900, fontSize: 16 }}>
        {correct ? "✅ Correct!" : `❌ The answer was "${word.word}"`}
      </div>
      <div className="reviewBody">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="reviewWord">{word.word}</span>
          {/* Auto-play pronunciation only when wrong, to reinforce correct sound */}
          <SpeakButtons word={word.word} autoPlay={!correct} />
        </div>
        <div className="reviewDef">{word.definition}</div>
        <div className="reviewSwedish">🇸🇪 {word.swedish}</div>
        {word.sentence && (
          <div className="reviewSentence">{word.sentence.replace("___", `"${word.word}"`)}</div>
        )}
      </div>
      <button className="btnPrimary" onClick={onNext} style={{ marginTop: 14 }}>Next →</button>
    </div>
  );
}

// ─── Word Intro Screen ────────────────────────────────────────────────────────
function WordIntroScreen({ word, total, idx, onHome, onReady, showNew = true }) {
  return (
    <div className="page"><div className="container">
      <div className="topNav">
        <button className="backBtn" onClick={onHome}>← Home</button>
        <div className="small">{idx + 1}/{total}</div>
      </div>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="label">{showNew ? "✨ New word" : "🔁 Review"}</div>
          <span className="pill pillLevel">Level {word.level}</span>
        </div>
        <div style={{ marginTop: 10 }} className="wordTitle">{word.word}</div>
        {/* FIX 5: autoPlay=true */}
        <SpeakButtons word={word.word} autoPlay={true} />
        <div className="section">
          <div className="sectionTitle">Definition</div>
          <div style={{ marginTop: 6, fontSize: 16 }}>{word.definition}</div>
        </div>
        <div className="section">
          <div className="sectionTitle">🇸🇪 Swedish</div>
          <div style={{ marginTop: 6, fontSize: 16, fontStyle: "italic" }}>{word.swedish}</div>
        </div>
        <div className="section">
          <div className="sectionTitle">Example</div>
          <div style={{ marginTop: 6, fontSize: 16 }}>{word.sentence?.replace("___", `"${word.word}"`)}</div>
        </div>
        <button className="btnPrimary" onClick={onReady}>I'm ready — test me →</button>
      </Card>
    </div></div>
  );
}

// ─── FIX 1: Four question type screens ───────────────────────────────────────

function MCQDefinitionScreen({ word, words, idx, total, onHome, onAnswer }) {
  const choices = useMemo(() => {
    const wrongs = sample(words.filter(x => x.definition && x.word !== word.word), 3).map(x => x.definition);
    return shuffle([word.definition, ...wrongs]);
  }, [word.word]);
  return (
    <div className="page"><div className="container">
      <div className="topNav">
        <button className="backBtn" onClick={onHome}>← Home</button>
        <div className="small">{idx + 1}/{total}</div>
      </div>
      <Card>
        <div className="label">Choose the correct definition</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
          <div className="wordTitle" style={{ fontSize: 40 }}>{word.word}</div>
          <SpeakButtons word={word.word} />
        </div>
        <div style={{ marginTop: 8 }}>
          {choices.map((c, i) => <button key={i} className="choice" onClick={() => onAnswer(c === word.definition)}>{c}</button>)}
        </div>
      </Card>
    </div></div>
  );
}

function SwedishEnglishScreen({ word, words, idx, total, onHome, onAnswer }) {
  const choices = useMemo(() => {
    const wrongs = sample(words.filter(x => x.word && x.word !== word.word), 3).map(x => x.word);
    return shuffle([word.word, ...wrongs]);
  }, [word.word]);
  return (
    <div className="page"><div className="container">
      <div className="topNav">
        <button className="backBtn" onClick={onHome}>← Home</button>
        <div className="small">{idx + 1}/{total}</div>
      </div>
      <Card>
        <div className="label">Translate from Swedish to English</div>
        <div className="wordTitle" style={{ marginTop: 10 }}>{word.swedish}</div>
        <div className="small" style={{ marginTop: 4 }}>What is this word in English?</div>
        <div style={{ marginTop: 12 }}>
          {choices.map((c, i) => <button key={i} className="choice" onClick={() => onAnswer(c === word.word)}>{c}</button>)}
        </div>
      </Card>
    </div></div>
  );
}

function FillBlankScreen({ word, words, idx, total, onHome, onAnswer }) {
  const choices = useMemo(() => {
    const wrongs = sample(words.filter(x => x.word && x.word !== word.word), 3).map(x => x.word);
    return shuffle([word.word, ...wrongs]);
  }, [word.word]);
  return (
    <div className="page"><div className="container">
      <div className="topNav">
        <button className="backBtn" onClick={onHome}>← Home</button>
        <div className="small">{idx + 1}/{total}</div>
      </div>
      <Card>
        <div className="label">Fill in the blank</div>
        <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 22, color: "var(--ink)", lineHeight: 1.6, marginTop: 10 }}>
          {word.sentence?.replace("___", "_____")}
        </div>
        <div className="small" style={{ marginTop: 6 }}>Hint: {word.definition}</div>
        <div style={{ marginTop: 12 }}>
          {choices.map((c, i) => <button key={i} className="choice" onClick={() => onAnswer(c === word.word)}>{c}</button>)}
        </div>
      </Card>
    </div></div>
  );
}

function TypeWordScreen({ word, idx, total, onHome, onAnswer }) {
  const [input, setInput] = useState("");
  const ref = useRef(null);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 100); }, []);
  const submit = () => {
    if (!input.trim()) return;
    onAnswer(input.trim().toLowerCase() === word.word.toLowerCase());
  };
  return (
    <div className="page"><div className="container">
      <div className="topNav">
        <button className="backBtn" onClick={onHome}>← Home</button>
        <div className="small">{idx + 1}/{total}</div>
      </div>
      <Card>
        <div className="label">Type the word that matches this definition</div>
        <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: "var(--ink)", lineHeight: 1.6, marginTop: 10, fontStyle: "italic" }}>
          "{word.definition}"
        </div>
        <div style={{ marginTop: 16 }}>
          <input ref={ref} className="input" value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            placeholder="Type the word…" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck="false" />
        </div>
        <button className="btnPrimary" onClick={submit}>Check →</button>
      </Card>
    </div></div>
  );
}

// ─── FIX 4: Session Summary ───────────────────────────────────────────────────
function SessionSummaryScreen({ correct, total, levelUp, newLevel, onHome }) {
  const pct     = total ? Math.round((correct / total) * 100) : 0;
  const emoji   = pct >= 80 ? "🌸" : pct >= 60 ? "🌿" : "🌱";
  const message = pct >= 80 ? "Brilliant work!" : pct >= 60 ? "Good effort!" : "Keep practising — you're growing!";
  return (
    <div className="page"><div className="container">
      <Card>
        <div style={{ textAlign: "center", padding: "10px 0" }}>
          <div style={{ fontSize: 60, marginBottom: 8 }}>{emoji}</div>
          <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 28, color: "var(--ink)" }}>Session complete!</div>
          <div className="small" style={{ marginTop: 6 }}>{message}</div>
          <div className="row" style={{ margin: "20px 0" }}>
            <Badge label="Correct" value={correct} />
            <Badge label="Total"   value={total} />
            <Badge label="Score"   value={`${pct}%`} />
          </div>
          {levelUp && (
            <div className="cardInner" style={{ marginBottom: 16, background: "#e6f4ea" }}>
              <div style={{ fontWeight: 900, color: "var(--ink)", fontSize: 16 }}>🎉 Level up!</div>
              <div className="small" style={{ marginTop: 4 }}>You've advanced to <strong>{levelName(newLevel)}</strong>!</div>
            </div>
          )}
          <button className="btnPrimary" onClick={onHome} style={{ marginTop: 0 }}>Done →</button>
        </div>
      </Card>
    </div></div>
  );
}

// ─── Learning Flow ────────────────────────────────────────────────────────────
function LearningFlow({ words, prog, setProg, onHome }) {
  const [index,          setIndex]          = useState(0);
  const [phase,          setPhase]          = useState("intro");
  const [session,        setSession]        = useState([]);
  const [lastCorrect,    setLastCorrect]    = useState(false);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [leveledUp,      setLeveledUp]      = useState(false);
  const [newLevel,       setNewLevel]       = useState(null);

  useEffect(() => {
    const level  = prog.currentLevel || 1;
    const due    = getDueReviewWords(words, prog);
    const unseen = getUnseenWords(words, prog, level);
    const pick   = shuffle([...sample(unseen, Math.min(4, unseen.length)), ...sample(due, Math.min(2, due.length))]).slice(0, 6);
    setSession(pick.length ? pick : sample(words.filter(w => Number(w.level) === level), 4));
    setIndex(0);
    setPhase("intro");
    setSessionCorrect(0);
    setLeveledUp(false);
  }, [words.length, prog.currentLevel]);

  const current = session[index];

  const applyAnswer = (correct) => {
    setLastCorrect(correct);
    if (correct) setSessionCorrect(c => c + 1);
    setProg(p => {
      const next    = { ...p };
      next.accuracy = { correct: (p.accuracy?.correct || 0) + (correct ? 1 : 0), total: (p.accuracy?.total || 0) + 1 };
      const k    = wordKey(current);
      const prev = p.wordStats?.[k] || { seen: 0, correct: 0, wrong: 0, mastered: false, nextReviewAt: 0, lastSeenAt: 0 };
      const ns   = { ...prev, seen: (prev.seen||0)+1, correct: (prev.correct||0)+(correct?1:0), wrong: (prev.wrong||0)+(correct?0:1), lastSeenAt: Date.now() };
      const t = ns.correct + ns.wrong;
      if (ns.correct >= 4 && (t ? ns.correct/t : 0) >= 0.8) ns.mastered = true;
      ns.nextReviewAt = scheduleNextReview(ns);
      next.wordStats  = { ...(p.wordStats||{}), [k]: ns };
      if (shouldLevelUp(words, next)) { const nl = clamp((next.currentLevel||1)+1,1,3); next.currentLevel = nl; setLeveledUp(true); setNewLevel(nl); }
      return next;
    });
    setPhase("review");
  };

  const goNext = () => {
    if (index + 1 >= session.length) setPhase("done");
    else { setIndex(i => i + 1); setPhase("intro"); }
  };

  if (!current && phase !== "done") {
    return <div className="page"><div className="container"><Card>
      <div className="topNav"><button className="backBtn" onClick={onHome}>← Home</button></div>
      <div className="small">No words available for this level yet.</div>
    </Card></div></div>;
  }

  if (phase === "done") return <SessionSummaryScreen correct={sessionCorrect} total={session.length} levelUp={leveledUp} newLevel={newLevel} onHome={onHome} />;

  if (phase === "intro") {
    return <WordIntroScreen word={current} idx={index} total={session.length} onHome={onHome} showNew={!prog.wordStats?.[wordKey(current)]} onReady={() => setPhase("quiz")} />;
  }

  if (phase === "review") {
    return <div className="page"><div className="container">
      <div className="topNav"><button className="backBtn" onClick={onHome}>← Home</button><div className="small">{index+1}/{session.length}</div></div>
      <ReviewCard word={current} correct={lastCorrect} onNext={goNext} />
    </div></div>;
  }

  // FIX 1: Route to correct question screen
  if (phase === "quiz") {
    const qtype = pickQuestionType(prog.wordStats?.[wordKey(current)]);
    if (qtype === "swedish_english") return <SwedishEnglishScreen word={current} words={words} idx={index} total={session.length} onHome={onHome} onAnswer={applyAnswer} />;
    if (qtype === "fill_blank")      return <FillBlankScreen      word={current} words={words} idx={index} total={session.length} onHome={onHome} onAnswer={applyAnswer} />;
    if (qtype === "type_word")       return <TypeWordScreen        word={current}               idx={index} total={session.length} onHome={onHome} onAnswer={applyAnswer} />;
    return                                  <MCQDefinitionScreen   word={current} words={words} idx={index} total={session.length} onHome={onHome} onAnswer={applyAnswer} />;
  }
  return null;
}

// ─── Placement Screen ─────────────────────────────────────────────────────────
function PlacementScreen({ words, onDone, onBack }) {
  const [step,    setStep]    = useState(0);
  const [answers, setAnswers] = useState([]);
  const [quiz,    setQuiz]    = useState([]);

  useEffect(() => {
    const L1 = words.filter(w => Number(w.level) === 1);
    const L2 = words.filter(w => Number(w.level) === 2);
    const L3 = words.filter(w => Number(w.level) === 3);
    const q  = [...sample(L1,4).map(w=>({w,level:1})), ...sample(L2,3).map(w=>({w,level:2})), ...sample(L3,3).map(w=>({w,level:3}))].filter(x=>x.w?.definition);
    const built = q.slice(0,10).map(({w,level}) => {
      const wrongs = sample(words.filter(x=>x.definition&&x.word&&x.word!==w.word),3).map(x=>x.word);
      return { level, prompt: w.definition, answer: w.word, choices: shuffle([w.word,...wrongs]) };
    });
    setQuiz(built);
  }, [words.length]);

  const current = quiz[step];

  const choose = (choice) => {
    const correct    = choice === current.answer;
    const newAnswers = [...answers, { level: current.level, correct }];
    setAnswers(newAnswers);
    if (step + 1 >= quiz.length) {
      const s = {1:{c:0,t:0},2:{c:0,t:0},3:{c:0,t:0}};
      newAnswers.forEach(a => { s[a.level].t++; if (a.correct) s[a.level].c++; });
      let level = 1;
      for (const L of [1,2,3]) { if (s[L].t > 0 && s[L].c/s[L].t >= 0.7) level = L; }
      onDone({ level, score: newAnswers.filter(a=>a.correct).length });
    } else {
      setStep(s => s + 1);
    }
  };

  if (!quiz.length) return <div className="page"><div className="container"><Card>
    <div className="topNav"><button className="backBtn" onClick={onBack}>← Back</button></div>
    <div className="small">Not enough words loaded to run the placement test.</div>
  </Card></div></div>;

  if (!current) return null;

  return <div className="page"><div className="container">
    <Card>
      <div className="topNav"><button className="backBtn" onClick={onBack}>← Back</button><div className="small">Question {step+1}/10</div></div>
      <div className="label">What word matches this meaning?</div>
      <div style={{ marginTop:10, fontSize:18, fontWeight:900 }}>"{current.prompt}"</div>
      {current.choices.map(c => <button key={c} className="choice" onClick={()=>choose(c)}>{c}</button>)}
    </Card>
  </div></div>;
}

// ─── Daily Challenge ──────────────────────────────────────────────────────────
// FIX 3: Shows word intro card for words the child has never seen before
function DailyChallengeScreen({ words, prog, setProg, onHome }) {
  const date   = todayStr();
  const record = prog.daily?.[date] || { done: false, correct: 0, total: 0 };

  const [step,          setStep]          = useState(0);
  const [phase,         setPhase]         = useState("init");
  const [session,       setSession]       = useState([]);
  const [lastCorrect,   setLastCorrect]   = useState(false);
  const [sessionCorrect,setSessionCorrect]= useState(0);

  useEffect(() => {
    if (record.done) { setPhase("done"); return; }
    const due    = getDueReviewWords(words, prog);
    const unseen = getUnseenWords(words, prog, prog.currentLevel || 1);
    const pick   = shuffle([...sample(due,Math.min(2,due.length)), ...sample(unseen,Math.min(3,unseen.length))]).slice(0,5);
    setSession(pick);
    setStep(0);
    setPhase(pick.length ? "start" : "empty");
    setSessionCorrect(0);
  }, [words.length]);

  // Decide intro or quiz for first/current word
  useEffect(() => {
    if (phase !== "start") return;
    const cur   = session[step];
    if (!cur) return;
    const isNew = !prog.wordStats?.[wordKey(cur)];
    setPhase(isNew ? "intro" : "quiz");
  }, [phase, step, session.length]);

  const current = session[step];

  const mark = (correct) => {
    setLastCorrect(correct);
    if (correct) setSessionCorrect(c => c + 1);
    setProg(p => {
      const next    = { ...p };
      next.accuracy = { correct:(p.accuracy?.correct||0)+(correct?1:0), total:(p.accuracy?.total||0)+1 };
      const k    = wordKey(current);
      const prev = p.wordStats?.[k] || { seen:0, correct:0, wrong:0, mastered:false, nextReviewAt:0, lastSeenAt:0 };
      const ns   = { ...prev, seen:(prev.seen||0)+1, correct:(prev.correct||0)+(correct?1:0), wrong:(prev.wrong||0)+(correct?0:1), lastSeenAt:Date.now() };
      const t = ns.correct + ns.wrong;
      if (ns.correct>=4 && (t?ns.correct/t:0)>=0.8) ns.mastered = true;
      ns.nextReviewAt = scheduleNextReview(ns);
      next.wordStats = { ...(p.wordStats||{}), [k]: ns };
      const dr  = { ...(p.daily||{}) };
      const cur2 = dr[date] || { done:false, correct:0, total:0 };
      dr[date]   = { ...cur2, correct:cur2.correct+(correct?1:0), total:cur2.total+1, done:step+1>=5 };
      next.daily = dr;
      return next;
    });
    setPhase("review");
  };

  const goNext = () => {
    if (step + 1 >= session.length) setPhase("done");
    else { setStep(s => s+1); setPhase("start"); }
  };

  if (phase === "done") {
    const final = prog.daily?.[date] || { correct: sessionCorrect, total: 5 };
    return <div className="page"><div className="container"><Card>
      <div style={{ textAlign:"center", padding:"10px 0" }}>
        <div style={{ fontSize:52 }}>🌸</div>
        <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:28, marginTop:8 }}>Bloomed!</div>
        <div className="small" style={{ marginTop:6 }}>Today's challenge: <strong>{final.correct||sessionCorrect}/{final.total||5}</strong></div>
        <button className="btnPrimary" onClick={onHome} style={{ marginTop:20 }}>Done →</button>
      </div>
    </Card></div></div>;
  }

  if (phase === "empty" || (!current && phase !== "done")) {
    return <div className="page"><div className="container"><Card>
      <div className="topNav"><button className="backBtn" onClick={onHome}>← Home</button></div>
      <div className="small">Not enough words yet. Keep learning!</div>
    </Card></div></div>;
  }

  // FIX 3: Show intro for brand-new words
  if (phase === "intro" && current) {
    return <WordIntroScreen word={current} idx={step} total={session.length} onHome={onHome} showNew={true} onReady={() => setPhase("quiz")} />;
  }

  if (phase === "review" && current) {
    return <div className="page"><div className="container">
      <div className="topNav"><button className="backBtn" onClick={onHome}>← Home</button><div className="small">{step+1}/{session.length} · Daily</div></div>
      <ReviewCard word={current} correct={lastCorrect} onNext={goNext} />
    </div></div>;
  }

  if (phase === "quiz" && current) {
    const choices = (() => {
      const wrongs = sample(words.filter(x=>x.definition&&x.word!==current.word),3).map(x=>x.definition);
      return shuffle([current.definition,...wrongs]);
    })();
    return <div className="page"><div className="container">
      <Card>
        <div className="topNav"><button className="backBtn" onClick={onHome}>← Home</button><div className="small">{step+1}/5 · Daily</div></div>
        <div className="label">Daily challenge</div>
        <div className="wordTitle" style={{ fontSize:38, marginTop:8 }}>{current.word}</div>
        <SpeakButtons word={current.word} />
        <div className="small" style={{ marginTop:10 }}>Choose the correct definition:</div>
        {choices.map((c,i) => <button key={i} className="choice" onClick={() => mark(c===current.definition)}>{c}</button>)}
      </Card>
    </div></div>;
  }

  return null;
}

// ─── Weak Words Screen ────────────────────────────────────────────────────────
function WeakWordsScreen({ words, prog, setProg, onHome }) {
  const pool = useMemo(() => shuffle(getWeakWords(words, prog)).slice(0,8), [words, prog]);
  const [step,        setStep]        = useState(0);
  const [phase,       setPhase]       = useState("quiz");
  const [lastCorrect, setLastCorrect] = useState(false);
  const current = pool[step];

  const mark = (correct) => {
    setLastCorrect(correct);
    setProg(p => {
      const next = { ...p };
      next.accuracy = { correct:(p.accuracy?.correct||0)+(correct?1:0), total:(p.accuracy?.total||0)+1 };
      const k    = wordKey(current);
      const prev = p.wordStats?.[k] || { seen:0,correct:0,wrong:0,mastered:false,nextReviewAt:0,lastSeenAt:0 };
      const ns   = { ...prev, seen:(prev.seen||0)+1, correct:(prev.correct||0)+(correct?1:0), wrong:(prev.wrong||0)+(correct?0:1), lastSeenAt:Date.now() };
      const t = ns.correct+ns.wrong;
      if (ns.correct>=4&&(t?ns.correct/t:0)>=0.8) ns.mastered=true;
      ns.nextReviewAt=scheduleNextReview(ns);
      next.wordStats={...(p.wordStats||{}),[k]:ns};
      return next;
    });
    setPhase("review");
  };

  const goNext = () => {
    if (step+1>=pool.length) setStep(pool.length);
    else { setStep(s=>s+1); setPhase("quiz"); }
  };

  if (!pool.length) return <div className="page"><div className="container"><Card>
    <div className="topNav"><button className="backBtn" onClick={onHome}>← Home</button></div>
    <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:26 }}>All good 🌿</div>
    <div className="small" style={{ marginTop:8 }}>No weak words right now. Keep practising!</div>
  </Card></div></div>;

  if (!current) return <div className="page"><div className="container"><Card>
    <div className="topNav"><button className="backBtn" onClick={onHome}>← Home</button></div>
    <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:26 }}>Done 🌱</div>
    <div className="small" style={{ marginTop:8 }}>Weak-word practice finished. Great effort!</div>
    <button className="btnPrimary" onClick={onHome}>Done →</button>
  </Card></div></div>;

  if (phase === "review") return <div className="page"><div className="container">
    <div className="topNav"><button className="backBtn" onClick={onHome}>← Home</button><div className="small">{step+1}/{pool.length} · Weak words</div></div>
    <ReviewCard word={current} correct={lastCorrect} onNext={goNext} />
  </div></div>;

  const choices = (() => {
    const wrongs = sample(words.filter(x=>x.definition&&x.word!==current.word),3).map(x=>x.definition);
    return shuffle([current.definition,...wrongs]);
  })();
  return <div className="page"><div className="container">
    <Card>
      <div className="topNav"><button className="backBtn" onClick={onHome}>← Home</button><div className="small">{step+1}/{pool.length} · Weak words</div></div>
      <div className="label">Practice your weak words</div>
      <div className="wordTitle" style={{ fontSize:38, marginTop:8 }}>{current.word}</div>
      <SpeakButtons word={current.word} />
      <div className="small" style={{ marginTop:10 }}>Choose the correct definition:</div>
      {choices.map((c,i) => <button key={i} className="choice" onClick={() => mark(c===current.definition)}>{c}</button>)}
    </Card>
  </div></div>;
}

// ─── Progress Screen ──────────────────────────────────────────────────────────
function ProgressScreen({ prog, words, onHome, onRetakePlacement, onParentMode }) {
  const mastered = masteredCount(prog);
  const acc      = computeAccuracy(prog.accuracy);

  const perLevel = useMemo(() => {
    const out = {1:{total:0,mastered:0},2:{total:0,mastered:0},3:{total:0,mastered:0}};
    for (const w of words) { const L=Number(w.level)||1; out[L].total++; if (prog.wordStats?.[wordKey(w)]?.mastered) out[L].mastered++; }
    return out;
  }, [words, prog]);

  const wordRows = useMemo(() =>
    words.filter(w=>prog.wordStats?.[wordKey(w)])
      .map(w=>({w,s:prog.wordStats[wordKey(w)]}))
      .sort((a,b)=>(b.s.lastSeenAt||0)-(a.s.lastSeenAt||0))
      .slice(0,30)
  , [words, prog]);

  const confidenceDot = s => {
    const t=((s.correct||0)+(s.wrong||0)), pct=t?s.correct/t:0;
    if (t<2)      return "dotRed";
    if (pct>=0.8) return "dotGreen";
    if (pct>=0.5) return "dotYellow";
    return "dotRed";
  };

  return <div className="page"><div className="container">
    <button className="backBtn" onClick={onHome}>← Back</button>
    <div style={{ marginTop:8, marginBottom:12, fontFamily:"'DM Serif Display',serif", fontSize:30, color:"var(--ink)" }}>Your Progress</div>
    <Card>
      <div className="row"><Badge label="Mastered" value={mastered}/><Badge label="Streak" value={`${prog.streak}d`}/><Badge label="Accuracy" value={`${acc}%`}/></div>
      <div className="small" style={{marginTop:16}}>Overall ({mastered}/{words.length})</div>
      <div className="progressLine"><div className="progressFill" style={{width:`${words.length?Math.round((mastered/words.length)*100):0}%`}}/></div>
      {[1,2,3].map(lvl=>(
        <div key={lvl}>
          <div className="small" style={{marginTop:12}}>{levelName(lvl)} — {perLevel[lvl].mastered}/{perLevel[lvl].total}</div>
          <div className="progressLine"><div className="progressFill" style={{width:`${perLevel[lvl].total?Math.round((perLevel[lvl].mastered/perLevel[lvl].total)*100):0}%`, background:["#2f5a40","#5a7c9a","#9a5a7c"][lvl-1]}}/></div>
        </div>
      ))}
      <div className="hr"/>
      <div className="label">Placement test history</div>
      <div style={{marginTop:8}}>
        {(prog.placementHistory||[]).slice(-5).reverse().map((h,i)=>(
          <div key={i} className="kvRow" style={{padding:"6px 0"}}><div className="small">{h.date}</div><div className="small"><b>{h.score}/10</b> → {levelName(h.level)}</div></div>
        ))}
        {!(prog.placementHistory?.length) && <div className="small" style={{marginTop:6}}>No placement tests yet.</div>}
      </div>
      <div className="hr"/>
      <div className="label">Word by word (recent 30)</div>
      <table className="table"><tbody>
        {wordRows.map(({w,s})=>{
          const t=(s.correct||0)+(s.wrong||0);
          return <tr key={wordKey(w)} className="tr">
            <td className="td" style={{fontWeight:900}}>{w.word}</td>
            <td className="td" style={{textAlign:"right"}}>
              <button className="miniBtn miniBtnMuted" onClick={()=>speak(w.word,"en-US")}>🔈 US</button>{" "}
              <button className="miniBtn miniBtnMuted" onClick={()=>speak(w.word,"en-GB")}>🔈 GB</button>
            </td>
            <td className="td" style={{textAlign:"right",fontWeight:800}}>{s.correct||0}/{t}</td>
            <td className="td" style={{width:30}}><span className={`dot ${confidenceDot(s)}`}/></td>
          </tr>;
        })}
      </tbody></table>
      <button className="btnSecondary" onClick={onRetakePlacement}>Retake Placement Test</button>
      <button className="btnGhost"     onClick={onParentMode}>Parent mode</button>
    </Card>
  </div></div>;
}

// ─── Parent Gate ──────────────────────────────────────────────────────────────
function ParentGate({ onUnlock, onBack }) {
  const [pw,  setPw]  = useState("");
  const [err, setErr] = useState("");
  const attempt = () => {
    const stored = sessionStorage.getItem("wg_parent_pw");
    if (!pw.trim()) { setErr("Please enter a password."); return; }
    if (!stored) { sessionStorage.setItem("wg_parent_pw", pw); onUnlock(pw); }
    else if (pw === stored) { onUnlock(pw); }
    else { setErr("Incorrect password."); }
  };
  return <div className="page"><div className="container">
    <div className="topNav"><button className="backBtn" onClick={onBack}>← Back</button></div>
    <Card>
      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:28}}>Parent mode</div>
      <div className="small" style={{marginTop:6}}>Enter your parent password to continue.</div>
      <div className="hr"/>
      <input className="input" type="password" value={pw} onChange={e=>{setPw(e.target.value);setErr("");}}
        onKeyDown={e=>e.key==="Enter"&&attempt()} placeholder="Parent password" autoFocus/>
      {err && <div className="small" style={{color:"#d7263d",marginTop:8}}>{err}</div>}
      <button className="btnPrimary" onClick={attempt}>Unlock</button>
      <div className="small" style={{marginTop:10}}>The first password you enter becomes the parent password on this device.</div>
    </Card>
  </div></div>;
}

function ParentModeScreen({ prog, words, onBack, onGenerate, generateStatus, onResetChild }) {
  return <div className="page"><div className="container">
    <div className="topNav"><button className="backBtn" onClick={onBack}>← Home</button><div className="pill">Parent mode</div></div>
    <Card>
      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:28}}>Parent dashboard</div>
      <div className="small" style={{marginTop:6}}>Overview and controls.</div>
      <div className="row" style={{marginTop:14}}>
        <Badge label="Total words" value={words.length}/>
        <Badge label="Mastered"    value={masteredCount(prog)}/>
        <Badge label="Weak"        value={getWeakWords(words,prog).length}/>
      </div>
      <div className="hr"/>
      <div className="label">Controls</div>
      <button className="btnPrimary"   onClick={onGenerate}>Generate 12 words for current level</button>
      {generateStatus && <div className="small" style={{marginTop:10}}><b>Status:</b> {generateStatus}</div>}
      <button className="btnSecondary" onClick={onResetChild}>Reset child progress (this device)</button>
      <div className="small" style={{marginTop:10}}>Generation requires the admin password (checked server-side).</div>
    </Card>
  </div></div>;
}

// ─── Home Screen ──────────────────────────────────────────────────────────────
function HomeScreen({ prog, wordsCount, onStart, onProgress, onDaily, onWeak, onPlacement, onSkipPlacement }) {
  const pct       = wordsCount ? Math.round((masteredCount(prog)/wordsCount)*100) : 0;
  const dailyDone = prog.daily?.[todayStr()]?.done;
  return <div className="page"><div className="container">
    <Header/>
    <Card>
      <div className="row">
        <Badge label="Mastered" value={masteredCount(prog)}/>
        <Badge label="Streak"   value={`${prog.streak}d`}/>
        <Badge label="Accuracy" value={`${computeAccuracy(prog.accuracy)}%`}/>
      </div>
      <div className="small" style={{marginTop:14}}>Progress — {masteredCount(prog)} of {wordsCount} words mastered</div>
      <div className="progressLine"><div className="progressFill" style={{width:`${pct}%`}}/></div>
      {!prog.placementDone ? (
        <>
          <div className="cardInner" style={{marginTop:14}}>
            <div style={{fontWeight:900,color:"var(--ink)"}}>Start with a placement test</div>
            <div className="small" style={{marginTop:6}}>A quick 10-question test finds the right starting level for you.</div>
          </div>
          <button className="btnPrimary"   onClick={onPlacement}>Take Placement Test →</button>
          <button className="btnSecondary" onClick={onSkipPlacement}>Skip — Start at Level 1</button>
        </>
      ) : (
        <>
          <div className="kvRow" style={{marginTop:10}}>
            <div className="small">Current level</div>
            <strong>{levelName(prog.currentLevel||1)}</strong>
          </div>
          <button className="btnPrimary"   onClick={onStart}>Start Learning</button>
          <button className="btnSecondary" onClick={onProgress}>View Progress →</button>
          <button className="btnGhost"     onClick={onDaily}>{dailyDone?"✅ Daily challenge done":"Daily challenge (5)"}</button>
          <button className="btnGhost"     onClick={onWeak}>Practice weak words</button>
          <div className="small" style={{textAlign:"center",marginTop:12}}>Build {BUILD_ID}</div>
        </>
      )}
    </Card>
  </div></div>;
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [prog,           setProg]           = useState(() => loadProgress() || freshProgress());
  const [words,          setWords]          = useState([]);
  const [view,           setView]           = useState("loading");
  const [toast,          setToast]          = useState("");
  const [adminPw,        setAdminPw]        = useState(() => sessionStorage.getItem("wg_admin_pw") || "");
  const [generateStatus, setGenerateStatus] = useState("");

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(""), 3500); };

  const refreshWords = async () => {
    try { setWords(await apiListWords()); }
    catch (e) { showToast(String(e?.message||e)); }
  };

  useEffect(() => {
    const t = todayStr();
    if (prog.lastDate !== t) {
      const yest = new Date(Date.now()-86400000).toISOString().slice(0,10);
      const next = { ...prog, lastDate:t, streak: prog.lastDate===yest ? prog.streak+1 : 1 };
      setProg(next); saveProgress(next);
    }
  }, []);

  useEffect(() => { saveProgress(prog); }, [prog]);
  useEffect(() => { (async()=>{ await refreshWords(); setView("home"); })(); }, []);

  const onPlacementDone = ({ level, score }) => {
    setProg(p => ({ ...p, placementDone:true, currentLevel:clamp(level,1,3), placementHistory:[...(p.placementHistory||[]),{date:todayStr(),score,level}] }));
    setView("home");
  };

  const doGenerate = async () => {
    let pw = adminPw.trim() || sessionStorage.getItem("wg_admin_pw") || "";
    if (!pw) { pw = prompt("Enter admin password:"); if (!pw) return; sessionStorage.setItem("wg_admin_pw",pw); setAdminPw(pw); }
    setGenerateStatus("Working…");
    try {
      const out = await apiGenerateWords({ level:prog.currentLevel||1, existingWords:words.map(w=>String(w.word||"")), password:pw });
      setGenerateStatus(`Generated/saved ${Array.isArray(out)?out.length:0} words.`);
      await refreshWords();
    } catch(e) { setGenerateStatus(String(e?.message||e)); }
  };

  const resetChild = () => {
    if (!confirm("Reset all progress on this device?")) return;
    const next = freshProgress(); setProg(next); saveProgress(next); setView("home");
  };

  if (view==="loading") return <div className="page"><div className="container"><Card><div className="small">Loading…</div></Card></div></div>;
  if (view==="placement") return <PlacementScreen      words={words} onDone={onPlacementDone} onBack={()=>setView("home")}/>;
  if (view==="learn")     return <LearningFlow         words={words} prog={prog} setProg={setProg} onHome={()=>setView("home")}/>;
  if (view==="daily")     return <DailyChallengeScreen words={words} prog={prog} setProg={setProg} onHome={()=>setView("home")}/>;
  if (view==="weak")      return <WeakWordsScreen      words={words} prog={prog} setProg={setProg} onHome={()=>setView("home")}/>;
  if (view==="progress")  return <ProgressScreen prog={prog} words={words} onHome={()=>setView("home")} onRetakePlacement={()=>setView("placement")} onParentMode={()=>setView("parentGate")}/>;
  if (view==="parentGate")return <ParentGate     onBack={()=>setView("progress")} onUnlock={()=>setView("parent")}/>;
  if (view==="parent")    return <ParentModeScreen prog={prog} words={words} onBack={()=>setView("home")} onGenerate={doGenerate} generateStatus={generateStatus} onResetChild={resetChild}/>;

  return <>
    <HomeScreen prog={prog} wordsCount={words.length}
      onStart={()         =>setView("learn")}
      onProgress={()      =>setView("progress")}
      onDaily={()         =>setView("daily")}
      onWeak={()          =>setView("weak")}
      onPlacement={()     =>setView("placement")}
      onSkipPlacement={() =>{ setProg(p=>({...p,placementDone:true,currentLevel:1})); setView("home"); }}
    />
    {toast && <div style={{position:"fixed",left:12,right:12,bottom:12}}>
      <div className="card" style={{padding:14}}><div style={{fontWeight:900}}>Note</div><div className="small" style={{marginTop:6}}>{toast}</div></div>
    </div>}
  </>;
}
