"""Organiser dashboard: activity feed, broadcasts to an audience with history, renaming the community, demo names."""
from datetime import datetime, timedelta, timezone

from app.sim.synthetic import DEMO_NAME

from .conftest import API
from .test_expansion import demo_id
from .test_simulation import demo_admin
from .test_trips import ROUTE, signup


def test_demo_community_has_a_name(client):
    names = [t["name"] for t in client.get(f"{API}/tenants").json()]
    assert DEMO_NAME in names and not any(n.startswith("Synthetic University") for n in names)


def test_activity_feed_shows_milestones_not_bookkeeping(client):
    tid, h = demo_id(client), demo_admin(client)
    feed = client.get(f"{API}/tenants/{tid}/activity", headers=h, params={"limit": 30}).json()
    assert feed and len(feed) <= 30
    assert all(e["type"] not in ("nudge_sent", "ride_offered", "ride_requested", "ride_matched") for e in feed)
    assert [e["id"] for e in feed] == sorted((e["id"] for e in feed), reverse=True)   # newest first
    assert any(e["member"] and e["member"]["name"] for e in feed)


def test_broadcast_audiences_and_history(client, community):
    org, tid = community["admin_headers"], community["id"]
    _, dh, _ = signup(client, "Bcast Driver", join_code=community["join_code"])
    _, rh, _ = signup(client, "Bcast Rider", join_code=community["join_code"])
    when = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
    r = client.post(f"{API}/trips", headers=dh, json={      # posting a ride with a car saves the car: now a driver
        "from_name": "Lakeview", "from_lat": 12.97, "from_lon": 77.55, "to_name": "Tech Park", "to_lat": 12.97, "to_lon": 77.65,
        "depart_at": when, "route": ROUTE, "route_km": 11.2, "route_min": 25, "seats": 2, "licence_confirmed": True,
        "cost_share_confirmed": True, "car": {"model": "Swift", "colour": "Red", "plate": "KA01AB1234"}})
    assert r.status_code == 201, r.text

    before = client.get(f"{API}/tenants/{tid}/broadcasts", headers=org).json()
    assert before["audiences"] == {"all": 2, "drivers": 1, "riders": 1, "new": 2} and before["sent"] == []
    r = client.post(f"{API}/tenants/{tid}/broadcast", headers=org, json={"title": "Gate 2 closed", "audience": "new"})
    assert r.status_code == 201 and r.json()["sent"] == 2   # nobody has shared a ride yet
    assert any(a["title"] == "Gate 2 closed" for a in client.get(f"{API}/me/alerts", headers=rh).json()["items"])
    hist = client.get(f"{API}/tenants/{tid}/broadcasts", headers=org).json()["sent"]
    assert hist[0]["title"] == "Gate 2 closed" and hist[0]["audience"] == "new" and hist[0]["sent"] == 2
    assert client.post(f"{API}/tenants/{tid}/broadcast", headers=org, json={"title": "x", "audience": "everyone"}).status_code == 422
    assert client.get(f"{API}/tenants/{tid}/broadcasts", headers=rh).status_code == 403


def test_organiser_renames_the_community(client, community):
    org, tid = community["admin_headers"], community["id"]
    _, mh, _ = signup(client, "Rename M.", join_code=community["join_code"])
    assert client.put(f"{API}/tenants/{tid}", headers=mh, json={"name": "Nope"}).status_code == 403
    assert client.put(f"{API}/tenants/{tid}", headers=org, json={"name": " "}).status_code == 422
    r = client.put(f"{API}/tenants/{tid}", headers=org, json={"name": "  Lakeside College Riders "})
    assert r.status_code == 200 and r.json()["name"] == "Lakeside College Riders"
    assert client.get(f"{API}/tenants/{tid}", headers=org).json()["name"] == "Lakeside College Riders"
