"""Bug #41 — "Ride search returns zero drivers for a selected pickup and drop point".

Real driving routes come from OSRM and are thinned to at most 300 points before they are stored, so on a long,
straight highway the stored points can be several km apart. The search used to measure a rider's pickup and drop
against the stored *points* only, so a rider standing on the highway halfway between two of them was "more than
2.5 km from the route" and the search said "0 drivers going your way". These tests store such a route and search
from points that lie on the road between its stored points."""
from datetime import datetime, timedelta, timezone

from app.engine import pricing
from app.engine.trips import NEAR_KM, nearest_on_route

from .conftest import API
from .test_trips import signup

# A highway heading east with stored points ~10.8 km apart (what thinning leaves on a long straight stretch).
# Its own latitude, so other tests' searches on their road never see these rides.
LAT = 13.30
SPARSE = [[LAT, 77.40], [LAT, 77.50], [LAT, 77.60], [LAT, 77.70]]


def _post(client, h, route, minutes=40, seats=3):
    when = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()
    r = client.post(f"{API}/trips", headers=h, json={
        "from_name": "Highway Start", "from_lat": route[0][0], "from_lon": route[0][1],
        "to_name": "Highway End", "to_lat": route[-1][0], "to_lon": route[-1][1],
        "depart_at": when, "route": route, "route_km": 32.5, "route_min": 35, "seats": seats,
        "licence_confirmed": True, "cost_share_confirmed": True})
    assert r.status_code == 201, r.text
    return r.json()


def _search(client, h, **params):
    r = client.get(f"{API}/trips/search", headers=h, params=params)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- unit: the geometry ----------
def test_distance_is_measured_to_the_road_not_just_its_stored_points():
    km, _ = nearest_on_route(SPARSE, LAT, 77.45)          # on the road, ~5.4 km from both stored points
    assert km < 0.05
    km, _ = nearest_on_route(SPARSE, LAT + 0.01, 77.45)   # ~1.1 km north of the road
    assert 1.0 < km < 1.2
    km, _ = nearest_on_route(SPARSE, LAT + 0.05, 77.45)   # ~5.5 km off the road
    assert km > NEAR_KM


def test_position_along_the_route_keeps_order_inside_one_segment():
    _, a = nearest_on_route(SPARSE, LAT, 77.43)
    _, b = nearest_on_route(SPARSE, LAT, 77.47)            # both between the same two stored points
    assert a < b
    _, c = nearest_on_route(SPARSE, LAT, 77.65)
    assert b < c


def test_fare_distance_uses_the_points_on_the_road():
    # 77.45 -> 77.65 along the road is ~21.7 km (the old nearest-stored-point maths gave 10.8 or 21.7 or 32.5)
    km = pricing.along_route_km(SPARSE, LAT, 77.45, LAT, 77.65)
    assert abs(km - 21.7) < 0.3
    assert abs(pricing.along_route_km(SPARSE, LAT, 77.45) - 27.1) < 0.3         # no drop: to the end
    assert abs(pricing.along_route_km(SPARSE, None, None, LAT, 77.45) - 5.4) < 0.3  # no pickup: from the start
    assert pricing.along_route_km([[LAT, 77.4]], LAT, 77.4) == 0.0


# ---------- API: the reported workflow ----------
def test_search_finds_a_ride_whose_road_passes_between_stored_points(client):
    _, dh, _ = signup(client, "Highway D.", "male")
    _, rh, _ = signup(client, "Highway R.")
    tid = _post(client, dh, SPARSE)["id"]
    try:
        # pickup and drop both on the highway, between stored points (the bug: "0 drivers going your way")
        found = _search(client, rh, from_lat=LAT, from_lon=77.45, to_lat=LAT, to_lon=77.65)
        assert tid in [t["id"] for t in found]
        hit = next(t for t in found if t["id"] == tid)
        assert hit["pickup_km"] < 0.1 and hit["drop_km"] < 0.1 and hit["seats_left"] >= 2
        assert abs(hit["rider_km"] - 21.7) < 0.3

        # pickup only (the drop is optional)
        assert tid in [t["id"] for t in _search(client, rh, from_lat=LAT, from_lon=77.45)]

        # with the departure time the rider picked
        when = (datetime.now(timezone.utc) + timedelta(minutes=40)).isoformat()
        assert tid in [t["id"] for t in _search(client, rh, from_lat=LAT, from_lon=77.45, to_lat=LAT, to_lon=77.65, when=when)]

        # pickup and drop in the same gap between two stored points, in driving order
        assert tid in [t["id"] for t in _search(client, rh, from_lat=LAT, from_lon=77.42, to_lat=LAT, to_lon=77.48)]

        # still excluded: going the other way, far off the road, or outside the time window
        assert tid not in [t["id"] for t in _search(client, rh, from_lat=LAT, from_lon=77.65, to_lat=LAT, to_lon=77.45)]
        assert tid not in [t["id"] for t in _search(client, rh, from_lat=LAT, from_lon=77.42, to_lat=LAT, to_lon=77.41)]
        assert tid not in [t["id"] for t in _search(client, rh, from_lat=LAT + 0.05, from_lon=77.45)]
        assert tid not in [t["id"] for t in _search(client, rh, from_lat=LAT, from_lon=77.45, to_lat=LAT + 0.05, to_lon=77.65)]
        later = (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()
        assert tid not in [t["id"] for t in _search(client, rh, from_lat=LAT, from_lon=77.45, when=later)]

        # the rider can ask for 2 seats from that pickup to that drop, and pays what the search quoted
        t = client.post(f"{API}/trips/{tid}/request", headers=rh, json={
            "pickup_name": "Highway km 5", "pickup_lat": LAT, "pickup_lon": 77.45, "seats": 2,
            "drop_name": "Highway km 27", "drop_lat": LAT, "drop_lon": 77.65})
        assert t.status_code == 200, t.text
        assert t.json()["my_seat"]["status"] == "pending"
        assert t.json()["my_seat"]["contribution"] == 2 * hit["per_seat"]

        # a drop before the pickup inside one gap is still refused
        _, r2h, _ = signup(client, "Highway R2.")
        bad = client.post(f"{API}/trips/{tid}/request", headers=r2h, json={
            "pickup_lat": LAT, "pickup_lon": 77.48, "drop_lat": LAT, "drop_lon": 77.42})
        assert bad.status_code == 422
    finally:
        client.post(f"{API}/trips/{tid}/cancel", headers=dh)


def test_riders_near_the_road_between_stored_points_hear_about_the_ride(client):
    _, dh, _ = signup(client, "Alert D.", "male")
    _, rh, _ = signup(client, "Alert R.")
    client.post(f"{API}/me/location", headers=rh, json={"lat": LAT + 0.005, "lon": 77.55})   # ~0.5 km off the road
    trip = _post(client, dh, SPARSE)
    try:
        alerts = client.get(f"{API}/me/alerts", headers=rh).json()["items"]
        assert any(a["kind"] == "trip_nearby" and a["trip_id"] == trip["id"] for a in alerts)
    finally:
        client.post(f"{API}/trips/{trip['id']}/cancel", headers=dh)
