import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import db from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.join(__dirname, "..", "uploads", "proctor");
fs.mkdirSync(UPLOADS, { recursive: true });

// rate limit: max 15 snapshots per minute per socket
const buckets = new Map(); // socketId -> { count, windowStart }

function allowSnapshot(socketId) {
  const now = Date.now();
  let b = buckets.get(socketId);
  if (!b || now - b.windowStart > 60000) {
    b = { count: 1, windowStart: now };
    buckets.set(socketId, b);
    return true;
  }
  if (b.count >= 15) return false;
  b.count++;
  return true;
}

export function handleProctorSnapshot(socket, io, payload) {
  const { attemptId, jpegBase64 } = payload ?? {};
  if (!attemptId || !jpegBase64) return;
  if (!allowSnapshot(socket.id)) return;

  const attempt = db.prepare("SELECT * FROM attempts WHERE id = ?").get(Number(attemptId));
  if (!attempt || attempt.user_id !== socket.data.userId) return;
  if (attempt.status !== "in_progress") return;

  // validate base64 JPEG (strip prefix if present)
  let b64 = String(jpegBase64);
  if (b64.startsWith("data:")) b64 = b64.split(",")[1] ?? "";
  // rough size guard: decoded < 300KB
  if (b64.length > 400000) return;
  let buf;
  try {
    buf = Buffer.from(b64, "base64");
    if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) return; // not JPEG
  } catch {
    return;
  }

  const dir = path.join(UPLOADS, String(attemptId));
  fs.mkdirSync(dir, { recursive: true });
  const fname = `${Date.now()}.jpg`;
  const filePath = path.join(dir, fname);
  fs.writeFileSync(filePath, buf);

  db.prepare("INSERT INTO proctor_snapshots (attempt_id, user_id, captured_at, file_path) VALUES (?, ?, ?, ?)")
    .run(Number(attemptId), socket.data.userId, Date.now(), path.relative(path.join(__dirname, ".."), filePath));

  // broadcast latest frame to all admins watching the proctor wall
  io.to("proctor:admin").emit("proctor:frame", {
    attemptId: Number(attemptId),
    userId: socket.data.userId,
    username: socket.data.username,
    ts: Date.now(),
    url: `/api/proctor/snapshot/${Number(attemptId)}/${fname}`,
  });
}

export function proctorRooms(io) {
  // called once to register admin join
  io.on("connection", (socket) => {
    socket.on("proctor:watch", (_, ack) => {
      if (socket.data.role !== "admin") return ack?.({ ok: false, error: "Admin only" });
      socket.join("proctor:admin");
      ack?.({ ok: true });
    });
  });
}
