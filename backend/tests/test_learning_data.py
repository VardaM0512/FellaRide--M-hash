"""Real communities produce usable training data: unanswered nudges become negatives, part of the budget explores,
the day clock follows the calendar, and the trainer reads real answered nudges with a time-ordered holdout."""
from datetime import timedelta

from sqlalchemy import select

from app.db import SessionLocal
from app.engine import scorer
from app.models import Intervention, ModelState, Tenant
from ml.train_scorer import load_real_logs, train

from .conftest import API, join


def admin(client, community, path, method="get", **kw):
    r = getattr(client, method)(f"{API}/tenants/{community['id']}{path}", headers=community["admin_headers"], **kw)
    assert r.status_code == 200, r.text
    return r.json()


def updates(client, community):
    return {role: v["updates"] for role, v in admin(client, community, "/model").items()}


def test_unanswered_nudge_expires_as_a_no_and_the_model_learns(client, community):
    mid, _ = join(client, community, "Ira K.", 77.55)
    plan = admin(client, community, "/interventions/plan", "post", json={"budget": 5})
    iv = next(i for i in plan["interventions"] if i["member_id"] == mid)
    with SessionLocal() as db:
        role = db.get(Intervention, iv["id"]).role
    u0 = updates(client, community)

    admin(client, community, "/day/close", "post")
    admin(client, community, "/day/close", "post")      # still inside the answer window
    assert admin(client, community, f"/interventions?member_id={mid}")[0]["status"] == "sent"

    admin(client, community, "/day/close", "post")      # window over: counts as ignored
    assert admin(client, community, f"/interventions?member_id={mid}")[0]["status"] == "ignored"
    assert updates(client, community)[role] == u0[role] + 1

    logs = load_real_logs()
    assert any(y == 0 for rows in logs.values() for _, y in rows)


def test_real_community_explores_part_of_the_budget(client, community):
    for i in range(12):
        join(client, community, f"Explorer {i}.", 77.55 + i * 0.002, car=i % 3 == 0, seats=3 if i % 3 == 0 else 0)
    plan = admin(client, community, "/interventions/plan", "post", json={"budget": 7})
    strategies = [i["strategy"] for i in plan["interventions"]]
    assert len(strategies) == 7
    assert strategies.count("explore") == 1 and strategies.count("smart") == 6   # round(7 * 0.15) = 1


def test_day_clock_follows_the_calendar(client, community):
    with SessionLocal() as db:
        t = db.get(Tenant, community["id"])
        t.created_at = t.created_at - timedelta(days=3)
        db.commit()
    admin(client, community, "/model")
    with SessionLocal() as db:
        assert db.get(Tenant, community["id"]).current_day == 3


def test_real_community_reports_a_calendar_clock(client, community, monkeypatch):
    from app.config import get_settings
    assert client.get(f"{API}/tenants/{community['id']}").json()["clock"] == "calendar"
    monkeypatch.setattr(get_settings(), "auto_advance_days", False)
    assert client.get(f"{API}/tenants/{community['id']}").json()["clock"] == "manual"



def test_trainer_reads_only_real_answered_nudges():
    logs = load_real_logs()
    with SessionLocal() as db:
        expected = len(list(db.scalars(select(Intervention).join(Tenant, Tenant.id == Intervention.tenant_id).where(
            Tenant.is_synthetic.is_(False), Intervention.status.in_(("responded", "ignored"))))))
    assert sum(len(rows) for rows in logs.values()) == expected
    assert logs["referrer"] == []


def test_time_split_holds_out_the_newest_rows():
    # old rows: feature 0 predicts the label; new rows: the reverse. A time split must test on the new rows.
    old = [([float(i % 2), 0, 0, 0, 0, 1], i % 2) for i in range(150)]
    new = [([float(i % 2), 0, 0, 0, 0, 1], 1 - i % 2) for i in range(50)]
    _, report = train({"rider": old + new}, by_time=True)
    assert report["rider"]["split"] == "time"
    assert report["rider"]["holdout_auc"] < 0.5 and not report["rider"]["shipped"]


def test_learning_rate_decays_with_updates():
    x = [1, 1, 1, 1, 1, 1]
    fresh = ModelState(tenant_id=1, role="rider", weights=[0.0] * 6, updates=0)
    seasoned = ModelState(tenant_id=1, role="rider", weights=[0.0] * 6, updates=1000)
    scorer.learn(fresh, x, 1, lr=0.35)
    scorer.learn(seasoned, x, 1, lr=0.35)
    assert abs(seasoned.weights[0] - fresh.weights[0] / 2) < 1e-9
