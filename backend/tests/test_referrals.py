"""Referral programme: personal code and link, sign-up through it, email invites credited, points and tiers
for friends who join and ride, the leaderboard, the organiser's view, and the engine's funnel."""
import itertools
from datetime import datetime, timedelta, timezone

from .conftest import API, bearer
from .test_trips import ROUTE, alerts

_n = itertools.count(1)


def signup(client, name, join_code=None, referral_code=None, email=None, status=201):
    i = next(_n)
    r = client.post(f"{API}/auth/signup", json={"name": name, "gender": "female", "email": email or f"ref{i}@example.org",
                                                 "mobile": f"+91 80000 {i:05d}", "password": "ref-pass-123",
                                                 **({"join_code": join_code} if join_code else {}),
                                                 **({"referral_code": referral_code} if referral_code else {})})
    assert r.status_code == status, r.text
    if status != 201:
        return None
    s = r.json()
    return s["user"]["id"], bearer(s["token"]), s


def ride_together(client, dh, rh):
    """A completed shared ride: driver posts, rider asks, driver approves, boards them and ends it."""
    when = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
    tid = client.post(f"{API}/trips", headers=dh, json={
        "from_name": "Lakeview", "from_lat": 12.97, "from_lon": 77.55, "to_name": "Campus", "to_lat": 12.97, "to_lon": 77.65,
        "depart_at": when, "route": ROUTE, "route_km": 11.2, "route_min": 25, "seats": 2, "licence_confirmed": True, "cost_share_confirmed": True}).json()["id"]
    client.post(f"{API}/trips/{tid}/request", headers=rh, json={})
    seat = client.get(f"{API}/trips/{tid}", headers=dh).json()["riders"][0]["seat_id"]
    client.post(f"{API}/trips/{tid}/seats/{seat}/approve", headers=dh)
    client.post(f"{API}/trips/{tid}/seats/{seat}/board", headers=dh)
    assert client.post(f"{API}/trips/{tid}/end", headers=dh).status_code == 200


def test_referral_link_signup_points_tiers_and_organiser_view(client, community):
    a, ah, _ = signup(client, "Ananya Rao", join_code=community["join_code"])
    mine = client.get(f"{API}/me/referrals", headers=ah).json()
    code = mine["code"]
    assert code.startswith("ANANYA") and mine["link_path"] == f"/signup?ref={code}"
    assert mine["joined"] == 0 and mine["points"] == 0 and mine["tier"]["name"] == "Starter"
    assert client.get(f"{API}/me/referrals", headers=ah).json()["code"] == code   # stable

    # the public lookup shows only a first name and the community
    look = client.get(f"{API}/referral/{code.lower()}").json()
    assert look == {"code": code, "referrer": "Ananya", "community": community["name"]}
    assert client.get(f"{API}/referral/NOPE1234").status_code == 404
    signup(client, "Wrong Code", referral_code="NOPE1234", status=404)

    # signing up through the link (no join code) lands in the friend's community and credits them
    b, bh, bs = signup(client, "Bhavna K.", referral_code=code)
    assert bs["tenant"]["id"] == community["id"]
    mine = client.get(f"{API}/me/referrals", headers=ah).json()
    assert mine["joined"] == 1 and mine["points"] == 10 and mine["friends"][0] == {**mine["friends"][0], "name": "Bhavna", "stage": "joined", "source": "link"}
    assert any(x["kind"] == "referral_joined" for x in alerts(client, ah))

    # the engine counts it: Ananya is now a referrer in the funnel ("Brought someone in")
    a_member = client.get(f"{API}/auth/me", headers=ah).json()["user"]["member_id"]
    m = client.get(f"{API}/tenants/{community['id']}/members/{a_member}", headers=community["admin_headers"]).json()
    assert m["funnel"]["referrer_day"] is not None

    # the friend's first shared ride: +40 points and the Bronze tier
    ride_together(client, ah, bh)
    mine = client.get(f"{API}/me/referrals", headers=ah).json()
    assert mine["rode"] == 1 and mine["points"] == 50 and mine["tier"]["name"] == "Bronze" and mine["tier"]["next"] == "Silver"
    assert mine["friends"][0]["stage"] == "rode"
    assert mine["leaderboard"][0] == {"user_id": a, "name": "Ananya", "joined": 1}

    # the organiser sees it; members don't
    rep = client.get(f"{API}/tenants/{community['id']}/referrals", headers=community["admin_headers"]).json()
    assert rep["joined"] == 1 and rep["rode"] == 1 and rep["by_link"] == 1 and rep["top"][0]["name"] == "Ananya"
    assert client.get(f"{API}/tenants/{community['id']}/referrals", headers=ah).status_code == 403


def test_email_invite_is_credited_and_codes_stay_in_their_community(client, community):
    a, ah, _ = signup(client, "Esha Invites", join_code=community["join_code"])
    # an email invite needs a member record first: Esha has one (she joined with the code)
    client.post(f"{API}/me/invites", headers=ah, json={"name": "Farah", "email": "farah.invited@example.org"})
    signup(client, "Farah M.", join_code=community["join_code"], email="farah.invited@example.org")
    friends = client.get(f"{API}/me/referrals", headers=ah).json()["friends"]
    assert [(f["name"], f["source"]) for f in friends] == [("Farah", "invite")]

    # someone who joins a different community with an explicit join code isn't credited across communities
    code = client.get(f"{API}/me/referrals", headers=ah).json()["code"]
    i = next(_n)
    r = client.post(f"{API}/tenants", json={
        "name": f"Other College {i}", "kind": "university", "center_lat": 12.9, "center_lon": 77.5,
        "destinations": [{"name": "Gate", "lat": 12.9, "lon": 77.5}],
        "admin": {"name": "Other Admin", "email": f"other-admin{i}@example.org", "password": "admin-pass-123"}})
    assert r.status_code == 201, r.text
    other = r.json()
    signup(client, "Gita Elsewhere", join_code=other["join_code"], referral_code=code)
    assert len(client.get(f"{API}/me/referrals", headers=ah).json()["friends"]) == 1


def test_deleted_member_code_stops_working(client, community):
    a, ah, _ = signup(client, "Hari Leaves", join_code=community["join_code"])
    code = client.get(f"{API}/me/referrals", headers=ah).json()["code"]
    assert client.post(f"{API}/me/delete", headers=ah, json={"password": "ref-pass-123"}).status_code == 200
    assert client.get(f"{API}/referral/{code}").status_code == 404
