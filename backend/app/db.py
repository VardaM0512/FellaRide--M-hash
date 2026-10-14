"""Database engine and session factory."""
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


def make_engine(url: str):
    if url.startswith("sqlite"):
        kwargs = {"connect_args": {"check_same_thread": False}}
    else:
        # small pool: the Supabase free session pooler allows only a few connections per project
        kwargs = {"pool_pre_ping": True, "pool_size": 5, "max_overflow": 5, "pool_recycle": 1800}
    return create_engine(url, **kwargs)


engine = make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db(bind=None) -> None:
    from . import models  # noqa: F401  (register tables)

    Base.metadata.create_all(bind=bind or engine)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
