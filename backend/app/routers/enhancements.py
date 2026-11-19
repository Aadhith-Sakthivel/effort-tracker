"""Enhancement CRUD with computed actual/remaining hours and full audit."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit
from ..db import (
    Effort,
    Enhancement,
    EnhComment,
    EnhGroupState,
    EnhLink,
    Grp,
    Resource,
    SkillCategory,
    Status,
    SubStatus,
    get_db,
)
from ..deps import current_role, current_user, require_lead, require_member
from ..schemas import (
    EnhancementCreate,
    EnhancementOut,
    EnhancementUpdate,
    EnhLinkOut,
    LookupItem,
    ResourceMini,
)

router = APIRouter(prefix="/api/enhancements", tags=["enhancements"])


def _grp_objects(db: Session, codes: list[str]) -> list[Grp]:
    """Return Grp rows for the given codes, auto-skipping unknown ones."""
    if not codes:
        return []
    found = {g.code: g for g in db.scalars(select(Grp).where(Grp.code.in_(codes))).all()}
    return [found[c] for c in codes if c in found]


def _make_custom_groups(db: Session, enh_id: int, labels: list[str]) -> list[Grp]:
    """Create per-enhancement custom Grp rows for new labels and return them.
    They carry is_custom=True + owner_enhancement_id so they stay out of the
    shared group list but are still real grp rows (so effort can reference them)."""
    out: list[Grp] = []
    for lab in labels or []:
        lab = (lab or "").strip()
        if not lab:
            continue
        g = Grp(code="cg_" + uuid.uuid4().hex[:12], label=lab, sort_order=500,
                active=True, is_custom=True, owner_enhancement_id=enh_id)
        db.add(g)
        out.append(g)
    if out:
        db.flush()
    return out


def _status_label(db: Session, code: str | None) -> str:
    if not code:
        return "—"
    s = db.get(Status, code)
    return s.label if s else code


def _substatus_label(db: Session, code: str | None) -> str:
    if not code:
        return "—"
    s = db.get(SubStatus, code)
    return s.label if s else code


def _grp_label(db: Session, code: str | None) -> str:
    if not code:
        return "—"
    g = db.get(Grp, code)
    return g.label if g else code


def _audit_display(db: Session, field: str, value):
    """Translate code-valued fields to human labels for the audit log (so it never
    shows status/sub-status/group codes or a bare resource id)."""
    if value is None or value == "":
        return value
    if field == "status_code":
        return _status_label(db, value)
    if field in ("sub_status_code",):
        return _substatus_label(db, value)
    if field == "grp_code":
        return _grp_label(db, value)
    if field == "lead_resource_id":
        r = db.get(Resource, value)
        return r.name if r else value
    return value


def _res_objects(db: Session, ids: list[int]) -> list[Resource]:
    if not ids:
        return []
    found = {r.id: r for r in db.scalars(select(Resource).where(Resource.id.in_(ids))).all()}
    return [found[i] for i in ids if i in found]


def _skill_objects(db: Session, codes: list[str]) -> list[SkillCategory]:
    if not codes:
        return []
    found = {s.code: s for s in db.scalars(select(SkillCategory).where(SkillCategory.code.in_(codes))).all()}
    return [found[c] for c in codes if c in found]


def _to_out(e: Enhancement, actual: float, latest_note: tuple | None = None) -> EnhancementOut:
    approved = float(e.approved_hrs or 0)
    group_codes = [g.code for g in e.groups]

    # Latest comment = newer of the enhancement's comment vs. a timesheet note.
    cands = []
    if e.comments and e.comments.strip():
        cands.append(("comment", e.comments.strip(), e.updated_at))
    if latest_note and latest_note[0]:
        cands.append(("timesheet", latest_note[0], latest_note[1]))
    cands = [c for c in cands if c[2] is not None]
    best = max(cands, key=lambda c: c[2]) if cands else None

    custom_items = [LookupItem(code=g.code, label=g.label) for g in e.groups if getattr(g, "is_custom", False)]

    return EnhancementOut(
        id=e.id, ticket=e.ticket, grp_code=e.grp_code, groups=group_codes,
        custom_group_items=custom_items,
        links=[EnhLinkOut(id=ln.id, name=ln.name, url=ln.url) for ln in e.links],
        demand_number=e.demand_number,
        resource_ids=[r.id for r in e.resources],
        resources=[ResourceMini(id=r.id, name=r.name) for r in e.resources],
        skill_codes=[s.code for s in e.skills],
        title=e.title, status_code=e.status_code, sub_status_code=e.sub_status_code,
        lead_resource_id=e.lead_resource_id, smoc_lead=e.smoc_lead,
        initial_estimated_hrs=float(e.initial_estimated_hrs) if e.initial_estimated_hrs is not None else None,
        approved_hrs=float(e.approved_hrs) if e.approved_hrs is not None else None,
        comments=e.comments, doc_url=e.doc_url, change_ticket=e.change_ticket, eta=e.eta, active=e.active,
        actual_hrs=round(actual, 2), remaining_hrs=round(approved - actual, 2),
        lead_name=e.lead.name if e.lead else None,
        latest_comment=best[1] if best else None,
        latest_comment_at=best[2] if best else None,
        latest_comment_src=best[0] if best else None,
        updated_at=e.updated_at,
    )


def _latest_note_map(db: Session, ids: list[int]) -> dict[int, tuple]:
    """Most recent user-entered timesheet note per enhancement (excludes the
    'migrated from Excel' placeholder)."""
    if not ids:
        return {}
    rows = db.execute(
        select(Effort.enhancement_id, Effort.note, func.coalesce(Effort.updated_at, Effort.created_at))
        .where(Effort.enhancement_id.in_(ids), Effort.note.isnot(None), Effort.note != "",
               Effort.note != "migrated from Excel")
    ).all()
    out: dict[int, tuple] = {}
    for eid, note, ts in rows:
        if eid not in out or (ts and out[eid][1] and ts > out[eid][1]):
            out[eid] = (note, ts)
    return out


def _actual_map(db: Session, ids: list[int]) -> dict[int, float]:
    if not ids:
        return {}
    rows = db.execute(
        select(Effort.enhancement_id, func.coalesce(func.sum(Effort.hours), 0))
        .where(Effort.enhancement_id.in_(ids))
        .group_by(Effort.enhancement_id)
    ).all()
    return {eid: float(total) for eid, total in rows}


@router.get("", response_model=list[EnhancementOut])
def list_enhancements(
    status_code: str | None = None,
    grp_code: str | None = None,
    q: str | None = None,
    active_only: bool = True,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    limit = max(1, min(limit, 500))   # bound the page (default 100, hard max 500)
    offset = max(0, offset)
    stmt = select(Enhancement).order_by(Enhancement.updated_at.desc())
    if active_only:
        inactive_codes = [s.code for s in db.scalars(select(Status).where(Status.is_inactive.is_(True))).all()]
        stmt = stmt.where(Enhancement.active.is_(True))
        if inactive_codes:
            stmt = stmt.where((Enhancement.status_code.is_(None)) | (Enhancement.status_code.notin_(inactive_codes)))
    if status_code:
        stmt = stmt.where(Enhancement.status_code == status_code)
    if grp_code:
        stmt = stmt.where(Enhancement.groups.any(Grp.code == grp_code))
    if q:
        like = f"%{q}%"
        stmt = stmt.where((Enhancement.ticket.ilike(like)) | (Enhancement.title.ilike(like)))
    stmt = stmt.limit(limit).offset(offset)
    rows = db.scalars(stmt).all()
    ids = [e.id for e in rows]
    actuals = _actual_map(db, ids)
    notes = _latest_note_map(db, ids)
    return [_to_out(e, actuals.get(e.id, 0.0), notes.get(e.id)) for e in rows]


@router.get("/{eid}", response_model=EnhancementOut)
def get_enhancement(eid: int, db: Session = Depends(get_db)):
    e = db.get(Enhancement, eid)
    if not e:
        raise HTTPException(404, "enhancement not found")
    return _to_out(e, _actual_map(db, [e.id]).get(e.id, 0.0), _latest_note_map(db, [e.id]).get(e.id))


@router.post("", response_model=EnhancementOut, status_code=201)
def create_enhancement(body: EnhancementCreate, db: Session = Depends(get_db),
                       user: str = Depends(current_user), _: str = Depends(require_lead)):
    if db.scalar(select(Enhancement).where(Enhancement.ticket == body.ticket)):
        raise HTTPException(409, f"ticket {body.ticket} already exists")
    data = body.model_dump()
    codes = data.pop("groups", []) or []
    custom_labels = data.pop("custom_groups", []) or []
    res_ids = data.pop("resource_ids", []) or []
    skill_codes = data.pop("skill_codes", []) or []
    if not data.get("grp_code") and codes:
        data["grp_code"] = codes[0]        # primary group = first selected
    e = Enhancement(**data)
    e.groups = _grp_objects(db, codes)
    e.resources = _res_objects(db, res_ids)
    e.skills = _skill_objects(db, skill_codes)
    db.add(e)
    db.flush()
    if custom_labels:
        e.groups = list(e.groups) + _make_custom_groups(db, e.id, custom_labels)
    audit.log_create(db, user, "enhancement", e.id, body.model_dump(), label=e.ticket)
    db.commit()
    db.refresh(e)
    return _to_out(e, 0.0)


@router.put("/{eid}", response_model=EnhancementOut)
def update_enhancement(eid: int, body: EnhancementUpdate, db: Session = Depends(get_db),
                       user: str = Depends(current_user), role: str = Depends(current_role)):
    e = db.get(Enhancement, eid)
    if not e:
        raise HTTPException(404, "enhancement not found")
    changes = body.model_dump(exclude_unset=True)
    if role == "viewer":
        raise HTTPException(403, "Read-only access. Only people on the team can update the board.")
    # Members (non-leads) may only change status/sub-status/comments/doc link (board card).
    if role != "lead":
        allowed = {"status_code", "sub_status_code", "comments", "doc_url", "change_ticket"}
        extra = set(changes) - allowed
        if extra:
            raise HTTPException(403, f"Only leads can edit {', '.join(sorted(extra))}. You can change status and comments.")
    new_codes = changes.pop("groups", None)
    new_custom = changes.pop("custom_groups", None)
    new_res = changes.pop("resource_ids", None)
    new_skills = changes.pop("skill_codes", None)
    before = {k: getattr(e, k) for k in changes}
    # Numeric fields come back as Decimal from the DB; normalize for clean diffs.
    before = {k: (float(v) if hasattr(v, "is_finite") else v) for k, v in before.items()}
    for k, v in changes.items():
        setattr(e, k, v)
    # Overall status / sub-status changes → status entries broadcast to every group tab's thread.
    if "status_code" in changes and before.get("status_code") != changes["status_code"]:
        db.add(EnhComment(enhancement_id=e.id, grp_code=None, kind="status",
                          body=f"Card status → {_status_label(db, changes['status_code'])}", created_by=user))
    if "sub_status_code" in changes and before.get("sub_status_code") != changes["sub_status_code"]:
        db.add(EnhComment(enhancement_id=e.id, grp_code=None, kind="status",
                          body=f"Card sub-status → {_substatus_label(db, changes['sub_status_code'])}", created_by=user))
    if new_codes is not None:
        old_labels = [g.label for g in e.groups]        # capture labels before reassigning
        # new_codes may include existing custom-group codes — they are real grp rows,
        # so _grp_objects resolves both global and custom. Deselected ones drop off.
        e.groups = _grp_objects(db, new_codes)
        e.grp_code = new_codes[0] if new_codes else None
        new_labels = [g.label for g in e.groups]
        audit.log_diff(db, user, "enhancement", e.id,
                       {"groups": ", ".join(old_labels)}, {"groups": ", ".join(new_labels)}, label=e.ticket)
    if new_custom:
        e.groups = list(e.groups) + _make_custom_groups(db, e.id, new_custom)
    if new_res is not None:
        old_names = ", ".join(r.name for r in e.resources)
        e.resources = _res_objects(db, new_res)
        new_names = ", ".join(r.name for r in e.resources)
        audit.log_diff(db, user, "enhancement", e.id, {"resources": old_names}, {"resources": new_names}, label=e.ticket)
    if new_skills is not None:
        old_sk = ", ".join(s.label for s in e.skills)
        e.skills = _skill_objects(db, new_skills)
        audit.log_diff(db, user, "enhancement", e.id, {"skills": old_sk}, {"skills": ", ".join(s.label for s in e.skills)}, label=e.ticket)
    disp_before = {k: _audit_display(db, k, v) for k, v in before.items()}
    disp_changes = {k: _audit_display(db, k, v) for k, v in changes.items()}
    audit.log_diff(db, user, "enhancement", e.id, disp_before, disp_changes, label=e.ticket)
    db.commit()
    db.refresh(e)
    return _to_out(e, _actual_map(db, [e.id]).get(e.id, 0.0), _latest_note_map(db, [e.id]).get(e.id))


@router.delete("/{eid}", status_code=204)
def delete_enhancement(eid: int, db: Session = Depends(get_db),
                       user: str = Depends(current_user), _: str = Depends(require_lead)):
    e = db.get(Enhancement, eid)
    if not e:
        raise HTTPException(404, "enhancement not found")
    audit.log_delete(db, user, "enhancement", e.id, {"ticket": e.ticket, "title": e.title}, label=e.ticket)
    db.delete(e)
    db.flush()   # cascade efforts + group links first, so the custom groups are unreferenced
    for g in db.scalars(select(Grp).where(Grp.is_custom.is_(True), Grp.owner_enhancement_id == eid)).all():
        db.delete(g)
    db.commit()


# --- Per-group tabs: each group's own sub-status + comment thread -----------
def _group_detail(db: Session, e: Enhancement) -> dict:
    """Build one tab per group: the group's sub-status plus a merged, newest-first
    thread of (card-level comments + that group's comments + that group's timesheet
    notes). Card-level comments (grp_code NULL) appear under every group."""
    states = {s.grp_code: s.sub_status_code
              for s in db.scalars(select(EnhGroupState).where(EnhGroupState.enhancement_id == e.id)).all()}
    comments = db.scalars(select(EnhComment).where(EnhComment.enhancement_id == e.id)).all()
    eff = db.execute(
        select(Effort.grp_code, Effort.note, Effort.work_date, Effort.hours, Resource.name,
               Effort.updated_by, func.coalesce(Effort.updated_at, Effort.created_at))
        .join(Resource, Effort.resource_id == Resource.id, isouter=True)
        .where(Effort.enhancement_id == e.id, Effort.note.isnot(None),
               Effort.note != "", Effort.note != "migrated from Excel")
    ).all()

    groups = []
    for g in e.groups:
        thread = []
        for c in comments:
            if c.grp_code is None or c.grp_code == g.code:
                src = "status" if getattr(c, "kind", "comment") == "status" else ("card" if c.grp_code is None else "group")
                ts = c.created_at.isoformat() if c.created_at else None
                thread.append({"body": c.body, "who": c.created_by, "ts": ts, "sort_ts": ts, "source": src})
        for grp_code, note, wd, hrs, rname, upby, logged_at in eff:
            if grp_code == g.code:
                thread.append({"body": note, "who": upby or rname,
                               "ts": wd.isoformat() if hasattr(wd, "isoformat") else str(wd),
                               "sort_ts": logged_at.isoformat() if logged_at is not None else None,
                               "source": "timesheet", "hours": float(hrs) if hrs is not None else None})
        # Sort by when it actually happened (log time for timesheet notes, not the work date).
        thread.sort(key=lambda x: x.get("sort_ts") or "", reverse=True)
        groups.append({"code": g.code, "label": g.label,
                       "sub_status_code": states.get(g.code), "thread": thread})
    return {"groups": groups}


@router.get("/{eid}/group-detail")
def group_detail(eid: int, db: Session = Depends(get_db)):
    e = db.get(Enhancement, eid)
    if not e:
        raise HTTPException(404, "enhancement not found")
    return _group_detail(db, e)


class EnhCommentIn(BaseModel):
    grp_code: str | None = Field(default=None, max_length=64)   # None = card-level (every group tab)
    body: str = Field(max_length=10000)


@router.post("/{eid}/comment")
def add_group_comment(eid: int, body: EnhCommentIn, db: Session = Depends(get_db),
                      user: str = Depends(current_user), _: str = Depends(require_member)):
    e = db.get(Enhancement, eid)
    if not e:
        raise HTTPException(404, "enhancement not found")
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(400, "comment is empty")
    grp = body.grp_code or None
    if grp and grp not in {g.code for g in e.groups}:
        raise HTTPException(400, "group is not on this enhancement")
    db.add(EnhComment(enhancement_id=eid, grp_code=grp, body=text, created_by=user))
    if grp is None:
        # Card-level: also append to enhancement.comments so the list's "latest comment" keeps working.
        e.comments = (e.comments + "\n" if e.comments else "") + text
        audit.log_diff(db, user, "enhancement", e.id, {"comments": None}, {"comments": text}, label=e.ticket)
    db.commit()
    db.refresh(e)
    return _group_detail(db, e)


class GroupSubStatusIn(BaseModel):
    grp_code: str
    sub_status_code: str | None = None


@router.put("/{eid}/group-substatus")
def set_group_substatus(eid: int, body: GroupSubStatusIn, db: Session = Depends(get_db),
                        user: str = Depends(current_user), _: str = Depends(require_member)):
    e = db.get(Enhancement, eid)
    if not e:
        raise HTTPException(404, "enhancement not found")
    if body.grp_code not in {g.code for g in e.groups}:
        raise HTTPException(400, "group is not on this enhancement")
    st = db.get(EnhGroupState, (eid, body.grp_code))
    changed = (st.sub_status_code if st else None) != (body.sub_status_code or None)
    if st is None:
        st = EnhGroupState(enhancement_id=eid, grp_code=body.grp_code, sub_status_code=body.sub_status_code or None)
        db.add(st)
    else:
        st.sub_status_code = body.sub_status_code or None
    if changed:
        db.add(EnhComment(enhancement_id=eid, grp_code=body.grp_code, kind="status",
                          body=f"Group sub-status → {_substatus_label(db, body.sub_status_code)}", created_by=user))
    glabel = next((g.label for g in e.groups if g.code == body.grp_code), body.grp_code)
    audit.log_diff(db, user, "enhancement", e.id,
                   {f"sub-status ({glabel})": ""}, {f"sub-status ({glabel})": _substatus_label(db, body.sub_status_code)},
                   label=e.ticket)
    db.commit()
    return _group_detail(db, e)


# --- Extra named documentation links ---------------------------------------
class EnhLinkIn(BaseModel):
    name: str = Field(max_length=200)
    url: str = Field(max_length=2000)


@router.post("/{eid}/links", response_model=EnhancementOut)
def add_link(eid: int, body: EnhLinkIn, db: Session = Depends(get_db),
             user: str = Depends(current_user), _: str = Depends(require_member)):
    e = db.get(Enhancement, eid)
    if not e:
        raise HTTPException(404, "enhancement not found")
    name, url = (body.name or "").strip(), (body.url or "").strip()
    if not name or not url:
        raise HTTPException(400, "both a name and a link are required")
    db.add(EnhLink(enhancement_id=eid, name=name, url=url, created_by=user))
    audit.log_diff(db, user, "enhancement", e.id, {"link": None}, {"link": f"{name} → {url}"}, label=e.ticket)
    db.commit()
    db.refresh(e)
    return _to_out(e, _actual_map(db, [e.id]).get(e.id, 0.0), _latest_note_map(db, [e.id]).get(e.id))


@router.delete("/{eid}/links/{lid}", response_model=EnhancementOut)
def delete_link(eid: int, lid: int, db: Session = Depends(get_db),
                user: str = Depends(current_user), _: str = Depends(require_member)):
    e = db.get(Enhancement, eid)
    if not e:
        raise HTTPException(404, "enhancement not found")
    link = db.get(EnhLink, lid)
    if link and link.enhancement_id == eid:
        audit.log_diff(db, user, "enhancement", e.id, {"link": f"{link.name} → {link.url}"}, {"link": None}, label=e.ticket)
        db.delete(link)
        db.commit()
        db.refresh(e)
    return _to_out(e, _actual_map(db, [e.id]).get(e.id, 0.0), _latest_note_map(db, [e.id]).get(e.id))
