"""Reviewed cleanup of lookup junk that leaked in from the Excel import:
merge misspelled sub-statuses into the canonical value, and drop values that
are not sub-statuses. Reads the DB connection from env (PG* / DATABASE_URL), so
it runs against local SQLite or Lakebase unchanged.

    python migration/cleanup_lookups.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.db import Enhancement, SessionLocal, Status, SubStatus  # noqa: E402

# Statuses that should drop out of the default (active) views.
INACTIVE_STATUSES = ["Completed", "Cancelled", "Withdrawn"]

# Board/workflow column order + clean display labels (code -> (sort_order, label)).
STATUS_ORDER = {
    "Requested": (0, "Requested"),
    "Assesment": (1, "Assessment"),
    "In Progress Internal": (2, "In Progress Internal"),
    "In Progress Vendor": (3, "In Progress Vendor"),
    "BP HOLD": (4, "Hold"),
    "UAT": (5, "UAT"),
    "Completed": (6, "Completed"),
    "Cancelled": (7, "Cancelled"),
    "Withdrawn": (8, "Withdrawn"),
}

# Misspellings / free-text → canonical sub-status.
SUB_MERGES = {
    "Assesment": "Assessment",
    "Waiting Assesment": "Waiting Assessment",
    "UAT--> We need to wait for Buisness": "UAT",
}
# These are statuses, not sub-statuses — clear them off enhancements, then delete.
SUB_DROPS = ["Canceled", "Cancelled"]


def main():
    db = SessionLocal()
    try:
        for old, new in SUB_MERGES.items():
            n = db.query(Enhancement).filter_by(sub_status_code=old).update({"sub_status_code": new})
            r = db.get(SubStatus, old)
            if r:
                db.delete(r)
            print(f"merged {old!r} -> {new!r} ({n} enhancements)")
        for d in SUB_DROPS:
            n = db.query(Enhancement).filter_by(sub_status_code=d).update({"sub_status_code": None})
            r = db.get(SubStatus, d)
            if r:
                db.delete(r)
            print(f"dropped {d!r} ({n} enhancements -> NULL)")
        # Mark Completed/Cancelled/Withdrawn as inactive (hidden from active views).
        for code in INACTIVE_STATUSES:
            s = db.get(Status, code)
            if s and not s.is_inactive:
                s.is_inactive = True
                print(f"status {code!r} -> inactive")
        # Workflow order + clean labels for the board columns.
        for code, (so, label) in STATUS_ORDER.items():
            s = db.get(Status, code)
            if s and (s.sort_order != so or s.label != label):
                s.sort_order, s.label = so, label
                print(f"status {code!r} -> order {so}, label {label!r}")
        db.commit()
        remaining = [s.code for s in db.query(SubStatus).order_by(SubStatus.sort_order, SubStatus.code).all()]
        print("remaining sub_status:", remaining)
    finally:
        db.close()


if __name__ == "__main__":
    main()
