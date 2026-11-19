"""Read-only audit-log access."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import AuditLog, get_db
from ..deps import require_lead
from ..schemas import AuditOut

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("", response_model=list[AuditOut])
def list_audit(
    entity_type: str | None = None,
    entity_id: int | None = None,
    limit: int = 200,
    db: Session = Depends(get_db),
    _: str = Depends(require_lead),
):
    stmt = select(AuditLog).order_by(AuditLog.changed_at.desc()).limit(min(limit, 1000))
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    return db.scalars(stmt).all()
