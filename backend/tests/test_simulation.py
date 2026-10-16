"""The core claim of the project: the smart engine grows a community faster than random nudges."""
from .conftest import bearer

API = "/api/v1"
OPERATOR = {"X-Admin-Key": "operator-key"}


def demo_admin(client):
    from app.config import get_settings
    r = client.post(f"{API}/auth/login", json={"email": "admin@demo.fellaride.app",
                                               "password": get_settings().demo_admin_password})
    assert r.status_code == 200, r.text
    return bearer(r.json()["token"])


def test_smart_engine_beats_random_nudges(client):
    r = client.post(f"{API}/demo/compare", headers=demo_admin(client), json={"days": 25, "seed_active": 15})
    assert r.status_code == 200, r.text
    out = r.json()
    smart, rand = out["smart"]["kpis"], out["random"]["kpis"]
    assert smart["active_users"] > rand["active_users"]
    assert smart["rides_completed"] > rand["rides_completed"]
    assert smart["match_rate"] > rand["match_rate"]
    assert len(out["smart"]["timeseries"]) == 25


def test_simulation_moves_the_clock_and_records_metrics(client, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "admin_key", "operator-key")
    t = client.post(f"{API}/tenants/demo", headers=OPERATOR, json={"seed_active": 10}).json()
    r = client.post(f"{API}/tenants/{t['id']}/simulate", headers=OPERATOR, json={"days": 5}).json()
    assert r["current_day"] == 5 and len(r["days"]) == 5
    assert len(client.get(f"{API}/tenants/{t['id']}/metrics/timeseries", headers=OPERATOR).json()) == 5


def test_demo_community_is_seeded_for_evaluators(client):
    tenants = client.get(f"{API}/tenants").json()
    demo = tenants[0]
    assert demo["synthetic"] and demo["current_day"] >= 3
    admin = demo_admin(client)
    assert client.get(f"{API}/tenants/{demo['id']}/metrics", headers=admin).json()["registered"] > 0
    # one-tap demo sign-in as a synthetic member, who can then use the member app
    people = client.get(f"{API}/tenants/{demo['id']}/demo-accounts").json()
    assert people and all("email" not in p for p in people)
    s = client.post(f"{API}/auth/demo-login", json={"tenant_id": demo["id"], "member_id": people[0]["id"]}).json()
    h = bearer(s["token"])
    assert client.get(f"{API}/tenants/{demo['id']}/members/{people[0]['id']}", headers=h).status_code == 200
    assert client.get(f"{API}/tenants/{demo['id']}/metrics", headers=h).status_code == 403


def test_synthetic_clock_is_manual_and_says_so(client):
    """Bug report: the demo looked frozen. Its timeline is the simulator's (it moves with Next day / Simulate, never
    with the calendar, see daycycle.catch_up), and the API now says so, so the dashboard can label it."""
    from datetime import timedelta

    from app.db import SessionLocal
    from app.models import Tenant
    demo = client.get(f"{API}/tenants").json()[0]
    assert demo["synthetic"] and demo["clock"] == "manual"
    with SessionLocal() as db:   # three calendar days pass
        t = db.get(Tenant, demo["id"])
        t.created_at = t.created_at - timedelta(days=3)
        db.commit()
    again = client.get(f"{API}/tenants/{demo['id']}").json()
    assert again["current_day"] == demo["current_day"] and again["clock"] == "manual"
    # only the organiser's Next day moves it
    k = client.post(f"{API}/tenants/{demo['id']}/day/close", headers=demo_admin(client)).json()
    assert k["current_day"] == demo["current_day"] + 1
