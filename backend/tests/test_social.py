"""Community board (posts, reactions, replies), activity from real rides, challenge, leaderboard, impact and badges."""
from .conftest import API, bearer
from .test_trips import post_trip, signup


def test_board_posts_reactions_replies_and_access(client, community):
    code = community["join_code"]
    a, ha, _ = signup(client, "Asha B.", join_code=code)
    _, hb, _ = signup(client, "Bilal B.", "male", join_code=code)
    _, hx, _ = signup(client, "Outsider X.")              # the open community, not this one

    post = client.post(f"{API}/community/posts", headers=ha, json={"kind": "ask", "body": "Anyone to Campus at 8?"})
    assert post.status_code == 201 and post.json()["author"] == "Asha B." and post.json()["mine"]
    pid = post.json()["id"]
    assert client.post(f"{API}/community/posts", headers=ha, json={"kind": "spam", "body": "x"}).status_code == 422
    assert client.post(f"{API}/community/posts", headers=ha, json={"body": ""}).status_code == 422

    # reactions toggle, and only count once per person per emoji
    r = client.post(f"{API}/community/posts/{pid}/reactions", headers=hb, json={"emoji": "heart"}).json()
    assert r["reactions"]["heart"] == 1 and r["my_reactions"] == ["heart"]
    r = client.post(f"{API}/community/posts/{pid}/reactions", headers=hb, json={"emoji": "heart"}).json()
    assert r["reactions"]["heart"] == 0 and r["my_reactions"] == []

    # a reply alerts the author
    assert client.post(f"{API}/community/posts/{pid}/comments", headers=hb, json={"body": "Me too"}).status_code == 201
    assert [c["body"] for c in client.get(f"{API}/community/posts/{pid}/comments", headers=ha).json()] == ["Me too"]
    assert any(al["kind"] == "community" for al in client.get(f"{API}/me/alerts", headers=ha).json()["items"])

    # the feed shows it to the community only
    assert any(i["type"] == "post" and i["id"] == pid for i in client.get(f"{API}/community/feed", headers=hb).json()["items"])
    assert not any(i.get("id") == pid for i in client.get(f"{API}/community/feed", headers=hx).json()["items"])
    assert client.post(f"{API}/community/posts/{pid}/comments", headers=hx, json={"body": "hi"}).status_code == 404

    # only the author (or the organiser) can delete
    assert client.delete(f"{API}/community/posts/{pid}", headers=hb).status_code == 403
    assert client.delete(f"{API}/community/posts/{pid}", headers=ha).status_code == 200
    other = client.post(f"{API}/community/posts", headers=hb, json={"body": "Road works on Main St"}).json()
    assert client.delete(f"{API}/community/posts/{other['id']}", headers=community["admin_headers"]).status_code == 200


def test_a_finished_ride_counts_for_activity_leaderboard_and_badges(client, community):
    code = community["join_code"]
    _, dh, _ = signup(client, "Dina D.", join_code=code)
    _, rh, _ = signup(client, "Ravi R.", "male", join_code=code)
    tid = post_trip(client, dh)["id"]
    client.post(f"{API}/trips/{tid}/request", headers=rh, json={})
    seat = client.get(f"{API}/trips/{tid}", headers=dh).json()["riders"][0]["seat_id"]
    client.post(f"{API}/trips/{tid}/seats/{seat}/approve", headers=dh)
    client.post(f"{API}/trips/{tid}/seats/{seat}/board", headers=dh)
    client.post(f"{API}/trips/{tid}/start", headers=dh)
    assert client.post(f"{API}/trips/{tid}/end", headers=dh).json()["status"] == "completed"

    me = client.get(f"{API}/community/me", headers=dh).json()
    assert me["rides"] == 1 and me["drove"] == 1 and me["people_met"] == 1 and me["km"] == 11 and me["co2_kg"] > 0
    badges = {b["code"]: b for b in me["badges"]}
    assert badges["first_ride"]["earned"] and not badges["regular"]["earned"] and badges["regular"]["progress"] == 0.1

    board = client.get(f"{API}/community/leaderboard", headers=rh, params={"period": "week", "metric": "rides"}).json()
    assert {r["name"] for r in board["rows"]} >= {"Dina D.", "Ravi R."} and board["me"]["rides"] == 1
    assert client.get(f"{API}/community/leaderboard", headers=rh, params={"metric": "nope"}).status_code == 422

    ov = client.get(f"{API}/community/overview", headers=rh).json()
    assert ov["stats"]["rides_week"] >= 1 and ov["challenge"]["progress"] >= 1 and ov["challenge"]["goal"] >= 10
    feed = client.get(f"{API}/community/feed", headers=rh, params={"show": "activity"}).json()["items"]
    assert any("shared a ride with Ravi" in i["text"] for i in feed)


def test_demo_community_board_is_seeded(client):
    demo = client.get(f"{API}/tenants").json()[0]
    people = client.get(f"{API}/tenants/{demo['id']}/demo-accounts").json()
    s = client.post(f"{API}/auth/demo-login", json={"tenant_id": demo["id"], "member_id": people[0]["id"]}).json()
    items = client.get(f"{API}/community/feed", headers=bearer(s["token"])).json()["items"]
    posts = [i for i in items if i["type"] == "post"]
    assert len(posts) >= 5 and any(sum(p["reactions"].values()) for p in posts)
    assert any(i["type"] == "activity" for i in items)
