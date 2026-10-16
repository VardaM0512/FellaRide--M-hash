# FellaRide

**Ignition Hackathon · PS Variant 1, "Community in Motion"**

FellaRide turns a community (a college, company, residential society, alumni network or professional group) into an active carpooling network. Drivers post rides with their real route, and riders along that route ask for a seat. Behind it, an activation engine finds likely drivers and riders, matches them, nudges the right people at the right time and learns from every outcome. **Every real ride in the app feeds that engine**, so the app and the organiser's dashboard are one system:

**Discover → Identify → Match → Nudge → Ride → Learn → Refer → Grow**

> **Result on synthetic data (40 days, same community, `POST /api/v1/demo/compare`):** compared with random nudges, the smart engine produced **1.9× more active users, 3.7× more completed rides, 1.5× more registrations and a 1.7× higher match rate** (deterministic: the same seeds give the same numbers on every run).

---

## Team

| | |
|---|---|
| Team name | suresh430 |
| Members | _name: role_ (one per line) |
| Problem statement | PS Variant 1, Community in Motion |
| Repository | [github.com/Manipal-Hackathon-2026/suresh430](https://github.com/Manipal-Hackathon-2026/suresh430) |

## Features

### Member app (riders and drivers)

| Feature | What it does |
|---|---|
| **Sign up** | Email, mobile, password, name and gender, plus an **optional join code**. With a code you join that community. Without one you join the main community set by `FELLARIDE_DEFAULT_JOIN_CODE` (the synthetic demo, `DEMO2026`, in `.env.example`), or else the open community for everyone. |
| **Sign in** | With email **or** mobile number, plus password. The session lasts 12 hours. There is no password reset (see Known limitations). |
| **Driving or riding?** | Home asks *"I'm driving"* or *"I need a ride"* **every time**. It is never fixed to the account. |
| **Offer a ride** | From and to (search a place, use your current location, or tap the map), leaving time, empty seats and your car (model, colour, number plate; saved for next time). Riders see the model and colour; only approved riders see the number plate. |
| **Route confirmation** | Up to 3 real driving routes on the map. The driver picks and confirms one before posting. |
| **Nearby alerts** | Posting alerts everyone whose last known location is within **2.5 km of the route**. |
| **Find a ride** | Every ride whose route passes near your pickup **and then** your drop, showing each driver's name, gender, rating, car, time, seats left and distance. Filter by female or male drivers, sort by closest, soonest or top rated, and ask **several drivers at once**: the first to approve gets you and the other requests are withdrawn. |
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
| **You** | Profile (edit name, gender and mobile), your car, rating, ride history, notification and location settings, and **Delete my account** (confirmed with your password: open rides are cancelled, personal details removed, past rides kept as "Deleted user"). |
| **Community** | This week's shared challenge, what the community has achieved together (rides, km shared, estimated CO2 saved), a board where members post, react and reply, live ride activity, a friendly leaderboard, and each member's own impact and badges. |
| **Refer friends** | Your personal **referral code and link** (share on WhatsApp, the share sheet, or copy). Anyone who signs up with it joins your community and is credited to you; so is anyone who signs up with an email you invited. **+10 points** when a friend joins, **+40** when they take their first shared ride. Tiers count friends who actually rode: Bronze at 1, Silver at 3, Gold at 10. You see each friend's stage (joined, first ride done) and the community's top referrers; the organiser dashboard shows referral sign-ups, first-ride rate and top referrers. |
| **Invites** | Invite someone by name and email. You get a ready-made message with a sign-up link. They appear in your community straight away, and when they sign up with that email the invite counts for you. |
| **Suggestions you can act on** | The engine's nudges ("3 people head your way at 08:05. Offer a ride?") arrive in Alerts with a button: **Offer a ride**, **Find a ride** or **Invite people**. |
| **Demo community** | Sign in as any synthetic member in one tap. Gender and mobile are asked once. |

### Organiser dashboard (`/dashboard`)

The same app shell as the member app: a dark sidebar where each page is a station (Community · Run it · Grow it), bottom tabs on phones. The demo community is **Banyan Grove University**, with a neighbour, **Silverline Tech Park**. Both are made-up names and both are synthetic.

- **Overview:** a "today" band (the day, shared rides, joined, match and repeat rates, rides per day for the last week) with the engine's buttons (**Plan nudges · Match · Next day · Simulate 7 days**), eight key numbers with their change over 7 days, **Needs your attention** (open reports, members who haven't ridden, routes short of drivers, low nudge response), the join funnel, busiest routes, word of mouth, and a **live activity feed**.
- **Live map** (`/dashboard/map`): members on real streets (OpenStreetMap). Play or drag the day to watch the community grow; shared rides drawn as threads to the destination, invites as dashed lines, busy routes as halos. Filter drivers or riders, toggle layers, find a member by name, jump to a busy route. A list view shows the same data.
- **Members** (`/dashboard/members`): everyone on the roster by stage, with search, filters (role, area), sorting and **CSV export**. A profile sheet shows the person's journey, commute, likelihood scores and best ride partners.
- **Impact** (`/dashboard/impact`): CO₂ kept out of the air, trees' worth, km not driven, car trips avoided and money not spent on solo trips; CO₂ saved day by day; the routes it came from; how it's counted. **Download report** prints a clean one-page-per-section PDF for a college or sponsor.
- **Live rides** (`/dashboard/live`): every ride on the road now, cars moving along real roads, picking riders up and heading to the destination, with a list of each ride's status, progress and riders. Real communities show member-app rides that have set off or leave within 30 minutes (at the driver's live position when shared). The demo community has nobody really driving, so it **replays the engine's most recent rides on a 10-minute loop, labelled Simulated** everywhere.
- **Rides & safety** (`/dashboard/rides`): member-app rides, ratings and penalties; the reports queue (open / reviewed, by category) with **Pause account** on each report (no new rides until lifted; rides under way carry on; the member is told why); paused accounts; where rides come from (app vs engine).
- **Announcements** (`/dashboard/announce`): send a notification to everyone, drivers, riders, or members who haven't shared a ride yet, with templates, a phone preview, and the history of what was sent with how many people have read each one.
- **Pricing** (`/dashboard/pricing`): the community's cost-sharing rates.
- **Engine** (`/dashboard/engine`): run the day, today's nudges and why, what predicts a yes, busiest routes.
- **Expansion** (`/dashboard/expansion`): why growth is slowing, where to grow (with next week's forecast), neighbouring communities worth connecting, the actions the engine took and how they worked. **Run engine** and, on synthetic communities, **Autopilot 5 days**.
- **Proof** (`/dashboard/proof`): the smart engine against random nudges on identical synthetic communities.
- **Settings** (`/dashboard/settings`): rename the community, the join code with a sign-up link, invite message and WhatsApp share, appearance, sign out.
- **Live:** numbers, map, reports and the activity feed refresh every 15 to 20 seconds, so app activity shows up without a reload.

### Activation engine (ML)

| Part | What it does |
|---|---|
| Community intelligence | Builds member features: car, corridor density, recent rides, social degree and past response. It also finds **corridors**: same ~1.5 km home cell, same destination and same 30-minute window. A corridor is "hot" with 3+ members, including at least 1 driver and 1 rider. |
| Propensity scorer | Logistic regression for 4 roles: **driver, rider, connector, referrer**. It is trained offline (`scorer.pkl`) and **updated online** after every nudge answer and ride outcome. |
| Matching | Score = 0.40·route overlap + 0.25·(1 − detour/3 km) + 0.25·(1 − Δt/30 min) + 0.10·preference fit, with hard limits. Poorly rated partners rank lower. |
| Intervention engine | Priority = p(role) × corridor value × (1 − fatigue), with a daily budget and a 2-day cooldown. **Connectors go first** in days 0–4. In real communities, 15% of each day's nudges go to random members (strategy `explore`), so the model keeps getting unbiased labels. |
| Network Expansion Engine | Splits the community into ~1.5 km zones, each with supply, demand, unmet demand, empty seats, lapsed riders and untapped roster, plus a 7-day trend forecast. Adjacent high-opportunity zones merge into expansion areas. Each area's bottleneck maps to a growth action (nudging the right joined members), judged 2 days later; a Beta posterior per action type picks the next one. It also finds corridors shared with neighbouring communities. Non-members and other communities are only counted per zone, and counts below 3 are hidden. |
| Referrals | Invite suggestions ranked by predicted rider propensity, plus a bonus for hot corridors. |
| Metrics | Active users, rides created and completed, match rate, completion rate, repeat rate, network connectivity, nudge response and referral conversion, with daily snapshots. |
| Simulator | Replays days on **synthetic** communities only. Used for the demo, for training and for the Proof comparison. |
| Activation bridge | Turns every member-app action into engine data: one member per user, first and repeat rides, co-ride edges, learning, nudge answers and referrals (see [How the member app feeds the engine](#how-the-member-app-feeds-the-engine)). |

### Platform and security

- A JWT bearer token on every route (except sign-in and sign-up), with bcrypt-hashed passwords and a rate limit on sign-in and sign-up.
- Strict community scoping: another community's data returns **404**. Members can only act as themselves, and only organisers can run the engine.
- Every request body is validated with pydantic. Errors come back as plain sentences and never include stack traces.
- Installable PWA, phone-first layout, dark mode and accessible labels.
- Docker Compose runs the API and the web app, against Supabase or an optional local PostgreSQL. SQLite for local development without Docker.
- Render Blueprint (`render.yaml`) deploys the API and the web app as two Docker services. See [DEPLOY.md](DEPLOY.md).

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
| **Organiser dashboard** | Overview, live map, members, rides & safety, announcements, pricing, engine, expansion | Same app, `/dashboard` (organisers only) |
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

1. **Organiser:** sign in as `admin@demo.fellaride.app` / `vndFlmbbXm5ESSiEvW-vfKC3`. Note the funnel numbers, active users, completed rides and the model weights.
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

## Business model

**The organisation pays; members ride free.** The buyer is the organiser (a company, college, tech park or housing society), who already gets the dashboard, engine, nudges and expansion tools.

| Stream | Who pays | How | When |
|---|---|---|---|
| Community subscription | Companies, colleges, tech parks | Monthly fee per **active** member (someone who rode or drove), so they pay for results | From launch |
| Free tier | Small communities (a society, a club) | Free up to a member limit | From launch |
| Cost-sharing fee | Riders | Riders split fuel with the driver in the app; FellaRide keeps a small share | After in-app payments |
| Commute and emissions reports | Companies | Paid add-on: rides shared and car trips avoided, for commute-emissions reporting | Once real ride data exists |

Organisations save on parking, shuttles and commute benefits, and get commute-emissions data. Members ride free at first, because charging riders early would slow the network effect the engine is built to create.

## Project structure

```
backend/
  app/
    main.py          API entry, CORS, error handler, demo seeding, open community
    auth.py          bcrypt, JWT, who-may-do-what checks, sign-in rate limit
    config.py        settings from environment variables
    models.py        database tables
    schemas.py       validated request bodies
    api/             account, trips (member app), community, rides, engagement, insights,
                     expansion, social (community board)
    engine/          trips (member app), activation (app -> engine bridge) + context, scorer, matching,
                     interventions, referrals, rides, lifecycle, metrics, daycycle, expansion
    sim/             SYNTHETIC community generator + behaviour replay (demo and training only)
  ml/train_scorer.py              trains models/scorer.pkl
  notebooks/scorer_training.ipynb training + inference notebook (executed)
  models/scorer.pkl               trained model loaded by the API
  tests/                          pytest suite
  Dockerfile                      API image (listens on $PORT)
frontend/
  src/member/        member app screens (Home, Offer, Find, Trip, Alerts, Community, Invite, You)
  src/dashboard/     organiser dashboard: shell (OrgLayout), Overview, Live map, Members, Rides & safety,
                     Announcements, Pricing, Engine, Expansion, Proof, Settings
  src/components/    map (Leaflet), place field, shared UI
  public/sw.js       service worker for phone notifications
  Dockerfile         Vite build served by nginx (nginx.conf.template)
docs/
  architecture.svg           the diagram above
  build_architecture.py      draws it (no dependencies)
  judging/                   team playbook and Round 1 demo script
docker-compose.yml           API + web app, optional local PostgreSQL (--profile localdb)
render.yaml                  Render Blueprint: fellaride-api and fellaride-web
DEPLOY.md                    how to run in Docker and deploy to Render with Supabase
```

## Supported environments

- Linux, macOS or Windows with Python 3.11+ (developed on 3.13), **or** Docker 24+ with Docker Compose v2.
- Node.js 18+ for the frontend.
- Any modern browser. Phone notifications and "use my location" need **https or localhost**.

## Install and run

### Option A: everything in Docker (API and web app)
```bash
cp .env.example .env              # set FELLARIDE_JWT_SECRET; FELLARIDE_DATABASE_URL = your Supabase link
docker compose up --build         # API and web app, using the database in FELLARIDE_DATABASE_URL
# no Supabase? remove FELLARIDE_DATABASE_URL from .env and start a local PostgreSQL too:
docker compose --profile localdb up --build
# web app http://localhost:3000 · API http://localhost:8000 · interactive docs http://localhost:8000/docs
```
The web image is a Vite build served by nginx. `VITE_API_URL` is built into it, so set it before building.

### Option B: local Python (SQLite) and the Vite dev server

Backend:
```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

Frontend:
```bash
cd frontend
npm install
cp .env.example .env.local        # only VITE_API_URL; no keys in the frontend
npm run dev                       # member app http://localhost:5173 · dashboard http://localhost:5173/dashboard
```

Without a `.env`, people who sign up without a join code land in the open community, not the demo one, so they won't see the demo community's rides. For a demo, either always use join code `DEMO2026`, or put `FELLARIDE_DEFAULT_JOIN_CODE=DEMO2026` in `backend/.env`.

### Retrain the model (optional)
```bash
cd backend
python -m ml.train_scorer --runs 6 --days 30          # writes models/scorer.pkl and models/scorer.json
python -m ml.train_scorer --source real               # retrain on answered nudges in FELLARIDE_DATABASE_URL
```
Real-data training pools answered nudges from every real community and holds out the newest 25%. Real
communities get the labels it needs: unanswered nudges expire as a no when the cooldown ends, 15% of each day's
nudges go to random members (strategy `explore`), and the day clock follows the calendar.

### Regenerate the architecture diagram
```bash
python docs/build_architecture.py                      # writes docs/architecture.svg
```

## Deployment and access

- **Public URL:** **https://fellaride-web.onrender.com** (organiser dashboard: https://fellaride-web.onrender.com/dashboard · API: https://fellaride-api.onrender.com, docs at `/docs`). Free hosting sleeps after 15 minutes idle, so the first visit can take about a minute.
- **Render (recommended):** `render.yaml` is a Blueprint for two free Docker services in Singapore, `fellaride-api` (`backend/Dockerfile`) and `fellaride-web` (`frontend/Dockerfile`). The database is Supabase. Step-by-step instructions are in [DEPLOY.md](DEPLOY.md). Free Render services sleep after 15 minutes idle and Supabase free pauses after 7 days idle, so open both before a demo.
- **Any other Docker host:** build both Dockerfiles and set the environment variables below. Both containers listen on `$PORT` (API default 8000, web default 80).
- On first start the API creates a **synthetic demo community** (join code `DEMO2026`, 14 replayed days) and the **open community** for people who sign up without a code.

| Who | How to sign in | What you can do |
|---|---|---|
| Demo organiser | `admin@demo.fellaride.app` / `vndFlmbbXm5ESSiEvW-vfKC3` (on the live site; a fresh local database uses `FELLARIDE_DEMO_ADMIN_PASSWORD`, default `fellaride-demo-admin`) | Dashboard, engine controls, Proof, reports, broadcast |
| Your own account | App → **Create an account** (join code optional; `DEMO2026` for the demo community) | The full member app: drive, ride, chat, rate, report |
| Any demo member | App → **Try the demo community** → tap a person | The member app as that synthetic person |

### Signing in, step by step

Use the join code **`DEMO2026`**. It puts you in the demo community, where rides, members and dashboard data already exist. Without it you land in the empty open community and will see no rides.

**Create your own account — what we recommend judges do:**

1. Open **https://fellaride-web.onrender.com** and give it a moment to wake up (free hosting sleeps, so the first load can take about a minute).
2. Tap **Create an account**.
3. Enter your name, gender, email, mobile number and a password of at least 8 characters.
4. In **Join code**, enter **`DEMO2026`**. This step is what connects you to the demo community and its rides.
5. Tap **Create account**. You are signed in and land on Home.
6. Set your pickup point when asked, then use **Offer a ride** to drive or **Find rides** to ride.

**Signing in again later:** tap **Sign in** and use your email *or* your mobile number, plus your password. A session lasts 12 hours. There is no password reset, so if you forget the password, create another account with `DEMO2026`.

**As the organiser, for the dashboard:** sign in with the demo organiser account in the table above, then open `/dashboard`.

**As an existing demo member, the fastest route with no sign-up:** on the welcome screen tap **Try the demo community** and pick a person. You get the full member app as that synthetic member.

Every API route except sign-in, sign-up, the public community list and demo sign-in needs `Authorization: Bearer <token>`.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `FELLARIDE_DATABASE_URL` | SQLite file in `backend/` | e.g. `postgresql+psycopg://user:pass@host:5432/fellaride` |
| `POSTGRES_USER`, `POSTGRES_PASSWORD` | `fellaride`, `change-me` | Used by docker-compose's optional local PostgreSQL (`--profile localdb`) |
| `FELLARIDE_JWT_SECRET` | random per start | Signs login tokens. **Set a long random value in any shared deployment.** |
| `FELLARIDE_JWT_EXPIRE_HOURS` | `12` | How long a sign-in lasts |
| `FELLARIDE_DEMO_ADMIN_PASSWORD` | `fellaride-demo-admin` | Password of the seeded demo organiser |
| `FELLARIDE_DEMO_LOGIN` | `true` | One-tap sign-in as synthetic demo members |
| `FELLARIDE_AUTH_RATE_LIMIT` | `30` | Sign-in and sign-up attempts per IP per 10 minutes |
| `FELLARIDE_ADMIN_KEY` | empty | Optional operator key for scripts (`X-Admin-Key`) |
| `FELLARIDE_CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Allowed frontend origins |
| `FELLARIDE_SEED_DEMO_DAYS` | `14` | Days replayed for the demo community (0 = off) |
| `FELLARIDE_DEFAULT_JOIN_CODE` | empty (`render.yaml`: `DEMO2026`) | Community for sign-ups without a code; `DEMO2026` puts real people next to the synthetic members on the demo dashboard |
| `FELLARIDE_NUDGE_BUDGET_PER_DAY` | `14` | Maximum nudges per community per day |
| `FELLARIDE_NUDGE_COOLDOWN_DAYS` | `2` | Minimum days between nudges to one member |
| `FELLARIDE_MAX_DETOUR_KM` | `3.0` | Engine matching: maximum pickup detour |
| `FELLARIDE_MAX_TIME_GAP_MIN` | `30` | Engine matching: maximum departure-time difference |
| `FELLARIDE_LEARNING_RATE` | `0.35` | Online learning step size |
| `FELLARIDE_LEARNING_RATE_DECAY_UPDATES` | `1000` | Learning slows as a model sees more outcomes: lr / (1 + updates / this). 0 = constant |
| `FELLARIDE_EXPLORE_SHARE` | `0.15` | Real communities: share of each day's nudges sent to random members, to keep training data unbiased |
| `FELLARIDE_AUTO_ADVANCE_DAYS` | `true` | Real communities: the engine day follows the calendar (India time), one day per local day |
| `FELLARIDE_SMTP_HOST`, `_PORT`, `_USER`, `_PASSWORD`, `_FROM` | empty, `587` | SMTP server for the sign-up verification code. Render's free plan blocks outbound SMTP, so prefer Brevo below |
| `FELLARIDE_BREVO_API_KEY`, `FELLARIDE_MAIL_FROM`, `FELLARIDE_MAIL_FROM_NAME` | empty, empty, `FellaRide` | Brevo transactional email over HTTPS, which works where SMTP is blocked. `MAIL_FROM` must be a sender verified in Brevo. The key is secret: set it in the environment, never in git. With neither Brevo nor SMTP set, the code goes to the API log and verification isn't required |
| `FELLARIDE_APP_URL` | `http://localhost:5173` | The web app's address, used in reset links |
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
| Account | `POST /auth/signup` · `POST /auth/login` (email or mobile) · `POST /me/delete` · `POST /auth/demo-login` · `GET /auth/me` · `GET /join/{code}` · `GET /tenants/{t}/demo-accounts` · `POST /auth/register` (engine commute sign-up) · `POST /auth/verify-email` · `POST /auth/verify-email/send` (6-digit sign-up code; required before posting or booking only while email sending is configured) |
| Me | `PUT /me/profile` · `POST /me/location` · `GET /me/trips` · `GET /me/alerts` · `POST /me/alerts/read` · `GET /me/invites` · `POST /me/invites` |
| Rides (member app) | `POST /trips` · `GET /trips/search` · `GET /trips/{id}` · `POST /trips/{id}/request` · `/withdraw` · `/start` · `/end` · `/cancel` · `POST /trips/{id}/seats/{s}/approve` · `/reject` · `/board` · `/no-show` (rider not at pickup, from the planned time) |
| Chat and updates | `GET /trips/{id}/messages` · `POST /trips/{id}/messages` · `POST /trips/{id}/notify` |
| Trust | `POST /trips/{id}/ratings` · `POST /reports` · `GET /report-reasons` |
| Organiser | `GET /tenants/{t}/trips-overview` · `POST /tenants/{t}/broadcast` (audience: all, drivers, riders, new) · `GET /tenants/{t}/broadcasts` · `POST /tenants/{t}/reports/{r}/review` · `GET /tenants/{t}/activity` · `GET /tenants/{t}/live` · `GET /tenants/{t}/impact` · `GET`/`POST /tenants/{t}/suspensions` · `DELETE /tenants/{t}/suspensions/{u}` · `GET`/`PUT /tenants/{t}/pricing` · `PUT /tenants/{t}` (rename) |
| Community | `POST /tenants` · `GET /tenants` · `GET /tenants/{t}` · `POST /tenants/{t}/members/import` · `POST /tenants/{t}/members/{m}/register` |
| Intelligence | `GET /tenants/{t}/members` · `GET /tenants/{t}/members/{m}` · `GET /tenants/{t}/clusters` · `GET /tenants/{t}/members/{m}/recommendations` |
| Engine rides | `POST /tenants/{t}/rides/offers` · `/requests` · `/requests/{q}/cancel` · `/match` · `GET /tenants/{t}/rides` · `POST …/offers/{o}/start` · `/finish` · `POST …/bookings/{b}/feedback` |
| Referral programme | `GET /referral/{code}` (public: first name and community) · `GET /me/referrals` · `GET /tenants/{t}/referrals` (organiser) · sign-up takes an optional `referral_code` |
| Nudges and referrals | `POST /tenants/{t}/interventions/plan` · `GET …/interventions` · `POST …/interventions/{i}/respond` · `GET …/members/{m}/invite-suggestions` · `POST …/referrals` · `POST …/referrals/{r}/accept` |
| Insights | `GET /tenants/{t}/metrics` · `/metrics/funnel` · `/metrics/timeseries` · `/graph` · `/model` |
| Network expansion (organiser) | `GET /tenants/{t}/expansion` · `POST …/expansion/run` · `POST …/expansion/autopilot` (synthetic only) · `POST …/expansion/corridors` · `POST …/expansion/demo-neighbour` |
| Community board | `GET /community/overview` · `/feed` · `/leaderboard` · `/me` · `POST /community/posts` · `DELETE /community/posts/{p}` · `POST …/posts/{p}/reactions` · `GET`/`POST …/posts/{p}/comments` |
| System | `GET /health` |
| Demo (organiser) | `POST /tenants/demo` · `POST /tenants/{t}/simulate` · `POST /tenants/{t}/day/close` · `POST /demo/compare` |

Full, interactive details are at `/docs` on the running API.

## Tests

```bash
cd backend
pytest -q          # 58 tests
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

**Learning from real data:**
- an unanswered nudge expires as a no, and the model learns from it
- real communities spend part of the nudge budget on exploration
- the day clock follows the calendar
- the trainer reads only real, answered nudges and holds out the newest rows
- the learning rate decays as updates grow

**Network expansion:**
- the report finds areas, diagnoses bottlenecks and links neighbouring communities
- the engine acts, measures the result and learns which actions work
- a shared corridor can be proposed to both communities
- expansion routes are organiser-only, and autopilot is synthetic-only

**Community board:**
- posts, reactions, replies and who may see them
- a finished ride counts for activity, the leaderboard and badges
- the demo community's board is seeded

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

- **There is no password reset.** The forgot-password flow is removed for now, so a forgotten password cannot be recovered in the app: create a new account with join code `DEMO2026`, or ask the organiser.
- **Alerts arrive by polling** (every 8 seconds). There is no push server, so phone notifications show only while the browser keeps the app alive, and they need https or localhost.
- **Calling uses the phone's dialer** (`tel:` link), not voice inside the app.
- **"Near you" uses your last known location:** your latest search, posted ride or shared location. There is no live GPS tracking.
- **Maps, search and routes use the public OpenStreetMap servers**, which are rate-limited and meant for light use. Self-host them or use a paid provider in production. If routing is unreachable, a straight line is used.
- **The boarding code confirms the right car, not identity.** IDs aren't verified.
- **The open community has no organiser.** Its reports can be reviewed with the operator key (`X-Admin-Key`).
- **The engine day follows the calendar in real communities** (one day per local day in India time, caught up on the next request; `FELLARIDE_AUTO_ADVANCE_DAYS`). Synthetic communities only move with **Next day** or **Simulate**; the dashboard labels this ("Simulated timeline") and `GET /tenants/{t}` reports it as `clock: "manual"` (`"calendar"` for real communities).
- **Any ride action answers a recent nudge**, whatever the nudge suggested, and the model learns for the nudge's role.
- **An invited person is assumed to commute like the inviter** until their own first ride.
- An approved seat that the rider later withdraws doesn't count as matched.
- **Demo sign-in is intentionally open** for the synthetic community (`FELLARIDE_DEMO_LOGIN`). Turn it off for a real community.
- Login tokens are kept in the browser's local storage.
- The engine's matching uses straight-line geometry, models one commute per member, and uses default weights for connectors (too few samples). Simulated response rates are modelling assumptions.
- **Communities are separate:** a rider only sees rides from their own community. Someone who signs up without a join code (and no `FELLARIDE_DEFAULT_JOIN_CODE`) joins the open community and won't see the demo community's rides.
- **The free hosting sleeps:** Render free services sleep after 15 minutes idle (the first visit takes about a minute), and Supabase free pauses after 7 days idle.

### Security and deployment — known and accepted

Deliberate trade-offs for a hackathon demo on free hosting. They are documented here so they're treated as known limitations, not defects:

- **Cost-sharing is trust-based.** The trip distance (`route_km` / `route_min`) and route come from the driver's device and aren't re-verified on the server. Contributions are suggestions only, capped so the riders together never pay more than the trip's stated running cost, and money changes hands outside the app (UPI or cash). There is no payment integration or server-side distance audit.
- **Sign-up tells you whether an email or mobile is already registered** (a clear "already exists" message) so people can recover an account. Sign-in is deliberately uniform and reveals nothing.
- **Driver name, gender and approximate area are visible to signed-in members before approval**, so riders can choose a ride. Exact home location, number plate and phone number are shown only to the driver and approved riders.
- **Email verification needs a working mail server.** Sign-up emails a 6-digit code and booking waits for it only when email sending is configured (Brevo over HTTPS, or SMTP). With neither set, the code is written to the server log and verification is not enforced, so accounts work immediately.
- **Verification codes are written to the server log when no mail transport is set** (local and free-tier only). Guesses are limited to 5 tries per code.
- **Sign-out is on this device only.** Login is a 12-hour stateless token kept in the browser's local storage; signing out clears it locally, but a copied token stays valid until it expires. Changing the password or deleting the account does end other sessions.
- **Rate limiting is best-effort.** The sign-in / sign-up limiter is in-memory per process, resets on restart, and is keyed on the address the server sees (which can be shared behind a proxy). It slows abuse; it is not a hardened, shared limiter.
- **Free-tier database limits concurrency.** The connection pool is kept small to stay under Supabase's free cap, so many heavy requests at once can queue. The welcome and community figures are cached for this reason.
- **Public impact figures include synthetic demo data.** Network-wide totals count seeded synthetic communities (every such record carries `synthetic: true`, and the impact response carries `includes_demo`), so headline numbers are not all real rides.
- **Passwords are limited to 72 bytes** (a bcrypt constraint), so a very long non-Latin passphrase may be rejected.
- **The interactive API docs (`/docs`, `/openapi.json`) are public**, and the community list exposes only names and destinations.
- **No extra browser security headers** (CSP, X-Frame-Options, HSTS) are set on the static web app; it relies on React's output escaping and the server's input validation.

## Sprint status

| Sprint | Scope | Status |
|---|---|---|
| 1 | Engine (intelligence, scorer, clusters, matching, interventions, referrals, metrics), REST API, trained model and notebook, synthetic demo, tests, Docker | done |
| 2 | Mobile-first React app, JWT sign-in, instant matching, ride feedback, community map with day slider, dashboard, Proof page | done |
| 3 | Member app rebuilt around posted rides: optional join code, driving-or-riding each time, route confirmation, nearby alerts, approve or decline, boarding code, got-in dropdown, chat, call, ending from either side, recency-weighted ratings and penalties, categorised reports, notifications, organiser broadcast | done |
| 3b | Activation bridge: every member-app action feeds the engine (funnel, KPIs, graph, learning, nudges, referrals), claim by email, in-app invites, live dashboard | done |
| 3c | Network Expansion Engine, community board (challenge, posts, leaderboard, badges), real-data model training, transit-pass redesign | done |
| 3d | Docker for the API and web app, Render Blueprint with Supabase ([DEPLOY.md](DEPLOY.md)) | done |
| 4 | Bug Bounty hardening, security pass, public deployment, pitch | in progress |

Use DEMO2026 for community code
