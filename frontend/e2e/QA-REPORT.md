# FellaRide QA report (bugbounty branch)

**Branch tested:** `bugbounty` at `18c524a` (identical to `main`), plus the fixes below, which are uncommitted.
**Test run:** 15 Oct 2026, macOS, Playwright 1.64.1 (Chromium, Firefox, WebKit), pytest for the backend.

## Results

| Suite | Scenarios / tests | Passed | Failed | Skipped | Blocked |
|---|---|---|---|---|---|
| Playwright, Chromium | 57 scenarios | 57 | 0 | 0 | 0 |
| Playwright, Firefox (`@cross` tag) | 5 | 5 | 0 | 0 | 0 |
| Playwright, WebKit (`@cross` tag) | 5 | 5 | 0 | 0 | 0 |
| **Playwright total** | **67 runs** | **67** | **0** | **0** | **0** |
| Backend (pytest) | 66 | 66 | 0 | 0 | 0 |

The full Playwright suite passed 3 times in a row after the fixes, with no flaky tests and no retries; retries are switched off on purpose.

**Coverage by category** (the scenario list with per-browser status is in the HTML report):

| Category | Scenarios | Notes |
|---|---|---|
| A. Startup and navigation | A1–A5 | every signed-out route, buttons, unknown URLs, refresh and deep links |
| B. Authentication and authorization | B6–B15 | sign-up and sign-in in the UI, validation, duplicates, no account enumeration, sign-out, bad/expired/forged tokens, organiser-only APIs, deletion revokes the token |
| C. Validation and errors | C14–C18 | empty, malformed, oversized and wrong-typed input, boundaries (password 8/72, seats 1–8, ±7 days), plain-language errors, API outage, unreachable API, garbled responses |
| D. Core workflows | D19–D31 | offer a ride in the UI, search rules, ride details, ask, approve, decline, full rides, cancel in time, 10-minute lock, multi-seat, full ride lifecycle with ratings, driver cancels, impossible ride |
| E. API | E31–E38 | response shapes, no-profit pricing cap, ownership (403), privacy of ride details, 404/409 and idempotency, live-tracking and UPI rules, API vs stored data, public endpoint exposure, expensive endpoints |
| F. Frontend and backend integration | F39–F44 | exact request payloads, loading states, updates without reload, persistence after refresh, double tap on a slow network, the driver screen refreshing on its own |
| G. Integrity and security | G45–G49 | 5 parallel identical sign-ups, 5 parallel approvals of the last seat, cross-user tampering, SQL/HTML/script injection, account deletion consistency |
| H. Browsers and UI | H50–H54 | three engines, 360 px and 1366 px without sideways scroll, a whole flow with zero console errors or failed API calls, repeated actions, field sizing |

## Confirmed bugs (all fixed, each with a regression test)

### 1. MEDIUM: parallel approvals overbook a ride on SQLite (production Postgres not affected)
- **Steps:** a 1-seat ride with 5 waiting riders; the driver's approvals of all 5 arrive at the same moment (`POST /trips/{id}/seats/{seat}/approve` × 5 in parallel).
- **Expected:** one approved, four told "Your car is already full" (409).
- **Actual:** all five got HTTP 200 and were approved, so 5 riders were confirmed for 1 seat.
- **Root cause:** the seat lock uses `SELECT … FOR UPDATE`, which SQLite silently ignores, and SQLite only takes its write lock at the first write. So every request read "1 seat left" before any of them wrote. The code comment claimed SQLite was safe without the lock; that was wrong. **Production (Supabase Postgres) was not affected:** the lock works there, as shown earlier with the Postgres race check (`backend/scripts/race_check.py`). It affected local development and anyone running on SQLite.
- **Fix:** `backend/app/engine/trips.py` `lock_trip`: on SQLite, a no-op `UPDATE` on the ride's row takes the write lock up front, so other writers wait until this request commits.
- **Regression tests:** e2e `G46`; backend `test_parallel_approvals_of_the_last_seat_approve_exactly_one`. **Verified against the unfixed code:** all five approvals succeeded (`[200, 200, 200, 200, 200]`). With the fix: `[200, 409, 409, 409, 409]`.

### 2. MEDIUM: the Offer screen accepts an impossible ride and fails at the last step with a technical error
- **Steps:** Offer a ride from Bengaluru with "Tech Park Gate" as the destination. Place search isn't limited by region, and in WebKit it picked a "Tech Park" in London. Then Next, then Confirm route & post.
- **Expected:** the driver is told the trip is too long before confirming.
- **Actual:** a **10,852 km "route"** with a ₹32,555 seat price reached the confirmation screen. Posting then failed with *"route_km: Input should be less than or equal to 2000. route_min: Input should be less than or equal to 3000"*.
- **Root cause:** the server enforces `route_km ≤ 2000` and `route_min ≤ 3000` (`schemas.TripIn`), but the Offer screen never checked them, and the error text used raw field names.
- **Fix:** `frontend/src/member/Offer.tsx` keeps only routes within the server's limits. If none are left, it says *"That trip is about N km. A ride can be up to 2,000 km, so check the From and To places."* `frontend/src/api/client.ts` adds readable names for `route_km`, `route_min`, `depart_at`, `price_per_km` and `upi_id`.
- **Regression test:** e2e `D31`. **Verified against the unfixed code:** fails, because no clear message appears.

