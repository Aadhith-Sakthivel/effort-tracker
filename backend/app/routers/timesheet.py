"""Timesheet grid — editable calendar of hours per enhancement per day.

A proper, normalized replacement for the Excel daily grid: the GET builds the
cross-tab on the fly from `effort` rows, and the cell PUT upserts a single row.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit
from ..db import Effort, Enhancement, Grp, Resource, Status, get_db
from ..deps import current_user, require_member
from ..tz import editable_from, est_today, month_bounds
from .settings import freeze_params

router = APIRouter(prefix="/api/timesheet", tags=["timesheet"])

DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _weekly_from(db) -> "date":
    """Earliest editable date from the weekly rolling rule (lead-configured day/time)."""
    wd, hr, _, _ = freeze_params(db)
    return editable_from(wd, hr)


def _month_frozen(months, lock_day, work_date) -> bool:
    """A locked month freezes the 1st through lock_day ('last' = whole month). lock_day is
    the common cutoff for every locked month."""
    if work_date.strftime("%Y-%m") not in months:
        return False
    return lock_day == "last" or (lock_day.isdigit() and work_date.day <= int(lock_day))


def _is_frozen(db, work_date) -> bool:
    """A date is frozen if it's before the weekly cutoff OR inside a locked month window."""
    wd, hr, months, lock_day = freeze_params(db)
    return work_date < editable_from(wd, hr) or _month_frozen(months, lock_day, work_date)


@router.get("")
def grid(
    date_from: date | None = None,
    date_to: date | None = None,
    resource_id: int | None = None,
    assignee_id: int | None = None,   # filter ROWS to tickets this person is assigned to
    grp_code: str | None = None,
    status_code: str | None = None,   # filter ROWS to tickets in this status
    q: str | None = None,
    include_empty: bool = True,
    active_only: bool = True,
    db: Session = Depends(get_db),
):
    # Default to the current month in US Eastern time.
    if not date_from and not date_to:
        date_from, date_to = month_bounds(est_today())
    elif not date_to:
        date_to = month_bounds(date_from)[1]
    elif not date_from:
        date_from = month_bounds(date_to)[0]
    if date_from > date_to:
        date_from, date_to = date_to, date_from

    # Day columns.
    days = []
    d = date_from
    while d <= date_to:
        days.append({"date": d.isoformat(), "dow": DOW[d.weekday()], "dom": d.day,
                     "weekend": d.weekday() >= 5, "month": d.strftime("%b")})
        d += timedelta(days=1)

    # Which enhancements to show.
    estmt = select(Enhancement).order_by(Enhancement.ticket)
    if active_only:
        inactive_codes = [s.code for s in db.scalars(select(Status).where(Status.is_inactive.is_(True))).all()]
        estmt = estmt.where(Enhancement.active.is_(True))
        if inactive_codes:
            estmt = estmt.where((Enhancement.status_code.is_(None)) | (Enhancement.status_code.notin_(inactive_codes)))
    if grp_code:
        estmt = estmt.where(Enhancement.groups.any(Grp.code == grp_code))
    if status_code:
        estmt = estmt.where(Enhancement.status_code == status_code)
    if assignee_id:
        estmt = estmt.where(
            (Enhancement.resources.any(Resource.id == assignee_id))
            | (Enhancement.lead_resource_id == assignee_id)
        )
    if q:
        like = f"%{q}%"
        estmt = estmt.where((Enhancement.ticket.ilike(like)) | (Enhancement.title.ilike(like)))
    enh = db.scalars(estmt).all()
    enh_by_id = {e.id: e for e in enh}

    # Effort within the window, aggregated per (enhancement, group, day).
    fstmt = (select(Effort.enhancement_id, Effort.grp_code, Effort.work_date, func.sum(Effort.hours))
             .where(Effort.work_date >= date_from, Effort.work_date <= date_to)
             .group_by(Effort.enhancement_id, Effort.grp_code, Effort.work_date))
    if resource_id:
        fstmt = fstmt.where(Effort.resource_id == resource_id)
    # cells[eid][grp_key][date] = hours ; grp_key "" = ungrouped
    cells: dict[int, dict[str, dict[str, float]]] = {}
    for eid, gcode, wd, hrs in db.execute(fstmt).all():
        if eid in enh_by_id:
            dkey = wd.isoformat() if hasattr(wd, "isoformat") else str(wd)
            cells.setdefault(eid, {}).setdefault(gcode or "", {})[dkey] = float(hrs)

    # Order enhancements (hours first, then ticket), then expand each into one row per
    # group so the per-group rows stay contiguous under the merged (row-spanned) name cell.
    def enh_hours(e):
        return sum(sum(d.values()) for d in cells.get(e.id, {}).values())
    enh_sorted = sorted(enh, key=lambda e: (enh_hours(e) == 0, e.ticket))

    day_totals = {dd["date"]: 0.0 for dd in days}
    rows = []
    for e in enh_sorted:
        ec = cells.get(e.id, {})                       # {grp_key: {date: hrs}}
        if not include_empty and not ec:
            continue
        grp_labels = {g.code: g.label for g in e.groups}
        keys = [g.code for g in e.groups]              # the enhancement's groups, in order
        for k in ec:                                   # plus any stray/ungrouped keys that carry hours
            if k not in keys:
                keys.append(k)
        if not keys:
            keys = [""]
        span = len(keys)
        for i, k in enumerate(keys):
            c = ec.get(k, {})
            total = round(sum(c.values()), 2)
            for dk, v in c.items():
                if dk in day_totals:
                    day_totals[dk] += v
            label = (grp_labels.get(k) or k) if k else ("Ungrouped" if grp_labels else "—")
            rows.append({"enhancement_id": e.id, "ticket": e.ticket, "title": e.title,
                         "grp_code": k or None, "group_label": label,
                         "first": i == 0, "row_span": span,
                         "skills": [s.code for s in e.skills],
                         "lead": e.lead.name if e.lead else None,
                         "resources": [r.name for r in e.resources],
                         "status_code": e.status_code, "cells": c, "total": total})
    day_totals = {k: round(v, 2) for k, v in day_totals.items()}

    return {"days": days, "rows": rows, "day_totals": day_totals,
            "date_from": date_from.isoformat(), "date_to": date_to.isoformat(),
            "today": est_today().isoformat(), "editable_from": _weekly_from(db).isoformat(),
            "locked_months": freeze_params(db)[2], "lock_day": freeze_params(db)[3]}


