import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "cbt.db");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

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

// ensure admin exists (always) and seed demo data if empty
const adminExists = db.prepare("SELECT id FROM users WHERE username = ? AND role = 'admin'").get("admin");
if (!adminExists) {
  const bcrypt = await import("bcryptjs");
  const adminPass = process.env.ADMIN_PASSWORD || "Minator1!";
  const hashAdmin = bcrypt.hashSync(adminPass, 12);
  db.prepare("INSERT INTO users (username, password_hash, role, full_name, student_code, subjects, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("admin", hashAdmin, "admin", "Administrator", null, JSON.stringify([]), Date.now());
  console.log("[db] seeded admin user");
  if (!process.env.ADMIN_PASSWORD) console.warn("[db] Using default admin password Minator1!. Set ADMIN_PASSWORD env in production!");
}
// seed demo students only in non-production when DB is empty
const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
if (userCount === 1 && process.env.NODE_ENV !== "production") {
  // only admin exists and we're in dev — add demo students
  const bcrypt = await import("bcryptjs");
  const hashStudent = bcrypt.hashSync("student123", 12);
  const ins = db.prepare("INSERT INTO users (username, password_hash, role, full_name, student_code, subjects, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const now = Date.now();
  try { ins.run("mmeyene", hashStudent, "student", "Mmeyene Aloysius", "STU001", JSON.stringify(["General"]), now); } catch {}
  try { ins.run("demo_student", hashStudent, "student", "Demo Student", "STU002", JSON.stringify(["General"]), now); } catch {}
  try { ins.run("john_doe", hashStudent, "student", "John Doe", "STU003", JSON.stringify(["Computer Science"]), now); } catch {}
  console.log("[db] seeded demo students");
}

const examCount = db.prepare("SELECT COUNT(*) AS n FROM exams").get().n;
if (!examCount) {
  const now = Date.now();
  const examIns = db.prepare("INSERT INTO exams (slug, title, subject, duration_minutes, pass_percent, status, camera_required, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const qIns = db.prepare("INSERT INTO questions (exam_id, type, prompt, options, answer, marks, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)");

  // GST 101 — Use of English (General Studies) — Professional university core
  const e1 = examIns.run("gst-101-use-of-english", "GST 101 — Use of English", "General Studies", 30, 50, "published", 1, "admin", now);
  const e1id = Number(e1.lastInsertRowid);
  const qs1 = [
    ["mcq", "Choose the correctly spelt word:", '["Accomodate","Accommodate","Acommodate","Accomodete"]', '["Accommodate"]'],
    ["mcq", "Select the synonym of 'Meticulous':", '["Careless","Precise","Hasty","Loud"]', '["Precise"]'],
    ["tf", "The sentence 'Neither of the students have submitted their assignment' is grammatically correct.", '["True","False"]', '["False"]'],
    ["multi", "Which are parts of speech?", '["Noun","Verb","Conjunction","Photosynthesis"]', '["Noun","Verb","Conjunction"]'],
    ["mcq", "Choose the correctly punctuated sentence:", '["Lets eat grandma.","Let\'s eat, grandma.","Lets, eat grandma.","Let’s eat grandma"]', '["Let\'s eat, grandma."]'],
    ["mcq", "What is the antonym of 'Benevolent'?", '["Malevolent","Kind","Generous","Friendly"]', '["Malevolent"]'],
    ["mcq", "Identify the figure of speech: 'The wind whispered through the trees.'", '["Simile","Metaphor","Personification","Hyperbole"]', '["Personification"]'],
    ["tf", "A paragraph should contain only one main idea.", '["True","False"]', '["True"]'],
  ];
  qs1.forEach(([type, prompt, options, answer], i) => qIns.run(e1id, type, prompt, options, answer, 1, i));

  // MTH 101 — Elementary Mathematics
  const e2 = examIns.run("mth-101-elementary-mathematics", "MTH 101 — Elementary Mathematics", "Mathematics", 30, 50, "published", 1, "admin", now);
  const e2id = Number(e2.lastInsertRowid);
  const qs2 = [
    ["mcq", "What is the derivative of sin(x)?", '["cos(x)","-cos(x)","-sin(x)","tan(x)"]', '["cos(x)"]'],
    ["mcq", "Solve: 2x + 5 = 15. What is x?", '["5","10","7.5","2.5"]', '["5"]'],
    ["multi", "Which are prime numbers?", '["2","4","7","9"]', '["2","7"]'],
    ["tf", "The sum of angles in a triangle is 180 degrees.", '["True","False"]', '["True"]'],
    ["mcq", "What is 7! (7 factorial)?", '["5040","720","40320","120"]', '["5040"]'],
    ["mcq", "If log₁₀(100) = x, what is x?", '["1","2","10","100"]', '["2"]'],
  ];
  qs2.forEach(([type, prompt, options, answer], i) => qIns.run(e2id, type, prompt, options, answer, 1, i));

  // CSC 101 — Introduction to Computer Science
  const e3 = examIns.run("csc-101-intro-computer-science", "CSC 101 — Introduction to Computer Science", "Computer Science", 30, 50, "published", 1, "admin", now);
  const e3id = Number(e3.lastInsertRowid);
  const qs3 = [
    ["mcq", "What does CPU stand for?", '["Central Processing Unit","Computer Personal Unit"," Central Process Unit","Central Peripheral Unit"]', '["Central Processing Unit"]'],
    ["mcq", "Which is a volatile memory?", '["ROM","HDD","RAM","SSD"]', '["RAM"]'],
    ["tf", "An algorithm must terminate after a finite number of steps.", '["True","False"]', '["True"]'],
    ["multi", "Which are high-level programming languages?", '["Python","Assembly","Java","Machine Code"]', '["Python","Java"]'],
    ["mcq", "What is the time complexity of binary search?", '["O(n)","O(log n)","O(n²)","O(1)"]', '["O(log n)"]'],
    ["mcq", "Which data structure uses LIFO principle?", '["Queue","Stack","Array","Tree"]', '["Stack"]'],
    ["mcq", "What does SQL stand for?", '["Structured Query Language","Simple Query Language","Standard Query Language","System Query Language"]', '["Structured Query Language"]'],
  ];
  qs3.forEach(([type, prompt, options, answer], i) => qIns.run(e3id, type, prompt, options, answer, 1, i));

  // PHY 101 — General Physics
  const e4 = examIns.run("phy-101-general-physics", "PHY 101 — General Physics", "Physics", 30, 50, "published", 1, "admin", now);
  const e4id = Number(e4.lastInsertRowid);
  const qs4 = [
    ["mcq", "What is the SI unit of force?", '["Joule","Newton","Watt","Pascal"]', '["Newton"]'],
    ["tf", "Light travels faster than sound.", '["True","False"]', '["True"]'],
    ["mcq", "Which law states F = ma?", '["Newton\'s First Law","Newton\'s Second Law","Ohm\'s Law","Coulomb\'s Law"]', '["Newton\'s Second Law"]'],
    ["multi", "Which are vectors?", '["Force","Mass","Velocity","Speed"]', '["Force","Velocity"]'],
    ["mcq", "What is the acceleration due to gravity (approx.)?", '["9.8 m/s²","10 m/s²","8.9 m/s²","11 m/s²"]', '["9.8 m/s²"]'],
  ];
  qs4.forEach(([type, prompt, options, answer], i) => qIns.run(e4id, type, prompt, options, answer, 1, i));

  console.log("[db] seeded 4 professional university exams (GST 101, MTH 101, CSC 101, PHY 101)");
}
// ensure professional exams exist even on DBs that already had old demo exams
for (const [slug, title, subject] of [
  ["gst-101-use-of-english", "GST 101 — Use of English", "General Studies"],
  ["mth-101-elementary-mathematics", "MTH 101 — Elementary Mathematics", "Mathematics"],
  ["csc-101-intro-computer-science", "CSC 101 — Introduction to Computer Science", "Computer Science"],
  ["phy-101-general-physics", "PHY 101 — General Physics", "Physics"],
]) {
  if (!db.prepare("SELECT id FROM exams WHERE slug = ?").get(slug)) {
    const now2 = Date.now();
    const info = db.prepare("INSERT INTO exams (slug, title, subject, duration_minutes, pass_percent, status, camera_required, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(slug, title, subject, 30, 50, "published", 1, "admin", now2);
    const eid = Number(info.lastInsertRowid);
    // minimal question set for migrated exams (full set is in the seed above, but ensure at least one question so exam is valid)
    const qIns2 = db.prepare("INSERT INTO questions (exam_id, type, prompt, options, answer, marks, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)");
    if (slug.startsWith("gst-")) qIns2.run(eid, "mcq", "Choose the correctly spelt word:", '["Accomodate","Accommodate","Acommodate","Accomodete"]', '["Accommodate"]', 1, 0);
    if (slug.startsWith("mth-")) qIns2.run(eid, "mcq", "What is the derivative of sin(x)?", '["cos(x)","-cos(x)","-sin(x)","tan(x)"]', '["cos(x)"]', 1, 0);
    if (slug.startsWith("csc-")) qIns2.run(eid, "mcq", "What does CPU stand for?", '["Central Processing Unit","Computer Personal Unit"," Central Process Unit","Central Peripheral Unit"]', '["Central Processing Unit"]', 1, 0);
    if (slug.startsWith("phy-")) qIns2.run(eid, "mcq", "What is the SI unit of force?", '["Joule","Newton","Watt","Pascal"]', '["Newton"]', 1, 0);
    console.log(`[db] migrated professional exam ${slug}`);
  }
}

// ensure uploads dir exists (honor UPLOADS_DIR for persistent disk)
const uploadsDir = path.join(process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads"), "proctor");
fs.mkdirSync(uploadsDir, { recursive: true });

export default db;
