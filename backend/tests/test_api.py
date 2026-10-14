"""API flow tests: the full Discover -> Match -> Nudge -> Ride -> Refer loop on a real (non-synthetic) community."""
API = "/api/v1"


def _import(client, tid, dest_id, members):
    r = client.post(f"{API}/tenants/{tid}/members/import", json={"members": members})
    assert r.status_code == 201, r.text
    return r.json()["member_ids"]


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_full_activation_loop(client, community):
    tid, campus = community["id"], community["destinations"][0]["id"]
    driver, rider, friend = _import(client, tid, campus, [
        {"name": "Asha D.", "home_lat": 12.97, "home_lon": 77.535, "destination_id": campus, "depart_min": 480,
         "has_car": True, "seats": 3},
        {"name": "Rohan R.", "home_lat": 12.97, "home_lon": 77.56, "destination_id": campus, "depart_min": 485},
        {"name": "Tara F.", "home_lat": 12.971, "home_lon": 77.561, "destination_id": campus, "depart_min": 490},
    ])
    for m in (driver, rider):
        assert client.post(f"{API}/tenants/{tid}/members/{m}/register").json()["state"] == "registered"

    # recommendations without searching
    recs = client.get(f"{API}/tenants/{tid}/members/{rider}/recommendations").json()
    assert recs["looking_for"] == "drivers" and recs["partners"][0]["member"]["id"] == driver
    assert "email" not in recs["partners"][0]["member"]

    # profile has scores and features
    prof = client.get(f"{API}/tenants/{tid}/members/{driver}").json()
    assert set(prof["scores"]) == {"driver", "rider", "connector", "referrer"}

    # nudges -> responses create an offer and a request
    plan = client.post(f"{API}/tenants/{tid}/interventions/plan", json={"budget": 5}).json()
    by_member = {i["member_id"]: i for i in plan["interventions"]}
    assert driver in by_member and rider in by_member
    assert "Rohan" in by_member[driver]["message"] or "1 people" in by_member[driver]["message"]
    assert client.post(f"{API}/tenants/{tid}/interventions/{by_member[driver]['id']}/respond",
                       json={"responded": True}).json()["offer_id"]
    assert client.post(f"{API}/tenants/{tid}/interventions/{by_member[rider]['id']}/respond",
                       json={"responded": True}).json()["request_id"]

    # match + complete
    m = client.post(f"{API}/tenants/{tid}/rides/match").json()
    assert m["matched"] == 1
    offer_id = m["bookings"][0]["offer_id"]
    done = client.post(f"{API}/tenants/{tid}/rides/offers/{offer_id}/finish", json={"completed": True}).json()
    assert done["status"] == "completed"
    assert client.post(f"{API}/tenants/{tid}/rides/offers/{offer_id}/finish", json={"completed": True}).status_code == 409

    # referral: rider invites a friend who is not yet a member
    ref = client.post(f"{API}/tenants/{tid}/referrals", json={"inviter_id": rider, "invitee_id": friend})
    assert ref.status_code == 201
    assert client.post(f"{API}/tenants/{tid}/referrals/{ref.json()['id']}/accept").json()["status"] == "joined"

    k = client.get(f"{API}/tenants/{tid}/metrics").json()
    assert k["rides_completed"] == 1 and k["registered"] == 3 and k["referral_conversion"] == 1.0
    funnel = {f["step"]: f["count"] for f in client.get(f"{API}/tenants/{tid}/metrics/funnel").json()}
    assert funnel["first_ride"] == 2 and funnel["referral"] == 1
    graph = client.get(f"{API}/tenants/{tid}/graph").json()
    assert {e["kind"] for e in graph["edges"]} >= {"co_ride", "referral"}


def test_cross_tenant_access_is_blocked(client, community):
    other = client.post(f"{API}/tenants", json={"name": "Other", "center_lat": 1, "center_lon": 1,
                                                "destinations": [{"name": "HQ", "lat": 1, "lon": 1}]}).json()
    mid = _import(client, community["id"], community["destinations"][0]["id"], [
        {"name": "X Y.", "home_lat": 12.97, "home_lon": 77.55, "destination_id": community["destinations"][0]["id"],
         "depart_min": 480}])[0]
    assert client.get(f"{API}/tenants/{other['id']}/members/{mid}").status_code == 404


def test_validation_rejects_bad_input(client, community):
    tid = community["id"]
    assert client.post(f"{API}/tenants", json={"name": "", "center_lat": 200, "center_lon": 0,
                                               "destinations": []}).status_code == 422
    bad = {"name": "A", "home_lat": 12.9, "home_lon": 77.5, "destination_id": 99999, "depart_min": 480}
    assert client.post(f"{API}/tenants/{tid}/members/import", json={"members": [bad]}).status_code == 422
    late = dict(bad, destination_id=community["destinations"][0]["id"], depart_min=5000)
    assert client.post(f"{API}/tenants/{tid}/members/import", json={"members": [late]}).status_code == 422
    assert client.post(f"{API}/tenants/{tid}/interventions/plan", json={"budget": 0}).status_code == 422


def test_simulation_refuses_real_communities(client, community):
    assert client.post(f"{API}/tenants/{community['id']}/simulate", json={"days": 1}).status_code == 409


def test_admin_key_guards_demo_endpoints(client, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "admin_key", "s3cret")
    assert client.post(f"{API}/tenants/demo", json={}).status_code == 401
    assert client.post(f"{API}/tenants/demo", json={}, headers={"X-Admin-Key": "wrong"}).status_code == 401
