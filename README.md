# FellaRide Community Activation Engine

**Ignition Hackathon · PS Variant 1, "Community in Motion"**

FellaRide takes a newly created community (a university, company, residential society, alumni network or professional group) from a handful of members to an active carpooling network. It runs the loop:

**Discover → Identify → Match → Nudge → Ride → Learn → Refer → Grow**

The engine profiles every member, predicts who will drive, ride, connect people or refer friends, finds high-potential commute corridors, recommends ride partners automatically, sends targeted nudges, learns from every outcome, and tracks the activation funnel and growth graph.

> **Result on synthetic data (40 days, same community, `POST /api/v1/demo/compare`):** compared with random nudges, the smart engine produced **2.2× more active users, 4× more completed rides, 1.7× more registrations and a 1.8× higher match rate**.

---

## Team

| | |
|---|---|
| Team name | _fill in_ |
| Members | _name: role_ (one per line) |
| Problem statement | PS Variant 1, Community in Motion |
| Repository | official event repository |

## Solution summary

| PS requirement | How we solve it | Where |
|---|---|---|
| Member profiles | Location, destination, departure time, car and seats, preferences, activity, social ties | `engine/context.py` |
| Score likely drivers, riders, connectors, referrers | Logistic-regression propensity model, trained offline (`scorer.pkl`) and updated online after every outcome | `engine/scorer.py`, `ml/` |
| Match on route, pickup distance, timing, capacity, preferences | Score = 0.40·route overlap + 0.25·(1 − detour/3 km) + 0.25·(1 − Δt/30 min) + 0.10·preference fit, with hard limits | `engine/matching.py` |
| High-potential ride clusters | Corridors = same ~1.5 km home cell + destination + 30-min window; "hot" when 3+ registered with at least 1 driver and 1 rider | `engine/context.py` |
| Recommend partners automatically | Ranked partners per member; rider nudges name a specific driver | `GET …/recommendations` |
| Targeted nudges, right person and time | Intervention Engine: priority = p(role) × corridor value × (1 − fatigue); daily budget; 2-day cooldown | `engine/interventions.py` |
| Connectors as early adopters | Connectors-first in days 0–4: hubs invite neighbours | `engine/interventions.py` |
| Referrals to likely participants | Invite suggestions ranked by predicted rider propensity plus a hot-corridor bonus | `engine/referrals.py` |
| Activation funnel | registration → first interaction → first ride → repeat ride → referral, stamped per member | `GET …/metrics/funnel` |
| Learn from successful and failed matches | Nudge responses, completed rides (+) and cancelled rides (−) update the weights | `engine/scorer.py`, `engine/rides.py` |
| Growth graph over time | Social ties, co-ride edges and referral edges, each with a start day | `GET …/graph` |
| Success metrics | Active users, rides created and completed, completion rate, match rate, repeat rate, network connectivity, nudge response, referral conversion | `GET …/metrics`, `…/timeseries` |

## Architecture

```
Members ─▶ App ─▶ API Gateway (tenant-scoped) ─▶ Matching Engine ─▶ Ride Service ─▶ Activity Events
                        │                              ▲                                   │
                   Tenant DB ◀── Member Discovery       │ ranked candidates                 ▼
                                               Propensity Scorer ◀── features ── Community Intelligence
                                                 │        ▲                                │
                                          scores ▼        └── clusters ── Cluster Finder ◀─ Growth Graph ─▶ Dashboard
                                     Intervention Engine ─▶ Nudge & Referrals ─▶ back to Members
```

Animated versions: *FellaRide Community Activation Engine* and *Member Activation Journey* (made with Archify), plus the interactive *FellaRide Growth Simulator*.

**Stack:** Python 3.13 · FastAPI · SQLAlchemy 2 · PostgreSQL 16 (SQLite for local development) · scikit-learn · Docker. The frontend (React) is in progress in Sprint 2.

```
backend/
  app/
    main.py            API entry, CORS, error handling, demo seeding
    config.py          settings from environment variables
    models.py          database tables
    schemas.py         validated request bodies
    api/               community, rides, engagement (nudges + referrals), insights (metrics, simulation)
    engine/            context (intelligence), scorer, matching, interventions, referrals, rides, lifecycle, metrics, daycycle
    sim/               SYNTHETIC community generator + behaviour replay (demo and training only)
  ml/train_scorer.py   trains models/scorer.pkl
  notebooks/scorer_training.ipynb   training + inference notebook (executed)
  models/scorer.pkl    trained model artifact loaded by the API
  tests/               pytest suite
```

## Supported environments

- Linux, macOS or Windows with Python 3.11+ (developed on 3.13), **or** Docker 24+ with Docker Compose v2.
- Any modern browser for the interactive API docs at `/docs`.

## Install and run

