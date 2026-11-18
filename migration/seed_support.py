"""Seed the initial support tasks. Idempotent: skips a task whose exact description
already exists. Auto-numbers TASK######. Runs against SQLite (default) or Lakebase (PG*)."""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.db import SessionLocal, SupportTicket, init_db  # noqa: E402

CREATED_BY = (os.environ.get("ADMIN_EMAILS") or "lead@example.com").split(",")[0].strip()

TASKS = [
    "Document the nightly pipeline run-book and share with the on-call rotation",
    "Compare effort and runtime between the new and legacy load process, and summarize findings",
    "Draft business communication templates for SLA breaches and outage notices",
    "Review the KT planning notes and respond with updates or sign-off",
    "Engage platform support on change-management and release controls",
    "Add data-quality checks discussed in standup (file retention plus two more)",
    "General process-coordination activities for the week",
]


def _next_number(db) -> int:
    mx = 0
    for (num,) in db.execute(select(SupportTicket.number)).all():
        m = re.fullmatch(r"TASK(\d+)", (num or "").strip(), re.I)
        if m:
            mx = max(mx, int(m.group(1)))
    return mx + 1


def main():
    init_db()
    db = SessionLocal()
    try:
        existing = {t.description.strip() for t in db.scalars(select(SupportTicket)).all()}
        n = _next_number(db)
        added = 0
        for desc in TASKS:
            if desc.strip() in existing:
                continue
            db.add(SupportTicket(number=f"TASK{n:06d}", description=desc, status="In Queue",
                                 active=True, created_by=CREATED_BY))
            n += 1
            added += 1
        db.commit()
        total = db.scalar(select(SupportTicket.id).order_by(SupportTicket.id.desc())) or 0
        print(f"support tasks added: {added} (skipped {len(TASKS) - added} already present)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
