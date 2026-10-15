# Organiser dashboard redesign: change log

**Date:** 16 October 2026 · **Branch:** `fix` (local, not committed yet)

The organiser side was one long page of panels. It is now its own app with the same look as the member app: the dark "transit line" sidebar, ivory cards on a bone background, brass for what's live or current, Fella Blue for riders and progress. Every page works on phones, and in light and dark mode.

## 1. Demo community has a name

| Before | After |
|---|---|
| Synthetic University (demo) | **Banyan Grove University (demo)** |
| Synthetic Tech Park (demo) | **Silverline Tech Park (demo)** |

- Both names are made up, so no real institution is implied. The "(demo)" suffix keeps them labelled as synthetic wherever the name appears. The apps hide the suffix next to their own Demo tag.
- Databases seeded before this change (including the live one) are renamed when the API starts. Only the two old default names are touched, so a name an organiser chose is never overwritten.
- The Proof comparison's throwaway communities are now called "Banyan Grove University (smart run)" and "Banyan Grove University (random run)".
- Code: `backend/app/sim/synthetic.py` (`DEMO_NAME`, `NEIGHBOUR_NAME`, `rename_legacy_demos`), `backend/app/main.py`.

## 2. New shell and navigation

- **Sidebar** in three groups:
  - **Community:** Overview, Live map, Members
  - **Run it:** Rides & safety, Announcements, Pricing
  - **Grow it:** Engine, Expansion, Proof
  - Settings at the bottom.
- **Live notes under each station**, for example "68 joined of 180", "2 open reports" (with a red badge) and "₹3/km suggested".
- **Sidebar footer:**
  - a join-code card that copies the code in one click
  - the organiser's account, with a sign-out button
- **Folding:** the sidebar folds to an icon rail, the same as the member app (Cmd/Ctrl + \\).
- **Top bar:** the page title, the community name, a **Day N** pill (Simulated or Live), and the theme toggle.
- **Phones:** bottom tabs (Overview, Map, Members, Rides, More). **More** lists every page as a tile.
- **Every page has its own URL:** `/dashboard`, `/dashboard/map`, `/dashboard/members`, `/dashboard/rides`, `/dashboard/announce`, `/dashboard/pricing`, `/dashboard/engine`, `/dashboard/expansion`, `/dashboard/proof`, `/dashboard/settings`, `/dashboard/more`.

## 3. Pages

### Overview (new)
- **Today band:**
  - a greeting with the community's name and the current day
  - a large brass count of shared rides, plus joined, match rate and "ride again" rate
  - a bar chart of rides per day for the last 7 days
  - the engine's buttons (Plan nudges, Match rides, Next day, Simulate 7 days)
- **Eight key numbers.** Each one counts up, shows its change over the last 7 days (↑ green / ↓ red) and has a trend line.
- **Needs your attention.** Worked out from live data, each item with a button that takes you there:
  - open reports, with high-severity ones flagged
  - members who joined but haven't shared a ride (opens Announcements with that audience already picked)
  - routes with many riders and few drivers
  - a low nudge response rate
- **How people join:** the funnel.
- **Busiest routes:** joined vs not yet joined, shown as bars.
- **Word of mouth:** referrals and the top referrers.
- **Live activity feed (new).** Sign-ups, first rides, regulars, referrals, completed and cancelled rides, ratings, accepted suggestions and expansion actions, grouped by day. App activity is tagged "App". Clicking a person opens their profile.
- **Shortcuts:** send an announcement, find a member, change pricing, see where to grow.

### Live map (rebuilt)
- **The basemap is now real streets** (OpenStreetMap) instead of an abstract drawing, muted so the data stands out. In dark mode it is inverted.
- **Members:** drivers are squares, riders are circles, and well-connected people get a ring. Colour shows how far along each person is; people who brought someone in are brass.
- **Rides and invites:** shared rides are drawn as threads from home, through the pickup, to the destination. Invites are dashed brass lines. Busy routes are blue halos, with a tooltip.
- **Replay:** play or drag through the days. People who join on the day being shown pulse as they appear.
- **Controls:**
  - layer toggles: Shared rides, Invites, Busy routes, Not joined yet
  - an Everyone / Drivers / Riders filter
  - **Find a member**: the map flies to them and opens their profile
  - a clickable list of busy routes that flies the map to each one
- **"On day N" panel:** counts per stage, with bars that move during the replay.
- **List view:** "Show as list" gives the same information as a table.

### Members (new)
- **Stage cards** at the top (Everyone, Not joined yet, Joined, Getting started, First ride done, Rides regularly, Brought someone in). Clicking one filters the table.
- **Finding people:**
  - search by name, area or destination
  - filters for role (drivers, riders, well connected) and area
  - five ways to sort
- **Table:** one row per person with avatar, commute, travels as, a stage pill, rides, last ride and "said yes". It shows 60 at a time with "Show more".
- **Export CSV (new):** downloads exactly the list you're looking at.
- **Profile sheet (upgraded):**
  - avatar and stage pill
  - a **journey timeline** (joined, got started, first ride, regular, brought someone in, each with its day)
  - commute and route facts
  - likelihood scores
  - **best ride partners (new):** the top 3 matches, with route overlap and time gap

