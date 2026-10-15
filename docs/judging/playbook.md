# FellaRide Judging Playbook

## Before you start (30 minutes before each round)

Run the demo from one laptop with **three browser windows** side by side. Set them up before the judges arrive, so nothing is typed live except the ride itself.

| Window | Who | Sign in as | Start on |
| --- | --- | --- | --- |
| 1 (normal) | Organiser | `admin@demo.fellaride.app` / `fellaride-demo-admin` | `/dashboard` |
| 2 (incognito) | Driver | New account, join code `DEMO2026` | Home |
| 3 (second incognito profile) | Rider | New account, join code `DEMO2026` | Home |

- [ ] Start the backend: `cd backend && .venv/bin/uvicorn app.main:app --port 8000`
- [ ] Start the frontend: `cd frontend && npm run dev`, then open http://localhost:5173
- [ ] For a clean run, delete `backend/fellaride.db` and restart the API. It re-seeds 14 demo days.
- [ ] Create the driver and rider accounts **in advance**, with real-looking names (for example "Aarav, driver" and "Meera, rider").
- [ ] Note the dashboard numbers before the live ride: *First ride done*, *people rode this week*, *shared rides completed*.
- [ ] Open http://localhost:8000/docs in a background tab, for Round 3.
- [ ] Turn on phone notifications in the driver and rider windows, and allow location.
- [ ] Laptop charger in, Do Not Disturb on, browser zoom at 110% so judges can read it.

**Fallbacks.** Place search and routes use public OpenStreetMap servers, so check the venue Wi-Fi first. Keep a phone hotspot ready. If the network dies, skip the live ride and use the dashboard (the seeded 14 days) and the **Proof** page, which run fully offline. Record a 2-minute screen video of the full ride tonight as a last resort.

## The pitch to repeat in every round

**One line:** FellaRide turns a community into a carpooling network that grows itself. A real carpool app is wired to an activation engine that finds, matches, nudges and learns from every ride.

**The problem (say it in 20 seconds).** Carpool apps die from the cold start. On day one there are no drivers, so riders leave, so drivers leave. Communities like colleges and companies already have trust and shared commutes, but no one is turning those into rides. PS Variant 1 asks for exactly that: get a community moving.

**Our answer.** We don't just build a booking app and hope people show up. We built the app and the engine that activates the community behind it, and joined them up. Every ride in the app feeds the engine, and the engine's nudges come back into the app as one-tap suggestions.

**The loop:** Discover → Identify → Match → Nudge → Ride → Learn → Refer → Grow.

1. **Discover:** find people in the community and their commutes, including people invited or imported who haven't joined yet.
2. **Identify:** score each member as a likely driver, rider, connector or referrer.
3. **Match:** pair drivers and riders by route overlap, detour, timing and preference.
4. **Nudge:** send the right suggestion to the right person, within a daily budget and a cooldown, connectors first.
5. **Ride:** the real app ride: post, request, approve, board code, chat, end.
6. **Learn:** every answer, ride and rating updates the model online.
7. **Refer:** suggest who each member should invite.
8. **Grow:** the network map, funnel and metrics show the community getting denser.

**The proof number to say out loud:** on identical synthetic communities over 40 days, the smart engine beat random nudges with **1.9× more active users, 3.7× more completed rides, 1.5× more registrations and a 1.7× higher match rate**. The result is deterministic, so it comes out the same every time we run it.

**Be upfront about this:** all demo and training data is synthetic, and we say so. The real-app ride you create in the demo is real data, and the dashboard shows it separately ("1 of N completed rides came from the app").

## Round 1: the 7-minute demo

Round 1 has one job: make judges remember that **a real ride moved the organiser's dashboard live**. Show the loop once, end to end, and leave the technical detail for later rounds. If you get only 5 minutes, drop steps 5 and 6.

