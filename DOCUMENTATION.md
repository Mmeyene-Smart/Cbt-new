# University CBT Examination Platform — Complete Documentation

> **Version:** 2.0 | **Last Updated:** September 2026
> **Client:** https://cbt-new-eight.vercel.app | **API:** https://cbt-new-aram.onrender.com

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Authentication & Roles](#2-authentication--roles)
3. [Admin Panel — Sidebar Navigation](#3-admin-panel--sidebar-navigation)
4. [Dashboard (Admin)](#4-dashboard-admin)
5. [Examination Management](#5-examination-management)
6. [Question Bank](#6-question-bank)
7. [Exam Templates](#7-exam-templates)
8. [Student Management](#8-student-management)
9. [Results & Analytics](#9-results--analytics)
10. [Live Proctoring](#10-live-proctoring)
11. [Admin Account Management](#11-admin-account-management)
12. [Audit Log](#12-audit-log)
13. [Student Portal](#13-student-portal)
14. [Student Dashboard](#14-student-dashboard)
15. [Taking an Exam — Full Flow](#15-taking-an-exam--full-flow)
16. [Exam Player Features](#16-exam-player-features)
17. [Result Review & Certificate](#17-result-review--certificate)
18. [Security Features](#18-security-features)
19. [API Reference](#19-api-reference)
20. [Environment Variables](#20-environment-variables)
21. [Deployment](#21-deployment)

---

## 1. Architecture Overview

### Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 19 + Vite 8 | Single-page application |
| Styling | Tailwind CSS 4 | Utility-first CSS framework |
| Icons | Lucide React | Icon library |
| Charts | Recharts | Data visualization |
| Backend | Node.js + Express 5 | REST API server |
| Database | SQLite (node:sqlite) | Persistent storage |
| Auth | JWT (jsonwebtoken) | Token-based authentication |
| Real-time | Socket.IO 4 | Live proctoring, chat |
| File Upload | Multer | Excel/CSV uploads |
| Excel | ExcelJS | Import/export spreadsheets |
| Security | Helmet + Rate Limiting | HTTP headers, rate limiting |

### Project Structure

```
cbt-platform/
├── client/                     # React frontend
│   ├── src/
│   │   ├── App.jsx            # All components (1500+ lines)
│   │   ├── screens/
│   │   │   └── AuthScreen.jsx # Login/Register
│   │   ├── hooks/
│   │   │   ├── useCamera.js   # Camera capture
│   │   │   └── useScreenShare.js # Screen sharing
│   │   └── lib/
│   │       ├── api.js         # API helper + auth
│   │       └── socket.js      # Socket.IO client
│   ├── package.json
│   └── vite.config.js
├── server/                     # Express backend
│   ├── src/
│   │   ├── index.js           # All routes (1200+ lines)
│   │   ├── auth.js            # JWT auth + login/register
│   │   └── db.js              # SQLite schema + migrations
│   ├── package.json
│   └── render.yaml            # Render deployment
└── DOCUMENTATION.md           # This file
```

### Data Flow

```
Student opens exam
  → GET /api/exams (filtered by student's subjects)
  → Clicks "Start exam"
  → Instructions page (read rules)
  → Camera/Screen consent (if proctored)
  → Exam password (if set)
  → POST /api/attempts/start (creates attempt, returns seed)
  → GET /api/exams/:id (questions with shuffled options using seed)
  → Student answers → POST /api/attempts/:id/answer (auto-save every 30s)
  → POST /api/attempts/:id/submit (server grades)
  → GET /api/attempts/:id/review (detailed results with explanations)
  → GET /api/attempts/:id/certificate (if passed)
```

---

## 2. Authentication & Roles

### Roles

| Role | Access Level | Description |
|------|-------------|-------------|
| `super_admin` | Full access | Can manage admins, view audit log, all operations |
| `subject_admin` | Subject-scoped | Can manage exams/students within assigned subjects |
| `examiner` | Exam-focused | Can create exams, grade, view results |
| `student` | Exam-taker | Can take exams, view results, chat with proctor |

### Default Credentials

| Username | Password | Role |
|----------|----------|------|
| `admin` | `Minator1!` | super_admin |
| `math_admin` | `Adminpass1` | subject_admin (Mathematics) |
| `csc_examiner` | `Adminpass1` | examiner (Computer Science) |

### Registration

Students register via the registration form:
1. Enter username, full name, student code, password
2. Select subjects from multi-select dropdown (populated from `/api/subjects`)
3. Submit → JWT token stored in localStorage
4. Subjects determine which exams the student can see

### JWT Token

- Stored in `localStorage` as `cbt.token`
- Contains: `sub` (user ID), `username`, `role`, `subjects`, `admin_subjects`
- Expires after 1 day
- Sent as `Authorization: Bearer <token>` header

---

## 3. Admin Panel — Sidebar Navigation

The admin panel uses a **fixed left sidebar** (220px wide) with icon + label tabs.

### Sidebar Tabs

| Tab | Icon | Access | Description |
|-----|------|--------|-------------|
| Dashboard | `LayoutDashboard` | All admins | System statistics |
| Exams | `BookOpen` | All admins | Create/manage exams |
| Bank | `FileText` | All admins | Reusable question bank |
| Templates | `ClipboardList` | All admins | Saved exam configurations |
| Students | `Users` | All admins | View/enroll students |
| Results | `BarChart3` | All admins | Graded results + analytics |
| Proctor | `Video` | All admins | Live camera feeds |
| Admins | `Shield` | super_admin only | Manage admin accounts |
| Audit | `Eye` | super_admin only | System audit log |

### Mobile Behavior

- On screens < 768px, sidebar collapses
- Hamburger menu (☰) in header opens sidebar as overlay
- Click outside or select a tab to close

### Theme Toggle

- Light/Dark mode toggle in sidebar bottom
- Stored in `localStorage` as `cbt.theme`
- Applied to `<html>` via `data-theme` attribute

---

## 4. Dashboard (Admin)

The admin dashboard shows system-wide statistics.

### Stat Cards

| Card | Description |
|------|-------------|
| Total Exams | Number of exams created |
| Total Students | Number of registered students |
| Total Attempts | Number of exam attempts started |
| Pass Rate | Percentage of graded attempts that passed |

### Subjects List

Shows all subjects in the system and which ones you have access to (if subject_admin/examiner).

### Guide

Quick reference for using the platform.

---

## 5. Examination Management

### Creating an Exam

1. Navigate to **Exams** tab in sidebar
2. Fill in the exam form:

| Field | Description | Default |
|-------|-------------|---------|
| Title | Exam name (3-120 chars) | Required |
| Subject | Subject name | "General" |
| Duration | Time limit in minutes | 15 |
| Start/End | Optional scheduling | None |
| Randomize order | Shuffle question order | Off |
| Shuffle options | Shuffle A/B/C/D order per student | Off |
| Negative marks | Penalty for wrong answers (0-1) | 0 |
| Exam password | Optional password to start | None |

3. Click **Create**

### Exam Status Badges

| Badge | Meaning |
|-------|---------|
| Available | Exam is open, student can start |
| Scheduled | Exam hasn't started yet (shows start date) |
| In Progress | Student has an active attempt |
| Completed | Student has finished the exam |
| Ended | Exam has passed its end date |

### Exam List

Shows all exams with:
- Title, subject, duration, question count
- Icons: 🔀 (randomized questions), 🎲 (shuffled options), -25% (negative marking)
- Schedule status (Starts/Ended/Available)
- Clone button, Attendance button

### Cloning an Exam

1. Click the **Clone** button on any exam
2. Confirms the action
3. Creates an exact copy with:
   - Same title (with " (copy)" suffix)
   - Same settings (duration, pass%, camera, randomization, etc.)
   - All questions copied
   - Status: draft

### Adding Questions

**Manual entry:**
1. Select an exam from the list
2. Fill in question form:
   - Type: MCQ / Multi-select / True-False
   - Prompt: Question text
   - Options: Comma-separated (e.g., "A,B,C,D" or "True,False")
   - Correct: Comma-separated correct answers
   - Difficulty: Optional (e.g., "easy", "medium", "hard")
   - Topic: Optional (e.g., "Algebra", "Grammar")
   - Explanation: Optional (shown in review)
3. Click **Add**

**Excel import:**
1. Download the template from the exam page
2. Fill in the spreadsheet (columns: type, prompt, options, answer, marks, difficulty, topic, explanation)
3. Upload the Excel file
4. Questions are added to the exam

**From Question Bank:**
1. Go to **Bank** tab
2. Select questions with checkboxes
3. Choose target exam from dropdown
4. Click **Add to Exam**

### Exam List Management

- Click an exam to select it and view its questions
- Questions appear in the right panel
- Delete individual questions with trash icon
- Export results to Excel
- View attendance sheet
- View exam statistics

---

## 6. Question Bank

The question bank stores reusable questions that can be added to any exam.

### Adding Questions to Bank

1. Go to **Bank** tab in sidebar
2. Fill in the form:
   - Subject, Type (MCQ/Multi/TF)
   - Prompt, Options, Correct answer
   - Marks, Difficulty, Topic, Explanation
3. Click **Add**

### Managing Bank

- **Filter by subject** using the dropdown
- **Select questions** with checkboxes
- **Delete** with trash icon
- **Add to exam:** Select questions → Choose target exam → Click "Add to Exam"

### Using Bank Questions

When you add bank questions to an exam, they become independent copies. Changes to the bank don't affect exams that already use them.

---

## 7. Exam Templates

Templates save exam configurations for quick reuse.

### Creating a Template

1. Go to **Templates** tab
2. Set the desired values (duration, pass%, camera, randomization, negative marks)
3. Enter a template name
4. Click **Save**

### Using a Template

1. Click **Use** on any template
2. Settings are copied to clipboard
3. Go to **Exams** tab
4. Paste values into the exam creation form

### Template Settings Stored

- Subject, Duration, Pass percentage
- Camera required (on/off)
- Negative marks
- Randomize questions (on/off)
- Shuffle options (on/off)

---

## 8. Student Management

### Student List

Shows all registered students with:
- Username, Full name, Student code
- Enrolled subjects (as tags)

### Bulk Enrollment

**Method 1: Enroll All Students**
1. Enter subjects (comma-separated) in the input
2. Click **Enroll All**
3. All students get those subjects added to their profile

**Method 2: CSV Upload**
1. Create a CSV file with format:
   ```
   username,subjects
   john_doe,Mathematics;Computer Science
   jane_smith,General Studies
   ```
2. Upload the file
3. Subjects are merged (not replaced) for each student

**Method 3: JSON API**
```json
POST /api/students/enroll
{
  "entries": [
    {"username": "john_doe", "subjects": ["Mathematics", "CS"]},
    {"username": "jane_smith", "subjects": ["General"]}
  ]
}
```

### Important Notes

- Subjects are **merged**, not replaced (existing subjects are preserved)
- Only students with `role = "student"` are affected
- Non-existent usernames are silently skipped
- super_admin only can access bulk enrollment

---

## 9. Results & Analytics

### Results Table

Shows all graded attempts with:
- Student name, Exam title, Score, Percentage, Pass/Fail
- **Review** button for detailed analysis

### Filtering

- Filter by specific exam using dropdown
- "All" shows all graded attempts

### Combined Analysis

Click **Combined analysis** to see aggregate stats across the first 2 exams:
- Total attempts
- Average score
- Pass rate

### Exam Statistics

When an exam is selected, a full statistics panel appears:

| Metric | Description |
|--------|-------------|
| Attempts | Total graded attempts |
| Pass Rate | Percentage passed |
| Average | Mean score percentage |
| Avg Time | Average completion time (minutes) |

**Score Distribution:**
Bar chart showing score buckets (0-9%, 10-19%, ..., 90-100%)

**Question Analysis:**
Per-question breakdown:
- Question number and prompt
- Correct percentage (color-coded: green ≥70%, amber ≥40%, red <40%)
- Average marks awarded
- Number of responses

**Top Students:**
Top 10 students ranked by score.

### Export Options

| Button | Format | Description |
|--------|--------|-------------|
| Export Excel | `.xlsx` | Spreadsheet with all results |
| Report (PDF) | HTML | Printable report with stats + table |
| Attendance | HTML | Student attendance sheet |

### PDF Report

Opens in a new tab with:
- Stats cards (attempts, passed, average, pass rate)
- Full results table
- **Print / Save as PDF** button (browser print dialog)

### Attendance Sheet

Shows for a specific exam:
- Student name, code, username
- Started at, Submitted at
- Camera consent status
- Score and pass/fail status

---

## 10. Live Proctoring

### Proctor Wall

Real-time monitoring of students taking exams.

**Features:**
- Live camera snapshots (every ~5 seconds)
- Student name, exam title, attempt ID
- Socket.IO real-time updates
- HTTP polling fallback (if socket disconnects)
- Connection status indicator

**Socket events:**
- `proctor-snapshot` — new camera image
- `proctor-active` — student started exam
- `proctor-done` — student finished exam
- `chat-message` — student sent a message

**Image loading:**
- Images fetched with auth headers
- Auto-refreshes every 5 seconds
- Falls back to polling if socket unavailable

### Proctor Snapshot Storage

- Stored in `/var/data/uploads/` on Render
- Path: `snapshots/{attemptId}-{timestamp}.jpg`
- Retained until 30 days after submission

---

## 11. Admin Account Management

**Super admin only.**

### Admin List

Shows all admin/examiner accounts with:
- Username, Role, Full name
- Assigned subjects
- Active/Inactive status

### Creating Admin Accounts

1. Click **Create Admin**
2. Fill in:
   - Username, Password
   - Role (subject_admin or examiner)
   - Full name
   - Subjects (comma-separated)
3. Click **Create**

### Editing Admins

1. Click **Edit** on any admin
2. Modify fields
3. Click **Save**

### Deactivating Admins

1. Click **Deactivate** on any admin
2. Confirms the action
3. Admin can no longer log in (soft delete)

---

## 12. Audit Log

**Super admin only.**

Shows all system actions with:
- Timestamp
- Username and role
- Action performed
- Target (exam, student, etc.)
- Details (JSON)

**Paginated** — 20 entries per page with Previous/Next buttons.

**Actions logged:**
- Exam creation, cloning
- Question addition
- Admin creation/deactivation
- Student enrollment changes

---

## 13. Student Portal

### Navigation

Students have a simpler interface with tabs:
- **Dashboard** — Performance overview
- **Exams** — Available exams
- **My Results** — Graded attempts

### Header

Shows:
- Portal title
- Current username
- Logout button

---

## 14. Student Dashboard

### Welcome Section

Shows the student's name and registered subjects.

### Stat Cards

| Card | Description |
|------|-------------|
| Exams Taken | Number of graded attempts / total available |
| Average Score | Mean percentage across all attempts |
| Pass Rate | Percentage of attempts passed |
| Best Score | Highest score achieved |

### Performance by Subject

Horizontal bar chart for each subject:
- Subject name
- Progress bar (green ≥70%, amber ≥50%, red <50%)
- Average percentage and number of graded exams

### Areas to Improve

List of exams where the student scored below 50%:
- Exam title
- Score percentage

### Score History Chart

Line chart (using Recharts) showing:
- X-axis: Exam titles (chronological)
- Y-axis: Score percentage (0-100%)
- Green line with dots
- Hover tooltip with details

---

## 15. Taking an Exam — Full Flow

### Step 1: Select Exam

1. Go to **Exams** tab
2. Browse available exams (filtered by registered subjects)
3. Each card shows:
   - Title and subject
   - Duration, question count
   - Camera requirement icon
   - Negative marking percentage
   - Status badge (Available/In Progress/Completed/Scheduled)
4. Click **Start exam** (or **Resume exam** if in progress)

### Step 2: Instructions Page

Read the exam rules:
- Duration and auto-submit policy
- Navigation instructions
- Flagging for review
- Auto-save frequency
- Tab-switch policy (if proctored)
- Proctoring policy (if proctored)
- Negative marking warning (if applicable)

Click **Continue to camera setup** (or **Start exam** if not proctored)

### Step 3: Camera & Screen Consent (Proctored Exams)

1. Read consent checkboxes:
   - Camera snapshots for proctoring
   - Whole-screen sharing
2. Click **Step 1 — Enable camera**
   - Browser prompts for camera permission
   - Wait for "Camera enabled" status
3. Click **Step 2 — Share entire screen**
   - Browser shows screen picker
   - Select **Entire Screen**
   - Wait for "Screen sharing enabled" status
4. Click **Start exam**

### Step 4: Exam Password (If Set)

If the exam has a password:
1. Enter the password provided by the examiner
2. Click **Start exam**

### Step 5: Exam Interface

The exam has two columns:

**Left column (main):**
- Question number (Q1/10)
- Flag button (☆ Flag / ★ Flagged)
- Timer (MM:SS, red when <60s)
- Question prompt
- Options (radio buttons for MCQ/TF, checkboxes for multi-select)
- Previous/Next navigation
- Submit button (on last question)

**Right column (sidebar):**
- Proctoring status (camera/screen active indicators)
- Question navigation grid (colored: green=answered, amber=flagged, gray=unanswered)
- Flagged questions list
- Chat with Proctor button
- Submit Exam button

### Step 6: Submit

1. Click **Submit Exam** (available on any question)
2. Confirmation prompt
3. Server grades the attempt
4. Result screen appears

---

## 16. Exam Player Features

### Auto-Save

- Answers saved instantly when selected
- Background auto-save every 30 seconds
- Resumes from last saved state if page refreshes

### Tab-Switch Detection

- Monitors `visibilitychange` event
- Counts violations (max 5)
- Warning banner shows violation count
- At 5 violations: exam auto-submitted
- Violations recorded server-side

### Copy-Paste Prevention

During the exam:
- Right-click disabled
- Copy, paste, cut blocked
- Ctrl+C/V/X/A keyboard shortcuts blocked
- Text selection disabled (`userSelect: none`)

### Question Flagging

- Click ☆ Flag to mark a question for review
- Flagged questions appear in sidebar with amber dot
- Click flagged question to jump to it
- Unflag by clicking ★ Flagged again

### Question Navigation Grid

- Grid of numbered buttons (Q1-Q10, etc.)
- **Green:** Answered
- **Amber:** Flagged
- **Amber + Green:** Answered and flagged
- **Gray:** Unanswered
- **Current:** Highlighted with gradient

### Timer

- Countdown from exam duration
- Server-enforced (can't be bypassed)
- Red when <60 seconds remaining
- Auto-submits when time expires

### In-Exam Chat

1. Click **Chat with Proctor** in sidebar
2. Chat panel opens
3. Type message and press Enter or click Send
4. Messages sent via Socket.IO to proctor wall
5. Proctor can see all messages in real-time
6. Chat history persists for the attempt

### Answer Randomization

If exam has "Shuffle options" enabled:
- Options are shuffled per student using a seeded PRNG
- Same seed used for question order if "Randomize order" is also enabled
- Seed stored in attempt for consistent resume
- Example: Student A sees "A) Paris, B) London", Student B sees "B) Paris, A) London"

---

## 17. Result Review & Certificate

### Result Screen

After submission:
- **Pass/Fail** indicator with icon
- **Score:** X / Y — Z%
- **Correct count:** X/Y correct
- **Exam title**

### Review Answers

Full question-by-question review:
- Question number and prompt
- **Correct/Wrong** badge with marks (e.g., "Correct · 1/1")
- Options listed with indicators:
  - ✓ Green: Correct answer
  - ✗ Red: Student's wrong answer
  - ○ Gray: Other options
- **Explanation** (if provided by examiner)

### Certificate Download

If the student passed:
- **Download Certificate** button appears
- Generates an HTML file with:
  - Gold border design
  - "Certificate of Achievement" header
  - Student name
  - Exam title and subject
  - Score and percentage
  - Date of completion
  - Verification code (unique per attempt)
- File downloads as `.html` (can be printed to PDF)

### Persistent Review

Students can revisit past exams:
1. Go to **My Results** tab
2. Click **Review** on any graded attempt
3. Full read-only review with all questions, answers, and explanations

---

## 18. Security Features

### Authentication

- JWT tokens with 1-day expiration
- Password hashing with bcrypt (12 rounds)
- Auto-logout on 401 responses

### Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| Auth (login/register) | 20 requests | 15 minutes |
| Proctor snapshots | 30 requests | 1 minute |
| General API | 120 requests | 1 minute |

### Input Sanitization

- All user inputs sanitized with `sanitize-html`
- XSS prevention via Helmet CSP headers
- SQL injection prevented by parameterized queries

### Exam Security

- Tab-switch detection with auto-submit
- Copy-paste prevention during exam
- Camera/screen monitoring
- Exam password (optional)
- Server-enforced timers (can't be bypassed)
- Option randomization per student
- Question order randomization

### Proctoring

- Camera snapshots every 5 seconds
- Full-screen sharing required
- Tab violation tracking
- Chat monitoring
- Snapshot retention: 30 days after submission

---

## 19. API Reference

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new student |
| POST | `/api/auth/login` | Login (all roles) |
| GET | `/api/auth/me` | Get current user |

### Exams

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/exams` | All | List exams (filtered by role) |
| GET | `/api/exams/my-status` | Student | Per-exam attempt status |
| GET | `/api/exams/:id` | All | Get exam with questions |
| POST | `/api/exams` | Admin | Create exam |
| POST | `/api/exams/:id/clone` | Admin | Clone exam |
| GET | `/api/exams/:id/stats` | Admin | Exam statistics |
| GET | `/api/exams/:id/attendance` | Admin | Attendance sheet |
| GET | `/api/exams/:id/question-analytics` | Admin | Per-question analytics |
| POST | `/api/exams/:id/questions` | Admin | Add question |
| POST | `/api/exams/:id/questions/import` | Admin | Excel import |

### Attempts

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/api/attempts/start` | Student | Start/resume attempt |
| POST | `/api/attempts/:id/answer` | Owner | Save answer |
| GET | `/api/attempts/:id/answers` | Owner | Load saved answers |
| POST | `/api/attempts/:id/submit` | Owner | Submit and grade |
| GET | `/api/attempts/:id/review` | Owner | Detailed review |
| GET | `/api/attempts/:id/certificate` | Owner | Certificate data |
| POST | `/api/attempts/:id/flag/:qid` | Owner | Flag question |
| DELETE | `/api/attempts/:id/flag/:qid` | Owner | Unflag question |
| GET | `/api/attempts/:id/flags` | Owner | Get all flags |
| POST | `/api/attempts/:id/tab-violation` | Owner | Record violation |
| GET | `/api/attempts/:id/violations` | Owner | Get violations |

### Chat

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/api/attempts/:id/messages` | Owner | Send message |
| GET | `/api/attempts/:id/messages` | Owner | Get messages |
| GET | `/api/proctor/messages` | Admin | All messages |

### Question Bank

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/bank` | Admin | List bank questions |
| POST | `/api/bank` | Admin | Add to bank |
| DELETE | `/api/bank/:id` | Admin | Delete from bank |
| POST | `/api/bank/add-to-exam` | Admin | Add bank questions to exam |

### Templates

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/templates` | Admin | List templates |
| POST | `/api/templates` | Admin | Create template |
| DELETE | `/api/templates/:id` | Admin | Delete template |

### Students

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/students` | Admin | List students |
| POST | `/api/students/enroll` | Super | Bulk enroll (JSON) |
| POST | `/api/students/enroll/csv` | Super | Bulk enroll (CSV) |

### Results

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/results` | All | Graded results |
| GET | `/api/results/combined` | Admin | Combined analysis |
| GET | `/api/results/export` | Admin | Excel export |
| GET | `/api/results/report` | Admin | HTML/PDF report |
| GET | `/api/student/dashboard` | Student | Student dashboard data |

### Proctor

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/proctor/live` | Admin | Live camera feeds |
| GET | `/api/proctor/snapshots/:id` | Owner | Snapshot list |
| GET | `/api/proctor/snapshot/:id/:fname` | Auth | Single snapshot |

### Admin

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/admin/users` | Super | List admin accounts |
| POST | `/api/admin/users` | Super | Create admin |
| PUT | `/api/admin/users/:id` | Super | Update admin |
| DELETE | `/api/admin/users/:id` | Super | Deactivate admin |
| GET | `/api/dashboard/stats` | Admin | Dashboard stats |
| GET | `/api/audit` | Super | Audit log |
| GET | `/api/subjects` | Public | List all subjects |

---

## 20. Environment Variables

### Client (Vite)

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL | `https://cbt-new-aram.onrender.com` |

### Server (Render)

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `production` |
| `PORT` | Server port | `10000` |
| `JWT_SECRET` | JWT signing secret | Auto-generated |
| `ADMIN_PASSWORD` | Default admin password | `Minator1!` |
| `DB_PATH` | SQLite database path | `/var/data/cbt.db` |
| `UPLOADS_DIR` | File uploads directory | `/var/data/uploads` |
| `CORS_ORIGIN` | Allowed origin | `https://cbt-new-eight.vercel.app` |

---

## 21. Deployment

### Render (Backend)

- Auto-deploys from `main` branch
- Persistent disk: `cbt-data` mounted at `/var/data`
- SQLite database stored at `/var/data/cbt.db`
- Uploads stored at `/var/data/uploads`

### Vercel (Frontend)

- Auto-deploys from `main` branch
- Build command: `npm run build`
- Output directory: `dist`

### Local Development

```bash
# Start server
cd server
npm install
npm run dev

# Start client (in separate terminal)
cd client
npm install
npm run dev
```

Or use `start.bat` which manages ports automatically.

---

## Database Schema

### Users

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('super_admin','subject_admin','examiner','student')),
  full_name TEXT,
  student_code TEXT UNIQUE,
  subjects TEXT,          -- JSON array for students
  admin_subjects TEXT,    -- JSON array for admins
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
```

### Exams

```sql
CREATE TABLE exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  subject TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  pass_percent INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'published',
  camera_required INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_by_id INTEGER,
  scheduled_start INTEGER,
  scheduled_end INTEGER,
  randomize_questions INTEGER NOT NULL DEFAULT 0,
  randomize_options INTEGER NOT NULL DEFAULT 0,
  negative_marks REAL NOT NULL DEFAULT 0,
  exam_password TEXT,
  created_at INTEGER NOT NULL
);
```

### Questions

```sql
CREATE TABLE questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('mcq','multi','tf')),
  prompt TEXT NOT NULL,
  options TEXT NOT NULL,     -- JSON array
  answer TEXT NOT NULL,      -- JSON array
  marks INTEGER NOT NULL DEFAULT 1,
  difficulty TEXT,
  topic TEXT,
  explanation TEXT,
  order_index INTEGER NOT NULL
);
```

### Attempts

```sql
CREATE TABLE attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('in_progress','submitted','graded')),
  score INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  percent REAL NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  camera_consent_at INTEGER,
  started_at INTEGER NOT NULL,
  submitted_at INTEGER,
  ends_at INTEGER NOT NULL,
  option_seed TEXT
);
```

### Attempt Answers

```sql
CREATE TABLE attempt_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL,
  given TEXT,               -- JSON array of selected options
  is_correct INTEGER,
  marks_awarded INTEGER,
  answered_at INTEGER NOT NULL
);
```

### Other Tables

- `tab_violations` — Tab-switch violation records
- `flagged_questions` — Question flags per attempt
- `exam_messages` — In-exam chat messages
- `question_bank` — Reusable question bank
- `exam_templates` — Saved exam configurations
- `audit_log` — System action audit trail

---

## Total Feature Count: 38

| Category | Features |
|----------|----------|
| Authentication | JWT, 4 roles, registration, login |
| Exam Management | Create, clone, schedule, password, randomization, negative marking |
| Question System | Manual entry, Excel import, question bank, templates, difficulty/topic/explanation |
| Proctoring | Camera, screen share, tab detection, proctor wall, snapshots, chat |
| Student Experience | Dashboard, subject filtering, status badges, resume, instructions page |
| Security | Rate limiting, sanitization, copy-paste prevention, option shuffling |
| Results | Auto-grading, partial credit, review, certificate, attendance sheet |
| Analytics | Score distribution, question analysis, top students, score history chart |
| Admin Tools | Sidebar navigation, bulk enrollment, admin CRUD, audit log, PDF/Excel export |
| Real-time | Socket.IO, live feeds, chat, auto-save |
