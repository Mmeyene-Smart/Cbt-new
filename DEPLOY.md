# Deploy CBT Platform — Vercel (Frontend) + Render (Backend) — Complete Guide

This repo is a monorepo: `client/` (React + Vite) and `server/` (Express + Socket.io + SQLite).
You will deploy them **separately**: client to Vercel, server to Render. They talk via `VITE_API_URL` / `CORS_ORIGIN`.

Live URLs (yours):
- **Frontend (Vercel):** https://cbt-new-eight.vercel.app
- **Backend (Render):** https://YOUR-API.onrender.com (you will create this — e.g., `https://cbt-new-api.onrender.com`)
- **Repo:** https://github.com/Mmeyene-Smart/Cbt-new

---

## Part A — Deploy Backend to Render (5 minutes)

### 1. Create the Web Service
1. Go to **https://dashboard.render.com** → **New +** → **Web Service**
2. **Connect** your GitHub repo `Mmeyene-Smart/Cbt-new` (if not listed, click *Configure account* and grant access)
3. Fill:
   - **Name:** `cbt-new-api` (or `cbt-platform-api`)
   - **Runtime:** Node
   - **Root Directory:** `server`  ← critical
   - **Build Command:** `npm ci`
   - **Start Command:** `npm start`  (= `node src/index.js`)
   - **Plan:** Free (sleeps after 15m inactivity) or Starter $7/mo (always on)
   - **Branch:** `main`

### 2. Add a Persistent Disk (so SQLite doesn't reset on every deploy)
- Without this, `server/cbt.db` and `uploads/proctor/` are wiped on each deploy.
- **Render → Your Service → Disks → Add Disk:**
  - **Name:** `cbt-data`
  - **Mount Path:** `/var/data`
  - **Size:** 1 GB (minimum, $0.25/mo)

### 3. Environment Variables (Render → Environment → Add)
| Key | Value | Why |
|-----|-------|-----|
| `CORS_ORIGIN` | `https://cbt-new-eight.vercel.app,http://localhost:5174` | Must include your *exact* Vercel URL. Comma-separated. `server/src/index.js` reads this. |
| `DB_PATH` | `/var/data/cbt.db` | Only if you added a Disk above. If omitted, DB stays at `./cbt.db` (ephemeral). |

> Do **not** set `PORT` manually — Render injects it.

### 4. Deploy
- Click **Create Web Service** → wait for build logs to show `CBT Platform API on :10000` (Render uses its own port internally)
- Copy the URL at the top, e.g., `https://cbt-new-api.onrender.com`
- Test in browser or `curl`:
  ```
  https://YOUR-API.onrender.com/api/health
  → {"status":"ok"}
  ```

### 5. If you see `Port 4001 already in use` locally
Your `start.bat` now auto-kills old processes. Or manually:
```bat
for /f "tokens=5" %a in ('netstat -aon ^| findstr ":4001" ^| findstr LISTENING') do taskkill /f /pid %a
```

---

## Part B — Deploy Frontend to Vercel (3 minutes)

### 1. Import Project
1. **https://vercel.com/dashboard** → **Add New… → Project** → **Import** `Mmeyene-Smart/Cbt-new`
2. **Framework Preset:** Vite (auto-detected)
3. **Root Directory:** `client` ← click *Edit* and set to `client` (because frontend lives in `client/`, not repo root). If you leave it at `./` the build will fail.
4. **Build Command:** `npm run build` (default)
5. **Output Directory:** `dist` (default)
6. **Install Command:** `npm ci` (default)

### 2. Environment Variable (Vercel → Settings → Environment Variables)
| Name | Value | Environment |
|------|-------|-------------|
| `VITE_API_URL` | `https://YOUR-API.onrender.com` | Production |

- Example: `VITE_API_URL=https://cbt-new-api.onrender.com`
- **No trailing slash, must be `https://`** (Vercel is HTTPS, so `wss://` WebSockets require `https://` API)
- Leave empty for local dev — then `client/src/lib/api.js` and `socket.js` fall back to `""` → Vite proxy to `127.0.0.1:4001`

