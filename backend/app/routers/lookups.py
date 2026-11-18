"""Dropdown lookups: grp, status, sub_status, skill_category."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import Grp, SkillCategory, Status, SubStatus, get_db
from ..schemas import LookupItem

router = APIRouter(prefix="/api/lookups", tags=["lookups"])


def _items(db: Session, model) -> list[LookupItem]:
    rows = db.scalars(
        select(model).where(model.active.is_(True)).order_by(model.sort_order, model.code)
    ).all()
    return [LookupItem.model_validate(r) for r in rows]


@router.get("")
def all_lookups(db: Session = Depends(get_db)):
    status_rows = db.scalars(
        select(Status).where(Status.active.is_(True)).order_by(Status.sort_order, Status.code)
    ).all()
    # Custom groups belong to a single enhancement — keep them out of the shared list.
    grp_rows = db.scalars(
        select(Grp).where(Grp.active.is_(True), Grp.is_custom.isnot(True)).order_by(Grp.sort_order, Grp.code)
    ).all()
    return {
        "grp": [LookupItem.model_validate(r) for r in grp_rows],
        # status carries is_inactive so the board can hide terminal columns
        "status": [{"code": s.code, "label": s.label, "is_inactive": s.is_inactive} for s in status_rows],
        "sub_status": _items(db, SubStatus),
        "skill_category": _items(db, SkillCategory),
    }
