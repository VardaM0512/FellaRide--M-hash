"""Account lifecycle: forgot and reset password, deleting your account, and several drivers on one route."""
import re

from app import mailer

from .conftest import API, bearer
from .test_trips import ROUTE, alerts, post_trip, signup


def _capture_mail(monkeypatch, kind="reset"):
    """Emails of one kind: "reset" (forgot password) or "verify" (the sign-up code)."""
    sent = []

    def send(to, subject, body, html=None):
        if ("reset" in subject) == (kind == "reset"):
            sent.append((to, subject, body, html))
        return True
    monkeypatch.setattr(mailer, "send", send)
    return sent


def test_forgot_and_reset_password(client, monkeypatch):
    sent = _capture_mail(monkeypatch)
    uid, h, s = signup(client, "Reset Me")
    email = s["user"]["email"]

    # the same answer for a real and an unknown email; only the real one gets a link
    a = client.post(f"{API}/auth/forgot-password", json={"email": email})
    b = client.post(f"{API}/auth/forgot-password", json={"email": "nobody-here@example.org"})
    assert a.status_code == b.status_code == 200 and a.json() == b.json()
    assert len(sent) == 1 and sent[0][0] == email
    token = re.search(r"reset-password\?token=([\w-]+)", sent[0][2]).group(1)

    bad = client.post(f"{API}/auth/reset-password", json={"token": "x" * 40, "password": "brand-new-pass"})
    assert bad.status_code == 400
    short = client.post(f"{API}/auth/reset-password", json={"token": token, "password": "short"})
    assert short.status_code == 422

    r = client.post(f"{API}/auth/reset-password", json={"token": token, "password": "brand-new-pass"})
    assert r.status_code == 200 and r.json()["user"]["id"] == uid
    assert client.get(f"{API}/me/trips", headers=bearer(r.json()["token"])).status_code == 200
    # the old session is signed out, the old password stops working, the new one works, the link is single-use
    assert client.get(f"{API}/me/trips", headers=h).status_code == 401
    assert client.post(f"{API}/auth/login", json={"email": email, "password": "trip-pass-123"}).status_code == 401
    assert client.post(f"{API}/auth/login", json={"email": email, "password": "brand-new-pass"}).status_code == 200
    assert client.post(f"{API}/auth/reset-password", json={"token": token, "password": "another-pass-1"}).status_code == 400


def test_reset_with_the_six_digit_code(client, monkeypatch):
    sent = _capture_mail(monkeypatch)
    uid, h, s = signup(client, "Code Reset")
    email = s["user"]["email"]
    client.post(f"{API}/auth/forgot-password", json={"email": email})
    to, subject, text, html = sent[-1]
    code = re.search(r"code in the app: (\d{6})", text).group(1)
    assert subject.startswith(code) and code in html and "reset-password?token=" in html   # branded HTML with link and code

    # asking again replaces the first link and code
    first_token = re.search(r"token=([\w-]+)", text).group(1)
    client.post(f"{API}/auth/forgot-password", json={"email": email})
    code = re.search(r"code in the app: (\d{6})", sent[-1][2]).group(1)
    assert client.post(f"{API}/auth/reset-password", json={"token": first_token, "password": "brand-new-pass"}).status_code == 400

    # neither a token nor email + code is a 422; a wrong code says how many tries are left
    assert client.post(f"{API}/auth/reset-password", json={"password": "brand-new-pass"}).status_code == 422
    wrong = "000000" if code != "000000" else "111111"
    r = client.post(f"{API}/auth/reset-password", json={"email": email, "code": wrong, "password": "brand-new-pass"})
    assert r.status_code == 400 and "4 tries left" in r.json()["detail"]
    r = client.post(f"{API}/auth/reset-password", json={"email": email.upper(), "code": code, "password": "brand-new-pass"})
    assert r.status_code == 200 and r.json()["user"]["id"] == uid
    assert client.post(f"{API}/auth/login", json={"email": email, "password": "brand-new-pass"}).status_code == 200


def test_five_wrong_codes_lock_the_reset(client, monkeypatch):
    sent = _capture_mail(monkeypatch)
    _, _, s = signup(client, "Guess Proof")
    email = s["user"]["email"]
    client.post(f"{API}/auth/forgot-password", json={"email": email})
    code = re.search(r"code in the app: (\d{6})", sent[-1][2]).group(1)
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        client.post(f"{API}/auth/reset-password", json={"email": email, "code": wrong, "password": "brand-new-pass"})
    # even the right code no longer works
    r = client.post(f"{API}/auth/reset-password", json={"email": email, "code": code, "password": "brand-new-pass"})
    assert r.status_code == 400


