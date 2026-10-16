// G. Data integrity, security and edge cases
import { expect, test } from '@playwright/test';
import { askAndApprove, auth, getTrip, open, PASSWORD, postTrip, signup, uniq, V1 } from './helpers';

test.describe('G. Integrity and security', () => {
  test('G45 the same sign-up sent five times at once creates exactly one account', async ({ request }) => {
    const u = uniq();
    const body = { name: 'Race Signup', gender: 'female', email: `e2e.race.${u}@example.org`, mobile: `6${u.padStart(9, '8')}`.slice(0, 10), password: PASSWORD };
    const codes = (await Promise.all(Array.from({ length: 5 }, () => request.post(`${V1}/auth/signup`, { data: body })))).map((r) => r.status());
    expect(codes.filter((c) => c === 201), `statuses ${codes}`).toHaveLength(1);
    expect(codes.filter((c) => c >= 500), `no server errors: ${codes}`).toHaveLength(0);
    expect(codes.filter((c) => c === 409)).toHaveLength(4);
  });

  test('G46 parallel approvals of the last seat approve exactly one rider', async ({ request }) => {
    const d = await signup(request, 'Busy Driver', 'male');
    const { trip } = await postTrip(request, d, { seats: 1 });
    const riders = await Promise.all(Array.from({ length: 5 }, (_, i) => signup(request, `Rider ${i}`)));
    for (const r of riders) await request.post(`${V1}/trips/${trip.id}/request`, { headers: auth(r), data: {} });
    const seats = (await getTrip(request, d, trip.id)).riders.map((x: { seat_id: number }) => x.seat_id);
    const codes = (await Promise.all(seats.map((s: number) => request.post(`${V1}/trips/${trip.id}/seats/${s}/approve`, { headers: auth(d) }))))
      .map((r) => r.status());
    expect(codes.filter((c) => c === 200), `statuses ${codes}`).toHaveLength(1);
    expect(codes.filter((c) => c >= 500), `no server errors: ${codes}`).toHaveLength(0);
    const after = await getTrip(request, d, trip.id);
    expect(after.seats_left).toBe(0);
    expect(after.riders.filter((x: { status: string }) => x.status === 'approved')).toHaveLength(1);
  });

  test('G47 nobody can change someone else’s seat, post, payment or alerts', async ({ request }) => {
    const d = await signup(request, 'Owner D', 'male');
    const a = await signup(request, 'Owner A');
    const b = await signup(request, 'Intruder B');
    const { trip } = await postTrip(request, d);
    await askAndApprove(request, d, a, trip.id);
    // B "withdrawing" only ever touches B's own (non-existent) seat
    expect((await request.post(`${V1}/trips/${trip.id}/withdraw`, { headers: auth(b) })).status()).toBe(409);
    expect((await request.post(`${V1}/trips/${trip.id}/paid`, { headers: auth(b) })).status()).toBe(409);
    expect((await getTrip(request, d, trip.id)).riders[0].status).toBe('approved');
    // B can't delete A's community post
    const post = await (await request.post(`${V1}/community/posts`, { headers: auth(a), data: { kind: 'update', body: 'Mine' } })).json();
    const del = await request.delete(`${V1}/community/posts/${post.id}`, { headers: auth(b) });
    expect([403, 404]).toContain(del.status());
    // alerts are always the caller's own
    const bAlerts = (await (await request.get(`${V1}/me/alerts`, { headers: auth(b) })).json()).items;
    expect(bAlerts.some((x: { trip_id: number }) => x.trip_id === trip.id)).toBeFalsy();
    // B can't rate a ride B wasn't on
    const rate = await request.post(`${V1}/trips/${trip.id}/ratings`, { headers: auth(b), data: { to_id: d.user.id, stars: 1 } });
    expect(rate.status()).toBeGreaterThanOrEqual(400);
  });

  test('G48 injection attempts are treated as plain data', async ({ browser, request }) => {
    for (const email of ["' OR '1'='1' --", 'admin@demo.fellaride.app\'--', '"; DROP TABLE users; --']) {
      const r = await request.post(`${V1}/auth/login`, { data: { email, password: "' OR '1'='1" } });
      expect([401, 422], email).toContain(r.status());
    }
    const s = await signup(request, 'Search Injector');
    const q = await request.get(`${V1}/trips/search`, { headers: auth(s), params: { from_lat: '12 OR 1=1', from_lon: '77' } });
    expect(q.status()).toBe(422);
    // a chat message with HTML in it is shown as text, never run
    const d = await signup(request, 'Kiran Desai', 'male');
    const { trip } = await postTrip(request, d);
    await askAndApprove(request, d, s, trip.id);
    const payload = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
    expect((await request.post(`${V1}/trips/${trip.id}/messages`, { headers: auth(d), data: { body: payload } })).status()).toBeLessThan(300);
    const w = await open(browser, s);
    let dialog = false;
    w.page.on('dialog', async (x) => { dialog = true; await x.dismiss(); });
    await w.page.goto(`/trip/${trip.id}`);
    await expect(w.page.getByText(payload)).toBeVisible();
    expect(await w.page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(dialog).toBe(false);
    await w.context.close();
  });

  test('G49 deleting an account cancels its ride and leaves related records consistent', async ({ request }) => {
    const d = await signup(request, 'Vanishing Driver', 'male');
    const r = await signup(request, 'Stranded Rider');
    const { trip } = await postTrip(request, d, { minutes: 90 });
    await askAndApprove(request, d, r, trip.id);
    expect((await request.post(`${V1}/me/delete`, { headers: auth(d), data: { password: PASSWORD } })).status()).toBe(200);
    const t = await getTrip(request, r, trip.id);
    expect(t.status).toBe('cancelled');
    expect(t.my_seat.status).toBe('cancelled');
    expect(t.driver.name).not.toBe('Vanishing Driver');      // personal details removed
    const alerts = (await (await request.get(`${V1}/me/alerts`, { headers: auth(r) })).json()).items;
    expect(alerts.some((x: { trip_id: number }) => x.trip_id === trip.id)).toBeTruthy();
    // the rider is free to ride again; the deleted email can be used for a new account
    expect((await (await request.get(`${V1}/me/trips`, { headers: auth(r) })).json()).active).toBeNull();
    const again = await request.post(`${V1}/auth/signup`, { data: { name: 'Back Again', gender: 'male', email: d.user.email,
      mobile: d.profile!.mobile, password: PASSWORD } });
    expect(again.status(), await again.text()).toBe(201);
  });
});
