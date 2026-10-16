// B. Authentication and authorization
import { expect, test } from '@playwright/test';
import { appErrors, auth, open, PASSWORD, signJwt, signup, uniq, V1 } from './helpers';

test.describe('B. Authentication and authorization', () => {
  test('B6 @cross register through the sign-up form and land on Home, signed in', async ({ browser, request }) => {
    const w = await open(browser, null);
    const u = uniq(), email = `e2e.ui.${u}@example.org`;
    await w.page.goto('/signup');
    await w.page.getByLabel('Email').fill(email);
    await w.page.getByLabel('Mobile number').fill(`8${u.padStart(9, '3')}`.slice(0, 10));
    await w.page.locator('input[autocomplete=new-password]').fill(PASSWORD);
    await w.page.getByLabel('Your name').fill('Priya Mehta');
    await w.page.getByRole('radio', { name: 'Female' }).click();
    await w.page.getByRole('button', { name: 'Create account' }).click();
    await expect(w.page.getByRole('heading', { name: 'Where are you headed?' })).toBeVisible();
    const stored = await w.page.evaluate(() => JSON.parse(localStorage.getItem('fellaride.session') || 'null'));
    expect(stored.user.email).toBe(email);
    // the account really exists: the same credentials sign in through the API
    expect((await request.post(`${V1}/auth/login`, { data: { email, password: PASSWORD } })).status()).toBe(200);
    expect(appErrors(w.consoleErrors)).toEqual([]);
    await w.context.close();
  });

  test('B7 sign-up refuses missing required fields (form and API) and creates nothing', async ({ browser, request }) => {
    const w = await open(browser, null);
    await w.page.goto('/signup');
    const create = w.page.getByRole('button', { name: 'Create account' });
    await expect(create).toBeDisabled();
    await w.page.getByLabel('Email').fill('half.done@example.org');
    await expect(create).toBeDisabled();                          // mobile, password and name still empty
    await w.context.close();

    for (const missing of ['name', 'gender', 'email', 'mobile', 'password']) {
      const u = uniq();
      const body: Record<string, string> = { name: 'No Field', gender: 'male', email: `e2e.miss.${u}@example.org`, mobile: `7${u.padStart(9, '1')}`.slice(0, 10), password: PASSWORD };
      delete body[missing];
      const r = await request.post(`${V1}/auth/signup`, { data: body });
      expect(r.status(), missing).toBe(422);
      expect(JSON.stringify(await r.json())).toContain(missing);
    }
  });

  test('B8 invalid email, mobile, gender and password values are rejected', async ({ request }) => {
    const u = uniq();
    const ok = { name: 'Valid Name', gender: 'male', email: `e2e.v.${u}@example.org`, mobile: `7${u.padStart(9, '2')}`.slice(0, 10), password: PASSWORD };
    for (const [field, value] of [['email', 'not-an-email'], ['email', 'a@b'], ['mobile', '12'], ['mobile', 'abcdefghij'],
      ['gender', 'robot'], ['password', 'short'], ['name', 'A'], ['name', '<script>x</script>']] as const) {
      const r = await request.post(`${V1}/auth/signup`, { data: { ...ok, [field]: value } });
      expect(r.status(), `${field}=${value}`).toBe(422);
    }
  });

  test('B9 a second account with the same email or mobile is refused', async ({ request }) => {
    const first = await signup(request, 'First Owner');
    const u = uniq();
    const sameEmail = await request.post(`${V1}/auth/signup`, { data: { name: 'Copy Cat', gender: 'male', email: first.user.email.toUpperCase(),
      mobile: `6${u.padStart(9, '4')}`.slice(0, 10), password: PASSWORD } });
    expect(sameEmail.status()).toBe(409);
    const sameMobile = await request.post(`${V1}/auth/signup`, { data: { name: 'Copy Cat', gender: 'male', email: `e2e.copy.${u}@example.org`,
      mobile: first.profile!.mobile, password: PASSWORD } });
    expect(sameMobile.status()).toBe(409);
  });

  test('B10 @cross sign in through the form with email, and with the mobile number', async ({ browser, request }) => {
    const s = await signup(request, 'Login Person');
    for (const id of [s.user.email, s.profile!.mobile]) {
      const w = await open(browser, null);
      await w.page.goto('/signin');
      await w.page.getByLabel('Email or mobile number').fill(id);
      await w.page.locator('input[autocomplete=current-password]').fill(PASSWORD);
      await w.page.getByRole('button', { name: 'Sign in' }).click();
      await expect(w.page.getByRole('heading', { name: 'Where are you headed?' })).toBeVisible();
      await w.context.close();
    }
  });

  test('B11 a wrong password and an unknown account get the same answer, revealing nothing', async ({ browser, request }) => {
    const s = await signup(request, 'Guarded Person');
    const wrong = await request.post(`${V1}/auth/login`, { data: { email: s.user.email, password: 'wrong-password-1' } });
    const unknown = await request.post(`${V1}/auth/login`, { data: { email: `nobody.${uniq()}@example.org`, password: 'wrong-password-1' } });
    expect(wrong.status()).toBe(401);
    expect(unknown.status()).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    const w = await open(browser, null);
    await w.page.goto('/signin');
    await w.page.getByLabel('Email or mobile number').fill(s.user.email);
    await w.page.locator('input[autocomplete=current-password]').fill('wrong-password-1');
    await w.page.getByRole('button', { name: 'Sign in' }).click();
    await expect(w.page.getByText('That email and password don’t match an account.')).toBeVisible();
    await expect(w.page).toHaveURL(/\/signin$/);
    await w.context.close();
  });

  test('B12 signing out clears the session and the app locks again', async ({ browser, request }) => {
    const s = await signup(request, 'Leaving Person');
    const w = await open(browser, s);
    await w.page.goto('/me');
    await w.page.getByRole('button', { name: 'Sign out' }).click();
    await expect(w.page).toHaveURL(/\/welcome$/);
    expect(await w.page.evaluate(() => localStorage.getItem('fellaride.session'))).toBeNull();
    await w.page.goto('/find');
    await expect(w.page).toHaveURL(/\/welcome$/);
    // Observation, recorded in the report: tokens are stateless, so a copy of the old token keeps working until it
    // expires. Signing out is client-side only (changing the password or deleting the account does revoke it).
    const stillValid = await request.get(`${V1}/auth/me`, { headers: auth(s) });
    test.info().annotations.push({ type: 'observation', description: `token after sign-out: HTTP ${stillValid.status()}` });
    await w.context.close();
  });

  test('B13 protected pages and APIs refuse anyone not signed in, or with a bad or expired token', async ({ browser, request }) => {
    const s = await signup(request, 'Token Person');
    const now = Math.floor(Date.now() / 1000);
    const tokens: Record<string, string | null> = {
      none: null, garbage: 'not.a.token', wrongSecret: signJwt({ sub: String(s.user.id), exp: now + 3600 }, 'some-other-secret'),
      expired: signJwt({ sub: String(s.user.id), exp: now - 60, iat: now - 7200 }),
      unknownUser: signJwt({ sub: '99999999', exp: now + 3600 }),
    };
    for (const path of ['/auth/me', '/me/trips', '/me/alerts', '/me/referrals', '/trips/search?from_lat=12&from_lon=77', '/community/overview']) {
      for (const [kind, tok] of Object.entries(tokens)) {
        const r = await request.get(`${V1}${path}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
        expect(r.status(), `${path} with ${kind}`).toBe(401);
      }
    }
    // the screens bounce a signed-out visitor to Welcome
    const w = await open(browser, null);
    for (const path of ['/', '/find', '/offer', '/me', '/alerts', '/invite']) {
      await w.page.goto(path);
      await expect(w.page, path).toHaveURL(/\/welcome$/);
    }
    await w.page.goto('/dashboard');
    await expect(w.page).toHaveURL(/\/signin$/);
    await w.context.close();
  });

  test('B14 members cannot use organiser-only APIs or screens', async ({ browser, request }) => {
    const s = await signup(request, 'Plain Member');
    const t = s.tenant.id;
    for (const [m, path] of [['GET', `/tenants/${t}/metrics`], ['GET', `/tenants/${t}/members`], ['GET', `/tenants/${t}/referrals`],
      ['GET', `/tenants/${t}/trips-overview`], ['POST', `/tenants/${t}/broadcast`], ['POST', `/tenants/${t}/rides/match`],
      ['POST', `/tenants/${t}/interventions/plan`], ['GET', `/tenants/${t}/graph`]] as const) {
      const r = await request.fetch(`${V1}${path}`, { method: m, headers: auth(s), data: m === 'POST' ? { title: 'x', body: 'y' } : undefined });
      expect([401, 403, 404], `${m} ${path} -> ${r.status()}`).toContain(r.status());
    }
    const w = await open(browser, s);
    await w.page.goto('/dashboard');
    await expect(w.page).toHaveURL(/localhost:\d+\/$/);       // members are sent to their home screen
    await w.context.close();
  });

  test('B15 deleting the account revokes its token and its sign-in at once', async ({ request }) => {
    const s = await signup(request, 'Rotating Person');
    const before = await request.get(`${V1}/auth/me`, { headers: auth(s) });
    expect(before.status()).toBe(200);
    const wrongPw = await request.post(`${V1}/me/delete`, { headers: auth(s), data: { password: 'not-my-password' } });
    expect(wrongPw.status()).toBeGreaterThanOrEqual(400);         // the password is checked first
    const del = await request.post(`${V1}/me/delete`, { headers: auth(s), data: { password: PASSWORD } });
    expect(del.status(), await del.text()).toBe(200);
    expect((await request.get(`${V1}/auth/me`, { headers: auth(s) })).status()).toBe(401);
    expect((await request.post(`${V1}/auth/login`, { data: { email: s.user.email, password: PASSWORD } })).status()).toBe(401);
  });
});
