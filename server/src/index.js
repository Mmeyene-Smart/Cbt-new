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

// Seeded PRNG (mulberry32) + Fisher-Yates shuffle
function seededRandom(seed) {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function seededShuffle(arr, seed) {
  const rng = seededRandom(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const corsOrigin = process.env.CORS_ORIGIN;
const allowedOrigins = corsOrigin ? corsOrigin.split(",").map(s=>s.trim()).filter(Boolean) : [];
const UPLOADS_BASE = process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads");
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
    const info = db.prepare("INSERT INTO users (username, password_hash, role, full_name, student_code, subjects, admin_subjects, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)").run("admin", hash, "super_admin", "System Administrator", null, JSON.stringify([]), JSON.stringify([]), Date.now());
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
app.get("/api/students", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  let rows;
  if (req.user.role === "super_admin") {
    rows = db.prepare("SELECT id, username, full_name, student_code, subjects, role, active, created_at FROM users WHERE role='student' ORDER BY id DESC").all();
  } else {
    // subject_admin/examiner: only students enrolled in at least one of their subjects
    const adminSubs = req.user.admin_subjects || [];
    if (!adminSubs.length) {
      rows = db.prepare("SELECT id, username, full_name, student_code, subjects, role, active, created_at FROM users WHERE role='student' ORDER BY id DESC").all();
    } else {
      rows = db.prepare("SELECT id, username, full_name, student_code, subjects, role, active, created_at FROM users WHERE role='student' ORDER BY id DESC").all();
      rows = rows.filter(r => {
        try {
          const subs = JSON.parse(r.subjects || "[]");
          return subs.some(s => adminSubs.includes(s));
        } catch { return false; }
      });
    }
  }
  const parsed = rows.map(r => {
    let subjects = [];
    try { subjects = r.subjects ? JSON.parse(r.subjects) : []; } catch { subjects = []; }
    return { ...r, subjects };
  });
  res.json(parsed);
});

// ===== Question Bank =====
app.get("/api/bank", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  const subject = req.query.subject || null;
  let rows;
  if (subject) rows = db.prepare("SELECT * FROM question_bank WHERE subject=? ORDER BY id DESC").all(subject);
  else rows = db.prepare("SELECT * FROM question_bank ORDER BY id DESC LIMIT 200").all();
  res.json(rows.map(r => ({ ...r, options: JSON.parse(r.options), answer: JSON.parse(r.answer) })));
});
app.post("/api/bank", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  const { subject, type, prompt, options, answer, marks, difficulty, topic, explanation } = req.body ?? {};
  const s = sanitize(prompt);
  if (!s || !Array.isArray(options) || !Array.isArray(answer)) return res.status(400).json({ error: "subject, type, prompt, options[], answer[] required" });
  const diffVal = difficulty ? sanitize(difficulty).slice(0,50) : null;
  const topicVal = topic ? sanitize(topic).slice(0,100) : null;
  const explVal = explanation ? sanitize(explanation).slice(0,2000) : null;
  const info = db.prepare("INSERT INTO question_bank (subject, type, prompt, options, answer, marks, difficulty, topic, explanation, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(sanitize(subject)||"General", type||"mcq", s, JSON.stringify(options), JSON.stringify(answer), Number(marks)||1, diffVal, topicVal, explVal, req.user.username, Date.now());
  res.json({ id: Number(info.lastInsertRowid) });
});
app.delete("/api/bank/:id", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  db.prepare("DELETE FROM question_bank WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
});
// Add question(s) from bank to an exam
app.post("/api/bank/add-to-exam", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  const examId = Number(req.body?.examId);
  const bankIds = req.body?.bankIds || [];
  if (!examId || !bankIds.length) return res.status(400).json({ error: "examId and bankIds[] required" });
  const exam = db.prepare("SELECT id FROM exams WHERE id=?").get(examId);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  const maxOrder = db.prepare("SELECT COALESCE(MAX(order_index),-1)+1 AS next FROM questions WHERE exam_id=?").get(examId).next;
  const bankQs = db.prepare(`SELECT * FROM question_bank WHERE id IN (${bankIds.map(()=>"?").join(",")})`).all(...bankIds);
  const ins = db.prepare("INSERT INTO questions (exam_id, type, prompt, options, answer, marks, difficulty, topic, explanation, order_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  let added = 0;
  bankQs.forEach((q, i) => {
    try { ins.run(examId, q.type, q.prompt, q.options, q.answer, q.marks, q.difficulty, q.topic, q.explanation, maxOrder + i); added++; } catch {}
  });
  res.json({ added });
});

// ===== Exam Templates =====
app.get("/api/templates", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  res.json(db.prepare("SELECT * FROM exam_templates ORDER BY id DESC").all());
});
app.post("/api/templates", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  const { name, subject, duration_minutes, pass_percent, camera_required, negative_marks, randomize_questions, randomize_options } = req.body ?? {};
  if (!name || name.length < 2) return res.status(400).json({ error: "Template name required" });
  const info = db.prepare("INSERT INTO exam_templates (name, subject, duration_minutes, pass_percent, camera_required, negative_marks, randomize_questions, randomize_options, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(sanitize(name), sanitize(subject)||"General", duration_minutes||30, pass_percent||50, camera_required!==false?1:0, negative_marks||0, randomize_questions?1:0, randomize_options?1:0, req.user.username, Date.now());
  res.json({ id: Number(info.lastInsertRowid) });
});
app.delete("/api/templates/:id", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  db.prepare("DELETE FROM exam_templates WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/exams/template.xlsx", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), async (_req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Questions");
    ws.columns = [
      { header: "Type (mcq/multi/tf)", key: "type", width: 18 },
      { header: "Prompt", key: "prompt", width: 50 },
      { header: "Options (comma-separated)", key: "options", width: 40 },
      { header: "Answer(s) (comma-separated, must match Options)", key: "answer", width: 40 },
      { header: "Marks", key: "marks", width: 10 },
    ];
    // header styling
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16A34A" } };
    headerRow.alignment = { horizontal: "center", vertical: "middle" };
    headerRow.commitRow();
    // data rows
    ws.addRow({ type: "mcq", prompt: "What is the capital of Nigeria?", options: "Lagos,Abuja,Kano", answer: "Abuja", marks: 1 });
    ws.addRow({ type: "multi", prompt: "Select all valid CSS units", options: "px,em,kg,rem", answer: "px,em,rem", marks: 1 });
    ws.addRow({ type: "tf", prompt: "Node.js can run outside the browser.", options: "True,False", answer: "True", marks: 1 });
    // auto-filter
    ws.autoFilter = { from: "A1", to: "E1" };
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=questions_template.xlsx");
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error("Template generation failed", e);
    if (!res.headersSent) res.status(500).json({ error: "Failed to generate template" });
  }
});

