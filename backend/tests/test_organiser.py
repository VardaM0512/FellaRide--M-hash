"""Organiser dashboard: activity feed, broadcasts to an audience with history, renaming the community, demo names."""
from datetime import datetime, timedelta, timezone

import pytest

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


def test_impact_adds_up(client):
    tid, h = demo_id(client), demo_admin(client)
    r = client.get(f"{API}/tenants/{tid}/impact", headers=h).json()
    if not r["rides"]:   # run on its own, the test database's demo may not have ridden yet
        assert client.post(f"{API}/tenants/{tid}/simulate", headers=h, json={"days": 5}).status_code == 200
        r = client.get(f"{API}/tenants/{tid}/impact", headers=h).json()
    assert r["rides"] > 0 and r["seats"] >= r["rides"]
    assert r["co2_kg"] == pytest.approx(r["km_shared"] * r["assumptions"]["co2_kg_per_km"], abs=1)
    assert r["series"][-1]["co2_kg"] == pytest.approx(r["co2_kg"], abs=1)       # the running total ends at the total
    assert [d["day"] for d in r["series"]] == list(range(len(r["series"])))    # every day, quiet days included
    assert r["routes"] and r["routes"] == sorted(r["routes"], key=lambda x: -x["km"])
    assert r["money_saved"] == pytest.approx(r["km_shared"] * r["assumptions"]["car_cost_per_km"], abs=r["assumptions"]["car_cost_per_km"])


def test_organiser_pauses_a_reported_member(client, community):
    org, tid = community["admin_headers"], community["id"]
    d, dh, _ = signup(client, "Pause Driver", join_code=community["join_code"])
    r, rh, _ = signup(client, "Pause Rider", join_code=community["join_code"])
    when = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
    trip = {"from_name": "Lakeview", "from_lat": 12.97, "from_lon": 77.55, "to_name": "Tech Park", "to_lat": 12.97, "to_lon": 77.65,
            "depart_at": when, "route": ROUTE, "route_km": 11.2, "route_min": 25, "seats": 2, "licence_confirmed": True, "cost_share_confirmed": True}
    tid_trip = client.post(f"{API}/trips", headers=dh, json=trip).json()["id"]
    client.post(f"{API}/trips/{tid_trip}/request", headers=rh, json={"pickup_name": "Mid", "pickup_lat": 12.97, "pickup_lon": 77.60})
    seat = client.get(f"{API}/trips/{tid_trip}", headers=dh).json()["riders"][0]
    client.post(f"{API}/trips/{tid_trip}/seats/{seat['seat_id']}/approve", headers=dh)
    rep = client.post(f"{API}/reports", headers=rh, json={"trip_id": tid_trip, "reported_id": d, "reasons": ["unsafe_driving"], "note": ""})
    assert rep.status_code == 201, rep.text
    client.post(f"{API}/trips/{tid_trip}/cancel", headers=dh)

    assert client.post(f"{API}/tenants/{tid}/suspensions", headers=rh, json={"user_id": d}).status_code == 403
    assert client.post(f"{API}/tenants/{tid}/suspensions", headers=org, json={"user_id": d, "report_id": rep.json()["id"] + 999}).status_code == 404
    s = client.post(f"{API}/tenants/{tid}/suspensions", headers=org, json={"user_id": d, "reason": "Unsafe driving", "report_id": rep.json()["id"]})
    assert s.status_code == 201 and s.json()["name"] == "Pause Driver" and s.json()["reports"] == 1
    assert [x["id"] for x in client.get(f"{API}/tenants/{tid}/suspensions", headers=org).json()] == [d]
    assert all(x["status"] == "reviewed" for x in client.get(f"{API}/tenants/{tid}/trips-overview", headers=org).json()["reports"])

    # paused: no new rides, and they're told why
    again = client.post(f"{API}/trips", headers=dh, json=trip)
    assert again.status_code == 403 and "Unsafe driving" in again.json()["detail"]
    assert any(a["title"] == "Your account is paused" for a in client.get(f"{API}/me/alerts", headers=dh).json()["items"])

    # lifted: rides again
    assert client.delete(f"{API}/tenants/{tid}/suspensions/{d}", headers=org).status_code == 200
    ok = client.post(f"{API}/trips", headers=dh, json=trip)
    assert ok.status_code == 201, ok.text
    client.post(f"{API}/trips/{ok.json()['id']}/cancel", headers=dh)
    assert client.delete(f"{API}/tenants/{tid}/suspensions/{d}", headers=org).status_code == 404


