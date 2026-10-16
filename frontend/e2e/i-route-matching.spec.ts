// I. Bug #41 regression: "Ride search returns zero drivers for a selected pickup and drop point".
// Real routes come from OSRM and are thinned to at most 300 stored points, so on a long straight highway the stored
// points can be many km apart. The search measured the rider's pickup and drop to those points only, so a rider
// standing on the road between two of them got "0 drivers going your way". These tests post such a route and search
// from the reported workflow: pickup and drop on the road, 2 seats, a departure time, gender filter "All".
import { expect, test } from '@playwright/test';
import { V1, auth, open, postTrip, signup, appErrors } from './helpers';

// The map stubs geocode every typed place to latitude 31.5; this highway runs east along it with stored points
// ~23.7 km apart (77.40, 77.65, 77.90): roughly what thinning leaves on a long, straight expressway.
const LAT = 31.5;
const SPARSE: [number, number][] = [[LAT, 77.4], [LAT, 77.65], [LAT, 77.9]];
// the helper's default route_km describes its own short test route; this highway is ~47.5 km end to end,
// and a ride whose declared length is under the straight line between its ends is refused (engine/trips.py)
const SPARSE_LEN = { route_km: 47.6, route_min: 50 };
const PICKUP = { name: 'Bangalore–Nelamangala Expressway, Dodda Bidarakallu', lat: LAT, lon: 77.52 };   // 11.9 km from a stored point
const DROP_TYPED = 'Vaddarahalli Machohalli';   // the stub puts it at lon 77.70: on the road, 4.7 km from a stored point

test.describe('I. Route matching (bug #41)', () => {
  test('I41a API: a ride is found when pickup and drop are on the road between stored points', async ({ request }) => {
    const d = await signup(request, 'Sparse Driver', 'male');
    const r = await signup(request, 'Sparse Rider');
    const { trip } = await postTrip(request, d, { route: SPARSE, minutes: 60, seats: 3, extra: SPARSE_LEN });
    const q = (p: Record<string, number | string>) => request.get(`${V1}/trips/search`, { headers: auth(r), params: p });
    const ids = (rows: { id: number }[]) => rows.map((x) => x.id);

    const res = await q({ from_lat: LAT, from_lon: 77.52, to_lat: LAT, to_lon: 77.7 });
    expect(res.status()).toBe(200);
    const rows = await res.json();
    expect(ids(rows)).toContain(trip.id);
    const row = rows.find((x: { id: number }) => x.id === trip.id);
    expect(row.pickup_km).toBeLessThan(0.1);
    expect(row.drop_km).toBeLessThan(0.1);
    expect(row.rider_km).toBeGreaterThan(16);   // 77.52 -> 77.70 along the road is ~17 km
    expect(row.rider_km).toBeLessThan(18);

    const at = new Date(Date.now() + 60 * 60_000).toISOString();
    expect(ids(await (await q({ from_lat: LAT, from_lon: 77.52, to_lat: LAT, to_lon: 77.7, when: at })).json())).toContain(trip.id);
    // the existing rules still hold: wrong direction, far off the road
    expect(ids(await (await q({ from_lat: LAT, from_lon: 77.7, to_lat: LAT, to_lon: 77.52 })).json())).not.toContain(trip.id);
    expect(ids(await (await q({ from_lat: LAT + 0.1, from_lon: 77.52 })).json())).not.toContain(trip.id);
    await request.post(`${V1}/trips/${trip.id}/cancel`, { headers: auth(d) });
  });

  test('I41b UI: the reported Find rides workflow lists the driver and lets the rider ask for 2 seats', async ({ browser, request }) => {
    const d = await signup(request, 'Highway Harish', 'male');
    const r = await signup(request, 'Highway Rider');
    const departs = Date.now() + 60 * 60_000;
    const { trip } = await postTrip(request, d, { route: SPARSE, minutes: 60, seats: 3, extra: SPARSE_LEN });
    const w = await open(browser, r, { pickup: PICKUP });
    // map tiles and web fonts are only pictures; refuse them here so the run doesn't depend on internet access
    // (helpers.appErrors already ignores the resulting net::ERR_FAILED; API failures are still tracked in w.failed)
    await w.context.route(/tile\.openstreetmap\.org|fonts\.(googleapis|gstatic)\.com/, (x) => x.abort());
    try {
      await w.page.goto('/find');
      // drop point
      await w.page.getByPlaceholder('Where you’re going').fill(DROP_TYPED);
      await w.page.getByRole('listbox', { name: /Drop \(optional\) suggestions/ }).getByRole('button').first().click();
      // departure time (in the browser's own time zone, as a person would pick it) and 2 seats
      const local = await w.page.evaluate((ms) => {
        const t = new Date(ms); t.setSeconds(0, 0);
        return new Date(t.getTime() - t.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
      }, departs);
      await w.page.locator('input[type="datetime-local"]').fill(local);
      await w.page.getByRole('button', { name: 'One more seat' }).click();
      await expect(w.page.locator('.seat-stepper output')).toHaveText('2');

      const searched = w.page.waitForResponse((x) => x.url().includes('/api/v1/trips/search'));
      await w.page.getByRole('button', { name: /Find rides/ }).click();
      expect((await searched).status()).toBe(200);

      await expect(w.page.getByRole('button', { name: 'All', pressed: true })).toBeVisible();   // gender filter "All"
      await expect(w.page.getByText('No rides pass near you yet.')).toHaveCount(0);
      await expect(w.page.locator('#results-h')).not.toHaveText(/^0 drivers/);
      const card = w.page.locator('article.ride-card', { hasText: 'Highway Harish' });
      await expect(card).toBeVisible();
      await expect(card).toContainText(/3 seats left/);

      await card.getByRole('button', { name: 'Ask for 2 seats' }).click();
      await expect.poll(async () => {
        const t = await (await request.get(`${V1}/trips/${trip.id}`, { headers: auth(d) })).json();
        return t.riders.map((x: { status: string; seats: number }) => `${x.status}:${x.seats}`);
      }).toEqual(['pending:2']);
      expect(appErrors(w.consoleErrors)).toEqual([]);
      expect(w.failed).toEqual([]);
    } finally {
      await w.context.close();
      await request.post(`${V1}/trips/${trip.id}/cancel`, { headers: auth(d) });
    }
  });
});