app.get("/api/exams", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT e.*, (SELECT COUNT(*) FROM questions q WHERE q.exam_id=e.id) AS question_count FROM exams e ORDER BY e.id DESC").all();
  if (req.user.role === "super_admin") return res.json(rows);
  // students: only show exams for subjects they're registered for
  if (req.user.role === "student") {
    let studentSubjects = [];
    try { studentSubjects = req.user.subjects || []; } catch { studentSubjects = []; }
    if (!studentSubjects.length) return res.json([]); // no subjects = no exams
    return res.json(rows.filter(e => studentSubjects.includes(e.subject)));
  }
  // admin roles: subject scoping
  const adminSubs = req.user.admin_subjects || [];
  if (!adminSubs.length) return res.json(rows);
  res.json(rows.filter(e => adminSubs.includes(e.subject)));
});

app.get("/api/exams/my-status", requireAuth, (req, res) => {
  if (req.user.role !== "student") return res.json({});
  const exams = db.prepare("SELECT id FROM exams").all();
  const result = {};
  for (const e of exams) {
    const att = db.prepare("SELECT id, status, score, total, percent FROM attempts WHERE exam_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1").get(e.id, req.user.id);
    result[e.id] = att || null;
  }
  res.json(result);
});

// Question analytics: per-question % correct for a specific exam (examiner view)
app.get("/api/exams/:id/question-analytics", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  const examId = Number(req.params.id);
  const questions = db.prepare("SELECT id, prompt, type, options, answer, marks, difficulty, topic FROM questions WHERE exam_id = ? ORDER BY order_index ASC").all(examId);
  const gradedAttempts = db.prepare("SELECT id FROM attempts WHERE exam_id = ? AND status = 'graded'").all(examId);
  const totalAttempts = gradedAttempts.length;
  if (!totalAttempts) return res.json({ questions: questions.map(q => ({ ...q, correctCount: 0, correctPercent: 0, avgMarks: 0 })), totalAttempts: 0 });
  const attemptIds = gradedAttempts.map(a => a.id);
  const placeholders = attemptIds.map(() => "?").join(",");
  const answers = db.prepare(`SELECT question_id, given, is_correct, marks_awarded FROM attempt_answers WHERE attempt_id IN (${placeholders})`).all(...attemptIds);
  const qStats = {};
  answers.forEach(a => {
    if (!qStats[a.question_id]) qStats[a.question_id] = { correctCount: 0, totalMarks: 0, count: 0 };
    qStats[a.question_id].count++;
    if (a.is_correct) qStats[a.question_id].correctCount++;
    qStats[a.question_id].totalMarks += a.marks_awarded;
  });
  const result = questions.map(q => {
    const s = qStats[q.id] || { correctCount: 0, totalMarks: 0, count: 0 };
    return {
      ...q,
      correctCount: s.correctCount,
      correctPercent: s.count ? Math.round((s.correctCount / s.count) * 100) : 0,
      avgMarks: s.count ? (s.totalMarks / s.count).toFixed(2) : "0.00",
    };
  });
  res.json({ questions: result, totalAttempts });
});

// Certificate: generate simple text certificate data for a graded attempt
app.get("/api/attempts/:id/certificate", requireAuth, (req, res) => {
  const attempt = db.prepare("SELECT a.*, e.title AS exam_title, e.subject, e.pass_percent FROM attempts a JOIN exams e ON e.id = a.exam_id WHERE a.id = ?").get(Number(req.params.id));
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });
  if (attempt.user_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });
  if (!attempt.passed) return res.status(400).json({ error: "Certificate only available for passed exams" });
  const verificationCode = `CBT-${attempt.id}-${attempt.exam_id}-${Date.now().toString(36).toUpperCase()}`;
  res.json({
    student_name: attempt.username,
    exam_title: attempt.exam_title,
    subject: attempt.subject,
    score: attempt.score,
    total: attempt.total,
    percent: Math.round(attempt.percent),
    passed: attempt.passed,
    date: attempt.submitted_at,
    verification_code: verificationCode,
  });
});

app.post("/api/exams", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  const title = sanitize(req.body?.title);
  const subject = sanitize(req.body?.subject) || "General";
  const duration = Math.max(5, Math.min(180, Number(req.body?.duration_minutes) || 30));
  const passPercent = Math.max(0, Math.min(100, Number(req.body?.pass_percent) || 50));
  const cameraRequired = req.body?.camera_required === false ? 0 : 1;
  const scheduledStart = req.body?.scheduled_start ? Number(req.body.scheduled_start) : null;
  const scheduledEnd = req.body?.scheduled_end ? Number(req.body.scheduled_end) : null;
  const randomizeQuestions = req.body?.randomize_questions ? 1 : 0;
  const randomizeOptions = req.body?.randomize_options ? 1 : 0;
  const negativeMarks = Math.max(0, Math.min(1, Number(req.body?.negative_marks) || 0));
  const examPassword = req.body?.exam_password ? sanitize(req.body.exam_password).slice(0, 50) : null;
  if (!title || title.length < 3 || title.length > 120) return res.status(400).json({ error: "Title must be 3-120 characters" });
  if (/[<>]/.test(title) || /[<>]/.test(subject)) return res.status(400).json({ error: "Invalid characters in title/subject" });
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36);
  const info = db.prepare("INSERT INTO exams (slug, title, subject, duration_minutes, pass_percent, status, camera_required, created_by, created_by_id, negative_marks, scheduled_start, scheduled_end, randomize_questions, randomize_options, exam_password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(slug, title, subject, duration, passPercent, "published", cameraRequired, req.user.username, req.user.id, negativeMarks, scheduledStart, scheduledEnd, randomizeQuestions, randomizeOptions, examPassword, Date.now());
  const exam = db.prepare("SELECT * FROM exams WHERE id=?").get(Number(info.lastInsertRowid));
  res.json(exam);
});

app.get("/api/exams/:id", requireAuth, (req, res) => {
  const exam = db.prepare("SELECT * FROM exams WHERE id=?").get(Number(req.params.id));
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  const questions = db.prepare("SELECT id, exam_id, type, prompt, options, answer, marks, difficulty, topic, explanation, order_index FROM questions WHERE exam_id=? ORDER BY order_index").all(exam.id);
  const isStudent = req.user.role === "student";
  // Get option seed from student's in-progress attempt
  let optionSeed = null;
  if (isStudent) {
    const att = db.prepare("SELECT option_seed FROM attempts WHERE exam_id=? AND user_id=? AND status='in_progress' ORDER BY started_at DESC LIMIT 1").get(exam.id, req.user.id);
    if (att) optionSeed = att.option_seed;
  }
  let sanitized = questions.map(q => {
    let opts = JSON.parse(q.options);
    // Shuffle options if randomize_options is enabled and we have a seed
    if (isStudent && exam.randomize_options && optionSeed) {
      const qSeed = Number(optionSeed) ^ q.id;
      opts = seededShuffle(opts, qSeed);
    }
    return {
      ...q,
      options: opts,
      answer: isStudent ? undefined : JSON.parse(q.answer),
      explanation: isStudent ? undefined : q.explanation,
    };
  });
  // randomize question order for students if exam has randomize_questions enabled
  if (isStudent && exam.randomize_questions) {
    sanitized = seededShuffle(sanitized, Number(optionSeed || Date.now()));
  }
  res.json({ exam, questions: sanitized });
});

