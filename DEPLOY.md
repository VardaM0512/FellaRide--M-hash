# Run and deploy FellaRide (Docker)

## Run everything on your laptop (Docker Desktop)
1. `.env` in the repo root (copy of `.env.example`) with `FELLARIDE_DATABASE_URL` = your Supabase link.
2. `docker compose up --build` (starts the API and the web app; no local database).
   - Without Supabase: remove `FELLARIDE_DATABASE_URL` from `.env` and run `docker compose --profile localdb up --build`.
3. Web app: http://localhost:3000 · API: http://localhost:8000/docs

## Host on Render (Docker) with Supabase
1. Push the repo to GitHub (`render.yaml` must be on the `main` branch).
2. render.com → **New → Blueprint** → connect GitHub → pick the repo. It finds `fellaride-api` and `fellaride-web`.
3. Fill in the 4 empty values:
   - `FELLARIDE_DATABASE_URL` = the Supabase link from your `.env`
   - `FELLARIDE_DEMO_ADMIN_PASSWORD` = any password (demo organiser login: admin@demo.fellaride.app)
   - `FELLARIDE_CORS_ORIGINS` = `https://fellaride-web.onrender.com`
   - `VITE_API_URL` = `https://fellaride-api.onrender.com`
4. Click **Apply** and wait until both show **Live** (first build takes a few minutes).
5. Check the real URLs at the top of each service page. If Render added a suffix (e.g. `fellaride-web-x1y2.onrender.com`):
   - `fellaride-api` → Environment → fix `FELLARIDE_CORS_ORIGINS` → Save
   - `fellaride-web` → Environment → fix `VITE_API_URL` → Save, then **Manual Deploy → Clear build cache & deploy** (the URL is built into the app)
6. Open the web URL. Test: https://<api>/health shows `{"status":"ok"}`.

## Notes
- Demo data (`FELLARIDE_SEED_DEMO_DAYS=14`) is only added when the database is empty. Set it to `0` and `FELLARIDE_DEMO_LOGIN=false` for real users only.
- Free Render services sleep after 15 minutes idle; the first visit then takes about a minute. Supabase free pauses after 7 days idle. Open both before a demo.