def _cell_label(db: Session, eid: int, work_date, resource_id: int | None) -> str:
    e = db.get(Enhancement, eid)
    ticket = e.ticket if e else f"enh#{eid}"
    who = ""
    if resource_id:
        r = db.get(Resource, resource_id)
        if r:
            who = f" · {r.name}"
    return f"{ticket} · {work_date}{who}"


PERSON_DAY_CAP = 8  # max hours one person can log in a day


def _headcount(enh: Enhancement) -> int:
    """Distinct people assigned to an enhancement, counting the lead."""
    ids = {r.id for r in enh.resources}
    if enh.lead_resource_id:
        ids.add(enh.lead_resource_id)
    return len(ids)


def _check_cap(enh: Enhancement, resource_id: int | None, total: float) -> None:
    """A specific person: 8h/day. Whole team (no resource): headcount × 8h/day.
    Always enforces a cap (no uncapped path) so absurd values return a clean 400
    instead of overflowing the DB column into a 500."""
    if resource_id is not None:
        if total > PERSON_DAY_CAP:
            raise HTTPException(400, f"A person can't log more than {PERSON_DAY_CAP}h in a day.")
        return
    n = _headcount(enh) or 1          # no assignees → treat as one person
    cap = n * PERSON_DAY_CAP
    if total > cap:
        who = f"{n} people × {PERSON_DAY_CAP}h" if n > 1 else f"{PERSON_DAY_CAP}h"
        raise HTTPException(400, f"Whole-team total can't exceed {cap}h/day ({who}).")


