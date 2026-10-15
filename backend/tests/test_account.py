"""Account lifecycle: forgot and reset password, deleting your account, and several drivers on one route."""
import re

from app import mailer

from .conftest import API, bearer
from .test_trips import ROUTE, alerts, post_trip, signup


def _capture_mail(monkeypatch):
    sent = []
    monkeypatch.setattr(mailer, "send", lambda to, subject, body, html=None: sent.append((to, subject, body, html)) or True)
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


def test_brevo_email_api(monkeypatch):
    import json as _json
    from app.config import get_settings
    calls = []

    class Resp:
        status = 201
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def fake_urlopen(req, timeout):
        calls.append((req.full_url, dict(req.header_items()), _json.loads(req.data)))
        return Resp()

    s = get_settings()
    monkeypatch.setattr(s, "brevo_api_key", "test-key")
    monkeypatch.setattr(s, "mail_from", "fellaride.team@gmail.com")
    monkeypatch.setattr(mailer.urllib.request, "urlopen", fake_urlopen)
    assert mailer.send("rider@example.org", "Hello", "plain", "<b>html</b>") is True
    url, headers, body = calls[0]
    assert url == mailer.BREVO_URL and headers["Api-key"] == "test-key"
    assert body["sender"]["email"] == "fellaride.team@gmail.com" and body["to"] == [{"email": "rider@example.org"}]
    assert body["htmlContent"] == "<b>html</b>" and body["textContent"] == "plain"


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