### Rides & safety (new page, replaces the member-app panel)
- **Six tiles:** rides live now, completed, cancelled or expired, riders carried, average rating, automatic penalties.
- **Reports queue:**
  - Open / Reviewed / All tabs and a category filter
  - cards with a severity tag and colour stripe, the reported person, the reasons and the note
  - "Mark reviewed" on each open report
- **Where rides come from:** a member app vs engine split.
- **How safety works:** boarding codes, automatic penalties, report severity, live tracking. Each point was checked against the code.

### Announcements (new page, the broadcast upgraded)
- **Audiences (new):** Everyone, Drivers (members with a car saved), Riders, and **Not ridden yet**. Each shows how many people it reaches.
- **Four templates:** first ride nudge, drivers wanted, road update, thank you.
- **Live phone preview** of the notification as it will look.
- **Confirmation:** a second click confirms "send to N people". Sending is blocked when the audience is empty, with an explanation of why demo members may not receive it.
- **History (new):** everything sent before, with its audience and how many people it reached.

### Pricing
The ride pricing panel from the previous change, now its own page.

### Engine
- **Run the day:**
  - the Plan → Match → Next day loop, explained step by step
  - the simulated or calendar clock
  - the buttons
- Today's nudges and why, what predicts a yes, and the busiest routes.

### Expansion and Proof
Unchanged in content. They now sit inside the new shell, so their own headers and "Back to dashboard" links are gone.

### Settings (new)
- **Rename the community (new):** members see the new name straight away.
- **Community details:** kind, day and clock, whether the data is demo, and the destinations.
- **Invite people:**
  - the join code, with copy
  - **copy sign-up link** (opens sign-up with the code filled in)
  - **copy invite message**
  - **share on WhatsApp**
- **Appearance:** Automatic / Light / Dark, and reduce motion.
- **Account:** who's signed in, and sign out.

## 4. Backend additions

| Endpoint | What it does | Who |
|---|---|---|
| `GET /tenants/{t}/activity?limit=` | Recent milestones from the event log, newest first, with member names. Engine bookkeeping (nudges sent, offers and requests opened, matches) is left out. | Organiser |
| `POST /tenants/{t}/broadcast` | Now takes `audience`: `all`, `drivers`, `riders` or `new`. Each send is recorded. | Organiser |
| `GET /tenants/{t}/broadcasts` | Audience sizes and the last 30 announcements. | Organiser |
| `PUT /tenants/{t}` | Rename the community (2 to 120 characters, trimmed). | Organiser |

- **New table:** `broadcasts`. The server creates it on startup; no migration is needed.
- **New tests:** `backend/tests/test_organiser.py`. They cover the demo name, the activity feed, broadcast audiences and history (including 403 and 422 errors), and renaming.

## 5. Files

- **New (frontend):**
  - `frontend/src/dashboard/`: `OrgLayout.tsx`, `Overview.tsx`, `Activity.tsx`, `LiveMap.tsx`, `Members.tsx`, `RidesSafety.tsx`, `Announce.tsx`, `EnginePage.tsx`, `CommunitySettings.tsx`, `More.tsx`, `orgIcons.tsx`
  - `frontend/src/api/organiser.ts`
  - `frontend/src/styles/org.css`
- **Changed (frontend):**
  - `App.tsx`: nested `/dashboard/*` routes
  - `Panels.tsx`: shared day controls, upgraded profile sheet
  - `Expansion.tsx`, `Proof.tsx`: fit the shell
  - `lib/session.tsx`: `update()` refreshes the session without clearing loaded data
  - `lib/format.ts`: `displayName()`
  - `main.tsx`: loads `org.css`
  - `styles/app.css`: unused old dashboard styles removed
- **Removed:** `Dashboard.tsx`, `CommunityMap.tsx`, `MemberAppPanel.tsx`. Their features moved into the new pages.
- **Backend:** `models.py` (Broadcast), `schemas.py`, `api/trips.py`, `api/community.py`, `api/insights.py`, `sim/synthetic.py`, `main.py`, plus tests.
- **Docs:** `suresh430.md` (the dashboard section, the API table and the code map).

## 6. Checks run

- **Backend tests:** 89 passed. That's 85 from before, plus the 4 new ones.
- **Frontend:** the typecheck and production build pass.
- **Running app:** run locally and checked in Chrome. Overview, Live map, Members, Rides & safety, Announcements, Pricing, Engine, Expansion, Proof and Settings were checked at 1440 px in light mode. The map was also checked in dark mode, and Overview, Members and the map at phone width (390 px). The profile sheet, map replay, member search and announcement templates were clicked through. There were no console errors.

## 7. Things to know

- **Demo announcements may reach nobody.** Announcements go to members who have the app. In the demo community, a synthetic member only has the app once someone has signed in as them, so the audiences can be 0. The page says so.
- **Rides & safety counts member-app rides only.** The demo community's rides come mostly from the engine, so these tiles start near zero there. The Overview and the map include engine rides.
- **Small screens:** on phones, the members table scrolls sideways, and the map's zoom buttons are hidden (pinch to zoom).