app.post("/api/exams/:id/questions", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  const examId = Number(req.params.id);
  const exam = db.prepare("SELECT id FROM exams WHERE id=?").get(examId);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  let { type, prompt, options, answer, marks, difficulty, topic, explanation } = req.body ?? {};
  prompt = sanitize(prompt);
  if (!prompt || prompt.length > 1000) return res.status(400).json({ error: "Prompt required (1-1000 chars)" });
  if (!Array.isArray(options) || !Array.isArray(answer)) return res.status(400).json({ error: "prompt, options[], answer[] required" });
  options = options.map(o => sanitize(o)).filter(Boolean).slice(0, 6);
  answer = answer.map(a => sanitize(a)).filter(Boolean);
  if (options.length < 2 || options.some(o => o.length > 200)) return res.status(400).json({ error: "Options must be 2-6 items, each 1-200 chars" });
  if (!answer.length) return res.status(400).json({ error: "Answer required" });
  if (!["mcq","multi","tf"].includes(type)) return res.status(400).json({ error: "Invalid type" });
  const difficultyVal = ["easy","medium","hard"].includes(difficulty) ? difficulty : null;
  const topicVal = topic ? sanitize(topic).slice(0, 100) : null;
  const explanationVal = explanation ? sanitize(explanation).slice(0, 2000) : null;
  const order = db.prepare("SELECT COUNT(*) as n FROM questions WHERE exam_id=?").get(examId).n;
  const info = db.prepare("INSERT INTO questions (exam_id, type, prompt, options, answer, marks, difficulty, topic, explanation, order_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(examId, type, prompt, JSON.stringify(options), JSON.stringify(answer), Number(marks)||1, difficultyVal, topicVal, explanationVal, order);
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
app.post("/api/exams/:id/questions/import", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), upload.single("file"), async (req, res) => {
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
  try {
    const examId = Number(req.body?.examId);
    const cameraConsentAt = req.body?.cameraConsentAt ? Number(req.body.cameraConsentAt) : null;
    const exam = db.prepare("SELECT * FROM exams WHERE id=?").get(examId);
    if (!exam) return res.status(404).json({ error: "Exam not found" });
    // scheduling enforcement
    const now = Date.now();
    if (exam.scheduled_start && now < exam.scheduled_start) {
      return res.status(400).json({ error: `Exam not yet available. Starts at ${new Date(exam.scheduled_start).toLocaleString()}` });
    }
    if (exam.scheduled_end && now > exam.scheduled_end) {
      return res.status(400).json({ error: `Exam has expired. Ended at ${new Date(exam.scheduled_end).toLocaleString()}` });
    }
    // exam password enforcement
    if (exam.exam_password) {
      const provided = String(req.body?.exam_password || "");
      if (provided !== exam.exam_password) return res.status(400).json({ error: "Incorrect exam password" });
    }
    // allow concurrent same-account logins to have separate attempts if they explicitly want a new one
    const existing = db.prepare("SELECT * FROM attempts WHERE exam_id=? AND user_id=? AND status='in_progress' ORDER BY started_at DESC LIMIT 1").get(examId, req.user.id);
    if (existing && !req.body?.forceNew) return res.json({ attemptId: existing.id, endsAt: existing.ends_at, exam });
    const qRow = db.prepare("SELECT COUNT(*) as n FROM questions WHERE exam_id=?").get(examId);
    const qCount = qRow ? qRow.n : 0;
    if (!qCount) return res.status(400).json({ error: "Exam has no questions" });
    const endsAt = now + exam.duration_minutes * 60 * 1000;
    const optionSeed = exam.randomize_options ? String(Date.now() ^ (req.user.id * 0x5bd1e995)) : null;
    const info = db.prepare("INSERT INTO attempts (exam_id, user_id, username, status, score, total, percent, passed, camera_consent_at, started_at, ends_at, option_seed) VALUES (?, ?, ?, 'in_progress', 0, ?, 0, 0, ?, ?, ?, ?)").run(examId, req.user.id, req.user.username, qCount, cameraConsentAt, now, endsAt, optionSeed);
    const attemptId = Number(info.lastInsertRowid);
    res.json({ attemptId, endsAt, exam });
  } catch (e) {
    console.error("[attempts/start]", e);
    res.status(500).json({ error: e.message });
  }
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
  const exam = db.prepare("SELECT * FROM exams WHERE id=?").get(attempt.exam_id);
  const questions = db.prepare("SELECT * FROM questions WHERE exam_id=?").all(attempt.exam_id);
  const negativeMarks = exam?.negative_marks || 0;
  let score = 0;
  for (const q of questions) {
    const ans = db.prepare("SELECT given FROM attempt_answers WHERE attempt_id=? AND question_id=?").get(attemptId, q.id);
    const given = ans ? JSON.parse(ans.given) : null;
    const correct = JSON.parse(q.answer);
    let isCorrect = false;
    let partialCredit = 0;
    if (q.type === "mcq" || q.type === "tf") {
      isCorrect = Array.isArray(given) && given.length === 1 && given[0] === correct[0];
    } else if (q.type === "multi") {
      if (Array.isArray(given) && given.length > 0) {
        const correctSet = new Set(correct);
        const givenSet = new Set(given);
        const correctChosen = [...givenSet].filter(v => correctSet.has(v)).length;
        const wrongChosen = [...givenSet].filter(v => !correctSet.has(v)).length;
        if (wrongChosen === 0 && correctChosen === correct.length) {
          isCorrect = true;
        } else if (correctChosen > 0) {
          partialCredit = (correctChosen / correct.length) - (wrongChosen / correct.length);
          partialCredit = Math.max(0, partialCredit);
        }
      }
    }
    let marks = 0;
    if (isCorrect) {
      marks = q.marks;
    } else if (partialCredit > 0) {
      marks = q.marks * partialCredit;
    } else if (given && given.length > 0) {
      marks = -(q.marks * negativeMarks);
    }
    score += marks;
    if (ans) db.prepare("UPDATE attempt_answers SET is_correct=?, marks_awarded=? WHERE attempt_id=? AND question_id=?").run(isCorrect ? 1 : 0, Math.round(marks * 100) / 100, attemptId, q.id);
  }
  const total = questions.reduce((s, q) => s + q.marks, 0);
  const maxPossible = total;
  const percent = maxPossible ? Math.max(0, (score / maxPossible) * 100) : 0;
  const isPassed = percent >= (exam?.pass_percent ?? 50) ? 1 : 0;
  db.prepare("UPDATE attempts SET status='graded', score=?, total=?, percent=?, passed=?, submitted_at=? WHERE id=?").run(Math.round(score * 100) / 100, total, Math.round(percent * 10) / 10, isPassed, Date.now(), attemptId);
  return db.prepare("SELECT * FROM attempts WHERE id=?").get(attemptId);
}

function getDetailedResults(attemptId) {
  const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(attemptId);
  const questions = db.prepare("SELECT * FROM questions WHERE exam_id=?").all(attempt.exam_id);
  const answers = db.prepare("SELECT * FROM attempt_answers WHERE attempt_id=?").all(attemptId);
  const answerMap = {};
  answers.forEach(a => { answerMap[a.question_id] = a; });
  const detailed = questions.map(q => {
    const ans = answerMap[q.id];
    const given = ans ? JSON.parse(ans.given) : [];
    const correct = JSON.parse(q.answer);
    return {
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      options: JSON.parse(q.options),
      correct,
      given,
      is_correct: ans?.is_correct === 1,
      marks_awarded: ans?.marks_awarded || 0,
      marks_total: q.marks,
      explanation: q.explanation || null,
      difficulty: q.difficulty,
      topic: q.topic,
    };
  });
  return { attempt, questions: detailed };
}

app.post("/api/attempts/:id/submit", requireAuth, (req, res) => {
  const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(req.params.id));
  if (!attempt || attempt.user_id !== req.user.id) return res.status(404).json({ error: "Attempt not found" });
  if (attempt.status !== "in_progress") {
    const existing = getDetailedResults(attempt.id);
    return res.json(existing);
  }
  gradeAttempt(attempt.id);
  const detailed = getDetailedResults(attempt.id);
  res.json(detailed);
});

// fetch saved answers for an attempt (for auto-save resume)
app.get("/api/attempts/:id/answers", requireAuth, (req, res) => {
  const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(req.params.id));
  if (!attempt || attempt.user_id !== req.user.id) return res.status(404).json({ error: "Attempt not found" });
  const rows = db.prepare("SELECT question_id, given FROM attempt_answers WHERE attempt_id=?").all(attempt.id);
  const answers = {};
  rows.forEach(r => { try { answers[r.question_id] = JSON.parse(r.given); } catch {} });
  res.json({ answers, endsAt: attempt.ends_at });
});

