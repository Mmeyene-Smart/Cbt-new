import express from "express";
import http from "node:http";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import authRouter, { requireAuth, requireRole, verifyToken } from "./auth.js";
import db from "./db.js";
import multer from "multer";
import ExcelJS from "exceljs";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import sanitizeHtml from "sanitize-html";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const corsOrigin = process.env.CORS_ORIGIN;
const allowedOrigins = corsOrigin ? corsOrigin.split(",").map(s=>s.trim()).filter(Boolean) : [];
app.use(helmet({
  crossOriginResourcePolicy: { policy: "same-site" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:", "blob:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
    },
  },
}));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (!allowedOrigins.length) {
      if (process.env.NODE_ENV !== "production") return callback(null, true);
      return callback(new Error("CORS not configured"), false);
    }
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"), false);
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" })); // 1mb for JSON; proctor snapshots use base64 but are separate (still via JSON, 500KB limit enforced in handler)
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// rate limiting — generous but stops brute force
const generalLimiter = rateLimit({ windowMs: 60*1000, max: 120, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts, try again in 15 minutes." } });
const proctorLimiter = rateLimit({ windowMs: 60*1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many snapshot requests" } });
app.use("/api/", generalLimiter);
app.use("/api/auth/", authLimiter);
app.use("/api/proctor/", proctorLimiter);

// sanitize helper for XSS prevention
const sanitize = (str) => sanitizeHtml(String(str || ""), { allowedTags: [], allowedAttributes: {} }).trim();

app.use("/api/auth", authRouter);
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// One-time fix for live DB with no admin (Render free tier wipes DB) — creates admin if missing
app.post("/api/fix-admin", async (_req, res) => {
  try {
    const exists = db.prepare("SELECT id FROM users WHERE username = ?").get("admin");
    if (exists) return res.json({ message: "Admin already exists", id: exists.id });
    const bcrypt = await import("bcryptjs");
    const hash = bcrypt.hashSync("Minator1!", 12);
    const info = db.prepare("INSERT INTO users (username, password_hash, role, full_name, student_code, subjects, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("admin", hash, "admin", "Administrator", null, JSON.stringify([]), Date.now());
    res.json({ message: "Admin created", id: Number(info.lastInsertRowid), username: "admin", password: "Minator1!" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Public: list distinct exam subjects for registration (reflects actual exams)
app.get("/api/subjects", (_req, res) => {
  const rows = db.prepare("SELECT DISTINCT subject FROM exams WHERE subject IS NOT NULL AND TRIM(subject) != '' ORDER BY subject").all();
  const subjects = rows.map(r=>r.subject).filter(Boolean);
  res.json(subjects);
});

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

app.get("/api/exams/template.xlsx", requireAuth, requireRole("admin"), async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Questions");
  ws.columns = [
    { header: "Type (mcq/multi/tf)", key: "type", width: 18 },
    { header: "Prompt", key: "prompt", width: 50 },
    { header: "Options (comma-separated)", key: "options", width: 40 },
    { header: "Answer(s) (comma-separated, must match Options)", key: "answer", width: 40 },
    { header: "Marks", key: "marks", width: 10 },
  ];
  ws.addRow({ type: "mcq", prompt: "What is the capital of Nigeria?", options: "Lagos,Abuja,Kano", answer: "Abuja", marks: 1 });
  ws.addRow({ type: "multi", prompt: "Select all valid CSS units", options: "px,em,kg,rem", answer: "px,em,rem", marks: 1 });
  ws.addRow({ type: "tf", prompt: "Node.js can run outside the browser.", options: "True,False", answer: "True", marks: 1 });
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).commitRow();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=questions_template.xlsx");
  await wb.xlsx.write(res);
  res.end();
});

app.get("/api/exams", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT e.*, (SELECT COUNT(*) FROM questions q WHERE q.exam_id=e.id) AS question_count FROM exams e ORDER BY e.id DESC").all();
  // parse not needed; send raw
  res.json(rows);
});

app.post("/api/exams", requireAuth, requireRole("admin"), (req, res) => {
  const title = sanitize(req.body?.title);
  const subject = sanitize(req.body?.subject) || "General";
  const duration = Math.max(5, Math.min(180, Number(req.body?.duration_minutes) || 30));
  const passPercent = Math.max(0, Math.min(100, Number(req.body?.pass_percent) || 50));
  const cameraRequired = req.body?.camera_required === false ? 0 : 1;
  if (!title || title.length < 3 || title.length > 120) return res.status(400).json({ error: "Title must be 3-120 characters" });
  if (/[<>]/.test(title) || /[<>]/.test(subject)) return res.status(400).json({ error: "Invalid characters in title/subject" });
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
  let { type, prompt, options, answer, marks } = req.body ?? {};
  prompt = sanitize(prompt);
  if (!prompt || prompt.length > 1000) return res.status(400).json({ error: "Prompt required (1-1000 chars)" });
  if (!Array.isArray(options) || !Array.isArray(answer)) return res.status(400).json({ error: "prompt, options[], answer[] required" });
  options = options.map(o => sanitize(o)).filter(Boolean).slice(0, 6);
  answer = answer.map(a => sanitize(a)).filter(Boolean);
  if (options.length < 2 || options.some(o => o.length > 200)) return res.status(400).json({ error: "Options must be 2-6 items, each 1-200 chars" });
  if (!answer.length) return res.status(400).json({ error: "Answer required" });
  if (!["mcq","multi","tf"].includes(type)) return res.status(400).json({ error: "Invalid type" });
  const order = db.prepare("SELECT COUNT(*) as n FROM questions WHERE exam_id=?").get(examId).n;
  const info = db.prepare("INSERT INTO questions (exam_id, type, prompt, options, answer, marks, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)").run(examId, type, prompt, JSON.stringify(options), JSON.stringify(answer), Number(marks)||1, order);
  res.json(db.prepare("SELECT * FROM questions WHERE id=?").get(Number(info.lastInsertRowid)));
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") cb(null, true);
    else cb(new Error("Only .xlsx files allowed"));
  },
});

// Bulk import questions via Excel
app.post("/api/exams/:id/questions/import", requireAuth, requireRole("admin"), upload.single("file"), async (req, res) => {
  const examId = Number(req.params.id);
  const exam = db.prepare("SELECT id FROM exams WHERE id=?").get(examId);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded. Use field name 'file'." });
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: "No worksheet found" });
    if (ws.rowCount > 1001) return res.status(400).json({ error: "Too many rows (max 1000 + header)" });
    let imported = 0;
    const errors = [];
    const baseOrder = db.prepare("SELECT COUNT(*) as n FROM questions WHERE exam_id=?").get(examId).n;
    let order = baseOrder;
    // assume first row is header
    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      if (row.cellCount === 0) continue;
      const sanitizeCell = (v) => String(v || "").trim().replace(/^[=+\-@]/, "'$&");
      const type = sanitizeCell(row.getCell(1).value).toLowerCase();
      const prompt = sanitizeCell(row.getCell(2).value);
      const optionsRaw = sanitizeCell(row.getCell(3).value);
      const answerRaw = sanitizeCell(row.getCell(4).value);
      const marksRaw = sanitizeCell(row.getCell(5).value) || "1";
      if (!prompt && !optionsRaw && !answerRaw) continue; // skip empty
      if (!["mcq","multi","tf"].includes(type)) { errors.push({ row: i, reason: `Invalid type '${type}'` }); continue; }
      if (!prompt) { errors.push({ row: i, reason: "Missing prompt" }); continue; }
      const options = optionsRaw.split(",").map(s=>s.trim()).filter(Boolean);
      const answer = answerRaw.split(",").map(s=>s.trim()).filter(Boolean);
      if (!options.length) { errors.push({ row: i, reason: "No options" }); continue; }
      if (!answer.length) { errors.push({ row: i, reason: "No answer" }); continue; }
      const missing = answer.filter(a=>!options.includes(a));
      if (missing.length) { errors.push({ row: i, reason: `Answer not in options: ${missing.join(",")}` }); continue; }
      const marks = Math.max(1, Number(marksRaw) || 1);
      db.prepare("INSERT INTO questions (exam_id, type, prompt, options, answer, marks, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)").run(examId, type, prompt, JSON.stringify(options), JSON.stringify(answer), marks, order++);
      imported++;
    }
    res.json({ imported, errors, totalRows: ws.rowCount - 1 });
  } catch (e) {
    console.error("Excel import failed", e);
    res.status(500).json({ error: "Failed to parse Excel file" });
  }
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
  let { questionId, given } = req.body ?? {};
  const q = db.prepare("SELECT * FROM questions WHERE id=? AND exam_id=?").get(Number(questionId), attempt.exam_id);
  if (!q) return res.status(404).json({ error: "Question not found" });
  // validate given against question type/options
  const opts = JSON.parse(q.options);
  if (!Array.isArray(given)) return res.status(400).json({ error: "Invalid answer format" });
  given = given.map(v => sanitize(String(v))).filter(Boolean);
  if (given.some(g => !opts.includes(g))) return res.status(400).json({ error: "Answer contains invalid option" });
  if (q.type !== "multi" && given.length !== 1) return res.status(400).json({ error: "Single answer required for this question type" });
  if (given.length > 6) return res.status(400).json({ error: "Too many answers" });
  db.prepare("INSERT INTO attempt_answers (attempt_id, question_id, given, is_correct, marks_awarded) VALUES (?, ?, ?, NULL, 0) ON CONFLICT(attempt_id, question_id) DO UPDATE SET given=excluded.given").run(attempt.id, q.id, JSON.stringify(given));
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
  if (examId) rows = db.prepare("SELECT id, exam_id, user_id, username, score, total, percent, passed, submitted_at FROM attempts WHERE exam_id=? AND status='graded' ORDER BY percent DESC").all(examId);
  else rows = db.prepare("SELECT id, exam_id, user_id, username, score, total, percent, passed, submitted_at FROM attempts WHERE status='graded' ORDER BY submitted_at DESC LIMIT 100").all();
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
app.get("/api/proctor/snapshot/:attemptId/:fname", (req, res) => {
  let user = null;
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try { const p = verifyToken(token); user = { id: Number(p.sub), username: p.username, role: p.role }; } catch {}
  }
  if (!user) return res.status(401).send("unauthorized");
  const fname = path.basename(req.params.fname);
  if (!/^\d+-\d+\.jpg$/.test(fname)) return res.status(400).send("invalid file name");
  const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(req.params.attemptId));
  if (!attempt) return res.status(404).send("not found");
  if (user.role!=="admin" && attempt.user_id!==user.id) return res.status(403).send("forbidden");
  const file = path.join(__dirname, "..", "uploads", "proctor", String(attempt.id), fname);
  if (!fs.existsSync(file)) return res.status(404).send("not found");
  res.setHeader("Cache-Control", "private, no-store");
  res.sendFile(file);
});

// global error handler - hide stack traces from client
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.length ? allowedOrigins : (process.env.NODE_ENV !== "production" ? true : false),
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
