"""Member app flow: sign up (no community needed), post a ride, nearby alerts, request, approve, code, board,
chat, driver updates, end (rider and driver), ratings with recency, early-leave penalty, reports, access rules."""
import itertools
from datetime import datetime, timedelta, timezone

from .conftest import API, bearer

_n = itertools.count(1)
# a straight road heading east from (12.97, 77.55) to (12.97, 77.65)
ROUTE = [[12.97, 77.55 + i * 0.01] for i in range(11)]


def signup(client, name, gender="female", join_code=None):
    i = next(_n)
    r = client.post(f"{API}/auth/signup", json={"name": name, "gender": gender, "email": f"trip{i}@example.org",
                                                 "mobile": f"+91 90000 {i:05d}", "password": "trip-pass-123",
                                                 **({"join_code": join_code} if join_code else {})})
    assert r.status_code == 201, r.text
    s = r.json()
    return s["user"]["id"], bearer(s["token"]), s


def post_trip(client, h, minutes=30, seats=2):
    when = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()
    r = client.post(f"{API}/trips", headers=h, json={
        "from_name": "Lakeview", "from_lat": 12.97, "from_lon": 77.55, "to_name": "Tech Park", "to_lat": 12.97, "to_lon": 77.65,
        "depart_at": when, "route": ROUTE, "route_km": 11.2, "route_min": 25, "seats": seats, "licence_confirmed": True, "cost_share_confirmed": True})
    assert r.status_code == 201, r.text
    return r.json()


def alerts(client, h):
    return client.get(f"{API}/me/alerts", headers=h).json()["items"]


def test_signup_without_code_and_login_by_mobile(client):
    uid, h, s = signup(client, "Meera S.")
    assert s["profile"]["gender"] == "female" and s["tenant"]["name"].startswith("FellaRide")
    r = client.post(f"{API}/auth/login", json={"email": s["profile"]["mobile"], "password": "trip-pass-123"})
    assert r.status_code == 200 and r.json()["user"]["id"] == uid
    dup = client.post(f"{API}/auth/signup", json={"name": "X Y", "gender": "male", "email": "other@example.org",
                                                  "mobile": s["profile"]["mobile"], "password": "trip-pass-123"})
    assert dup.status_code == 409
    bad = client.post(f"{API}/auth/signup", json={"name": "X Y", "gender": "male", "email": "o2@example.org",
                                                  "mobile": "+91 91234 56789", "password": "trip-pass-123", "join_code": "NOPE99"})
    assert bad.status_code == 404


