// Shared helpers for the end-to-end tests: test users and rides made through the real API, signed-in browser
// contexts, console/network error capture, and stubs for the two outside map services (place search, routing).
import { createHmac } from 'node:crypto';
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const API = 'http://localhost:8031';
export const V1 = `${API}/api/v1`;
export const PASSWORD = 'e2e-pass-1234';
export const JWT_SECRET = 'e2e-only-secret-e2e-only-secret-e2e-only-secret';   // the test server's own secret

// unique per worker process and call, so parallel tests never share an email, mobile number or route
let counter = 0;
const worker = process.pid % 1000;
export function uniq(): string {
  counter += 1;
  return `${worker}${String(counter).padStart(4, '0')}`;
}

export interface Session {
  token: string;
  user: { id: number; email: string; role: string; tenant_id: number };
  profile: { name: string; gender: string; mobile: string } | null;
  tenant: { id: number; name: string };
}

export async function signup(request: APIRequestContext, name = 'Test Rider', gender = 'female', extra: Record<string, unknown> = {}): Promise<Session> {
  const u = uniq();
  const r = await request.post(`${V1}/auth/signup`, {
    data: { name, gender, email: `e2e.${u}@example.org`, mobile: `9${u.padStart(9, '7')}`.slice(0, 10), password: PASSWORD, ...extra },
  });
  expect(r.status(), await r.text()).toBe(201);
  return r.json();
}

export const auth = (s: Session | string) => ({ Authorization: `Bearer ${typeof s === 'string' ? s : s.token}` });

/** A straight route heading east, at a latitude no other test uses (routes > 2.5 km apart never match each other). */
export function route(): [number, number][] {
  const slot = (worker * 131 + counter * 17) % 700;
  counter += 1;
  const lat = 8 + slot * 0.03;
  return Array.from({ length: 11 }, (_, i) => [+lat.toFixed(5), +(77.55 + i * 0.01).toFixed(5)] as [number, number]);
}

