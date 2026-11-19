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
from .logging_config import configure_logging, get_logger

configure_logging()
log = get_logger("effort_tracker")
from .routers import (
    audit,
    dashboard,
    efforts,
    enhancements,
    lookups,
    resources,
    support_tickets,
    timesheet,
)
from .routers import settings as settings_router

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # On SQLite/dev create tables automatically. On Lakebase, schema is managed
    # by Alembic (migration/ via alembic) or AUTO_INIT_DB=1 for first boot.
    if settings.resolve_url().startswith("sqlite") or os.getenv("AUTO_INIT_DB") == "1":
        try:
            init_db()
        except Exception as e:  # don't let a DB hiccup crash app startup
            log.warning("init_db_skipped", extra={"extra_fields": {"error": str(e)}})
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
            log.warning("demo_seed_skipped", extra={"extra_fields": {"error": str(e)}})
    yield


app = FastAPI(title="Effort Tracker", version="1.0.0", lifespan=lifespan)

# Same-origin by default (SPA served by this app) → no CORS middleware. Only enable
# it, with an explicit origin allow-list and no wildcard methods/headers, if a
# cross-origin client is configured via CORS_ORIGINS.
_cors_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-Requested-With"],
    )

# CSRF mitigation: require a custom header on state-changing API calls. A cross-site
# HTML form / simple request cannot set a custom header without a CORS preflight
# (which we don't allow from other origins), so this blocks forged writes while the
# same-origin SPA always sends it (see api.js).
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@app.middleware("http")
async def require_csrf_header(request, call_next):
    if request.method not in _SAFE_METHODS and request.url.path.startswith("/api/"):
        if not request.headers.get("X-Requested-With"):
            from fastapi.responses import JSONResponse
            log.warning("csrf_blocked", extra={"extra_fields": {
                "event": "csrf_blocked", "method": request.method, "path": request.url.path}})
            return JSONResponse(status_code=403, content={"detail": "Missing X-Requested-With header."})
    return await call_next(request)

# Content-Security-Policy tuned for the self-hosted Vite bundle: all scripts/styles
# load from same-origin /assets; 'unsafe-inline' for styles covers React inline
# styles and chart-library injected styles; images allow data: for the inlined logo.
_CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "font-src 'self' data:; "
    "connect-src 'self'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)


@app.middleware("http")
async def security_headers(request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("Content-Security-Policy", _CSP)
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    # Honored only over HTTPS (Databricks Apps); ignored on local http.
    resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return resp

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

    _DIST_RESOLVED = _DIST.resolve()

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        if full_path:
            candidate = (_DIST / full_path).resolve()
            # Serve a real file only if it stays inside dist/ — never follow ../ or
            # encoded traversal out of the build directory (path-traversal guard).
            if candidate.is_file() and candidate.is_relative_to(_DIST_RESOLVED):
                return FileResponse(candidate)
        # index.html must never be cached, or browsers keep serving an old bundle
        # (the hashed /assets files are safe to cache forever).
        return FileResponse(_DIST / "index.html", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
