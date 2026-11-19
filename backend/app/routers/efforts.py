"""Daily effort (time) entry CRUD — replaces the 541-column grid.

Writes require team membership and obey the same freeze + 8h/day cap rules as the
timesheet grid (see timesheet.py). Reads stay open to any signed-in user.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..db import Effort, Enhancement, get_db
from ..deps import current_user, require_member
from ..schemas import EffortCreate, EffortOut, EffortUpdate
from .timesheet import _check_cap, _is_frozen

router = APIRouter(prefix="/api/efforts", tags=["efforts"])

_FROZEN_MSG = "This week is locked — timesheets freeze Friday 1 PM ET."


def _to_out(e: Effort) -> EffortOut:
    return EffortOut(
        id=e.id, enhancement_id=e.enhancement_id, resource_id=e.resource_id,
        skill_code=e.skill_code, work_date=e.work_date, hours=float(e.hours),
        note=e.note, resource_name=e.resource.name if e.resource else None,
    )


def _label(e: Effort) -> str:
    ticket = e.enhancement.ticket if e.enhancement else f"enh#{e.enhancement_id}"
    who = f" · {e.resource.name}" if e.resource else ""
    return f"{ticket} · {e.work_date}{who}"


def _day_cap_check(db: Session, enh: Enhancement, resource_id: int | None, work_date: date,
                   new_hours: float, exclude_id: int | None = None) -> None:
    """Enforce the per-person (8h) / whole-team (headcount × 8h) day cap, counting the
    other rows already logged for the same (enhancement, date, resource) scope."""
    scope = [Effort.enhancement_id == enh.id, Effort.work_date == work_date]
    if resource_id is not None:
        scope.append(Effort.resource_id == resource_id)
    rows = db.scalars(select(Effort).where(*scope)).all()
    other = round(sum(float(e.hours) for e in rows if e.id != exclude_id), 2)
    _check_cap(enh, resource_id, round(other + float(new_hours), 2))


@router.get("", response_model=list[EffortOut])
def list_efforts(
    enhancement_id: int | None = None,
    resource_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
):
    stmt = select(Effort).order_by(Effort.work_date.desc())
    if enhancement_id:
        stmt = stmt.where(Effort.enhancement_id == enhancement_id)
    if resource_id:
        stmt = stmt.where(Effort.resource_id == resource_id)
    if date_from:
        stmt = stmt.where(Effort.work_date >= date_from)
    if date_to:
        stmt = stmt.where(Effort.work_date <= date_to)
    return [_to_out(e) for e in db.scalars(stmt).all()]


@router.post("", response_model=EffortOut, status_code=201)
def create_effort(body: EffortCreate, db: Session = Depends(get_db),
                  user: str = Depends(current_user), _: str = Depends(require_member)):
    enh = db.get(Enhancement, body.enhancement_id)
    if not enh:
        raise HTTPException(404, "enhancement not found")
    if _is_frozen(db, body.work_date):
        raise HTTPException(403, _FROZEN_MSG)
    _day_cap_check(db, enh, body.resource_id, body.work_date, body.hours)
    e = Effort(**body.model_dump())
    db.add(e)
    db.flush()
    db.refresh(e)
    audit.log_create(db, user, "effort", e.id, body.model_dump(mode="json"), label=_label(e))
    db.commit()
    db.refresh(e)
    return _to_out(e)


@router.put("/{fid}", response_model=EffortOut)
def update_effort(fid: int, body: EffortUpdate, db: Session = Depends(get_db),
                  user: str = Depends(current_user), _: str = Depends(require_member)):
    e = db.get(Effort, fid)
    if not e:
        raise HTTPException(404, "effort not found")
    changes = body.model_dump(exclude_unset=True)
    new_date = changes.get("work_date", e.work_date)
    new_hours = changes.get("hours", float(e.hours))
    new_res = changes.get("resource_id", e.resource_id)
    # Can't edit out of or into a frozen window.
    if _is_frozen(db, e.work_date) or _is_frozen(db, new_date):
        raise HTTPException(403, _FROZEN_MSG)
    enh = db.get(Enhancement, e.enhancement_id)
    if enh is not None and new_hours is not None:
        _day_cap_check(db, enh, new_res, new_date, new_hours, exclude_id=e.id)
    before = {k: getattr(e, k) for k in changes}
    before = {k: (float(v) if hasattr(v, "is_finite") else v) for k, v in before.items()}
    for k, v in changes.items():
        setattr(e, k, v)
    audit.log_diff(db, user, "effort", e.id, before,
                   {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in changes.items()},
                   label=_label(e))
    db.commit()
    db.refresh(e)
    return _to_out(e)


@router.delete("/{fid}", status_code=204)
def delete_effort(fid: int, db: Session = Depends(get_db),
                  user: str = Depends(current_user), _: str = Depends(require_member)):
    e = db.get(Effort, fid)
    if not e:
        raise HTTPException(404, "effort not found")
    if _is_frozen(db, e.work_date):
        raise HTTPException(403, _FROZEN_MSG)
    audit.log_delete(db, user, "effort", e.id,
                     {"enhancement_id": e.enhancement_id, "work_date": str(e.work_date), "hours": float(e.hours)},
                     label=_label(e))
    db.delete(e)
    db.commit()
