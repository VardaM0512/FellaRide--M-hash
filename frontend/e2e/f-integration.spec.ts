// F. Frontend and backend integration: what the screens send, loading states, updates without a reload,
// what survives a refresh, and no duplicates when the network is slow.
import { expect, test } from '@playwright/test';
import { auth, getTrip, open, PASSWORD, postTrip, signup, V1 } from './helpers';

test.describe('F. Integration', () => {
  test('F39 the forms send exactly the expected requests and payloads', async ({ browser, request }) => {
    const s = await signup(request, 'Payload Person');
    const w = await open(browser, null);
    await w.page.goto('/signin');
    await w.page.getByLabel('Email or mobile number').fill(s.user.email);
    await w.page.locator('input[autocomplete=current-password]').fill(PASSWORD);
    const [login] = await Promise.all([w.page.waitForRequest((r) => r.url().endsWith('/api/v1/auth/login') && r.method() === 'POST'),
      w.page.getByRole('button', { name: 'Sign in' }).click()]);
    expect(login.postDataJSON()).toEqual({ email: s.user.email, password: PASSWORD });
    expect(login.headers()['authorization']).toBeUndefined();      // no stale token sent with a login
    await w.context.close();

    const d = await signup(request, 'Kiran Desai', 'male');
    const { trip, route: rt } = await postTrip(request, d);
    const wr = await open(browser, s, { pickup: { name: 'Lake Road', lat: rt[3][0], lon: rt[3][1] } });
    await wr.page.goto('/find');
    await wr.page.getByRole('button', { name: /Find rides/ }).click();
    const card = wr.page.locator('article.ride-card', { hasText: 'Kiran Desai' });
    const [ask] = await Promise.all([wr.page.waitForRequest((r) => r.url().endsWith(`/trips/${trip.id}/request`)),
      card.getByRole('button', { name: 'Ask for a seat' }).click()]);
    expect(ask.postDataJSON()).toEqual({ pickup_name: 'Lake Road', pickup_lat: rt[3][0], pickup_lon: rt[3][1], seats: 1 });
    expect(ask.headers()['authorization']).toBe(`Bearer ${s.token}`);
    await wr.context.close();
  });

  test('F40 a slow search shows a loading state, then the results', async ({ browser, request }) => {
    const d = await signup(request, 'Slow Driver', 'male');
    const r = await signup(request, 'Patient Rider');
    const { route: rt } = await postTrip(request, d);
    const w = await open(browser, r, { pickup: { name: 'Lake Road', lat: rt[2][0], lon: rt[2][1] } });
    await w.context.route('**/api/v1/trips/search**', async (route) => { await new Promise((x) => setTimeout(x, 1500)); await route.continue(); });
    await w.page.goto('/find');
    await w.page.getByRole('button', { name: /Find rides/ }).click();
    await expect(w.page.getByRole('button', { name: 'Looking…' })).toBeDisabled();
    await expect(w.page.locator('article.ride-card', { hasText: 'Slow Driver' })).toBeVisible();
    await expect(w.page.getByRole('button', { name: /Find rides/ })).toBeEnabled();
    await w.context.close();
  });

  test('F41 the screen updates straight after an action, no reload needed', async ({ browser, request }) => {
    const d = await signup(request, 'Kiran Desai', 'male');
    const r = await signup(request, 'Quick Changer');
    const { trip } = await postTrip(request, d);
    const w = await open(browser, r);
    await w.page.goto(`/trip/${trip.id}`);
    await w.page.getByRole('button', { name: 'Ask Kiran for a seat' }).click();
    await expect(w.page.getByRole('button', { name: 'Withdraw request' })).toBeVisible();
    await w.page.getByRole('button', { name: 'Withdraw request' }).click();
    await expect(w.page.getByRole('button', { name: 'Ask Kiran for a seat' })).toBeVisible();
    expect((await getTrip(request, d, trip.id)).riders).toEqual([]);     // withdrawn requests aren't shown to the driver
    await w.context.close();
  });

  test('F42 what you did is still there after a refresh or leaving and coming back', async ({ browser, request }) => {
    const d = await signup(request, 'Kiran Desai', 'male');
    const r = await signup(request, 'Memory Rider');
    const { trip } = await postTrip(request, d);
    const w = await open(browser, r);
    await w.page.goto(`/trip/${trip.id}`);
    await w.page.getByRole('button', { name: 'Ask Kiran for a seat' }).click();
    await expect(w.page.getByText(/Waiting for Kiran to approve/)).toBeVisible();
    await w.page.reload();
    await expect(w.page.getByText(/Waiting for Kiran to approve/)).toBeVisible();
    await w.page.goto('/');
    await expect(w.page.locator('.stub', { hasText: 'Waiting for Kiran' })).toBeVisible();   // Home shows the pending request
    await w.page.locator('.stub').first().click();
    await expect(w.page).toHaveURL(new RegExp(`/trip/${trip.id}$`));
    await w.context.close();
  });

  test('F43 a slow network and a double tap still make only one request', async ({ browser, request }) => {
    const d = await signup(request, 'Kiran Desai', 'male');
    const r = await signup(request, 'Double Tapper');
    const { trip } = await postTrip(request, d);
    const w = await open(browser, r);
    let sent = 0;
    await w.context.route(`**/api/v1/trips/${trip.id}/request`, async (route) => { sent += 1; await new Promise((x) => setTimeout(x, 1500)); await route.continue(); });
    await w.page.goto(`/trip/${trip.id}`);
    const ask = w.page.getByRole('button', { name: 'Ask Kiran for a seat' });
    // a quick double tap: two real clicks a few milliseconds apart, before the screen has redrawn (regression: sent 2)
    await ask.evaluate((b: HTMLButtonElement) => { b.click(); b.click(); });
    await w.page.waitForTimeout(200);
    await ask.click({ force: true, timeout: 1000 }).catch(() => { /* a third tap on the now-disabled button */ });
    await expect(w.page.getByText(/Waiting for Kiran to approve/)).toBeVisible();
    expect(sent, 'requests sent by the screen').toBe(1);
    expect((await getTrip(request, d, trip.id)).riders).toHaveLength(1);
    await w.context.close();
  });

  test('F44 the driver’s screen picks up a new request on its own', async ({ browser, request }) => {
    const d = await signup(request, 'Watching Driver', 'male');
    const r = await signup(request, 'Arriving Rider');
    const { trip } = await postTrip(request, d);
    const w = await open(browser, d);
    await w.page.goto(`/trip/${trip.id}`);
    await expect(w.page.getByText(/No requests waiting/)).toBeVisible();
    await request.post(`${V1}/trips/${trip.id}/request`, { headers: auth(r), data: {} });
    await expect(w.page.getByText('Arriving Rider')).toBeVisible({ timeout: 20_000 });   // the ride refreshes every 12 s
    await w.context.close();
  });
});
