"""Unit tests for the matching rules and the online learner."""
from types import SimpleNamespace

from app.engine import scorer
from app.engine.geo import detour_km, direction_overlap, haversine_km, offset
from app.engine.matching import match_score
from app.models import ModelState

CAMPUS = (12.97, 77.59)


def member(id_, east, north, depart=480, car=False, dest=1, pref="any"):
    lat, lon = offset(*CAMPUS, east, north)
    return SimpleNamespace(id=id_, home_lat=lat, home_lon=lon, depart_min=depart, has_car=car,
                           seats=3 if car else 0, destination_id=dest, ride_pref=pref)


class Ctx:
    def dest_point(self, m):
        return CAMPUS


def test_haversine_one_km():
    lat, lon = offset(*CAMPUS, 1.0, 0.0)
    assert abs(haversine_km(*CAMPUS, lat, lon) - 1.0) < 0.01


def test_rider_on_the_way_has_tiny_detour_and_full_overlap():
    d, r = member(1, -6, 0, car=True), member(2, -3, 0)
    assert detour_km((d.home_lat, d.home_lon), (r.home_lat, r.home_lon), CAMPUS) < 0.05
    assert direction_overlap((d.home_lat, d.home_lon), (r.home_lat, r.home_lon), CAMPUS) > 0.99
    res = match_score(Ctx(), d, r)
    assert res and res.score > 0.9


def test_ineligible_pairs_are_rejected():
    d = member(1, -6, 0, car=True)
    assert match_score(Ctx(), d, member(2, -3, 0, depart=540)) is None        # 60 min apart
    assert match_score(Ctx(), d, member(3, -3, 0, dest=2)) is None             # different destination
    assert match_score(Ctx(), d, member(4, 0, 6)) is None                       # far off the route
    assert match_score(Ctx(), d, d) is None                                      # self


def test_preference_mismatch_lowers_score():
    d = member(1, -6, 0, car=True, pref="quiet")
    same, diff = member(2, -3, 0, pref="quiet"), member(3, -3, 0, pref="music")
    assert match_score(Ctx(), d, same).score > match_score(Ctx(), d, diff).score


def test_online_learning_moves_prediction_toward_label():
    st = ModelState(tenant_id=1, role="rider", weights=list(scorer.DEFAULT_WEIGHTS["rider"]), updates=0)
    x = [0, 1, 1, 0.5, 1, 1]
    before = scorer.predict(st.weights, x)
    for _ in range(20):
        scorer.learn(st, x, 1, lr=0.35)
    assert scorer.predict(st.weights, x) > before
    assert st.updates == 20
