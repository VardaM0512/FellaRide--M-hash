// D. Core business workflows: offer, search, view, ask, approve/decline, full rides, cancelling, multi-seat,
// the whole ride, and the driver cancelling. Each one is followed from the screen to the API and back.
import { expect, test } from '@playwright/test';
import { askAndApprove, auth, getTrip, open, postTrip, signup, V1 } from './helpers';

const pickupOf = (r: [number, number][], i = 2) => ({ name: 'Lake Road', lat: r[i][0], lon: r[i][1] });

test.describe('D. Core workflows', () => {
  test('D19 @cross a driver offers a ride through the Offer screen and it is saved', async ({ browser, request }) => {
    const d = await signup(request, 'Kiran Desai', 'male');
    const w = await open(browser, d);
    await w.page.goto('/offer');
    await w.page.getByLabel('Car model').fill('Hyundai i20');
    await w.page.getByLabel('Colour').fill('Grey');
    await w.page.getByLabel('Car number').fill('KA 05 MN 4321');
    await w.page.getByLabel(/valid driving licence/).check();
    await w.page.getByLabel('From', { exact: true }).fill('Lakeview');
    await w.page.getByRole('listbox', { name: 'From suggestions' }).getByRole('button').first().click();
    await w.page.getByLabel('To', { exact: true }).fill('Tech Park Gate');
    await w.page.getByRole('listbox', { name: 'To suggestions' }).getByRole('button').first().click();
    await w.page.getByLabel(/sharing costs, not running a taxi/).check();
    await w.page.getByRole('button', { name: /Next: confirm route/ }).click();
    await expect(w.page.getByRole('heading', { name: 'Which way will you drive?' })).toBeVisible();
    await w.page.getByRole('button', { name: /Confirm route & post/ }).click();
    await expect(w.page).toHaveURL(/\/trip\/\d+$/);
    const id = Number(w.page.url().split('/').pop());
    const t = await getTrip(request, d, id);
    expect(t).toMatchObject({ you: 'driver', status: 'open', seats_total: 3, from: { name: expect.stringContaining('Lakeview') } });
    expect(t.car).toMatchObject({ model: 'Hyundai i20', colour: 'Grey', plate: 'KA 05 MN 4321' });
    expect(t.route.length).toBeGreaterThan(1);
    await w.context.close();
  });

  test('D20 search finds rides near the pickup, in the right direction and time window only', async ({ request }) => {
    const d = await signup(request, 'Search Driver', 'male');
    const r = await signup(request, 'Search Rider');
    const { trip, route: rt } = await postTrip(request, d, { minutes: 60 });
    const q = (p: Record<string, number | string>) => request.get(`${V1}/trips/search`, { headers: auth(r), params: p }).then((x) => x.json());
    const ids = (rows: { id: number }[]) => rows.map((x) => x.id);
    expect(ids(await q({ from_lat: rt[2][0], from_lon: rt[2][1] }))).toContain(trip.id);                    // pickup on the route
    expect(ids(await q({ from_lat: rt[2][0], from_lon: rt[2][1], to_lat: rt[8][0], to_lon: rt[8][1] }))).toContain(trip.id);
    expect(ids(await q({ from_lat: rt[8][0], from_lon: rt[8][1], to_lat: rt[2][0], to_lon: rt[2][1] }))).not.toContain(trip.id); // wrong way
    expect(ids(await q({ from_lat: rt[2][0] + 0.2, from_lon: rt[2][1] }))).not.toContain(trip.id);        // 22 km away
    const at = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();
    expect(ids(await q({ from_lat: rt[2][0], from_lon: rt[2][1], when: at(60) }))).toContain(trip.id);
    expect(ids(await q({ from_lat: rt[2][0], from_lon: rt[2][1], when: at(60 + 240) }))).not.toContain(trip.id); // 4 h off
    const row = (await q({ from_lat: rt[2][0], from_lon: rt[2][1] })).find((x: { id: number }) => x.id === trip.id);
    expect(row.code).toBeNull();                       // strangers never see the boarding code
    expect(row.driver.mobile).toBeUndefined();         // or the driver's phone number
    expect(row.car.plate).toBeNull();                  // or the plate
    expect(row.per_seat).toBeGreaterThan(0);
  });

  test('D21 a rider finds the ride on the Find screen and opens its details', async ({ browser, request }) => {
    const d = await signup(request, 'Asha Driver');
    const r = await signup(request, 'Rohan Rider', 'male');
    const { trip, route: rt } = await postTrip(request, d);
    const w = await open(browser, r, { pickup: pickupOf(rt) });
    await w.page.goto('/find');
    await w.page.getByRole('button', { name: /Find rides/ }).click();
    const card = w.page.locator('article.ride-card', { hasText: 'Asha Driver' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('White Maruti Swift');
    await expect(card).toContainText(/3 seats left/);
    await expect(card.locator('.price-tag')).toContainText('₹');
    await card.getByRole('button', { name: 'Details' }).click();
    await expect(w.page).toHaveURL(new RegExp(`/trip/${trip.id}$`));
    await expect(w.page.getByText('Lakeview Gate → Tech Park')).toBeVisible();
    await expect(w.page.getByText('You’ll see the number plate once the driver approves you.')).toBeVisible();
    await w.context.close();
  });

  test('D22 asking for a seat in the app reaches the driver', async ({ browser, request }) => {
    const d = await signup(request, 'Kiran Desai', 'male');
    const r = await signup(request, 'Ananya Rao');
    const { trip, route: rt } = await postTrip(request, d);
    const w = await open(browser, r, { pickup: pickupOf(rt) });
    await w.page.goto(`/trip/${trip.id}`);
    await w.page.getByRole('button', { name: 'Ask Kiran for a seat' }).click();
    await expect(w.page.getByText(/Waiting for Kiran to approve/)).toBeVisible();
    const seen = await getTrip(request, d, trip.id);
    expect(seen.riders).toHaveLength(1);
    expect(seen.riders[0]).toMatchObject({ status: 'pending', seats: 1, person: { name: 'Ananya Rao', gender: 'female' } });
    const alerts = (await (await request.get(`${V1}/me/alerts`, { headers: auth(d) })).json()).items;
    expect(alerts.some((a: { kind: string }) => a.kind === 'seat_request')).toBeTruthy();
    await w.context.close();
  });

  test('D23 the driver approves in the app; the rider then sees the code, plate and phone', async ({ browser, request }) => {
    const d = await signup(request, 'Kiran Desai', 'male');
    const r = await signup(request, 'Ananya Rao');
    const { trip } = await postTrip(request, d);
    await request.post(`${V1}/trips/${trip.id}/request`, { headers: auth(r), data: {} });
    const wd = await open(browser, d);
    await wd.page.goto(`/trip/${trip.id}`);
    await wd.page.getByRole('button', { name: 'Approve' }).click();
    await expect(wd.page.locator('p.note-ok', { hasText: 'Approved Ananya Rao.' })).toBeVisible();
    const t = await getTrip(request, r, trip.id);
    expect(t.my_seat.status).toBe('approved');
    expect(t.code).toMatch(/^\d{4}$/);
    expect(t.car.plate).toBe('KA 01 AB 1234');
    expect(t.driver.mobile).toBeTruthy();
    expect(t.seats_left).toBe(2);
    const wr = await open(browser, r);
    await wr.page.goto(`/trip/${trip.id}`);
    await expect(wr.page.getByText(/You’re approved/)).toBeVisible();
    await expect(wr.page.getByText(t.code)).toBeVisible();
    await wd.context.close(); await wr.context.close();
  });

  test('D24 the driver declines; the rider is told and the seat stays free', async ({ browser, request }) => {
    const d = await signup(request, 'Decline Driver', 'male');
    const r = await signup(request, 'Declined Rider');
    const { trip } = await postTrip(request, d);
    await request.post(`${V1}/trips/${trip.id}/request`, { headers: auth(r), data: {} });
    const w = await open(browser, d);
    await w.page.goto(`/trip/${trip.id}`);
    await w.page.getByRole('button', { name: 'Decline' }).click();
    await expect(w.page.locator('p.note-ok', { hasText: 'Declined Declined Rider.' })).toBeVisible();
    const t = await getTrip(request, r, trip.id);
    expect(t.my_seat.status).toBe('rejected');
    expect(t.seats_left).toBe(3);
    const again = await request.post(`${V1}/trips/${trip.id}/request`, { headers: auth(r), data: {} });
    expect(again.status()).toBe(409);                    // a declined rider can't keep asking the same driver
    await w.context.close();
  });

  test('D25 a full ride can no longer be booked, and says so', async ({ browser, request }) => {
    const d = await signup(request, 'Full Driver', 'male');
    const a = await signup(request, 'First In');
    const b = await signup(request, 'Too Late');
    const { trip, route: rt } = await postTrip(request, d, { seats: 1 });
    await askAndApprove(request, d, a, trip.id);
    const late = await request.post(`${V1}/trips/${trip.id}/request`, { headers: auth(b), data: {} });
    expect(late.status()).toBe(409);
    expect((await late.json()).detail).toMatch(/full/i);
    const found = await (await request.get(`${V1}/trips/search`, { headers: auth(b), params: { from_lat: rt[2][0], from_lon: rt[2][1] } })).json();
    expect(found.map((x: { id: number }) => x.id)).not.toContain(trip.id);
    const w = await open(browser, b);
    await w.page.goto(`/trip/${trip.id}`);
    await expect(w.page.getByText('This ride is full.')).toBeVisible();
    await w.context.close();
  });

  test('D26 a rider cancels a confirmed seat in good time; the seat comes back', async ({ browser, request }) => {
    const d = await signup(request, 'Kiran Desai', 'male');
    const r = await signup(request, 'Changing Plans');
    const { trip } = await postTrip(request, d, { minutes: 60 });
    await askAndApprove(request, d, r, trip.id);
    expect((await getTrip(request, d, trip.id)).seats_left).toBe(2);
    const w = await open(browser, r);
    w.page.on('dialog', (dlg) => dlg.accept());
    await w.page.goto(`/trip/${trip.id}`);
    await expect(w.page.getByText(/You can cancel until/)).toBeVisible();
    await w.page.getByRole('button', { name: 'Cancel my seat' }).click();
    await expect(w.page.locator('p.note-ok', { hasText: 'Your seat is cancelled.' })).toBeVisible();
    expect((await getTrip(request, d, trip.id)).seats_left).toBe(3);
    const alerts = (await (await request.get(`${V1}/me/alerts`, { headers: auth(d) })).json()).items;
    expect(alerts.some((x: { kind: string }) => x.kind === 'rider_left')).toBeTruthy();
    await w.context.close();
  });

  test('D27 inside the last 10 minutes neither side can cancel a confirmed seat', async ({ browser, request }) => {
    const d = await signup(request, 'Late Driver', 'male');
    const r = await signup(request, 'Late Rider');
    const { trip } = await postTrip(request, d, { minutes: 8 });
    await askAndApprove(request, d, r, trip.id);
    const w = await open(browser, r);
    await w.page.goto(`/trip/${trip.id}`);
    await expect(w.page.getByRole('button', { name: 'Cancel my seat' })).toBeDisabled();
    await expect(w.page.getByText(/Cancelling closed at/)).toBeVisible();
    expect((await request.post(`${V1}/trips/${trip.id}/withdraw`, { headers: auth(r) })).status()).toBe(409);
    expect((await request.post(`${V1}/trips/${trip.id}/cancel`, { headers: auth(d) })).status()).toBe(409);
    expect((await getTrip(request, d, trip.id)).riders[0].status).toBe('approved');   // nothing changed
    await w.context.close();
  });

  test('D28 one rider books two seats; the driver approves both and capacity drops by two', async ({ browser, request }) => {
    const d = await signup(request, 'Kiran Desai', 'male');
    const r = await signup(request, 'Group Booker');
    const { trip } = await postTrip(request, d, { seats: 3 });
    const wr = await open(browser, r);
    await wr.page.goto(`/trip/${trip.id}`);
    await wr.page.getByRole('button', { name: 'One more seat' }).click();
    await wr.page.getByRole('button', { name: 'Ask Kiran for 2 seats' }).click();
    await expect(wr.page.locator('p.note', { hasText: /your 2 seats/ })).toBeVisible();
    const wd = await open(browser, d);
    await wd.page.goto(`/trip/${trip.id}`);
    await expect(wd.page.getByText(/Needs 2 seats/)).toBeVisible();
    await wd.page.getByRole('button', { name: 'Approve 2' }).click();
    await expect(wd.page.locator('p.note-ok', { hasText: 'Approved Group Booker.' })).toBeVisible();
    expect((await getTrip(request, d, trip.id)).seats_left).toBe(1);
    await wr.context.close(); await wd.context.close();
  });

  test('D29 the whole ride: start, board, end, rate; ratings reach the profile', async ({ request }) => {
    const d = await signup(request, 'Whole Driver', 'male');
    const r = await signup(request, 'Whole Rider');
    const { trip } = await postTrip(request, d, { minutes: 3 });
    const seat = await askAndApprove(request, d, r, trip.id);
    expect((await request.post(`${V1}/trips/${trip.id}/start`, { headers: auth(d) })).status()).toBe(200);
    expect((await request.post(`${V1}/trips/${trip.id}/seats/${seat}/board`, { headers: auth(d) })).status()).toBe(200);
    expect((await getTrip(request, r, trip.id)).my_seat.status).toBe('boarded');
    expect((await request.post(`${V1}/trips/${trip.id}/end`, { headers: auth(d) })).status()).toBe(200);
    const done = await getTrip(request, r, trip.id);
    expect(done.status).toBe('completed');
    expect(done.my_seat.status).toBe('dropped');
    const rate = await request.post(`${V1}/trips/${trip.id}/ratings`, { headers: auth(r), data: { to_id: d.user.id, stars: 5, comment: 'Smooth' } });
    expect(rate.status(), await rate.text()).toBeLessThan(300);
    const twice = await request.post(`${V1}/trips/${trip.id}/ratings`, { headers: auth(r), data: { to_id: d.user.id, stars: 1 } });
    expect(twice.status()).toBeGreaterThanOrEqual(400);   // one rating per person per ride
    const driver = (await getTrip(request, r, trip.id)).driver;
    expect(driver.rating.count).toBe(1);
    expect(driver.rating.average).toBe(5);
  });

  test('D30 the driver cancels a ride with a confirmed rider; everyone is told', async ({ request }) => {
    const d = await signup(request, 'Cancel Driver', 'male');
    const r = await signup(request, 'Let Down');
    const { trip } = await postTrip(request, d, { minutes: 90 });
    await askAndApprove(request, d, r, trip.id);
    expect((await request.post(`${V1}/trips/${trip.id}/cancel`, { headers: auth(d) })).status()).toBe(200);
    const t = await getTrip(request, r, trip.id);
    expect(t.status).toBe('cancelled');
    expect(t.my_seat.status).toBe('cancelled');
    const alerts = (await (await request.get(`${V1}/me/alerts`, { headers: auth(r) })).json()).items;
    expect(alerts.some((x: { kind: string }) => x.kind === 'cancelled')).toBeTruthy();
    // the rider is free to book another ride straight away
    const d2 = await signup(request, 'Backup Driver', 'male');
    const { trip: t2 } = await postTrip(request, d2);
    expect((await request.post(`${V1}/trips/${t2.id}/request`, { headers: auth(r), data: {} })).status()).toBe(200);
  });

  test('D31 an impossible ride (another continent) is refused on the Offer screen with a clear message', async ({ browser, request }) => {
    // regression: a London destination from India built a 10,852 km "ride" and only failed when posting, with
    // "route_km: Input should be less than or equal to 2000"
    const d = await signup(request, 'Far Driver', 'male');
    const w = await open(browser, d);
    await w.page.goto('/offer');
    await w.page.getByLabel('Car model').fill('Maruti Swift');
    await w.page.getByLabel('Colour').fill('White');
    await w.page.getByLabel('Car number').fill('KA 01 AB 1234');
    await w.page.getByLabel(/valid driving licence/).check();
    await w.page.getByLabel('From', { exact: true }).fill('Lakeview');
    await w.page.getByRole('listbox', { name: 'From suggestions' }).getByRole('button').first().click();
    await w.page.getByLabel('To', { exact: true }).fill('London');
    await w.page.getByRole('listbox', { name: 'To suggestions' }).getByRole('button').first().click();
    await w.page.getByLabel(/sharing costs, not running a taxi/).check();
    await w.page.getByRole('button', { name: /Next: confirm route/ }).click();
    const note = w.page.locator('.note-error');
    await expect(note).toContainText(/A ride can be up to 2,000 km/);
    await expect(note).not.toContainText(/route_km|Input should be/);
    await expect(w.page.getByRole('heading', { name: 'Which way will you drive?' })).toHaveCount(0);
    expect((await (await request.get(`${V1}/me/trips`, { headers: auth(d) })).json()).active).toBeNull();   // nothing posted
    await w.context.close();
  });
});
