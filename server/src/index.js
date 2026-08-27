import express from "express";
import http from "node:http";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import authRouter, { requireAuth, requireRole, verifyToken } from "./auth.js";
import db from "./db.js";
import { handleProctorSnapshot } from "./proctor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// CORS: allow Vercel frontend + local dev. Set CORS_ORIGIN in Render dashboard (e.g., https://cbt-new-eight.vercel.app)
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors({
  origin: corsOrigin ? corsOrigin.split(",").map(s=>s.trim()).filter(Boolean) : true,
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));

// static for proctor snapshots
const UPLOADS = path.join(__dirname, "..", "uploads");
app.use("/uploads", express.static(UPLOADS));

app.use("/api/auth", authRouter);
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// ---- users / students ----
app.get("/api/students", requireAuth, requireRole("admin"), (_req, res) => {
  const rows = db.prepare("SELECT id, username, full_name, student_code, subjects, role, created_at FROM users WHERE role='student' ORDER BY id DESC").all();
  const parsed = rows.map(r=>{
    let subjects=[];
    try{ subjects = r.subjects ? JSON.parse(r.subjects) : []; }catch{ subjects=[]; }
    return { ...r, subjects };
  });
  res.json(parsed);
});

app.get("/api/exams", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT e.*, (SELECT COUNT(*) FROM questions q WHERE q.exam_id=e.id) AS question_count FROM exams e ORDER BY e.id DESC").all();
  // parse not needed; send raw
  res.json(rows);
});

app.post("/api/exams", requireAuth, requireRole("admin"), (req, res) => {
  const title = String(req.body?.title ?? "").trim();
  const subject = String(req.body?.subject ?? "").trim() || "General";
  const duration = Math.max(5, Math.min(180, Number(req.body?.duration_minutes) || 30));
  const passPercent = Math.max(0, Math.min(100, Number(req.body?.pass_percent) || 50));
  const cameraRequired = req.body?.camera_required === false ? 0 : 1;
  if (!title) return res.status(400).json({ error: "Title required" });
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36);
  const info = db.prepare("INSERT INTO exams (slug, title, subject, duration_minutes, pass_percent, status, camera_required, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(slug, title, subject, duration, passPercent, "published", cameraRequired, req.user.username, Date.now());
  const exam = db.prepare("SELECT * FROM exams WHERE id=?").get(Number(info.lastInsertRowid));
  res.json(exam);
});

app.get("/api/exams/:id", requireAuth, (req, res) => {
  const exam = db.prepare("SELECT * FROM exams WHERE id=?").get(Number(req.params.id));
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  // hide answer if student and not yet submitted? For MVP student sees without answer until submit; filter answer field
  const questions = db.prepare("SELECT id, exam_id, type, prompt, options, answer, marks, order_index FROM questions WHERE exam_id=? ORDER BY order_index").all(exam.id);
  const isStudent = req.user.role === "student";
  const sanitized = questions.map(q => ({
    ...q,
    options: JSON.parse(q.options),
    answer: isStudent ? undefined : JSON.parse(q.answer),
  }));
  res.json({ exam, questions: sanitized });
});

app.post("/api/exams/:id/questions", requireAuth, requireRole("admin"), (req, res) => {
  const examId = Number(req.params.id);
  const exam = db.prepare("SELECT id FROM exams WHERE id=?").get(examId);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  const { type, prompt, options, answer, marks } = req.body ?? {};
  if (!prompt || !Array.isArray(options) || !Array.isArray(answer)) return res.status(400).json({ error: "prompt, options[], answer[] required" });
  if (!["mcq","multi","tf"].includes(type)) return res.status(400).json({ error: "Invalid type" });
  const order = db.prepare("SELECT COUNT(*) as n FROM questions WHERE exam_id=?").get(examId).n;
  const info = db.prepare("INSERT INTO questions (exam_id, type, prompt, options, answer, marks, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)").run(examId, type, prompt, JSON.stringify(options), JSON.stringify(answer), Number(marks)||1, order);
  res.json(db.prepare("SELECT * FROM questions WHERE id=?").get(Number(info.lastInsertRowid)));
});

// ---- attempts ----
app.post("/api/attempts/start", requireAuth, requireRole("student"), (req, res) => {
  const examId = Number(req.body?.examId);
  const cameraConsentAt = req.body?.cameraConsentAt ? Number(req.body.cameraConsentAt) : null;
  const exam = db.prepare("SELECT * FROM exams WHERE id=?").get(examId);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  const existing = db.prepare("SELECT * FROM attempts WHERE exam_id=? AND user_id=? AND status='in_progress'").get(examId, req.user.id);
  if (existing) return res.json({ attemptId: existing.id, endsAt: existing.ends_at, exam });
  const qCount = db.prepare("SELECT COUNT(*) as n FROM questions WHERE exam_id=?").get(examId).n;
  if (!qCount) return res.status(400).json({ error: "Exam has no questions" });
  const now = Date.now();
  const endsAt = now + exam.duration_minutes * 60 * 1000;
  const info = db.prepare("INSERT INTO attempts (exam_id, user_id, username, status, score, total, percent, passed, camera_consent_at, started_at, ends_at) VALUES (?, ?, ?, 'in_progress', 0, ?, 0, 0, ?, ?, ?)").run(examId, req.user.id, req.user.username, qCount, cameraConsentAt, now, endsAt);
  const attemptId = Number(info.lastInsertRowid);
  res.json({ attemptId, endsAt, exam });
});