### Option A: Docker (PostgreSQL)
```bash
cp .env.example .env              # then set POSTGRES_PASSWORD and FELLARIDE_ADMIN_KEY
docker compose up --build
# API:   http://localhost:8000      Docs: http://localhost:8000/docs
```

### Option B: local Python (SQLite)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

### Retrain the model (optional)
```bash
cd backend
python -m ml.train_scorer --runs 6 --days 30          # writes models/scorer.pkl and models/scorer.json
```

## Deployment and access

- **Public URL:** _add after deployment_ (Render, Railway or any Docker host: build `backend/Dockerfile` and set the environment variables below. The container listens on `$PORT`, default 8000).
- **Evaluator access:** no login is needed in this sprint. On first start the API creates a **synthetic demo community** and replays 14 days, so `GET /api/v1/tenants` immediately returns a community you can explore.
- **Admin-only endpoints** (`/tenants/demo`, `/simulate`, `/day/close`, `/demo/compare`) need the `X-Admin-Key` header. Evaluators do not need them to test the core features.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `FELLARIDE_DATABASE_URL` | SQLite file in `backend/` | e.g. `postgresql+psycopg://user:pass@host:5432/fellaride` |
| `POSTGRES_USER`, `POSTGRES_PASSWORD` | `fellaride`, none | used by docker-compose |
| `FELLARIDE_ADMIN_KEY` | empty | protects demo and simulation endpoints; **set it in any shared deployment** |
| `FELLARIDE_CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | allowed frontend origins |
| `FELLARIDE_SEED_DEMO_DAYS` | `14` | days to replay for the auto-seeded demo community (0 = off) |
| `FELLARIDE_NUDGE_BUDGET_PER_DAY` | `14` | maximum nudges per community per day |
| `FELLARIDE_NUDGE_COOLDOWN_DAYS` | `2` | minimum days between nudges to one member |
| `FELLARIDE_MAX_DETOUR_KM` | `3.0` | matching: maximum pickup detour |
| `FELLARIDE_MAX_TIME_GAP_MIN` | `30` | matching: maximum departure-time difference |
| `FELLARIDE_LEARNING_RATE` | `0.35` | online learning step size |

`.env.example` contains safe placeholders. Never commit `.env`.

## Database setup

The tables are created automatically on startup (`init_db`). With Docker, PostgreSQL runs in the `db` service with a named volume (`pgdata`). To reset everything, run `docker compose down -v`. Locally, delete `backend/fellaride.db`.

Main tables: `tenants`, `destinations`, `members`, `connections` (social and co-ride edges), `ride_offers`, `ride_requests`, `bookings`, `interventions`, `referrals`, `events`, `model_states` (per-community learned weights), `daily_metrics`, `synthetic_traits` (simulation only).

## API overview (prefix `/api/v1`)

| Group | Endpoint |
|---|---|
| Community | `POST /tenants` · `GET /tenants` · `GET /tenants/{t}` · `POST /tenants/{t}/members/import` · `POST /tenants/{t}/members/{m}/register` |
| Intelligence | `GET /tenants/{t}/members` · `GET /tenants/{t}/members/{m}` (profile, features, 4 scores, corridor) · `GET /tenants/{t}/clusters` |
| Matching | `GET /tenants/{t}/members/{m}/recommendations` · `POST /tenants/{t}/rides/match` |
| Rides | `POST /tenants/{t}/rides/offers` · `POST /tenants/{t}/rides/requests` · `GET /tenants/{t}/rides` · `POST /tenants/{t}/rides/offers/{o}/finish` |
| Interventions | `POST /tenants/{t}/interventions/plan` · `GET /tenants/{t}/interventions` · `POST /tenants/{t}/interventions/{i}/respond` |
| Referrals | `GET /tenants/{t}/members/{m}/invite-suggestions` · `POST /tenants/{t}/referrals` · `POST /tenants/{t}/referrals/{r}/accept` |
| Insights | `GET /tenants/{t}/metrics` · `…/metrics/funnel` · `…/metrics/timeseries` · `…/graph` · `…/model` |
| Demo (admin) | `POST /tenants/demo` · `POST /tenants/{t}/simulate` · `POST /tenants/{t}/day/close` · `POST /demo/compare` |

Every member, ride, nudge and invite is checked against the community in the URL. Cross-community access returns 404.

## Tests

```bash
cd backend
pytest -q
```
14 tests cover:
- the matching rules and the online learner
- the full loop (import → register → recommend → nudge → respond → match → ride → refer → metrics)
- cross-community isolation, input validation and admin-key protection
- refusal to simulate on real communities
- demo seeding
- the core claim that the smart engine beats random nudges

## Data disclosure: synthetic data

All demo and training data is **synthetic**. The synthetic community (`app/sim/synthetic.py`) has 180 generated members with generic first names plus an initial, `@example.edu` emails, and generated coordinates around a synthetic centre point. No real person's data is collected or stored. Synthetic members and communities are flagged `synthetic: true` in every API response. Each synthetic member's hidden behaviour (`synthetic_traits`) is read only by the simulator, never by the engine.

## AI tools used

| Tool | Purpose |
|---|---|
| Claude (Anthropic) | Planning, architecture, Sprint 1 backend code generation, tests, documentation, the Growth Simulator page |
| Archify (open-source, MIT) | Generating the animated architecture and member-journey diagrams |

Every team member is expected to be able to explain, modify and debug every part of this code (rule §1).

## Third-party resources

| Resource | Use | License |
|---|---|---|
| FastAPI | web framework | MIT |
| Uvicorn | ASGI server | BSD-3-Clause |
| SQLAlchemy | ORM | MIT |
| Pydantic, pydantic-settings | validation, settings | MIT |
| psycopg 3 | PostgreSQL driver | LGPL-3.0 |
| scikit-learn, NumPy | model training | BSD-3-Clause |
| PostgreSQL | database | PostgreSQL License |
| pytest, HTTPX | testing | MIT, BSD-3-Clause |
| Archify | diagrams | MIT |

## Known limitations (Sprint 1)

- **No end-user authentication yet.** JWT login is planned for Sprint 2. Until then, any client can call the member endpoints for a community. Admin endpoints are key-protected.
- Matching uses straight-line geometry (haversine detour and direction), not a road network.
- One commute per member (a morning trip to one destination); no return trips or recurring schedules yet.
- The connector model does not meet the quality bar on synthetic data (too few samples), so the connector role uses default weights plus the connectors-first rule.
- Simulation response probabilities are modelling assumptions. They demonstrate the mechanism, not real-world conversion rates.
- The engine clock (`current_day`) is advanced by `/day/close` or the simulator; there is no scheduler yet.

## Sprint status

| Sprint | Scope | Status |
|---|---|---|
| 1 | Engine (intelligence, scorer, clusters, matching, interventions, referrals, metrics), REST API, trained model + notebook, synthetic demo, tests, Docker | done |
| 2 | React app: member view (recommendations, nudges, invite), map, growth dashboard; JWT auth; public deployment | next |
| 3 | Hardening for Bug Bounty: rate limits, auth on every route, security pass; polish and pitch | planned |

---

# Repository Guidelines

Please follow these guidelines throughout the Bug Bounty event.

### 1. Branch Rules
- Each team must maintain a single repository with three branches: `main`, `bugbounty`, and `fixing`.
- `main` is for ongoing development, `bugbounty` is for deployment and peer testing, and `fixing` is for bug fixes.
- Keep `main` and `bugbounty` in sync until the Attack Phase begins.
- **Never delete the `bugbounty` or `fixing` branches.**

### 2. Attack Phase (12:00 AM – 2:00 AM)
- The `bugbounty` branch will be frozen at the start of the Attack Phase. No changes or commits are allowed to this branch after the phase begins.
- Only the code on the `bugbounty` branch will be deployed for peer testing.
- Development may continue on `main`.
- Test only assigned projects and follow the event's testing guidelines.

### 3. Fixing Phase (2:00 AM – 3:30 AM)
- **Create the `fixing` branch directly from `bugbounty`** at the start of the Fixing Phase. Do not create it from `main` or any other branch.
- Commit all bug fixes to the `fixing` branch only.
- Keep `bugbounty` frozen throughout the Fixing Phase and subsequent evaluation.
- All fixing work must stop when the Fixing Phase ends at 3:30 AM.
- **Do not make any commits to the `fixing` branch after the Fixing Phase ends.** Post-deadline commits may result in disqualification from the Bug Bounty round.
- Merge validated fixes into `main` only after the Fixing Phase ends.
- Update `bugbounty` only after the organizers explicitly announce that evaluation is complete and development may resume.

### 4. Bug Reporting Rules
- Each team may report a maximum of **10 bugs overall**, with a maximum of **4 bugs per target team**.
- Bug reports must be clear and reproducible.
- Report critical vulnerabilities or exposed data privately to the organizers.

### 5. Important
- **Do not modify the `bugbounty` branch after the Attack Phase begins.** Unauthorized changes may result in disqualification from the Bug Bounty round.
- **Do not commit to the `fixing` branch after the Fixing Phase ends at 3:30 AM.** Violations may result in disqualification from the Bug Bounty round.
- Do not modify another team's branches or attempt to bypass repository restrictions.
- Test only assigned projects and authorized accounts. Destructive testing, denial-of-service attacks, phishing, malware deployment, and attempts to access unrelated systems are prohibited.

All teams are expected to follow these rules strictly throughout the event.