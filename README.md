# CPMS: Collaborative Project Management System

FastAPI + Supabase backend, React + TypeScript + Vite + Tailwind frontend. Built for CS students and their supervisors.

```
cpms-root/
├── backend/            FastAPI app (app/api/v1/endpoints, core, schemas, services), tests, Dockerfile
├── frontend/           React app (components, dashboards, pages, hooks, services)
├── database/schema.sql Tables, triggers, RLS policies, storage bucket. Run once.
└── scripts/            setup + dev scripts for macOS/Linux/WSL (.sh) and Windows (.bat)
```

## Run it on your own machine

You need Python 3.10+, Node 18+, and a free Supabase project. Nothing else is required for a first test:
email sign-up, projects, tasks, milestones, Kanban, Gantt, calendar, ideas, DMs, forum and admin all work with just Supabase.
GitHub, Google sign-in, invite emails and Google Meet links each need one extra credential (sections below).

### 1. Create the Supabase project
1. Go to supabase.com, create a project, wait for it to finish provisioning.
2. **SQL Editor → New query**, paste all of `database/schema.sql`, run it. It is safe to run again.
3. **Project Settings → API**: copy the Project URL, the `anon` key and the `service_role` key.
4. **Authentication → URL Configuration**: set Site URL to `http://localhost:5173` and add `http://localhost:5173/**` to Redirect URLs.
5. For quick local testing, **Authentication → Providers → Email**: turn off "Confirm email". Otherwise new accounts must click the emailed link before signing in.

### 2. Install and configure
```bash
./scripts/setup.sh          # Windows: scripts\setup.bat
```
It creates `backend/.venv`, installs both sets of packages, copies the `.env` files and generates `TOKEN_ENCRYPTION_KEY` for you.
Then edit:

`backend/.env`
```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...      # server only. Never put this in the frontend.
```
`frontend/.env`
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

### 3. Start
```bash
./scripts/dev.sh            # Windows: scripts\dev.bat
```
Web app: http://localhost:5173 · API docs: http://localhost:8000/docs · Health: http://localhost:8000/health

Manual alternative, in two terminals:
```bash
cd backend  && .venv/bin/uvicorn app.main:app --reload --port 8000     # Windows: .venv\Scripts\uvicorn ...
cd frontend && npm run dev
```

### 4. Create your roles
Everyone starts as a `student`. Sign up once, then promote yourself in the Supabase SQL editor:
```sql
update profiles set role = 'admin' where email = 'you@example.com';
```
Sign out and in again. The Administration page lets you change anyone else's role (for example to `supervisor`).
A student names a supervisor by email when creating a project, and that person must already have the supervisor role.

### A 10-minute test script
Use two browsers (or one normal + one private window) so you can be two people.
1. Account A (student) creates a project, adds required skills, and invites account B by email from **Team**. With no email provider configured, copy the invite link shown under the form.
2. Account B opens the link, signs up with the invited address, and is added automatically.
3. A creates milestones (weights must total at most 100%), assigns one to B, adds tasks with dates and a dependency, and drags cards on **Board**. Try moving a task whose dependency is unfinished: it is blocked.
4. B clicks **Mark complete** on a milestone. A (or the supervisor) opens **Review**, approves, and **Overall progress** moves.
5. Account C searches **Find projects** and requests to join. A approves from **Team → Join requests**.
6. Try Ideas (react, comment), Meetings (an instant meeting DMs everyone), Messages, Community, and **Report** on a teammate. The report shows up in the admin account under Reports.
7. As admin, open **Administration → System health** to see what is configured.

Backend smoke tests (no database needed): `cd backend && pip install pytest && python -m pytest tests -q`

## Optional integrations

**GitHub, private repositories (Personal Access Token).** On a project: GitHub tab → enter owner, repo and a token.
Create the token at github.com/settings/tokens. A classic token needs the `repo` scope; a fine-grained token needs read access to Contents, Issues and Pull requests on that repository.
The token is encrypted with `TOKEN_ENCRYPTION_KEY` and never returned by the API.

**GitHub, OAuth button.** Create an OAuth App at github.com/settings/developers with callback URL `http://localhost:5173/github/callback`,
then set `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` in `backend/.env` and restart the API.

**GitHub live events (webhooks).** GitHub cannot reach `localhost`. The commit, PR, issue and branch tabs work without it.
For live events, expose the API with a tunnel (for example `ngrok http 8000`), put that URL in `BACKEND_URL`, and reconnect the repo.
If automatic webhook creation fails the panel shows the exact URL and secret to paste into the repo's webhook settings.

**Google sign-in.** Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web). Add the authorized redirect URI
`https://YOUR-PROJECT.supabase.co/auth/v1/callback`. In Supabase → Authentication → Providers → Google, paste the client ID and secret and enable it.

**Invite and meeting emails.** Set `RESEND_API_KEY` (or `SENDGRID_API_KEY`) and `EMAIL_FROM`. With Resend's test sender you can only email your own address until you verify a domain.
Without any provider the app still works: invite links are shown on screen for you to share.

**Real Google Meet links.** Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN`
(a refresh token for the `https://www.googleapis.com/auth/calendar.events` scope, obtainable from the Google OAuth Playground).
Without them the scheduler creates a Jitsi room link instead, so meetings always work.

## How the main rules are enforced
- **Weights**: the API rejects a milestone that would push the project over 100%, and a database trigger enforces the same rule.
- **Progress** counts only approved milestones. Individual progress is the approved share of the milestones assigned to that person.
- **Review**: nobody can approve their own milestone (except an admin). Requesting changes requires a note.
- **Dependencies**: a task cannot leave "To do" while something it depends on is unfinished, and loops are rejected.
- **Authorization**: the backend uses the service-role key, so every endpoint checks the caller's project role in code (`app/core/access.py`). RLS in `schema.sql` additionally protects direct browser access.

## Deploying beyond your laptop
Backend: `backend/Dockerfile` (`docker build -t cpms-api backend`). Set the same variables as `.env`, plus `CORS_ORIGINS`, `FRONTEND_URL` and `BACKEND_URL` to your real URLs.
Frontend: `cd frontend && npm run build`, host `dist/` on any static host, and set `VITE_API_URL` to the API origin at build time. Add the production URL to Supabase redirect URLs.
The WebSocket hub is in-memory, so run one API process (or move to Redis pub/sub before scaling out).

## Known limits
- Written and checked without access to your Supabase project. What was verified: the API imports and its smoke tests pass, the frontend type-checks and builds, setup and dev scripts run from a clean copy and both servers start. The flows above have not been clicked through against a live database, so expect to fix small things in your first test session.
- UI primitives in `components/ui` are hand-written in shadcn style (same tokens and look) because the shadcn CLI needs an interactive setup.
- Evidence-based team matching is a transparent score (skill overlap, same course, stated availability) and shows its evidence. It is not a learned model.
- Contribution charts summarize recorded activity only and say so on screen.
