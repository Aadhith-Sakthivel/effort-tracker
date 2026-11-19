"""Live dashboard aggregations — replaces the hand-built Monthly/Summary pivots."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import Effort, Enhancement, Grp, Resource, Status, enhancement_group, get_db
from ..schemas import KPI
from ..tz import est_today, month_bounds

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _grp_label_map(db: Session) -> dict[str, str]:
    """Map group code → display label (so custom groups show their name, not cg_…)."""
    return {code: label for code, label in db.execute(select(Grp.code, Grp.label)).all()}


def _grp_name(code: str | None, labels: dict[str, str]) -> str:
    return labels.get(code, code) if code else "Unspecified"


@router.get("/kpi", response_model=KPI)
def kpis(db: Session = Depends(get_db)):
    total = db.scalar(select(func.count(Enhancement.id))) or 0
    terminal = {s.code for s in db.scalars(select(Status).where(Status.is_terminal.is_(True))).all()}
    open_ = db.scalar(
        select(func.count(Enhancement.id)).where(Enhancement.status_code.notin_(terminal or {"__none__"}))
    ) or 0
    actual = db.scalar(select(func.coalesce(func.sum(Effort.hours), 0))) or 0
    approved = db.scalar(select(func.coalesce(func.sum(Enhancement.approved_hrs), 0))) or 0
    return KPI(total_enhancements=total, open_enhancements=open_,
               total_actual_hrs=float(actual), total_approved_hrs=float(approved))


@router.get("/by-status")
def by_status(db: Session = Depends(get_db)):
    rows = db.execute(
        select(Enhancement.status_code, func.count(Enhancement.id))
        .group_by(Enhancement.status_code)
    ).all()
    return [{"status": s or "Unspecified", "count": c} for s, c in rows]


@router.get("/by-group")
def by_group(db: Session = Depends(get_db)):
    # Count each enhancement under every group it belongs to.
    rows = db.execute(
        select(enhancement_group.c.grp_code, func.count(enhancement_group.c.enhancement_id),
               func.coalesce(func.sum(Enhancement.approved_hrs), 0))
        .join(Enhancement, Enhancement.id == enhancement_group.c.enhancement_id)
        .group_by(enhancement_group.c.grp_code)
    ).all()
    labels = _grp_label_map(db)
    return [{"grp": _grp_name(g, labels), "count": c, "approved_hrs": float(h)} for g, c, h in rows]


@router.get("/hours-by-month")
def hours_by_month(db: Session = Depends(get_db)):
    # strftime works on SQLite; Postgres uses to_char. Do it in Python for portability.
    rows = db.execute(select(Effort.work_date, Effort.hours)).all()
    buckets: dict[str, float] = {}
    for d, h in rows:
        key = f"{d.year:04d}-{d.month:02d}"
        buckets[key] = buckets.get(key, 0.0) + float(h)
    return [{"month": k, "hours": round(v, 2)} for k, v in sorted(buckets.items())]


@router.get("/hours-by-resource")
def hours_by_resource(db: Session = Depends(get_db)):
    rows = db.execute(
        select(Resource.name, func.coalesce(func.sum(Effort.hours), 0))
        .join(Effort, Effort.resource_id == Resource.id)
        .group_by(Resource.name)
        .order_by(func.coalesce(func.sum(Effort.hours), 0).desc())
    ).all()
    return [{"resource": n, "hours": float(h)} for n, h in rows]


@router.get("/months")
def months(db: Session = Depends(get_db)):
    """Distinct YYYY-MM that have logged effort, newest first (for the picker)."""
    rows = db.execute(select(Effort.work_date)).all()
    found = sorted({f"{d.year:04d}-{d.month:02d}" for (d,) in rows}, reverse=True)
    cur = est_today().strftime("%Y-%m")
    if cur not in found:
        found.insert(0, cur)
    return {"months": found, "current": cur}


@router.get("/month")
def month_summary(month: str | None = None, db: Session = Depends(get_db)):
    """Snapshot for one month: hours, # enhancements worked, and a by-group
    breakdown (for the doughnut). `month` is YYYY-MM; defaults to current EST month."""
    if month and len(month) >= 7:
        y, m = int(month[:4]), int(month[5:7])
    else:
        t = est_today()
        y, m = t.year, t.month
    from datetime import date as _date
    from datetime import timedelta
    start, end = month_bounds(_date(y, m, 1))

    hours = db.scalar(
        select(func.coalesce(func.sum(Effort.hours), 0))
        .where(Effort.work_date >= start, Effort.work_date <= end)
    ) or 0
    enh_count = db.scalar(
        select(func.count(func.distinct(Effort.enhancement_id)))
        .where(Effort.work_date >= start, Effort.work_date <= end)
    ) or 0
    rows = db.execute(
        select(enhancement_group.c.grp_code, func.count(func.distinct(Effort.enhancement_id)))
        .join(Effort, Effort.enhancement_id == enhancement_group.c.enhancement_id)
        .where(Effort.work_date >= start, Effort.work_date <= end)
        .group_by(enhancement_group.c.grp_code)
    ).all()
    labels = _grp_label_map(db)
    by_group = sorted(
        [{"grp": _grp_name(g, labels), "count": c} for g, c in rows],
        key=lambda x: -x["count"],
    )

    # Hours per day across the month (0-filled so the line is continuous).
    drows = db.execute(
        select(Effort.work_date, func.coalesce(func.sum(Effort.hours), 0))
        .where(Effort.work_date >= start, Effort.work_date <= end)
        .group_by(Effort.work_date)
    ).all()
    hmap = {d.isoformat(): float(h) for d, h in drows}
    by_day = []
    cur = start
    while cur <= end:
        by_day.append({"date": cur.isoformat(), "day": cur.day, "hours": round(hmap.get(cur.isoformat(), 0.0), 2)})
        cur += timedelta(days=1)

    # Hours per enhancement (for the doughnut: slice=hours, label=ticket, hover=title).
    erows = db.execute(
        select(Enhancement.ticket, Enhancement.title, func.coalesce(func.sum(Effort.hours), 0))
        .join(Effort, Effort.enhancement_id == Enhancement.id)
        .where(Effort.work_date >= start, Effort.work_date <= end)
        .group_by(Enhancement.id, Enhancement.ticket, Enhancement.title)
        .order_by(func.coalesce(func.sum(Effort.hours), 0).desc())
    ).all()
    by_enhancement = [{"ticket": t, "title": ti, "hours": round(float(h), 2)} for t, ti, h in erows]

    return {"month": f"{y:04d}-{m:02d}", "hours": float(hours),
            "enhancements": enh_count, "by_group": by_group, "by_day": by_day,
            "by_enhancement": by_enhancement}


@router.get("/hours-by-group")
def hours_by_group(db: Session = Depends(get_db)):
    # Logged hours attributed to each enhancement's primary group (no double count).
    rows = db.execute(
        select(Enhancement.grp_code, func.coalesce(func.sum(Effort.hours), 0))
        .join(Effort, Effort.enhancement_id == Enhancement.id)
        .group_by(Enhancement.grp_code)
        .order_by(func.coalesce(func.sum(Effort.hours), 0).desc())
    ).all()
    labels = _grp_label_map(db)
    return [{"grp": _grp_name(g, labels), "hours": float(h)} for g, h in rows]