// flag / unflag a question
app.post("/api/attempts/:id/flag/:questionId", requireAuth, (req, res) => {
  const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(req.params.id));
  if (!attempt || attempt.user_id !== req.user.id) return res.status(404).json({ error: "Attempt not found" });
  const qid = Number(req.params.questionId);
  const q = db.prepare("SELECT id FROM questions WHERE id=? AND exam_id=?").get(qid, attempt.exam_id);
  if (!q) return res.status(404).json({ error: "Question not found" });
  try {
    db.prepare("INSERT OR IGNORE INTO flagged_questions (attempt_id, question_id, flagged_at) VALUES (?, ?, ?)").run(attempt.id, qid, Date.now());
  } catch {}
  res.json({ ok: true, flagged: true });
});
app.delete("/api/attempts/:id/flag/:questionId", requireAuth, (req, res) => {
  const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(req.params.id));
  if (!attempt || attempt.user_id !== req.user.id) return res.status(404).json({ error: "Attempt not found" });
  const qid = Number(req.params.questionId);
  db.prepare("DELETE FROM flagged_questions WHERE attempt_id=? AND question_id=?").run(attempt.id, qid);
  res.json({ ok: true, flagged: false });
});

// get flagged questions for an attempt
app.get("/api/attempts/:id/flags", requireAuth, (req, res) => {
  const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(req.params.id));
  if (!attempt || attempt.user_id !== req.user.id) return res.status(404).json({ error: "Attempt not found" });
  const rows = db.prepare("SELECT question_id, flagged_at FROM flagged_questions WHERE attempt_id=?").all(attempt.id);
  const flags = {};
  rows.forEach(r => { flags[r.question_id] = r.flagged_at; });
  res.json(flags);
});

// In-exam chat: send message
app.post("/api/attempts/:id/messages", requireAuth, (req, res) => {
  const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(req.params.id));
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });
  // student can only message their own attempt; examiner/super_admin can message any
  if (req.user.role === "student" && attempt.user_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });
  const body = String(req.body?.body || "").trim();
  if (!body || body.length > 500) return res.status(400).json({ error: "Message must be 1-500 characters" });
  const info = db.prepare("INSERT INTO exam_messages (attempt_id, exam_id, sender_id, sender_role, sender_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(attempt.id, attempt.exam_id, req.user.id, req.user.role, req.user.username, body, Date.now());
  const msg = { id: Number(info.lastInsertRowid), attempt_id: attempt.id, sender_id: req.user.id, sender_role: req.user.role, sender_name: req.user.username, body, created_at: Date.now() };
  // broadcast to proctor wall
  if (global._io) global._io.to("proctors").emit("chat-message", msg);
  res.json(msg);
});

// In-exam chat: get messages for an attempt
app.get("/api/attempts/:id/messages", requireAuth, (req, res) => {
  const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(req.params.id));
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });
  if (req.user.role === "student" && attempt.user_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });
  const rows = db.prepare("SELECT * FROM exam_messages WHERE attempt_id=? ORDER BY id ASC").all(attempt.id);
  res.json(rows);
});

