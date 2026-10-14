"""API flow tests on a real (non-synthetic) community, now with sign-in on every member action."""
from .conftest import API, bearer, join


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_full_activation_loop(client, community):
    tid, admin = community["id"], community["admin_headers"]
    driver, dh = join(client, community, "Asha D.", 77.535, 480, car=True, seats=3)
    rider, rh = join(client, community, "Rohan R.", 77.56, 485)
    friend_id = client.post(f"{API}/tenants/{tid}/members/import", headers=admin, json={"members": [
        {"name": "Tara F.", "home_lat": 12.971, "home_lon": 77.561,
         "destination_id": community["destinations"][0]["id"], "depart_min": 490}]}).json()["member_ids"][0]

    # recommendations without searching; other members' homes are rounded
    recs = client.get(f"{API}/tenants/{tid}/members/{rider}/recommendations", headers=rh).json()
    assert recs["looking_for"] == "drivers" and recs["partners"][0]["member"]["id"] == driver
    assert "email" not in recs["partners"][0]["member"]
    assert recs["partners"][0]["member"]["home"]["lon"] == round(77.535, 2)

    prof = client.get(f"{API}/tenants/{tid}/members/{driver}", headers=dh).json()
    assert set(prof["scores"]) == {"driver", "rider", "connector", "referrer"}

    # nudges -> a yes creates an offer / request and matching happens immediately
    plan = client.post(f"{API}/tenants/{tid}/interventions/plan", headers=admin, json={"budget": 5}).json()
    by_member = {i["member_id"]: i for i in plan["interventions"]}
    assert driver in by_member and rider in by_member
    assert client.post(f"{API}/tenants/{tid}/interventions/{by_member[driver]['id']}/respond", headers=dh,
                       json={"responded": True}).json()["offer_id"]
    r = client.post(f"{API}/tenants/{tid}/interventions/{by_member[rider]['id']}/respond", headers=rh,
                    json={"responded": True}).json()
    assert r["request_id"] and r["matched"] == 1, r

    # both got a "matched" message
    assert any(n["kind"] == "matched" for n in client.get(f"{API}/tenants/{tid}/me/notifications", headers=rh).json()["items"])
    offer_id = client.get(f"{API}/tenants/{tid}/rides", headers=dh).json()["offers"][0]["id"]

    # start: rider gets "ride started"
    assert client.post(f"{API}/tenants/{tid}/rides/offers/{offer_id}/start", headers=dh).json()["status"] == "started"
    kinds = [n["kind"] for n in client.get(f"{API}/tenants/{tid}/me/notifications", headers=rh).json()["items"]]
    assert "ride_started" in kinds

    done = client.post(f"{API}/tenants/{tid}/rides/offers/{offer_id}/finish", headers=dh, json={"completed": True}).json()
    assert done["status"] == "completed"
    assert client.post(f"{API}/tenants/{tid}/rides/offers/{offer_id}/finish", headers=dh, json={"completed": True}).status_code == 409

    # feedback is due for both, once each
    due = client.get(f"{API}/tenants/{tid}/me/feedback-due", headers=rh).json()
    assert len(due) == 1 and due[0]["about"]["id"] == driver and due[0]["you_were"] == "rider"
    b = due[0]["booking_id"]
    assert client.post(f"{API}/tenants/{tid}/rides/bookings/{b}/feedback", headers=rh,
                       json={"rating": 5, "tags": ["on_time", "friendly"]}).status_code == 201
    assert client.post(f"{API}/tenants/{tid}/rides/bookings/{b}/feedback", headers=rh, json={"rating": 4}).status_code == 409
    assert client.post(f"{API}/tenants/{tid}/rides/bookings/{b}/feedback", headers=dh, json={"rating": 2, "tags": ["late"]}).status_code == 201
    assert client.get(f"{API}/tenants/{tid}/me/feedback-due", headers=rh).json() == []

    # referral: the rider invites a friend who is not yet a member; admin records the join
    ref = client.post(f"{API}/tenants/{tid}/referrals", headers=rh, json={"invitee_id": friend_id})
    assert ref.status_code == 201
    assert client.post(f"{API}/tenants/{tid}/referrals/{ref.json()['id']}/accept", headers=rh).status_code == 403
    assert client.post(f"{API}/tenants/{tid}/referrals/{ref.json()['id']}/accept", headers=admin).json()["status"] == "joined"

    k = client.get(f"{API}/tenants/{tid}/metrics", headers=admin).json()
    assert k["rides_completed"] == 1 and k["registered"] == 3 and k["referral_conversion"] == 1.0
    assert k["ratings_count"] == 2 and k["avg_rating"] == 3.5
    funnel = {f["step"]: f["count"] for f in client.get(f"{API}/tenants/{tid}/metrics/funnel", headers=admin).json()}
    assert funnel["first_ride"] == 2 and funnel["referral"] == 1
    graph = client.get(f"{API}/tenants/{tid}/graph", headers=admin).json()
    assert {e["kind"] for e in graph["edges"]} >= {"co_ride", "referral"}


