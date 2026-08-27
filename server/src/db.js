import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "cbt.db");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','student')),
  full_name TEXT,
  student_code TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  subject TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  pass_percent INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'published',
  camera_required INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('mcq','multi','tf')),
  prompt TEXT NOT NULL,
  options TEXT NOT NULL,
  answer TEXT NOT NULL,
  marks INTEGER NOT NULL DEFAULT 1,
  order_index INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  username TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('in_progress','submitted','graded')),
  score INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  percent REAL NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  camera_consent_at INTEGER,
  started_at INTEGER NOT NULL,
  submitted_at INTEGER,
  ends_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attempt_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  given TEXT,
  is_correct INTEGER,
  marks_awarded INTEGER DEFAULT 0,
  UNIQUE(attempt_id, question_id)
);
CREATE TABLE IF NOT EXISTS proctor_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  captured_at INTEGER NOT NULL,
  file_path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions(exam_id, order_index);
CREATE INDEX IF NOT EXISTS idx_attempts_user_exam ON attempts(user_id, exam_id);
CREATE INDEX IF NOT EXISTS idx_proctor_attempt ON proctor_snapshots(attempt_id, captured_at);
`);

// migrate: add subjects column to users if missing (for existing DBs)
try {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  if (!cols.some(c => c.name === "subjects")) {
    db.exec("ALTER TABLE users ADD COLUMN subjects TEXT");
    console.log("[db] migrated: added users.subjects column");
  }
} catch {}

// seed admin + demo students + demo exams if empty
const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
if (!userCount) {
  const now = Date.now();
  // Use bcrypt hashes generated at runtime via auth module? For seed we insert with known passwords via bcryptjs sync
  const bcrypt = await import("bcryptjs");
  const hashAdmin = bcrypt.hashSync("Minator1!", 10);
  const hashStudent = bcrypt.hashSync("student123", 10);
  const ins = db.prepare("INSERT INTO users (username, password_hash, role, full_name, student_code, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  ins.run("admin", hashAdmin, "admin", "Administrator", null, now);
  ins.run("mmeyene", hashStudent, "student", "Mmeyene Aloysius", "STU001", now);
  ins.run("demo_student", hashStudent, "student", "Demo Student", "STU002", now);
  ins.run("john_doe", hashStudent, "student", "John Doe", "STU003", now);
  console.log("[db] seeded users (admin / mmeyene / demo_student / john_doe)");
}

const examCount = db.prepare("SELECT COUNT(*) AS n FROM exams").get().n;
if (!examCount) {
  const now = Date.now();
  const examIns = db.prepare("INSERT INTO exams (slug, title, subject, duration_minutes, pass_percent, status, camera_required, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const qIns = db.prepare("INSERT INTO questions (exam_id, type, prompt, options, answer, marks, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)");

  const e1 = examIns.run("general-knowledge-1", "General Knowledge — Demo", "General", 15, 50, "published", 1, "admin", now);
  const e1id = Number(e1.lastInsertRowid);
  const qs1 = [
    ["mcq", "What is the capital of Nigeria?", '["Lagos","Abuja","Kano","Port Harcourt"]', '["Abuja"]'],
    ["mcq", "Which protocol secures HTTP?", '["FTP","TLS","SMTP","POP3"]', '["TLS"]'],
    ["tf", "JavaScript is a compiled language.", '["True","False"]', '["False"]'],
    ["mcq", "What does HTML stand for?", '["Hyper Text Markup Language","High Tech Modern Language","Hyperlink Text Module","Home Tool Markup"]', '["Hyper Text Markup Language"]'],
    ["multi", "Which are JavaScript frameworks?", '["React","Django","Vue","Laravel"]', '["React","Vue"]'],
    ["mcq", "Docker is used for?", '["Version control","Containerization","Database","Design"]', '["Containerization"]'],
    ["mcq", "Which is NOT a NoSQL DB?", '["MongoDB","Redis","PostgreSQL","Cassandra"]', '["PostgreSQL"]'],
    ["tf", "CSS stands for Cascading Style Sheets.", '["True","False"]', '["True"]'],
  ];
  qs1.forEach(([type, prompt, options, answer], i) => qIns.run(e1id, type, prompt, options, answer, 1, i));

  const e2 = examIns.run("web-fundamentals", "Web Fundamentals", "Computer Science", 20, 50, "published", 1, "admin", now);
  const e2id = Number(e2.lastInsertRowid);
  const qs2 = [
    ["mcq", "Which tag is used for the largest heading?", '["<h6>","<h1>","<head>","<header>"]', '["<h1>"]'],
    ["mcq", "Flexbox is a layout model for?", '["Grid only","One-dimensional layout","Database","Video"]', '["One-dimensional layout"]'],
    ["multi", "Select all valid CSS units", '["px","em","kg","rem"]', '["px","em","rem"]'],
    ["tf", "Node.js can run JavaScript outside the browser.", '["True","False"]', '["True"]'],
    ["mcq", "What does API stand for?", '["Application Programming Interface","Applied Program Integration","Automated Process Interaction","App Panel Interface"]', '["Application Programming Interface"]'],
    ["mcq", "Git is a?", '["Text editor","Version control system","Database","Framework"]', '["Version control system"]'],
  ];
  qs2.forEach(([type, prompt, options, answer], i) => qIns.run(e2id, type, prompt, options, answer, 1, i));

  console.log("[db] seeded 2 demo exams");
}

// ensure uploads dir exists
const uploadsDir = path.join(__dirname, "..", "uploads", "proctor");
fs.mkdirSync(uploadsDir, { recursive: true });

export default db;
