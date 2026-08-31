import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const secretFile = path.join(__dirname, "..", ".jwt-secret");
let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  if (fs.existsSync(secretFile)) SECRET = fs.readFileSync(secretFile, "utf8").trim();
  else {
    SECRET = crypto.randomBytes(48).toString("hex");
    fs.writeFileSync(secretFile, SECRET, { mode: 0o600 });
  }
  if (process.env.NODE_ENV === "production") {
    console.warn("[auth] JWT_SECRET not set — using ephemeral secret. Set JWT_SECRET in Render to keep logins stable across deploys!");
  }
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    const payload = verifyToken(token);
    req.user = { id: Number(payload.sub), username: payload.username, role: payload.role, admin_subjects: payload.admin_subjects || [] };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

const router = Router();

router.post("/register", async (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const fullName = String(req.body?.full_name ?? username).trim();
  // admin registration is disabled — only students can self-register
  if (req.body?.role === "admin") {
    return res.status(403).json({ error: "Admin registration is disabled. Contact the administrator." });
  }
  const role = "student";
  let subjects = [];
  if (Array.isArray(req.body?.subjects)) {
    subjects = req.body.subjects.map(s=>String(s).trim()).filter(Boolean).slice(0,8);
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username))
    return res.status(400).json({ error: "Username 3-20 chars (letters, numbers, underscore)." });
  if (password.length < 8 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])/.test(password))
    return res.status(400).json({ error: "Password must be at least 8 characters with uppercase, lowercase, and number." });
  if (role === "student" && subjects.length === 0)
    return res.status(400).json({ error: "Please select at least one subject." });
  const hash = await bcrypt.hash(password, 12);
  let studentCode = null;
  if (role === "student") {
    // Use crypto-random code and ensure uniqueness
    for (let attempts = 0; attempts < 5; attempts++) {
      const candidate = `STU${String(crypto.randomInt(100000, 999999))}`;
      const exists = db.prepare("SELECT id FROM users WHERE student_code = ?").get(candidate);
      if (!exists) { studentCode = candidate; break; }
    }
    if (!studentCode) studentCode = `STU${String(Date.now()).slice(-6)}${String(crypto.randomInt(10, 99))}`;
  }
  try {
    const info = db
      .prepare("INSERT INTO users (username, password_hash, role, full_name, student_code, subjects, admin_subjects, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)")
      .run(username, hash, role, fullName, studentCode, JSON.stringify(subjects), null, Date.now());
    const id = Number(info.lastInsertRowid);
    const token = jwt.sign({ sub: id, username, role }, SECRET, { expiresIn: "1d" });
    res.json({ token, user: { id, username, role, full_name: fullName, student_code: studentCode, subjects, admin_subjects: [] } });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({ error: "Username taken." });
    throw e;
  }
});

router.post("/login", async (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const user = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username);
  const hash = user?.password_hash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva";
  const ok = await bcrypt.compare(password, hash);
  if (!user || !ok) return res.status(401).json({ error: "Invalid username or password." });
  let subjects = [];
  try { subjects = user.subjects ? JSON.parse(user.subjects) : []; } catch { subjects = []; }
  let admin_subjects = [];
  try { admin_subjects = user.admin_subjects ? JSON.parse(user.admin_subjects) : []; } catch { admin_subjects = []; }
  const token = jwt.sign({ sub: user.id, username: user.username, role: user.role, admin_subjects }, SECRET, { expiresIn: "1d" });
  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name, student_code: user.student_code, subjects, admin_subjects },
  });
});

router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

export default router;
