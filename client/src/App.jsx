import { useCallback, useEffect, useRef, useState } from "react";
import AuthScreen from "./screens/AuthScreen.jsx";
import { getUser, setSession, clearSession, api, getToken, apiUrl } from "./lib/api.js";
import { getSocket, destroySocket } from "./lib/socket.js";
import useCamera from "./hooks/useCamera.js";
import useScreenShare from "./hooks/useScreenShare.js";
import { LogOut, Users, BookOpen, BarChart3, Video, Plus, Eye, Clock, CheckCircle, XCircle, Camera, Monitor, AlertTriangle, Sun, Moon, Shield, FileText } from "lucide-react";

export default function App(){
  const [user,setUser]=useState(getUser());
  if(!user) return <AuthScreen onAuth={(t,u)=>{setSession(t,u); setUser(u);}} />;
  const isAdmin = ["super_admin","subject_admin","examiner"].includes(user.role);
  return isAdmin ? <AdminShell user={user} onLogout={doLogout(setUser)} /> : <StudentShell user={user} onLogout={doLogout(setUser)} />;
}
function doLogout(setUser){ return ()=>{ destroySocket(); clearSession(); setUser(null); } }

// ===== Admin =====
function AdminShell({user,onLogout}){
  const [tab,setTab]=useState("dashboard");
  const [theme,setTheme]=useState(()=> localStorage.getItem("cbt.theme") || "light");
  const isAdmin = ["super_admin","subject_admin"].includes(user.role);
  const isSuperAdmin = user.role === "super_admin";
  const allTabs = ["dashboard","exams","students","results","proctor","admins","audit"];
  const tabs = allTabs.filter(t => {
    if (t === "admins" || t === "audit") return isSuperAdmin;
    return true;
  });
  useEffect(()=>{
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("cbt.theme", theme);
  },[theme]);
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-white/5 bg-panel/70 backdrop-blur px-6">
        <span className="font-display font-bold text-gradient">University Examination Administration</span>
        <div className="flex items-center gap-3">
          <nav className="hidden md:flex gap-2 text-sm">
            {tabs.map(t=>(
              <button key={t} onClick={()=>setTab(t)} className={`px-3 py-1.5 rounded-lg capitalize ${tab===t?"bg-white/10 text-white":"text-zinc-400 hover:text-white"}`}>{t}</button>
            ))}
          </nav>
          <span className="text-xs rounded-full bg-white/10 px-2 py-0.5 text-zinc-400 capitalize">{user.role?.replace("_"," ")}</span>
          <span className="text-sm text-zinc-400">{user.username}</span>
          <button onClick={()=>setTheme(theme==="light"?"dark":"light")} aria-label="Toggle theme" title={`Switch to ${theme==="light"?"dark":"light"} mode`} className="p-2 rounded-lg hover:bg-white/10">
            {theme==="light" ? <Moon className="h-4 w-4"/> : <Sun className="h-4 w-4"/>}
          </button>
          <button onClick={onLogout} className="p-2 rounded-lg hover:bg-white/10"><LogOut className="h-4 w-4"/></button>
        </div>
      </header>
      <div className="md:hidden flex gap-2 p-3 border-b border-white/5 overflow-auto">
        {tabs.map(t=>(
          <button key={t} onClick={()=>setTab(t)} className={`px-3 py-1.5 rounded-lg text-sm capitalize shrink-0 ${tab===t?"bg-white/10 text-white":"text-zinc-400"}`}>{t}</button>
        ))}
      </div>
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {tab==="dashboard" && <AdminDashboard user={user}/>}
        {tab==="exams" && <ExamsAdmin user={user}/>}
        {tab==="students" && <StudentsAdmin user={user}/>}
        {tab==="results" && <ResultsAdmin user={user}/>}
        {tab==="proctor" && <ProctorWall/>}
        {tab==="admins" && isSuperAdmin && <AdminsAdmin user={user}/>}
        {tab==="audit" && isSuperAdmin && <AuditLog/>}
      </main>
    </div>
  );
}

function AdminDashboard({user}){
  const [stats,setStats]=useState(null);
  useEffect(()=>{
    api("/api/dashboard/stats").then(setStats).catch(()=>{});
  },[]);
  if(!stats) return <p className="text-zinc-500">Loading…</p>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          ["Exams", stats.totalExams, BookOpen],
          ["Students", stats.totalStudents, Users],
          ["Attempts", stats.totalAttempts, BarChart3],
          ["Pass Rate", `${stats.passRate}%`, CheckCircle],
        ].map(([label,val,Icon])=>(
          <div key={label} className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between"><p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p><Icon className="h-5 w-5 text-zinc-500"/></div>
            <p className="mt-2 font-display text-3xl font-bold">{val}</p>
          </div>
        ))}
      </div>
      <div className="glass rounded-2xl p-4">
        <p className="text-xs text-zinc-500">Average score: <span className="text-white font-semibold">{stats.avgPercent}%</span></p>
        <p className="text-xs text-zinc-500 mt-1">Subjects: {stats.subjects?.join(", ") || "—"}</p>
        {user.admin_subjects?.length > 0 && <p className="text-xs text-zinc-400 mt-2">Showing stats for your assigned subjects only.</p>}
      </div>
      <div className="glass rounded-2xl p-6">
        <h3 className="font-semibold">Examination Management Guide</h3>
        <ul className="mt-2 text-sm text-zinc-400 list-disc pl-5 space-y-1">
          <li>Navigate to <b>Examinations</b> to create a new course examination and add questions via manual entry or Excel bulk import</li>
          <li>Students authenticate with their credentials and complete timed, proctored assessments — live camera and screen feeds stream to the <b>Proctor</b> monitoring panel</li>
          <li>Upon submission, results are automatically graded and available in <b>Results</b> with combined analytics for cohort performance</li>
        </ul>
      </div>
    </div>
  );
}