export async function postTrip(request: APIRequestContext, driver: Session, opts: {
  minutes?: number; seats?: number; route?: [number, number][]; extra?: Record<string, unknown>;
} = {}) {
  const r0 = opts.route ?? route();
  const [a, b] = [r0[0], r0[r0.length - 1]];
  const res = await request.post(`${V1}/trips`, {
    headers: auth(driver),
    data: {
      from_name: 'Lakeview Gate', from_lat: a[0], from_lon: a[1], to_name: 'Tech Park', to_lat: b[0], to_lon: b[1],
      depart_at: new Date(Date.now() + (opts.minutes ?? 45) * 60_000).toISOString(), route: r0, route_km: 11.2, route_min: 25,
      seats: opts.seats ?? 3, licence_confirmed: true, cost_share_confirmed: true,
      car: { model: 'Maruti Swift', colour: 'White', plate: 'KA 01 AB 1234' }, ...opts.extra,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { trip: await res.json(), route: r0 };
}

export async function getTrip(request: APIRequestContext, who: Session, tripId: number) {
  const r = await request.get(`${V1}/trips/${tripId}`, { headers: auth(who) });
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
}

/** Rider asks; driver approves. Returns the rider's seat id. */
export async function askAndApprove(request: APIRequestContext, driver: Session, rider: Session, tripId: number, body: Record<string, unknown> = {}) {
  const ask = await request.post(`${V1}/trips/${tripId}/request`, { headers: auth(rider), data: body });
  expect(ask.status(), await ask.text()).toBe(200);
  const t = await getTrip(request, driver, tripId);
  const seat = t.riders.find((x: { person: { id: number } }) => x.person.id === rider.user.id).seat_id;
  const ok = await request.post(`${V1}/trips/${tripId}/seats/${seat}/approve`, { headers: auth(driver) });
  expect(ok.status(), await ok.text()).toBe(200);
  return seat as number;
}

/** HS256 token signed with the test server's secret, for expired / tampered token tests. */
export function signJwt(payload: Record<string, unknown>, secret = JWT_SECRET): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${head}.${createHmac('sha256', secret).update(head).digest('base64url')}`;
}

export interface Watched { context: BrowserContext; page: Page; consoleErrors: string[]; failed: string[] }

/** A fresh, isolated browser context (optionally signed in), recording console errors, page crashes and failed API calls. */
export async function open(browser: Browser, session: Session | null, opts: {
  viewport?: { width: number; height: number }; pickup?: { name: string; lat: number; lon: number };
} = {}): Promise<Watched> {
  // service workers are blocked: requests they make can't be intercepted (WebKit sent place search straight to the
  // real internet), and the app works without one
  const context = await browser.newContext({ viewport: opts.viewport ?? { width: 420, height: 900 }, serviceWorkers: 'block' });
  await stubMaps(context);
  await context.addInitScript(([s, pickup]) => {
    if (sessionStorage.getItem('e2e-seeded')) return;   // only on the tab's first page, so signing out sticks
    sessionStorage.setItem('e2e-seeded', '1');
    if (s) localStorage.setItem('fellaride.session', JSON.stringify(s));
    if (s && pickup) localStorage.setItem(`fr.pickup.${(s as Session).user.id}`, JSON.stringify(pickup));
  }, [session, opts.pickup ?? null] as const);
  const page = await context.newPage();
  const consoleErrors: string[] = [], failed: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.url().startsWith(API) && r.status() >= 500) failed.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? '';
    // leaving a page cancels its in-flight requests in every browser ("cancelled", ERR_ABORTED, NS_BINDING_ABORTED):
    // that is navigation, not a failing API. Refused connections, timeouts and server errors are still counted.
    if (r.url().startsWith(API) && !/cancelled|ERR_ABORTED|NS_BINDING_ABORTED/i.test(why)) failed.push(`failed ${r.url()} ${why}`);
  });
  return { context, page, consoleErrors, failed };
}

/** Outside services the app calls from the browser: answer them locally so tests don't depend on the internet.
 *  Map tiles are left alone (they're only pictures). Routing fails on purpose, so the app uses its straight-line
 *  fallback, which is a real code path. */
const CORS = { 'Access-Control-Allow-Origin': '*' };   // the real service sends it; WebKit enforces it strictly

export async function stubMaps(context: BrowserContext) {
  await context.route('https://nominatim.openstreetmap.org/**', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith('/reverse')) {
      return r.fulfill({ headers: CORS, json: { display_name: 'Test Street, Testville', name: 'Test Street', address: { road: 'Test Street' } } });
    }
    const q = u.searchParams.get('q') || 'place';
    if (/london/i.test(q)) {   // a real faraway place, for the "impossible ride" test
      return r.fulfill({ headers: CORS, json: [{ display_name: 'London, Greater London, England', name: 'London', lat: '51.5074', lon: '-0.1278' }] });
    }
    // different names land in different spots (so a ride has a real length), always in the same test area
    const lon = 77.55 + ([...q].reduce((a, c) => a + c.charCodeAt(0), 0) % 20) * 0.01;
    return r.fulfill({ headers: CORS, json: [{ display_name: `${q}, Testville`, name: q, lat: '31.5', lon: lon.toFixed(4) }] });
  });
  await context.route('https://router.project-osrm.org/**', (r) => r.abort());
}

/** Console errors that are about the test environment, not the app: outside resources we don't stub (map tiles,
 *  Google Fonts) that the WebKit sandbox reports as "offline". Failed calls to the app's own API are tracked
 *  separately in `failed` (by URL), so filtering these messages can't hide an API failure. */
export const appErrors = (errs: string[]) => errs.filter((e) =>
  !/tile\.openstreetmap|favicon|ERR_NAME_NOT_RESOLVED|net::ERR_FAILED|fonts\.googleapis|Internet connection appears to be offline/.test(e));
