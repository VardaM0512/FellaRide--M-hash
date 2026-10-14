# FellaRide

**Ignition Hackathon · PS Variant 1, "Community in Motion"**

FellaRide turns a community (a college, company, residential society, alumni network or professional group) into an active carpooling network. Drivers post rides with their real route, and riders along that route ask for a seat. Behind it, an activation engine finds likely drivers and riders, matches them, nudges the right people at the right time and learns from every outcome. **Every real ride in the app feeds that engine**, so the app and the organiser's dashboard are one system:

**Discover → Identify → Match → Nudge → Ride → Learn → Refer → Grow**

> **Result on synthetic data (40 days, same community, `POST /api/v1/demo/compare`):** compared with random nudges, the smart engine produced **1.9× more active users, 3.7× more completed rides, 1.5× more registrations and a 1.7× higher match rate** (deterministic: the same seeds give the same numbers on every run).

---

## Team

| | |
|---|---|
| Team name | _fill in_ |
| Members | _name: role_ (one per line) |
| Problem statement | PS Variant 1, Community in Motion |
| Repository | official event repository |

## Features

### Member app (riders and drivers)

| Feature | What it does |
|---|---|
| **Sign up** | Email, mobile, password, name and gender, plus an **optional join code**. With a code you join that community. Without one you join the main community set by `FELLARIDE_DEFAULT_JOIN_CODE` (the synthetic demo, `DEMO2026`, in `.env.example`), or else the open community for everyone. |
| **Sign in** | With email **or** mobile number, plus password. The session lasts 12 hours. |
| **Driving or riding?** | Home asks *"I'm driving"* or *"I need a ride"* **every time**. It is never fixed to the account. |
| **Offer a ride** | From and to (search a place, use your current location, or tap the map), leaving time and empty seats. |
| **Route confirmation** | Up to 3 real driving routes on the map. The driver picks and confirms one before posting. |
| **Nearby alerts** | Posting alerts everyone whose last known location is within **2.5 km of the route**. |
| **Find a ride** | Rides whose route passes near your pickup **and then** your drop, showing each driver's name, gender, rating, time, seats left and distance. You can filter by women or men drivers. |
| **Seat requests** | The rider asks for a seat. The driver sees the rider's name, gender, rating and pickup, then **approves or declines**. |
| **Car rules** | A full car auto-declines the remaining requests. A rider who is approved somewhere has their other requests withdrawn. Each person has one active ride at a time. |
| **Boarding code** | Everyone approved sees the **same 4-digit code** and checks it before getting in. |
| **"Who got in?"** | The driver picks each rider from a dropdown and taps **Got in**. |
| **Chat and call** | A group chat for the driver and approved riders. **Call** opens the phone dialer. Mobile numbers are shown only to people in the same ride. |
| **Driver updates** | One-tap messages ("I'm at the pickup point", "Running 5 min late"…) that every rider gets as a notification. |
| **Ending a ride** | The **driver** can end the ride for everyone at any time. A **rider** ends only their own part, unless they are the **last rider**, in which case the ride ends for everyone. The driver can cancel until someone is in the car. |
| **Ratings** | After the ride, everyone rates everyone they travelled with (1 to 5 stars and an optional note). A person's rating is a **recency-weighted average of their last 20 ratings**: each older rating counts 0.85× the one after it. |
| **Automatic penalties** | **1★** if the driver sets off more than 5 minutes before the posted time and an approved rider is left behind. **2★** for cancelling after approving someone. |
| **Reports** | Report anyone from a ride by choosing reasons from a list (multiple choice) and adding an optional note. Each report is filed under its most serious category (**Safety > Money or identity > Reliability > Behaviour > Other**) with a severity of high, medium or low. |
| **Notifications** | An in-app banner and an Alerts tab with an unread badge. **Phone notifications** come through a service worker when the app is in the background. |
| **You** | Profile (edit name, gender and mobile), rating, ride history, and notification and location settings. |
| **Invites** | Invite someone by name and email. You get a ready-made message with a sign-up link. They appear in your community straight away, and when they sign up with that email the invite counts for you. |
| **Suggestions you can act on** | The engine's nudges ("3 people head your way at 08:05. Offer a ride?") arrive in Alerts with a button: **Offer a ride**, **Find a ride** or **Invite people**. |
| **Demo community** | Sign in as any synthetic member in one tap. Gender and mobile are asked once. |

