from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.domain.models import Base


settings = get_settings()


def _build_engine():
    db_url = settings.db_url
    connect_args: dict[str, object] = {}
    if db_url.startswith("sqlite"):
        # WSL research_local runs backend + worker against the same SQLite file.
        # A longer timeout plus WAL mode makes concurrent reads/writes much less fragile.
        connect_args = {
            "check_same_thread": False,
            "timeout": 30,
        }
    built = create_engine(db_url, future=True, connect_args=connect_args)
    if db_url.startswith("sqlite"):
        @event.listens_for(built, "connect")
        def _set_sqlite_pragmas(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("PRAGMA busy_timeout = 30000")
                cursor.execute("PRAGMA foreign_keys = ON")
                # WAL is only useful for file-backed SQLite databases.
                if ":memory:" not in db_url:
                    cursor.execute("PRAGMA journal_mode = WAL")
                    cursor.execute("PRAGMA synchronous = NORMAL")
            finally:
                cursor.close()
    return built


engine = _build_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _run_lightweight_schema_updates()


def _run_lightweight_schema_updates() -> None:
    if not str(settings.db_url).startswith("sqlite"):
        return
    inspector = inspect(engine)
    if "research_tasks" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("research_tasks")}
    with engine.begin() as connection:
        if "project_id" not in columns:
            connection.execute(text("ALTER TABLE research_tasks ADD COLUMN project_id INTEGER"))


@contextmanager
def session_scope() -> Session:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
