"""Cost sharing, the FellaRide way: riders chip in towards the trip, drivers never make a profit.

A rider's suggested contribution is the distance *they* travel x a per-km rate, with a minimum, rounded to Rs 5.
The no-profit cap: everything the riders pay together can never be more than the trip costs to drive
(fuel plus wear), even with every seat full and every rider going the whole way. The driver may lower the rate,
or make the ride free, but not raise it above that cap. The money changes hands outside the app (UPI or cash)."""
import math

from .geo import match_on_route, nearest_on_route, route_length_km

SUGGESTED_PER_KM = 3.0     # Rs per km a rider travels (about FellaRide's $0.20/km, scaled to Indian costs)
MIN_CONTRIBUTION = 30      # Rs per seat, unless that would break the cap on a short trip
CAR_COST_PER_KM = 9.0      # what the car costs to run: petrol ~Rs 7/km (Rs 105 a litre, 15 km a litre) + ~Rs 2/km wear
ROUND_TO = 5


def max_per_km(seats_total: int) -> float:
    """The highest rate allowed: with every seat taken for the whole route, riders together cover the car's cost."""
    return round(CAR_COST_PER_KM / max(1, seats_total), 2)


def default_per_km(seats_total: int) -> float:
    return min(SUGGESTED_PER_KM, max_per_km(seats_total))


def trip_cost(route_km: float) -> int:
    return round(CAR_COST_PER_KM * route_km)


def along_route_km(route: list, from_lat: float | None, from_lon: float | None, to_lat: float | None = None,
                   to_lon: float | None = None) -> float:
    """Distance along the driver's route from where the rider gets in to where they get out, matched exactly as the
    search matches them (geo.match_on_route), so the price a rider is quoted is the price they're asked for.
    No pickup: from the start; no drop: to the end."""
    if len(route) < 2:
        return 0.0
    has_drop = to_lat is not None and to_lon is not None
    if from_lat is None or from_lon is None:
        return nearest_on_route(route, to_lat, to_lon)[1] if has_drop else route_length_km(route)
    m = match_on_route(route, from_lat, from_lon, to_lat, to_lon) or \
        match_on_route(route, from_lat, from_lon, to_lat, to_lon, near_km=math.inf)   # off the route: closest in order
    if m:
        return m.drop_pos - m.pickup_pos
    return abs(nearest_on_route(route, to_lat, to_lon)[1] - nearest_on_route(route, from_lat, from_lon)[1])


def per_seat(per_km: float, rider_km: float, route_km: float, seats_total: int) -> int:
    """One seat's suggested contribution in rupees (0 for a free ride)."""
    if per_km <= 0:
        return 0
    cap = CAR_COST_PER_KM * max(route_km, rider_km) / max(1, seats_total)   # this seat's share of the car's cost
    amount = min(max(per_km * rider_km, MIN_CONTRIBUTION), cap)
    rounded = round(amount / ROUND_TO) * ROUND_TO
    if rounded > cap:                                                         # never round up past the cap
        rounded -= ROUND_TO
    return max(0, int(rounded))


def upi_link(upi_id: str, name: str, amount: int, note: str) -> str:
    """A standard UPI payment link: opens GPay, PhonePe, Paytm etc. with the amount filled in."""
    from urllib.parse import quote
    return f"upi://pay?pa={quote(upi_id, safe='@._-')}&pn={quote(name)}&am={amount}&cu=INR&tn={quote(note)}"
