"""Shared FastAPI dependencies: identity + role-based authorization.

Roles
-----
- **lead**: full edit (enhancements CRUD, team management) — like today.
- **member**: on the team (SSO email matches an active resource); may edit
  Timesheet + Board only (log time, move cards / set status, add comments).
- **viewer**: everyone else — signed in but not on the team. Read-only.

Role resolution (by the SSO email):
- in ADMIN_EMAILS (bootstrap admins) → lead
- the local dev identity → lead (dev convenience)
- matches an active resource flagged is_lead → lead
- matches any other active resource → member
- otherwise (not on the team) → viewer
"""
from __future__ import annotations

import os

from fastapi import Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import Resource, get_db
from .logging_config import get_logger

_log = get_logger("effort_tracker.auth")

# Identity used when no SSO header is present (local dev). Override with APP_DEV_EMAIL
# to act as a real person locally (e.g. to see the timesheet default to your own row).
DEV_USER = os.getenv("APP_DEV_EMAIL", "local-dev@example.com")


def current_user(request: Request) -> str:
    """Resolve the acting user from Databricks SSO forwarded headers.

    SECURITY: these X-Forwarded-* headers are trusted implicitly. That is safe ONLY
    because the app runs behind the Databricks Apps auth proxy, which sets them and
    strips any client-supplied copies. Never expose this service without that proxy —
    a direct caller could spoof the header and impersonate anyone.
    """
    for header in ("X-Forwarded-Email", "X-Forwarded-Preferred-Username", "X-Forwarded-User"):
        val = request.headers.get(header)
        if val:
            return val
    return DEV_USER


def _admin_emails() -> set[str]:
    raw = get_settings().admin_emails or ""
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def _is_local() -> bool:
    """True only when running against the local SQLite fallback (no real SSO proxy)."""
    return get_settings().resolve_url().startswith("sqlite")


def current_role(request: Request, db: Session = Depends(get_db)) -> str:
    email = current_user(request).lower()
    if email in _admin_emails():
        return "lead"
    # The dev identity is trusted (→ lead) ONLY locally. In a deployed (Postgres)
    # environment a missing/placeholder SSO header must fail closed to read-only,
    # never silently grant admin.
    if email == DEV_USER:
        return "lead" if _is_local() else "viewer"
    res = db.execute(
        select(Resource.is_lead).where(
            Resource.active.is_(True),
            func.lower(Resource.email) == email,
        ).limit(1)
    ).first()
    if res is None:
        return "viewer"          # not on the team → read-only
    return "lead" if res[0] else "member"


def _deny(user: str, role: str, need: str) -> None:
    _log.warning("authz_denied", extra={"extra_fields": {
        "event": "authz_denied", "user": user, "role": role, "need": need}})


def require_lead(user: str = Depends(current_user), role: str = Depends(current_role)) -> str:
    if role != "lead":
        _deny(user, role, "lead")
        raise HTTPException(403, "Only leads can edit this. Team members can still log time and update the board.")
    return role


def require_member(user: str = Depends(current_user), role: str = Depends(current_role)) -> str:
    """Board / Timesheet edits: must be on the team (lead or member)."""
    if role not in ("lead", "member"):
        _deny(user, role, "member")
        raise HTTPException(403, "Read-only access. Only people on the team can edit the board and timesheets.")
    return role
