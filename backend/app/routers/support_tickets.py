"""Support tickets — a standalone task tracker (own tables, references only resources).

Rules:
- Only leads can create / edit full details.
- Team members can change status, add comments, and close (archive) tickets.
- Statuses: In Queue, In Progress, Hold, Completed.
- Comment history keeps who added each note and when.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..db import Resource, SupportComment, SupportTicket, get_db
from ..deps import current_role, current_user, require_lead, require_member
from ..schemas import (
    SupportCommentIn,
    SupportCommentOut,
    SupportTicketCreate,
    SupportTicketOut,
    SupportTicketUpdate,
)

router = APIRouter(prefix="/api/support-tickets", tags=["support"])

STATUSES = ["In Queue", "In Progress", "Hold", "Completed", "Cancelled"]


def _res_objects(db: Session, ids: list[int]) -> list[Resource]:
    if not ids:
        return []
    return db.scalars(select(Resource).where(Resource.id.in_(ids))).all()


def _next_number(db: Session) -> str:
    """Next TASK###### number (max existing + 1)."""
    mx = 0
    for (num,) in db.execute(select(SupportTicket.number)).all():
        m = re.fullmatch(r"TASK(\d+)", (num or "").strip(), re.I)
        if m:
            mx = max(mx, int(m.group(1)))
    return f"TASK{mx + 1:06d}"


def _to_out(t: SupportTicket) -> SupportTicketOut:
    return SupportTicketOut(
        id=t.id, number=t.number, description=t.description, status=t.status,
        lead_resource_id=t.lead_resource_id, lead_name=t.lead.name if t.lead else None,
        resource_ids=[r.id for r in t.resources],
        resources=[{"id": r.id, "name": r.name} for r in t.resources],
        comments=[SupportCommentOut.model_validate(c) for c in t.comments],
        eta=t.eta, active=t.active, created_by=t.created_by, created_at=t.created_at, updated_at=t.updated_at,
    )


@router.get("", response_model=list[SupportTicketOut])
def list_tickets(active_only: bool = True, db: Session = Depends(get_db)):
    stmt = select(SupportTicket).order_by(SupportTicket.updated_at.desc())
    if active_only:
        stmt = stmt.where(SupportTicket.active.is_(True))
    return [_to_out(t) for t in db.scalars(stmt).all()]


@router.get("/{tid}", response_model=SupportTicketOut)
def get_ticket(tid: int, db: Session = Depends(get_db)):
    t = db.get(SupportTicket, tid)
    if not t:
        raise HTTPException(404, "ticket not found")
    return _to_out(t)


@router.post("", response_model=SupportTicketOut, status_code=201)
def create_ticket(body: SupportTicketCreate, db: Session = Depends(get_db),
                  user: str = Depends(current_user), _: str = Depends(require_lead)):
    if body.status and body.status not in STATUSES:
        raise HTTPException(400, f"status must be one of {STATUSES}")
    number = (body.number or "").strip() or _next_number(db)
    if db.scalar(select(SupportTicket).where(SupportTicket.number == number)):
        raise HTTPException(409, f"ticket {number} already exists")
    t = SupportTicket(number=number, description=body.description, status=body.status or "In Queue",
                      lead_resource_id=body.lead_resource_id, eta=body.eta, active=body.active, created_by=user)
    t.resources = _res_objects(db, body.resource_ids)
    db.add(t)
    db.flush()
    audit.log_create(db, user, "support_ticket", t.id, {"number": number, "status": t.status}, label=number)
    db.commit()
    db.refresh(t)
    return _to_out(t)


@router.put("/{tid}", response_model=SupportTicketOut)
def update_ticket(tid: int, body: SupportTicketUpdate, db: Session = Depends(get_db),
                  user: str = Depends(current_user), role: str = Depends(current_role)):
    t = db.get(SupportTicket, tid)
    if not t:
        raise HTTPException(404, "ticket not found")
    changes = body.model_dump(exclude_unset=True)
    if role == "viewer":
        raise HTTPException(403, "Read-only access.")
    # Members may only change status and close/reopen (active); leads edit everything.
    if role != "lead":
        extra = set(changes) - {"status", "active"}
        if extra:
            raise HTTPException(403, f"Only leads can edit {', '.join(sorted(extra))}.")
    if "status" in changes and changes["status"] not in STATUSES:
        raise HTTPException(400, f"status must be one of {STATUSES}")
    # A ticket can only be closed once it reaches a terminal status.
    resulting_status = changes.get("status", t.status)
    resulting_active = changes.get("active", t.active)
    if resulting_active is False and resulting_status not in ("Completed", "Cancelled"):
        raise HTTPException(400, "Set status to Completed or Cancelled before closing the ticket.")

    new_res = changes.pop("resource_ids", None)
    before = {k: getattr(t, k) for k in changes}
    # Record status / close-reopen as activity entries shown in the card timeline.
    activity: list[tuple[str, str]] = []
    if "status" in changes and changes["status"] != t.status:
        activity.append(("status", f"Status changed to {changes['status']}"))
    if "active" in changes and changes["active"] != t.active:
        activity.append(("state", "Ticket reopened" if changes["active"] else "Ticket closed"))
    for k, v in changes.items():
        setattr(t, k, v)
    if new_res is not None:
        t.resources = _res_objects(db, new_res)
    for kind, text in activity:
        db.add(SupportComment(ticket_id=t.id, body=text, created_by=user, kind=kind))
    if changes:
        def _disp(field, value):
            if field == "lead_resource_id" and value:
                r = db.get(Resource, value)
                return r.name if r else value
            return value
        db_before = {k: _disp(k, v) for k, v in before.items()}
        db_changes = {k: _disp(k, v) for k, v in changes.items()}
        audit.log_diff(db, user, "support_ticket", t.id, db_before, db_changes, label=t.number)
    db.commit()
    db.refresh(t)
    return _to_out(t)


@router.post("/{tid}/comments", response_model=SupportTicketOut)
def add_comment(tid: int, body: SupportCommentIn, db: Session = Depends(get_db),
                user: str = Depends(current_user), _: str = Depends(require_member)):
    t = db.get(SupportTicket, tid)
    if not t:
        raise HTTPException(404, "ticket not found")
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(400, "comment is empty")
    db.add(SupportComment(ticket_id=t.id, body=text, created_by=user))
    t.updated_at = t.updated_at  # touch
    db.commit()
    db.refresh(t)
    return _to_out(t)