### 3. Deploy
- Click **Deploy** → Vercel runs `npm ci && npm run build` inside `client/` → `dist/` → serves at `https://cbt-new-eight.vercel.app`
- `client/vercel.json` already handles SPA routing: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`

### 4. Link Them Together
- After Vercel deploys, **go back to Render** → **Environment** → ensure `CORS_ORIGIN` is exactly `https://cbt-new-eight.vercel.app` (copy from Vercel → Domains) → **Manual Deploy → Clear build cache & deploy** on Render.
- This is the #1 cause of `CORS error` in the browser console.

---

## Part C — How It Connects (So You Can Debug)

| Mode | `VITE_API_URL` | What the code does |
|------|----------------|--------------------|
| **Local** (`npm run dev`) | *(empty)* | `fetch("/api/auth/login")` → Vite `server.proxy` → `http://127.0.0.1:4001`; `io("/")` → proxied WebSocket |
| **Production** (Vercel) | `https://YOUR-API.onrender.com` | `fetch("https://YOUR-API.onrender.com/api/auth/login")` + `io("https://YOUR-API.onrender.com")` directly, CORS allows `https://cbt-new-eight.vercel.app` |

Files that read the env var:
- `client/src/lib/api.js:7` — `const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "")`
- `client/src/lib/socket.js:3` — `const WS_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "") || "/"`

---

## Part D — Test Production End-to-End

```bash
# 1. Backend health (replace with your Render URL)
curl https://YOUR-API.onrender.com/api/health
# → {"status":"ok"}

# 2. Frontend
open https://cbt-new-eight.vercel.app
# Register a new student (must pick ≥1 subject) → Login
# Admin: login as admin/Admin123 → Proctor tab → should show "No live camera feeds" initially
# Student (incognito): login as mmeyene/student123 → Start exam → Grant camera → Admin Proctor Wall should show a live tile within 5s
```

Demo logins (seeded in `server/src/db.js`):
- Admin: `admin` / `Admin123`
- Students: `mmeyene` / `student123`, `demo_student` / `student123`

---

## Part E — Troubleshooting (Copy-Paste Fixes)

| Symptom | Cause | Fix (exact) |
|---------|-------|-------------|
| Vercel build fails `vite: not found` | Root Directory not set to `client` | Vercel → Settings → General → Root Directory = `client` → Redeploy |
| Browser console `CORS error` on Vercel | `CORS_ORIGIN` on Render missing Vercel URL | Render → Environment → `CORS_ORIGIN=https://cbt-new-eight.vercel.app` → Manual Deploy |
| `WebSocket wss://... failed` | `VITE_API_URL` missing `https://` or has trailing slash | Vercel → Env → `VITE_API_URL=https://YOUR-API.onrender.com` (no slash) → Redeploy |
| Camera `NotAllowedError` on Vercel | Tried `http://` or LAN IP without HTTPS | Always use `https://cbt-new-eight.vercel.app` (Vercel is HTTPS by default) |
| SQLite resets after Render deploy | No persistent disk | Render → Disks → Add Disk at `/var/data` + set `DB_PATH=/var/data/cbt.db` |
| Proctor images 401 (broken tiles) | Old build without `?token=` fix | Redeploy both: `git push` already contains `9effa6e` fix |
| `Port 4001 already in use` locally | Ghost `node src/index.js` still running | `for /f "tokens=5" %a in ('netstat -aon ^| findstr ":4001" ^| findstr LISTENING') do taskkill /f /pid %a` or double-click `start.bat` (now auto-kills) |

---

## Part F — What Happens on Every `git push`

- Push to `main` on `https://github.com/Mmeyene-Smart/Cbt-new` →
  - **Vercel** auto-builds `client/` (if Root Directory = `client`) → new `https://cbt-new-eight.vercel.app`
  - **Render** auto-deploys `server/` (if Auto-Deploy is on) → new API

You already pushed `9effa6e` (all error fixes). Just set those two env vars and both will go green.

---

## Checklist (copy this)

- [ ] Render: Web Service created, Root Directory `server`, `CORS_ORIGIN` set, Disk added (optional but recommended)
- [ ] Render URL copied (e.g., `https://cbt-new-api.onrender.com`) and `curl /api/health` returns `{"status":"ok"}`
- [ ] Vercel: Project imported, Root Directory `client`, `VITE_API_URL` set to Render URL, Deployed
- [ ] Render `CORS_ORIGIN` updated to exact Vercel URL → Redeployed Render
- [ ] Test: student camera → admin Proctor Wall live tile
