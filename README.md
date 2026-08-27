# CBT Platform — Live Proctored Exams

Full-stack CBT system rebuilt from the PHP `cbt-system` admin panel. **React 19 + Express + SQLite + Socket.io + JWT**. Self-contained — no CBTHost offline binary needed.

**Live Demo:** https://cbt-new-eight.vercel.app/ (frontend) + Render API (see below)

## Features
- **Admin**: dashboard, student list (with subjects), exam builder (MCQ/multi/TF), results & combined analytics, live **Proctor Wall** (camera snapshots every 5s)
- **Student**: registration with subject selection, timed exam player (server-enforced deadline), auto-save, auto-submit, instant grading, printable result
- **Live camera**: `getUserMedia` preview, consent gate, 5s snapshot loop via Socket.io, admin wall grid, disk storage (`uploads/proctor/{attemptId}/{ts}.jpg`), 30-day retention. Requires HTTPS or `localhost` (use `vite --https` for LAN).

## Quick Start (Local)

Double-click `start.bat` (auto-frees ports 4001/5174), or manually:

```bash
# api :4001
cd server && node src/index.js
# client :5174
cd client && npm install && npm run dev -- --port 5174
```
Open http://localhost:5174 — demo logins: `admin/Admin123`, `mmeyene/student123`

If you see `Port 4001 already in use`, run:
```bat
for /f "tokens=5" %a in ('netstat -aon ^| findstr ":4001" ^| findstr LISTENING') do taskkill /f /pid %a
```

---

## Production Deployment — Vercel (Frontend) + Render (Backend) — Elaborate Guide

This repo is a **monorepo** (`client/` + `server/`). Deploy them separately:

### Architecture
```
Browser → https://cbt-new-eight.vercel.app (Vercel, static Vite build)
          ↕ HTTPS + WSS (via VITE_API_URL)
        https://YOUR-API.onrender.com (Render, Express + Socket.io + SQLite)
```

### 1. Backend → Render

**A. Create the service:**
1. Push this repo to GitHub (`cbt-new` — already done).
2. In **Render Dashboard** → **New +** → **Web Service** → Connect `Mmeyene-Smart/cbt-new`.
3. Settings:
   - **Name:** `cbt-platform-api` (or `cbt-new-api`)
   - **Root Directory:** `server`
   - **Build Command:** `npm ci`
   - **Start Command:** `npm start` (runs `node src/index.js`)
   - **Plan:** Free (spins down after 15m) or Starter ($7/mo, always-on)

**B. Add a Persistent Disk (required for SQLite):**
- Without this, `server/cbt.db` and `uploads/proctor/` reset on every deploy.
- **Render → Service → Disks → Add Disk:**
  - **Name:** `cbt-data`
  - **Mount Path:** `/var/data`
  - **Size:** 1GB
- Then in `server/src/db.js`, Render will use `process.env.DB_PATH` if you set it. For now it uses `./cbt.db` relative to `server/` — add this env var to move it to the disk:

**C. Environment Variables (Render → Environment):**
| Key | Value | Notes |
|-----|-------|-------|
| `PORT` | `4001` (Render sets its own, but keep) | Render injects its own `PORT` anyway |
| `CORS_ORIGIN` | `https://cbt-new-eight.vercel.app,http://localhost:5174` | Comma-separated. Must include your exact Vercel URL. `server/src/index.js` reads this. |
| `DB_PATH` | `/var/data/cbt.db` | Only if you mount a disk; otherwise omit and it uses `./cbt.db` (ephemeral) |

**D. Deploy & verify:**
- Click **Create Web Service** → wait for build → copy the URL (e.g., `https://cbt-new-api.onrender.com`)
- Test: `curl https://YOUR-API.onrender.com/api/health` → `{"status":"ok"}`

### 2. Frontend → Vercel

**A. Import project:**
1. **Vercel Dashboard** → **Add New… → Project** → Import `Mmeyene-Smart/cbt-new`.
2. **Important:** Set **Root Directory** to `client` (because the frontend lives in `client/`). Vercel will then run `npm ci && npm run build` inside `client/` and output `dist/`.
3. Framework preset: **Vite** (auto-detected).