class CellIn(BaseModel):
    enhancement_id: int
    work_date: date
    hours: float = Field(ge=0)   # per-person 24h cap enforced in the handler
    resource_id: int | None = None
    skill_code: str | None = None
    note: str | None = None


@router.put("/cell")
def set_cell(body: CellIn, db: Session = Depends(get_db), user: str = Depends(current_user),
             _: str = Depends(require_member)):
    enh = db.get(Enhancement, body.enhancement_id)
    if not enh:
        raise HTTPException(404, "enhancement not found")
    if _is_frozen(db, body.work_date):
        raise HTTPException(403, "This week is locked — timesheets freeze Friday 1 PM ET.")
    _check_cap(enh, body.resource_id, body.hours)
    label = _cell_label(db, body.enhancement_id, body.work_date, body.resource_id)
    existing = db.scalar(select(Effort).where(
        Effort.enhancement_id == body.enhancement_id,
        Effort.resource_id.is_(body.resource_id) if body.resource_id is None else Effort.resource_id == body.resource_id,
        Effort.skill_code.is_(body.skill_code) if body.skill_code is None else Effort.skill_code == body.skill_code,
        Effort.work_date == body.work_date,
    ))
    if body.hours == 0:
        if existing:
            audit.log_delete(db, user, "effort", existing.id,
                             {"enhancement_id": body.enhancement_id, "work_date": str(body.work_date), "hours": float(existing.hours)},
                             label=label)
            db.delete(existing)
            db.commit()
        return {"ok": True, "hours": 0}
    if existing:
        old = float(existing.hours)
        existing.hours = body.hours
        existing.updated_by = user
        if body.note is not None:
            existing.note = body.note
        audit.log_diff(db, user, "effort", existing.id, {"hours": old}, {"hours": body.hours}, label=label)
    else:
        existing = Effort(enhancement_id=body.enhancement_id, resource_id=body.resource_id,
                          skill_code=body.skill_code, work_date=body.work_date, hours=body.hours,
                          note=body.note, updated_by=user)
        db.add(existing)
        db.flush()
        audit.log_create(db, user, "effort", existing.id,
                         {"enhancement_id": body.enhancement_id, "work_date": str(body.work_date), "hours": body.hours},
                         label=label)
    db.commit()
    return {"ok": True, "hours": body.hours, "id": existing.id}


@router.get("/cell-detail")
def cell_detail(enhancement_id: int, work_date: date, resource_id: int | None = None,
                db: Session = Depends(get_db)):
    """Current per-group hours for one cell (enhancement × date × resource)."""
    stmt = select(Effort.grp_code, Effort.hours, Effort.note).where(
        Effort.enhancement_id == enhancement_id, Effort.work_date == work_date,
        Effort.resource_id.is_(None) if resource_id is None else Effort.resource_id == resource_id,
    )
    rows = db.execute(stmt).all()
    return {"items": [{"grp_code": g, "hours": float(h), "note": n} for g, h, n in rows]}


class CellGroupIn(BaseModel):
    enhancement_id: int
    work_date: date
    grp_code: str | None = None
    resource_id: int | None = None
    hours: float = Field(ge=0)
    note: str | None = None


