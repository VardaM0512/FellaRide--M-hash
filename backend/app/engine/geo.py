"""Small geometry helpers. Plain lat/lon maths, no PostGIS needed."""
import math

EARTH_KM = 6371.0088


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_KM * math.asin(math.sqrt(a))


def offset(lat: float, lon: float, east_km: float, north_km: float) -> tuple[float, float]:
    """Move a point by km east / north (good enough at city scale)."""
    dlat = north_km / 110.574
    dlon = east_km / (111.320 * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon


def vector_km(lat1: float, lon1: float, lat2: float, lon2: float) -> tuple[float, float]:
    """Approximate (east, north) km vector from point 1 to point 2."""
    north = (lat2 - lat1) * 110.574
    east = (lon2 - lon1) * 111.320 * math.cos(math.radians((lat1 + lat2) / 2))
    return east, north


def direction_overlap(driver_home, rider_home, dest) -> float:
    """Cosine similarity of the two commute directions (1 = same direction, 0 = perpendicular or worse)."""
    v1 = vector_km(*driver_home, *dest)
    v2 = vector_km(*rider_home, *dest)
    n1, n2 = math.hypot(*v1), math.hypot(*v2)
    if n1 < 1e-6 or n2 < 1e-6:
        return 1.0
    return max(0.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2))


def detour_km(driver_home, rider_home, dest) -> float:
    """Extra distance the driver travels to pick the rider up on the way."""
    direct = haversine_km(*driver_home, *dest)
    via = haversine_km(*driver_home, *rider_home) + haversine_km(*rider_home, *dest)
    return max(0.0, via - direct)
