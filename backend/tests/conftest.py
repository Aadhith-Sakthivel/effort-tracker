"""Test fixtures: a throwaway SQLite DB, fresh tables + seed lookups per test.

Run from the backend/ directory:  python -m pytest
"""
import os
import pathlib
import tempfile

# Point the app at a temp SQLite file BEFORE importing any app module.
TEST_DB = pathlib.Path(tempfile.gettempdir()) / "ams_pytest.db"
if TEST_DB.exists():
    try:
        TEST_DB.unlink()
    except OSError:
        pass
os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{TEST_DB.as_posix()}"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, Grp, SessionLocal, SkillCategory, Status, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    db.add_all([
        Grp(code="DBX", label="Databricks", sort_order=0),
        Grp(code="DW", label="Data Warehouse", sort_order=1),
    ])
    db.add_all([
        Status(code="Requested", label="Requested", is_terminal=False, is_inactive=False, sort_order=0),
        Status(code="In Progress Internal", label="In Progress Internal", sort_order=1),
        Status(code="Completed", label="Completed", is_terminal=True, is_inactive=True, sort_order=6),
    ])
    db.add(SkillCategory(code="SQL", label="SQL"))
    db.commit()
    db.close()
    yield


@pytest.fixture()
def client():
    c = TestClient(app)
    # The SPA sends this on every call; the backend requires it on writes (CSRF guard).
    c.headers.update({"X-Requested-With": "effort-tracker"})
    return c