| # | Time | Window | What you do | What you say |
| --- | --- | --- | --- | --- |
| 1 | 0:00–0:45 | Slide or nothing | State the problem and the one-line pitch | "Carpool apps die on day one because there are no drivers. FellaRide activates a community that already trusts each other, and learns from every ride." |
| 2 | 0:45–1:45 | Organiser `/dashboard` | Show the community map, then move the day slider from day 0 to day 14. Point at the funnel and this week's numbers. | "This is a 180-person synthetic university. Watch the network go from scattered dots to connected corridors as the engine works. Note these numbers: first rides, people who rode this week." |
| 3 | 1:45–3:45 | Driver, then rider | Driver: **I'm driving**, Koramangala → Whitefield, leaving now, pick a route, post. Rider: **I need a ride**, Domlur → Marathahalli, **Ask for a seat**. | "The driver picks one of three real routes. The rider only sees rides whose route passes their pickup and then their drop. Driver name, gender and rating are shown up front." |
| 4 | 3:45–4:45 | Driver | **Approve**, show the 4-digit boarding code, then *Who got in?* → **Got in** → **End ride for everyone**. | "Both see the same boarding code, so the rider knows it's the right car. Numbers are shared only inside the ride." |
| 5 | 4:45–5:30 | Rider | Rate the driver 5 stars. | "Ratings are recency-weighted, and there are automatic penalties for leaving early or cancelling." |
| 6 | 5:30–6:15 | Organiser | Wait for the 20-second refresh. Point at *First ride done* +2, *Shared rides completed* +1, the new line on the map and "1 of N rides came from the app". | "That ride just fed the engine. The funnel moved, a co-ride edge joined the map, and the model updated its weights." |
| 7 | 6:15–7:00 | Organiser `/dashboard/proof` | Show the engine-vs-random chart and table. | "On identical communities, the engine gets 1.9× more active users and 3.7× more completed rides than random nudges. Same seeds, same answer every time." |

**Close with one sentence:** "An app that only books rides waits for people to show up. FellaRide goes and finds them, and gets better with every ride."

**Do not** in Round 1: open code, explain the logistic regression, show the API docs or try to cover every feature. Mention "there's more" (chat, reports, invites, expansion) in one line and stop.

## Round 2: product, trust and the organiser (10–12 minutes)

Round 2 judges have seen the headline, so show **depth and polish**: why a woman would feel safe riding with a stranger from her campus, what happens when things go wrong, and what the organiser controls. Open with a 30-second recap of the Round 1 loop, then go through these four blocks.

### Block A: the full ride, including the edge cases (4 min)

1. **Home asks every time:** "I'm driving" or "I need a ride". Say: "The role isn't fixed to the account. The same person drives on Monday and rides on Tuesday."
2. **Nearby alerts:** when the driver posts, anyone whose last known location is within 2.5 km of the route gets an alert. Show it arriving in the rider window.
3. **Driver filter:** on Find, filter for women drivers.
4. **Car rules:** say these out loud. A full car auto-declines the other requests. An approved rider's other requests are withdrawn. Each person has one active ride at a time.
5. **Chat and updates:** open the group chat, tap **Call** to show the dialer, then send the one-tap driver update **Running 5 min late**. The rider gets a notification.
6. **Ending rules:** the driver ends for everyone. A rider ends only their part, unless they are the last rider.

### Block B: trust and safety (3 min)

| Feature | What to show | Why it matters |
| --- | --- | --- |
| Boarding code | Same 4-digit code on both screens | The rider gets into the right car |
| Private numbers | Mobile visible only inside the same ride | No number harvesting |
| Recency-weighted rating | Last 20 ratings, each older one counts 0.85× | Recent behaviour counts most, so people can improve |
| Automatic penalties | 1★ for leaving 5+ min early with a rider left behind. 2★ for cancelling after approving. | Reliability is enforced without an admin |
| Reports | Pick reasons, add a note. Filed as Safety > Money or identity > Reliability > Behaviour > Other, with high, medium or low severity. | The organiser sees the worst problems first |
| Bad partners rank lower | Matching uses ratings | Trust feeds back into who gets matched |

File a report from the rider window, then show it in the organiser's member-app panel and mark it **reviewed**.

### Block C: growth features (2 min)

- **Invite:** the driver invites `friend@test.com` and copies the ready-made message. On the dashboard, *Found* goes up by 1. Sign up as that email and the invite shows **Joined**, and the driver counts as *Brought someone in*.
- **Nudges you can act on:** the organiser clicks **Plan nudges**. A member gets "3 people head your way at 08:05. Offer a ride?" with a button. Tapping it and posting counts as answering the nudge.

### Block D: the organiser's console (2–3 min)