def test_instant_match_prefers_the_driver_you_asked_for(client, community):
    tid = community["id"]
    near, nh = join(client, community, "Near Driver", 77.559, 484, car=True, seats=1)   # better geometric match
    asked, ah = join(client, community, "Asked Driver", 77.536, 482, car=True, seats=1)
    client.post(f"{API}/tenants/{tid}/rides/offers", headers=nh, json={})
    client.post(f"{API}/tenants/{tid}/rides/offers", headers=ah, json={})
    rider, rh = join(client, community, "Picky Rider", 77.56, 485)
    q = client.post(f"{API}/tenants/{tid}/rides/requests", headers=rh, json={"preferred_driver_id": asked}).json()
    assert q["status"] == "matched", q          # matched instantly, no operator needed
    mine = client.get(f"{API}/tenants/{tid}/rides", headers=rh).json()
    assert mine["offers"][0]["driver_id"] == asked
    # members only see their own rides
    assert all(o["driver_id"] == asked for o in mine["offers"])


def test_unmatched_rider_alerts_the_driver_they_wanted(client, community):
    tid = community["id"]
    d, dh = join(client, community, "Late Driver", 77.537, 480, car=True, seats=2)
    r, rh = join(client, community, "Early Rider", 77.56, 482)
    q = client.post(f"{API}/tenants/{tid}/rides/requests", headers=rh, json={"preferred_driver_id": d}).json()
    assert q["status"] == "open"
    wanted = client.get(f"{API}/tenants/{tid}/me/notifications", headers=dh).json()["items"]
    assert any(n["kind"] == "seat_wanted" and "Early Rider" in n["title"] for n in wanted)
    # the driver offers: the waiting rider is seated at once
    o = client.post(f"{API}/tenants/{tid}/rides/offers", headers=dh, json={}).json()
    assert o["riders"] and o["riders"][0]["rider_id"] == r and o["riders"][0]["rider_name"] == "Early Rider"


def test_members_cannot_act_as_someone_else(client, community):
    tid = community["id"]
    a, ah = join(client, community, "Anna A.", 77.54, 480, car=True, seats=2)
    b, bh = join(client, community, "Ben B.", 77.55, 485)
    assert client.get(f"{API}/tenants/{tid}/members/{a}", headers=bh).status_code == 403
    assert client.get(f"{API}/tenants/{tid}/members/{a}/recommendations", headers=bh).status_code == 403
    assert client.post(f"{API}/tenants/{tid}/rides/offers", headers=bh, json={"member_id": a}).status_code == 403
    assert client.get(f"{API}/tenants/{tid}/members", headers=bh).status_code == 403
    assert client.get(f"{API}/tenants/{tid}/metrics", headers=bh).status_code == 403
    assert client.post(f"{API}/tenants/{tid}/interventions/plan", headers=bh, json={}).status_code == 403
    offer = client.post(f"{API}/tenants/{tid}/rides/offers", headers=ah, json={}).json()
    assert client.post(f"{API}/tenants/{tid}/rides/offers/{offer['id']}/finish", headers=bh, json={"completed": True}).status_code == 403
    # no token at all
    assert client.get(f"{API}/tenants/{tid}/members/{a}").status_code == 401
    assert client.get(f"{API}/tenants/{tid}/metrics", headers=bearer("not-a-real-token")).status_code == 401


