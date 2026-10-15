"""Draws docs/architecture.svg: FellaRide's components and the API calls between them.

Layout, left to right: clients -> (HTTP APIs) -> FastAPI routers -> (Python calls) -> engines -> (SQL) -> PostgreSQL.
Every line between two blocks is labelled with the endpoints or functions it carries.
Run:  python docs/build_architecture.py      (no dependencies)
"""
from html import escape
from pathlib import Path

OUT = Path(__file__).with_name("architecture.svg")

# ---------- palette (from the app's design tokens) ----------
INK, FOG, LINE = "#1C2830", "#5B6A73", "#D3DCDA"
MARIGOLD, MARIGOLD_WASH = "#E09F1F", "#FBEFD6"
PEACOCK, PEACOCK_WASH = "#0F7A80", "#DCEFEF"
JAMUN, JAMUN_WASH = "#6A2C5E", "#F0E3EC"
DBC, DB_WASH = "#2F5D8C", "#E4ECF6"
MIST = "#EEF2F1"
SANS = "Inter, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
MONO_W = 6.25   # px per character at 10.5px mono (for pill widths)

svg: list[str] = []


def add(s: str) -> None:
    svg.append(s)


def text(x, y, s, size=11.5, weight=400, fill=INK, anchor="start", family=SANS, rotate=None, style=""):
    tr = f' transform="rotate({rotate} {x} {y})"' if rotate else ""
    add(f'<text x="{x:.1f}" y="{y:.1f}" font-family="{family}" font-size="{size}" font-weight="{weight}" '
        f'fill="{fill}" text-anchor="{anchor}"{tr}{style}>{escape(s)}</text>')


def rect(x, y, w, h, fill="#fff", stroke=INK, sw=1.2, r=8, dash=None):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')


def box(x, y, w, h, title, lines=(), fill="#fff", stroke=INK, title_size=13, center=False, top=False):
    """A component box: bold title, then smaller detail lines, vertically centred (or from the top)."""
    rect(x, y, w, h, fill, stroke)
    block = 17 + 14.5 * len(lines)
    ty = y + 22 if top else y + (h - block) / 2 + 13
    ax, anchor = (x + w / 2, "middle") if center else (x + 10, "start")
    text(ax, ty, title, title_size, 700, INK, anchor)
    for i, ln in enumerate(lines):
        text(ax, ty + 17 + i * 14.5, ln, 11, 400, FOG, anchor)


def cylinder(x, y, w, h, title, lines):
    """Database tables as a cylinder."""
    e = 9
    add(f'<path d="M{x},{y + e} a{w / 2},{e} 0 0,0 {w},0 v{h - 2 * e} a{w / 2},{e} 0 0,1 {-w},0 z" fill="{DB_WASH}" stroke="{DBC}" stroke-width="1.3"/>')
    add(f'<ellipse cx="{x + w / 2}" cy="{y + e}" rx="{w / 2}" ry="{e}" fill="#fff" stroke="{DBC}" stroke-width="1.3"/>')
    block = 17 + 14 * len(lines)
    ty = y + e + (h - e - block) / 2 + 13
    text(x + w / 2, ty, title, 12.5, 700, INK, "middle")
    for i, ln in enumerate(lines):
        text(x + w / 2, ty + 17 + i * 14, ln, 10.8, 400, FOG, "middle", MONO)


def group(x, y, w, h, label, stroke, fill="none", dash=None):
    rect(x, y, w, h, fill, stroke, 1.4, 12, dash)
    text(x + 12, y + 18, label, 11, 700, stroke)


MARKERS = {}


def marker(color: str) -> str:
    """One arrowhead definition per colour."""
    if color not in MARKERS:
        MARKERS[color] = f"arrow{len(MARKERS)}"
    return MARKERS[color]


