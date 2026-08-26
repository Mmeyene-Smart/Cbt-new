# CBT Platform — Live Proctored Exams

Full-stack CBT system rebuilt from the PHP `cbt-system` admin panel. **React 19 + Express + SQLite + Socket.io + JWT**. Self-contained — no CBTHost offline binary needed.

## Features
- **Admin**: dashboard, student list, exam builder (MCQ/multi/TF), results & combined analytics, live **Proctor Wall** (camera snapshots every 5s)
- **Student**: timed exam player (server-enforced deadline), auto-save, auto-submit, instant grading, printable result
- **Live camera**: `getUserMedia` preview, consent gate, 5s snapshot loop via Socket.io, admin wall grid, disk storage (`uploads/proctor/{attemptId}/{ts}.jpg`), 30-day retention. Requires HTTPS or `localhost` (vite `--https` for LAN).

## Quick start
Double-click `start.bat`, or:
```bash
# api :4001
cd server && node src/index.js
# client :5174
cd client && npm install && npm run dev -- --port 5174
```
Open http://localhost:5174 — demo logins: `admin/Admin123`, `mmeyene/student123`

## Deployment notes
Dev CORS + Vite proxy are for local use. For production, serve `client/dist` from Express via `express.static` or put both behind a reverse proxy (Nginx/Caddy) and set explicit CORS origins.

## Snapshot storage
`uploads/proctor/` is gitignored. Rate-limited to 15 snapshots/min per student. Proctor frames are broadcast only to `proctor:admin` room (admin JWT required).