def test_cross_tenant_access_is_blocked(client, community):
    other = client.post(f"{API}/tenants", json={"name": "Other", "center_lat": 1, "center_lon": 1,
                                                "destinations": [{"name": "HQ", "lat": 1, "lon": 1}],
                                                "admin": {"name": "Other Admin", "email": "other-admin@example.org", "password": "other-pass-1"}}).json()
    mid, mh = join(client, community, "X Y.", 77.55)
    oh = bearer(other["session"]["token"])
    # the other community's admin can't see this member through either community
    assert client.get(f"{API}/tenants/{other['id']}/members/{mid}", headers=oh).status_code == 404
    assert client.get(f"{API}/tenants/{community['id']}/members/{mid}", headers=oh).status_code == 404
    # and this member can't reach the other community at all
    assert client.get(f"{API}/tenants/{other['id']}/me/notifications", headers=mh).status_code == 404


def test_auth_rules(client, community):
    c = community
    assert client.post(f"{API}/auth/login", json={"email": "admin-nope@example.org", "password": "x"}).status_code == 401
    mid, _ = join(client, c, "Login Person", 77.55)
    me = client.get(f"{API}/auth/me", headers=c["admin_headers"]).json()
    assert me["user"]["role"] == "admin" and me["tenant"]["join_code"] == c["join_code"]
    bad = {"join_code": "NOPE99", "name": "Z", "email": "z@example.org", "password": "short", "home_lat": 1, "home_lon": 1,
           "destination_id": 1, "depart_min": 480}
    assert client.post(f"{API}/auth/register", json=bad).status_code == 422          # short password, short name
    bad.update(name="Zed Z.", password="long-enough-1")
    assert client.post(f"{API}/auth/register", json=bad).status_code == 404          # unknown join code
    # demo sign-in only works for synthetic communities
    assert client.post(f"{API}/auth/demo-login", json={"tenant_id": c["id"], "member_id": mid}).status_code == 404


def test_validation_rejects_bad_input(client, community):
    tid, admin = community["id"], community["admin_headers"]
    assert client.post(f"{API}/tenants", json={"name": "", "center_lat": 200, "center_lon": 0,
                                               "destinations": []}).status_code == 422
    bad = {"name": "A", "home_lat": 12.9, "home_lon": 77.5, "destination_id": 99999, "depart_min": 480}
    assert client.post(f"{API}/tenants/{tid}/members/import", headers=admin, json={"members": [bad]}).status_code == 422
    late = dict(bad, destination_id=community["destinations"][0]["id"], depart_min=5000)
    assert client.post(f"{API}/tenants/{tid}/members/import", headers=admin, json={"members": [late]}).status_code == 422
    assert client.post(f"{API}/tenants/{tid}/interventions/plan", headers=admin, json={"budget": 0}).status_code == 422


def test_simulation_refuses_real_communities(client, community):
    assert client.post(f"{API}/tenants/{community['id']}/simulate", headers=community["admin_headers"],
                       json={"days": 1}).status_code == 409


def test_admin_routes_need_admin(client, monkeypatch):
    from app.config import get_settings
    assert client.post(f"{API}/tenants/demo", json={}).status_code == 401
    monkeypatch.setattr(get_settings(), "admin_key", "s3cret")
    assert client.post(f"{API}/tenants/demo", json={}, headers={"X-Admin-Key": "wrong"}).status_code == 401
