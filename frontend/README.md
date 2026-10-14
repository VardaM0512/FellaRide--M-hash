# FellaRide frontend (Sprint 2)

Two web surfaces on top of the Sprint 1 API, built from the FellaRide Frontend Brief:

| Route | Surface | Who it's for |
|---|---|---|
| `/` `/ride` `/invite` `/me` | Member app, phone first (installable PWA) | A student or employee in the community |
| `/dashboard` | Community dashboard, desktop | Organisers, and judges in the demo |
| `/dashboard/proof` | Smart engine vs random nudges | Local demo only (needs the admin key) |

**Stack:** React 18, Vite 5, TypeScript, TanStack Query (fetching and caching), React Router, Framer Motion (day slider only). The map is hand-drawn SVG from latitude and longitude, so it needs no map tiles or API keys and works offline at the venue.

## Run it

Start the API first (from `backend/`, see the root README). Then:

```bash
cd frontend
npm install
cp .env.example .env.local      # Windows: copy .env.example .env.local
npm run dev                     # http://localhost:5173
```

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | Where the API runs |
| `VITE_TENANT_ID` | `1` | The community to show (1 is the auto-seeded synthetic demo) |
| `VITE_ADMIN_KEY` | empty | **Local demo only.** Unlocks Next day, Simulate 7 days and the Proof page. Must equal the backend's `FELLARIDE_ADMIN_KEY`. Vite puts env values into the public bundle, so never build a deployed version with it set. The admin-only buttons disappear when it is empty. |

Port 5173 is already allowed by the backend's default CORS setting. For another origin, add it to `FELLARIDE_CORS_ORIGINS` on the backend.

Other commands: `npm run typecheck`, `npm run build` (output in `dist/`), `npm run preview`.

## The two-minute demo

1. **Dashboard → Plan today’s nudges.** The engine picks up to 14 people; "Today’s nudges, and why" shows each message and the reasons.
2. **Member app**, Viewing as **Aarav L.**: "Gauri C. drives your way at 07:58." Tap **Ask for a seat**.
3. Viewing as **Gauri C.** → **Ride** → **Offer 3 seats**.
4. **Dashboard → Match rides.** Back in the app, Aarav’s Ride tab says "Matched with Gauri, leaving 07:58".
5. As Gauri, **Mark ride done**. The dashboard map gains a thread and the funnel moves.
6. On the map, drag the day slider from day 0 to today, or press **Play**.
7. **Proof** runs smart vs random on two identical synthetic communities (about 10 seconds; the lift was 2.4× active riders in our run).

Who receives a nudge depends on the engine, so if Aarav got none today, pick any person in the Viewing-as list whose Today screen shows a suggestion.

## How it is organised

```
src/
  api/        client.ts (fetch, errors), types.ts (from real responses), hooks.ts (TanStack Query)
  lib/        identity.tsx (who the app acts as), format.ts (plain-language wording), announce.tsx, geo.ts
  components/ ui.tsx (shapes, sheet, sparkline, skeleton, error note, icons)
  member/     MemberLayout (Viewing-as picker, tabs), Today, Ride, Invite, Me, ThreadPicture
  dashboard/  Dashboard, CommunityMap (map + day slider), Panels (numbers, funnel, nudges, routes, model, operator), Proof
  styles/     tokens.css (brief palette, light and dark), app.css
```

**Login later:** every screen reads the member from `useIdentity()` in `src/lib/identity.tsx`. When JWT login lands, replace that provider's internals with the logged-in member and delete the picker in `MemberLayout.tsx`; no screen changes.

## Design and accessibility

- Palette, type (Anek Latin, Atkinson Hyperlegible) and shapes follow the brief. Drivers are squares, riders circles, well-connected people get a ring, so colour is never the only signal. Every text colour was checked at WCAG AA in light and dark mode.
- Backend terms never reach members: "tenant" is community, "intervention" is suggestion, "booking" is matched, and so on (`src/lib/format.ts`).
- Keyboard: every action is a real button or link, with a visible focus ring. Sheets close with Esc and return focus.
- The map has a **Show as list** alternative. The day slider is a native range input with "Day N of M" text. With reduced motion on, threads appear without animation.
- Status changes (matched, invited, errors) are announced through an `aria-live` region.
- Works at 320 px wide with no sideways scrolling. Tap targets are at least 44 px.
- Loading uses skeletons shaped like the content; errors show the API's sentence with a Try again button.

## Known limitations

- **No login yet.** The Viewing-as picker is a demo shortcut; anyone can view any member.
- The invite list only remembers invites sent in this browser session; the API has no "my invites" endpoint yet.
- Thread thickness on the map uses each pair's total rides, so it doesn't shrink when you slide back to earlier days.
- Fonts load from Google Fonts. Offline, the app falls back to system fonts.
- The PWA installs to the home screen but does not cache API data offline.

## AI tools used

Claude (Anthropic) generated the frontend code, types and this README from the team's Frontend Brief; the team reviewed and tested it against the running API.
