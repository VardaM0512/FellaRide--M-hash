// The ride group card: once a ride has matched, who is in the car — the driver, everyone riding, and the
// seats still free — shown the same way to the driver and to the riders.
import { expect, test, type Page } from '@playwright/test';
import { appErrors, askAndApprove, auth, open, postTrip, signup, V1, type Session } from './helpers';

const card = (page: Page) => page.locator('.ride-group');
const stop = (page: Page, name: string) => card(page).locator('li.rg-stop').filter({ hasText: name });

/** A ride with 4 seats: one rider already in the car, one approved and waiting, two seats free. */
async function matchedRide(request: Parameters<typeof signup>[0]) {
  const driver = await signup(request, 'Rahul Menon', 'male');
  const inCar = await signup(request, 'Meera Joshi');
  const waiting = await signup(request, 'Kavya Shetty');
  const { trip } = await postTrip(request, driver, { seats: 4 });
  const seatA = await askAndApprove(request, driver, inCar, trip.id, { pickup_name: 'Hebri Road Junction' });
  await askAndApprove(request, driver, waiting, trip.id, { pickup_name: 'Kundapura Road stop' });
  const board = await request.post(`${V1}/trips/${trip.id}/seats/${seatA}/board`, { headers: auth(driver) });
  expect(board.status(), await board.text()).toBe(200);
  return { trip, driver, inCar, waiting };
}

test('the card shows the driver, everyone riding and the seats still free @cross', async ({ browser, request }) => {
  const { trip, waiting } = await matchedRide(request);
  const { context, page, consoleErrors } = await open(browser, waiting as Session);
  await page.goto(`/trip/${trip.id}`);
  await expect(card(page)).toBeVisible();

  // one pip per seat offered, filled for the seats taken — a count, not an estimate
  await expect(card(page).getByRole('img')).toHaveAccessibleName('2 of 4 seats taken');
  await expect(card(page)).toContainText('2 free');

  // each person says where they are on the journey
  await expect(stop(page, 'Rahul Menon')).toContainText('Driving');
  await expect(stop(page, 'Rahul Menon')).toContainText('White Maruti Swift');
  await expect(stop(page, 'Meera Joshi')).toContainText('In the car · got on at Hebri Road Junction');
  await expect(stop(page, 'Kavya Shetty')).toContainText('Gets on at Kundapura Road stop');

  // the free seats are stops of their own, so an empty car looks empty
  await expect(card(page).locator('li.rg-free')).toHaveCount(2);
  await expect(card(page).getByRole('link', { name: 'Invite someone' })).toBeVisible();

  expect(appErrors(consoleErrors)).toEqual([]);
  await context.close();
});

test('nobody calls or reports themselves', async ({ browser, request }) => {
  const { trip, driver, waiting } = await matchedRide(request);

  // the rider sees their own stop marked "You", with no actions on it
  const asRider = await open(browser, waiting as Session);
  await asRider.page.goto(`/trip/${trip.id}`);
  await expect(stop(asRider.page, 'Kavya Shetty')).toContainText('You');
  await expect(stop(asRider.page, 'Kavya Shetty').getByRole('button', { name: 'Report' })).toHaveCount(0);
  await expect(stop(asRider.page, 'Rahul Menon').getByRole('button', { name: 'Report' })).toBeVisible();
  await asRider.context.close();

  // and so does the driver, on their own stop
  const asDriver = await open(browser, driver as Session);
  await asDriver.page.goto(`/trip/${trip.id}`);
  await expect(stop(asDriver.page, 'Rahul Menon')).toContainText('You');
  await expect(stop(asDriver.page, 'Rahul Menon').getByRole('button', { name: 'Report' })).toHaveCount(0);
  await expect(stop(asDriver.page, 'Meera Joshi').getByRole('button', { name: 'Report' })).toBeVisible();
  await asDriver.context.close();
});

test('a full car shows no free seats, and an unmatched ride shows no card', async ({ browser, request }) => {
  const driver = await signup(request, 'Naina Acharya');
  const { trip } = await postTrip(request, driver, { seats: 1 });

  // posted, nobody has asked yet: there is no group to show
  const before = await open(browser, driver as Session);
  await before.page.goto(`/trip/${trip.id}`);
  await expect(before.page.getByRole('heading', { name: 'Seat requests' })).toBeVisible();
  await expect(card(before.page)).toHaveCount(0);
  await before.context.close();

  const rider = await signup(request, 'Dev Chandra', 'male');
  await askAndApprove(request, driver, rider, trip.id, { pickup_name: 'Udupi stop' });

  const after = await open(browser, driver as Session);
  await after.page.goto(`/trip/${trip.id}`);
  await expect(card(after.page)).toBeVisible();
  await expect(card(after.page)).toContainText('Full');
  await expect(card(after.page).locator('li.rg-free')).toHaveCount(0);
  await expect(card(after.page).getByRole('img')).toHaveAccessibleName('1 of 1 seats taken');
  await after.context.close();
});