// In-exam chat: get all messages for a student's active attempts (for proctor view)
app.get("/api/proctor/messages", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, e.title AS exam_title
    FROM exam_messages m
    JOIN exams e ON e.id = m.exam_id
    ORDER BY m.id DESC
    LIMIT 100
  `).all();
  res.json(rows);
});

// ===== Exam Attendance Sheet =====
app.get("/api/exams/:id/attendance", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  const examId = Number(req.params.id);
  const exam = db.prepare("SELECT title, subject FROM exams WHERE id=?").get(examId);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  const rows = db.prepare(`
    SELECT a.id, a.username, a.status, a.score, a.total, a.percent, a.passed, a.started_at, a.submitted_at, a.camera_consent_at,
           u.full_name, u.student_code
    FROM attempts a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.exam_id = ? ORDER BY a.started_at ASC
  `).all(examId);
  res.json({ exam, attempts: rows });
});

// ===== Bulk Student Enrollment (CSV) =====
app.post("/api/students/enroll", requireAuth, requireRole("super_admin"), (req, res) => {
  const entries = req.body?.entries; // [{username, subjects: ["Math","CS"]}]
  if (!Array.isArray(entries) || !entries.length) return res.status(400).json({ error: "entries[] required" });
  let updated = 0;
  const upd = db.prepare("UPDATE users SET subjects = ? WHERE username = ? COLLATE NOCASE AND role = 'student'");
  for (const e of entries) {
    if (!e.username || !Array.isArray(e.subjects)) continue;
    const existing = db.prepare("SELECT subjects FROM users WHERE username = ? COLLATE NOCASE AND role = 'student'").get(e.username);
    if (!existing) continue;
    let current = [];
    try { current = existing.subjects ? JSON.parse(existing.subjects) : []; } catch {}
    const merged = [...new Set([...current, ...e.subjects])];
    upd.run(JSON.stringify(merged), e.username);
    updated++;
  }
  res.json({ updated });
});

// ===== Exam Statistics =====
app.get("/api/exams/:id/stats", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  const examId = Number(req.params.id);
  const exam = db.prepare("SELECT * FROM exams WHERE id=?").get(examId);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  const attempts = db.prepare("SELECT * FROM attempts WHERE exam_id=? AND status='graded'").all(examId);
  const questions = db.prepare("SELECT * FROM questions WHERE exam_id=? ORDER BY order_index").all(examId);
  const totalAttempts = attempts.length;
  if (!totalAttempts) return res.json({ exam, totalAttempts: 0, passRate: 0, avgPercent: 0, avgTime: 0, scoreDistribution: [], questionStats: [], topStudents: [] });
  const passed = attempts.filter(a => a.passed).length;
  const avgPercent = Math.round(attempts.reduce((s, a) => s + a.percent, 0) / totalAttempts);
  const avgTime = Math.round(attempts.filter(a => a.submitted_at).reduce((s, a) => s + (a.submitted_at - a.started_at), 0) / totalAttempts / 60000);
  // Score distribution (buckets of 10)
  const buckets = Array(10).fill(0);
  attempts.forEach(a => { const b = Math.min(9, Math.floor(a.percent / 10)); buckets[b]++; });
  const scoreDistribution = buckets.map((count, i) => ({ range: `${i*10}-${i*10+9}%`, count }));
  // Question stats
  const answerMap = {};
  db.prepare(`SELECT question_id, is_correct, marks_awarded FROM attempt_answers WHERE attempt_id IN (SELECT id FROM attempts WHERE exam_id=? AND status='graded')`).all(examId).forEach(a => {
    if (!answerMap[a.question_id]) answerMap[a.question_id] = { correct: 0, total: 0, totalMarks: 0 };
    answerMap[a.question_id].total++;
    if (a.is_correct) answerMap[a.question_id].correct++;
    answerMap[a.question_id].totalMarks += a.marks_awarded;
  });
  const questionStats = questions.map(q => {
    const s = answerMap[q.id] || { correct: 0, total: 0, totalMarks: 0 };
    return { id: q.id, prompt: q.prompt.slice(0, 80), type: q.type, difficulty: q.difficulty, topic: q.topic, correctPercent: s.total ? Math.round((s.correct / s.total) * 100) : 0, avgMarks: s.total ? (s.totalMarks / s.total).toFixed(2) : "0", responses: s.total };
  });
  // Top students
  const topStudents = attempts.sort((a, b) => b.percent - a.percent).slice(0, 10).map(a => ({ username: a.username, score: a.score, total: a.total, percent: Math.round(a.percent) }));
  res.json({ exam, totalAttempts, passRate: Math.round((passed / totalAttempts) * 100), avgPercent, avgTime, scoreDistribution, questionStats, topStudents });
});

// ===== Bulk Student Enrollment via CSV file upload =====
app.post("/api/students/enroll/csv", requireAuth, requireRole("super_admin"), upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "CSV file required" });
    const content = req.file.buffer.toString("utf-8");
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    const entries = [];
    for (const line of lines.slice(1)) { // skip header
      const parts = line.split(",").map(s => s.trim().replace(/^"|"$/g, ""));
      if (parts.length >= 2 && parts[0] && parts[1]) {
        entries.push({ username: parts[0], subjects: parts[1].split(";").map(s => s.trim()).filter(Boolean) });
      }
    }
    if (!entries.length) return res.status(400).json({ error: "No valid entries found in CSV. Format: username,subject1;subject2" });
    let updated = 0;
    const upd = db.prepare("UPDATE users SET subjects = ? WHERE username = ? COLLATE NOCASE AND role = 'student'");
    for (const e of entries) {
      const existing = db.prepare("SELECT subjects FROM users WHERE username = ? COLLATE NOCASE AND role = 'student'").get(e.username);
      if (!existing) continue;
      let current = [];
      try { current = existing.subjects ? JSON.parse(existing.subjects) : []; } catch {}
      const merged = [...new Set([...current, ...e.subjects])];
      upd.run(JSON.stringify(merged), e.username);
      updated++;
    }
    res.json({ updated, total: entries.length });
  } catch (e) {
    console.error("CSV enrollment failed", e);
    res.status(500).json({ error: "CSV parse failed" });
  }
});

// clone an exam with all its questions
app.post("/api/exams/:id/clone", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  const srcExam = db.prepare("SELECT * FROM exams WHERE id=?").get(Number(req.params.id));
  if (!srcExam) return res.status(404).json({ error: "Source exam not found" });
  const suffix = req.body?.suffix || " (Copy)";
  const newTitle = srcExam.title + suffix;
  const slug = newTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36);
  const info = db.prepare("INSERT INTO exams (slug, title, subject, duration_minutes, pass_percent, status, camera_required, created_by, created_by_id, negative_marks, scheduled_start, scheduled_end, randomize_questions, created_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, NULL, NULL, ?, ?)").run(slug, newTitle, srcExam.subject, srcExam.duration_minutes, srcExam.pass_percent, srcExam.camera_required, req.user.username, req.user.id, srcExam.negative_marks || 0, srcExam.randomize_questions, Date.now());
  const newExamId = Number(info.lastInsertRowid);
  const questions = db.prepare("SELECT * FROM questions WHERE exam_id=? ORDER BY order_index").all(srcExam.id);
  const qIns = db.prepare("INSERT INTO questions (exam_id, type, prompt, options, answer, marks, difficulty, topic, explanation, order_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const q of questions) {
    qIns.run(newExamId, q.type, q.prompt, q.options, q.answer, q.marks, q.difficulty, q.topic, q.explanation, q.order_index);
  }
  auditLog(req.user, "clone_exam", "exam", newExamId, { source_exam_id: srcExam.id, title: newTitle, question_count: questions.length });
  const exam = db.prepare("SELECT * FROM exams WHERE id=?").get(newExamId);
  res.json(exam);
});

// export results as Excel
app.get("/api/results/export", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), async (req, res) => {
  try {
    const examId = req.query.examId ? Number(req.query.examId) : null;
    let attempts;
    if (examId) {
      attempts = db.prepare("SELECT a.*, e.title as exam_title FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.exam_id=? AND a.status='graded' ORDER BY a.percent DESC").all(examId);
    } else {
      attempts = db.prepare("SELECT a.*, e.title as exam_title FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.status='graded' ORDER BY a.submitted_at DESC LIMIT 500").all();
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Results");
    ws.columns = [
      { header: "Exam", key: "exam_title", width: 40 },
      { header: "Student", key: "username", width: 20 },
      { header: "Score", key: "score", width: 10 },
      { header: "Total", key: "total", width: 10 },
      { header: "Percent", key: "percent", width: 10 },
      { header: "Status", key: "status_text", width: 10 },
      { header: "Submitted", key: "submitted_at_text", width: 22 },
    ];
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16A34A" } };
    headerRow.commitRow();
    for (const a of attempts) {
      ws.addRow({
        exam_title: a.exam_title || `Exam #${a.exam_id}`,
        username: a.username,
        score: a.score,
        total: a.total,
        percent: Math.round(a.percent * 10) / 10,
        status_text: a.passed ? "Pass" : "Fail",
        submitted_at_text: a.submitted_at ? new Date(a.submitted_at).toLocaleString() : "",
      });
    }
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=results.xlsx");
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error("Export failed", e);
    if (!res.headersSent) res.status(500).json({ error: "Export failed" });
  }
});

