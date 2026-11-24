# AI Gym Coach

A Claude-powered workout planner for iPhone (installable PWA). It plans gym or home sessions on a
**Push/Pull/Legs**, **Upper/Lower** or **Full-body** split, logs every set, and uses your history for
progressive overload on the next plan.

```
iPhone (PWA on GitHub Pages)  ──HTTPS + session token──▶  Cloudflare Worker  ──▶  Claude API
                                                               │
                                                               └──▶  Cloudflare D1 (users, workout history)
```

- `frontend/` is a static PWA with no build step. GitHub Pages hosts it.
- `worker/` is the API. It keeps the Claude API key secret, stores history in D1, and builds the planning prompt.
- `.github/workflows/` auto-deploys the frontend to Pages and tests and deploys the Worker.

## 1. Push to GitHub

```bash
cd ai-gym-coach
git remote add origin https://github.com/legolassrb/ai-gym-coach.git   # already set if you use this zip
git push -u origin main
```

Then go to **Settings → Pages → Source: GitHub Actions**. The site will be at
`https://legolassrb.github.io/ai-gym-coach/`.

## 2. Deploy the Worker (Cloudflare free plan)

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create gym-coach          # copy the database_id into wrangler.toml
npm run db:init                           # applies migrations/ (creates or upgrades the tables)
npx wrangler secret put ANTHROPIC_API_KEY # from console.anthropic.com
npx wrangler secret put APP_PASSPHRASE    # the admin code: a long random string, only needed to create admins
npm run deploy                            # prints https://ai-gym-coach-api.<you>.workers.dev
```

Upgrading an existing deployment: run `npm run db:init` again before `npm run deploy`. It applies only
the migrations the database doesn't have yet.

`ALLOWED_ORIGINS` in `wrangler.toml` must match your Pages origin (`https://legolassrb.github.io`).
`MODEL` controls which Claude model plans the workouts.

**Optional CI deploys:** add the repo secrets `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers")
and `CLOUDFLARE_ACCOUNT_ID`. Every push to `worker/` will then run the tests and deploy.

## 3. Install on iPhone

1. Open the Pages URL in **Safari**.
2. Tap **Create account**. For your own account, open **I have an admin code** and enter `APP_PASSPHRASE`.
   (If your Worker URL differs from the default in `frontend/app.js`, set it under **Server**.)
3. In **Settings**, set your split, goal, and gym/home equipment.
4. Tap **Share → Add to Home Screen**.

## Accounts and roles

Anyone can create an account. Each user has their own settings, history and progress.

| | user | admin |
|---|---|---|
| Plan and log workouts, see own history | ✓ | ✓ |
| **Progress** tab: totals, weekly volume, estimated 1RM per exercise, best lifts | ✓ | ✓ |
| Delete own workout logs | ✓ | ✓ |
| **Admin** tab: list users, browse everyone's logs, delete any log, change roles, delete users | | ✓ |

- An account becomes admin only when created with the admin code (`APP_PASSPHRASE`). Admins can then
  promote other users. Admins can't demote or delete themselves.
- The first admin account inherits the workouts and settings from the single-user version.
- Passwords are stored as PBKDF2-SHA256 hashes. Sessions last 30 days and are revoked on sign-out or
  when the user is deleted.
- Because sign-up is open, normal users can make `PLAN_DAILY_LIMIT` Claude plans per 24 hours (default 20).
  Set it under `[vars]` in `wrangler.toml` to change it.

## Exercise sketches

Every exercise card shows a hand-drawn style sketch from `frontend/sketches.js`. All sketches use one
stick figure, canvas and pencil filter, so they look the same across workouts. Claude tags each planned
exercise with a `movement` pattern (squat, hinge, press, pull, ...). Older logs fall back to keyword
matching on the exercise name.

## How planning works

`POST /api/plan` works out the next day in your split rotation (based on the last completed workout).
It sends Claude your settings, equipment for today's location, available time, today's notes, your last
12 workouts and your best lifts. Claude answers through a strict tool call (`submit_workout_plan`), so the
plan always arrives as structured JSON with exercises (including a movement pattern for the sketch), sets,
reps, target weight, rest, estimated time and coach notes. When you tap **Finish & save**, the plan becomes a completed workout with the sets you ticked.

## API

Sign up or sign in to get a token, then send `Authorization: Bearer <token>`. `/api/health` and the two
`/api/auth` sign-in routes are public. Data routes only ever return the signed-in user's own data.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` | `{username, password, admin_code?}` → `{token, user}` |
| POST | `/api/auth/login` | `{username, password}` → `{token, user}` |
| POST | `/api/auth/logout` | revoke the current token |
| GET | `/api/me` | `{id, username, role}` |
| GET/PUT | `/api/settings` | split, goal, experience, units, equipment, notes |
| GET | `/api/next` | next day in the split rotation |
| POST | `/api/plan` | `{location, minutes, split_day?, notes?, date?}` → Claude plan |
| GET/POST | `/api/workouts` | list history / save completed workout |
| GET/DELETE | `/api/workouts/:id` | one workout (owner or admin) |
| GET | `/api/stats` | best weight, estimated 1RM, last date per exercise |
| GET | `/api/progress?exercise=` | totals, weekly volume, one exercise's per-session trend |
| GET | `/api/admin/users` | admin: users with workout counts |
| PUT/DELETE | `/api/admin/users/:id` | admin: `{role}` / delete user and their logs |
| GET | `/api/admin/workouts?user_id=` | admin: everyone's logs, optionally one user's |
| GET | `/api/diag` | admin: Claude key fingerprint and model |

`worker/scripts/api.sh` signs in and calls any route (`GYM_API_URL`, `GYM_USER` and `GYM_PASSWORD`
in `worker/.api.env`). For example: `scripts/api.sh GET /api/progress`.

## Local development

```bash
cd worker
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .dev.vars
echo 'APP_PASSPHRASE=dev' >> .dev.vars      # admin code for local sign-up
npm run db:init:local && npm run dev       # API on http://localhost:8787
npx serve ../frontend                      # or any static server; set Server to http://localhost:8787 on sign-in
npm test                                   # offline tests: in-memory D1 (via migrations) + mocked Claude
```

For local dev, set `ALLOWED_ORIGINS` to include your local frontend origin.
Schema changes go in a new numbered file in `worker/migrations/`.
