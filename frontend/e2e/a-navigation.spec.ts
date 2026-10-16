// A. Application startup and navigation
import { expect, test } from '@playwright/test';
import { appErrors, open, signup } from './helpers';

test.describe('A. Startup and navigation', () => {
  test('A1 @cross the welcome page loads with its live impact numbers and no errors', async ({ browser }) => {
    const w = await open(browser, null, { viewport: { width: 1280, height: 900 } });
    await w.page.goto('/welcome');
    await expect(w.page).toHaveTitle(/FellaRide/);
    await expect(w.page.getByRole('heading', { name: 'Ride with Confidence.' })).toBeVisible();
    await expect(w.page.getByText('Live impact')).toBeVisible();
    await expect(w.page.getByRole('link', { name: /Create an account/ })).toBeVisible();
    expect(appErrors(w.consoleErrors)).toEqual([]);
    expect(w.failed).toEqual([]);
    await w.context.close();
  });

  test('A2 every signed-out route renders a real screen, not a blank page', async ({ browser }) => {
    const w = await open(browser, null);
    const routes: [string, RegExp][] = [
      ['/welcome', /Ride with Confidence/], ['/signin', /Sign in/], ['/signup', /Create account/],
      ['/forgot-password', /Forgot password/], ['/demo', /demo/i], ['/start', /community/i], ['/reset-password', /reset email/i],
    ];
    for (const [path, text] of routes) {
      await w.page.goto(path);
      await expect(w.page.locator('main')).toContainText(text);
    }
    expect(appErrors(w.consoleErrors)).toEqual([]);
    await w.context.close();
  });

  test('A3 the welcome page buttons lead to the right screens', async ({ browser }) => {
    const w = await open(browser, null);
    for (const [name, path] of [[/Create an account/, '/signup'], [/^Sign in$/, '/signin'], [/Try the demo community/, '/demo'],
      [/Start one/, '/start']] as const) {
      await w.page.goto('/welcome');
      await w.page.getByRole('link', { name }).click();
      await expect(w.page).toHaveURL(new RegExp(`${path}$`));
    }
    await w.context.close();
  });

  test('A4 unknown and malformed URLs send people somewhere sensible', async ({ browser, request }) => {
    const out = await open(browser, null);
    await out.page.goto('/this/does/not/exist');
    await expect(out.page).toHaveURL(/\/welcome$/);          // signed out: the welcome page
    await out.page.goto('/trip/not-a-number');
    await expect(out.page).toHaveURL(/\/welcome$/);
    await out.context.close();

    const s = await signup(request, 'Lost Rider');
    const inn = await open(browser, s);
    await inn.page.goto('/nowhere');
    await expect(inn.page).toHaveURL(/localhost:\d+\/$/);       // signed in: home
    await inn.page.goto('/trip/999999');
    await expect(inn.page.getByText(/doesn’t exist or you can’t see it/)).toBeVisible();
    await inn.context.close();
  });

  test('A5 refreshing and opening a deep link directly keep you where you were', async ({ browser, request }) => {
    const s = await signup(request, 'Refresh Rider');
    const w = await open(browser, s);
    await w.page.goto('/find');
    await expect(w.page.getByRole('button', { name: /Find rides/ })).toBeVisible();
    await w.page.reload();
    await expect(w.page).toHaveURL(/\/find$/);
    await expect(w.page.getByRole('button', { name: /Find rides/ })).toBeVisible();
    await w.page.goto('/me');
    await w.page.reload();
    await expect(w.page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    expect(appErrors(w.consoleErrors)).toEqual([]);
    await w.context.close();
  });
});
