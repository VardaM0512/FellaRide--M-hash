// The app names the community you're in and opens the switcher there: the open community everyone can join,
// or one whose join code you have. A ride still open here has to be settled first.
// The sidebar only exists from 1024px up, so most of these run at laptop width; the last one is a phone.
import { expect, test } from '@playwright/test';
import { appErrors, open, postTrip, signup, V1 } from './helpers';

const DEMO_CODE = 'DEMO2026';           // the seeded synthetic community (see the webServer command)
const OPEN_NAME = /FellaRide \(everyone\)/;

const LAPTOP = { viewport: { width: 1280, height: 900 } };
type Page = import('@playwright/test').Page;
// the name is a button in both places the app already shows it; the sidebar's is hidden on phones and in rail mode
const NAME = { name: /^Your community:/ };
const card = (page: Page) => page.locator('aside.sidebar').getByRole('button', NAME);
const appbarCard = (page: Page) => page.locator('header.appbar').getByRole('button', NAME);

test('the sidebar shows your community, and the sheet shows its code and stops', async ({ browser, request }) => {
  const me = await signup(request, 'Community Looker');
  const { context, page, consoleErrors } = await open(browser, me, LAPTOP);
  await page.goto('/');

  await expect(card(page)).toHaveAccessibleName(OPEN_NAME);

  await card(page).click();
  const sheet = page.getByRole('dialog', { name: 'Your community' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(OPEN_NAME)).toBeVisible();
  await expect(sheet).toContainText('Open to everyone');
  await expect(sheet).toContainText('0 rides shared by you');
  // already in the open community: it isn't offered again, only a join code is
  await expect(sheet.getByRole('button', { name: /^Move to FellaRide/ })).toHaveCount(0);
  await expect(sheet.getByLabel('Move with a join code')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  expect(appErrors(consoleErrors)).toEqual([]);
  await context.close();
});

test('switching with a join code and back again @cross', async ({ browser, request }) => {
  const me = await signup(request, 'Community Switcher');
  const { context, page, consoleErrors, failed } = await open(browser, me, LAPTOP);
  await page.goto('/');
  await card(page).click();

  const sheet = page.getByRole('dialog', { name: 'Your community' });
  await sheet.getByLabel('Move with a join code').fill(DEMO_CODE);
  // the code is looked up first, so you see where you're going
  const go = sheet.getByRole('button', { name: /^Move to MIT Manipal/ });
  await expect(go).toBeEnabled();
  await go.click();

  await expect(sheet).toBeHidden();
  await expect(card(page)).toHaveAccessibleName(/MIT Manipal/);
  await expect(appbarCard(page)).toHaveAccessibleName(/MIT Manipal/);
  // the server agrees, not just the browser
  const after = await request.get(`${V1}/me/community`, { headers: { Authorization: `Bearer ${me.token}` } });
  expect((await after.json()).current.name).toContain('MIT Manipal');

  // and back to the open community, which is now the one offered by name
  await card(page).click();
  await sheet.getByRole('button', { name: /^Move to FellaRide/ }).click();
  await expect(card(page)).toHaveAccessibleName(OPEN_NAME);

  expect(failed).toEqual([]);
  expect(appErrors(consoleErrors)).toEqual([]);
  await context.close();
});

test('a ride still open here has to be settled before moving', async ({ browser, request }) => {
  const driver = await signup(request, 'Community Driver');
  await postTrip(request, driver);
  const { context, page } = await open(browser, driver, LAPTOP);
  await page.goto('/');
  await card(page).click();

  const sheet = page.getByRole('dialog', { name: 'Your community' });
  await expect(sheet.getByText(/Cancel it first/)).toBeVisible();
  await expect(sheet.getByLabel('Move with a join code')).toHaveCount(0);

  const blocked = await request.post(`${V1}/me/community`, {
    headers: { Authorization: `Bearer ${driver.token}` }, data: { join_code: DEMO_CODE },
  });
  expect(blocked.status()).toBe(409);
  await context.close();
});


test('phones reach the switcher from the app bar, where there is no sidebar @cross', async ({ browser, request }) => {
  const me = await signup(request, 'Phone Switcher');
  const { context, page, consoleErrors } = await open(browser, me);      // the helper's default is a 420px phone
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeHidden();

  await appbarCard(page).click();
  const sheet = page.getByRole('dialog', { name: 'Your community' });
  await expect(sheet).toBeVisible();
  // the app bar sets a stacking context, so a sheet rendered inside it would sit under the bottom tabs.
  // Wait for the slide-up to finish first: mid-animation the sheet is still below the fold.
  const over = await sheet.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished));
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.bottom - 8);
    return { tag: top ? `${top.tagName}.${top.className}` : 'nothing', inSheet: el.contains(top) };
  });
  expect(over, 'the bottom of the sheet must be on top of the tab bar').toEqual({ tag: expect.any(String), inSheet: true });

  await sheet.getByLabel('Move with a join code').fill(DEMO_CODE);
  await sheet.getByRole('button', { name: /^Move to MIT Manipal/ }).click();
  await expect(appbarCard(page)).toHaveAccessibleName(/MIT Manipal/);
  expect(appErrors(consoleErrors)).toEqual([]);
  await context.close();
});
