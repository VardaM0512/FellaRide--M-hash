// E. API tests: real requests with Playwright's request fixture, checking status, response shape, rules and side effects.
import { expect, test } from '@playwright/test';
import { API, askAndApprove, auth, getTrip, postTrip, signup, V1 } from './helpers';

test.describe('E. API', () => {
  test('E31 health, docs and the public impact endpoint answer with the documented shapes', async ({ request }) => {
    expect(await (await request.get(`${API}/health`)).json()).toMatchObject({ status: 'ok', model_loaded: expect.any(Boolean) });
    expect((await request.get(`${API}/docs`)).status()).toBe(200);
    const spec = await (await request.get(`${API}/openapi.json`)).json();
    expect(Object.keys(spec.paths).length).toBeGreaterThan(80);
    const impact = await (await request.get(`${V1}/community/impact`)).json();
    for (const k of ['people', 'connections', 'rides', 'seats', 'km_shared', 'co2_kg', 'trees_year', 'communities']) {
      expect(typeof impact[k], k).toBe('number');
      expect(impact[k], k).toBeGreaterThanOrEqual(0);
    }
    expect(typeof impact.includes_demo).toBe('boolean');
  });

  test('E32 posting a ride returns the full ride, priced within the no-profit cap', async ({ request }) => {
    const d = await signup(request, 'Shape Driver', 'male');
    const { trip } = await postTrip(request, d, { seats: 3, extra: { upi_id: 'shape.driver@okaxis' } });
    expect(trip).toMatchObject({
      id: expect.any(Number), status: 'open', you: 'driver', seats_total: 3, seats_left: 3, code: expect.stringMatching(/^\d{4}$/),
      price: { per_km: 3, max_per_km: 3, trip_cost: Math.round(9 * 11.2), free: false }, can_cancel: true, riders: [],
    });
    expect(trip.price.full_route_per_seat * trip.seats_total).toBeLessThanOrEqual(trip.price.trip_cost);
    const over = await request.post(`${V1}/trips`, { headers: auth(await signup(request, 'Greedy Driver', 'male')), data: {
      ...{ from_name: 'A', from_lat: 9, from_lon: 77.5, to_name: 'B', to_lat: 9, to_lon: 77.6, route: [[9, 77.5], [9, 77.6]], route_km: 11, route_min: 20 },
      depart_at: new Date(Date.now() + 3_600_000).toISOString(), seats: 3, licence_confirmed: true, cost_share_confirmed: true, price_per_km: 5 } });
    expect(over.status()).toBe(422);
    expect((await over.json()).detail).toMatch(/cost-sharing only/);
    const noPromise = await request.post(`${V1}/trips`, { headers: auth(await signup(request, 'No Promise', 'male')), data: {
      from_name: 'A', from_lat: 9.2, from_lon: 77.5, to_name: 'B', to_lat: 9.2, to_lon: 77.6, route: [[9.2, 77.5], [9.2, 77.6]], route_km: 11,
      route_min: 20, depart_at: new Date(Date.now() + 3_600_000).toISOString(), seats: 3, licence_confirmed: true } });
    expect(noPromise.status()).toBe(422);
  });

  test('E33 riders cannot act as the driver, and strangers cannot read a ride’s private parts', async ({ request }) => {
    const d = await signup(request, 'Owner Driver', 'male');
    const r = await signup(request, 'Plain Rider');
    const stranger = await signup(request, 'Stranger');
    const { trip } = await postTrip(request, d);
    await request.post(`${V1}/trips/${trip.id}/request`, { headers: auth(r), data: {} });
    const seat = (await getTrip(request, d, trip.id)).riders[0].seat_id;
    for (const path of [`seats/${seat}/approve`, `seats/${seat}/reject`, `seats/${seat}/board`, `seats/${seat}/received`, 'start', 'cancel']) {
      const res = await request.post(`${V1}/trips/${trip.id}/${path}`, { headers: auth(r) });
      expect(res.status(), `rider -> ${path}`).toBe(403);
    }
    expect((await request.get(`${V1}/trips/${trip.id}/messages`, { headers: auth(stranger) })).status()).toBe(403);
    expect((await request.post(`${V1}/trips/${trip.id}/messages`, { headers: auth(stranger), data: { body: 'hi' } })).status()).toBe(403);
    const seen = await getTrip(request, stranger, trip.id);
    expect(seen.code).toBeNull();
    expect(seen.riders).toEqual([]);                  // other people's requests are never shown
    expect(seen.driver.mobile).toBeUndefined();
    expect((await getTrip(request, r, trip.id)).code).toBeNull();   // asking isn't enough to see the code
  });

  test('E34 not-found and duplicate cases answer 404 / 409, or idempotently', async ({ request }) => {
    const d = await signup(request, 'Dup Driver', 'male');
    const r = await signup(request, 'Dup Rider');
    expect((await request.get(`${V1}/trips/987654321`, { headers: auth(r) })).status()).toBe(404);
    expect((await request.post(`${V1}/trips/987654321/request`, { headers: auth(r), data: {} })).status()).toBe(404);
    const { trip } = await postTrip(request, d);
    expect((await request.post(`${V1}/trips/${trip.id}/seats/987654321/approve`, { headers: auth(d) })).status()).toBe(404);
    const second = await request.post(`${V1}/trips`, { headers: auth(d), data: { from_name: 'A', from_lat: 9.4, from_lon: 77.5, to_name: 'B',
      to_lat: 9.4, to_lon: 77.6, route: [[9.4, 77.5], [9.4, 77.6]], route_km: 11, route_min: 20, seats: 2,
      depart_at: new Date(Date.now() + 3_600_000).toISOString(), licence_confirmed: true, cost_share_confirmed: true } });
    expect(second.status()).toBe(409);                // one open ride per driver at a time
    const a = await request.post(`${V1}/trips/${trip.id}/request`, { headers: auth(r), data: {} });
    const b = await request.post(`${V1}/trips/${trip.id}/request`, { headers: auth(r), data: {} });
    expect([a.status(), b.status()]).toEqual([200, 200]);
    expect((await getTrip(request, d, trip.id)).riders).toHaveLength(1);   // asking twice is one request
    expect((await request.post(`${V1}/trips/${trip.id}/request`, { headers: auth(d), data: {} })).status()).toBe(409); // own ride
    expect((await request.get(`${V1}/referral/NOPE0000`)).status()).toBe(404);
  });

  test('E35 live tracking and settling-up rules are enforced by the server', async ({ request }) => {
    const d = await signup(request, 'Track Driver', 'male');
    const r = await signup(request, 'Track Rider');
    const far = await postTrip(request, d, { minutes: 120 });
    const seatFar = await askAndApprove(request, d, r, far.trip.id);
    expect((await request.post(`${V1}/trips/${far.trip.id}/location`, { headers: auth(d), data: { lat: 9, lon: 77.5 } })).status()).toBe(409); // too early
    expect(seatFar).toBeGreaterThan(0);
    await request.post(`${V1}/trips/${far.trip.id}/withdraw`, { headers: auth(r) });
    await request.post(`${V1}/trips/${far.trip.id}/cancel`, { headers: auth(d) });

    const { trip, route: rt } = await postTrip(request, d, { minutes: 20, extra: { upi_id: 'track.driver@okicici' } });
    await askAndApprove(request, d, r, trip.id, { pickup_name: 'Stop', pickup_lat: rt[5][0], pickup_lon: rt[5][1] });
    expect((await request.post(`${V1}/trips/${trip.id}/location`, { headers: auth(d), data: { lat: 999, lon: 77 } })).status()).toBe(422);
    expect((await request.post(`${V1}/trips/${trip.id}/location`, { headers: auth(d), data: { lat: rt[1][0], lon: rt[1][1], speed_kmh: 30 } })).status()).toBe(200);
    const live = (await getTrip(request, r, trip.id)).live;
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ role: 'driver', km_to_you: expect.any(Number), eta_min: expect.any(Number) });
    expect(live[0].km_to_you).toBeGreaterThan(3);
    expect(live[0].km_to_you).toBeLessThan(6);
    const mine = await getTrip(request, r, trip.id);
    expect(mine.pay_to.link).toMatch(/^upi:\/\/pay\?pa=track\.driver@okicici&/);
    expect(mine.pay_to.link).toContain(`am=${mine.my_seat.contribution}`);
    expect((await request.put(`${V1}/me/upi`, { headers: auth(d), data: { upi_id: 'not a upi id' } })).status()).toBe(422);
  });

  test('E36 what the API says after each change matches what is stored', async ({ request }) => {
    const d = await signup(request, 'Consistent Driver', 'male');
    const riders = await Promise.all([signup(request, 'C One'), signup(request, 'C Two')]);
    const { trip } = await postTrip(request, d, { seats: 3 });
    for (const [i, r] of riders.entries()) {
      const after = await (await request.post(`${V1}/trips/${trip.id}/request`, { headers: auth(r), data: { seats: i + 1 } })).json();
      expect(after.seats_left).toBe(3);               // asking holds nothing
    }
    const rows = (await getTrip(request, d, trip.id)).riders;
    const approved = await (await request.post(`${V1}/trips/${trip.id}/seats/${rows[1].seat_id}/approve`, { headers: auth(d) })).json();
    expect(approved.seats_left).toBe(1);              // the 2-seat request
    const fresh = await getTrip(request, d, trip.id);
    expect(fresh.seats_left).toBe(approved.seats_left);
    expect(fresh.riders.map((x: { status: string }) => x.status).sort()).toEqual(['approved', 'pending']);
    const mine = (await (await request.get(`${V1}/me/trips`, { headers: auth(riders[1]) })).json()).active;
    expect(mine.id).toBe(trip.id);
    expect(mine.my_seat).toMatchObject({ status: 'approved', seats: 2 });
  });

  test('E37 public endpoints expose only what they should', async ({ request }) => {
    const s = await signup(request, 'Public Check');
    const ref = await (await request.get(`${V1}/me/referrals`, { headers: auth(s) })).json();
    const pub = await (await request.get(`${V1}/referral/${ref.code}`)).json();
    expect(JSON.stringify(pub)).not.toContain(s.user.email);
    expect(JSON.stringify(pub)).not.toContain(s.profile!.mobile);
    const tenants = await (await request.get(`${V1}/tenants`)).json();
    expect(JSON.stringify(tenants)).not.toMatch(/password|join_code|@example\.org/i);
  });

  test('E38 expensive demo endpoints cannot be run by anonymous callers', async ({ request }) => {
    const anon = await request.post(`${V1}/tenants/demo`, { data: { seed_active: 5 } });
    expect([401, 403], `POST /tenants/demo -> ${anon.status()}`).toContain(anon.status());
    const cmp = await request.post(`${V1}/demo/compare`, { data: { days: 5, seed_active: 5 } });
    expect([401, 403], `POST /demo/compare -> ${cmp.status()}`).toContain(cmp.status());
  });
});
