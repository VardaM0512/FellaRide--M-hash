"""Database engine and session factory."""
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


def make_engine(url: str):
    if url.startswith("sqlite"):
        return create_engine(url, connect_args={"check_same_thread": False})
    # Supabase's pooler allows only 15 connections in total, shared by the live API, a new deploy starting up and
    # anyone running the API locally. SQLAlchemy's default (5 + 10 overflow = 15 per process) can use all of them,
    # and a deploy then fails at startup with "max clients reached". Keep each process small and close idle ones.
    s = get_settings()
    return create_engine(url, pool_pre_ping=True, pool_size=s.db_pool_size, max_overflow=s.db_max_overflow,
                         pool_recycle=300, pool_timeout=30)


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