def pill(cx, cy, lines, color, size=10.5):
    w = max(len(s) for s in lines) * MONO_W * size / 10.5 + 14
    h = 13 * len(lines) + 9
    rect(cx - w / 2, cy - h / 2, w, h, "#fff", color, 1, 6)
    for i, s in enumerate(lines):
        text(cx, cy - h / 2 + 15 + i * 13, s, size, 400, INK, "middle", MONO)


def arrow(points, color=INK, dash=None, label=None, at=None, sw=1.5, size=10.5):
    """Polyline with an arrowhead at the end. `label` (list of lines) is drawn as a pill at `at` (x, y)."""
    d = " ".join(f"{'M' if i == 0 else 'L'}{x:.1f},{y:.1f}" for i, (x, y) in enumerate(points))
    da = f' stroke-dasharray="{dash}"' if dash else ""
    add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{sw}"{da} marker-end="url(#{marker(color)})"/>')
    if label:
        if at is None:
            (x1, y1), (x2, y2) = points[-2], points[-1]
            at = ((x1 + x2) / 2, (y1 + y2) / 2)
        pill(at[0], at[1], label, color, size)


# ---------- columns ----------
C_X, C_W = 35, 405                 # clients
GAP_A = (455, 700)                 # client -> router API labels
BE_X0, BE_X1 = 700, 1630           # backend container
SEC_X, SEC_W = 712, 30             # security band
R_X, R_W = 755, 205                # routers
E_X0, E_X1 = 1195, 1615            # engines column
DB_X0, DB_X1 = 1765, 1995          # database container
W = 2025

# ---------- rows: one "slot" per client -> router API line ----------
# (client, router, label lines, min height)
SLOTS = [
    ("member", "trips", ["POST /trips", "GET  /trips/search", "GET  /trips/{id}        (poll 5 s)",
                         "POST /trips/{id}/request · withdraw", "POST …/seats/{s}/approve · reject",
                         "POST …/seats/{s}/board", "POST /trips/{id}/start · end · cancel",
                         "GET·POST …/messages  (poll 4 s)", "POST /trips/{id}/notify"], 150),
    ("member", "me", ["PUT  /me/profile · POST /me/location", "GET  /me/trips", "GET  /me/alerts       (poll 8 s)",
                      "POST /me/alerts/read"], 84),
    ("member", "safety", ["POST /trips/{id}/ratings", "POST /reports", "GET  /report-reasons"], 92),
    ("member", "account", ["POST /auth/signup · /auth/login", "POST /auth/demo-login", "GET  /auth/me · /tenants/…"], 64),
    ("dash", "account", ["POST /auth/login  (organiser)"], 42),
    ("dash", "organiser", ["GET  /tenants/{t}/trips-overview", "POST /tenants/{t}/broadcast", "POST …/reports/{r}/review"], 70),
    ("dash", "rides", ["POST /tenants/{t}/rides/match"], 100),
    ("dash", "insights", ["GET  /tenants/{t}/metrics", "GET  …/metrics/funnel · /timeseries", "GET  …/graph · /model",
                          "POST …/day/close · /simulate", "POST /demo/compare"], 92),
    ("dash", "community", ["GET  /tenants · /tenants/{t}", "GET  …/members · /members/{m}", "GET  …/clusters",
                           "POST /tenants  (new community)"], 80),
    ("dash", "engagement", ["POST …/interventions/plan", "GET  …/interventions"], 46),
    ("docs", "engagement", ["any /api/v1 route (+ X-Admin-Key)", "POST …/interventions/{i}/respond",
                            "POST …/referrals · /accept", "POST …/rides/offers · /requests"], 76),
]
GROUP_GAP, CLIENT_GAP = 14, 22
Y0 = 345
slots = []
y = Y0
prev = None
for client, router, label, min_h in SLOTS:
    if prev:
        if client == "docs":
            y += 50                  # leaves room for the frontend container's bottom edge + title
        elif prev[0] != client and prev[1] == router:
            y += CLIENT_GAP          # same router, new client: separate the client boxes
        elif prev[1] != router:
            y += GROUP_GAP + (CLIENT_GAP if prev[0] != client else 0)
        if router == "rides" and prev[1] != router:
            y += 34                  # room for the bridge -> activation engine call labels
    h = max(min_h, 13 * len(label) + 30)
    slots.append({"client": client, "router": router, "label": label, "y": y, "h": h, "cy": y + h / 2})
    y += h
    prev = (client, router)
Y_END = y


def span(key, value):
    rows = [s for s in slots if s[key] == value]
    return rows[0]["y"], rows[-1]["y"] + rows[-1]["h"]


def cy_of(router, client=None):
    return next(s["cy"] for s in slots if s["router"] == router and (client is None or s["client"] == client))


H = Y_END + 250

# ---------- defs, background, title, legend ----------
add(f'<rect width="{W}" height="{H}" fill="#FFFFFF"/>')
text(30, 42, "FellaRide · system architecture", 24, 800, INK)
text(30, 66, "Every line between blocks is a real call, labelled with what it carries. HTTP paths omit the /api/v1 prefix; {t} = community, {id} = ride, {s} = seat.", 12.5, 400, FOG)

LEGEND = [(INK, None, "HTTPS API call (JSON, Bearer JWT)"), (PEACOCK, "6 4", "internal Python call"),
          (DBC, None, "SQL (SQLAlchemy 2 + psycopg 3)"), (MARIGOLD, None, "browser → device / OpenStreetMap"),
          (JAMUN, "6 4", "activation bridge call"), (JAMUN, "2 4", "offline ML artifact")]
lx = 760
for color, dash, label in LEGEND:
    arrow([(lx, 96), (lx + 34, 96)], color, dash)
    text(lx + 42, 100, label, 11, 400, FOG)
    lx += 52 + len(label) * 6.1

# ---------- outside the app: device + OpenStreetMap ----------
text(27, 104, "OUTSIDE THE APP · device and OpenStreetMap services", 11, 700, FOG)
EXT = [("tray", 92, "OS notification tray", ["phone or desktop"]), ("dialer", 227, "Phone dialer", ["call your co-riders"]),
       ("tiles", 369, "OSM tile server", ["street map images"]), ("nominatim", 511, "Nominatim", ["place search · reverse"]),
       ("osrm", 653, "OSRM", ["driving routes (≤ 3)"])]
for _, cx, title, lines in EXT:
    box(cx - 65, 114, 130, 52, title, lines, MIST, FOG, 12, center=True)

# ---------- frontend ----------
m_top, m_bot = 290, span("client", "member")[1]
d_top, d_bot = span("client", "dash")
group(20, 205, 435, d_bot + 32 - 205, "", MARIGOLD, "#FFFDF8")
text(32, d_bot + 22, "FRONTEND · React 18 + Vite + TypeScript · installable PWA · :5173", 11, 700, MARIGOLD)
box(35, 222, 115, 40, "Service worker", ["sw.js"], "#fff", MARIGOLD, 11.5, center=True)
box(C_X, m_top, C_W, m_bot - m_top, "Member app  (phone first)", [
    "Sign up: email · mobile · password · name · gender",
    "   + optional join code  ·  sign in by email or mobile",
    "Home: “I’m driving” or “I need a ride”, asked every time",
    "Offer: from · to · time · seats → pick + confirm route",
    "Find: rides passing pickup → drop · gender filter",
    "Ride (driver): approve / decline with name · gender · rating",
    "   boarding code · “Who got in?” dropdown · quick updates",
    "   start · end for everyone · cancel",
    "Ride (rider): code · call driver · end my ride",
    "   (last rider ends the ride for everyone)",
    "Group chat · rate everyone · report (multiple choice)",
    "Alerts: banner + phone notification · You: profile, history",
    "Leaflet map · TanStack Query polling (4–10 s)",
    "",
    "Pages: /welcome · /signup · /signin · /demo · /start",
    "   /setup (one-time profile) · / (home) · /offer · /find",
    "   /trip/:id · /alerts · /me",
    "Session: JWT in localStorage, 12 h, any 401 signs out",
], "#fff", MARIGOLD, 14, top=True)
box(C_X, d_top, C_W, d_bot - d_top, "Organiser dashboard  (/dashboard)", [
    "Community map with day slider · growth graph",
    "This-week numbers with sparklines · activation funnel",
    "Today’s nudges · hot corridors · model weights",
    "Operator: plan nudges · match · next day · simulate",
    "Proof page: smart engine vs random nudges",
    "Member-app panel: rides live / completed, ratings,",
    "   penalties, reports by category (mark reviewed),",
    "   send a notification to every member",
    "",
    "Pages: /dashboard · /dashboard/proof",
    "Organiser accounts only (role = admin)",
    "Framer Motion day slider · SVG map and charts",
], "#fff", MARIGOLD, 14, top=True)
x_top, x_bot = span("client", "docs")
box(C_X, x_top, C_W, x_bot - x_top, "Swagger UI  /docs  ·  operator scripts", [
    "Interactive docs served by FastAPI; scripts use X-Admin-Key",
    "Drives the engine’s own ride + nudge endpoints",
], MIST, FOG, 13)

# browser -> outside services
arrow([(92, m_top), (92, 262)], MARIGOLD)
text(98, 281, "showNotification()", 10.5, 400, INK, family=MONO)
arrow([(92, 222), (92, 166)], MARIGOLD)
text(98, 196, "Notifications API", 10.5, 400, INK, family=MONO)
arrow([(227, m_top), (227, 166)], MARIGOLD, label=["tel:+91…"], at=(227, 236))
arrow([(369, m_top), (369, 166)], MARIGOLD, label=["GET /{z}/{x}/{y}.png"], at=(369, 196))
arrow([(C_X + C_W, 304), (511, 304), (511, 166)], MARIGOLD, label=["GET /search?q=…", "GET /reverse?lat&lon"], at=(511, 246))
arrow([(C_X + C_W, 322), (653, 322), (653, 166)], MARIGOLD, label=["GET /route/v1/driving/", "{from};{to}?alternatives=3"], at=(626, 196))

# ---------- backend container + docker ----------
group(690, 278, DB_X1 + 10 - 690, Y_END + 34 - 278, "", FOG, "none", "7 5")
text(DB_X1, 294, "docker compose: services api + db", 11, 700, FOG, "end")
group(BE_X0, 300, BE_X1 - BE_X0, Y_END + 18 - 300, "BACKEND · FastAPI · Python 3.13 · /api/v1 · service api :8000", PEACOCK, "#F7FBFB")

# security band: every API line passes through it
rect(SEC_X, Y0 - 8, SEC_W, Y_END - Y0 + 16, PEACOCK_WASH, PEACOCK, 1, 6)
mid = (Y0 + Y_END) / 2
text(SEC_X + 19, mid, "SECURITY on every request · CORS → JWT bearer (auth.py, HS256) → member / admin check → "
     "community scoping (other communities = 404) → pydantic validation · bcrypt passwords · sign-in rate limit",
     10.5, 700, PEACOCK, "middle", rotate=-90)

ROUTERS = {
    "trips": ("trips.py · /trips", ["post · search · seats", "lifecycle · chat · updates"]),
    "me": ("trips.py · /me", ["profile · location", "alerts · my rides"]),
    "safety": ("trips.py · safety", ["ratings · reports"]),
    "account": ("account.py", ["sign-up · sign-in", "demo login · who am I"]),
    "organiser": ("trips.py · organiser", ["overview · broadcast · review"]),
    "rides": ("rides.py", ["engine offers · requests", "instant match"]),
    "insights": ("insights.py", ["metrics · funnel · graph", "model · day cycle · simulate"]),
    "community": ("community.py", ["communities · members", "clusters · partners"]),
    "engagement": ("engagement.py", ["nudges · referrals"]),
}
for key, (title, lines) in ROUTERS.items():
    top, bot = span("router", key)
    box(R_X, top + 4, R_W, bot - top - 8, title, lines, "#fff", PEACOCK, 12.5)

# client -> router API lines
gx = (GAP_A[0] + GAP_A[1]) / 2 + 4
for s in slots:
    arrow([(C_X + C_W, s["cy"]), (R_X, s["cy"])], INK, label=s["label"], at=(gx, s["cy"]))

# ---------- engines ----------
t_top = span("router", "trips")[0]
s_bot = span("router", "safety")[1]
group(E_X0, t_top - 6, E_X1 - E_X0, s_bot - t_top + 12, "TRIP ENGINE · engine/trips.py", PEACOCK, "#fff")
BX, BW = E_X0 + 12, E_X1 - E_X0 - 24
trips_top, trips_bot = span("router", "trips")
me_top, me_bot = span("router", "me")
saf_top, saf_bot = span("router", "safety")
box(BX, trips_top + 22, BW, 60, "Proximity", ["alert everyone within 2.5 km of the route",
                                                "search: route passes pickup, then drop"], PEACOCK_WASH, PEACOCK, 12.5)
box(BX, trips_top + 92, BW, me_bot - trips_top - 96, "Seats and ride lifecycle", [
    "request → approve / decline · full car auto-declines",
    "one active ride each · 4-digit code for the whole car",
    "board (“got in”) · start · driver ends all",
    "rider ends own part; last rider ends the ride",
    "group chat · driver updates → alerts"], PEACOCK_WASH, PEACOCK, 12.5)
box(BX, saf_top + 4, BW, saf_bot - saf_top - 8, "Trust", [
    "rating = recency-weighted avg of last 20 (×0.85 each)",
    "auto 1★: left early + rider left behind · 2★: cancelled",
    "report → category (safety > fraud > reliability…) + severity"], PEACOCK_WASH, PEACOCK, 12.5)

r_top = span("router", "rides")[0]
e_bot = span("router", "engagement")[1]
group(E_X0, r_top - 6, E_X1 - E_X0, e_bot - r_top + 12, "ACTIVATION ENGINE · engine/*", PEACOCK, "#fff")
LX, LW = E_X0 + 12, 170
RX = LX + LW + 80
RW = E_X1 - 12 - RX
ri_top, ri_bot = span("router", "rides")
in_top, in_bot = span("router", "insights")
co_top, co_bot = span("router", "community")
en_top, en_bot = span("router", "engagement")
box(LX, ri_top + 22, LW, ri_bot - ri_top - 26, "Ride service", ["rides.py · lifecycle.py", "feedback.py"], "#fff", PEACOCK, 12)
box(LX, in_top + 4, LW, in_bot - in_top - 8, "Metrics + day cycle", ["metrics.py · daycycle.py", "sim/ synthetic replay", "(demo communities only)"], "#fff", PEACOCK, 12)
box(LX, co_top + 4, LW, co_bot - co_top - 8, "Community intelligence", ["context.py: features", "corridors (hot routes)"], "#fff", PEACOCK, 12)
box(LX, en_top + 4, LW, en_bot - en_top - 8, "Interventions + referrals", ["interventions.py: budget,", "cooldown, connectors first", "referrals.py: invitees"], "#fff", PEACOCK, 12)
box(RX, ri_top + 22, RW, in_bot - ri_top - 26, "Matching", ["matching.py", "0.40 route overlap", "0.25 detour ≤ 3 km", "0.25 time gap ≤ 30 min", "0.10 preferences"], "#fff", PEACOCK, 12)
box(RX, co_top + 4, RW, en_bot - co_top - 8, "Propensity scorer", ["scorer.py · logistic", "driver · rider", "connector · referrer", "learns online from", "nudge answers + rides"], "#fff", PEACOCK, 12)
# inside the activation engine
yy = (ri_top + 22 + ri_bot) / 2
arrow([(LX + LW, yy), (RX, yy)], PEACOCK, "6 4")
text((LX + LW + RX) / 2, yy - 5, "run_matching", 9, 400, PEACOCK, "middle", MONO)
yy = cy_of("community")
arrow([(LX + LW, yy), (RX, yy)], PEACOCK, "6 4")
text((LX + LW + RX) / 2, yy - 5, "features", 9.5, 400, PEACOCK, "middle", MONO)
yy = (en_top + en_bot) / 2
arrow([(RX, yy), (LX + LW, yy)], PEACOCK, "6 4")
text((LX + LW + RX) / 2, yy - 5, "p(role)", 9.5, 400, PEACOCK, "middle", MONO)

# router -> engine calls
gbx = (R_X + R_W + E_X0) / 2
CALLS = [
    ("trips", trips_top + 52, ["post_trip · notify_nearby", "search"]),
    ("trips", trips_top + 120, ["request_seat · decide · board", "start · end · cancel", "post_message"]),
    ("me", cy_of("me"), ["active_for · pending_for", "history_for · rate_targets"]),
    ("safety", cy_of("safety"), ["rate · report · rating_of"]),
    ("rides", cy_of("rides"), ["create_offer · create_request", "match_now · finish_offer"]),
    ("insights", cy_of("insights"), ["kpis · funnel · timeseries", "graph · close_day · simulate"]),
    ("community", cy_of("community"), ["build_context", "recommend_partners"]),
    ("engagement", (en_top + en_bot) / 2, ["plan · respond", "suggest_invitees · send"]),
]
for _, y_, label in CALLS:
    arrow([(R_X + R_W, y_), (E_X0, y_)], PEACOCK, "6 4", label, (gbx, y_), size=10)
# organiser reads ride + report data through the trip engine
org_y = cy_of("organiser")
arrow([(R_X + R_W, org_y), (gbx + 30, org_y), (gbx + 30, saf_bot - 14), (E_X0, saf_bot - 14)], PEACOCK, "6 4",
      ["report_out · alert", "expire_stale"], (gbx - 10, org_y), size=10)

# ---------- activation bridge: member-app rides feed the engine ----------
og_top, og_bot = span("router", "organiser")
ac_top, ac_bot = span("router", "account")
bx0, bx1 = E_X0 + 12, E_X1 - 12
box(bx0, og_top + 2, bx1 - bx0, og_bot - og_top - 4, "Activation bridge · engine/activation.py", [
    "one member per user · real rides → lifecycle, co-ride edges, learning",
    "app actions answer nudges · invites → referrals"], JAMUN_WASH, JAMUN, 12.5)
up_x = E_X0 + 70
arrow([(up_x, saf_bot - 4), (up_x, og_top + 2)], JAMUN, "6 4",
      ["on_trip_posted · on_seat_requested", "on_trip_finished · on_trip_cancelled", "on_rating"], (up_x + 105, ac_bot - 30), size=10)
down_x = E_X0 + 70
arrow([(down_x, og_bot - 2), (down_x, r_top - 6)], JAMUN, "6 4")
text(down_x + 8, og_bot + 12, "lifecycle.mark_* · rides._link · scorer.learn", 9.5, 400, JAMUN, family=MONO)
text(down_x + 8, og_bot + 25, "interventions.respond(follow_up=False) · referrals.accept", 9.5, 400, JAMUN, family=MONO)
acc_y = ac_bot - 18
arrow([(R_X + R_W, acc_y), (gbx + 60, acc_y), (gbx + 60, og_top + 20), (bx0, og_top + 20)], JAMUN, "6 4")
text(R_X + R_W + 8, acc_y - 19, "claimable_member", 9.5, 400, JAMUN, family=MONO)
text(R_X + R_W + 8, acc_y - 7, "register_member", 9.5, 400, JAMUN, family=MONO)

# ---------- database ----------
group(DB_X0, 300, DB_X1 - DB_X0, Y_END + 18 - 300, "DATABASE · PostgreSQL 16", DBC, "#FAFCFF")
text(DB_X0 + 12, 334, "service db · volume pgdata", 10.5, 400, FOG)
text(DB_X0 + 12, 348, "(SQLite file for local dev)", 10.5, 400, FOG)
CX, CW = DB_X0 + 14, DB_X1 - DB_X0 - 28
cylinder(CX, trips_top + 20, CW, saf_bot - trips_top - 30, "Member app tables",
         ["trips", "trip_seats", "trip_messages", "ratings", "reports", "alerts"])
ac_top, ac_bot = span("router", "account")
cylinder(CX, ac_top + 2, CW, ac_bot - ac_top - 4, "Identity", ["tenants · destinations", "users · profiles"])
cylinder(CX, ri_top, CW, co_bot - ri_top - 6, "Activation tables",
         ["members · connections", "ride_offers", "ride_requests · bookings", "interventions", "referrals · events",
          "notifications", "ride_feedback", "daily_metrics"])
cylinder(CX, en_top + 2, CW, en_bot - en_top - 4, "Learning", ["model_states", "synthetic_traits"])

gcx = (BE_X1 + DB_X0) / 2
arrow([(E_X1, cy_of("me")), (CX, cy_of("me"))], DBC, label=["SELECT · INSERT", "UPDATE"], at=(gcx, cy_of("me")))
arrow([(R_X + R_W, ac_top + 30), (E_X1 + 4, ac_top + 30), (CX, ac_top + 30)], DBC)
pill(gcx, ac_top + 30, ["users · profiles"], DBC)
text((E_X0 + E_X1) / 2, ac_top + 24, "account.py reads and writes users directly", 10, 400, DBC, "middle")
arrow([(E_X1, cy_of("insights")), (CX, cy_of("insights"))], DBC, label=["SELECT · INSERT", "UPDATE"], at=(gcx, cy_of("insights")))
arrow([(E_X1, (en_top + en_bot) / 2), (CX, (en_top + en_bot) / 2)], DBC, label=["weights per", "community"], at=(gcx, (en_top + en_bot) / 2))

# ---------- offline ML pipeline ----------
ml_y = Y_END + 96
group(E_X0, ml_y - 8, E_X1 - E_X0, 88, "ML PIPELINE · offline", JAMUN, JAMUN_WASH)
box(E_X0 + 12, ml_y + 18, 168, 54, "train_scorer.py", ["+ scorer_training.ipynb", "scikit-learn"], "#fff", JAMUN, 11.5)
box(RX, ml_y + 18, RW, 54, "models/scorer.pkl", ["+ scorer.json", "4 role models"], "#fff", JAMUN, 11.5)
arrow([(E_X0 + 180, ml_y + 45), (RX, ml_y + 45)], JAMUN, "2 4")
text((E_X0 + 180 + RX) / 2, ml_y + 39, "fit", 9.5, 400, JAMUN, "middle", MONO)
arrow([(RX + RW / 2, ml_y + 18), (RX + RW / 2, en_bot - 4)], JAMUN, "2 4", ["load_pretrained()", "at startup"], (RX + RW / 2, Y_END + 62), size=10)

# footer
text(30, H - 22, "Generated by docs/build_architecture.py. Edit SLOTS / ROUTERS / CALLS there and re-run to update.", 11, 400, FOG)

# ---------- write ----------
defs = "".join(
    f'<marker id="{mid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
    f'<path d="M0,0 L10,5 L0,10 z" fill="{color}"/></marker>' for color, mid in MARKERS.items())
OUT.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H:.0f}" viewBox="0 0 {W} {H:.0f}">'
               f'<defs>{defs}</defs>{"".join(svg)}</svg>\n', encoding="utf-8")
print(f"wrote {OUT} ({W}x{H:.0f})")