app.post("/api/attempts/:id/answer", requireAuth, (req, res) => {
  const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(req.params.id));
  if (!attempt || attempt.user_id !== req.user.id) return res.status(404).json({ error: "Attempt not found" });
  if (attempt.status !== "in_progress") return res.status(400).json({ error: "Attempt not active" });
  if (Date.now() > attempt.ends_at) return res.status(400).json({ error: "Time expired" });
  const { questionId, given } = req.body ?? {};
  const q = db.prepare("SELECT * FROM questions WHERE id=? AND exam_id=?").get(Number(questionId), attempt.exam_id);
  if (!q) return res.status(404).json({ error: "Question not found" });
  db.prepare("INSERT INTO attempt_answers (attempt_id, question_id, given, is_correct, marks_awarded) VALUES (?, ?, ?, NULL, 0) ON CONFLICT(attempt_id, question_id) DO UPDATE SET given=excluded.given").run(attempt.id, q.id, JSON.stringify(given ?? null));
  res.json({ ok: true });
});

function gradeAttempt(attemptId) {
  const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(attemptId);
  const questions = db.prepare("SELECT * FROM questions WHERE exam_id=?").all(attempt.exam_id);
  let score = 0;
  for (const q of questions) {
    const ans = db.prepare("SELECT given FROM attempt_answers WHERE attempt_id=? AND question_id=?").get(attemptId, q.id);
    const given = ans ? JSON.parse(ans.given) : null;
    const correct = JSON.parse(q.answer);
    let isCorrect = false;
    if (q.type === "mcq" || q.type === "tf") isCorrect = Array.isArray(given) && given.length===1 && given[0]===correct[0];
    else if (q.type==="multi") isCorrect = Array.isArray(given) && given.length===correct.length && given.every(v=>correct.includes(v)) && correct.every(v=>given.includes(v));
    const marks = isCorrect ? q.marks : 0;
    score += marks;
    if (ans) db.prepare("UPDATE attempt_answers SET is_correct=?, marks_awarded=? WHERE attempt_id=? AND question_id=?").run(isCorrect?1:0, marks, attemptId, q.id);
  }
  const total = questions.reduce((s,q)=>s+q.marks,0);
  const percent = total ? (score/total)*100 : 0;
  const passed = percent >= attempt.percent ? 0 : 0; // placeholder, use exam pass_percent
  const exam = db.prepare("SELECT pass_percent FROM exams WHERE id=?").get(attempt.exam_id);
  const isPassed = percent >= (exam?.pass_percent ?? 50) ? 1 : 0;
  db.prepare("UPDATE attempts SET status='graded', score=?, total=?, percent=?, passed=?, submitted_at=? WHERE id=?").run(score, total, percent, isPassed, Date.now(), attemptId);
  return db.prepare("SELECT * FROM attempts WHERE id=?").get(attemptId);
}

app.post("/api/attempts/:id/submit", requireAuth, (req, res) => {
  const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(req.params.id));
  if (!attempt || attempt.user_id !== req.user.id) return res.status(404).json({ error: "Attempt not found" });
  if (attempt.status !== "in_progress") return res.json(attempt);
  const graded = gradeAttempt(attempt.id);
  res.json(graded);
});

app.get("/api/attempts/:id", requireAuth, (req, res) => {
  const a = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "admin" && a.user_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });
  const answers = db.prepare("SELECT * FROM attempt_answers WHERE attempt_id=?").all(a.id);
  const snapshots = db.prepare("SELECT id, captured_at FROM proctor_snapshots WHERE attempt_id=? ORDER BY captured_at DESC LIMIT 100").all(a.id);
  res.json({ attempt: a, answers, snapshots });
});

app.get("/api/results", requireAuth, (req, res) => {
  const examId = req.query.examId ? Number(req.query.examId) : null;
  let rows;
  if (examId) rows = db.prepare("SELECT * FROM attempts WHERE exam_id=? AND status='graded' ORDER BY percent DESC").all(examId);
  else rows = db.prepare("SELECT * FROM attempts WHERE status='graded' ORDER BY submitted_at DESC LIMIT 100").all();
  if (req.user.role !== "admin") rows = rows.filter(r=>r.user_id===req.user.id);
  res.json(rows);
});

