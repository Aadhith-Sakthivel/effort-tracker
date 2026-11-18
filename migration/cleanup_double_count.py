"""Remove per-person effort rows that overlap a team-total (NULL-resource) row on
the same enhancement+date — these double-count into actual_hrs.

Only such overlapping per-person rows are deleted; a per-person row on a cell with
no team-total row is left untouched. Prints each row before deleting and re-checks
after. Runs against whatever the env points at (SQLite locally, or Lakebase via PG*).
"""
from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import func, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.db import Effort, Enhancement, SessionLocal  # noqa: E402


def _overlapping(db):
    null_cells = select(Effort.enhancement_id, Effort.work_date).where(Effort.resource_id.is_(None)).subquery()
    return db.scalars(
        select(Effort).where(Effort.resource_id.is_not(None)).join(
            null_cells,
            (Effort.enhancement_id == null_cells.c.enhancement_id) & (Effort.work_date == null_cells.c.work_date),
        )
    ).all()


def main():
    db = SessionLocal()
    try:
        rows = _overlapping(db)
        print(f"per-person rows overlapping a team-total cell: {len(rows)}")
        for e in rows:
            tk = db.scalar(select(Enhancement.ticket).where(Enhancement.id == e.enhancement_id))
            print(f"  delete: {tk} ({e.enhancement_id}) {e.work_date} resource_id={e.resource_id} hours={float(e.hours)} id={e.id}")
        for e in rows:
            db.delete(e)
        db.commit()
        # Read back.
        remaining = _overlapping(db)
        total = db.scalar(select(func.count()).select_from(Effort)) or 0
        print(f"deleted {len(rows)}. effort rows now: {total}. overlapping cells remaining: {len(remaining)}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
