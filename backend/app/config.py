"""Runtime settings, read from environment variables (see .env.example)."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="FELLARIDE_", extra="ignore")

    # SQLite for local dev; docker-compose overrides this with PostgreSQL.
    database_url: str = f"sqlite:///{BACKEND_DIR / 'fellaride.db'}"
    # Path to the trained propensity model (created by ml/train_scorer.py).
    scorer_path: Path = BACKEND_DIR / "models" / "scorer.pkl"
    # Comma-separated list of allowed browser origins for the frontend.
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    # Engine tuning knobs (defaults match the Growth Simulator).
    nudge_budget_per_day: int = 14
    nudge_cooldown_days: int = 2
    max_detour_km: float = 3.0
    max_time_gap_min: int = 30
    learning_rate: float = 0.35
    # Optional key that protects the /simulate and /admin endpoints. Empty = open (local dev only).
    admin_key: str = ""
    # On first start with an empty database, create a synthetic demo community and replay N days,
    # so evaluators can test immediately without admin credentials. 0 = do not seed.
    seed_demo_days: int = 14
    # Login tokens. Set FELLARIDE_JWT_SECRET in any shared deployment (32+ random characters);
    # if empty, a random secret is generated at startup and everyone is signed out on restart.
    jwt_secret: str = ""
    jwt_expire_hours: int = 12
    # Synthetic demo communities only: one-tap sign-in as any synthetic member (documented test accounts).
    demo_login: bool = True
    # Password of the seeded demo-community admin account (admin@demo.fellaride.app). Change it when deployed.
    demo_admin_password: str = "fellaride-demo-admin"
    # Max login / register attempts per IP per 10 minutes.
    auth_rate_limit: int = 30
    # Sign-ups without a join code join this community (e.g. DEMO2026, the synthetic demo) instead of the open one,
    # so every new account appears on that community's dashboard. Empty = the open community.
    default_join_code: str = ""
    # Member app -> activation engine bridge: raise its errors instead of logging them (tests turn this on).
    activation_strict: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