- **Operator buttons:** Plan nudges · Match · Next day · Simulate. Click **Next day** once to show the metrics move.
- **Broadcast:** send a notification to every member (for example "Campus closed Friday") and show it arriving in the member windows.
- **Network expansion** (`/dashboard/expansion`): show *Why growth is slowing*, *Where to grow* on the map and *What the engine will do next*. Click **Run engine**, or **Autopilot 5 days**, and show *Actions and results* and *What works here*.
- **Start a new community** (`/start`): one line to say any college, company or housing society can set up its own in a minute.

**Also mention:** it is an installable PWA with phone notifications, dark mode and accessible labels. Install it on a phone if you can and hold it up.

## Round 3: engine, ML and engineering (12–15 minutes)

Round 3 judges want to know **whether the intelligence is real and whether you understand it**. Show the architecture, then go one layer down into each engine part, then the proof and its limits. Have `docs/architecture.svg`, the code and http://localhost:8000/docs open.

### 1. Architecture (2 min)

Open `docs/architecture.svg`. Walk it left to right:

- **Clients:** one React 18 + Vite + TypeScript PWA serves both the member app and `/dashboard`. Maps use Leaflet, and place search and routes use OpenStreetMap (Nominatim and OSRM) from the browser.
- **API:** FastAPI routers behind a security layer: CORS → JWT → member or organiser check → community scoping → pydantic validation.
- **Engines:** the trip engine (rides, seats, ratings, penalties, reports) and the activation engine (intelligence, scorer, matching, interventions, referrals, metrics, simulator).
- **The key design choice:** the **activation bridge** (`engine/activation.py`) is the only link from app actions to the engine. Each step is idempotent, runs in a savepoint, and never breaks the ride action if it fails.
- **Data:** PostgreSQL 16 in production (Supabase), SQLite locally. Deployed on Render (API) and Vercel (frontend), with a daily close job.

### 2. The engine, one part at a time (5 min)

| Part | How it works | Say this |
| --- | --- | --- |
| Community intelligence | Member features: has car, corridor density, recent rides, social degree, past response. Corridors = same ~1.5 km home cell + same destination + same 30-min window. Hot = 3+ members with at least 1 driver and 1 rider. | "We find where supply and demand already overlap." |
| Propensity scorer | Logistic regression per role: driver, rider, connector, referrer. Trained offline with scikit-learn, then updated online after every outcome: w ← w + lr × (y − p) × x, with lr decaying as updates grow. | "It starts from a trained prior and adapts to each community." |
| Matching | 0.40 route overlap + 0.25 (1 − detour/3 km) + 0.25 (1 − Δt/30 min) + 0.10 preference fit, with hard limits. Poorly rated partners rank lower. | "Interpretable weights, hard safety limits." |
| Interventions | Priority = p(role) × corridor value × (1 − fatigue). Daily budget of 14, 2-day cooldown, fatigue capped at 0.6. Connectors first in days 0–4. 15% of nudges go to random members to keep learning unbiased. | "We nudge the right person, not everyone, and we don't spam." |
| Referrals | Invite suggestions ranked by predicted rider propensity plus a bonus for hot corridors. | "Members invite the people most likely to ride." |
| Network expansion | ~1.5 km zones with supply, demand, unmet demand and untapped roster. A 7-day trend forecast. Each zone's bottleneck maps to an action, judged 2 days later. A Beta posterior per action type picks the next one. Counts under 3 are suppressed for privacy. | "It's a bandit that learns which growth actions work in this community." |

### 3. The model, honestly (3 min)

Open `backend/models/scorer.json`. It was trained on 2026-10-14 on synthetic labelled data. A role ships only with 100+ samples and holdout AUC ≥ 0.6. Otherwise it falls back to default weights.

| Role | Samples | Holdout AUC | Shipped |
| --- | --- | --- | --- |
| Driver | 554 | 0.759 | Yes |
| Rider | 1,914 | 0.654 | Yes |
| Referrer | 306 | 0.671 | Yes |
| Connector | 52 | 0.795 | No (too few samples) |

Say: "Connector looks best on AUC, but 52 samples isn't enough to trust, so our quality bar holds it back. That's the bar working." Then show `python -m ml.train_scorer --source real`: it retrains on answered nudges from real communities, with a time-based holdout (train on the past, test on the newest 25%) and features stored at nudge time, so there is no leakage.

### 4. The proof and its limits (2 min)

