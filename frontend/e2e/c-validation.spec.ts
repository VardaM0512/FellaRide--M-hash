// C. Input validation and error handling
import { expect, test } from '@playwright/test';
import { appErrors, auth, open, PASSWORD, postTrip, route, signup, uniq, V1 } from './helpers';

test.describe('C. Validation and errors', () => {
  test('C14 empty required fields keep the forms from submitting, and the API refuses empty bodies', async ({ browser, request }) => {
    const w = await open(browser, null);
    await w.page.goto('/signin');
    await expect(w.page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    await w.page.goto('/forgot-password');
    await expect(w.page.getByRole('button', { name: 'Send reset code' })).toBeDisabled();
    await w.page.getByLabel('Email').fill('no-at-sign');
    await expect(w.page.getByRole('button', { name: 'Send reset code' })).toBeDisabled();
    await w.context.close();

    const s = await signup(request, 'Empty Sender');
    for (const [path, headers] of [['/auth/login', {}], ['/auth/signup', {}], ['/auth/forgot-password', {}], ['/trips', auth(s)],
      ['/auth/reset-password', {}]] as const) {
      const r = await request.post(`${V1}${path}`, { data: {}, headers });
      expect(r.status(), path).toBe(422);
    }
  });

  test('C15 malformed, oversized and wrongly typed input is rejected with 422, not a crash', async ({ request }) => {
    const s = await signup(request, 'Bad Input');
    const raw = await request.post(`${V1}/auth/login`, { headers: { 'Content-Type': 'application/json' }, data: '{"email": "x@y.z", "password": ' });
    expect(raw.status()).toBe(422);                                         // broken JSON
    const typed = await request.post(`${V1}/auth/login`, { data: { email: ['a'], password: 12345 } });
    expect(typed.status()).toBe(422);                                       // wrong types
    const longName = await request.put(`${V1}/me/profile`, { headers: auth(s), data: { name: 'N'.repeat(81), gender: 'male', mobile: s.profile!.mobile } });
    expect(longName.status()).toBe(422);
    const { trip } = await postTrip(request, s);
    const longMsg = await request.post(`${V1}/trips/${trip.id}/messages`, { headers: auth(s), data: { body: 'x'.repeat(501) } });
    expect(longMsg.status()).toBe(422);
    const html = await request.post(`${V1}/trips/${trip.id}/request`, { headers: auth(await signup(request, 'Html Pickup')),
      data: { pickup_name: '<img src=x onerror=alert(1)>' } });
    expect(html.status()).toBe(422);                                         // angle brackets aren't allowed in place names
    const badCoords = await request.get(`${V1}/trips/search?from_lat=500&from_lon=77`, { headers: auth(s) });
    expect(badCoords.status()).toBe(422);
    const badId = await request.get(`${V1}/trips/abc`, { headers: auth(s) });
    expect(badId.status()).toBe(422);
  });

  test('C16 boundary values: the limits themselves are accepted, one past them is refused', async ({ request }) => {
    const pw = async (p: string) => { const u = uniq(); return (await request.post(`${V1}/auth/signup`, { data: { name: 'Edge Case', gender: 'other',
      email: `e2e.edge.${u}@example.org`, mobile: `7${u.padStart(9, '5')}`.slice(0, 10), password: p } })).status(); };
    expect(await pw('12345678')).toBe(201);          // 8 characters: the minimum
    expect(await pw('1234567')).toBe(422);
    expect(await pw('x'.repeat(72))).toBe(201);      // 72: bcrypt's maximum
    expect(await pw('x'.repeat(73))).toBe(422);

    const d = await signup(request, 'Seat Edges');
    const seats = async (n: number, minutes = 45) => {
      const r0 = route();
      return (await request.post(`${V1}/trips`, { headers: auth(d), data: { from_name: 'A', from_lat: r0[0][0], from_lon: r0[0][1], to_name: 'B',
        to_lat: r0[10][0], to_lon: r0[10][1], depart_at: new Date(Date.now() + minutes * 60_000).toISOString(), route: r0, route_km: 11,
        route_min: 20, seats: n, licence_confirmed: true, cost_share_confirmed: true } })).status();
    };
    expect(await seats(0)).toBe(422);
    expect(await seats(9)).toBe(422);
    expect(await seats(8)).toBe(201);                // the most a car may offer
    expect(await seats(1)).toBe(409);                // a second open ride for the same driver is refused (business rule)
    const d2 = await signup(request, 'Time Edges');
    const when = async (minutes: number) => {
      const r0 = route();
      return (await request.post(`${V1}/trips`, { headers: auth(d2), data: { from_name: 'A', from_lat: r0[0][0], from_lon: r0[0][1], to_name: 'B',
        to_lat: r0[10][0], to_lon: r0[10][1], depart_at: new Date(Date.now() + minutes * 60_000).toISOString(), route: r0, route_km: 11,
        route_min: 20, seats: 2, licence_confirmed: true, cost_share_confirmed: true } })).status();
    };
    expect(await when(-60)).toBe(422);               // an hour in the past
    expect(await when(8 * 24 * 60)).toBe(422);       // more than 7 days ahead
  });

  test('C17 errors are shown in plain words on the screen', async ({ browser, request }) => {
    const s = await signup(request, 'Taken Email');
    const w = await open(browser, null);
    await w.page.goto('/signup');
    const u = uniq();
    await w.page.getByLabel('Email').fill(s.user.email);
    await w.page.getByLabel('Mobile number').fill(`8${u.padStart(9, '6')}`.slice(0, 10));
    await w.page.locator('input[autocomplete=new-password]').fill(PASSWORD);
    await w.page.getByLabel('Your name').fill('Second Try');
    await w.page.getByRole('radio', { name: 'Male', exact: true }).click();
    await w.page.getByRole('button', { name: 'Create account' }).click();
    const note = w.page.locator('.note-error');
    await expect(note).toBeVisible();
    await expect(note).toContainText(/email/i);
    await expect(note).not.toContainText(/Traceback|Exception|sqlalchemy|undefined|\[object/i);
    await expect(w.page).toHaveURL(/\/signup$/);
    await w.context.close();
  });

  test('C18 a broken, unreachable or garbled API is handled without a blank screen', async ({ browser }) => {
    const cases: [string, Parameters<import('@playwright/test').Route['fulfill']>[0] | 'abort', RegExp][] = [
      ['server error', { status: 500, body: 'Internal Server Error' }, /Something went wrong on our side/],
      ['unreachable', 'abort', /Can’t reach FellaRide/],
      ['garbled 200', { status: 200, contentType: 'application/json', body: '{"token": ' }, /./],
    ];
    for (const [label, answer, message] of cases) {
      const w = await open(browser, null);
      await w.context.route('**/api/v1/auth/login', (r) => (answer === 'abort' ? r.abort() : r.fulfill(answer)));
      await w.page.goto('/signin');
      await w.page.getByLabel('Email or mobile number').fill('someone@example.org');
      await w.page.locator('input[autocomplete=current-password]').fill(PASSWORD);
      await w.page.getByRole('button', { name: 'Sign in' }).click();
      if (label === 'garbled 200') {
        // a 200 with an unreadable body must not "sign in" a broken session or crash the app
        await w.page.waitForTimeout(1000);
        await expect(w.page.locator('main'), label).toBeVisible();
        expect(appErrors(w.consoleErrors).filter((e) => e.startsWith('pageerror')), label).toEqual([]);
        await expect(w.page, label).toHaveURL(/\/signin$/);
        await expect(w.page.locator('.note-error'), label).toBeVisible();
      } else {
        await expect(w.page.locator('.note-error'), label).toContainText(message);
        await expect(w.page.getByRole('button', { name: 'Sign in' }), label).toBeEnabled();   // you can try again
      }
      await w.context.close();
    }
  });
});
