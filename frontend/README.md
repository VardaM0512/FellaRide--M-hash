# FellaRide frontend

A mobile-first React app for members, plus an organiser dashboard. It talks to the FastAPI backend in `../backend`.

**Stack:** React 18, Vite 5, TypeScript, TanStack Query, React Router, Framer Motion (only for the day slider). It is an installable PWA and supports dark mode.

## Run

```bash
cp .env.example .env.local     # VITE_API_URL=http://localhost:8000
npm ci
npm run dev                    # http://localhost:5173
```

Start the backend first (see the root README). The backend schema changed in this sprint, so delete `backend/fellaride.db` (or run `docker compose down -v`) before you start it.

| Variable | Default | What it does |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | Address of the backend API. |

The frontend holds no keys. Access comes from the JWT that is issued when a user signs in.

## Signing in

| Who | How |
|---|---|
| New member | Welcome → **Create an account**: email, mobile, password, name, gender, and an optional join code (empty = the open community for everyone) |
| Returning member | **Sign in** with email *or* mobile, plus password |
| Organiser (admin) | `admin@demo.fellaride.app` / `fellaride-demo-admin` |
| Any demo member | Welcome → **Try the demo** → pick a person, then add a gender and a test mobile once |

The token is stored in `localStorage` and expires after 12 hours. Any 401 response signs the user out.

## Member app (phone layout; a centred phone column on desktop)

- **Home** asks *How are you travelling today?* every time: **I'm driving** or **I need a ride**. It is never saved, so you can drive one day and ride the next.
- **I'm driving**: from, to (search, current location, or tap the map), leaving time, empty seats → pick and **confirm the route** on the map (OSRM, up to 3 options) → post. Everyone whose last location is within 2.5 km of the route gets a "ride near you" alert.
- **I need a ride**: pickup and optional drop (and time) → every ride whose route passes near both, in that order, with the driver's **name, gender and rating** (filter: all / women / men). **Ask for a seat**.
- **Ride screen** (driver):
  - **Approve / Decline** each request, seeing name, gender and rating.
  - One **boarding code** is shared with everyone approved.
  - **Who got in?** dropdown → **Got in**.
  - Quick updates ("Running 5 min late"), which every rider receives as a notification.
  - **Start ride**, **End ride for everyone**, **Cancel ride**.
- **Ride screen** (rider):
  - Status, the boarding code, and **Call** for the driver (a `tel:` link, shown once approved).
  - **End my ride**. If you are the last rider, this ends the ride for everyone.
- **Chat**: group chat for the driver and approved riders.
- **Ratings**: after the ride, rate everyone you travelled with (drivers rate riders, riders rate the driver and each other). A rating is the recency-weighted average of the last 20 ratings. There are automatic penalties:
  - 1★ if the driver set off more than 5 minutes early and an approved rider was left behind;
  - 2★ for cancelling after approving someone.
- **Report** anyone from a ride: multiple-choice reasons grouped as Safety, Money or identity, Reliability, Behaviour or Other. The report gets its most serious category.
- **Alerts** (bell / tab): polled every 8 seconds. A banner shows in the app, and a phone notification through the service worker when the app is in the background and notifications are on (needs https or localhost).

Maps use OpenStreetMap tiles, Nominatim (place search) and the public OSRM demo server (routes). These are free services meant for light use. If routing is unreachable, a straight line is used.

## Organiser dashboard (`/dashboard`, admin only)

- Community map, numbers, funnel, nudges, corridors and the model panel.
- **Member app panel**: rides live/completed, riders carried, average rating, penalties, open reports by category (mark reviewed), and **Send a notification to every member**.
- Operator buttons: Plan, Match, Next day, Simulate.
- The join code is shown in the header.
- `/dashboard/proof` compares the engine against random nudges.

## Two-minute demo

1. Open three windows (one incognito per person) and create three accounts: a driver, two riders.
2. Each rider: **You → Update my location now** (or search once), so they get "ride near you" alerts.
3. Driver: **I'm driving** → from / to / time / seats → confirm route → post. Riders near the route get an alert.
4. Rider: **I need a ride** → pickup and drop → **Ask for a seat**. The driver sees name, gender and rating → **Approve**.
5. Everyone approved sees the same boarding code; chat and Call unlock.
6. Driver: **Who got in?** → pick each rider → **Got in** → **Start ride**.
7. Riders: **End my ride**. The last one ends the ride for everyone. Then everyone rates each other, and anyone can **Report**.
8. Organiser: the dashboard's Member app panel shows the ride, ratings and reports.

## Scripts

`npm run dev` · `npm run build` (runs a type check, then the Vite build) · `npm run preview`
