import os
import tempfile

# Point the app at a throwaway database before anything imports it.
_DB = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["FELLARIDE_DATABASE_URL"] = f"sqlite:///{_DB}"
os.environ["FELLARIDE_ADMIN_KEY"] = ""
os.environ["FELLARIDE_SEED_DEMO_DAYS"] = "3"
os.environ["FELLARIDE_JWT_SECRET"] = "test-secret-test-secret-test-secret-1234"
os.environ["FELLARIDE_AUTH_RATE_LIMIT"] = "1000"
os.environ["FELLARIDE_ACTIVATION_STRICT"] = "true"   # bridge errors fail the test instead of being logged

import itertools  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

API = "/api/v1"
_n = itertools.count(1)


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def community(client):
    """A small real (non-synthetic) community with two destinations and its organiser account."""
    i = next(_n)
    r = client.post(f"{API}/tenants", json={
        "name": f"Test College {i}", "kind": "university", "center_lat": 12.97, "center_lon": 77.59,
        "destinations": [{"name": "Campus", "lat": 12.97, "lon": 77.59}, {"name": "Hospital", "lat": 12.99, "lon": 77.62}],
        "admin": {"name": "Org Admin", "email": f"admin{i}@example.org", "password": "admin-pass-123"}})
    assert r.status_code == 201, r.text
    body = r.json()
    body["admin_headers"] = bearer(body["session"]["token"])
    return body


def join(client, community, name, lon, depart=480, car=False, seats=0, dest_index=0):
    """Register a member through the real sign-up route; returns (member_id, headers)."""
    i = next(_n)
    r = client.post(f"{API}/auth/register", json={
        "join_code": community["join_code"], "name": name, "email": f"m{i}@example.org", "password": "member-pass-1",
        "area": "Test Area", "home_lat": 12.97, "home_lon": lon,
        "destination_id": community["destinations"][dest_index]["id"], "depart_min": depart,
        "has_car": car, "seats": seats})
    assert r.status_code == 201, r.text
    s = r.json()
    return s["member"]["id"], bearer(s["token"])