### 3. LOW: a quick double tap sends an action twice
- **Steps:** on a ride, tap "Ask … for a seat" twice within a few milliseconds, as a fast double tap on a phone does.
- **Expected:** one request.
- **Actual:** two requests. The button only disables once the screen redraws. "Ask" is merged by the server (1 stored), but the same handler sends approve, decline, board, paid and received. A duplicate approve shows a confusing "You've already answered this request" error.
- **Fix:** `frontend/src/member/TripScreen.tsx` (`act`) and `frontend/src/member/Find.tsx` (`ask`) ignore a second tap while the first is in flight.
- **Regression test:** e2e `F43`, which fires two real clicks in the same moment and asserts one request reached the network.

### 4. LOW: sign-up Join code and Referral code fields became huge
- **Steps:** open `/signup`.
- **Expected:** normal-sized inputs.
- **Actual:** 28 px, centred text with wide letter spacing.
- **Root cause:** the new forgot-password code box reused the class `.code-input`, which the sign-up fields already used. The later rule overrode the earlier one.
- **Fix:** the reset-code box now has its own class, `.otp-input` (`frontend/src/auth/AuthScreens.tsx`, `frontend/src/styles/app.css`).
- **Regression test:** e2e `H54`, which checks the font size, the alignment, and that the placeholder fits at 360 px.

## Observations (not changed; decisions for the team)

| # | Severity | Observation | Recommendation |
|---|---|---|---|
| O1 | Low–Medium | **Sign-out is client-side only.** Login tokens are stateless JWTs, so a copied token still works after sign-out until it expires (B12 recorded HTTP 200 for the old token). Changing the password or deleting the account does revoke it, as B15 shows. | Bump a per-user token version on sign-out (the `pv` claim already exists), or shorten token life. |
| O2 | Low | Tokens issued without a `pv` claim skip the password-version check (`auth.current_actor`). All current tokens include `pv`, and forging one needs the server secret. | Require `pv` once old tokens have expired. |
| O3 | Low | Place search isn't biased towards the community's region strongly enough, which is how a London "Tech Park" was offered from Bengaluru. | Tighten the Nominatim view box or add `countrycodes=in`. |
| O4 | Info | E38: `POST /tenants/demo` and `POST /demo/compare` refuse anonymous callers (good). | none |

## Test-environment notes (not app defects)
- **Isolation:** tests run against their own API on a fresh SQLite database (port 8031) and their own web app (port 5175). The shared Supabase database and the developer servers were never touched.
- **Outside services:** OpenStreetMap place search is stubbed. Routing is made to fail on purpose so the app's straight-line fallback is exercised. Map tiles and Google Fonts aren't stubbed; WebKit's sandbox reports them as "offline", and those console messages are filtered. Failed calls to the app's own API are tracked separately, by URL, and fail the test.
- **Service workers are blocked in tests:** in WebKit, requests through the app's service worker bypass Playwright's network stubs.
- **Requests cancelled by navigation** (leaving a page while a request is in flight) aren't counted as API failures in any browser.
- **Concurrency:** these tests use SQLite. Postgres behaviour was verified separately with `backend/scripts/race_check.py`: 0 deadlocks and no double bookings.

## Files changed

| File | Change |
|---|---|
| `backend/app/engine/trips.py` | Bug 1: SQLite write lock in `lock_trip` |
| `backend/tests/test_trips.py` | Bug 1 regression test |
| `frontend/src/member/Offer.tsx` | Bug 2: route limits and a clear message |
| `frontend/src/api/client.ts` | Bug 2: readable field names in errors |
| `frontend/src/member/TripScreen.tsx`, `frontend/src/member/Find.tsx` | Bug 3: double-tap guard |
| `frontend/src/auth/AuthScreens.tsx`, `frontend/src/styles/app.css` | Bug 4: separate `.otp-input` class |
| `frontend/playwright.config.ts`, `frontend/e2e/*` | new test suite and this report |
| `frontend/package.json`, `frontend/package-lock.json`, `frontend/.gitignore` | Playwright dev dependency, `test:e2e` scripts, ignore test output |

Nothing has been committed, pushed or deployed.

## How to run

```bash
cd frontend
npx playwright install chromium firefox webkit   # once
npm run test:e2e                                  # all tests (starts its own API and web app on a fresh database)
npx playwright test --project=chromium            # Chromium only
npx playwright test e2e/d-workflows.spec.ts       # one file
npm run test:e2e:report                           # open the HTML report

cd ../backend && .venv/bin/python -m pytest -q    # backend tests
```

- **Tests:** `frontend/e2e/*.spec.ts`, with shared helpers in `frontend/e2e/helpers.ts`
- **Config:** `frontend/playwright.config.ts`
- **HTML report:** `frontend/e2e/report/index.html`
- **Traces, screenshots and the test API log:** `frontend/e2e/.tmp/`

## Recommended next steps, by severity
1. **Medium:** commit the bug 2 fix, which users on the live site can hit, and restrict place search to the region (O3).
2. **Medium:** commit the bug 1 fix. Production is safe, but local and test runs can overbook.
3. **Low–Medium:** decide on server-side sign-out (O1).
4. **Low:** commit the bug 3 and bug 4 fixes; plan to require `pv` (O2).
5. **Testing:** run `npm run test:e2e` before each push, and consider a CI job. The suite takes about 1 minute.