def test_delete_account(client, monkeypatch):
    sent = _capture_mail(monkeypatch)
    d, dh, ds = signup(client, "Leaving Driver", "male")
    r, rh, _ = signup(client, "Staying Rider")
    tid = post_trip(client, dh)["id"]
    client.post(f"{API}/trips/{tid}/request", headers=rh, json={})
    seat = client.get(f"{API}/trips/{tid}", headers=dh).json()["riders"][0]["seat_id"]
    client.post(f"{API}/trips/{tid}/seats/{seat}/approve", headers=dh)

    assert client.post(f"{API}/me/delete", headers=dh, json={"password": "wrong-password"}).status_code == 403
    assert client.post(f"{API}/me/delete", headers=dh, json={"password": "trip-pass-123"}).status_code == 200

    # the open ride is cancelled and the rider told; the account is gone
    assert client.get(f"{API}/trips/{tid}", headers=rh).json()["status"] == "cancelled"
    assert any(a["kind"] == "cancelled" and a["trip_id"] == tid for a in alerts(client, rh))
    assert client.get(f"{API}/me/trips", headers=dh).status_code == 401
    email, mobile = ds["user"]["email"], ds["profile"]["mobile"]
    assert client.post(f"{API}/auth/login", json={"email": email, "password": "trip-pass-123"}).status_code == 401
    assert client.post(f"{API}/auth/login", json={"email": mobile, "password": "trip-pass-123"}).status_code == 401
    client.post(f"{API}/auth/forgot-password", json={"email": email})
    assert sent == []   # a deleted account gets no reset link
    # what others still see is anonymous, and the email and mobile can be used again
    assert client.get(f"{API}/trips/{tid}", headers=rh).json()["driver"]["name"] == "Deleted user"
    again = client.post(f"{API}/auth/signup", json={"name": "Back Again", "gender": "male", "email": email,
                                                    "mobile": mobile, "password": "trip-pass-123"})
    assert again.status_code == 201


def test_delete_blocked_mid_ride_and_for_organisers(client, community):
    d, dh, _ = signup(client, "Busy Driver", "male")
    r, rh, _ = signup(client, "Busy Rider")
    tid = post_trip(client, dh)["id"]
    client.post(f"{API}/trips/{tid}/request", headers=rh, json={})
    seat = client.get(f"{API}/trips/{tid}", headers=dh).json()["riders"][0]["seat_id"]
    client.post(f"{API}/trips/{tid}/seats/{seat}/approve", headers=dh)
    client.post(f"{API}/trips/{tid}/seats/{seat}/board", headers=dh)
    assert client.post(f"{API}/me/delete", headers=rh, json={"password": "trip-pass-123"}).status_code == 409
    assert client.post(f"{API}/me/delete", headers=dh, json={"password": "trip-pass-123"}).status_code == 409
    assert client.post(f"{API}/me/delete", headers=community["admin_headers"], json={"password": "x"}).status_code == 403
    client.post(f"{API}/trips/{tid}/end", headers=dh)   # tidy up: other tests search the same road


def test_rider_sees_every_driver_on_the_route_and_can_ask_several(client):
    drivers = [signup(client, f"Route Driver {i}", "male" if i % 2 else "female") for i in range(3)]
    r, rh, _ = signup(client, "Choosy Rider")
    tids = [post_trip(client, h, minutes=20 + 10 * i)["id"] for i, (_, h, _) in enumerate(drivers)]
    found = client.get(f"{API}/trips/search", headers=rh, params={"from_lat": 12.971, "from_lon": 77.57, "to_lat": 12.97, "to_lon": 77.64}).json()
    assert sorted(t["id"] for t in found) == sorted(tids)
    # ask two drivers at once: the first to approve wins and the other request is withdrawn
    for tid in tids[:2]:
        assert client.post(f"{API}/trips/{tid}/request", headers=rh, json={}).json()["my_seat"]["status"] == "pending"
    h0 = drivers[0][1]
    seat = client.get(f"{API}/trips/{tids[0]}", headers=h0).json()["riders"][0]["seat_id"]
    client.post(f"{API}/trips/{tids[0]}/seats/{seat}/approve", headers=h0)
    assert client.get(f"{API}/trips/{tids[1]}", headers=rh).json()["my_seat"]["status"] == "withdrawn"
    for tid, (_, h, _) in zip(tids, drivers):   # tidy up: other tests search the same road
        client.post(f"{API}/trips/{tid}/cancel", headers=h)


