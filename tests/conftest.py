from __future__ import annotations

from collections.abc import Generator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.domain.models import Base


@pytest.fixture(autouse=True)
def stable_research_test_defaults():
    settings = get_settings()
    original_sources = settings.research_sources_default
    original_openalex_enabled = settings.research_search_openalex_default_enabled
    original_doi_sources = settings.research_doi_resolution_sources_default
    settings.research_sources_default = "semantic_scholar,arxiv"
    settings.research_search_openalex_default_enabled = False
    try:
        yield
    finally:
        settings.research_sources_default = original_sources
        settings.research_search_openalex_default_enabled = original_openalex_enabled
        settings.research_doi_resolution_sources_default = original_doi_sources


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    session = session_local()
    try:
        yield session
        session.commit()
    finally:
        session.close()

