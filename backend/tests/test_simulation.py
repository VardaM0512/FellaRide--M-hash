"""The core claim of the project: the smart engine grows a community faster than random nudges."""
API = "/api/v1"


def test_smart_engine_beats_random_nudges(client):
    r = client.post(f"{API}/demo/compare", json={"days": 25, "seed_active": 15})
    assert r.status_code == 200, r.text
    out = r.json()
    smart, rand = out["smart"]["kpis"], out["random"]["kpis"]
    assert smart["active_users"] > rand["active_users"]
    assert smart["rides_completed"] > rand["rides_completed"]
    assert smart["match_rate"] > rand["match_rate"]
    assert len(out["smart"]["timeseries"]) == 25


def test_simulation_moves_the_clock_and_records_metrics(client):
    t = client.post(f"{API}/tenants/demo", json={"seed_active": 10}).json()
    r = client.post(f"{API}/tenants/{t['id']}/simulate", json={"days": 5}).json()
    assert r["current_day"] == 5 and len(r["days"]) == 5
    assert len(client.get(f"{API}/tenants/{t['id']}/metrics/timeseries").json()) == 5


def test_demo_community_is_seeded_for_evaluators(client):
    tenants = client.get(f"{API}/tenants").json()
    demo = tenants[0]
    assert demo["synthetic"] and demo["current_day"] == 3
    assert client.get(f"{API}/tenants/{demo['id']}/metrics").json()["registered"] > 0