Open `/dashboard/proof`, or call `POST /api/v1/demo/compare` from the API docs. Explain: same synthetic community, same seeds, 40 days, smart engine vs random nudges. Then **state the limits yourself** before a judge does: the simulator's member behaviour is ours, so this proves the engine beats random *under our behaviour model*, not in the wild. The real-data training path and the `by_source: {engine, app}` split in the metrics exist for exactly that next step.

### 5. Engineering quality (1–2 min)

- `cd backend && pytest -q`: 33 tests covering engine, security, member app and the bridge. Run it live if there's time.
- Security: bcrypt passwords, JWT on every route, sign-in rate limit, cross-community data returns 404, errors never leak stack traces.
- Engineering choices worth naming: idempotent bridge (a ride is never counted twice), savepoints, deterministic simulator, synthetic data flagged `synthetic: true` in every response.

### 6. Roadmap (1 min)

- Pilot with one real college or company, then retrain on real nudge answers.
- Cross-community corridors (already in the expansion engine) to link neighbouring organisations.
- Native push, verified org email sign-in and cost-sharing.

Check the roadmap with the team before Round 3, and only promise what you would actually build next.

## Likely judge questions

Answer in two sentences, then stop. If you don't know, say what you'd check and how.

| Question | Answer |
| --- | --- |
| How is this different from Uber pool, BlaBlaCar or Quick Ride? | Those are marketplaces that wait for supply. We activate a closed, trusted community: we find likely drivers, nudge them at the right time, and learn what works in that community. |
| Your data is synthetic. How do we know it works? | The Proof shows the engine beats random under our behaviour model, and we say that openly. The real-data path is built: real rides are tracked separately (`by_source`) and the model retrains on real nudge answers with a time-based holdout. |
| Why logistic regression and not deep learning? | We have hundreds of samples per role, not millions. Logistic regression is interpretable, updates online cheaply, and the organiser can see the weights on the dashboard. |
| How do you avoid spamming people? | Daily budget of 14 nudges per community, a 2-day cooldown per member, and a fatigue term that lowers priority as someone gets more nudges. |
| What stops the model only nudging people it already likes? | 15% of nudges go to random members (exploration), and the training set includes random-strategy runs. |
| How do you keep women safe? | Gender is visible up front, riders can filter for women drivers, the boarding code confirms the car, numbers stay inside the ride, reports are categorised by severity, and ratings affect matching. |
| What if a driver leaves early or cancels? | Automatic penalties: 1★ for leaving 5+ minutes early with an approved rider left behind, 2★ for cancelling after approving. It also teaches the driver model a negative example. |
| How do you solve the cold start? | Connectors go first in days 0–4, hot corridors are targeted first, and referral suggestions bring in the people most likely to ride. |
| What about privacy? | Individual data is used only for people who joined. Non-members and other communities are counted per zone only, and counts below 3 are hidden. One community never sees another's data (404). |
| Does it scale? | It is stateless FastAPI on PostgreSQL, scoped per community. The engine runs per community per day, so communities scale independently. |
| How do you make money? | Open question for the team: agree on one answer tonight (for example a per-seat fee to organisations or a campus sustainability subscription). |
| What did AI tools do? | Claude helped with planning, code, tests and docs, as stated in the README. Every team member can explain and change every part. Be ready to prove this by walking through any file they point at. |

## Who does what

Split the talking across three roles so one person drives the laptop while another talks. Put your names in the first column. The README's team section is still blank, so fill that in too.

| Role | Name | Round 1 | Round 2 | Round 3 |
| --- | --- | --- | --- | --- |
| Storyteller | *name* | Problem, pitch, Proof, close | Recap, trust and safety | Proof and its limits, roadmap |
| Demo driver (on the laptop) | *name* | Runs the live ride | Ride edge cases, invites, broadcast | Runs pytest, API docs |
| Engine expert | *name* | Explains the dashboard after the ride | Nudges, expansion page | Architecture, engine table, model |

- [ ] Tonight: two full timed run-throughs of Round 1 (target 6:30 so there's room for slow Wi-Fi).
- [ ] Tonight: record the backup video of the live ride.
- [ ] Tonight: everyone reads the Q&A table and agrees on the business model answer.
- [ ] Before Round 2: one run-through of Blocks A to D.
- [ ] Before Round 3: each person explains one engine file to the others in 2 minutes.
