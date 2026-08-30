import { useState, useEffect } from "react";
import { GraduationCap } from "lucide-react";
import { api } from "../lib/api.js";
export default function AuthScreen({ onAuth }){
  const [mode,setMode]=useState("login");
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [fullName,setFullName]=useState("");
  const [subjects,setSubjects]=useState([]);
  const [subjectOptions,setSubjectOptions]=useState([]);
  const [subjectsLoading,setSubjectsLoading]=useState(true);
  useEffect(()=>{
    // fetch distinct exam subjects (public, reflects actual exams) — uses VITE_API_URL in production
    api("/api/subjects").then(data=>{
      if(Array.isArray(data) && data.length) setSubjectOptions(data);
      else setSubjectOptions([]);
    }).catch(()=> setSubjectOptions([])).finally(()=> setSubjectsLoading(false));
  },[]);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const toggleSubject=(s)=> setSubjects(prev=> prev.includes(s) ? prev.filter(x=>x!==s) : [...prev, s]);
  const submit=async(e)=>{
    e.preventDefault(); setBusy(true); setError("");
    try{
      const body = mode==="register" ? {username,password,full_name:fullName||username, subjects} : {username,password};
      const data=await api(`/api/auth/${mode}`,{method:"POST", body});
      onAuth(data.token,data.user);
    }catch(err){setError(err.message);} finally{setBusy(false);}
  };
  return (
    <div className="relative flex min-h-screen items-center justify-center p-6 overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-60"/>
      <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 h-[420px] w-[600px] -translate-x-1/2 rounded-full bg-violet-600/20 blur-[130px]"/>
      <div className="glass relative z-10 w-full max-w-sm rounded-3xl p-8">
        <div className="mb-6 text-center">
          <span className="grad-bg mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl"><GraduationCap className="h-6 w-6 text-night"/></span>
          <h1 className="text-gradient font-display text-2xl font-bold">University CBT Portal</h1>
          <p className="text-sm text-zinc-500">Secure Computer-Based Examinations</p>
        </div>
        <div className="mb-4 grid grid-cols-2 rounded-xl border border-white/10 bg-night/60 p-1 text-sm">
          {["login","register"].map(m=>(
            <button key={m} type="button" onClick={()=>{setMode(m);setError("")}} className={`rounded-lg py-2 capitalize transition ${mode===m?"grad-bg font-semibold text-night":"text-zinc-400 hover:text-white"}`}>{m}</button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input required value={username} onChange={e=>setUsername(e.target.value)} placeholder="Username" className="w-full rounded-xl border border-white/10 bg-night/60 px-4 py-2.5 text-sm outline-none focus:border-[var(--a1)]"/>
          {mode==="register" && <input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Full name (optional)" className="w-full rounded-xl border border-white/10 bg-night/60 px-4 py-2.5 text-sm outline-none focus:border-[var(--a1)]"/>}
          <input required type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" className="w-full rounded-xl border border-white/10 bg-night/60 px-4 py-2.5 text-sm outline-none focus:border-[var(--a1)]"/>
          {mode==="register" && (
            <div className="rounded-xl border border-white/10 bg-night/40 p-3">
              <p className="text-xs font-medium text-zinc-400 mb-2">Select your subjects <span className="text-rose-400">*</span> <span className="text-zinc-600">({subjects.length} selected)</span> <span className="text-zinc-600">— from available exams</span></p>
              {subjectsLoading ? (
                <p className="text-xs text-zinc-500 py-2">Loading subjects from exams…</p>
              ) : !subjectOptions.length ? (
                <p className="text-xs text-amber-300 py-2">No exams created yet. Ask admin to create an exam first.</p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5 max-h-32 overflow-auto pr-1">
                  {subjectOptions.map(s=>(
                    <label key={s} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs cursor-pointer transition ${subjects.includes(s)?"bg-[var(--a1)]/20 border border-[var(--a1)]/30 text-white":"bg-white/5 border border-transparent text-zinc-400 hover:bg-white/10"}`}>
                      <input type="checkbox" checked={subjects.includes(s)} onChange={()=>toggleSubject(s)} className="accent-[var(--a1)] h-3 w-3"/>
                      {s}
                    </label>
                  ))}
                </div>
              )}
              {!subjectsLoading && !!subjectOptions.length && !subjects.length && <p className="text-xs text-amber-300 mt-2">Pick at least one subject to continue.</p>}
            </div>
          )}
          {error && <p className="rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
          <button disabled={busy} className="grad-bg w-full rounded-xl py-2.5 font-semibold text-night shadow-lg shadow-violet-500/20 hover:brightness-110 disabled:opacity-50">{busy?"…":mode==="login"?"Sign in":"Create account"}</button>
        </form>
      </div>
    </div>
  );
}
