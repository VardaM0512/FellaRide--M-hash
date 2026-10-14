# Deploy FellaRide (Supabase + Render + Vercel)

- **Database**: Supabase, used only as Postgres. Auth, RLS and Edge Functions stay off; the API does login and permissions.
- **API**: Render (free, Docker) from `render.yaml`.
- **Web app**: Vercel from `frontend/` (`vercel.json` has the page rewrites).
- **Daily job**: GitHub Actions (`.github/workflows/daily-close.yml`) calls `POST /api/v1/cron/close-days`.

## 1. Supabase
1. Project → **Connect** → copy the **Session pooler** URI (port 5432).
2. Replace `[YOUR-PASSWORD]` with the database password. If it has `@ # / :`, reset it to letters and numbers.
3. Add `?sslmode=require` at the end. Keep this URI private.

## 2. Push the code
- Commit and push this folder to GitHub (Render and Vercel deploy from GitHub).

## 3. Render (API)
1. render.com → **New → Blueprint** → pick the repo → it reads `render.yaml`.
2. When asked, fill in:
   - `FELLARIDE_DATABASE_URL` = the Supabase URI from step 1
   - `FELLARIDE_CORS_ORIGINS` = `https://placeholder.vercel.app` for now (fixed in step 5)
3. Click **Apply**. Wait for "Live", then open `https://<name>.onrender.com/health` → `{"status":"ok"}`.
4. Supabase → **Table Editor** should now show 27 tables.
5. Copy `FELLARIDE_ADMIN_KEY` from Render → **Environment** (Render generated it).

## 4. Vercel (web app)
1. vercel.com → **Add New → Project** → import the repo.
2. **Root Directory** = `frontend`. Framework = Vite (auto).
3. **Environment Variables**: `VITE_API_URL` = `https://<name>.onrender.com` (no trailing slash).
4. **Deploy**. Copy the site URL.

## 5. Connect them
- Render → **Environment** → `FELLARIDE_CORS_ORIGINS` = your Vercel URL (no trailing slash) → **Save**. Render redeploys.
- Open the Vercel URL → **Start a community** → this creates your admin account and the join code.

## 6. Daily job
- GitHub repo → **Settings → Secrets and variables → Actions** → add:
  - `FELLARIDE_API_URL` = `https://<name>.onrender.com`
  - `FELLARIDE_ADMIN_KEY` = the key from step 3.5
- **Actions** → "Daily day close" → **Run workflow** once to test. After that it runs every night at 00:05 India time.

## Notes
- Judge demo with sample data: set `FELLARIDE_SEED_DEMO_DAYS=14` and `FELLARIDE_DEMO_LOGIN=true` on Render **before the first start** on an empty database.
- Render free sleeps after 15 min idle (the first request takes about a minute). Supabase free pauses after 7 days idle. Open both before a demo.
- No migrations: if you change a column later, run `ALTER TABLE` in the Supabase SQL editor.
