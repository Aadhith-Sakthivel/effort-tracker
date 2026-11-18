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

# Identity used when no SSO header is present (local dev). Override with APP_DEV_EMAIL
# to act as a real person locally (e.g. to see the timesheet default to your own row).
DEV_USER = os.getenv("APP_DEV_EMAIL", "local-dev@ams")


def current_user(request: Request) -> str:
    """Resolve the acting user from Databricks SSO forwarded headers."""
    for header in ("X-Forwarded-Email", "X-Forwarded-Preferred-Username", "X-Forwarded-User"):
        val = request.headers.get(header)
        if val:
            return val
    return DEV_USER


def _admin_emails() -> set[str]:
    raw = get_settings().admin_emails or ""
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def current_role(request: Request, db: Session = Depends(get_db)) -> str:
    email = current_user(request).lower()
    if email == DEV_USER or email in _admin_emails():
        return "lead"
    res = db.execute(
        select(Resource.is_lead).where(
            Resource.active.is_(True),
            func.lower(Resource.email) == email,
        ).limit(1)
    ).first()
    if res is None:
        return "viewer"          # not on the team → read-only
    return "lead" if res[0] else "member"


def require_lead(role: str = Depends(current_role)) -> str:
    if role != "lead":
        raise HTTPException(403, "Only leads can edit this. Team members can still log time and update the board.")
    return role


def require_member(role: str = Depends(current_role)) -> str:
    """Board / Timesheet edits: must be on the team (lead or member)."""
    if role not in ("lead", "member"):
        raise HTTPException(403, "Read-only access. Only people on the team can edit the board and timesheets.")
    return role
