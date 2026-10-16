// End-to-end and API tests (Playwright). Each run starts its own API on a fresh SQLite database and its own web app,
// so tests never touch the shared Supabase database or a developer's running servers.
//   npx playwright test                 all tests, Chromium (+ the cross-browser smoke tests on Firefox and WebKit)
//   npx playwright test --project=chromium
//   npx playwright show-report e2e/report
import { defineConfig, devices } from '@playwright/test';

const API_PORT = 8031;
const WEB_PORT = 5175;
const DB = 'e2e/.tmp/e2e.db';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.tmp/results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 4,
  retries: 0,                              // a flaky test is a finding, not something to hide
  reporter: [['list'], ['html', { outputFolder: 'e2e/report', open: 'never' }], ['json', { outputFile: 'e2e/.tmp/results.json' }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grep: /@cross/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /@cross/ },
  ],
  webServer: [
    {
      // a throwaway database: deleted before every run; a small synthetic demo so the demo screens have data
      command: `mkdir -p e2e/.tmp && rm -f ${DB} && cd ../backend && `
        + `FELLARIDE_DATABASE_URL=sqlite:///../frontend/${DB} FELLARIDE_SEED_DEMO_DAYS=2 FELLARIDE_DEFAULT_JOIN_CODE= `
        + `FELLARIDE_CORS_ORIGINS=http://localhost:${WEB_PORT} FELLARIDE_APP_URL=http://localhost:${WEB_PORT} `
        + `FELLARIDE_JWT_SECRET=e2e-only-secret-e2e-only-secret-e2e-only-secret FELLARIDE_AUTH_RATE_LIMIT=100000 `
        + `FELLARIDE_DEMO_ADMIN_PASSWORD=e2e-admin-pass FELLARIDE_SMTP_HOST= `
        + `.venv/bin/uvicorn app.main:app --port ${API_PORT} > ../frontend/e2e/.tmp/api.log 2>&1`,
      url: `http://localhost:${API_PORT}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      command: `VITE_API_URL=http://localhost:${API_PORT} npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
