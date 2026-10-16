// H. Browser compatibility and UI reliability. The tests tagged @cross in the other files also run on Firefox and WebKit.
import { expect, test } from '@playwright/test';
import { appErrors, auth, getTrip, open, postTrip, signup, V1 } from './helpers';

const noSideScroll = async (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.describe('H. Browsers and UI reliability', () => {
  test('H50 @cross the main member screens render in every browser engine', async ({ browser, request }) => {
    const d = await signup(request, 'Engine Driver', 'male');
    const { trip } = await postTrip(request, d);
    const w = await open(browser, d);
    for (const [path, text] of [['/', /Where are you headed|You’re driving/], [`/trip/${trip.id}`, /Seat requests/], ['/find', /Find rides/],
      ['/offer', /You and your car|already have a ride/], ['/me', /Sign out/]] as const) {
      await w.page.goto(path);
      await expect(w.page.locator('body'), path).toContainText(text);
    }
    expect(appErrors(w.consoleErrors)).toEqual([]);
    expect(w.failed, 'failed calls to the app API').toEqual([]);
    await w.context.close();
  });

  test('H51 important pages fit phone and desktop screens without sideways scrolling', async ({ browser, request }) => {
    const s = await signup(request, 'Viewport Person');
    const d = await signup(request, 'Viewport Driver', 'male');
    const { trip } = await postTrip(request, d);
    for (const viewport of [{ width: 360, height: 760 }, { width: 1366, height: 900 }]) {
      const out = await open(browser, null, { viewport });
      for (const path of ['/welcome', '/signin', '/signup', '/forgot-password']) {
        await out.page.goto(path);
        expect(await noSideScroll(out.page), `${path} at ${viewport.width}px`).toBe(true);
      }
      await out.context.close();
      const inn = await open(browser, s, { viewport });
      for (const path of ['/', '/find', '/offer', `/trip/${trip.id}`, '/me', '/invite', '/community']) {
        await inn.page.goto(path);
        await inn.page.waitForLoadState('networkidle').catch(() => {});
        expect(await noSideScroll(inn.page), `${path} at ${viewport.width}px`).toBe(true);
      }
      await inn.context.close();
    }
  });

  test('H52 a whole ride flow produces no console errors, crashes or failed API calls', async ({ browser, request }) => {
    const d = await signup(request, 'Kiran Desai', 'male');
    const r = await signup(request, 'Clean Run');
    const { trip, route: rt } = await postTrip(request, d);
    const wr = await open(browser, r, { pickup: { name: 'Lake Road', lat: rt[2][0], lon: rt[2][1] } });
    const wd = await open(browser, d);
    await wr.page.goto('/find');
    await wr.page.getByRole('button', { name: /Find rides/ }).click();
    await wr.page.locator('article.ride-card', { hasText: 'Kiran Desai' }).getByRole('button', { name: 'Ask for a seat' }).click();
    await wd.page.goto(`/trip/${trip.id}`);
    await wd.page.getByRole('button', { name: 'Approve' }).click();
    await expect(wd.page.locator('p.note-ok', { hasText: 'Approved Clean Run.' })).toBeVisible();
    await wr.page.goto(`/trip/${trip.id}`);
    await expect(wr.page.getByText(/You’re approved/)).toBeVisible();
    for (const p of ['/', '/alerts', '/community', '/invite']) await wr.page.goto(p);
    expect(appErrors(wr.consoleErrors), 'rider console').toEqual([]);
    expect(appErrors(wd.consoleErrors), 'driver console').toEqual([]);
    expect([...wr.failed, ...wd.failed], 'failed API calls').toEqual([]);
    await wr.context.close(); await wd.context.close();
  });

  test('H53 repeating actions and refreshing leaves the app working and consistent', async ({ browser, request }) => {
    const d = await signup(request, 'Kiran Desai', 'male');
    const r = await signup(request, 'Indecisive Rider');
    const { trip } = await postTrip(request, d);
    const w = await open(browser, r);
    await w.page.goto(`/trip/${trip.id}`);
    for (let i = 0; i < 3; i += 1) {
      await w.page.getByRole('button', { name: 'Ask Kiran for a seat' }).click();
      await expect(w.page.getByRole('button', { name: 'Withdraw request' })).toBeVisible();
      await w.page.reload();
      await w.page.getByRole('button', { name: 'Withdraw request' }).click();
      await expect(w.page.getByRole('button', { name: 'Ask Kiran for a seat' })).toBeVisible();
    }
    const t = await getTrip(request, d, trip.id);
    expect(t.seats_left).toBe(3);
    expect(t.riders).toEqual([]);
    const alerts = (await (await request.get(`${V1}/me/alerts`, { headers: auth(r) })).json());
    expect(alerts.items).toBeDefined();
    expect(appErrors(w.consoleErrors)).toEqual([]);
    await w.context.close();
  });

  test('H54 sign-up code fields are normal-sized text inputs, readable at phone width', async ({ browser }) => {
    const w = await open(browser, null, { viewport: { width: 360, height: 760 } });
    await w.page.goto('/signup');
    for (const label of ['Join code', 'Referral code']) {
      const input = w.page.getByLabel(label);
      const style = await input.evaluate((el) => {
        const cs = getComputedStyle(el as HTMLInputElement);
        return { size: parseFloat(cs.fontSize), align: cs.textAlign };
      });
      expect(style.size, `${label} font size`).toBeLessThanOrEqual(20);
      expect(style.align, `${label} alignment`).not.toBe('center');
      // the placeholder must fit in the box
      const fits = await input.evaluate((el) => {
        const i = el as HTMLInputElement, c = document.createElement('canvas').getContext('2d')!, cs = getComputedStyle(i);
        c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const spacing = parseFloat(cs.letterSpacing) || 0;
        const w0 = c.measureText(i.placeholder).width + spacing * i.placeholder.length;
        return w0 <= i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + 1;
      });
      expect(fits, `${label} placeholder fits`).toBe(true);
    }
    await w.context.close();
  });
});
