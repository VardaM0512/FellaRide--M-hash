"""The member app feeds the activation engine: real rides move the funnel, KPIs, growth graph and model weights,
claims and invites close Discover -> Register -> Refer, and app actions answer nudges without engine rides."""
import itertools
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.engine import activation
from app.models import Destination, Event, Intervention, Member, Trip, User

from .conftest import API, bearer

_n = itertools.count(1)
ROUTE = [[12.97, 77.55 + i * 0.01] for i in range(11)]   # east from (12.97, 77.55) to (12.97, 77.65)


# ---------- helpers ----------
def signup(client, name, code=None, gender="female", email=None):
    i = next(_n)
    r = client.post(f"{API}/auth/signup", json={
        "name": name, "gender": gender, "email": email or f"act{i}@example.org", "mobile": f"+91 91111 {i:05d}",
        "password": "act-pass-123", **({"join_code": code} if code else {})})
    assert r.status_code == 201, r.text
    s = r.json()
    return s["user"]["id"], bearer(s["token"])


def member_id(client, h):
    return client.get(f"{API}/auth/me", headers=h).json()["user"]["member_id"]


def post_trip(client, h, minutes=0, seats=3):
    r = client.post(f"{API}/trips", headers=h, json={
        "from_name": "Lakeview", "from_lat": 12.97, "from_lon": 77.55, "to_name": "Tech Park", "to_lat": 12.97,
        "to_lon": 77.65, "depart_at": (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat(),
        "route": ROUTE, "route_km": 11.2, "route_min": 25, "seats": seats})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def take_seats(client, trip_id, dh, riders):
    """Each rider asks, the driver approves and marks them in. Returns seat ids in rider order."""
    for h in riders:
        assert client.post(f"{API}/trips/{trip_id}/request", headers=h, json={"pickup_name": "Lake Rd", "pickup_lat": 12.971,
                                                                              "pickup_lon": 77.57}).status_code == 200
    seat_ids = [r["seat_id"] for r in client.get(f"{API}/trips/{trip_id}", headers=dh).json()["riders"]]
    for sid in seat_ids:
        assert client.post(f"{API}/trips/{trip_id}/seats/{sid}/approve", headers=dh).status_code == 200
        assert client.post(f"{API}/trips/{trip_id}/seats/{sid}/board", headers=dh).status_code == 200
    return seat_ids


def ride(client, dh, riders):
    trip_id = post_trip(client, dh)
    take_seats(client, trip_id, dh, riders)
    assert client.post(f"{API}/trips/{trip_id}/end", headers=dh).json()["status"] == "completed"
    return trip_id


def admin(client, community, path):
    r = client.get(f"{API}/tenants/{community['id']}{path}", headers=community["admin_headers"])
    assert r.status_code == 200, r.text
    return r.json()


def funnel(client, community):
    return {s["step"]: s["count"] for s in admin(client, community, "/metrics/funnel")}


def updates(client, community):
    return {role: v["updates"] for role, v in admin(client, community, "/model").items()}


def state(client, community, mid):
    return admin(client, community, f"/members/{mid}")["state"]


def new_community(client):
    i = next(_n)
    r = client.post(f"{API}/tenants", json={
        "name": f"Bridge Test {i}", "kind": "corporate", "center_lat": 12.97, "center_lon": 77.59,
        "destinations": [{"name": "Office", "lat": 12.97, "lon": 77.65}],
        "admin": {"name": "Org B", "email": f"orgb{i}@example.org", "password": "admin-pass-123"}})
    assert r.status_code == 201, r.text
    body = r.json()
    body["admin_headers"] = bearer(body["session"]["token"])
    return body


# ---------- tests ----------
def test_live_ride_moves_funnel_kpis_graph_and_model(client, community):
    code = community["join_code"]
    _, dh = signup(client, "Asha D.", code)
    _, rh = signup(client, "Rohan R.", code, "male")
    d, r = member_id(client, dh), member_id(client, rh)
    assert d and r                                         # joining with a code registers you straight away
    f0, k0, u0 = funnel(client, community), admin(client, community, "/metrics"), updates(client, community)

    ride(client, dh, [rh])

    f1, k1, u1 = funnel(client, community), admin(client, community, "/metrics"), updates(client, community)
    assert f1["first_ride"] == f0["first_ride"] + 2
    assert k1["rides_completed"] == k0["rides_completed"] + 1
    assert k1["by_source"]["app"]["rides_completed"] == 1 and k1["by_source"]["app"]["riders_carried"] == 1
    assert k1["active_users"] == k0["active_users"] + 2
    edges = admin(client, community, "/graph")["edges"]
    assert any(e["kind"] == "co_ride" and {e["source"], e["target"]} == {d, r} for e in edges)
    assert u1["driver"] > u0["driver"] and u1["rider"] > u0["rider"]


def test_second_ride_makes_both_repeat_riders_and_ratings_teach_the_model(client, community):
    code = community["join_code"]
    _, dh = signup(client, "Kabir L.", code, "male")
    _, rh = signup(client, "Nina W.", code)
    trip_id = ride(client, dh, [rh])
    ride(client, dh, [rh])
    assert state(client, community, member_id(client, dh)) == "repeat"
    assert state(client, community, member_id(client, rh)) == "repeat"
    # a rating from the app trains the author's role model, as engine ride feedback does
    u0 = updates(client, community)
    assert client.post(f"{API}/trips/{trip_id}/ratings", headers=rh,
                       json={"to_id": client.get(f"{API}/auth/me", headers=dh).json()["user"]["id"], "stars": 5}).status_code == 201
    assert updates(client, community)["rider"] == u0["rider"] + 1


def test_open_community_member_and_destination_created_at_first_ride(client):
    uid, h = signup(client, "Meera S.")
    assert member_id(client, h) is None                    # no code: nothing to anchor a commute to yet
    trip_id = post_trip(client, h)
    mid = member_id(client, h)
    with SessionLocal() as db:
        m = db.get(Member, mid)
        user = db.get(User, uid)
        assert m.tenant_id == user.tenant_id and m.state == "interacted" and m.has_car
        dest = db.get(Destination, m.destination_id)
        assert dest.tenant_id == user.tenant_id and abs(dest.lon - 77.65) < 0.02
        assert db.scalar(select(Event).where(Event.member_id == mid, Event.type == "trip_posted")) is not None
    client.post(f"{API}/trips/{trip_id}/end", headers=h)   # don't leave a live ride in the shared open community


def test_register_claims_imported_member_and_converts_the_referral(client, community):
    tid, code = community["id"], community["join_code"]
    imported = client.post(f"{API}/tenants/{tid}/members/import", headers=community["admin_headers"], json={"members": [
        {"name": "Tara F.", "email": "Tara.F@Example.org", "home_lat": 12.971, "home_lon": 77.561,
         "destination_id": community["destinations"][0]["id"], "depart_min": 490}]}).json()["member_ids"][0]
    _, ih = signup(client, "Inviter I.", code)
    inviter = member_id(client, ih)
    ref = client.post(f"{API}/tenants/{tid}/referrals", headers=ih, json={"invitee_id": imported})
    assert ref.status_code == 201, ref.text

    r = client.post(f"{API}/auth/register", json={
        "join_code": code, "name": "Tara F.", "email": "tara.f@example.org", "password": "member-pass-1",
        "home_lat": 12.97, "home_lon": 77.56, "destination_id": community["destinations"][0]["id"], "depart_min": 480})
    assert r.status_code == 201, r.text
    assert r.json()["member"]["id"] == imported           # claimed, not duplicated
    assert client.get(f"{API}/tenants/{tid}/me/referrals", headers=ih).json()[0]["status"] == "joined"
    assert state(client, community, inviter) == "referrer"
    assert sum(m["name"] == "Tara F." for m in admin(client, community, "/members?limit=1000")) == 1


def test_app_invite_converts_when_they_sign_up(client, community):
    code = community["join_code"]
    _, ih = signup(client, "Dev K.", code, "male")
    inv = client.post(f"{API}/me/invites", headers=ih, json={"name": "Lia M.", "email": "lia.m@example.org"})
    assert inv.status_code == 201 and inv.json()["status"] == "sent"
    assert funnel(client, community)["discovered"] >= 1
    listing = client.get(f"{API}/me/invites", headers=ih).json()
    assert listing["join_code"] == code and listing["invites"][0]["email"] == "lia.m@example.org"
    assert client.post(f"{API}/me/invites", headers=ih, json={"name": "Me", "email": "lia.m@example.org"}).status_code == 201

    _, lh = signup(client, "Lia M.", code, email="lia.m@example.org")
    assert client.get(f"{API}/me/invites", headers=ih).json()["invites"][0]["status"] == "joined"
    assert state(client, community, member_id(client, ih)) == "referrer"
    assert state(client, community, member_id(client, lh)) == "registered"
    taken = client.post(f"{API}/me/invites", headers=ih, json={"name": "Lia M.", "email": "lia.m@example.org"})
    assert taken.status_code == 409


def test_nudge_answered_by_posting_a_ride_without_engine_rides(client, community):
    tid, code = community["id"], community["join_code"]
    _, h = signup(client, "Omar Q.", code, "male")
    mid = member_id(client, h)
    plan = client.post(f"{API}/tenants/{tid}/interventions/plan", headers=community["admin_headers"], json={"budget": 20}).json()
    iv = next(i for i in plan["interventions"] if i["member_id"] == mid)
    nudges = [a for a in client.get(f"{API}/me/alerts", headers=h).json()["items"] if a["kind"].startswith("nudge_")]
    assert nudges and nudges[0]["kind"] == f"nudge_{iv['kind']}"
    u0 = updates(client, community)

    post_trip(client, h)

    ivs = admin(client, community, f"/interventions?member_id={mid}")
    assert ivs[0]["id"] == iv["id"] and ivs[0]["status"] == "responded"
    with SessionLocal() as db:
        role = db.get(Intervention, iv["id"]).role
    assert updates(client, community)[role] == u0[role] + 1
    rides = admin(client, community, "/rides")
    assert rides["offers"] == [] and rides["requests"] == []   # the app ride is the answer; no engine ride made
    assert all(a["read"] for a in client.get(f"{API}/me/alerts", headers=h).json()["items"] if a["kind"].startswith("nudge_"))


def test_rides_are_counted_once_per_person(client, community):
    code = community["join_code"]
    _, dh = signup(client, "Ira N.", code)
    _, r1 = signup(client, "Zoe B.", code)
    _, r2 = signup(client, "Yash C.", code, "male")
    k0 = admin(client, community, "/metrics")
    trip_id = post_trip(client, dh)
    take_seats(client, trip_id, dh, [r1, r2])
    assert client.post(f"{API}/trips/{trip_id}/end", headers=r1).json()["status"] == "open"   # rider 1 off, ride goes on
    assert client.post(f"{API}/trips/{trip_id}/end", headers=dh).json()["status"] == "completed"
    assert client.post(f"{API}/trips/{trip_id}/end", headers=dh).status_code == 409
    with SessionLocal() as db:                              # the hook itself is idempotent too
        activation.on_trip_finished(db, db.get(Trip, trip_id))
        db.commit()
        counts = [db.get(Member, member_id(client, h)).rides_count for h in (dh, r1, r2)]
    assert counts == [1, 1, 1]
    assert admin(client, community, "/metrics")["rides_completed"] == k0["rides_completed"] + 1


def test_cancelled_and_unfilled_rides_add_no_rides(client, community):
    code = community["join_code"]
    _, dh = signup(client, "Kiran P.", code, "male")
    _, rh = signup(client, "Anu S.", code)
    k0 = admin(client, community, "/metrics")

    trip_id = post_trip(client, dh, minutes=60)
    client.post(f"{API}/trips/{trip_id}/request", headers=rh, json={})
    seat = client.get(f"{API}/trips/{trip_id}", headers=dh).json()["riders"][0]["seat_id"]
    client.post(f"{API}/trips/{trip_id}/seats/{seat}/approve", headers=dh)
    assert client.post(f"{API}/trips/{trip_id}/cancel", headers=dh).json()["status"] == "cancelled"
    lonely = post_trip(client, dh)
    assert client.post(f"{API}/trips/{lonely}/end", headers=dh).json()["status"] == "completed"   # nobody got in

    k1 = admin(client, community, "/metrics")
    assert k1["rides_created"] == k0["rides_created"] + 2
    assert k1["rides_completed"] == k0["rides_completed"]
    assert k1["by_source"]["app"]["rides_cancelled"] == k0["by_source"]["app"]["rides_cancelled"] + 1
    assert k1["completion_rate"] == 0.0 and k1["match_rate"] == 1.0
    with SessionLocal() as db:
        driver = db.get(Member, member_id(client, dh))
        assert driver.rides_count == 0 and driver.first_ride_day is None
        kinds = [e.type for e in db.scalars(select(Event).where(Event.member_id == driver.id))]
    assert "ride_cancelled" in kinds and "trip_unfilled" in kinds


def test_a_ride_in_one_community_leaves_another_untouched(client, community):
    other = new_community(client)
    before = (admin(client, other, "/metrics"), admin(client, other, "/graph"))
    code = community["join_code"]
    _, dh = signup(client, "Sam A.", code, "male")
    _, rh = signup(client, "Pia R.", code)
    ride(client, dh, [rh])
    assert (admin(client, other, "/metrics"), admin(client, other, "/graph")) == before


def test_bridge_failure_never_breaks_the_ride_action(client, community, monkeypatch):
    def broken(db, trip, user):
        db.add(Event(tenant_id=trip.tenant_id, day=0, type="half_written", payload={}))
        db.flush()
        raise RuntimeError("bridge down")
    monkeypatch.setattr(get_settings(), "activation_strict", False)
    monkeypatch.setattr(activation, "on_trip_posted", broken)
    _, h = signup(client, "Lee T.", community["join_code"])
    trip_id = post_trip(client, h)                          # still 201
    with SessionLocal() as db:
        assert db.get(Trip, trip_id) is not None
        assert db.scalar(select(Event).where(Event.type == "half_written")) is None   # savepoint rolled back


def test_real_members_in_the_synthetic_demo_survive_simulation(client):
    """Real people can join the synthetic demo community: the simulator advances the synthetic members and leaves
    the real ones (and their app rides) alone; they answer nudges in the app instead."""
    demo = next(t for t in client.get(f"{API}/tenants").json() if t["synthetic"])
    adm = bearer(client.post(f"{API}/auth/login", json={"email": "admin@demo.fellaride.app",
                                                        "password": "fellaride-demo-admin"}).json()["token"])
    _, dh = signup(client, "Real Driver", "DEMO2026")
    _, rh = signup(client, "Real Rider", "DEMO2026", "male")
    ride(client, dh, [rh])
    real = {member_id(client, dh), member_id(client, rh)}
    before = client.get(f"{API}/tenants/{demo['id']}/metrics", headers=adm).json()

    r = client.post(f"{API}/tenants/{demo['id']}/simulate", headers=adm, json={"days": 3})
    assert r.status_code == 200, r.text

    after = client.get(f"{API}/tenants/{demo['id']}/metrics", headers=adm).json()
    assert after["day"] == before["day"] + 3
    assert after["by_source"]["app"]["rides_completed"] == before["by_source"]["app"]["rides_completed"]
    with SessionLocal() as db:
        assert all(db.get(Member, m).rides_count == 1 for m in real)   # the simulator never rides for real people


def test_sign_up_without_a_code_joins_the_default_community(client, monkeypatch):
    """FELLARIDE_DEFAULT_JOIN_CODE=DEMO2026: no code means the synthetic demo community, registered straight away."""
    monkeypatch.setattr(get_settings(), "default_join_code", "DEMO2026")
    _, h = signup(client, "No Code N.")
    me = client.get(f"{API}/auth/me", headers=h).json()
    assert me["tenant"]["synthetic"] and me["user"]["member_id"]
    monkeypatch.setattr(get_settings(), "default_join_code", "NOSUCH")   # unknown code: fall back to the open community
    _, h2 = signup(client, "Open O.")
    assert not client.get(f"{API}/auth/me", headers=h2).json()["tenant"]["synthetic"]


def test_a_trip_far_outside_the_community_counts_but_is_not_a_commute(client, community):
    """A ride 300 km away still counts (first ride), but doesn't move the commute or add a destination."""
    code = community["join_code"]
    _, dh = signup(client, "Far F.", code)
    _, rh = signup(client, "Away A.", code, "male")
    far = [[12.95, 74.80 + i * 0.01] for i in range(11)]          # around Mangalore, ~300 km west
    trip = client.post(f"{API}/trips", headers=dh, json={
        "from_name": "Mangaluru", "from_lat": 12.95, "from_lon": 74.80, "to_name": "Mangalore Airport", "to_lat": 12.95,
        "to_lon": 74.90, "depart_at": datetime.now(timezone.utc).isoformat(), "route": far, "route_km": 12,
        "route_min": 20, "seats": 2}).json()["id"]
    take_seats(client, trip, dh, [rh])
    client.post(f"{API}/trips/{trip}/end", headers=dh)
    with SessionLocal() as db:
        d = db.get(Member, member_id(client, dh))
        assert d.first_ride_day is not None                          # the ride counts
        assert abs(d.home_lon - 77.59) < 0.1                         # commute unchanged (community centre)
        names = {x.name for x in db.scalars(select(Destination).where(Destination.tenant_id == community["id"]))}
    assert names == {"Campus", "Hospital"}
