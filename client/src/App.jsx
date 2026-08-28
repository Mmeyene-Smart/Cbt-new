import { useCallback, useEffect, useRef, useState } from "react";
import AuthScreen from "./screens/AuthScreen.jsx";
import { getUser, setSession, clearSession, api, getToken } from "./lib/api.js";
import { getSocket, destroySocket } from "./lib/socket.js";
import useCamera from "./hooks/useCamera.js";
import useScreenShare from "./hooks/useScreenShare.js";
import { LogOut, Users, BookOpen, BarChart3, Video, Plus, Eye, Clock, CheckCircle, XCircle, Camera, Monitor, AlertTriangle, Sun, Moon } from "lucide-react";

export default function App(){
  const [user,setUser]=useState(getUser());
  if(!user) return <AuthScreen onAuth={(t,u)=>{setSession(t,u); setUser(u);}} />;
  return user.role==="admin" ? <AdminShell user={user} onLogout={doLogout(setUser)} /> : <StudentShell user={user} onLogout={doLogout(setUser)} />;
}
function doLogout(setUser){ return ()=>{ destroySocket(); clearSession(); setUser(null); } }

// ===== Admin =====
function AdminShell({user,onLogout}){
  const [tab,setTab]=useState("dashboard");
  const [theme,setTheme]=useState(()=> localStorage.getItem("cbt.theme") || "light");
  useEffect(()=>{
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("cbt.theme", theme);
  },[theme]);
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-white/5 bg-panel/70 backdrop-blur px-6">
        <span className="font-display font-bold text-gradient">CBT Admin</span>
        <div className="flex items-center gap-3">
          <nav className="hidden md:flex gap-2 text-sm">
            {["dashboard","exams","students","results","proctor"].map(t=>(
              <button key={t} onClick={()=>setTab(t)} className={`px-3 py-1.5 rounded-lg capitalize ${tab===t?"bg-white/10 text-white":"text-zinc-400 hover:text-white"}`}>{t}</button>
            ))}
          </nav>
          <span className="text-sm text-zinc-400">{user.username}</span>
          <button onClick={()=>setTheme(theme==="light"?"dark":"light")} aria-label="Toggle theme" title={`Switch to ${theme==="light"?"dark":"light"} mode`} className="p-2 rounded-lg hover:bg-white/10">
            {theme==="light" ? <Moon className="h-4 w-4"/> : <Sun className="h-4 w-4"/>}
          </button>
          <button onClick={onLogout} className="p-2 rounded-lg hover:bg-white/10"><LogOut className="h-4 w-4"/></button>
        </div>
      </header>
      <div className="md:hidden flex gap-2 p-3 border-b border-white/5 overflow-auto">
        {["dashboard","exams","students","results","proctor"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} className={`px-3 py-1.5 rounded-lg text-sm capitalize shrink-0 ${tab===t?"bg-white/10 text-white":"text-zinc-400"}`}>{t}</button>
        ))}
      </div>
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {tab==="dashboard" && <AdminDashboard/>}
        {tab==="exams" && <ExamsAdmin/>}
        {tab==="students" && <StudentsAdmin/>}
        {tab==="results" && <ResultsAdmin/>}
        {tab==="proctor" && <ProctorWall/>}
      </main>
    </div>
  );
}

function AdminDashboard(){
  const [stats,setStats]=useState(null);
  useEffect(()=>{
    Promise.all([api("/api/students"), api("/api/exams"), api("/api/results")]).then(([students,exams,results])=>{
      setStats({students:students.length, exams:exams.length, attempts:results.length});
    }).catch(()=>{});
  },[]);
  if(!stats) return <p className="text-zinc-500">Loading…</p>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {[
        ["Students", stats.students, Users],
        ["Exams", stats.exams, BookOpen],
        ["Attempts", stats.attempts, BarChart3],
      ].map(([label,val,Icon])=>(
        <div key={label} className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between"><p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p><Icon className="h-5 w-5 text-zinc-500"/></div>
          <p className="mt-2 font-display text-3xl font-bold">{val}</p>
        </div>
      ))}
      <div className="md:col-span-3 glass rounded-2xl p-6">
        <h3 className="font-semibold">Quick start</h3>
        <ul className="mt-2 text-sm text-zinc-400 list-disc pl-5 space-y-1">
          <li>Create an exam in Exams → add questions</li>
          <li>Students log in as mmeyene/student123 and take it — camera snapshots stream to Proctor tab live</li>
          <li>Results appear instantly after submit; Combined analysis in Results</li>
        </ul>
      </div>
    </div>
  );
}