// PDF-style HTML report export
app.get("/api/results/report", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  const examId = req.query.examId ? Number(req.query.examId) : null;
  let attempts, examTitle = "All Exams";
  if (examId) {
    const exam = db.prepare("SELECT title FROM exams WHERE id=?").get(examId);
    examTitle = exam?.title || `Exam #${examId}`;
    attempts = db.prepare("SELECT a.*, e.title as exam_title FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.exam_id=? AND a.status='graded' ORDER BY a.percent DESC").all(examId);
  } else {
    attempts = db.prepare("SELECT a.*, e.title as exam_title FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.status='graded' ORDER BY a.submitted_at DESC LIMIT 500").all();
  }
  const total = attempts.length;
  const passed = attempts.filter(a => a.passed).length;
  const avgPercent = total ? Math.round(attempts.reduce((s, a) => s + a.percent, 0) / total) : 0;
  const passRate = total ? Math.round((passed / total) * 100) : 0;
  const rows = attempts.map((a, i) => `<tr><td>${i + 1}</td><td>${a.username}</td><td>${a.exam_title || ""}</td><td>${a.score}/${a.total}</td><td>${Math.round(a.percent)}%</td><td class="${a.passed ? "pass" : "fail"}">${a.passed ? "Pass" : "Fail"}</td><td>${a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : ""}</td></tr>`).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report - ${examTitle}</title><style>
    @media print { body { margin: 0; } }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; padding: 40px; color: #1a1a2e; background: #fff; }
    h1 { font-size: 22px; color: #16a34a; margin-bottom: 4px; }
    h2 { font-size: 14px; color: #666; font-weight: normal; margin-bottom: 20px; }
    .stats { display: flex; gap: 16px; margin-bottom: 24px; }
    .stat { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; }
    .stat .num { font-size: 28px; font-weight: bold; color: #16a34a; }
    .stat .label { font-size: 12px; color: #64748b; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #16a34a; color: #fff; padding: 10px 12px; text-align: left; font-weight: 600; }
    td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; }
    tr:nth-child(even) { background: #f8fafc; }
    .pass { color: #16a34a; font-weight: 600; }
    .fail { color: #dc2626; font-weight: 600; }
    .footer { margin-top: 24px; font-size: 11px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 12px; }
    @media print { .no-print { display: none; } }
  </style></head><body>
    <h1>Examination Results Report</h1><h2>${examTitle} — Generated ${new Date().toLocaleDateString()}</h2>
    <div class="stats">
      <div class="stat"><div class="num">${total}</div><div class="label">Total Attempts</div></div>
      <div class="stat"><div class="num">${passed}</div><div class="label">Passed</div></div>
      <div class="stat"><div class="num">${avgPercent}%</div><div class="label">Average Score</div></div>
      <div class="stat"><div class="num">${passRate}%</div><div class="label">Pass Rate</div></div>
    </div>
    <table><thead><tr><th>#</th><th>Student</th><th>Exam</th><th>Score</th><th>%</th><th>Status</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="footer">University Student Examination Portal — CBT Platform Report</div>
    <div class="no-print" style="margin-top:16px;text-align:center"><button onclick="window.print()" style="padding:8px 24px;background:#16a34a;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px">Print / Save as PDF</button></div>
  </body></html>`;
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

// tab-switch violation reporting (during exam)
app.post("/api/attempts/:id/tab-violation", requireAuth, (req, res) => {
  const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(req.params.id));
  if (!attempt || attempt.user_id !== req.user.id) return res.status(404).json({ error: "Attempt not found" });
  if (attempt.status !== "in_progress") return res.status(400).json({ error: "Attempt not active" });
  db.prepare("INSERT INTO tab_violations (attempt_id, user_id, detected_at) VALUES (?, ?, ?)").run(attempt.id, req.user.id, Date.now());
  const count = db.prepare("SELECT COUNT(*) as n FROM tab_violations WHERE attempt_id=?").get(attempt.id).n;
  // auto-submit after 5 violations
  if (count >= 5) {
    const graded = gradeAttempt(attempt.id);
    return res.json({ count, autoSubmitted: true, graded });
  }
  res.json({ count, autoSubmitted: false });
});

// list tab violations for an attempt (admin)
app.get("/api/attempts/:id/violations", requireAuth, (req, res) => {
  const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(req.params.id));
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });
  if (req.user.role === "student" && attempt.user_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });
  const rows = db.prepare("SELECT id, detected_at FROM tab_violations WHERE attempt_id=? ORDER BY detected_at DESC").all(attempt.id);
  res.json(rows);
});

// Student review: read-only detailed review of a graded attempt
app.get("/api/attempts/:id/review", requireAuth, (req, res) => {
  const attempt = db.prepare("SELECT a.*, e.title AS exam_title, e.subject, e.pass_percent FROM attempts a JOIN exams e ON e.id = a.exam_id WHERE a.id = ?").get(Number(req.params.id));
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });
  if (req.user.role === "student" && attempt.user_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });
  if (attempt.status !== "graded") return res.status(400).json({ error: "Only graded attempts can be reviewed" });
  const detailed = getDetailedResults(attempt.id);
  res.json({ ...detailed, exam_title: attempt.exam_title, subject: attempt.subject });
});

app.get("/api/attempts/:id", requireAuth, (req, res) => {
  const a = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: "Not found" });
  if (req.user.role === "student" && a.user_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });
  const answers = db.prepare("SELECT * FROM attempt_answers WHERE attempt_id=?").all(a.id);
  const snapshots = db.prepare("SELECT id, captured_at FROM proctor_snapshots WHERE attempt_id=? ORDER BY captured_at DESC LIMIT 100").all(a.id);
  res.json({ attempt: a, answers, snapshots });
});

app.get("/api/results", requireAuth, (req, res) => {
  const examId = req.query.examId ? Number(req.query.examId) : null;
  let rows;
  if (examId) rows = db.prepare("SELECT a.id, a.exam_id, a.user_id, a.username, a.score, a.total, a.percent, a.passed, a.submitted_at, e.title AS exam_title FROM attempts a JOIN exams e ON e.id = a.exam_id WHERE a.exam_id=? AND a.status='graded' ORDER BY a.percent DESC").all(examId);
  else rows = db.prepare("SELECT a.id, a.exam_id, a.user_id, a.username, a.score, a.total, a.percent, a.passed, a.submitted_at, e.title AS exam_title FROM attempts a JOIN exams e ON e.id = a.exam_id WHERE a.status='graded' ORDER BY a.submitted_at DESC LIMIT 100").all();
  if (req.user.role !== "admin") rows = rows.filter(r=>r.user_id===req.user.id);
  res.json(rows);
});

app.get("/api/student/dashboard", requireAuth, (req, res) => {
  if (req.user.role !== "student") return res.status(403).json({ error: "Students only" });
  const studentSubjects = req.user.subjects || [];
  const exams = db.prepare("SELECT id, title, subject, duration_minutes, pass_percent, status, scheduled_start, scheduled_end, negative_marks, (SELECT COUNT(*) FROM questions q WHERE q.exam_id = exams.id) AS question_count FROM exams ORDER BY id DESC").all();
  const myExams = exams.filter(e => studentSubjects.includes(e.subject));
  const attempts = db.prepare("SELECT exam_id, score, total, percent, passed, submitted_at, status FROM attempts WHERE user_id = ? ORDER BY submitted_at DESC").all(req.user.id);
  const examMap = {};
  myExams.forEach(e => { examMap[e.id] = e; });
  // Per-subject stats
  const subjectStats = {};
  studentSubjects.forEach(s => { subjectStats[s] = { total: 0, passed: 0, bestPercent: 0, avgPercent: 0, exams: 0, attempts: 0, recentScores: [] }; });
  attempts.forEach(a => {
    const exam = examMap[a.exam_id];
    if (!exam) return;
    const sub = subjectStats[exam.subject];
    if (!sub) return;
    sub.attempts++;
    sub.exams = new Set([...(sub._examIds || []), a.exam_id]).size;
    sub._examIds = [...(sub._examIds || []), a.exam_id];
    if (a.status === "graded") {
      sub.total++;
      if (a.passed) sub.passed++;
      if (a.percent > sub.bestPercent) sub.bestPercent = Math.round(a.percent);
      sub.recentScores.push(Math.round(a.percent));
    }
  });
  // Compute averages
  Object.values(subjectStats).forEach(s => {
    s.avgPercent = s.recentScores.length ? Math.round(s.recentScores.reduce((a,b)=>a+b,0) / s.recentScores.length) : 0;
    s.recentScores = s.recentScores.slice(0, 5);
    delete s._examIds;
  });
  // Overall
  const gradedAttempts = attempts.filter(a => a.status === "graded");
  const overall = {
    totalExams: myExams.length,
    examsTaken: gradedAttempts.length,
    examsRemaining: myExams.length - gradedAttempts.length,
    overallAvg: gradedAttempts.length ? Math.round(gradedAttempts.reduce((a,b)=>a+b.percent,0) / gradedAttempts.length) : 0,
    overallPassRate: gradedAttempts.length ? Math.round((gradedAttempts.filter(a=>a.passed).length / gradedAttempts.length) * 100) : 0,
    bestScore: gradedAttempts.length ? Math.round(Math.max(...gradedAttempts.map(a=>a.percent))) : 0,
  };
  // Weak topics: exams where percent < 50
  const weakAttempts = gradedAttempts.filter(a => a.percent < 50).map(a => ({ title: examMap[a.exam_id]?.title || "Unknown", subject: examMap[a.exam_id]?.subject, percent: Math.round(a.percent) }));
  res.json({ subjects: subjectStats, overall, weakAttempts: weakAttempts.slice(0, 5), studentSubjects });
});

app.get("/api/results/combined", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  const ids = String(req.query.examIds||"").split(",").map(s=>Number(s)).filter(Boolean);
  if (!ids.length) return res.json({ exams: [], stats: { total:0, avgPercent:0, passRate:0 }});
  const placeholders = ids.map(()=>"?").join(",");
  const attempts = db.prepare(`SELECT * FROM attempts WHERE exam_id IN (${placeholders}) AND status='graded'`).all(...ids);
  const total = attempts.length;
  const avg = total ? attempts.reduce((s,a)=>s+a.percent,0)/total : 0;
  const passRate = total ? attempts.filter(a=>a.passed).length/total*100 : 0;
  res.json({ exams: ids, attempts, stats: { total, avgPercent: Math.round(avg*10)/10, passRate: Math.round(passRate*10)/10 }});
});

// proctor live polling endpoint — returns latest snapshot per active attempt (fallback when socket fails)
app.get("/api/proctor/live", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  try {
    const activeAttempts = db.prepare(`
      SELECT a.id as attempt_id, a.user_id, a.username, a.exam_id, e.title as exam_title
      FROM attempts a JOIN exams e ON e.id = a.exam_id
      WHERE a.status = 'in_progress' AND a.ends_at > ?
    `).all(Date.now());
    const results = [];
    for (const att of activeAttempts) {
      const snap = db.prepare(`
        SELECT id, captured_at, file_path FROM proctor_snapshots
        WHERE attempt_id = ? ORDER BY captured_at DESC LIMIT 1
      `).get(att.attempt_id);
      if (snap) {
        const fname = snap.file_path.split(/[\\/]/).pop();
        results.push({
          attemptId: att.attempt_id,
          userId: att.user_id,
          username: att.username,
          examTitle: att.exam_title,
          ts: snap.captured_at,
          url: `/api/proctor/snapshot/${att.attempt_id}/${fname}`,
        });
      }
    }
    res.json(results);
  } catch (e) {
    console.error("[proctor/live]", e);
    res.json([]);
  }
});

// proctor snapshots list + file serve
app.get("/api/proctor/snapshots/:attemptId", requireAuth, (req, res) => {
  const attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(Number(req.params.attemptId));
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });
  if (req.user.role === "student" && attempt.user_id !== req.user.id) return res.status(403).json({error:"Forbidden"});
  const rows = db.prepare("SELECT id, captured_at, file_path FROM proctor_snapshots WHERE attempt_id=? ORDER BY captured_at DESC LIMIT 100").all(attempt.id);
  res.json(rows.map(r => {
    const fname = r.file_path.split(/[\\/]/).pop();
    return { ...r, url: `/api/proctor/snapshot/${attempt.id}/${fname}` };
  }));
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
  if (user.role === "student" && attempt.user_id !== user.id) return res.status(403).send("forbidden");
  const file = path.join(UPLOADS_BASE, "proctor", String(attempt.id), fname);
  if (!fs.existsSync(file)) return res.status(404).send("not found");
  res.setHeader("Cache-Control", "private, no-store");
  res.sendFile(file);
});

// ---- audit log helper ----
function auditLog(user, action, targetType, targetId, details) {
  try {
    db.prepare("INSERT INTO audit_log (user_id, username, role, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(user.id, user.username, user.role || null, action, targetType || null, targetId || null, details ? JSON.stringify(details) : null, Date.now());
  } catch (e) { console.error("audit log failed:", e.message); }
}

// ---- admin management (super_admin only) ----
app.get("/api/admin/users", requireAuth, requireRole("super_admin"), (_req, res) => {
  const rows = db.prepare("SELECT id, username, role, full_name, admin_subjects, active, created_at FROM users WHERE role IN ('super_admin','subject_admin','examiner') ORDER BY id").all();
  const parsed = rows.map(r => {
    let admin_subjects = [];
    try { admin_subjects = r.admin_subjects ? JSON.parse(r.admin_subjects) : []; } catch { admin_subjects = []; }
    return { ...r, admin_subjects };
  });
  res.json(parsed);
});

app.post("/api/admin/users", requireAuth, requireRole("super_admin"), async (req, res) => {
  const { username, password, role, full_name, subjects } = req.body ?? {};
  if (!username || !password || !role) return res.status(400).json({ error: "username, password, role required" });
  if (!["super_admin", "subject_admin", "examiner"].includes(role)) return res.status(400).json({ error: "Invalid role" });
  if (password.length < 8 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])/.test(password))
    return res.status(400).json({ error: "Password must be at least 8 chars with upper/lower/number" });
  const bcrypt = await import("bcryptjs");
  const hash = bcrypt.hashSync(password, 12);
  const adminSubjects = Array.isArray(subjects) ? subjects.map(s => String(s).trim()).filter(Boolean) : [];
  try {
    const info = db.prepare("INSERT INTO users (username, password_hash, role, full_name, subjects, admin_subjects, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)").run(username, hash, role, full_name || username, JSON.stringify([]), JSON.stringify(adminSubjects), Date.now());
    const id = Number(info.lastInsertRowid);
    auditLog(req.user, "create_admin", "user", id, { username, role, subjects: adminSubjects });
    res.json({ id, username, role, admin_subjects: adminSubjects });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({ error: "Username taken." });
    throw e;
  }
});

app.put("/api/admin/users/:id", requireAuth, requireRole("super_admin"), async (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id=?").get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: "User not found" });
  if (target.username === "admin" && target.id === req.user.id) return res.status(400).json({ error: "Cannot modify your own account" });
  const { role, subjects, password, active } = req.body ?? {};
  const updates = [];
  const params = [];
  if (role && ["super_admin", "subject_admin", "examiner"].includes(role)) { updates.push("role=?"); params.push(role); }
  if (Array.isArray(subjects)) { updates.push("admin_subjects=?"); params.push(JSON.stringify(subjects)); }
  if (typeof active === "number" || typeof active === "boolean") { updates.push("active=?"); params.push(active ? 1 : 0); }
  if (password) {
    if (password.length < 8 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])/.test(password))
      return res.status(400).json({ error: "Password must be at least 8 chars with upper/lower/number" });
    const bcrypt = await import("bcryptjs");
    updates.push("password_hash=?"); params.push(bcrypt.hashSync(password, 12));
  }
  if (!updates.length) return res.status(400).json({ error: "Nothing to update" });
  params.push(target.id);
  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id=?`).run(...params);
  auditLog(req.user, "update_admin", "user", target.id, { role, subjects });
  res.json({ ok: true });
});

app.delete("/api/admin/users/:id", requireAuth, requireRole("super_admin"), (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id=?").get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: "User not found" });
  if (target.username === "admin" && target.id === req.user.id) return res.status(400).json({ error: "Cannot delete your own account" });
  db.prepare("UPDATE users SET active=0 WHERE id=?").run(target.id);
  auditLog(req.user, "deactivate_admin", "user", target.id, { username: target.username });
  res.json({ ok: true });
});

// ---- dashboard stats (subject-scoped) ----
app.get("/api/dashboard/stats", requireAuth, requireRole("super_admin", "subject_admin", "examiner"), (req, res) => {
  const examRows = db.prepare("SELECT * FROM exams ORDER BY id DESC").all();
  const adminSubs = req.user.admin_subjects || [];
  const scopedExams = adminSubs.length ? examRows.filter(e => adminSubs.includes(e.subject)) : examRows;
  const examIds = scopedExams.map(e => e.id);
  const totalExams = scopedExams.length;
  let totalStudents = 0;
  let totalAttempts = 0;
  let avgPercent = 0;
  let passRate = 0;
  if (examIds.length) {
    const placeholders = examIds.map(() => "?").join(",");
    const students = db.prepare(`SELECT COUNT(DISTINCT user_id) as n FROM attempts WHERE exam_id IN (${placeholders})`).get(...examIds);
    totalStudents = students?.n || 0;
    const attempts = db.prepare(`SELECT * FROM attempts WHERE exam_id IN (${placeholders}) AND status='graded'`).all(...examIds);
    totalAttempts = attempts.length;
    if (totalAttempts) {
      avgPercent = attempts.reduce((s, a) => s + a.percent, 0) / totalAttempts;
      passRate = attempts.filter(a => a.passed).length / totalAttempts * 100;
    }
  }
  res.json({
    totalExams,
    totalStudents,
    totalAttempts,
    avgPercent: Math.round(avgPercent * 10) / 10,
    passRate: Math.round(passRate * 10) / 10,
    subjects: adminSubs.length ? adminSubs : [...new Set(examRows.map(e => e.subject).filter(Boolean))],
  });
});

// ---- audit log ----
app.get("/api/audit", requireAuth, requireRole("super_admin"), (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const total = db.prepare("SELECT COUNT(*) as n FROM audit_log").get().n;
  const rows = db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset);
  res.json({ total, page, limit, rows });
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
  console.log(`[socket] ${socket.data.username} (${socket.data.role}) connected`);
  socket.on("proctor:watch", (_, ack) => {
    if (!["super_admin", "subject_admin", "examiner"].includes(socket.data.role)) return ack?.({ ok:false, error:"Admin only"});
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
    // rate limit: max 15 snapshots per minute per socket (proper bucket)
    const now = Date.now();
    if (!socket.data._snapWindow || now - socket.data._snapWindow > 60000) {
      socket.data._snapWindow = now;
      socket.data._snapCount = 0;
    }
    if (socket.data._snapCount >= 15) return;
    socket.data._snapCount++;
    let filePath, fname;
    try {
      const dir = path.join(UPLOADS_BASE, "proctor", String(attemptId));
      fs.mkdirSync(dir, { recursive: true });
      fname = `${Date.now()}-${socket.data.userId}.jpg`;
      filePath = path.join(dir, fname);
      fs.writeFileSync(filePath, buf);
    } catch (e) {
      console.error("Snapshot write failed:", e.message);
      return;
    }
    db.prepare("INSERT INTO proctor_snapshots (attempt_id, user_id, captured_at, file_path) VALUES (?, ?, ?, ?)").run(Number(attemptId), socket.data.userId, Date.now(), path.relative(UPLOADS_BASE, filePath));
    io.to("proctor:admin").emit("proctor:frame", {
      attemptId: Number(attemptId),
      userId: socket.data.userId,
      username: socket.data.username,
      ts: Date.now(),
      url: `/api/proctor/snapshot/${Number(attemptId)}/${fname}`,
    });
  });

  socket.on("disconnect", ()=>{ console.log(`[socket] ${socket.data.username} disconnected`); });
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
