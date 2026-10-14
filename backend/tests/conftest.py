import os
import tempfile

# Point the app at a throwaway database before anything imports it.
_DB = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["FELLARIDE_DATABASE_URL"] = f"sqlite:///{_DB}"
os.environ["FELLARIDE_ADMIN_KEY"] = ""
os.environ["FELLARIDE_SEED_DEMO_DAYS"] = "3"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def community(client):
    """A small real (non-synthetic) community with two destinations."""
    r = client.post("/api/v1/tenants", json={
        "name": "Test College", "kind": "university", "center_lat": 12.97, "center_lon": 77.59,
        "destinations": [{"name": "Campus", "lat": 12.97, "lon": 77.59}, {"name": "Hospital", "lat": 12.99, "lon": 77.62}]})
    assert r.status_code == 201
    return r.json()
