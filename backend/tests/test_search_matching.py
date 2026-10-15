"""Bug #41: ride search returned "0 drivers going your way" for rides that do pass the rider's pickup and drop.

Two causes in the route matcher, each covered here:
- distance to the route was measured to its stored points only, not to the road between them, so a pickup on a
  stretch with few stored points (a long straight road, the straight-line fallback) looked kilometres away;
- only the single nearest point was used for the pickup and for the drop, so on a route that passes the drop
  area twice (a loop, out on one road and back on another) a drop nearest the first pass was treated as
  "before the pickup" and the ride was hidden, even though the driver passes it again after the pickup.
"""
from datetime import datetime, timedelta, timezone

from app.engine import pricing
from app.engine.geo import match_on_route

from .conftest import API
from .test_trips import signup


def post(client, h, route, km, seats=3, minutes=45):
    when = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()
    r = client.post(f"{API}/trips", headers=h, json={
        "from_name": "Start", "from_lat": route[0][0], "from_lon": route[0][1], "to_name": "End",
        "to_lat": route[-1][0], "to_lon": route[-1][1], "depart_at": when, "route": route, "route_km": km,
        "route_min": 40, "seats": seats, "licence_confirmed": True, "cost_share_confirmed": True})
    assert r.status_code == 201, r.text
    return r.json()["id"], when


def search(client, h, pickup, drop=None, when=None):
    q = {"from_lat": pickup[0], "from_lon": pickup[1]}
    if drop:
        q |= {"to_lat": drop[0], "to_lon": drop[1]}
    if when:
        q["when"] = when
    r = client.get(f"{API}/trips/search", headers=h, params=q)
    assert r.status_code == 200, r.text
    return r.json()


# Each test drives its own road (its own latitude, far apart) so rides from one test never show up in another's
# search: the test database is shared.
def sparse(lat):
    """A 22 km straight road stored with only its two ends (a long straight stretch, or a 2-point route)."""
    return [[lat, 77.45], [lat, 77.65]]


def loop(lat):
    """Out east on one road, back west on a parallel road 2.2 km north."""
    return [[lat, 77.55 + i * 0.01] for i in range(11)] + [[lat + 0.02, 77.65 - i * 0.01] for i in range(11)]


def test_pickup_between_stored_points_is_found(client):
    _, dh, _ = signup(client, "Sparse D.")
    _, rh, _ = signup(client, "Sparse R.", "male")
    lat = 13.30
    tid, when = post(client, dh, sparse(lat), 21.7)
    # pickup and drop both right on the road, ~10 km and ~5 km from the nearest stored point
    found = search(client, rh, (lat + 0.001, 77.55), (lat, 77.60), when)
    assert [t["id"] for t in found] == [tid]
    assert found[0]["pickup_km"] < 0.2 and found[0]["drop_km"] < 0.2
    assert 5.0 < found[0]["rider_km"] < 6.0          # priced for pickup to drop along the road, not the whole way
    # still not shown when the rider is really far from the road, or going the other way
    assert search(client, rh, (lat + 0.05, 77.55), (lat, 77.60)) == []
    assert search(client, rh, (lat, 77.60), (lat, 77.50)) == []


def test_drop_passed_twice_is_matched_after_the_pickup(client):
    _, dh, _ = signup(client, "Loop D.")
    _, rh, _ = signup(client, "Loop R.", "female")
    lat = 13.50
    tid, when = post(client, dh, loop(lat), 24.5)
    pickup, drop = (lat, 77.60), (lat + 0.005, 77.56)   # drop: 0.55 km from the outbound road, 1.7 km from the return road
    found = search(client, rh, pickup, drop, when)
    assert [t["id"] for t in found] == [tid]
    quote = found[0]
    assert 1.5 < quote["drop_km"] < 2.0               # matched on the return leg, after the pickup
    # booking with that drop is accepted, and the contribution is exactly the one the search quoted
    r = client.post(f"{API}/trips/{tid}/request", headers=rh, json={
        "pickup_name": "Mid", "pickup_lat": pickup[0], "pickup_lon": pickup[1], "seats": 2,
        "drop_name": "Back", "drop_lat": drop[0], "drop_lon": drop[1]})
    assert r.status_code == 200, r.text
    assert r.json()["my_seat"]["contribution"] == 2 * quote["per_seat"]


def test_reverse_direction_still_rejected_on_request(client):
    _, dh, _ = signup(client, "Rev D.")
    _, rh, _ = signup(client, "Rev R.", "male")
    lat = 13.70
    tid, _ = post(client, dh, sparse(lat), 21.7)
    r = client.post(f"{API}/trips/{tid}/request", headers=rh, json={
        "pickup_name": "East", "pickup_lat": lat, "pickup_lon": 77.62, "drop_name": "West", "drop_lat": lat, "drop_lon": 77.48})
    assert r.status_code == 422 and "before your pickup" in r.json()["detail"]


def test_seats_needed_does_not_hide_rides(client):
    """The report searched for 2 seats: a ride with 1 seat left is still listed (the card says 'Only 1 left')."""
    _, dh, _ = signup(client, "Seat D.")
    _, rh, _ = signup(client, "Seat R.")
    lat = 13.90
    tid, when = post(client, dh, sparse(lat), 21.7, seats=1)
    found = search(client, rh, (lat, 77.50), (lat, 77.60), when)
    assert [t["id"] for t in found] == [tid] and found[0]["seats_left"] == 1

def test_match_on_route_unit():
    straight = [[0.0, 0.0], [0.0, 0.1]]   # ~11.1 km along the equator
    m = match_on_route(straight, 0.0, 0.05)
    assert m and m.pickup_km < 0.01 and abs(m.pickup_pos - 5.56) < 0.05 and m.drop_km is None
    m = match_on_route(straight, 0.0, 0.02, 0.0, 0.08)
    assert m and abs((m.drop_pos - m.pickup_pos) - 6.67) < 0.05
    assert match_on_route(straight, 0.0, 0.08, 0.0, 0.02) is None          # drop before pickup
    assert match_on_route(straight, 0.5, 0.05) is None                     # ~55 km away
    assert match_on_route([[0.0, 0.0]], 0.0, 0.0) is None                  # not a route
    assert abs(pricing.along_route_km(straight, 0.0, 0.02, 0.0, 0.08) - 6.67) < 0.05
    assert abs(pricing.along_route_km(straight, None, None) - 11.12) < 0.05
