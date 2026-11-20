# AI Gym Coach

A Claude-powered workout planner for iPhone (installable PWA). It plans gym or home sessions on a
**Push/Pull/Legs**, **Upper/Lower** or **Full-body** split, logs every set, and uses your history for
progressive overload on the next plan.

```
iPhone (PWA on GitHub Pages)  ──HTTPS + passphrase──▶  Cloudflare Worker  ──▶  Claude API
                                                            │
                                                            └──▶  Cloudflare D1 (workout history)
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
npm run db:init                           # creates the tables
npx wrangler secret put ANTHROPIC_API_KEY # from console.anthropic.com
npx wrangler secret put APP_PASSPHRASE    # any long random string you'll type once on the phone
npm run deploy                            # prints https://ai-gym-coach-api.<you>.workers.dev
```

`ALLOWED_ORIGINS` in `wrangler.toml` must match your Pages origin (`https://legolassrb.github.io`).
`MODEL` controls which Claude model plans the workouts.

**Optional CI deploys:** add the repo secrets `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers")
and `CLOUDFLARE_ACCOUNT_ID`. Every push to `worker/` will then run the tests and deploy.

## 3. Install on iPhone

1. Open the Pages URL in **Safari**.
2. Go to **Settings tab**, enter the Worker URL and passphrase, then tap **Save & test connection**.
3. Set your split, goal, and gym/home equipment.
4. Tap **Share → Add to Home Screen**.

## How planning works

`POST /api/plan` works out the next day in your split rotation (based on the last completed workout).
It sends Claude your settings, equipment for today's location, available time, today's notes, your last
12 workouts and your best lifts. Claude answers through a forced tool call (`submit_workout_plan`), so the
plan always arrives as structured JSON with exercises, sets, reps, target weight, rest, estimated time and
coach notes. When you tap **Finish & save**, the plan becomes a completed workout with the sets you ticked.

## API

All routes except `/api/health` require `Authorization: Bearer <APP_PASSPHRASE>`.

| Method | Path | Purpose |
|---|---|---|
| GET/PUT | `/api/settings` | split, goal, experience, units, equipment, notes |
| GET | `/api/next` | next day in the split rotation |
| POST | `/api/plan` | `{location, minutes, split_day?, notes?, date?}` → Claude plan |
| GET/POST | `/api/workouts` | list history / save completed workout |
| GET/DELETE | `/api/workouts/:id` | one workout |
| GET | `/api/stats` | best weight, estimated 1RM, last date per exercise |

## Local development

```bash
cd worker
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .dev.vars
echo 'APP_PASSPHRASE=dev' >> .dev.vars
npm run db:init:local && npm run dev       # API on http://localhost:8787
npx serve ../frontend                      # or any static server
npm test                                   # offline tests: in-memory D1 + mocked Claude
```

For local dev, set `ALLOWED_ORIGINS` to include your local frontend origin.