def test_profile_update_valid_and_invalid_input(client):
    _, h, _ = signup(client, "Ravi K.", gender="male")
    _, _, os_ = signup(client, "Asha P.")
    put = lambda body, hh=h: client.put(f"{API}/me/profile", headers=hh, json=body)

    # a valid update is saved, trimmed and normalised
    ok = put({"name": "  Ravi Kumar ", "gender": "male", "mobile": "98765 43210"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["name"] == "Ravi Kumar" and ok.json()["mobile"] == "+919876543210"

    # bad input is a 422 with a sentence a person can act on, never our regex or their input echoed back
    cases = {
        "blank name": ({"name": "   ", "gender": "male", "mobile": "98765 43210"}, "name", "at least 2"),
        "1-letter name after trimming": ({"name": " A ", "gender": "male", "mobile": "98765 43210"}, "name", "at least 2"),
        "markup in name": ({"name": "Ravi/<b>", "gender": "male", "mobile": "98765 43210"}, "name", "letters and spaces"),
        "brackets in mobile": ({"name": "Ravi", "gender": "male", "mobile": "(987) 654-3210"}, "mobile", "valid mobile"),
        "unknown gender": ({"name": "Ravi", "gender": "robot", "mobile": "98765 43210"}, "gender", "one of the options"),
    }
    for label, (body, field, words) in cases.items():
        r = put(body)
        assert r.status_code == 422, label
        [err] = r.json()["detail"]
        assert err["loc"][-1] == field and words in err["msg"], (label, err)
        assert "input" not in err and "pattern" not in err["msg"], (label, err)
    assert put({"name": "Ravi", "gender": "male", "mobile": "+91 12345 67890"}).json()["detail"].startswith("Enter a valid mobile")
    assert put({"name": "Ravi", "gender": "male"}).status_code == 422

    # someone else's number is refused, and nothing above changed the saved profile
    assert put({"name": "Ravi", "gender": "male", "mobile": os_["profile"]["mobile"]}).status_code == 409
    me = client.get(f"{API}/auth/me", headers=h).json()
    assert me["profile"]["name"] == "Ravi Kumar" and me["profile"]["mobile"] == "+919876543210"

    # no token, no update
    assert client.put(f"{API}/me/profile", json={"name": "Ravi", "gender": "male", "mobile": "98765 43210"}).status_code == 401


def test_full_trip(client):
    d, dh, _ = signup(client, "Asha D.")
    r1, h1, _ = signup(client, "Rohan R.", "male")
    r2, h2, _ = signup(client, "Tara F.")
    far, hf, _ = signup(client, "Faraway P.", "other")
    # where people are: two on the route, one far away
    client.post(f"{API}/me/location", headers=h1, json={"lat": 12.972, "lon": 77.58})
    client.post(f"{API}/me/location", headers=hf, json={"lat": 13.2, "lon": 77.9})

    trip = post_trip(client, dh)
    tid = trip["id"]
    assert trip["you"] == "driver" and len(trip["code"]) == 4 and trip["seats_left"] == 2 and trip["notified"] >= 1
    assert any(a["kind"] == "trip_nearby" and a["trip_id"] == tid for a in alerts(client, h1))
    assert not any(a["kind"] == "trip_nearby" for a in alerts(client, hf))

    # search: pickup and drop must both be near the route, in that order
    found = client.get(f"{API}/trips/search", headers=h1, params={"from_lat": 12.971, "from_lon": 77.57, "to_lat": 12.97, "to_lon": 77.64}).json()
    assert [t["id"] for t in found] == [tid] and found[0]["code"] is None and "mobile" not in found[0]["driver"]
    assert client.get(f"{API}/trips/search", headers=h1, params={"from_lat": 12.97, "from_lon": 77.64, "to_lat": 12.97, "to_lon": 77.56}).json() == []
    assert client.get(f"{API}/trips/search", headers=hf, params={"from_lat": 13.2, "from_lon": 77.9}).json() == []

    # requests -> driver sees name, gender, rating; approve one
    t = client.post(f"{API}/trips/{tid}/request", headers=h1, json={"pickup_name": "Lake Rd", "pickup_lat": 12.971, "pickup_lon": 77.57}).json()
    assert t["my_seat"]["status"] == "pending" and t["code"] is None
    client.post(f"{API}/trips/{tid}/request", headers=h2, json={})
    assert any(a["kind"] == "seat_request" for a in alerts(client, dh))
    seen = client.get(f"{API}/trips/{tid}", headers=dh).json()["riders"]
    assert {r["person"]["gender"] for r in seen} == {"male", "female"} and all("mobile" not in r["person"] for r in seen)
    seat1 = next(r["seat_id"] for r in seen if r["person"]["id"] == r1)
    seat2 = next(r["seat_id"] for r in seen if r["person"]["id"] == r2)
    assert client.post(f"{API}/trips/{tid}/seats/{seat1}/approve", headers=h1).status_code == 403   # riders can't approve
    client.post(f"{API}/trips/{tid}/seats/{seat1}/approve", headers=dh)
    client.post(f"{API}/trips/{tid}/seats/{seat2}/approve", headers=dh)

    # approved: same code for everyone, driver's mobile visible to riders and riders' to the driver
    v1 = client.get(f"{API}/trips/{tid}", headers=h1).json()
    v2 = client.get(f"{API}/trips/{tid}", headers=h2).json()
    assert v1["code"] == v2["code"] == trip["code"] and v1["driver"]["mobile"]
    assert all(r["person"].get("mobile") for r in client.get(f"{API}/trips/{tid}", headers=dh).json()["riders"])
    assert client.get(f"{API}/trips/{tid}", headers=hf).json()["code"] is None

    # chat and driver updates
    assert client.get(f"{API}/trips/{tid}/messages", headers=hf).status_code == 403
    client.post(f"{API}/trips/{tid}/messages", headers=h1, json={"body": "I'm at the bus stop"})
    client.post(f"{API}/trips/{tid}/messages", headers=h1, json={"body": "blue shirt"})
    assert [m["body"] for m in client.get(f"{API}/trips/{tid}/messages", headers=dh).json()] == ["I'm at the bus stop", "blue shirt"]
    assert sum(a["kind"] == "message" for a in alerts(client, dh)) == 1   # one rolling alert, not one per message
    assert client.post(f"{API}/trips/{tid}/notify", headers=h1, json={"body": "hi"}).status_code == 403
    client.post(f"{API}/trips/{tid}/notify", headers=dh, json={"body": "Running 5 min late"})
    assert any(a["kind"] == "driver_update" for a in alerts(client, h2))

    # boarding: driver marks who got in; a rider can't end before getting in
    assert client.post(f"{API}/trips/{tid}/end", headers=h1).status_code == 409
    client.post(f"{API}/trips/{tid}/seats/{seat1}/board", headers=dh)
    client.post(f"{API}/trips/{tid}/seats/{seat2}/board", headers=dh)
    client.post(f"{API}/trips/{tid}/start", headers=dh)

    # rider 1 gets off: the trip goes on; rider 2 is the last one, so the trip ends
    assert client.post(f"{API}/trips/{tid}/end", headers=h1).json()["status"] == "started"
    done = client.post(f"{API}/trips/{tid}/end", headers=h2).json()
    assert done["status"] == "completed"

    # ratings: everyone rates everyone they travelled with, once
    to_rate = client.get(f"{API}/trips/{tid}", headers=h1).json()["to_rate"]
    assert {p["id"] for p in to_rate} == {d, r2}
    assert client.post(f"{API}/trips/{tid}/ratings", headers=h1, json={"to_id": d, "stars": 5}).status_code == 201
    assert client.post(f"{API}/trips/{tid}/ratings", headers=h1, json={"to_id": d, "stars": 5}).status_code == 409
    assert client.post(f"{API}/trips/{tid}/ratings", headers=hf, json={"to_id": d, "stars": 1}).status_code == 403
    client.post(f"{API}/trips/{tid}/ratings", headers=dh, json={"to_id": r1, "stars": 4})

    # reports: multiple-choice, categorised by the most serious reason; outsiders can't report
    rep = client.post(f"{API}/reports", headers=h2, json={"trip_id": tid, "reported_id": d, "reasons": ["late", "harassment"]})
    assert rep.status_code == 201 and rep.json()["category"] == "safety" and rep.json()["severity"] == "high"
    assert client.post(f"{API}/reports", headers=hf, json={"trip_id": tid, "reported_id": d, "reasons": ["rude"]}).status_code == 403
    assert client.post(f"{API}/reports", headers=h2, json={"trip_id": tid, "reported_id": d, "reasons": ["made_up"]}).status_code == 422


def test_driver_leaving_early_is_penalised_and_recent_ratings_count_more(client):
    d, dh, _ = signup(client, "Kabir L.", "male")
    r, rh, _ = signup(client, "Nina W.")
    trip = post_trip(client, dh, minutes=60)
    client.post(f"{API}/trips/{trip['id']}/request", headers=rh, json={})
    seat = client.get(f"{API}/trips/{trip['id']}", headers=dh).json()["riders"][0]["seat_id"]
    client.post(f"{API}/trips/{trip['id']}/seats/{seat}/approve", headers=dh)
    # sets off 60 minutes early and ends the ride without the approved rider
    client.post(f"{API}/trips/{trip['id']}/start", headers=dh)
    out = client.post(f"{API}/trips/{trip['id']}/end", headers=dh).json()
    assert out["status"] == "completed"
    assert client.get(f"{API}/trips/{trip['id']}", headers=rh).json()["my_seat"]["status"] == "missed"
    assert any(a["kind"] == "missed" for a in alerts(client, rh))
    me = client.get(f"{API}/auth/me", headers=dh).json()["profile"]
    assert me["rating"] == {"average": 1.0, "count": 1}

    # a later 5-star ride outweighs the older 1 star
    r2, rh2, _ = signup(client, "Omar Q.", "male")
    t2 = post_trip(client, dh, minutes=0)
    client.post(f"{API}/trips/{t2['id']}/request", headers=rh2, json={})
    s2 = client.get(f"{API}/trips/{t2['id']}", headers=dh).json()["riders"][0]["seat_id"]
    client.post(f"{API}/trips/{t2['id']}/seats/{s2}/approve", headers=dh)
    client.post(f"{API}/trips/{t2['id']}/seats/{s2}/board", headers=dh)
    client.post(f"{API}/trips/{t2['id']}/end", headers=dh)
    client.post(f"{API}/trips/{t2['id']}/ratings", headers=rh2, json={"to_id": d, "stars": 5})
    rating = client.get(f"{API}/auth/me", headers=dh).json()["profile"]["rating"]
    assert rating["count"] == 2 and rating["average"] > 3.0   # plain average would be 3.0


def test_full_car_cancel_and_isolation(client, community):
    d, dh, _ = signup(client, "Ira N.")
    r1, h1, _ = signup(client, "Dev K.", "male")
    r2, h2, _ = signup(client, "Lia M.")
    trip = post_trip(client, dh, seats=1)
    for h in (h1, h2):
        client.post(f"{API}/trips/{trip['id']}/request", headers=h, json={})
    rows = client.get(f"{API}/trips/{trip['id']}", headers=dh).json()["riders"]
    client.post(f"{API}/trips/{trip['id']}/seats/{rows[0]['seat_id']}/approve", headers=dh)
    # the car is full: the other request is declined automatically, and a second post is blocked
    assert client.get(f"{API}/trips/{trip['id']}", headers=h2).json()["my_seat"]["status"] == "rejected"
    again = {"from_name": "A", "from_lat": 12.97, "from_lon": 77.55, "to_name": "B", "to_lat": 12.97, "to_lon": 77.65,
             "depart_at": datetime.now(timezone.utc).isoformat(), "route": ROUTE, "route_km": 11, "route_min": 25, "seats": 1, "licence_confirmed": True, "cost_share_confirmed": True}
    assert client.post(f"{API}/trips", headers=dh, json=again).status_code == 409
    # cancelling after approving someone costs the driver
    assert client.post(f"{API}/trips/{trip['id']}/cancel", headers=dh).json()["status"] == "cancelled"
    assert client.get(f"{API}/auth/me", headers=dh).json()["profile"]["rating"]["average"] == 2.0

    # a member of another community can't see or book this ride; organisers can't ride
    _, other, _ = signup(client, "Out Sider", join_code=community["join_code"])
    assert client.get(f"{API}/trips/{trip['id']}", headers=other).status_code == 404
    assert client.get(f"{API}/me/trips", headers=community["admin_headers"]).status_code == 403


def test_organiser_broadcast_and_overview(client, community):
    tid, admin = community["id"], community["admin_headers"]
    _, h, _ = signup(client, "Zara B.", join_code=community["join_code"])
    assert client.post(f"{API}/tenants/{tid}/broadcast", headers=admin, json={"title": "Roads closed Friday"}).json()["sent"] >= 1
    assert any(a["kind"] == "broadcast" for a in alerts(client, h))
    assert client.post(f"{API}/tenants/{tid}/broadcast", headers=h, json={"title": "spam"}).status_code == 403
    ov = client.get(f"{API}/tenants/{tid}/trips-overview", headers=admin).json()
    assert {"trips", "riders_carried", "reports", "open_reports_by_category"} <= set(ov)


def test_a_ride_must_go_somewhere(client):
    _, dh, _ = signup(client, "Zara Z.")
    when = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
    base = {"from_name": "Lakeview", "from_lat": 12.97, "from_lon": 77.55, "depart_at": when, "route_min": 25,
            "seats": 2, "licence_confirmed": True, "cost_share_confirmed": True}
    # same start and destination: a 0 km route
    same = client.post(f"{API}/trips", headers=dh, json={**base, "to_name": "Lakeview", "to_lat": 12.97, "to_lon": 77.55,
                                                          "route": [[12.97, 77.55], [12.97, 77.55]], "route_km": 0, "route_min": 0})
    assert same.status_code == 422 and "same place" in same.json()["detail"]
    # different places, but a route claimed shorter than the straight line between them (~10.8 km)
    short = client.post(f"{API}/trips", headers=dh, json={**base, "to_name": "Tech Park", "to_lat": 12.97, "to_lon": 77.65,
                                                           "route": ROUTE, "route_km": 0})
    assert short.status_code == 422
    real = post_trip(client, dh)   # neither left a ride behind, so a real one can still be posted
    client.post(f"{API}/trips/{real['id']}/cancel", headers=dh)   # keep it out of later tests' searches


def test_car_details_model_first_plate_after_approval(client):
    d, dh, _ = signup(client, "Kabir C.", "male")
    r1, h1, _ = signup(client, "Nisha C.")
    when = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
    bad = client.post(f"{API}/trips", headers=dh, json={
        "from_name": "Lakeview", "from_lat": 12.97, "from_lon": 77.55, "to_name": "Tech Park", "to_lat": 12.97, "to_lon": 77.65,
        "depart_at": when, "route": ROUTE, "route_km": 11.2, "route_min": 25, "seats": 2, "licence_confirmed": True, "cost_share_confirmed": True,
        "car": {"model": "Maruti Swift", "colour": "White", "plate": "<script>"}})
    assert bad.status_code == 422
    no_licence = client.post(f"{API}/trips", headers=dh, json={
        "from_name": "Lakeview", "from_lat": 12.97, "from_lon": 77.55, "to_name": "Tech Park", "to_lat": 12.97, "to_lon": 77.65,
        "depart_at": when, "route": ROUTE, "route_km": 11.2, "route_min": 25, "seats": 2,
        "car": {"model": "Maruti Swift", "colour": "White", "plate": "KA 01 AB 1234"}})
    assert no_licence.status_code == 422 and "driving licence" in no_licence.json()["detail"]
    r = client.post(f"{API}/trips", headers=dh, json={
        "from_name": "Lakeview", "from_lat": 12.97, "from_lon": 77.55, "to_name": "Tech Park", "to_lat": 12.97, "to_lon": 77.65,
        "depart_at": when, "route": ROUTE, "route_km": 11.2, "route_min": 25, "seats": 2, "licence_confirmed": True, "cost_share_confirmed": True,
        "car": {"model": "Maruti Swift", "colour": "White", "plate": "ka-01-ab-1234"}})
    assert r.status_code == 201, r.text
    trip = r.json()
    tid = trip["id"]
    assert trip["car"] == {"model": "Maruti Swift", "colour": "White", "plate": "KA 01 AB 1234"}   # the driver sees it all

    # before approval: model and colour, no number plate
    found = client.get(f"{API}/trips/search", headers=h1, params={"from_lat": 12.971, "from_lon": 77.57}).json()
    assert found[0]["car"] == {"model": "Maruti Swift", "colour": "White", "plate": None}
    client.post(f"{API}/trips/{tid}/request", headers=h1, json={})
    assert client.get(f"{API}/trips/{tid}", headers=h1).json()["car"]["plate"] is None

    # approved: the plate shows, and the approval alert says which car to look for
    seat = client.get(f"{API}/trips/{tid}", headers=dh).json()["riders"][0]["seat_id"]
    client.post(f"{API}/trips/{tid}/seats/{seat}/approve", headers=dh)
    assert client.get(f"{API}/trips/{tid}", headers=h1).json()["car"]["plate"] == "KA 01 AB 1234"
    approved = next(a for a in alerts(client, h1) if a["kind"] == "approved")
    assert "White Maruti Swift (KA 01 AB 1234)" in approved["body"]

    # the car is remembered for the driver's next sign-in
    me = client.post(f"{API}/auth/login", json={"email": client.get(f"{API}/auth/me", headers=dh).json()["user"]["email"],
                                                "password": "trip-pass-123"}).json()
    assert me["profile"]["car"]["plate"] == "KA 01 AB 1234"


def test_one_rider_books_several_seats(client):
    d, dh, _ = signup(client, "Kiran D.")
    a, ha, _ = signup(client, "Group A.")
    b, hb, _ = signup(client, "Solo B.")
    c, hc, _ = signup(client, "Pair C.")
    tid = post_trip(client, dh, seats=3)["id"]
    req = lambda h, n: client.post(f"{API}/trips/{tid}/request", headers=h, json={"seats": n})

    assert req(ha, 4).status_code == 422                       # more than the car holds
    t = req(ha, 1).json()
    assert t["my_seat"]["seats"] == 1
    t = req(ha, 2).json()                                      # changing a waiting request
    assert t["my_seat"]["seats"] == 2 and t["seats_left"] == 3  # nothing is held until the driver approves
    assert any("now needs 2 seats" in x["title"] for x in alerts(client, dh))
    req(hb, 1)
    req(hc, 2)
    riders = {r["person"]["id"]: r for r in client.get(f"{API}/trips/{tid}", headers=dh).json()["riders"]}
    assert riders[a]["seats"] == 2 and riders[b]["seats"] == 1 and riders[c]["seats"] == 2

    # approving the pair leaves 1 seat: the other pair no longer fits and is declined, the solo rider still fits
    t = client.post(f"{API}/trips/{tid}/seats/{riders[a]['seat_id']}/approve", headers=dh).json()
    assert t["seats_left"] == 1
    status = {r["person"]["id"]: r["status"] for r in t["riders"]}
    assert status[a] == "approved" and status[b] == "pending" and status[c] == "rejected"
    assert any(x["kind"] == "declined" and "Only 1 seat left" in x["title"] for x in alerts(client, hc))
    assert any("2 seats held for you" in x["body"] for x in alerts(client, ha))

    # a new request bigger than what's left is refused up front
    e, he, _ = signup(client, "Late E.")
    r = req(he, 2)
    assert r.status_code == 409 and "Only 1 seat left" in r.json()["detail"]

    # withdrawing the pair frees both seats
    client.post(f"{API}/trips/{tid}/withdraw", headers=ha)
    assert client.get(f"{API}/trips/{tid}", headers=dh).json()["seats_left"] == 3
    client.post(f"{API}/trips/{tid}/cancel", headers=dh)


def _approved_pair(client, minutes):
    d, dh, _ = signup(client, "Cut D.")
    r, rh, _ = signup(client, "Cut R.")
    tid = post_trip(client, dh, minutes=minutes)["id"]
    client.post(f"{API}/trips/{tid}/request", headers=rh, json={"pickup_name": "Lake Rd", "pickup_lat": 12.97, "pickup_lon": 77.60})
    seat = client.get(f"{API}/trips/{tid}", headers=dh).json()["riders"][0]["seat_id"]
    client.post(f"{API}/trips/{tid}/seats/{seat}/approve", headers=dh)
    return tid, dh, rh


def test_cancelling_closes_ten_minutes_before_departure(client):
    # well before: both sides may still back out
    tid, dh, rh = _approved_pair(client, minutes=40)
    t = client.get(f"{API}/trips/{tid}", headers=rh).json()
    assert t["can_cancel"] is True and t["cancel_until"]
    assert client.post(f"{API}/trips/{tid}/withdraw", headers=rh).status_code == 200
    assert any("cancelled their 1 seat" in a["body"] for a in alerts(client, dh))
    client.post(f"{API}/trips/{tid}/cancel", headers=dh)

    # 8 minutes before: a confirmed seat can no longer be cancelled by either side
    tid, dh, rh = _approved_pair(client, minutes=8)
    assert client.get(f"{API}/trips/{tid}", headers=rh).json()["can_cancel"] is False
    assert client.get(f"{API}/trips/{tid}", headers=dh).json()["can_cancel"] is False
    r = client.post(f"{API}/trips/{tid}/withdraw", headers=rh)
    assert r.status_code == 409 and "10 minutes before" in r.json()["detail"]
    r = client.post(f"{API}/trips/{tid}/cancel", headers=dh)
    assert r.status_code == 409 and "10 minutes before" in r.json()["detail"]
    # ...but a request nobody approved yet can always be withdrawn
    _, ph, _ = signup(client, "Late P.")
    client.post(f"{API}/trips/{tid}/request", headers=ph, json={})
    assert client.get(f"{API}/trips/{tid}", headers=ph).json()["can_cancel"] is True
    assert client.post(f"{API}/trips/{tid}/withdraw", headers=ph).status_code == 200
    client.post(f"{API}/trips/{tid}/start", headers=dh)
    client.post(f"{API}/trips/{tid}/end", headers=dh)


def test_live_tracking_during_the_ride(client):
    tid, dh, rh = _approved_pair(client, minutes=20)          # inside the 30-minute window
    _, oh, _ = signup(client, "Outsider O.")
    assert client.post(f"{API}/trips/{tid}/location", headers=oh, json={"lat": 12.97, "lon": 77.56}).status_code == 403

    # the driver shares; the waiting rider sees the car, how far it is from their pickup, and roughly when
    assert client.post(f"{API}/trips/{tid}/location", headers=dh, json={"lat": 12.97, "lon": 77.56, "speed_kmh": 30}).status_code == 200
    t = client.get(f"{API}/trips/{tid}", headers=rh).json()
    assert t["tracking"] is True
    car = next(x for x in t["live"] if x["role"] == "driver")
    assert 4 < car["km_to_you"] < 5 and car["eta_min"] >= 1
    # the rider shares too; the driver sees them, an outsider sees nothing
    client.post(f"{API}/trips/{tid}/location", headers=rh, json={"lat": 12.97, "lon": 77.60})
    assert [x["role"] for x in client.get(f"{API}/trips/{tid}", headers=dh).json()["live"]] == ["rider"]

    # positions are deleted when the ride ends
    client.post(f"{API}/trips/{tid}/start", headers=dh)
    client.post(f"{API}/trips/{tid}/end", headers=dh)
    assert client.get(f"{API}/trips/{tid}", headers=rh).json()["live"] == []
    assert client.post(f"{API}/trips/{tid}/location", headers=dh, json={"lat": 12.97, "lon": 77.6}).status_code == 409

    # too early: tracking starts 30 minutes before departure
    tid2, dh2, _ = _approved_pair(client, minutes=90)
    assert client.post(f"{API}/trips/{tid2}/location", headers=dh2, json={"lat": 12.97, "lon": 77.56}).status_code == 409
    client.post(f"{API}/trips/{tid2}/cancel", headers=dh2)


def test_cost_sharing_contribution_cap_and_settling_up(client):
    from app.engine import pricing
    d, dh, _ = signup(client, "Price D.")
    r, rh, _ = signup(client, "Price R.")
    when = (datetime.now(timezone.utc) + timedelta(minutes=45)).isoformat()
    base = {"from_name": "Lakeview", "from_lat": 12.97, "from_lon": 77.55, "to_name": "Tech Park", "to_lat": 12.97, "to_lon": 77.65,
            "depart_at": when, "route": ROUTE, "route_km": 11.2, "route_min": 25, "seats": 2, "licence_confirmed": True}

    # the cost-sharing promise is required, and the rate can't go above the trip's cost
    assert client.post(f"{API}/trips", headers=dh, json=base).status_code == 422
    over = client.post(f"{API}/trips", headers=dh, json={**base, "cost_share_confirmed": True, "price_per_km": 5})
    assert over.status_code == 422 and "cost-sharing only" in over.json()["detail"]   # cap with 2 seats: Rs 4.5/km

    t = client.post(f"{API}/trips", headers=dh, json={**base, "cost_share_confirmed": True, "upi_id": "price.d@okaxis"}).json()
    tid = t["id"]
    assert t["price"]["per_km"] == 3 and t["price"]["max_per_km"] == 4.5 and t["price"]["trip_cost"] == round(9 * 11.2)
    assert t["price"]["full_route_per_seat"] * t["seats_total"] <= t["price"]["trip_cost"]   # never a profit

    # search prices the rider's own stretch: 77.60 -> 77.65 is about 5.4 km, so the Rs 30 minimum applies
    found = client.get(f"{API}/trips/search", headers=rh, params={"from_lat": 12.97, "from_lon": 77.60, "to_lat": 12.97, "to_lon": 77.65}).json()
    me = next(x for x in found if x["id"] == tid)
    assert 5 < me["rider_km"] < 6 and me["per_seat"] == 30

    client.post(f"{API}/trips/{tid}/request", headers=rh, json={"pickup_name": "Mid", "pickup_lat": 12.97, "pickup_lon": 77.60, "seats": 2})
    seat = client.get(f"{API}/trips/{tid}", headers=dh).json()["riders"][0]
    assert seat["contribution"] == 60                      # 2 seats x Rs 30
    client.post(f"{API}/trips/{tid}/seats/{seat['seat_id']}/approve", headers=dh)
    assert any("Your contribution is Rs 60" in a["body"] for a in alerts(client, rh))

    # the rider gets a UPI link with the amount filled in; paying is recorded, never handled
    mine = client.get(f"{API}/trips/{tid}", headers=rh).json()
    assert mine["pay_to"]["upi_id"] == "price.d@okaxis" and "am=60" in mine["pay_to"]["link"] and mine["pay_to"]["link"].startswith("upi://pay?")
    assert client.post(f"{API}/trips/{tid}/paid", headers=rh).json()["my_seat"]["payment"]["rider_paid"] is True
    assert any(a["kind"] == "paid" for a in alerts(client, dh))
    got = client.post(f"{API}/trips/{tid}/seats/{seat['seat_id']}/received", headers=dh).json()
    assert got["riders"][0]["payment"] == {"rider_paid": True, "driver_got": True}
    assert client.post(f"{API}/trips/{tid}/seats/{seat['seat_id']}/received", headers=rh).status_code == 403

    # a free ride: nothing to pay; and the UPI ID shows on the driver's own profile
    assert client.get(f"{API}/auth/me", headers=dh).json()["profile"]["upi_id"] == "price.d@okaxis"
    assert pricing.per_seat(0, 10, 10, 3) == 0
    client.post(f"{API}/trips/{tid}/withdraw", headers=rh)
    client.post(f"{API}/trips/{tid}/cancel", headers=dh)


def test_parallel_approvals_of_the_last_seat_approve_exactly_one(client):
    """Regression (e2e G46): on SQLite the FOR UPDATE row lock is a no-op, and 5 parallel approvals of a 1-seat
    ride all succeeded. lock_trip now takes SQLite's write lock up front, so they queue like on Postgres."""
    from concurrent.futures import ThreadPoolExecutor
    d, dh, _ = signup(client, "Parallel D.")
    tid = post_trip(client, dh, seats=1)["id"]
    for i in range(5):
        _, rh, _ = signup(client, f"Parallel R{i}")
        client.post(f"{API}/trips/{tid}/request", headers=rh, json={})
    seat_ids = [r["seat_id"] for r in client.get(f"{API}/trips/{tid}", headers=dh).json()["riders"]]
    with ThreadPoolExecutor(5) as pool:
        codes = list(pool.map(lambda s: client.post(f"{API}/trips/{tid}/seats/{s}/approve", headers=dh).status_code, seat_ids))
    assert sorted(codes) == [200, 409, 409, 409, 409], codes
    t = client.get(f"{API}/trips/{tid}", headers=dh).json()
    assert t["seats_left"] == 0 and sum(r["status"] == "approved" for r in t["riders"]) == 1
    client.post(f"{API}/trips/{tid}/cancel", headers=dh)


# ---------- stuck rides, price, no-shows, reports, notifications ----------
def _in_the_past(tid, minutes):
    """Move a ride's planned (and start) time `minutes` earlier, as if that much time had gone by."""
    from app.db import SessionLocal
    from app.models import Trip
    with SessionLocal() as db:
        t = db.get(Trip, tid)
        t.depart_at -= timedelta(minutes=minutes)
        if t.started_at:
            t.started_at -= timedelta(minutes=minutes)
        db.commit()


def _ask_another_ride(client, rh) -> int:
    """Can this rider book again? Asks for a seat on a fresh ride (then cancelled: tests share one road)."""
    _, oh, _ = signup(client, "Other D.")
    other = post_trip(client, oh, minutes=45)["id"]
    status = client.post(f"{API}/trips/{other}/request", headers=rh, json={}).status_code
    client.post(f"{API}/trips/{other}/cancel", headers=oh)
    return status


def test_a_started_ride_nobody_ended_is_closed_and_frees_its_riders(client):
    tid, dh, rh = _approved_pair(client, minutes=0)
    client.post(f"{API}/trips/{tid}/start", headers=dh)   # on time, so nobody "left early"
    assert _ask_another_ride(client, rh) == 409

    _in_the_past(tid, 4 * 60)   # 25-minute route, set off 4 hours ago, never ended
    assert client.get(f"{API}/me/trips", headers=rh).json()["active"] is None
    t = client.get(f"{API}/trips/{tid}", headers=rh).json()
    assert t["status"] == "completed" and t["my_seat"]["status"] == "missed"
    assert any(a["title"] == "Your ride was closed" and a["trip_id"] == tid for a in alerts(client, rh))
    assert any(a["title"] == "Your ride was closed" and a["trip_id"] == tid for a in alerts(client, dh))
    assert not any("left without you" in a["title"] for a in alerts(client, rh))
    assert _ask_another_ride(client, rh) == 200


def test_an_open_ride_that_never_set_off_expires_and_everyone_is_told(client):
    tid, dh, rh = _approved_pair(client, minutes=20)
    _, ph, _ = signup(client, "Pending P.")
    client.post(f"{API}/trips/{tid}/request", headers=ph, json={})
    _in_the_past(tid, 4 * 60)
    client.get(f"{API}/me/trips", headers=dh)
    assert client.get(f"{API}/trips/{tid}", headers=dh).json()["status"] == "expired"
    for h in (dh, rh, ph):
        assert any(a["kind"] == "expired" and a["trip_id"] == tid for a in alerts(client, h))
    assert _ask_another_ride(client, rh) == 200


def test_a_rider_not_picked_up_can_leave_after_the_wait(client):
    tid, dh, rh = _approved_pair(client, minutes=5)
    r = client.post(f"{API}/trips/{tid}/withdraw", headers=rh)          # inside the cutoff: locked
    assert r.status_code == 409 and "15 minutes" in r.json()["detail"]
    client.post(f"{API}/trips/{tid}/start", headers=dh)
    _in_the_past(tid, 25)                                                # 20 min past the planned time, still not picked up
    t = client.get(f"{API}/trips/{tid}", headers=rh).json()
    assert t["pickup_overdue"] is True and t["can_cancel"] is True
    assert client.post(f"{API}/trips/{tid}/withdraw", headers=rh).status_code == 200
    assert any(a["title"].endswith("stopped waiting") for a in alerts(client, dh))
    assert _ask_another_ride(client, rh) == 200
    client.post(f"{API}/trips/{tid}/end", headers=dh)


def test_the_rider_pays_what_the_search_showed(client):
    d, dh, _ = signup(client, "Quote D.")
    r, rh, _ = signup(client, "Quote R.")
    when = (datetime.now(timezone.utc) + timedelta(minutes=45)).isoformat()
    tid = client.post(f"{API}/trips", headers=dh, json={
        "from_name": "Lakeview", "from_lat": 12.97, "from_lon": 77.55, "to_name": "Tech Park", "to_lat": 12.97, "to_lon": 77.65,
        "depart_at": when, "route": ROUTE, "route_km": 11.2, "route_min": 25, "seats": 2, "licence_confirmed": True,
        "cost_share_confirmed": True, "price_per_km": 4.5}).json()["id"]
    # a short hop near the start: the Rs 30 minimum; the whole route would be Rs 50
    trip = {"from_lat": 12.97, "from_lon": 77.55, "to_lat": 12.97, "to_lon": 77.58}
    quote = next(x for x in client.get(f"{API}/trips/search", headers=rh, params=trip).json() if x["id"] == tid)
    assert quote["per_seat"] == 30 and quote["price"]["full_route_per_seat"] == 50

    # dropping before the pickup makes no sense on this route
    bad = client.post(f"{API}/trips/{tid}/request", headers=rh, json={"pickup_lat": 12.97, "pickup_lon": 77.58, "drop_lat": 12.97, "drop_lon": 77.55})
    assert bad.status_code == 422

    t = client.post(f"{API}/trips/{tid}/request", headers=rh, json={
        "pickup_name": "Lakeview", "pickup_lat": 12.97, "pickup_lon": 77.55, "drop_name": "Mill Rd", "drop_lat": 12.97, "drop_lon": 77.58,
        "seats": 2}).json()
    assert t["my_seat"]["contribution"] == 2 * quote["per_seat"] == 60
    seat = client.get(f"{API}/trips/{tid}", headers=dh).json()["riders"][0]
    assert seat["contribution"] == 60 and seat["drop_name"] == "Mill Rd"
    client.post(f"{API}/trips/{tid}/seats/{seat['seat_id']}/approve", headers=dh)
    assert any("Your contribution is Rs 60" in a["body"] for a in alerts(client, rh))

    # asking again without a drop: to the end of the route, like the ride's own price says
    client.post(f"{API}/trips/{tid}/withdraw", headers=rh)
    t = client.post(f"{API}/trips/{tid}/request", headers=rh, json={"pickup_lat": 12.97, "pickup_lon": 77.55}).json()
    assert t["my_seat"]["contribution"] == 50
    client.post(f"{API}/trips/{tid}/cancel", headers=dh)


def test_a_no_show_is_not_told_the_driver_left_without_them(client):
    tid, dh, rh = _approved_pair(client, minutes=30)
    seat = client.get(f"{API}/trips/{tid}", headers=dh).json()["riders"][0]["seat_id"]
    early = client.post(f"{API}/trips/{tid}/seats/{seat}/no-show", headers=dh)
    assert early.status_code == 409 and "planned leaving time" in early.json()["detail"]
    assert client.post(f"{API}/trips/{tid}/seats/{seat}/no-show", headers=rh).status_code == 403

    _in_the_past(tid, 35)
    t = client.post(f"{API}/trips/{tid}/seats/{seat}/no-show", headers=dh).json()
    assert t["riders"][0]["status"] == "no_show" and t["seats_left"] == t["seats_total"]   # the seat is free again
    client.post(f"{API}/trips/{tid}/start", headers=dh)
    client.post(f"{API}/trips/{tid}/end", headers=dh)
    mine = alerts(client, rh)
    assert any(a["kind"] == "no_show" and a["title"] == "You weren't at your pickup" for a in mine)
    assert not any("left without you" in a["title"] for a in mine)
    assert client.get(f"{API}/auth/me", headers=dh).json()["profile"]["rating"]["count"] == 0   # no penalty for the driver
    assert tid in [x["id"] for x in client.get(f"{API}/me/trips", headers=rh).json()["history"]]


def test_ending_on_time_without_a_rider_does_not_blame_the_driver(client):
    tid, dh, rh = _approved_pair(client, minutes=10)
    _in_the_past(tid, 15)                       # the planned time has passed: not leaving early
    client.post(f"{API}/trips/{tid}/start", headers=dh)
    client.post(f"{API}/trips/{tid}/end", headers=dh)
    assert [a["title"] for a in alerts(client, rh) if a["kind"] == "missed"] == ["The ride ended before your pickup"]


def test_only_confirmed_riders_can_report_or_be_reported(client):
    d, dh, _ = signup(client, "Report D.")
    r, rh, _ = signup(client, "Report R.")
    tid = post_trip(client, dh)["id"]
    client.post(f"{API}/trips/{tid}/request", headers=rh, json={})
    body = {"trip_id": tid, "reasons": ["harassment"]}
    assert client.post(f"{API}/reports", headers=rh, json={**body, "reported_id": d}).status_code == 403   # pending
    assert client.post(f"{API}/reports", headers=dh, json={**body, "reported_id": r}).status_code == 403
    seat = client.get(f"{API}/trips/{tid}", headers=dh).json()["riders"][0]["seat_id"]
    client.post(f"{API}/trips/{tid}/seats/{seat}/approve", headers=dh)
    assert client.post(f"{API}/reports", headers=rh, json={**body, "reported_id": d}).status_code == 201
    assert client.post(f"{API}/reports", headers=dh, json={**body, "reported_id": r}).status_code == 201
    # a declined request doesn't make you part of the ride either
    _, xh, _ = signup(client, "Declined X.")
    client.post(f"{API}/trips/{tid}/request", headers=xh, json={})
    x_seat = next(s["seat_id"] for s in client.get(f"{API}/trips/{tid}", headers=dh).json()["riders"] if s["status"] == "pending")
    client.post(f"{API}/trips/{tid}/seats/{x_seat}/reject", headers=dh)
    assert client.post(f"{API}/reports", headers=xh, json={**body, "reported_id": d}).status_code == 403
    client.post(f"{API}/trips/{tid}/cancel", headers=dh)


def test_drivers_and_riders_are_told_about_withdrawals_and_cancellations(client):
    _, ah, _ = signup(client, "Driver A.")
    _, bh, _ = signup(client, "Driver B.")
    _, rh, _ = signup(client, "Choosy R.")
    a, b = post_trip(client, ah)["id"], post_trip(client, bh)["id"]
    client.post(f"{API}/trips/{a}/request", headers=rh, json={})
    client.post(f"{API}/trips/{a}/withdraw", headers=rh)
    assert any(x["title"] == "Choosy R. withdrew their request" for x in alerts(client, ah))
    # asking both, then B approves: A hears the rider found another ride
    client.post(f"{API}/trips/{a}/request", headers=rh, json={})
    client.post(f"{API}/trips/{b}/request", headers=rh, json={})
    seat = client.get(f"{API}/trips/{b}", headers=bh).json()["riders"][0]["seat_id"]
    client.post(f"{API}/trips/{b}/seats/{seat}/approve", headers=bh)
    assert any(x["title"] == "Choosy R. found another ride" and x["trip_id"] == a for x in alerts(client, ah))
    # and a driver cancelling tells their riders
    client.post(f"{API}/trips/{b}/cancel", headers=bh)
    assert any(x["kind"] == "cancelled" and x["trip_id"] == b for x in alerts(client, rh))
    client.post(f"{API}/trips/{a}/cancel", headers=ah)