function ExamsAdmin(){
  const [exams,setExams]=useState([]);
  const [title,setTitle]=useState(""); const [subject,setSubject]=useState("General"); const [duration,setDuration]=useState(15);
  const [selected,setSelected]=useState(null); const [qs,setQs]=useState([]);
  const [qPrompt,setQPrompt]=useState(""); const [qOptions,setQOptions]=useState("A,B,C,D"); const [qAnswer,setQAnswer]=useState("A"); const [qType,setQType]=useState("mcq");
  const load=useCallback(()=> api("/api/exams").then(setExams),[]);
  useEffect(()=>{load();},[load]);
  const create=async(e)=>{
    e.preventDefault();
    await api("/api/exams",{method:"POST", body:{title, subject, duration_minutes:Number(duration)}});
    setTitle(""); load();
  };
  const openExam=async(id)=>{
    const data=await api(`/api/exams/${id}`);
    setSelected(data.exam);
    setQs(data.questions);
  };
  const addQ=async()=>{
    const opts = qOptions.split(",").map(s=>s.trim()).filter(Boolean);
    const ans = qAnswer.split(",").map(s=>s.trim()).filter(Boolean);
    await api(`/api/exams/${selected.id}/questions`,{method:"POST", body:{type:qType, prompt:qPrompt, options:opts, answer:ans}});
    const data=await api(`/api/exams/${selected.id}`);
    setQs(data.questions); setQPrompt("");
  };
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <form onSubmit={create} className="glass rounded-2xl p-5 space-y-3">
          <h3 className="font-semibold flex items-center gap-2"><Plus className="h-4 w-4"/> New Exam</h3>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Title" required className="w-full rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm outline-none focus:border-[var(--a1)]"/>
          <div className="grid grid-cols-2 gap-3">
            <input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Subject" className="rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm outline-none"/>
            <input type="number" value={duration} onChange={e=>setDuration(e.target.value)} placeholder="Minutes" className="rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm outline-none"/>
          </div>
          <button className="grad-bg w-full rounded-xl py-2 font-semibold text-night">Create</button>
        </form>
        <div className="glass rounded-2xl p-4">
          <h4 className="font-semibold mb-3 text-sm">Exams</h4>
          <ul className="space-y-2">
            {exams.map(e=>(
              <li key={e.id} className={`flex items-center justify-between rounded-xl px-3 py-2 ${selected?.id===e.id?"bg-white/10":"hover:bg-white/5"}`}>
                <div><p className="text-sm font-medium">{e.title}</p><p className="text-xs text-zinc-500">{e.subject} · {e.duration_minutes}m · {e.question_count} Qs</p></div>
                <button onClick={()=>openExam(e.id)} className="p-2 hover:bg-white/10 rounded-lg"><Eye className="h-4 w-4"/></button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="glass rounded-2xl p-5">
        {!selected ? <p className="text-zinc-500 text-sm">Select an exam to manage questions.</p> : (
          <>
            <h3 className="font-semibold">{selected.title}</h3>
            <p className="text-xs text-zinc-500 mb-3">{selected.subject}</p>
            <ul className="space-y-2 mb-4 max-h-64 overflow-auto pr-1">
              {qs.map((q,i)=>(
                <li key={q.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  <p className="text-sm"><span className="text-zinc-500">{i+1}.</span> {q.prompt} <span className="text-xs text-zinc-500">[{q.type}]</span></p>
                  <p className="text-xs text-zinc-500 mt-1">Options: {(Array.isArray(q.options) ? q.options : JSON.parse(q.options)).join(", ")} · Answer: {(Array.isArray(q.answer) ? q.answer : JSON.parse(q.answer)).join(", ")}</p>
                </li>
              ))}
              {!qs.length && <p className="text-xs text-zinc-600">No questions yet.</p>}
            </ul>
            <div className="space-y-2 border-t border-white/5 pt-3">
              <div className="flex gap-2">
                <button onClick={async()=>{
                  try{
                    const token = localStorage.getItem("cbt.token");
                    const res = await fetch(`/api/exams/template.xlsx`, { headers: { Authorization: `Bearer ${token}` }});
                    if(!res.ok) throw new Error("Failed to download template");
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = "questions_template.xlsx"; a.click();
                    URL.revokeObjectURL(url);
                  }catch(e){ alert(e.message); }
                }} className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2 text-xs hover:bg-white/10">Download Excel Template</button>
                <label className="flex-1 cursor-pointer rounded-xl border border-white/10 bg-white/5 py-2 text-xs text-center hover:bg-white/10">
                  Upload Excel
                  <input type="file" accept=".xlsx,.xls" className="hidden" onChange={async(e)=>{
                    const file = e.target.files[0];
                    if(!file) return;
                    const fd = new FormData();
                    fd.append("file", file);
                    try{
                      const res = await fetch(`/api/exams/${selected.id}/questions/import`, {
                        method: "POST",
                        headers: { Authorization: `Bearer ${localStorage.getItem("cbt.token")}` },
                        body: fd
                      });
                      const data = await res.json();
                      if(!res.ok) throw new Error(data.error || "Import failed");
                      alert(`Imported ${data.imported} questions` + (data.errors?.length ? `\n${data.errors.length} rows had errors:\n` + data.errors.map(er=>`Row ${er.row}: ${er.reason}`).join("\n") : ""));
                      const refreshed = await api(`/api/exams/${selected.id}`);
                      setQs(refreshed.questions);
                    }catch(err){ alert(err.message); }
                    e.target.value = "";
                  }}/>
                </label>
              </div>
              <select value={qType} onChange={e=>setQType(e.target.value)} className="w-full rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm">
                <option value="mcq">MCQ (single)</option><option value="multi">Multi-select</option><option value="tf">True/False</option>
              </select>
              <input value={qPrompt} onChange={e=>setQPrompt(e.target.value)} placeholder="Question prompt" className="w-full rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm outline-none"/>
              <input value={qOptions} onChange={e=>setQOptions(e.target.value)} placeholder="Options comma-separated" className="w-full rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm outline-none"/>
              <input value={qAnswer} onChange={e=>setQAnswer(e.target.value)} placeholder="Answer(s) comma-separated (exact option text)" className="w-full rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm outline-none"/>
              <button onClick={addQ} className="w-full rounded-xl border border-white/10 bg-white/5 py-2 text-sm hover:bg-white/10">Add question</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StudentsAdmin(){
  const [students,setStudents]=useState([]);
  useEffect(()=>{ api("/api/students").then(setStudents).catch(()=>{}); },[]);
  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="font-semibold flex items-center gap-2"><Users className="h-4 w-4"/> Students ({students.length})</h3>
      <div className="mt-4 overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-zinc-500"><tr><th className="text-left p-2">Username</th><th className="text-left p-2">Full name</th><th className="text-left p-2">Code</th><th className="text-left p-2">Subjects</th></tr></thead>
          <tbody>{students.map(s=>(
            <tr key={s.id} className="border-t border-white/5"><td className="p-2">{s.username}</td><td className="p-2">{s.full_name}</td><td className="p-2 text-zinc-500">{s.student_code}</td><td className="p-2"><div className="flex flex-wrap gap-1 max-w-[280px]">{(s.subjects||[]).map(sub=>(<span key={sub} className="rounded-md bg-white/5 px-2 py-0.5 text-xs text-zinc-400 ring-1 ring-white/10">{sub}</span>))}{!(s.subjects||[]).length && <span className="text-xs text-zinc-600">—</span>}</div></td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function ResultsAdmin(){
  const [exams,setExams]=useState([]); const [selected,setSelected]=useState(""); const [rows,setRows]=useState([]); const [combined,setCombined]=useState(null);
  useEffect(()=>{ api("/api/exams").then(setExams); api("/api/results").then(setRows); },[]);
  const loadExam = async(id)=>{
    setSelected(id);
    const data=await api(`/api/results?examId=${id}`);
    setRows(data);
  };
  const loadCombined=async()=>{
    if(!exams.length) return;
    const ids=exams.slice(0,2).map(e=>e.id).join(",");
    const data=await api(`/api/results/combined?examIds=${ids}`);
    setCombined(data);
  };
  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl p-4 flex flex-wrap gap-2 items-center">
        <span className="text-sm text-zinc-400">Filter by exam:</span>
        <select value={selected} onChange={e=>loadExam(e.target.value)} className="rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm">
          <option value="">All</option>
          {exams.map(e=><option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
        <button onClick={loadCombined} className="ml-auto rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10">Combined analysis (first 2 exams)</button>
      </div>
      {combined && (
        <div className="glass rounded-2xl p-4">
          <p className="text-sm font-semibold">Combined — {combined.stats.total} attempts · Avg {combined.stats.avgPercent}% · Pass {combined.stats.passRate}%</p>
        </div>
      )}
      <div className="glass rounded-2xl p-4 overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-zinc-500"><tr><th className="text-left p-2">Student</th><th className="text-left p-2">Exam</th><th className="text-left p-2">Score</th><th className="text-left p-2">%</th><th className="text-left p-2">Status</th></tr></thead>
          <tbody>{rows.map(r=>(
            <tr key={r.id} className="border-t border-white/5"><td className="p-2">{r.username}</td><td className="p-2">{r.exam_id}</td><td className="p-2">{r.score}/{r.total}</td><td className="p-2">{Math.round(r.percent)}%</td><td className="p-2">{r.passed?<span className="text-emerald-400">Pass</span>:<span className="text-rose-400">Fail</span>}</td></tr>
          ))}</tbody>
        </table>
        {!rows.length && <p className="text-center text-sm text-zinc-600 py-6">No graded attempts yet.</p>}
      </div>
    </div>
  );
}

function ProctorWall(){
  const [frames,setFrames]=useState({}); // attemptId -> {username, url, ts}
  useEffect(()=>{
    const s=getSocket();
    const joinWatch = () => s.emit("proctor:watch",{},(res)=>{
      if(res && !res.ok) console.warn("proctor:watch denied", res);
    });
    // if already connected, join now; also re-join on every reconnect
    if (s.connected) joinWatch();
    s.on("connect", joinWatch);
    const onFrame=(f)=> setFrames(prev=>({...prev, [f.attemptId]: f}));
    s.on("proctor:frame", onFrame);
    return ()=>{ s.off("proctor:frame", onFrame); s.off("connect", joinWatch); };
  },[]);
  const entries=Object.values(frames);
  return (
    <div>
      <div className="flex items-center gap-2 mb-4"><Video className="h-5 w-5 text-zinc-400"/><h3 className="font-semibold">Live Proctor Wall</h3><span className="ml-2 text-xs text-zinc-500">{entries.length} active streams</span></div>
      {!entries.length ? <div className="glass rounded-2xl p-12 text-center text-zinc-500"><Camera className="h-8 w-8 mx-auto mb-2"/><p className="text-sm">No live camera feeds — students appear here while taking exams.</p><p className="text-xs mt-1">Camera snapshots every ~5s during an attempt.</p></div> : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {entries.map(f=>(
            <div key={f.attemptId} className="glass rounded-2xl overflow-hidden">
              <img src={`${f.url}${f.url.includes('?')?'&':'?'}token=${encodeURIComponent(getToken()||'')}`} alt={f.username} className="w-full aspect-[4/3] object-cover bg-black/40"/>
              <div className="p-3 flex items-center justify-between">
                <span className="text-sm font-medium">{f.username}</span>
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"/>
              </div>
              <p className="px-3 pb-3 text-xs text-zinc-500">Attempt #{f.attemptId} · {new Date(f.ts).toLocaleTimeString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Student =====
function StudentShell({user,onLogout}){
  const [view,setView]=useState("exams"); // exams | exam | results
  const [examToTake,setExamToTake]=useState(null);
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-white/5 bg-panel/70 backdrop-blur px-6">
        <span className="font-display font-bold text-gradient">CBT Student</span>
        <div className="flex items-center gap-3">
          <button onClick={()=>setView("exams")} className={`px-3 py-1.5 rounded-lg text-sm ${view==="exams"?"bg-white/10":"text-zinc-400"}`}>Exams</button>
          <button onClick={()=>setView("results")} className={`px-3 py-1.5 rounded-lg text-sm ${view==="results"?"bg-white/10":"text-zinc-400"}`}>My Results</button>
          <span className="text-sm text-zinc-500 hidden md:inline">{user.username}</span>
          <button onClick={onLogout} className="p-2 rounded-lg hover:bg-white/10"><LogOut className="h-4 w-4"/></button>
        </div>
      </header>
      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {view==="exams" && <StudentExams onTake={(exam)=>{setExamToTake(exam); setView("exam");}} />}
        {view==="exam" && examToTake && <ExamPlayer exam={examToTake} user={user} onBack={()=>setView("exams")} />}
        {view==="results" && <StudentResults/>}
      </main>
    </div>
  );
}

function StudentExams({onTake}){
  const [exams,setExams]=useState([]);
  useEffect(()=>{ api("/api/exams").then(setExams); },[]);
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {exams.map(e=>(
        <div key={e.id} className="glass rounded-2xl p-5">
          <h3 className="font-semibold">{e.title}</h3>
          <p className="text-sm text-zinc-500">{e.subject} · {e.duration_minutes} min · {e.question_count} questions {e.camera_required?<span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-300"><Camera className="h-3 w-3"/> Camera required</span>:null}</p>
          <button onClick={()=>onTake(e)} className="mt-4 grad-bg rounded-xl px-5 py-2 text-sm font-semibold text-night">Start exam</button>
        </div>
      ))}
      {!exams.length && <p className="text-zinc-500">No exams published.</p>}
    </div>
  );
}

function StudentResults(){
  const [rows,setRows]=useState([]);
  useEffect(()=>{ api("/api/results").then(setRows); },[]);
  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="font-semibold mb-3">My Results</h3>
      <table className="w-full text-sm">
        <thead className="text-xs text-zinc-500"><tr><th className="text-left p-2">Exam</th><th className="text-left p-2">Score</th><th className="text-left p-2">%</th><th className="text-left p-2">Status</th></tr></thead>
        <tbody>{rows.map(r=>(
          <tr key={r.id} className="border-t border-white/5"><td className="p-2">{r.exam_id}</td><td className="p-2">{r.score}/{r.total}</td><td className="p-2">{Math.round(r.percent)}%</td><td className="p-2">{r.passed?<span className="text-emerald-400">Pass</span>:<span className="text-rose-400">Fail</span>}</td></tr>
        ))}</tbody>
      </table>
      {!rows.length && <p className="text-center text-sm text-zinc-600 py-6">No results yet — take an exam first.</p>}
    </div>
  );
}

function ExamPlayer({exam, user, onBack}){
  const [questions,setQuestions]=useState([]);
  const [attempt,setAttempt]=useState(null);
  const [answers,setAnswers]=useState({}); // qid -> given[]
  const [idx,setIdx]=useState(0);
  const [endsAt,setEndsAt]=useState(null);
  const [now,setNow]=useState(Date.now());
  const [submitting,setSubmitting]=useState(false);
  const [result,setResult]=useState(null);
  const [cameraConsent,setCameraConsent]=useState(false);
  const [screenConsent,setScreenConsent]=useState(false);
  const [started,setStarted]=useState(false);
  const camera = useCamera(started && exam.camera_required);
  const screen = useScreenShare();
  const socketRef = useRef(null);

  // load questions when exam changes
  useEffect(()=>{
    api(`/api/exams/${exam.id}`).then(d=> setQuestions(d.questions));
  },[exam.id]);

  // timer tick
  useEffect(()=>{
    if(!endsAt) return;
    const t=setInterval(()=>setNow(Date.now()),1000);
    return ()=>clearInterval(t);
  },[endsAt]);

  // auto-submit on expiry
  useEffect(()=>{
    if(endsAt && now >= endsAt && attempt && !result) doSubmit();
  },[now, endsAt]);

  // live camera + screen snapshot loops
  useEffect(()=>{
    if(!started || !attempt || camera.state!=="granted") return;
    const s=getSocket();
    socketRef.current=s;
    const iv=setInterval(()=>{
      if(document.hidden) return;
      const b64=camera.capture();
      if(b64) s.emit("proctor:snapshot",{attemptId: attempt.attemptId, jpegBase64: b64});
    },5000);
    return ()=>clearInterval(iv);
  },[started, attempt, camera.state, camera.capture]);

  useEffect(()=>{
    if(!started || !attempt || screen.state!=="granted") return;
    const s=getSocket();
    const iv=setInterval(()=>{
      if(document.hidden) return;
      const b64=screen.capture();
      if(b64) s.emit("proctor:snapshot",{attemptId: attempt.attemptId, jpegBase64: b64});
    },5000);
    return ()=>clearInterval(iv);
  },[started, attempt, screen.state, screen.capture]);

  const remaining = endsAt ? Math.max(0, Math.floor((endsAt - now)/1000)) : 0;
  const mins = Math.floor(remaining/60); const secs = remaining%60;

  const startExam=async()=>{
    if(exam.camera_required && (!cameraConsent || !screenConsent)) return alert("Please consent to camera and screen sharing to start this exam.");
    if(exam.camera_required){
      await camera.start();
      await screen.start();
      if(camera.state==="denied" || screen.state==="denied"){
        // allow retry, but still require consent
      }
    }
    const data=await api("/api/attempts/start",{method:"POST", body:{examId: exam.id, cameraConsentAt: cameraConsent?Date.now():null}});
    setAttempt(data); setEndsAt(data.endsAt); setStarted(true);
  };

  const saveAnswer=async(qid, given)=>{
    setAnswers(a=>({...a, [qid]: given}));
    if(!attempt) return;
    try{ await api(`/api/attempts/${attempt.attemptId}/answer`,{method:"POST", body:{questionId:qid, given}});}catch{}
  };

  const doSubmit=async()=>{
    if(submitting || !attempt) return;
    setSubmitting(true);
    try{
      const graded=await api(`/api/attempts/${attempt.attemptId}/submit`,{method:"POST"});
      setResult(graded);
      camera.stop();
      screen.stop();
    }catch(e){ alert(e.message); } finally{ setSubmitting(false); }
  };

  if(result){
    return (
      <div className="glass rounded-2xl p-8 text-center">
        <h3 className="font-display text-2xl font-bold">{result.passed ? <span className="text-emerald-400 flex items-center justify-center gap-2"><CheckCircle className="h-6 w-6"/> Passed</span> : <span className="text-rose-400 flex items-center justify-center gap-2"><XCircle className="h-6 w-6"/> Failed</span>}</h3>
        <p className="mt-2 text-3xl font-bold">{result.score} / {result.total} — {Math.round(result.percent)}%</p>
        <p className="mt-1 text-sm text-zinc-500">Exam: {exam.title}</p>
        <button onClick={onBack} className="mt-6 rounded-xl border border-white/10 bg-white/5 px-5 py-2 text-sm hover:bg-white/10">Back to exams</button>
      </div>
    );
  }

  if(!started){
    return (
      <div className="glass rounded-2xl p-6 max-w-xl mx-auto">
        <h3 className="font-semibold text-lg">{exam.title}</h3>
        <p className="text-sm text-zinc-500">{exam.subject} · {exam.duration_minutes} min · {questions.length} questions</p>
        <div className="mt-4 space-y-2 text-sm text-zinc-300">
          <p>• You have {exam.duration_minutes} minutes. Timer is server-enforced.</p>
          <p>• Answers auto-save on selection.</p>
          {exam.camera_required && <p className="flex items-center gap-2 text-amber-300"><Camera className="h-4 w-4"/> Live camera + <Monitor className="h-4 w-4"/> whole-screen snapshots every 5s (HTTPS/localhost required).</p>}
        </div>
        {exam.camera_required && (
          <>
            <label className="mt-4 flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
              <input type="checkbox" checked={cameraConsent} onChange={e=>setCameraConsent(e.target.checked)} className="mt-1"/>
              <span>I consent to camera snapshots for proctoring, stored until 30 days after submission.</span>
            </label>
            <label className="mt-2 flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
              <input type="checkbox" checked={screenConsent} onChange={e=>setScreenConsent(e.target.checked)} className="mt-1"/>
              <span>I consent to <b>whole-screen sharing</b> — my entire window will be captured every 5s for proctoring.</span>
            </label>
          </>
        )}
        {camera.error && <p className="mt-2 text-xs text-rose-300 flex items-center gap-1"><AlertTriangle className="h-3 w-3"/>{camera.error}</p>}
        {screen.error && <p className="mt-2 text-xs text-rose-300 flex items-center gap-1"><AlertTriangle className="h-3 w-3"/>Screen: {screen.error}</p>}
        <div className="mt-6 flex gap-3">
          <button onClick={onBack} className="rounded-xl border border-white/10 bg-white/5 px-5 py-2 text-sm">Cancel</button>
          <button onClick={startExam} className="grad-bg flex-1 rounded-xl py-2.5 font-semibold text-night">Start exam</button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3">
          <div className="rounded-xl bg-black/30 p-3">
            <p className="text-xs text-zinc-500 mb-2 flex items-center gap-1"><Camera className="h-3 w-3"/> Camera preview</p>
            <video ref={camera.videoRef} autoPlay muted playsInline className="w-full aspect-video rounded-xl bg-black object-cover"/>
            <p className="text-xs text-zinc-600 mt-1">State: {camera.state}</p>
          </div>
          {exam.camera_required && (
            <div className="rounded-xl bg-black/30 p-3">
              <p className="text-xs text-zinc-500 mb-2 flex items-center gap-1"><Monitor className="h-3 w-3"/> Screen share preview (whole window)</p>
              <video ref={screen.videoRef} autoPlay muted playsInline className="w-full aspect-video rounded-xl bg-black object-cover"/>
              <p className="text-xs text-zinc-600 mt-1">State: {screen.state}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  const q = questions[idx];
  if(!q) return <p className="text-zinc-500">Loading questions…</p>;
  const given = answers[q.id] || [];
  return (
    <div className="grid lg:grid-cols-[1fr_280px] gap-6">
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium">Question {idx+1} / {questions.length}</span>
          <span className={`font-mono text-sm px-3 py-1 rounded-full ${remaining<60?"bg-rose-500/20 text-rose-300":"bg-white/5 text-zinc-300"}`}><Clock className="inline h-3 w-3 mr-1"/>{String(mins).padStart(2,"0")}:{String(secs).padStart(2,"0")}</span>
        </div>
        <h4 className="font-medium">{q.prompt}</h4>
        <div className="mt-4 space-y-2">
          {q.options.map(opt=>{
            const checked = given.includes(opt);
            return (
              <label key={opt} className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition ${checked?"border-[var(--a1)] bg-[var(--a1)]/10":"border-white/10 hover:bg-white/5"}`}>
                <input type={q.type==="multi" ? "checkbox" : "radio"} name={`q-${q.id}`} checked={checked} onChange={()=>{
                  let next;
                  if(q.type==="multi") next = checked ? given.filter(v=>v!==opt) : [...given, opt];
                  else next = [opt];
                  saveAnswer(q.id, next);
                }} className="accent-[var(--a1)]"/>
                <span className="text-sm">{opt}</span>
              </label>
            );
          })}
        </div>
        <div className="mt-6 flex justify-between">
          <button disabled={idx===0} onClick={()=>setIdx(i=>i-1)} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm disabled:opacity-40">Previous</button>
          {idx < questions.length-1 ? <button onClick={()=>setIdx(i=>i+1)} className="grad-bg rounded-xl px-5 py-2 text-sm font-semibold text-night">Next</button> : <button onClick={doSubmit} disabled={submitting} className="rounded-xl bg-emerald-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{submitting?"Submitting…":"Submit"}</button>}
        </div>
      </div>
      <div className="space-y-4">
        <div className="glass rounded-2xl p-4">
          <p className="text-xs text-zinc-500 mb-2 flex items-center gap-1"><Camera className="h-3 w-3"/> Camera {exam.camera_required?"(required)":""}</p>
          <video ref={camera.videoRef} autoPlay muted playsInline className="w-full aspect-video rounded-xl bg-black object-cover"/>
          {camera.state==="granted" && <p className="mt-2 text-xs text-emerald-400 flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"/> Camera live</p>}
          {camera.error && <p className="text-xs text-rose-300 mt-2">{camera.error}</p>}
        </div>
        <div className="glass rounded-2xl p-4">
          <p className="text-xs text-zinc-500 mb-2 flex items-center gap-1"><Monitor className="h-3 w-3"/> Screen share {exam.camera_required?"(required)":""}</p>
          <video ref={screen.videoRef} autoPlay muted playsInline className="w-full aspect-video rounded-xl bg-black object-cover"/>
          {screen.state==="granted" && <p className="mt-2 text-xs text-emerald-400 flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"/> Screen live</p>}
          {screen.error && <p className="text-xs text-rose-300 mt-2">{screen.error}</p>}
        </div>
        <div className="glass rounded-2xl p-4">
          <p className="text-sm font-semibold mb-2">Questions</p>
          <div className="grid grid-cols-5 gap-2">
            {questions.map((qq,i)=>(
              <button key={qq.id} onClick={()=>setIdx(i)} className={`h-9 rounded-lg text-sm font-medium ${i===idx?"grad-bg text-night": answers[qq.id]?"bg-white/10 text-white":"bg-white/5 text-zinc-500"}`}>{i+1}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
