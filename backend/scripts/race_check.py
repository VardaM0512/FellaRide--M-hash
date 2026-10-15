"""Concurrency check: fire seat changes in parallel at a running FellaRide API and check nothing is double-booked.

Run it against a server on a *throwaway Postgres* database (not the shared one: it creates users and rides), with the
sign-in rate limit raised, e.g.:

    FELLARIDE_DATABASE_URL=postgresql+psycopg://...  FELLARIDE_AUTH_RATE_LIMIT=100000 uvicorn app.main:app --port 8014 --workers 4
    python scripts/race_check.py http://localhost:8014

Expected (with the row locks in engine.trips.lock_trip / lock_rider):
  1) 8 parallel approvals of the last seat -> one 200, seven 409, exactly 1 rider approved, 0 seats left
  2) two drivers approve the same rider at once -> one 200, one 409, the rider is on exactly 1 ride
  3) the same rider asks twice at once -> both 200, 1 request stored
Without the locks, Postgres reported deadlocks (500 errors) in case 1 and both drivers were told "approved" in case 2.
SQLite (the unit tests) runs one write at a time, so this needs Postgres to mean anything."""
import json, sys, threading, time, urllib.request, urllib.error, random
from datetime import datetime, timedelta, timezone

API = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8014") + "/api/v1"
tag = f"{int(time.time())}{random.randint(100, 999)}"
k = iter(range(10_000))

def call(m, p, body=None, tok=None):
    req = urllib.request.Request(API + p, method=m, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json", **({"authorization": f"Bearer {tok}"} if tok else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

def user(name):
    i = next(k)
    s, d = call("POST", "/auth/signup", {"name": name, "gender": "female", "email": f"race{tag}x{i}@test.com",
                                         "mobile": f"9{tag[-5:]}{i:04d}"[:10], "password": "race-pass-123"})
    assert s == 201, d
    return d["token"]

ROUTE = [[12.97, 77.55 + i * 0.01] for i in range(11)]
def trip(tok, seats):
    s, d = call("POST", "/trips", {"from_name": "A", "from_lat": 12.97, "from_lon": 77.55, "to_name": "B", "to_lat": 12.97, "to_lon": 77.65,
        "depart_at": (datetime.now(timezone.utc) + timedelta(minutes=60)).isoformat(), "route": ROUTE, "route_km": 11.2, "route_min": 25,
        "seats": seats, "licence_confirmed": True, "cost_share_confirmed": True}, tok)
    assert s == 201, d
    return d["id"]

def at_once(fns):
    out, go = [None] * len(fns), threading.Barrier(len(fns))
    def w(i):
        go.wait()
        out[i] = fns[i]()
    ts = [threading.Thread(target=w, args=(i,)) for i in range(len(fns))]
    [t.start() for t in ts]; [t.join() for t in ts]
    return out

# 1) 8 riders waiting, 1 seat, the driver approves all 8 at the same instant
d = user("Race Driver"); tid = trip(d, 1)
riders = [user(f"Rider {i}") for i in range(8)]
for r in riders: call("POST", f"/trips/{tid}/request", {}, r)
seat_ids = [x["seat_id"] for x in call("GET", f"/trips/{tid}", tok=d)[1]["riders"]]
res = at_once([lambda sid=sid: call("POST", f"/trips/{tid}/seats/{sid}/approve", tok=d) for sid in seat_ids])
final = call("GET", f"/trips/{tid}", tok=d)[1]
approved = [x for x in final["riders"] if x["status"] == "approved"]
print(f"1) last seat, 8 parallel approvals -> http {sorted(s for s, _ in res)} | approved riders: {len(approved)} | seats_left: {final['seats_left']}")

# 2) one rider waiting on two rides; both drivers approve at the same instant
d1, d2, r = user("Driver One"), user("Driver Two"), user("Busy Rider")
t1, t2 = trip(d1, 2), trip(d2, 2)
call("POST", f"/trips/{t1}/request", {}, r); call("POST", f"/trips/{t2}/request", {}, r)
s1 = call("GET", f"/trips/{t1}", tok=d1)[1]["riders"][0]["seat_id"]; s2 = call("GET", f"/trips/{t2}", tok=d2)[1]["riders"][0]["seat_id"]
res = at_once([lambda: call("POST", f"/trips/{t1}/seats/{s1}/approve", tok=d1), lambda: call("POST", f"/trips/{t2}/seats/{s2}/approve", tok=d2)])
on = sum(1 for tt, dd in ((t1, d1), (t2, d2)) if any(x["status"] == "approved" for x in call("GET", f"/trips/{tt}", tok=dd)[1]["riders"]))
print(f"2) one rider, two drivers approve at once -> http {sorted(s for s, _ in res)} | rides the rider is confirmed on: {on}")

# 3) the same rider taps Ask twice at the same instant
d3, r3 = user("Driver Three"), user("Double Tapper"); t3 = trip(d3, 3)
res = at_once([lambda: call("POST", f"/trips/{t3}/request", {}, r3) for _ in range(2)])
rows = call("GET", f"/trips/{t3}", tok=d3)[1]["riders"]
print(f"3) same rider asks twice at once -> http {sorted(s for s, _ in res)} | requests stored: {len(rows)}")