### Organiser dashboard (`/dashboard`)

- Community map with a **day slider**, showing members, co-rides, social ties and referrals over time.
- This-week numbers with sparklines, plus the activation funnel (joined → first interaction → first ride → repeat → referral).
- Today's nudges, hot commute corridors and the propensity model's learned weights.
- Operator buttons: **Plan nudges · Match · Next day · Simulate**.
- **Proof** page: the smart engine against random nudges on identical synthetic communities.
- **Member-app panel:**
  - rides live, completed and cancelled
  - riders carried, average rating and penalties
  - open reports by category, each of which can be marked reviewed
  - **send a notification to every member**
  - how much of the engine's numbers came from real app rides
- **Live:** numbers, funnel, map and model refresh every 20 seconds, so app activity shows up without a reload.

### Activation engine (ML)

| Part | What it does |
|---|---|
| Community intelligence | Builds member features: car, corridor density, recent rides, social degree and past response. It also finds **corridors**: same ~1.5 km home cell, same destination and same 30-minute window. A corridor is "hot" with 3+ members, including at least 1 driver and 1 rider. |
| Propensity scorer | Logistic regression for 4 roles: **driver, rider, connector, referrer**. It is trained offline (`scorer.pkl`) and **updated online** after every nudge answer and ride outcome. |
| Matching | Score = 0.40·route overlap + 0.25·(1 − detour/3 km) + 0.25·(1 − Δt/30 min) + 0.10·preference fit, with hard limits. Poorly rated partners rank lower. |
| Intervention engine | Priority = p(role) × corridor value × (1 − fatigue), with a daily budget and a 2-day cooldown. **Connectors go first** in days 0–4. |
| Referrals | Invite suggestions ranked by predicted rider propensity, plus a bonus for hot corridors. |
| Metrics | Active users, rides created and completed, match rate, completion rate, repeat rate, network connectivity, nudge response and referral conversion, with daily snapshots. |
| Simulator | Replays days on **synthetic** communities only. Used for the demo, for training and for the Proof comparison. |
| Activation bridge | Turns every member-app action into engine data: one member per user, first and repeat rides, co-ride edges, learning, nudge answers and referrals (see [How the member app feeds the engine](#how-the-member-app-feeds-the-engine)). |

### Platform and security

- A JWT bearer token on every route (except sign-in and sign-up), with bcrypt-hashed passwords and a rate limit on sign-in and sign-up.
- Strict community scoping: another community's data returns **404**. Members can only act as themselves, and only organisers can run the engine.
- Every request body is validated with pydantic. Errors come back as plain sentences and never include stack traces.
- Installable PWA, phone-first layout, dark mode and accessible labels.
- Docker Compose (API and PostgreSQL), with SQLite for local development.

## Architecture

[![FellaRide architecture](docs/architecture.svg)](docs/architecture.svg)

*Click the diagram to open it full size. To change it, edit `docs/build_architecture.py` and re-run it.*

Every line between two blocks is labelled with what it carries:

- **Black:** HTTPS API calls from the clients (JSON, Bearer JWT).
- **Dashed teal:** Python calls from routers into the engines.
- **Blue:** SQL to PostgreSQL.
- **Orange:** browser calls to the device and to OpenStreetMap.
- **Dashed purple:** the activation bridge, which turns app actions into engine data.
- **Dotted purple:** the offline ML artifact.

| Block | What it is | Built with |
|---|---|---|
| **Member app** | Phone-first PWA for riders and drivers | React 18, Vite, TypeScript, TanStack Query, React Router, Leaflet |
| **Organiser dashboard** | Community map, metrics, engine controls, reports, broadcast | Same app, `/dashboard` (organisers only) |
| **Service worker** | Shows phone notifications while the app is in the background | `public/sw.js` |
| **OpenStreetMap services** | Map tiles, place search (Nominatim) and driving routes (OSRM), called from the browser | Public servers |
| **Security layer** | CORS → JWT check → member or organiser check → community scoping → validation | FastAPI dependencies, PyJWT, bcrypt, pydantic |
| **API routers** | `account`, `trips` (`/trips`, `/me`, safety, organiser), `community`, `rides`, `engagement`, `insights` | FastAPI (`backend/app/api/`) |
| **Trip engine** | Proximity, seats and ride lifecycle, ratings, penalties, reports | `backend/app/engine/trips.py` |
| **Activation bridge** | The only link from app actions to the engine: members, lifecycle, co-ride edges, learning, nudges, referrals | `backend/app/engine/activation.py` |
| **Activation engine** | Intelligence, scorer, matching, interventions, referrals, metrics, simulator | `backend/app/engine/*`, `backend/app/sim/*` |
| **ML pipeline** | Offline training of the 4 role models | scikit-learn, `ml/train_scorer.py`, notebook |
| **Database** | Identity, member-app tables, activation-engine tables, learned weights | PostgreSQL 16 (SQLite locally), SQLAlchemy 2, psycopg 3 |

### A ride, call by call

```mermaid
sequenceDiagram
  autonumber
  actor D as Driver (member app)
  actor R as Rider (member app)
  participant OSM as OpenStreetMap<br/>Nominatim · OSRM
  participant API as FastAPI /api/v1
  participant ENG as Activation engine<br/>(via the bridge)
  participant DB as PostgreSQL

  R->>API: GET /trips/search?from_lat&from_lon&to_lat&to_lon
  API->>DB: UPDATE profiles.last_lat/lon (pickup = known location)
  D->>OSM: GET /search?q=… then GET /route/v1/driving/…?alternatives=3
  D->>API: POST /trips {from, to, depart_at, route, seats}
  API->>DB: INSERT trips (4-digit code) · INSERT alerts for users ≤ 2.5 km from route
  API->>ENG: on_trip_posted → driver interacted · a recent nudge counts as answered
  R->>API: GET /me/alerts (every 8 s) → "Ride near you"
  R->>API: POST /trips/{id}/request {pickup}
  API->>DB: INSERT trip_seats (pending) · INSERT alerts (driver)
  API->>ENG: on_seat_requested → rider interacted
  D->>API: GET /trips/{id} (every 5 s) → name · gender · rating
  D->>API: POST /trips/{id}/seats/{s}/approve
  API->>DB: UPDATE trip_seats → approved · withdraw rider's other requests
  R->>API: GET /trips/{id} → boarding code · driver mobile
  R->>API: POST /trips/{id}/messages (chat) · tel: call
  D->>API: POST /trips/{id}/notify "Running 5 min late"
  D->>API: POST /trips/{id}/seats/{s}/board ("Got in")
  D->>API: POST /trips/{id}/start
  R->>API: POST /trips/{id}/end
  API->>DB: seat → dropped · last rider ends the trip · early start + rider left behind → 1★
  API->>ENG: on_trip_finished → first / repeat ride · co-ride edge · driver + rider models learn
  R->>API: POST /trips/{id}/ratings · POST /reports
  D->>API: POST /trips/{id}/ratings
  API->>DB: INSERT ratings · reports (category, severity)
  API->>ENG: on_rating → the author's role model learns
```

## How the member app feeds the engine

Every member-app action goes through one module, `backend/app/engine/activation.py`.

- Engine data is stamped with the community's engine day, so app rides and simulated rides count the same way.
- Each step is idempotent: a ride is never counted twice.
- Each step runs in a database savepoint. If it fails, its own writes are undone and the error is logged, but the ride action still succeeds.

| In the app | What changes in the engine (and on the dashboard) |
|---|---|
| Sign up **with a join code** | A member is created and **registered** (funnel: Joined). Home starts at the community centre and the destination at its first one, until your first ride sets real ones. |
| Sign up **with an email someone invited, or an organiser imported** | That **existing member is claimed** instead of duplicated (Discover → Register). A pending invite converts: the invite shows *joined* and the inviter becomes a **referrer** (funnel: Brought someone in; graph: referral edge). |
| Sign up **without a code** | With `FELLARIDE_DEFAULT_JOIN_CODE` set: the same as with that code (registered straight away, on that dashboard). Otherwise you join the open community, and your member is created at your first ride, with a destination made from your drop point. |
| **Post a ride** | Member registered if needed, marked as a driver, **first interaction**. Home, destination and time follow this ride. |
| **Ask for a seat** | Member registered if needed, **first interaction**, commute from your pickup and the ride's drop. |
| Either of those within 2 days of a **nudge** | The nudge counts as **answered**: the role model learns, and nudge response goes up. No duplicate engine ride is made. The nudge alert is marked read. |
| **Ride ends** with riders on board | Driver and riders get a **first or repeat ride** (funnel, active users, repeat rate), a **co-ride edge** between every pair (growth graph, connectivity), and positive examples for the driver and rider models. Rides created and completed and the match rate include it. |
| Approved rider **left behind**, or ride **cancelled** after approving someone | A weak negative example for the driver model. A cancelled ride counts in the completion rate; an ended ride with nobody on board counts in neither. |
| **Rate** someone | The author's role model learns (like engine ride feedback). App ratings and penalties also change how partners rank in matching. |
| **Invite** someone | They become a **discovered** member (funnel: Found) with a pending referral, until they sign up with that email. |

The organiser's numbers keep their meaning. `GET /tenants/{t}/metrics` also returns `by_source: {engine, app}`, so you can see what came from real app use.

### Demo: watch the dashboard move (5 minutes)

1. **Organiser:** sign in as `admin@demo.fellaride.app` / `fellaride-demo-admin`. Note the funnel numbers, active users, completed rides and the model weights.
2. **Driver** (incognito window): **Create an account** with join code `DEMO2026`. The funnel's *Joined* goes up within 20 seconds.
3. **Rider** (second incognito window): create an account with `DEMO2026` too.
4. **Driver:** **I'm driving** → from `Koramangala` → to `Whitefield` → leaving now → confirm the fastest route → post.
5. **Rider:** **I need a ride** → pickup `Domlur` → drop `Marathahalli` → **Ask for a seat**.
6. **Driver:** **Approve** → *Who got in?* → the rider → **Got in** → **End ride for everyone**.
7. **Organiser:** within 20 seconds:
   - *First ride done* goes up by 2, and *people rode this week* by 2.
   - Shared rides completed goes up by 1.
   - A new co-ride line joins the two on the map.
   - The model panel shows new updates.
   - The member-app panel shows "1 of N completed rides came from the app".
8. **Invites:** the driver opens **Invite** and invites `friend@test.com`. On the dashboard, *Found* goes up by 1. Sign up as that email (with `DEMO2026`), and the invite shows **Joined** and the driver counts as *Brought someone in*.
9. **Nudges:** the organiser clicks **Plan nudges**. The app users get a suggestion in Alerts with a button. Posting a ride or asking for a seat right after counts as the answer.

## How the PS requirements are met

| PS requirement | How we solve it | Where |
|---|---|---|
| Member profiles | Location, destination, departure time, car and seats, preferences, activity, social ties; in the app: name, gender, rating | `engine/context.py`, `profiles` |
| Score likely drivers, riders, connectors, referrers | Logistic-regression propensity model, trained offline and updated online after every outcome | `engine/scorer.py`, `ml/` |
| Match on route, pickup distance, timing, capacity, preferences | Weighted match score with hard limits; in the app, routes must pass the rider's pickup and then drop | `engine/matching.py`, `engine/trips.py` |
| High-potential ride clusters | Corridors (home cell + destination + 30-minute window), "hot" when supply meets demand | `engine/context.py` |
| Recommend partners automatically | Ranked partners per member; nearby-ride alerts in the app | `GET …/recommendations`, `notify_nearby` |
| Targeted nudges, right person and time | Intervention engine with priority, budget and cooldown | `engine/interventions.py` |
| Connectors as early adopters | Connectors first in days 0–4 | `engine/interventions.py` |
| Referrals to likely participants | Invite suggestions ranked by rider propensity and corridor | `engine/referrals.py` |
| Activation funnel | registration → first interaction → first ride → repeat ride → referral | `GET …/metrics/funnel` |
| Learn from successful and failed matches | Nudge answers, completed (+) and cancelled (−) rides and ratings update the weights | `engine/scorer.py`, `engine/rides.py` |
| Growth graph over time | Social ties, co-rides and referrals, each with a start day | `GET …/graph` |
| Success metrics | Active users, rides, match, completion and repeat rates, connectivity, nudge response, referral conversion | `GET …/metrics`, `…/timeseries` |
| Trust and safety | Ratings weighted by recency, automatic penalties, categorised reports, boarding code, numbers shared only within a ride | `engine/trips.py` |

## Project structure

```
backend/
  app/
    main.py          API entry, CORS, error handler, demo seeding, open community
    auth.py          bcrypt, JWT, who-may-do-what checks, sign-in rate limit
    config.py        settings from environment variables
    models.py        database tables
    schemas.py       validated request bodies
    api/             account, trips (member app), community, rides, engagement, insights
    engine/          trips (member app), activation (app -> engine bridge) + context, scorer, matching,
                     interventions, referrals, rides, lifecycle, metrics, daycycle
    sim/             SYNTHETIC community generator + behaviour replay (demo and training only)
  ml/train_scorer.py              trains models/scorer.pkl
  notebooks/scorer_training.ipynb training + inference notebook (executed)
  models/scorer.pkl               trained model loaded by the API
  tests/                          pytest suite
frontend/
  src/member/        member app screens (Home, Offer, Find, Trip, Alerts, You)
  src/dashboard/     organiser dashboard, Proof, member-app panel
  src/components/    map (Leaflet), place field, shared UI
  public/sw.js       service worker for phone notifications
docs/
  architecture.svg           the diagram above
  build_architecture.py      draws it (no dependencies)
```

## Supported environments

- Linux, macOS or Windows with Python 3.11+ (developed on 3.13), **or** Docker 24+ with Docker Compose v2.
- Node.js 18+ for the frontend.
- Any modern browser. Phone notifications and "use my location" need **https or localhost**.

## Install and run

### Backend, option A: Docker (PostgreSQL)
```bash
cp .env.example .env              # then set POSTGRES_PASSWORD and FELLARIDE_JWT_SECRET
docker compose up --build
# API http://localhost:8000 · interactive docs http://localhost:8000/docs
```

### Backend, option B: local Python (SQLite)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local        # only VITE_API_URL; no keys in the frontend
npm run dev                       # member app http://localhost:5173 · dashboard http://localhost:5173/dashboard
```

### Retrain the model (optional)
```bash
cd backend
python -m ml.train_scorer --runs 6 --days 30          # writes models/scorer.pkl and models/scorer.json
```

### Regenerate the architecture diagram
```bash
python docs/build_architecture.py                      # writes docs/architecture.svg
```

## Deployment and access

- **Public URL:** _add after deployment_. Use Render, Railway or any Docker host: build `backend/Dockerfile` and set the environment variables below. The container listens on `$PORT` (default 8000).
- On first start the API creates a **synthetic demo community** (join code `DEMO2026`, 14 replayed days) and the **open community** for people who sign up without a code.

| Who | How to sign in | What you can do |
|---|---|---|
| Demo organiser | `admin@demo.fellaride.app` / `fellaride-demo-admin` (or `FELLARIDE_DEMO_ADMIN_PASSWORD`) | Dashboard, engine controls, Proof, reports, broadcast |
| Your own account | App → **Create an account** (join code optional; `DEMO2026` for the demo community) | The full member app: drive, ride, chat, rate, report |
| Any demo member | App → **Try the demo community** → tap a person | The member app as that synthetic person |

Every API route except sign-in, sign-up, the public community list and demo sign-in needs `Authorization: Bearer <token>`.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `FELLARIDE_DATABASE_URL` | SQLite file in `backend/` | e.g. `postgresql+psycopg://user:pass@host:5432/fellaride` |
| `POSTGRES_USER`, `POSTGRES_PASSWORD` | `fellaride`, none | Used by docker-compose |
| `FELLARIDE_JWT_SECRET` | random per start | Signs login tokens. **Set a long random value in any shared deployment.** |
| `FELLARIDE_JWT_EXPIRE_HOURS` | `12` | How long a sign-in lasts |
| `FELLARIDE_DEMO_ADMIN_PASSWORD` | `fellaride-demo-admin` | Password of the seeded demo organiser |
| `FELLARIDE_DEMO_LOGIN` | `true` | One-tap sign-in as synthetic demo members |
| `FELLARIDE_AUTH_RATE_LIMIT` | `30` | Sign-in and sign-up attempts per IP per 10 minutes |
| `FELLARIDE_ADMIN_KEY` | empty | Optional operator key for scripts (`X-Admin-Key`) |
| `FELLARIDE_CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Allowed frontend origins |
| `FELLARIDE_SEED_DEMO_DAYS` | `14` | Days replayed for the demo community (0 = off) |
| `FELLARIDE_DEFAULT_JOIN_CODE` | empty (`.env.example`: `DEMO2026`) | Community for sign-ups without a code; `DEMO2026` puts real people next to the synthetic members on the demo dashboard |
| `FELLARIDE_NUDGE_BUDGET_PER_DAY` | `14` | Maximum nudges per community per day |
| `FELLARIDE_NUDGE_COOLDOWN_DAYS` | `2` | Minimum days between nudges to one member |
| `FELLARIDE_MAX_DETOUR_KM` | `3.0` | Engine matching: maximum pickup detour |
| `FELLARIDE_MAX_TIME_GAP_MIN` | `30` | Engine matching: maximum departure-time difference |
| `FELLARIDE_LEARNING_RATE` | `0.35` | Online learning step size |
| `VITE_API_URL` (frontend) | `http://localhost:8000` | Where the frontend finds the API |

`.env.example` contains safe placeholders. Never commit `.env`.

## Database

Tables are created automatically on startup. Sprint 3 only **added** tables, and the activation bridge needs **no schema change** (it uses existing columns and `events`), so existing databases keep working. Seats have one new status value, `cancelled` (approved, then the driver cancelled). To reset everything, run `docker compose down -v`, or delete `backend/fellaride.db` locally.

| Group | Tables |
|---|---|
| Identity | `tenants`, `destinations`, `users`, `profiles` |
| Member app | `trips`, `trip_seats`, `trip_messages`, `ratings`, `reports`, `alerts` |
| Activation engine | `members`, `connections`, `ride_offers`, `ride_requests`, `bookings`, `interventions`, `referrals`, `events`, `notifications`, `ride_feedback`, `daily_metrics` |
| Learning | `model_states` (learned weights per community), `synthetic_traits` (simulator only) |

## API reference (prefix `/api/v1`)

| Group | Endpoints |
|---|---|
| Account | `POST /auth/signup` · `POST /auth/login` (email or mobile) · `POST /auth/demo-login` · `GET /auth/me` · `GET /join/{code}` · `GET /tenants/{t}/demo-accounts` · `POST /auth/register` (engine commute sign-up) |
| Me | `PUT /me/profile` · `POST /me/location` · `GET /me/trips` · `GET /me/alerts` · `POST /me/alerts/read` · `GET /me/invites` · `POST /me/invites` |
| Rides (member app) | `POST /trips` · `GET /trips/search` · `GET /trips/{id}` · `POST /trips/{id}/request` · `/withdraw` · `/start` · `/end` · `/cancel` · `POST /trips/{id}/seats/{s}/approve` · `/reject` · `/board` |
| Chat and updates | `GET /trips/{id}/messages` · `POST /trips/{id}/messages` · `POST /trips/{id}/notify` |
| Trust | `POST /trips/{id}/ratings` · `POST /reports` · `GET /report-reasons` |
| Organiser | `GET /tenants/{t}/trips-overview` · `POST /tenants/{t}/broadcast` · `POST /tenants/{t}/reports/{r}/review` |
| Community | `POST /tenants` · `GET /tenants` · `GET /tenants/{t}` · `POST /tenants/{t}/members/import` · `POST /tenants/{t}/members/{m}/register` |
| Intelligence | `GET /tenants/{t}/members` · `GET /tenants/{t}/members/{m}` · `GET /tenants/{t}/clusters` · `GET /tenants/{t}/members/{m}/recommendations` |
| Engine rides | `POST /tenants/{t}/rides/offers` · `/requests` · `/requests/{q}/cancel` · `/match` · `GET /tenants/{t}/rides` · `POST …/offers/{o}/start` · `/finish` · `POST …/bookings/{b}/feedback` |
| Nudges and referrals | `POST /tenants/{t}/interventions/plan` · `GET …/interventions` · `POST …/interventions/{i}/respond` · `GET …/members/{m}/invite-suggestions` · `POST …/referrals` · `POST …/referrals/{r}/accept` |
| Insights | `GET /tenants/{t}/metrics` · `/metrics/funnel` · `/metrics/timeseries` · `/graph` · `/model` |
| Demo (organiser) | `POST /tenants/demo` · `POST /tenants/{t}/simulate` · `POST /tenants/{t}/day/close` · `POST /demo/compare` |

Full, interactive details are at `/docs` on the running API.

## Tests

```bash
cd backend
pytest -q          # 33 tests
```

They cover the following.

**Activation engine:**
- the matching rules and the online learner
- the full engine loop (import → recommend → nudge → match → ride → refer → metrics)
- instant matching and feedback
- demo seeding
- the claim that the smart engine beats random nudges

**Security:**
- sign-in on every route
- members unable to act as someone else
- organiser-only routes
- cross-community isolation
- input validation

**Member app:**
- sign-up without a code and sign-in by mobile
- nearby alerts and route-order search
- approve, board and end (the last rider ends the ride)
- chat and driver updates
- recency-weighted ratings and the early-leave and cancel penalties
- full cars
- reports and their categories
- broadcast

**Activation bridge:**
- a live app ride moves the funnel, KPIs, growth graph and model weights
- a second ride makes both people repeat riders, and ratings teach the model
- a member and destination are created in the open community at the first ride
- an imported member is claimed by email and the referral converts
- an app invite converts when the invitee signs up
- a ride after a nudge answers it without creating engine rides
- each ride is counted once per person, even across a rider ending first, a double end and a repeated hook
- cancelled and unfilled rides add no rides
- one community's ride never changes another's numbers
- a failing bridge never breaks the ride action, and its partial writes are undone

## Data disclosure: synthetic data

All demo and training data is **synthetic**. The synthetic community (`app/sim/synthetic.py`) has 180 generated members with generic first names plus an initial, `@example.edu` emails, and generated coordinates around a synthetic centre point. Synthetic records are flagged `synthetic: true` in every API response. Each synthetic member's hidden behaviour (`synthetic_traits`) is read only by the simulator, never by the engine. Data entered by real users (name, gender, mobile, rides) is stored only in this deployment's database.

## AI tools used

| Tool | Purpose |
|---|---|
| Claude (Anthropic) | Planning, architecture, backend and frontend code generation (Sprints 1–3), tests, documentation, the architecture diagram generator |
| Archify (open-source, MIT) | Sprint 1 only: earlier animated diagrams. Not used for the current diagrams. |

Every team member is expected to be able to explain, modify and debug every part of this code (rule §1).

## Third-party resources

| Resource | Use | License |
|---|---|---|
| FastAPI, Uvicorn | Web framework, server | MIT, BSD-3-Clause |
| SQLAlchemy, psycopg 3 | ORM, PostgreSQL driver | MIT, LGPL-3.0 |
| Pydantic, pydantic-settings | Validation, settings | MIT |
| PyJWT, bcrypt | Tokens, password hashing | MIT, Apache-2.0 |
| scikit-learn, NumPy | Model training | BSD-3-Clause |
| PostgreSQL | Database | PostgreSQL License |
| pytest, HTTPX | Testing | MIT, BSD-3-Clause |
| React, React Router, TanStack Query | Frontend UI, routing, data fetching | MIT |
| Leaflet | Interactive map | BSD-2-Clause |
| OpenStreetMap tiles and data | Map images, places | ODbL (© OpenStreetMap contributors) |
| Nominatim, OSRM (public servers) | Place search, driving routes | GPL-2.0 and BSD-2-Clause software; each server's usage policy applies |
| Framer Motion | Day-slider animation | MIT |
| Vite, TypeScript | Build tooling | MIT, Apache-2.0 |
| Mermaid (rendered by GitHub) | Ride sequence diagram | MIT |
| Anek Latin, Atkinson Hyperlegible (Google Fonts) | Typefaces | OFL-1.1 |

## Known limitations

- **Alerts arrive by polling** (every 8 seconds). There is no push server, so phone notifications show only while the browser keeps the app alive, and they need https or localhost.
- **Calling uses the phone's dialer** (`tel:` link), not voice inside the app.
- **"Near you" uses your last known location:** your latest search, posted ride or shared location. There is no live GPS tracking.
- **Maps, search and routes use the public OpenStreetMap servers**, which are rate-limited and meant for light use. Self-host them or use a paid provider in production. If routing is unreachable, a straight line is used.
- **The boarding code confirms the right car, not identity.** IDs aren't verified.
- **The open community has no organiser.** Its reports can be reviewed with the operator key (`X-Admin-Key`).
- **The engine day only advances with Next day or Simulate.** All live app rides land on the community's current engine day until the organiser moves it on. The open community has no organiser, so its day stays at 0.
- **Any ride action answers a recent nudge**, whatever the nudge suggested, and the model learns for the nudge's role.
- **An invited person is assumed to commute like the inviter** until their own first ride.
- An approved seat that the rider later withdraws doesn't count as matched.
- **Demo sign-in is intentionally open** for the synthetic community (`FELLARIDE_DEMO_LOGIN`). Turn it off for a real community.
- Login tokens are kept in the browser's local storage.
- The engine's matching uses straight-line geometry, models one commute per member, and uses default weights for connectors (too few samples). Simulated response rates are modelling assumptions.
- The engine clock (`current_day`) advances with `/day/close` or the simulator; there is no scheduler yet.

## Sprint status

| Sprint | Scope | Status |
|---|---|---|
| 1 | Engine (intelligence, scorer, clusters, matching, interventions, referrals, metrics), REST API, trained model and notebook, synthetic demo, tests, Docker | done |
| 2 | Mobile-first React app, JWT sign-in, instant matching, ride feedback, community map with day slider, dashboard, Proof page | done |
| 3 | Member app rebuilt around posted rides: optional join code, driving-or-riding each time, route confirmation, nearby alerts, approve or decline, boarding code, got-in dropdown, chat, call, ending from either side, recency-weighted ratings and penalties, categorised reports, notifications, organiser broadcast | done |
| 3b | Activation bridge: every member-app action feeds the engine (funnel, KPIs, graph, learning, nudges, referrals), claim by email, in-app invites, live dashboard | done |
| 4 | Bug Bounty hardening, security pass, public deployment, pitch | planned |