function ExamsAdmin({user}){
  const [exams,setExams]=useState([]);
  const [title,setTitle]=useState(""); const [subject,setSubject]=useState("General"); const [duration,setDuration]=useState(15);
  const [schedStart,setSchedStart]=useState(""); const [schedEnd,setSchedEnd]=useState(""); const [randomize,setRandomize]=useState(false);
  const [negativeMarks,setNegativeMarks]=useState(0);
  const [selected,setSelected]=useState(null); const [qs,setQs]=useState([]);
  const [qPrompt,setQPrompt]=useState(""); const [qOptions,setQOptions]=useState("A,B,C,D"); const [qAnswer,setQAnswer]=useState("A"); const [qType,setQType]=useState("mcq");
  const [qDifficulty,setQDifficulty]=useState(""); const [qTopic,setQTopic]=useState(""); const [qExplanation,setQExplanation]=useState("");
  const load=useCallback(()=> api("/api/exams").then(setExams),[]);
  useEffect(()=>{load();},[load]);
  const create=async(e)=>{
    e.preventDefault();
    const body={title, subject, duration_minutes:Number(duration), randomize_questions: randomize, negative_marks: Number(negativeMarks)};
    if(schedStart) body.scheduled_start = new Date(schedStart).getTime();
    if(schedEnd) body.scheduled_end = new Date(schedEnd).getTime();
    await api("/api/exams",{method:"POST", body});
    setTitle(""); setSchedStart(""); setSchedEnd(""); setRandomize(false); setNegativeMarks(0); load();
  };
  const cloneExam=async(id)=>{
    if(!confirm("Clone this exam with all its questions?")) return;
    try{
      await api(`/api/exams/${id}/clone`,{method:"POST", body:{}});
      load();
    }catch(e){ alert(e.message); }
  };
  const openExam=async(id)=>{
    const data=await api(`/api/exams/${id}`);
    setSelected(data.exam);
    setQs(data.questions);
  };
  const addQ=async()=>{
    const opts = qOptions.split(",").map(s=>s.trim()).filter(Boolean);
    const ans = qAnswer.split(",").map(s=>s.trim()).filter(Boolean);
    const body = {type:qType, prompt:qPrompt, options:opts, answer:ans};
    if(qDifficulty) body.difficulty = qDifficulty;
    if(qTopic) body.topic = qTopic;
    if(qExplanation) body.explanation = qExplanation;
    await api(`/api/exams/${selected.id}/questions`,{method:"POST", body});
    const data=await api(`/api/exams/${selected.id}`);
    setQs(data.questions); setQPrompt(""); setQDifficulty(""); setQTopic(""); setQExplanation("");
  };
  const exportResults=async()=>{
    try{
      const url = selected ? `/api/results/export?examId=${selected.id}` : "/api/results/export";
      const res = await fetch(apiUrl(url), { headers: { Authorization: `Bearer ${getToken()||""}` }});
      if(!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl; a.download = "results.xlsx"; a.click();
      URL.revokeObjectURL(blobUrl);
    }catch(e){ alert(e.message); }
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Start (optional)</label>
              <input type="datetime-local" value={schedStart} onChange={e=>setSchedStart(e.target.value)} className="w-full rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm outline-none"/>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">End (optional)</label>
              <input type="datetime-local" value={schedEnd} onChange={e=>setSchedEnd(e.target.value)} className="w-full rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm outline-none"/>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <input type="checkbox" checked={randomize} onChange={e=>setRandomize(e.target.checked)} className="accent-[var(--a1)]"/>
              Randomize order
            </label>
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500 shrink-0">Negative mark:</label>
              <input type="number" step="0.05" min="0" max="1" value={negativeMarks} onChange={e=>setNegativeMarks(e.target.value)} className="w-16 rounded-xl border border-white/10 bg-night/60 px-2 py-1.5 text-xs outline-none"/>
            </div>
          </div>
          <button className="grad-bg w-full rounded-xl py-2 font-semibold text-night">Create</button>
        </form>
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold text-sm">Exams</h4>
            <button onClick={()=>exportResults()} className="text-xs text-zinc-400 hover:text-white border border-white/10 rounded-lg px-2 py-1">Export Excel</button>
          </div>
          <ul className="space-y-2">
            {exams.map(e=>{
              const now = Date.now();
              let schedLabel = "";
              if(e.scheduled_start && now < e.scheduled_start) schedLabel = `Starts ${new Date(e.scheduled_start).toLocaleDateString()}`;
              else if(e.scheduled_end && now > e.scheduled_end) schedLabel = "Ended";
              else if(e.scheduled_start || e.scheduled_end) schedLabel = "Available";
              return (
                <li key={e.id} className={`flex items-center justify-between rounded-xl px-3 py-2 ${selected?.id===e.id?"bg-white/10":"hover:bg-white/5"}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{e.title}</p>
                    <p className="text-xs text-zinc-500">{e.subject} · {e.duration_minutes}m · {e.question_count} Qs
                      {e.randomize_questions ? <span className="ml-1 text-violet-400">🔀</span> : null}
                      {e.negative_marks > 0 && <span className="ml-1 text-amber-400">-{Math.round(e.negative_marks*100)}%</span>}
                      {schedLabel && <span className={`ml-1 ${e.scheduled_end && now > e.scheduled_end ? "text-rose-400" : "text-emerald-400"}`}>· {schedLabel}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={()=>cloneExam(e.id)} title="Clone exam" className="p-2 hover:bg-white/10 rounded-lg"><span className="text-xs">📋</span></button>
                    <button onClick={()=>openExam(e.id)} className="p-2 hover:bg-white/10 rounded-lg"><Eye className="h-4 w-4"/></button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="glass rounded-2xl p-5">
        {!selected ? <p className="text-zinc-500 text-sm">Select an exam to manage questions.</p> : (
          <>
            <h3 className="font-semibold">{selected.title}</h3>
            <p className="text-xs text-zinc-500 mb-3">{selected.subject} {selected.negative_marks > 0 && <span className="ml-2 text-amber-400">Negative marking: {Math.round(selected.negative_marks*100)}%</span>}</p>
            <ul className="space-y-2 mb-4 max-h-64 overflow-auto pr-1">
              {qs.map((q,i)=>(
                <li key={q.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  <p className="text-sm"><span className="text-zinc-500">{i+1}.</span> {q.prompt} <span className="text-xs text-zinc-500">[{q.type}]</span>
                    {q.difficulty && <span className={`ml-1 text-xs px-1.5 py-0.5 rounded ${q.difficulty==="easy"?"bg-emerald-500/20 text-emerald-400":q.difficulty==="hard"?"bg-rose-500/20 text-rose-400":"bg-amber-500/20 text-amber-400"}`}>{q.difficulty}</span>}
                    {q.topic && <span className="ml-1 text-xs text-zinc-600">#{q.topic}</span>}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">Options: {(Array.isArray(q.options) ? q.options : JSON.parse(q.options)).join(", ")} · Answer: {(Array.isArray(q.answer) ? q.answer : JSON.parse(q.answer)).join(", ")}</p>
                </li>
              ))}
              {!qs.length && <p className="text-xs text-zinc-600">No questions yet.</p>}
            </ul>
            <div className="space-y-2 border-t border-white/5 pt-3">
              <div className="flex gap-2">
                <button onClick={async()=>{
                  try{
                    const res = await fetch(apiUrl("/api/exams/template.xlsx"), { headers: { Authorization: `Bearer ${getToken()||""}` }});
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
                      const res = await fetch(apiUrl(`/api/exams/${selected.id}/questions/import`), {
                        method: "POST",
                        headers: { Authorization: `Bearer ${getToken()||""}` },
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
              <div className="grid grid-cols-2 gap-2">
                <select value={qDifficulty} onChange={e=>setQDifficulty(e.target.value)} className="rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm">
                  <option value="">Difficulty</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
                </select>
                <input value={qTopic} onChange={e=>setQTopic(e.target.value)} placeholder="Topic (optional)" className="rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm outline-none"/>
              </div>
              <input value={qPrompt} onChange={e=>setQPrompt(e.target.value)} placeholder="Question prompt" className="w-full rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm outline-none"/>
              <input value={qOptions} onChange={e=>setQOptions(e.target.value)} placeholder="Options comma-separated" className="w-full rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm outline-none"/>
              <input value={qAnswer} onChange={e=>setQAnswer(e.target.value)} placeholder="Answer(s) comma-separated (exact option text)" className="w-full rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm outline-none"/>
              <input value={qExplanation} onChange={e=>setQExplanation(e.target.value)} placeholder="Explanation (shown in review after submit)" className="w-full rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm outline-none"/>
              <button onClick={addQ} className="w-full rounded-xl border border-white/10 bg-white/5 py-2 text-sm hover:bg-white/10">Add question</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StudentsAdmin({user}){
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

function ResultsAdmin({user}){
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
  const exportResults=async()=>{
    try{
      const url = selected ? `/api/results/export?examId=${selected}` : "/api/results/export";
      const res = await fetch(apiUrl(url), { headers: { Authorization: `Bearer ${getToken()||""}` }});
      if(!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl; a.download = "results.xlsx"; a.click();
      URL.revokeObjectURL(blobUrl);
    }catch(e){ alert(e.message); }
  };
  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl p-4 flex flex-wrap gap-2 items-center">
        <span className="text-sm text-zinc-400">Filter by exam:</span>
        <select value={selected} onChange={e=>loadExam(e.target.value)} className="rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm">
          <option value="">All</option>
          {exams.map(e=><option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
        <button onClick={loadCombined} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10">Combined analysis</button>
        <button onClick={exportResults} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10">Export Excel</button>
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

function ProctorImage({ url, alt }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    fetch(apiUrl(url), { headers: { Authorization: `Bearer ${getToken()||""}` } })
      .then(r => r.ok ? r.blob() : Promise.reject(new Error("Failed to load image")))
      .then(blob => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => setSrc(null));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  if (!src) return <div className="w-full aspect-[4/3] bg-black/40 animate-pulse" />;
  return <img src={src} alt={alt} className="w-full aspect-[4/3] object-cover bg-black/40" />;
}

// ===== Admins Management (super_admin only) =====
function AdminsAdmin({user}){
  const [admins,setAdmins]=useState([]); const [subjectOptions,setSubjectOptions]=useState([]);
  const [newUser,setNewUser]=useState(""); const [newPass,setNewPass]=useState(""); const [newRole,setNewRole]=useState("subject_admin"); const [newSubjects,setNewSubjects]=useState([]); const [newName,setNewName]=useState("");
  const [editId,setEditId]=useState(null); const [editRole,setEditRole]=useState(""); const [editSubjects,setEditSubjects]=useState([]);
  const load=useCallback(()=>{
    api("/api/admin/users").then(setAdmins).catch(()=>{});
    api("/api/subjects").then(d=> setSubjectOptions(Array.isArray(d)?d:[])).catch(()=>{});
  },[]);
  useEffect(()=>{load();},[load]);
  const createAdmin=async()=>{
    if(!newUser||!newPass) return alert("Username and password required");
    try{
      await api("/api/admin/users",{method:"POST",body:{username:newUser,password:newPass,role:newRole,full_name:newName,subjects:newSubjects}});
      setNewUser(""); setNewPass(""); setNewName(""); setNewSubjects([]); load();
    }catch(e){alert(e.message);}
  };
  const toggleNewSubject=(s)=> setNewSubjects(p=>p.includes(s)?p.filter(x=>x!==s):[...p,s]);
  const toggleEditSubject=(s)=> setEditSubjects(p=>p.includes(s)?p.filter(x=>x!==s):[...p,s]);
  const saveEdit=async()=>{
    try{
      await api(`/api/admin/users/${editId}`,{method:"PUT",body:{role:editRole,subjects:editSubjects}});
      setEditId(null); load();
    }catch(e){alert(e.message);}
  };
  const deactivate=async(id)=>{
    if(!confirm("Deactivate this admin?")) return;
    try{ await api(`/api/admin/users/${id}`,{method:"DELETE"}); load(); }catch(e){alert(e.message);}
  };
  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl p-5">
        <h3 className="font-semibold flex items-center gap-2"><Shield className="h-4 w-4"/> Add Admin / Examiner</h3>
        <div className="mt-3 space-y-2">
          <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Full name" className="w-full rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm outline-none"/>
          <input value={newUser} onChange={e=>setNewUser(e.target.value)} placeholder="Username" className="w-full rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm outline-none"/>
          <input value={newPass} onChange={e=>setNewPass(e.target.value)} type="password" placeholder="Password (8+ chars, upper+lower+number)" className="w-full rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm outline-none"/>
          <select value={newRole} onChange={e=>setNewRole(e.target.value)} className="w-full rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm">
            <option value="subject_admin">Subject Admin</option><option value="examiner">Examiner</option><option value="super_admin">Super Admin</option>
          </select>
          <div className="grid grid-cols-2 gap-1.5 max-h-24 overflow-auto">
            {subjectOptions.map(s=>(
              <label key={s} className={`flex items-center gap-2 rounded-lg px-2 py-1 text-xs cursor-pointer ${newSubjects.includes(s)?"bg-[var(--a1)]/20 text-white":"bg-white/5 text-zinc-400"}`}>
                <input type="checkbox" checked={newSubjects.includes(s)} onChange={()=>toggleNewSubject(s)} className="accent-[var(--a1)] h-3 w-3"/> {s}
              </label>
            ))}
          </div>
          <button onClick={createAdmin} className="grad-bg w-full rounded-xl py-2 font-semibold text-night text-sm">Create Account</button>
        </div>
      </div>
      <div className="glass rounded-2xl p-5">
        <h3 className="font-semibold mb-3 text-sm">Existing Admins ({admins.length})</h3>
        <ul className="space-y-2">
          {admins.map(a=>(
            <li key={a.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              {editId===a.id ? (
                <div className="space-y-2">
                  <select value={editRole} onChange={e=>setEditRole(e.target.value)} className="w-full rounded-xl border border-white/10 bg-night/60 px-3 py-2 text-sm">
                    <option value="subject_admin">Subject Admin</option><option value="examiner">Examiner</option><option value="super_admin">Super Admin</option>
                  </select>
                  <div className="grid grid-cols-2 gap-1.5 max-h-20 overflow-auto">
                    {subjectOptions.map(s=>(
                      <label key={s} className={`flex items-center gap-2 rounded-lg px-2 py-1 text-xs cursor-pointer ${editSubjects.includes(s)?"bg-[var(--a1)]/20 text-white":"bg-white/5 text-zinc-400"}`}>
                        <input type="checkbox" checked={editSubjects.includes(s)} onChange={()=>toggleEditSubject(s)} className="accent-[var(--a1)] h-3 w-3"/> {s}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="flex-1 rounded-xl bg-emerald-500 py-1.5 text-xs font-semibold text-white">Save</button>
                    <button onClick={()=>setEditId(null)} className="flex-1 rounded-xl border border-white/10 bg-white/5 py-1.5 text-xs">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{a.username} <span className="text-xs text-zinc-500 capitalize">({a.role?.replace("_"," ")})</span></p>
                    <p className="text-xs text-zinc-500">{a.admin_subjects?.length ? a.admin_subjects.join(", ") : "All subjects"}</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={()=>{setEditId(a.id);setEditRole(a.role);setEditSubjects(a.admin_subjects||[]);}} className="p-1.5 hover:bg-white/10 rounded-lg text-xs">Edit</button>
                    <button onClick={()=>deactivate(a.id)} className="p-1.5 hover:bg-rose-500/20 rounded-lg text-xs text-rose-400">Deactivate</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ===== Audit Log (super_admin only) =====
function AuditLog(){
  const [rows,setRows]=useState([]); const [page,setPage]=useState(1); const [total,setTotal]=useState(0);
  useEffect(()=>{
    api(`/api/audit?page=${page}&limit=30`).then(d=>{setRows(d.rows||[]);setTotal(d.total||0);}).catch(()=>{});
  },[page]);
  const pages = Math.max(1, Math.ceil(total/30));
  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="font-semibold flex items-center gap-2 mb-4"><FileText className="h-4 w-4"/> Audit Log ({total} entries)</h3>
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-zinc-500"><tr><th className="text-left p-2">Time</th><th className="text-left p-2">User</th><th className="text-left p-2">Action</th><th className="text-left p-2">Target</th></tr></thead>
          <tbody>{rows.map(r=>(
            <tr key={r.id} className="border-t border-white/5">
              <td className="p-2 text-xs text-zinc-500">{new Date(r.created_at).toLocaleString()}</td>
              <td className="p-2">{r.username} <span className="text-xs text-zinc-600">({r.role})</span></td>
              <td className="p-2 text-xs">{r.action}</td>
              <td className="p-2 text-xs text-zinc-500">{r.target_type}{r.target_id ? `#${r.target_id}` : ""}</td>
            </tr>
          ))}</tbody>
        </table>
        {!rows.length && <p className="text-center text-sm text-zinc-600 py-6">No audit entries yet.</p>}
      </div>
      {pages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <button disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs disabled:opacity-40">Prev</button>
          <span className="text-xs text-zinc-500 py-1">Page {page}/{pages}</span>
          <button disabled={page>=pages} onClick={()=>setPage(p=>p+1)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}

function ProctorWall(){
  const [frames,setFrames]=useState({});
  const [socketOk,setSocketOk]=useState(false);
  const [lastPoll,setLastPoll]=useState(0);
  useEffect(()=>{
    const s=getSocket();
    let alive=true;
    const joinWatch = () => {
      if(!alive) return;
      s.emit("proctor:watch",{},(res)=>{
        if(res && res.ok) setSocketOk(true);
        else { setSocketOk(false); console.warn("proctor:watch denied", res); }
      });
    };
    if (s.connected) joinWatch();
    s.on("connect", joinWatch);
    s.on("connect_error", ()=> setSocketOk(false));
    s.on("disconnect", ()=> setSocketOk(false));
    const onFrame=(f)=> setFrames(prev=>({...prev, [f.attemptId]: f}));
    s.on("proctor:frame", onFrame);
    return ()=>{ alive=false; s.off("proctor:frame", onFrame); s.off("connect", joinWatch); s.off("connect_error"); s.off("disconnect"); };
  },[]);

  // HTTP polling fallback — fetches latest snapshots every 5s regardless of socket
  useEffect(()=>{
    let alive=true;
    const poll=async()=>{
      if(!alive) return;
      try{
        const data = await api("/api/proctor/live");
        if(Array.isArray(data) && alive){
          setFrames(prev=>{
            const next={...prev};
            for(const f of data){
              if(!next[f.attemptId] || f.ts > (next[f.attemptId]?.ts||0)){
                next[f.attemptId]=f;
              }
            }
            return next;
          });
          setLastPoll(Date.now());
        }
      }catch{}
    };
    poll();
    const iv=setInterval(poll, 5000);
    return ()=>{ alive=false; clearInterval(iv); };
  },[]);

  const entries=Object.values(frames);
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Video className="h-5 w-5 text-zinc-400"/>
        <h3 className="font-semibold">Live Proctor Wall</h3>
        <span className="ml-2 text-xs text-zinc-500">{entries.length} active streams</span>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${socketOk?"bg-emerald-500/20 text-emerald-400":"bg-amber-500/20 text-amber-300"}`}>
          {socketOk ? "● Live (socket)" : "● Polling mode"}
        </span>
      </div>
      {!entries.length ? <div className="glass rounded-2xl p-12 text-center text-zinc-500"><Camera className="h-8 w-8 mx-auto mb-2"/><p className="text-sm">No live camera feeds — students appear here while taking exams.</p><p className="text-xs mt-1">Camera snapshots every ~5s during an attempt.</p></div> : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {entries.map(f=>(
            <div key={f.attemptId} className="glass rounded-2xl overflow-hidden">
              <ProctorImage url={f.url} alt={f.username} />
              <div className="p-3 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">{f.username}</span>
                  {f.examTitle && <p className="text-xs text-zinc-500 truncate">{f.examTitle}</p>}
                </div>
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
  const [view,setView]=useState("exams");
  const [examToTake,setExamToTake]=useState(null);
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-white/5 bg-panel/70 backdrop-blur px-6">
        <span className="font-display font-bold text-gradient">University Student Examination Portal</span>
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
          <p className="text-sm text-zinc-500">{e.subject} · {e.duration_minutes} min · {e.question_count} questions {e.camera_required?<span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-300"><Camera className="h-3 w-3"/> Camera required</span>:null} {e.negative_marks>0 && <span className="ml-2 text-xs text-amber-400">-{Math.round(e.negative_marks*100)}% wrong</span>}</p>
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
  const [answers,setAnswers]=useState({});
  const [flags,setFlags]=useState({});
  const [idx,setIdx]=useState(0);
  const [endsAt,setEndsAt]=useState(null);
  const [now,setNow]=useState(Date.now());
  const [submitting,setSubmitting]=useState(false);
  const [result,setResult]=useState(null);
  const [cameraConsent,setCameraConsent]=useState(false);
  const [screenConsent,setScreenConsent]=useState(false);
  const [started,setStarted]=useState(false);
  const [tabViolations,setTabViolations]=useState(0);
  const [tabWarning,setTabWarning]=useState(false);
  const camera = useCamera(started && exam.camera_required);
  const screen = useScreenShare();
  const socketRef = useRef(null);

  useEffect(()=>{
    api(`/api/exams/${exam.id}`).then(d=> setQuestions(d.questions));
  },[exam.id]);

  useEffect(()=>{
    if(!attempt) return;
    api(`/api/attempts/${attempt.attemptId}/answers`).then(d=>{
      if(d.answers) setAnswers(d.answers);
      if(d.endsAt) setEndsAt(d.endsAt);
    }).catch(()=>{});
    api(`/api/attempts/${attempt.attemptId}/flags`).then(d=>{
      if(d) setFlags(d);
    }).catch(()=>{});
  },[attempt]);

  useEffect(()=>{
    if(!started || !attempt) return;
    const iv = setInterval(()=>{
      Object.entries(answers).forEach(([qid, given])=>{
        api(`/api/attempts/${attempt.attemptId}/answer`,{method:"POST", body:{questionId:Number(qid), given}}).catch(()=>{});
      });
    }, 30000);
    return ()=>clearInterval(iv);
  },[started, attempt]);

  useEffect(()=>{
    if(!endsAt) return;
    const t=setInterval(()=>setNow(Date.now()),1000);
    return ()=>clearInterval(t);
  },[endsAt]);

  useEffect(()=>{
    if(endsAt && now >= endsAt && attempt && !result) doSubmit();
  },[now, endsAt]);

  useEffect(()=>{
    if(!started || !attempt) return;
    const onVisChange=()=>{
      if(document.hidden){
        setTabViolations(v=>{
          const next=v+1;
          api(`/api/attempts/${attempt.attemptId}/tab-violation`,{method:"POST"}).then(d=>{
            if(d.autoSubmitted && d.graded){ setResult({attempt:d.graded, questions:[]}); camera.stop(); screen.stop(); }
          }).catch(()=>{});
          return next;
        });
        setTabWarning(true);
      }
    };
    document.addEventListener("visibilitychange",onVisChange);
    return ()=>document.removeEventListener("visibilitychange",onVisChange);
  },[started, attempt]);

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

  const enableCamera=async()=>{
    if(!cameraConsent) return alert("Please tick the camera consent box first.");
    await camera.start();
  };
  const enableScreen=()=>{
    if(!screenConsent) return alert("Please tick the screen-sharing consent box first.");
    return screen.start();
  };

  const proctorReady = !exam.camera_required || (camera.state==="granted" && screen.state==="granted");

  const startExam=async()=>{
    if(exam.camera_required){
      if(!cameraConsent || !screenConsent) return alert("Please consent to camera and screen sharing to start this exam.");
      if(camera.state!=="granted") return alert("Enable your camera before starting this exam.");
      if(screen.state!=="granted") return alert("Share your entire screen before starting this exam.");
    }
    try{
      const data=await api("/api/attempts/start",{method:"POST", body:{examId: exam.id, cameraConsentAt: cameraConsent?Date.now():null}});
      setAttempt(data); setEndsAt(data.endsAt); setStarted(true);
    }catch(e){
      camera.stop(); screen.stop();
      alert(e.message);
    }
  };

  const saveAnswer=async(qid, given)=>{
    setAnswers(a=>({...a, [qid]: given}));
    if(!attempt) return;
    try{ await api(`/api/attempts/${attempt.attemptId}/answer`,{method:"POST", body:{questionId:qid, given}});}catch{}
  };

  const toggleFlag=async(qid)=>{
    if(!attempt) return;
    const isFlagged = flags[qid];
    try{
      if(isFlagged){
        await api(`/api/attempts/${attempt.attemptId}/flag/${qid}`,{method:"DELETE"});
        setFlags(f=>{ const n={...f}; delete n[qid]; return n; });
      }else{
        await api(`/api/attempts/${attempt.attemptId}/flag/${qid}`,{method:"POST"});
        setFlags(f=>({...f, [qid]: Date.now()}));
      }
    }catch{}
  };

  const doSubmit=async()=>{
    if(submitting || !attempt) return;
    setSubmitting(true);
    try{
      const data=await api(`/api/attempts/${attempt.attemptId}/submit`,{method:"POST"});
      setResult(data);
      camera.stop();
      screen.stop();
    }catch(e){ alert(e.message); } finally{ setSubmitting(false); }
  };

  if(result){
    const att = result.attempt || result;
    const qs = result.questions || [];
    const correctCount = qs.filter(q=>q.is_correct).length;
    return (
      <div className="space-y-4">
        <div className="glass rounded-2xl p-8 text-center">
          <h3 className="font-display text-2xl font-bold">{att.passed ? <span className="text-emerald-400 flex items-center justify-center gap-2"><CheckCircle className="h-6 w-6"/> Passed</span> : <span className="text-rose-400 flex items-center justify-center gap-2"><XCircle className="h-6 w-6"/> Failed</span>}</h3>
          <p className="mt-2 text-3xl font-bold">{att.score} / {att.total} — {Math.round(att.percent)}%</p>
          <p className="mt-1 text-sm text-zinc-500">{correctCount}/{qs.length} correct · {exam.title}</p>
          <button onClick={onBack} className="mt-6 rounded-xl border border-white/10 bg-white/5 px-5 py-2 text-sm hover:bg-white/10">Back to exams</button>
        </div>
        {qs.length > 0 && (
          <div className="space-y-3">
            <h4 className="font-semibold text-sm">Review Answers</h4>
            {qs.map((q, i) => (
              <div key={q.id} className={`glass rounded-xl p-4 border-l-4 ${q.is_correct ? "border-emerald-500" : "border-rose-500"}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{i+1}. {q.prompt}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${q.is_correct ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>{q.is_correct ? "Correct" : "Wrong"} · {q.marks_awarded}/{q.marks_total}</span>
                </div>
                <div className="mt-2 space-y-1 text-xs">
                  {q.options.map(opt => {
                    const isCorrect = q.correct.includes(opt);
                    const isGiven = q.given.includes(opt);
                    let cls = "text-zinc-500";
                    if(isCorrect && isGiven) cls = "text-emerald-400 font-semibold";
                    else if(isCorrect && !isGiven) cls = "text-emerald-400";
                    else if(!isCorrect && isGiven) cls = "text-rose-400 line-through";
                    return <p key={opt} className={cls}>{isGiven ? "→ " : "  "}{opt} {isCorrect ? "✓" : ""}</p>;
                  })}
                </div>
                {q.explanation && <p className="mt-2 text-xs text-zinc-400 italic">💡 {q.explanation}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if(!started){
    return (
      <div className="glass rounded-2xl p-6 max-w-xl mx-auto">
        <h3 className="font-semibold text-lg">{exam.title}</h3>
        <p className="text-sm text-zinc-500">{exam.subject} · {exam.duration_minutes} min · {questions.length} questions {exam.negative_marks > 0 && <span className="ml-2 text-amber-400">· {Math.round(exam.negative_marks*100)}% negative marking</span>}</p>
        <div className="mt-4 space-y-2 text-sm text-zinc-300">
          <p>• <b>Duration:</b> {exam.duration_minutes} minutes. The countdown is server-enforced and auto-submits upon expiry.</p>
          <p>• <b>Auto-save:</b> Your selected answers are saved instantly and periodically.</p>
          <p>• <b>Flagging:</b> You can flag questions to review later using the navigation panel.</p>
          {exam.negative_marks > 0 && <p className="text-amber-300">• <b>Negative marking:</b> Wrong answers incur a {Math.round(exam.negative_marks*100)}% penalty per mark.</p>}
          {exam.camera_required && <p className="flex items-center gap-2 text-amber-300"><Camera className="h-4 w-4"/> <Monitor className="h-4 w-4"/> Proctored examination — live camera and full-screen snapshots every 5 seconds.</p>}
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
            <div className="mt-4 space-y-2">
              <button type="button" onClick={enableCamera} disabled={camera.state==="granted"||camera.state==="requesting"}
                className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm hover:bg-white/10 disabled:opacity-60">
                <span className="flex items-center gap-2"><Camera className="h-4 w-4"/> {camera.state==="granted"?"Camera enabled":camera.state==="requesting"?"Requesting camera…":"Step 1 — Enable camera"}</span>
                {camera.state==="granted" ? <CheckCircle className="h-4 w-4 text-emerald-500"/> : <span className="text-xs text-zinc-500">required</span>}
              </button>
              <button type="button" onClick={enableScreen} disabled={screen.state==="granted"||screen.state==="requesting"}
                className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm hover:bg-white/10 disabled:opacity-60">
                <span className="flex items-center gap-2"><Monitor className="h-4 w-4"/> {screen.state==="granted"?"Screen sharing enabled":screen.state==="requesting"?"Waiting for screen picker…":"Step 2 — Share entire screen"}</span>
                {screen.state==="granted" ? <CheckCircle className="h-4 w-4 text-emerald-500"/> : <span className="text-xs text-zinc-500">required</span>}
              </button>
              <p className="text-xs text-zinc-500">Choose <b>Entire Screen</b> in the picker.</p>
            </div>
          </>
        )}
        {camera.error && <p className="mt-2 text-xs text-rose-300 flex items-center gap-1"><AlertTriangle className="h-3 w-3"/>{camera.error}</p>}
        {screen.error && <p className="mt-2 text-xs text-rose-300 flex items-center gap-1"><AlertTriangle className="h-3 w-3"/>Screen: {screen.error}</p>}
        <div className="mt-6 flex gap-3">
          <button onClick={onBack} className="rounded-xl border border-white/10 bg-white/5 px-5 py-2 text-sm">Cancel</button>
          <button onClick={startExam} disabled={!proctorReady} className="grad-bg flex-1 rounded-xl py-2.5 font-semibold text-night disabled:opacity-50 disabled:cursor-not-allowed">
            {proctorReady ? "Start exam" : "Complete the steps above"}
          </button>
        </div>
        <video ref={camera.videoRef} autoPlay muted playsInline className="absolute w-px h-px opacity-0 pointer-events-none" />
        <video ref={screen.videoRef} autoPlay muted playsInline className="absolute w-px h-px opacity-0 pointer-events-none" />
      </div>
    );
  }

  const q = questions[idx];
  if(!q) return <p className="text-zinc-500">Loading questions…</p>;
  const given = answers[q.id] || [];
  const answeredCount = questions.filter(qq => answers[qq.id] && answers[qq.id].length > 0).length;
  const flaggedCount = Object.keys(flags).length;
  return (
    <div className="grid lg:grid-cols-[1fr_280px] gap-6">
      <div className="glass rounded-2xl p-5">
        {tabViolations > 0 && (
          <div className={`mb-4 rounded-xl border p-3 text-sm ${tabViolations >= 5 ? "border-rose-500/40 bg-rose-500/10 text-rose-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`}>
            <p className="font-medium">Tab switch detected! ({tabViolations}/5 violations)</p>
            <p className="text-xs mt-1">Switching tabs is monitored. At 5 violations your exam will be auto-submitted.</p>
          </div>
        )}
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium">Question {idx+1} / {questions.length}</span>
          <div className="flex items-center gap-2">
            <button onClick={()=>toggleFlag(q.id)} className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition ${flags[q.id]?"bg-amber-500/20 text-amber-300 border border-amber-500/30":"bg-white/5 text-zinc-400 border border-white/10 hover:bg-white/10"}`}>
              {flags[q.id] ? "★ Flagged" : "☆ Flag"}
            </button>
            <span className={`font-mono text-sm px-3 py-1 rounded-full ${remaining<60?"bg-rose-500/20 text-rose-300":"bg-white/5 text-zinc-300"}`}><Clock className="inline h-3 w-3 mr-1"/>{String(mins).padStart(2,"0")}:{String(secs).padStart(2,"0")}</span>
          </div>
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
          <p className="text-xs font-medium text-zinc-600">Proctoring</p>
          <p className="mt-2 text-xs flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${camera.state==="granted"?"bg-emerald-500 animate-pulse":"bg-zinc-300"}`}/> Camera {camera.state==="granted"?"active":"not active"}</p>
          <p className="text-xs flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${screen.state==="granted"?"bg-emerald-500 animate-pulse":"bg-zinc-300"}`}/> Screen share {screen.state==="granted"?"active":"not active"}</p>
          {(camera.error || screen.error) && <p className="mt-2 text-xs text-rose-500">{camera.error || screen.error}</p>}
          <video ref={camera.videoRef} autoPlay muted playsInline className="absolute w-px h-px opacity-0 pointer-events-none" />
          <video ref={screen.videoRef} autoPlay muted playsInline className="absolute w-px h-px opacity-0 pointer-events-none" />
        </div>
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold">Questions</p>
            <span className="text-xs text-zinc-500">{answeredCount}/{questions.length} answered</span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {questions.map((qq,i)=>{
              const isAnswered = answers[qq.id] && answers[qq.id].length > 0;
              const isFlagged = flags[qq.id];
              const isCurrent = i===idx;
              let cls = "bg-white/5 text-zinc-500";
              if(isCurrent) cls = "grad-bg text-night";
              else if(isAnswered && isFlagged) cls = "bg-amber-500/30 text-white";
              else if(isAnswered) cls = "bg-emerald-500/20 text-emerald-300";
              else if(isFlagged) cls = "bg-amber-500/10 text-amber-300";
              return (
                <button key={qq.id} onClick={()=>setIdx(i)} className={`relative h-9 rounded-lg text-sm font-medium ${cls}`}>
                  {i+1}
                  {isFlagged && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-amber-400 border border-night"/>}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-500">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500/40"/> Answered</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400"/> Flagged</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-white/10"/> Unanswered</span>
          </div>
        </div>
        {flaggedCount > 0 && (
          <div className="glass rounded-2xl p-4">
            <p className="text-sm font-semibold mb-2">Flagged ({flaggedCount})</p>
            <div className="space-y-1">
              {Object.keys(flags).map(qid => {
                const qq = questions.find(q=>q.id===Number(qid));
                if(!qq) return null;
                const qi = questions.indexOf(qq);
                return <button key={qid} onClick={()=>setIdx(qi)} className="w-full text-left text-xs text-amber-300 hover:text-amber-200 truncate py-0.5">Q{qi+1}: {qq.prompt.slice(0,40)}…</button>;
              })}
            </div>
          </div>
        )}
        <button onClick={doSubmit} disabled={submitting} className="w-full rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{submitting?"Submitting…":"Submit Exam"}</button>
      </div>
    </div>
  );
}