@router.put("/cell-group")
def set_cell_group(body: CellGroupIn, db: Session = Depends(get_db), user: str = Depends(current_user),
                   _: str = Depends(require_member)):
    """Set one group's hours for a cell WITHOUT disturbing sibling groups' rows.
    Used by the per-group timesheet grid (one row per group)."""
    enh = db.get(Enhancement, body.enhancement_id)
    if not enh:
        raise HTTPException(404, "enhancement not found")
    if _is_frozen(db, body.work_date):
        raise HTTPException(403, "This week is locked — timesheets freeze Friday 1 PM ET.")
    gkey = body.grp_code or None
    # Scope: a per-person edit touches only that person's rows; a whole-team edit (no
    # resource) touches every row for the cell. Day cap counts the other groups in scope.
    scope = [Effort.enhancement_id == body.enhancement_id, Effort.work_date == body.work_date]
    if body.resource_id is not None:
        scope.append(Effort.resource_id == body.resource_id)
    in_scope = db.scalars(select(Effort).where(*scope)).all()
    other = round(sum(float(e.hours) for e in in_scope if (e.grp_code or None) != gkey), 2)
    _check_cap(enh, body.resource_id, round(other + body.hours, 2))

    this_group = [e for e in in_scope if (e.grp_code or None) == gkey]
    old = round(sum(float(e.hours) for e in this_group), 2)
    for e in this_group:
        db.delete(e)
    db.flush()
    if body.hours and body.hours > 0:
        db.add(Effort(enhancement_id=body.enhancement_id, resource_id=body.resource_id,
                      grp_code=gkey, work_date=body.work_date, hours=body.hours, note=body.note, updated_by=user))
    glabel = next((g.label for g in enh.groups if g.code == gkey), gkey or "ungrouped")
    audit.log_diff(db, user, "effort", body.enhancement_id,
                   {"grp_hours": old}, {"grp_hours": body.hours, "grp": glabel},
                   label=_cell_label(db, body.enhancement_id, body.work_date, body.resource_id))
    db.commit()
    return {"ok": True, "hours": body.hours}


class GrpAlloc(BaseModel):
    grp_code: str | None = None
    hours: float = Field(ge=0)   # per-person day cap enforced in the handler


class CellGroupsIn(BaseModel):
    enhancement_id: int
    work_date: date
    resource_id: int | None = None
    note: str | None = None
    allocations: list[GrpAlloc]


@router.put("/cell-groups")
def set_cell_groups(body: CellGroupsIn, db: Session = Depends(get_db), user: str = Depends(current_user),
                    _: str = Depends(require_member)):
    """Replace all effort rows for one cell with the given per-group allocations.

    Used for every timesheet edit: single-group enhancements send one allocation,
    multi-group send several. Replacing all rows avoids double-counting the old
    (group-less) migrated row.
    """
    enh = db.get(Enhancement, body.enhancement_id)
    if not enh:
        raise HTTPException(404, "enhancement not found")
    if _is_frozen(db, body.work_date):
        raise HTTPException(403, "This week is locked — timesheets freeze Friday 1 PM ET.")
    total = round(sum(a.hours for a in body.allocations), 2)
    # Person: 8h/day. Whole team: (assigned people incl. lead) × 8h/day.
    _check_cap(enh, body.resource_id, total)

    # Scope of rows this edit replaces. A per-person edit replaces only that person's
    # rows. A whole-team edit replaces the ENTIRE cell (every row for this
    # enhancement+date, person-attributed or not) so the grid cell always equals the
    # new value — otherwise leftover per-person rows would double-count and reducing
    # the number could paradoxically raise the total / actual.
    conds = [Effort.enhancement_id == body.enhancement_id, Effort.work_date == body.work_date]
    if body.resource_id is not None:
        conds.append(Effort.resource_id == body.resource_id)
    existing = db.scalars(select(Effort).where(*conds)).all()
    old_total = round(sum(float(e.hours) for e in existing), 2)
    for e in existing:
        db.delete(e)
    db.flush()

    for a in body.allocations:
        if a.hours and a.hours > 0:
            db.add(Effort(enhancement_id=body.enhancement_id, resource_id=body.resource_id,
                          grp_code=a.grp_code, work_date=body.work_date, hours=a.hours, note=body.note, updated_by=user))
    parts = ", ".join(f"{a.grp_code or 'unspecified'}:{a.hours}" for a in body.allocations if a.hours)
    audit.log_diff(db, user, "effort", body.enhancement_id,
                   {"day_hours": old_total}, {"day_hours": total, "by_group": parts},
                   label=_cell_label(db, body.enhancement_id, body.work_date, body.resource_id))
    db.commit()
    return {"ok": True, "total": total}
