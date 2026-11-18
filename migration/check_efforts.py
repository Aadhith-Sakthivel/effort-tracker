"""Read-only sanity check on effort rows (double-count / per-person detection).

Runs against whatever DB the env points at (SQLite locally, or Lakebase via PG*).
Writes nothing.
"""
from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import func, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.db import Effort, Enhancement, SessionLocal  # noqa: E402


def main():
    db = SessionLocal()
    try:
        total = db.scalar(select(func.count()).select_from(Effort)) or 0
        null_rows = db.scalar(select(func.count()).where(Effort.resource_id.is_(None))) or 0
        person_rows = db.scalar(select(func.count()).where(Effort.resource_id.is_not(None))) or 0
        print(f"effort rows: {total}  (team-total/NULL: {null_rows}, per-person: {person_rows})")

        # Cells (enhancement+date) that have BOTH a NULL row and a per-person row — the
        # only shape that double-counts in actual_hrs.
        null_cells = select(Effort.enhancement_id, Effort.work_date).where(Effort.resource_id.is_(None)).subquery()
        pers_cells = select(Effort.enhancement_id, Effort.work_date).where(Effort.resource_id.is_not(None)).subquery()
        dupes = db.execute(
            select(null_cells.c.enhancement_id, null_cells.c.work_date)
            .join(pers_cells, (null_cells.c.enhancement_id == pers_cells.c.enhancement_id)
                  & (null_cells.c.work_date == pers_cells.c.work_date))
            .distinct()
        ).all()
        print(f"cells with BOTH team-total and per-person rows (double-count risk): {len(dupes)}")
        for eid, wd in dupes[:20]:
            tk = db.scalar(select(Enhancement.ticket).where(Enhancement.id == eid))
            print(f"  - {tk} ({eid}) on {wd}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
