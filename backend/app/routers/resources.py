"""Resource (team member) CRUD — add, edit, mark inactive, flag leads."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..db import Resource, get_db
from ..deps import current_role, current_user, require_lead
from ..schemas import ResourceCreate, ResourceOut, ResourceUpdate

router = APIRouter(prefix="/api/resources", tags=["resources"])


@router.get("", response_model=list[ResourceOut])
def list_resources(active_only: bool = False, leads_only: bool = False,
                   limit: int = 100, offset: int = 0, db: Session = Depends(get_db)):
    limit = max(1, min(limit, 500))   # bound the page (default 100, hard max 500)
    offset = max(0, offset)
    stmt = select(Resource).order_by(Resource.active.desc(), Resource.name)
    if active_only:
        stmt = stmt.where(Resource.active.is_(True))
    if leads_only:
        stmt = stmt.where(Resource.is_lead.is_(True), Resource.active.is_(True))
    return db.scalars(stmt.limit(limit).offset(offset)).all()


@router.post("", response_model=ResourceOut, status_code=201)
def create_resource(body: ResourceCreate, db: Session = Depends(get_db),
                    user: str = Depends(current_user), _: str = Depends(require_lead)):
    r = Resource(**body.model_dump())
    db.add(r)
    db.flush()
    audit.log_create(db, user, "resource", r.id, body.model_dump(), label=r.name)
    db.commit()
    db.refresh(r)
    return r


@router.put("/{rid}", response_model=ResourceOut)
def update_resource(rid: int, body: ResourceUpdate, db: Session = Depends(get_db),
                    user: str = Depends(current_user), role: str = Depends(current_role)):
    r = db.get(Resource, rid)
    if not r:
        raise HTTPException(404, "resource not found")
    changes = body.model_dump(exclude_unset=True)
    # Leads edit anyone/anything. A team member may edit ONLY their own RACF + cell.
    if role != "lead":
        if role == "viewer":
            raise HTTPException(403, "Read-only access.")
        own = bool(r.email) and bool(user) and r.email.lower() == user.lower()
        if not own:
            raise HTTPException(403, "You can only edit your own contact details.")
        extra = set(changes) - {"racf", "cell"}
        if extra:
            raise HTTPException(403, "You can only edit your own RACF and cell.")
    before = {k: getattr(r, k) for k in changes}
    for k, v in changes.items():
        setattr(r, k, v)
    audit.log_diff(db, user, "resource", r.id, before, changes, label=r.name)
    db.commit()
    db.refresh(r)
    return r
