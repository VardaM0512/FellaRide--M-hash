# FellaRide Round 1 Demo

Show one story in Round 1: a real ride in the app updates the organiser's dashboard live, and the engine beats random nudges. Keep everything else for later rounds.

## Setup (30 minutes before)

Use one laptop with three browser windows side by side, all signed in before the judges arrive.

| Window | Who | Sign in as | Open on |
| --- | --- | --- | --- |
| 1 (normal) | Organiser | `admin@demo.fellaride.app` / `fellaride-demo-admin` | http://localhost:5173/dashboard |
| 2 (incognito) | Driver | Account made in advance with join code `DEMO2026` | Home |
| 3 (second incognito profile) | Rider | Account made in advance with join code `DEMO2026` | Home |

- [ ] Backend running: `cd backend && .venv/bin/uvicorn app.main:app --port 8000`
- [ ] Frontend running: `cd frontend && npm run dev`
- [ ] Fresh data: delete `backend/fellaride.db` and restart the backend (it re-seeds 14 demo days)
- [ ] Driver and rider accounts created with real-looking names
- [ ] Write down the dashboard's *First ride done*, *people rode this week* and *Shared rides completed*
- [ ] Notifications and location allowed in the driver and rider windows
- [ ] Tab ready with the README's "How the PS requirements are met" table
- [ ] Wi-Fi checked, phone hotspot ready, charger in, Do Not Disturb on, zoom 110%

## The script (6.5 minutes)

Five steps. The live ride is the centre of it, so start it early and protect its time.

### 1. Problem and pitch (0:00–0:45, no screen needed)

> "Carpool apps die on day one. No drivers, so riders leave, so drivers leave. But colleges and companies already have trust and shared commutes. FellaRide turns that into a carpool network that grows itself: a real carpool app, wired to an engine that finds the right people, nudges them, and learns from every ride."

### 2. Live ride (0:45–3:45, driver and rider windows)

1. **Organiser window first, 15 seconds:** "This is a 180-person synthetic university after 14 days. Remember these numbers." Point at *First ride done* and *Shared rides completed*.
2. **Driver:** **I'm driving** → from Koramangala → to Whitefield → leaving now → pick a route → post.
   - Say: "The driver picks one of three real driving routes."
3. **Rider:** **I need a ride** → pickup Domlur → drop Marathahalli → **Ask for a seat**.
   - Say: "The rider only sees rides that pass their pickup and then their drop, with the driver's name, gender and rating."
4. **Driver:** **Approve** → point at the 4-digit boarding code on both screens.
   - Say: "Same code on both phones, so the rider knows it's the right car. Phone numbers are only shared inside the ride."
5. **Driver:** *Who got in?* → pick the rider → **Got in** → **End ride for everyone**.

### 3. The dashboard updates (3:45–4:45, organiser window)

The dashboard refreshes every 20 seconds. Fill the wait by pointing at the map. Then show:

- *First ride done* up by 2, and *Shared rides completed* up by 1
- a new line between the two people on the map
- "1 of N completed rides came from the app" in the member-app panel

> "That ride just fed the engine. The funnel moved, the network got a new connection, and the model updated its weights. Every real ride makes the engine smarter."

### 4. Proof (4:45–5:45, `/dashboard/proof`)

> "Does the engine actually help? We ran it against random nudges on identical communities for 40 days. The engine got 1.9× more active users, 3.7× more completed rides, 1.5× more registrations and a 1.7× higher match rate. Same seeds give the same result every time."

### 5. Coverage and close (5:45–6:30)

Show the README's "How the PS requirements are met" table for about 20 seconds.

> "Every requirement in the problem statement is built. Profiles, propensity scoring, matching, clusters, targeted nudges, connectors, referrals, the funnel, learning, the growth graph and trust and safety. Here's where each one lives."

Close:

> "An app that only books rides waits for people to show up. FellaRide goes and finds them, and gets better with every ride."

**Leave out today:** code, model math, API docs, chat, reports, invites, broadcast and the expansion page. If asked, say "we'd love to show that in the next round" and answer in one line.

## If something breaks

| Problem | What to do |
| --- | --- |
| Place search or routes won't load (Wi-Fi) | Switch to the phone hotspot. If that fails, play the backup video of the ride, then go straight to the dashboard and Proof. Both work offline. |
| Dashboard numbers don't move | Wait for the 20-second refresh, then reload the page once. Keep talking while you wait. |
| A screen errors or freezes | Say "let me show you the recorded version", play the video, and move on. Don't debug in front of the judges. |
| Only 4–5 minutes | Skip step 5 (coverage). Keep the ride, the dashboard update and Proof. |
| A judge interrupts with a question | Answer in one or two sentences, then say "let me show you" and carry on with the script. |

- [ ] Tonight: record a 2-minute screen video of steps 2 and 3 working end to end.

## Quick answers

Keep each answer to two sentences in Round 1.

| If they ask | Say |
| --- | --- |
| How is this different from Uber pool or Quick Ride? | Those wait for drivers to show up. We go and find likely drivers inside a trusted community, nudge them at the right time, and learn what works there. |
| Is the data real? | The demo community is synthetic, and we label it that way everywhere. The ride you just watched is real app data, and the dashboard counts it separately. |
| How does the engine pick who to nudge? | It scores each member as a likely driver, rider, connector or referrer, then nudges the best fit on busy commute corridors. There's a daily budget and a cooldown, so nobody gets spammed. |
| Is it safe for women? | Gender and rating are shown up front, riders can filter for women drivers, the boarding code confirms the car, and numbers stay inside the ride. |
| Who would pay for it? | Agree on one answer as a team tonight. |