**B. Environment Variable (Vercel → Settings → Environment Variables):**
| Name | Value | Environment |
|------|-------|-------------|
| `VITE_API_URL` | `https://YOUR-API.onrender.com` | Production |

*Example:* `VITE_API_URL=https://cbt-platform-api.onrender.com` (replace with your actual Render URL). **No trailing slash.** Leave empty for local dev (then Vite proxy to `127.0.0.1:4001` is used).

**C. `client/vercel.json` (already in repo):**
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```
This makes React Router work (all routes fall back to `index.html`).

**D. Deploy:**
- Click **Deploy** → Vercel builds `client/` → `dist/` → serves at `https://cbt-new-eight.vercel.app`
- After deploy, **update Render's `CORS_ORIGIN`** to include this exact Vercel URL (including `https://`), then **Redeploy** Render (Manual Deploy → Clear build cache & deploy).

### 3. How it connects

- **Local dev:** `VITE_API_URL` is empty → `client/src/lib/api.js` calls `/api/...` → Vite `server.proxy` forwards to `http://127.0.0.1:4001`. Socket uses `io("/")` → proxied via `"/socket.io"`.
- **Production:** `VITE_API_URL=https://YOUR-API.onrender.com` → `fetch("https://YOUR-API.onrender.com/api/auth/login")` and `io("https://YOUR-API.onrender.com", {auth...})` directly. No proxy needed. CORS on the server must allow `https://cbt-new-eight.vercel.app`.

### 4. Testing production

```bash
# Backend health (replace with your Render URL)
curl https://YOUR-API.onrender.com/api/health
# → {"status":"ok"}

# Frontend
open https://cbt-new-eight.vercel.app
# Login as admin/Admin123 → Proctor tab should show "No live camera feeds" until a student starts an exam
# In another browser/incognito, register/login as student → pick subjects → start exam → grant camera → admin Proctor Wall should show live tile
```

### 5. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Port 4001 already in use` locally | Ghost `node src/index.js` still running | `for /f "tokens=5" %a in ('netstat -aon ^| findstr ":4001" ^| findstr LISTENING') do taskkill /f /pid %a` or double-click `start.bat` (now auto-kills) |
| Camera `NotAllowedError` on Vercel | Vercel is HTTPS, but if you visit via `http://` or LAN IP without HTTPS, `getUserMedia` is blocked | Always use `https://cbt-new-eight.vercel.app` (Vercel is HTTPS by default) |
| `CORS error` in browser console on Vercel | `CORS_ORIGIN` on Render doesn't include Vercel URL | Set `CORS_ORIGIN=https://cbt-new-eight.vercel.app` in Render → Redeploy |
| `WebSocket wss://... failed` | `VITE_API_URL` missing `https://` prefix or has trailing slash | Set `VITE_API_URL=https://YOUR-API.onrender.com` (no slash) in Vercel → Redeploy |
| SQLite resets on Render deploy | No persistent disk | Add Render Disk at `/var/data` and set `DB_PATH=/var/data/cbt.db` |
| Proctor images 401 | Old build without `?token=` fix | Redeploy both: Render + Vercel (latest commit `8dd5b67`+ fixes this) |
| Vercel build fails `vite: not found` | Root Directory not set to `client` | In Vercel → Settings → General → Root Directory = `client` |

### 6. Local vs Production checklist

- [ ] `client/.env.example` and `server/.env.example` document required vars
- [ ] `render.yaml` in repo root defines `rootDir: server` for Blueprint deploys
- [ ] `client/vercel.json` handles SPA rewrites
- [ ] Push to `main` → Vercel auto-deploys `client/`, Render auto-deploys `server/` (if you enable auto-deploy)

## Snapshot storage
`uploads/proctor/` is gitignored (`server/.gitignore`). Rate-limited to 15 snapshots/min per student. Proctor frames are broadcast only to `proctor:admin` room (admin JWT required). On Render, uploads are ephemeral unless you add a Disk.

## Credentials (seeded)
- Admin: `admin` / `Admin123`
- Students: `mmeyene` / `student123` (subjects: Mathematics, English...), `demo_student` / `student123`, plus any you register.

## Project structure
```
cbt-platform/
├── client/   React 19 + Vite + Tailwind + Socket.io-client + Recharts
├── server/   Express + node:sqlite + JWT + Socket.io
├── render.yaml
└── start.bat
```
