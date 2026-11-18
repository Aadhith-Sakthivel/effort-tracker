"""FastAPI entrypoint. Serves the API and the built React SPA."""
from __future__ import annotations

import mimetypes
import os
from contextlib import asynccontextmanager
from pathlib import Path

# Windows' mimetypes DB often lacks webp; register so FileResponse serves image/webp.
mimetypes.add_type("image/webp", ".webp")

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .db import get_db, init_db
from .routers import (
    audit, dashboard, efforts, enhancements, lookups, resources, support_tickets, timesheet,
)
from .routers import settings as settings_router

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Retired Postgres schemas to remove (comma-separated), e.g. after moving to a new PGSCHEMA.
    if settings.is_postgres() and os.getenv("DROP_SCHEMAS"):
        import re
        from sqlalchemy import text
        from .db import PG_SCHEMA, engine
        for name in (s.strip() for s in os.environ["DROP_SCHEMAS"].split(",")):
            if re.fullmatch(r"[a-z_][a-z0-9_]*", name) and name not in (PG_SCHEMA, "public"):
                try:
                    with engine.begin() as conn:
                        conn.execute(text(f"DROP SCHEMA IF EXISTS {name} CASCADE"))
                    print(f"[startup] dropped schema {name}")
                except Exception as e:
                    print(f"[startup] drop schema {name} skipped: {e}")
    # On SQLite/dev create tables automatically. On Lakebase, schema is managed
    # by Alembic (migration/ via alembic) or AUTO_INIT_DB=1 for first boot.
    if settings.resolve_url().startswith("sqlite") or os.getenv("AUTO_INIT_DB") == "1":
        try:
            init_db()
        except Exception as e:  # don't let a DB hiccup crash app startup
            print(f"[startup] init_db skipped: {e}")
    # Demo deployments: load the fictional seed once, if the database is empty.
    if os.getenv("SEED_DEMO") == "1":
        try:
            import importlib.util
            seed_path = Path(__file__).resolve().parents[2] / "migration" / "seed_dummy.py"
            spec = importlib.util.spec_from_file_location("seed_dummy", seed_path)
            seed = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(seed)
            seed.main()
        except Exception as e:
            print(f"[startup] demo seed skipped: {e}")
    yield


app = FastAPI(title="Effort Tracker", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (lookups.router, resources.router, enhancements.router,
          efforts.router, timesheet.router, dashboard.router, audit.router,
          support_tickets.router, settings_router.router):
    app.include_router(r)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/me")
def me(request: Request, db=Depends(get_db)):
    from .deps import current_role, current_user
    role = current_role(request, db)
    return {"email": current_user(request), "role": role,
            "can_edit_all": role == "lead",
            "can_edit": role in ("lead", "member")}




# --- Serve the built frontend (frontend/dist) in production ---------------
_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        candidate = _DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        # index.html must never be cached, or browsers keep serving an old bundle
        # (the hashed /assets files are safe to cache forever).
        return FileResponse(_DIST / "index.html", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