def test_broadcast_read_count(client, community):
    org, tid = community["admin_headers"], community["id"]
    _, mh, _ = signup(client, "Reader One", join_code=community["join_code"])
    signup(client, "Reader Two", join_code=community["join_code"])
    client.post(f"{API}/tenants/{tid}/broadcast", headers=org, json={"title": "Read me", "body": "Please"})
    assert client.get(f"{API}/tenants/{tid}/broadcasts", headers=org).json()["sent"][0]["read"] == 0
    mine = next(a for a in client.get(f"{API}/me/alerts", headers=mh).json()["items"] if a["title"] == "Read me")
    client.post(f"{API}/me/alerts/read", headers=mh, json={"ids": [mine["id"]]})
    b = client.get(f"{API}/tenants/{tid}/broadcasts", headers=org).json()["sent"][0]
    assert b["title"] == "Read me" and b["sent"] == 2 and b["read"] == 1


def test_live_board_replays_demo_rides_and_shows_real_ones(client, community):
    # demo: the latest day's completed rides, replayed and marked simulated
    tid, h = demo_id(client), demo_admin(client)
    live = client.get(f"{API}/tenants/{tid}/live", headers=h).json()
    if not live["rides"]:
        client.post(f"{API}/tenants/{tid}/simulate", headers=h, json={"days": 3})
        live = client.get(f"{API}/tenants/{tid}/live", headers=h).json()
    sim = [r for r in live["rides"] if r["kind"] == "simulated"]
    assert live["simulated"] and sim and len(sim) <= 8 and all(r["id"].startswith("sim-") for r in sim)
    now = datetime.fromisoformat(live["server_now"])
    for r in sim:
        assert len(r["waypoints"]) == len(r["riders"]) + 2            # home, each pickup, destination
        assert 0 <= (now - datetime.fromisoformat(r["started_at"])).total_seconds() < live["loop_s"]
    starts = {r["started_at"] for r in sim}
    assert len(starts) == len(sim)                                    # staggered, so cars are spread along the way

    # a real community: only rides under way or leaving soon, never simulated
    org, ctid = community["admin_headers"], community["id"]
    _, dh, _ = signup(client, "Live Driver", join_code=community["join_code"])
    _, dh2, _ = signup(client, "Later Driver", join_code=community["join_code"])
    base = {"from_name": "Lakeview", "from_lat": 12.97, "from_lon": 77.55, "to_name": "Tech Park", "to_lat": 12.97, "to_lon": 77.65,
            "route": ROUTE, "route_km": 11.2, "route_min": 25, "seats": 2, "licence_confirmed": True, "cost_share_confirmed": True}
    soon = client.post(f"{API}/trips", headers=dh, json={**base, "depart_at": (datetime.now(timezone.utc) + timedelta(minutes=20)).isoformat()}).json()
    later = client.post(f"{API}/trips", headers=dh2, json={**base, "depart_at": (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()}).json()
    rides = client.get(f"{API}/tenants/{ctid}/live", headers=org).json()
    assert not rides["simulated"] and [r["id"] for r in rides["rides"]] == [f"trip-{soon['id']}"]
    assert rides["rides"][0]["status"] == "leaving" and rides["rides"][0]["driver"]["name"] == "Live Driver"
    client.post(f"{API}/trips/{soon['id']}/start", headers=dh)
    client.post(f"{API}/trips/{soon['id']}/location", headers=dh, json={"lat": 12.97, "lon": 77.58})
    r = client.get(f"{API}/tenants/{ctid}/live", headers=org).json()["rides"][0]
    assert r["status"] == "on_the_way" and r["live"]["lon"] == 77.58
    assert client.get(f"{API}/tenants/{ctid}/live", headers=dh).status_code == 403
    for t, hh in ((soon, dh), (later, dh2)):
        client.post(f"{API}/trips/{t['id']}/end", headers=hh)
        client.post(f"{API}/trips/{t['id']}/cancel", headers=hh)
