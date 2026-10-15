"""Network Expansion Engine: growth areas with forecasts, diagnosis, cross-community corridors, autonomous actions
that are measured and learned from, privacy (k-anonymity for non-members) and organiser-only access."""
from app.sim.synthetic import DEMO_NAME, NEIGHBOUR_NAME

from .conftest import API
from .test_simulation import demo_admin
from .test_trips import signup


def demo_id(client):
    return next(t["id"] for t in client.get(f"{API}/tenants").json() if t["name"] == DEMO_NAME)


def test_report_finds_areas_diagnoses_and_links_communities(client):
    tid, h = demo_id(client), demo_admin(client)
    r = client.get(f"{API}/tenants/{tid}/expansion", headers=h)
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["network"]["members_joined"] > 0 and rep["areas"] and rep["diagnosis"]
    a = rep["areas"][0]
    assert {"label", "score", "gaps", "forecast", "lat", "lon"} <= set(a) and a["forecast"]["trend"] in ("rising", "falling", "steady")
    # areas come strongest first
    assert [x["score"] for x in rep["areas"]] == sorted((x["score"] for x in rep["areas"]), reverse=True)
    # privacy: people who haven't joined are only counted, and never in groups under 3
    for x in rep["areas"]:
        assert x["potential"] is None or x["potential"] >= 3
    assert "only for people who joined" in rep["privacy"]
    # the neighbouring demo community overlaps: shared corridors, other side always counted in 3s or more
    link = next(c for c in rep["cross_community"] if c["community"] == NEIGHBOUR_NAME)
    assert link["shared_corridors"] and all(c["members_there"] >= 3 for c in link["shared_corridors"])
    assert len({c["id"] for c in link["shared_corridors"]}) == len(link["shared_corridors"])
    assert all(c["heading"] in ("east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east")
               for c in link["shared_corridors"])
    assert all("name" not in c for c in link["shared_corridors"])


def test_engine_acts_measures_and_learns(client):
    tid, h = demo_id(client), demo_admin(client)
    before = client.get(f"{API}/tenants/{tid}/expansion", headers=h).json()
    run = client.post(f"{API}/tenants/{tid}/expansion/run", headers=h, json={"max_actions": 3}).json()
    assert run["actions"], "the engine should find something to do in the demo community"
    act = run["actions"][0]
    assert act["targeted"] >= 1 and act["status"] == "active" and act["kind"] in before["effectiveness"]
    # the nudges went out through the normal nudge system, marked as expansion
    ivs = client.get(f"{API}/tenants/{tid}/interventions", headers=h, params={"day": run["day"]}).json()
    assert any(i["strategy"] == "expansion" for i in ivs)
    # running again the same day doesn't repeat an action in the same area
    again = client.post(f"{API}/tenants/{tid}/expansion/run", headers=h, json={"max_actions": 3}).json()
    assert not {(a["area"], a["kind"]) for a in run["actions"]} & {(a["area"], a["kind"]) for a in again["actions"]}

    # let the synthetic community live a few days with the engine on autopilot: actions get judged and learned from
    ap = client.post(f"{API}/tenants/{tid}/expansion/autopilot", headers=h, json={"days": 4})
    assert ap.status_code == 200, ap.text
    rep = client.get(f"{API}/tenants/{tid}/expansion", headers=h).json()
    judged = [a for a in rep["actions"] if a["status"] == "evaluated"]
    assert judged and all({"sent", "responded", "joined_delta", "rides_delta", "success"} <= set(a["outcome"]) for a in judged)
    # every judged action counts as one trial for its action type (the report lists the latest 30 actions)
    assert sum(s["trials"] for s in rep["effectiveness"].values()) >= len(judged)
    assert all(0 < s["rate"] < 1 for s in rep["effectiveness"].values())


def test_propose_shared_corridor(client):
    tid, h = demo_id(client), demo_admin(client)
    link = client.get(f"{API}/tenants/{tid}/expansion", headers=h).json()["cross_community"][0]
    c = link["shared_corridors"][0]
    r = client.post(f"{API}/tenants/{tid}/expansion/corridors", headers=h, json={"community_id": link["community_id"], "corridor": c["id"]})
    assert r.status_code == 201 and r.json()["status"] == "proposed"
    assert client.post(f"{API}/tenants/{tid}/expansion/corridors", headers=h,
                       json={"community_id": link["community_id"], "corridor": "0:0:0"}).status_code == 409


def test_organisers_only_and_synthetic_only(client, community):
    tid = demo_id(client)
    _, member_h, _ = signup(client, "Curious M.")
    assert client.get(f"{API}/tenants/{tid}/expansion", headers=member_h).status_code in (403, 404)
    assert client.get(f"{API}/tenants/{tid}/expansion").status_code == 401
    # a real community: the report works, but autopilot (simulation) and demo neighbours are refused
    real, h = community["id"], community["admin_headers"]
    assert client.get(f"{API}/tenants/{real}/expansion", headers=h).status_code == 200
    assert client.post(f"{API}/tenants/{real}/expansion/autopilot", headers=h, json={"days": 1}).status_code == 409
    assert client.post(f"{API}/tenants/{real}/expansion/demo-neighbour", headers=h).status_code == 409
    # an organiser can't read another community's expansion report
    assert client.get(f"{API}/tenants/{tid}/expansion", headers=h).status_code in (403, 404)


def test_trip_heading_is_a_compass_direction():
    from types import SimpleNamespace as NS

    from app.engine.expansion import HEADING, _direction
    dest = {1: NS(lat=13.0, lon=77.6)}
    trip = lambda lat, lon: HEADING[_direction(NS(home_lat=lat, home_lon=lon, destination_id=1), dest)]  # noqa: E731
    assert trip(12.95, 77.55) == "north-east"   # home south-west of the campus
    assert trip(13.0, 77.5) == "east"
    assert trip(13.05, 77.6) == "south"
    assert trip(13.0, 77.7) == "west"