def _signup_body(email, mobile):
    return {"name": "Phone P", "gender": "female", "email": email, "mobile": mobile, "password": "trip-pass-123"}


def test_one_mobile_number_in_any_format_is_one_account(client):
    r = client.post(f"{API}/auth/signup", json=_signup_body("fmt1@example.org", "+91 77001 00001"))
    assert r.status_code == 201 and r.json()["profile"]["mobile"] == "+917700100001"
    for same in ("7700100001", "07700100001", "917700100001", "+91-77001-00001", "+91 0 77001 00001"):
        dup = client.post(f"{API}/auth/signup", json=_signup_body(f"fmt-{same}@example.org".replace("+", "p").replace(" ", ""), same))
        assert dup.status_code == 409, same
    # signing in works with any of those formats too
    assert client.post(f"{API}/auth/login", json={"email": "77001 00001", "password": "trip-pass-123"}).status_code == 200
    # not a mobile number
    assert client.post(f"{API}/auth/signup", json=_signup_body("fmt2@example.org", "12345678")).status_code == 422
    assert client.post(f"{API}/auth/signup", json=_signup_body("fmt3@example.org", "+91 12345 67890")).status_code == 422


def test_numbers_saved_before_cleaning_still_count(client):
    """Accounts from before numbers were cleaned may hold '7700200002' or '+917700200002': still the same phone."""
    from app.db import SessionLocal
    from app.models import Profile
    uid = client.post(f"{API}/auth/signup", json=_signup_body("old1@example.org", "+91 77002 00002")).json()["user"]["id"]
    with SessionLocal() as db:
        db.get(Profile, uid).mobile = "7700200002"   # the old format
        db.commit()
    assert client.post(f"{API}/auth/signup", json=_signup_body("old2@example.org", "+91 77002 00002")).status_code == 409
    assert client.post(f"{API}/auth/login", json={"email": "+91 77002 00002", "password": "trip-pass-123"}).status_code == 200


def test_email_must_be_confirmed_before_riding_when_email_can_be_sent(client, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "smtp_host", "smtp.test")
    sent = _capture_mail(monkeypatch, "verify")
    s = client.post(f"{API}/auth/signup", json=_signup_body("verify1@example.org", "+91 77003 00003")).json()
    h = bearer(s["token"])
    assert s["user"]["email_verified"] is False and s["user"]["email_verification_required"] is True
    assert len(sent) == 1 and sent[0][0] == "verify1@example.org"
    code = re.search(r"\n\n(\d{6})\n\n", sent[0][2]).group(1)

    # no posting rides or asking for seats yet
    blocked = client.post(f"{API}/trips", headers=h, json={})
    assert blocked.status_code == 403 and "Confirm your email" in blocked.json()["detail"]
    assert client.post(f"{API}/trips/1/request", headers=h, json={}).status_code == 403

    # resending waits a minute; a wrong code counts down; the right one confirms
    assert client.post(f"{API}/auth/verify-email/send", headers=h).status_code == 429
    wrong = "000000" if code != "000000" else "111111"
    bad = client.post(f"{API}/auth/verify-email", headers=h, json={"code": wrong})
    assert bad.status_code == 400 and "4 tries left" in bad.json()["detail"]
    ok = client.post(f"{API}/auth/verify-email", headers=h, json={"code": code})
    assert ok.status_code == 200 and ok.json()["user"]["email_verified"] is True
    assert client.post(f"{API}/trips", headers=h, json={}).status_code == 422   # past the gate: now just an empty form


def test_without_an_email_server_accounts_work_straight_away(client):
    s = client.post(f"{API}/auth/signup", json=_signup_body("verify2@example.org", "+91 77004 00004")).json()
    assert s["user"]["email_verified"] is False and s["user"]["email_verification_required"] is False
    assert client.post(f"{API}/trips", headers=bearer(s["token"]), json={}).status_code == 422   # not blocked
