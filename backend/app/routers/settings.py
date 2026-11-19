"""Admin settings (leads only): status / sub-status management + timesheet freeze rule.

Statuses and sub-statuses are never deleted (they're referenced by historical records) —
they are "retired" by setting active=false, which hides them from the pickers.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..db import AppSetting, Grp, Status, SubStatus, get_db
from ..deps import current_user, require_lead

router = APIRouter(prefix="/api/settings", tags=["settings"])


# --- key/value helpers (also used by the timesheet router) -----------------
def get_setting(db: Session, key: str, default: str | None = None) -> str | None:
    row = db.get(AppSetting, key)
    return row.value if row is not None and row.value is not None else default


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.get(AppSetting, key)
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))


def freeze_params(db: Session) -> tuple[int, int, list[str], str]:
    """(weekday, hour, locked_months, lock_day). Defaults: Friday 1 PM ET, no month locks,
    lock_day 'last'. locked_months are 'YYYY-MM'; lock_day ('last' or '01'..'28') applies to
    ALL of them — a month is frozen from the 1st through lock_day."""
    try:
        wd = int(get_setting(db, "freeze_weekday", "4") or "4")
    except ValueError:
        wd = 4
    try:
        hr = int(get_setting(db, "freeze_hour", "13") or "13")
    except ValueError:
        hr = 13
    wd = min(6, max(0, wd))
    hr = min(23, max(0, hr))
    raw = get_setting(db, "locked_months", "") or ""
    months = sorted({m.strip() for m in raw.split(",") if m.strip()})
    lock_day = (get_setting(db, "lock_day", "last") or "last").strip()
    return wd, hr, months, lock_day


_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _slug(label: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "_", (label or "").strip()).strip("_")
    return (s or "item")[:40]


# --- read everything the Settings page needs -------------------------------
@router.get("")
def get_all(db: Session = Depends(get_db)):  # readable by everyone; changes stay lead-only
    wd, hr, months, lock_day = freeze_params(db)
    statuses = db.scalars(select(Status).order_by(Status.sort_order, Status.code)).all()
    subs = db.scalars(select(SubStatus).order_by(SubStatus.sort_order, SubStatus.code)).all()
    grps = db.scalars(select(Grp).where(Grp.is_custom.isnot(True)).order_by(Grp.sort_order, Grp.code)).all()
    return {
        "freeze": {"weekday": wd, "hour": hr, "locked_months": months, "lock_day": lock_day},
        "statuses": [{"code": s.code, "label": s.label, "is_terminal": s.is_terminal,
                      "is_inactive": s.is_inactive, "sort_order": s.sort_order, "active": s.active} for s in statuses],
        "sub_statuses": [{"code": s.code, "label": s.label, "sort_order": s.sort_order, "active": s.active} for s in subs],
        "groups": [{"code": g.code, "label": g.label, "sort_order": g.sort_order, "active": g.active} for g in grps],
    }


# --- freeze rule -----------------------------------------------------------
class FreezeIn(BaseModel):
    weekday: int
    hour: int
    locked_months: list[str] = []   # 'YYYY-MM' each
    lock_day: str = "last"          # 'last' or '01'..'28' — common cutoff for all locked months


@router.put("/freeze")
def set_freeze(body: FreezeIn, db: Session = Depends(get_db),
               user: str = Depends(current_user), _: str = Depends(require_lead)):
    if not (0 <= body.weekday <= 6):
        raise HTTPException(400, "weekday must be 0 (Mon) .. 6 (Sun)")
    if not (0 <= body.hour <= 23):
        raise HTTPException(400, "hour must be 0 .. 23")
    months = sorted({m.strip() for m in (body.locked_months or []) if m.strip()})
    for m in months:
        if not _MONTH_RE.match(m):
            raise HTTPException(400, f"locked month '{m}' must be YYYY-MM")
    lock_day = (body.lock_day or "last").strip()
    if lock_day != "last" and not (lock_day.isdigit() and 1 <= int(lock_day) <= 28):
        raise HTTPException(400, "lock_day must be 'last' or 1..28")
    if lock_day != "last":
        lock_day = f"{int(lock_day):02d}"
    set_setting(db, "freeze_weekday", str(body.weekday))
    set_setting(db, "freeze_hour", str(body.hour))
    set_setting(db, "locked_months", ",".join(months))
    set_setting(db, "lock_day", lock_day)
    audit.log_diff(db, user, "setting", None, {"freeze": None},
                   {"freeze": f"weekday={body.weekday} hour={body.hour} lock_day={lock_day} locked={','.join(months) or '—'}"}, label="freeze")
    db.commit()
    return {"ok": True}


# --- statuses --------------------------------------------------------------
class StatusIn(BaseModel):
    code: str | None = Field(default=None, max_length=64)
    label: str = Field(max_length=100)
    is_terminal: bool = False
    is_inactive: bool = False
    sort_order: int = 100
    active: bool = True


@router.post("/statuses")
def create_status(body: StatusIn, db: Session = Depends(get_db),
                  user: str = Depends(current_user), _: str = Depends(require_lead)):
    if not body.label.strip():
        raise HTTPException(400, "label is required")
    code = (body.code or _slug(body.label)).strip()
    base, n = code, 2
    while db.get(Status, code):
        code, n = f"{base}_{n}", n + 1
    s = Status(code=code, label=body.label.strip(), is_terminal=body.is_terminal,
               is_inactive=body.is_inactive, sort_order=body.sort_order, active=body.active)
    db.add(s)
    audit.log_create(db, user, "status", None, {"code": code, "label": s.label}, label=code)
    db.commit()
    return {"code": s.code, "label": s.label, "is_terminal": s.is_terminal,
            "is_inactive": s.is_inactive, "sort_order": s.sort_order, "active": s.active}


@router.put("/statuses/{code}")
def update_status(code: str, body: StatusIn, db: Session = Depends(get_db),
                  user: str = Depends(current_user), _: str = Depends(require_lead)):
    s = db.get(Status, code)
    if not s:
        raise HTTPException(404, "status not found")
    before = {"label": s.label, "is_terminal": s.is_terminal, "is_inactive": s.is_inactive,
              "sort_order": s.sort_order, "active": s.active}
    s.label = body.label.strip() or s.label
    s.is_terminal = body.is_terminal
    s.is_inactive = body.is_inactive
    s.sort_order = body.sort_order
    s.active = body.active
    after = {"label": s.label, "is_terminal": s.is_terminal, "is_inactive": s.is_inactive,
             "sort_order": s.sort_order, "active": s.active}
    audit.log_diff(db, user, "status", None, before, after, label=code)
    db.commit()
    return {"code": s.code, "label": s.label, "is_terminal": s.is_terminal,
            "is_inactive": s.is_inactive, "sort_order": s.sort_order, "active": s.active}


# --- sub-statuses ----------------------------------------------------------
class SubStatusIn(BaseModel):
    code: str | None = Field(default=None, max_length=64)
    label: str = Field(max_length=100)
    sort_order: int = 100
    active: bool = True


@router.post("/sub-statuses")
def create_sub_status(body: SubStatusIn, db: Session = Depends(get_db),
                      user: str = Depends(current_user), _: str = Depends(require_lead)):
    if not body.label.strip():
        raise HTTPException(400, "label is required")
    code = (body.code or _slug(body.label)).strip()
    base, n = code, 2
    while db.get(SubStatus, code):
        code, n = f"{base}_{n}", n + 1
    s = SubStatus(code=code, label=body.label.strip(), sort_order=body.sort_order, active=body.active)
    db.add(s)
    audit.log_create(db, user, "sub_status", None, {"code": code, "label": s.label}, label=code)
    db.commit()
    return {"code": s.code, "label": s.label, "sort_order": s.sort_order, "active": s.active}


@router.put("/sub-statuses/{code}")
def update_sub_status(code: str, body: SubStatusIn, db: Session = Depends(get_db),
                      user: str = Depends(current_user), _: str = Depends(require_lead)):
    s = db.get(SubStatus, code)
    if not s:
        raise HTTPException(404, "sub-status not found")
    before = {"label": s.label, "sort_order": s.sort_order, "active": s.active}
    s.label = body.label.strip() or s.label
    s.sort_order = body.sort_order
    s.active = body.active
    audit.log_diff(db, user, "sub_status", None, before,
                   {"label": s.label, "sort_order": s.sort_order, "active": s.active}, label=code)
    db.commit()
    return {"code": s.code, "label": s.label, "sort_order": s.sort_order, "active": s.active}


# --- groups (global; retire instead of delete to keep history) -------------
@router.post("/groups")
def create_group(body: SubStatusIn, db: Session = Depends(get_db),
                 user: str = Depends(current_user), _: str = Depends(require_lead)):
    if not body.label.strip():
        raise HTTPException(400, "label is required")
    code = (body.code or _slug(body.label)).strip()
    base, n = code, 2
    while db.get(Grp, code):
        code, n = f"{base}_{n}", n + 1
    g = Grp(code=code, label=body.label.strip(), sort_order=body.sort_order, active=body.active, is_custom=False)
    db.add(g)
    audit.log_create(db, user, "group", None, {"code": code, "label": g.label}, label=code)
    db.commit()
    return {"code": g.code, "label": g.label, "sort_order": g.sort_order, "active": g.active}


@router.put("/groups/{code}")
def update_group(code: str, body: SubStatusIn, db: Session = Depends(get_db),
                 user: str = Depends(current_user), _: str = Depends(require_lead)):
    g = db.get(Grp, code)
    if not g:
        raise HTTPException(404, "group not found")
    before = {"label": g.label, "sort_order": g.sort_order, "active": g.active}
    g.label = body.label.strip() or g.label
    g.sort_order = body.sort_order
    g.active = body.active
    audit.log_diff(db, user, "group", None, before,
                   {"label": g.label, "sort_order": g.sort_order, "active": g.active}, label=code)
    db.commit()
    return {"code": g.code, "label": g.label, "sort_order": g.sort_order, "active": g.active}