app.get("/api/results/combined", requireAuth, requireRole("admin"), (req, res) => {
  const ids = String(req.query.examIds||"").split(",").map(s=>Number(s)).filter(Boolean);
  if (!ids.length) return res.json({ exams: [], stats: { total:0, avgPercent:0, passRate:0 }});
  const placeholders = ids.map(()=>"?").join(",");
  const attempts = db.prepare(`SELECT * FROM attempts WHERE exam_id IN (${placeholders}) AND status='graded'`).all(...ids);
  const total = attempts.length;
  const avg = total ? attempts.reduce((s,a)=>s+a.percent,0)/total : 0;
  const passRate = total ? attempts.filter(a=>a.passed).length/total*100 : 0;
  res.json({ exams: ids, attempts, stats: { total, avgPercent: Math.round(avg*10)/10, passRate: Math.round(passRate*10)/10 }});
});

// proctor snapshots list + file serve
app.get("/api/proctor/snapshots/:attemptId", requireAuth, (req, res) => {
  const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(req.params.attemptId));
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });
  if (req.user.role!=="admin" && attempt.user_id!==req.user.id) return res.status(403).json({error:"Forbidden"});
  const rows = db.prepare("SELECT id, captured_at, file_path FROM proctor_snapshots WHERE attempt_id=? ORDER BY captured_at DESC LIMIT 100").all(attempt.id);
  res.json(rows.map(r=>({ ...r, url: `/uploads/proctor/${attempt.id}/${r.file_path.split(/[\\/]/).pop()}` })));
});
app.get("/api/proctor/snapshot/:attemptId/:fname", requireAuth, (req, res) => {
  const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(req.params.attemptId));
  if (!attempt) return res.status(404).send("not found");
  if (req.user.role!=="admin" && attempt.user_id!==req.user.id) return res.status(403).send("forbidden");
  const file = path.join(__dirname, "..", "uploads", "proctor", String(attempt.id), path.basename(req.params.fname));
  if (!fs.existsSync(file)) return res.status(404).send("not found");
  res.sendFile(file);
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin ? corsOrigin.split(",").map(s=>s.trim()).filter(Boolean) : true,
    credentials: true,
  },
});

// auth for sockets
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) throw new Error("no token");
    const payload = verifyToken(token);
    socket.data.userId = Number(payload.sub);
    socket.data.username = payload.username;
    socket.data.role = payload.role;
    next();
  } catch { next(new Error("unauthorized")); }
});

io.on("connection", (socket) => {
  socket.on("proctor:watch", (_, ack) => {
    if (socket.data.role !== "admin") return ack?.({ ok:false, error:"Admin only"});
    socket.join("proctor:admin");
    ack?.({ok:true});
  });

  socket.on("proctor:snapshot", (payload) => {
    // reuse helper - inline to avoid import cycle
    const { attemptId, jpegBase64 } = payload ?? {};
    if (!attemptId || !jpegBase64) return;
    // simple rate limit: count in memory
    socket.data._snapCount = (socket.data._snapCount||0)+1;
    // validate attempt ownership
    const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(attemptId));
    if (!attempt || attempt.user_id !== socket.data.userId) return;
    if (attempt.status !== "in_progress") return;
    let b64 = String(jpegBase64);
    if (b64.startsWith("data:")) b64 = (b64.split(",")[1]||"");
    if (b64.length > 500000) return;
    let buf;
    try { buf = Buffer.from(b64, "base64"); if (buf.length<100 || buf[0]!==0xff || buf[1]!==0xd8) return; } catch { return; }
    const dir = path.join(__dirname, "..", "uploads", "proctor", String(attemptId));
    fs.mkdirSync(dir, { recursive: true });
    const fname = `${Date.now()}-${socket.data.userId}.jpg`;
    const filePath = path.join(dir, fname);
    fs.writeFileSync(filePath, buf);
    db.prepare("INSERT INTO proctor_snapshots (attempt_id, user_id, captured_at, file_path) VALUES (?, ?, ?, ?)").run(Number(attemptId), socket.data.userId, Date.now(), path.relative(path.join(__dirname,".."), filePath));
    io.to("proctor:admin").emit("proctor:frame", {
      attemptId: Number(attemptId),
      userId: socket.data.userId,
      username: socket.data.username,
      ts: Date.now(),
      url: `/api/proctor/snapshot/${Number(attemptId)}/${fname}`,
    });
  });

  socket.on("disconnect", ()=>{});
});

const PORT = process.env.PORT || 4001;
httpServer.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${PORT} already in use — another CBT server is running.`);
    console.error(`Fix (targeted, won't kill other apps):`);
    console.error(`  for /f "tokens=5" %a in ('netstat -aon ^| findstr \":${PORT}\" ^| findstr LISTENING') do taskkill /f /pid %a`);
    console.error(`Or close the other terminal that runs: node src/index.js\n`);
    process.exit(1);
  }
  throw err;
});
httpServer.listen(PORT, ()=> console.log(`CBT Platform API on :${PORT}`));
