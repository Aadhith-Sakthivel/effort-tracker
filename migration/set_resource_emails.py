"""Set resource login emails from a {name: email} JSON file, matching by name.

    python migration/set_resource_emails.py <path-to-mapping.json>

Reads the DB connection from env (PG* / DATABASE_URL), so it runs against local
SQLite or Lakebase unchanged. Idempotent; reports any names it couldn't match.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.db import Resource, SessionLocal  # noqa: E402


def main():
    if len(sys.argv) < 2:
        print("usage: python migration/set_resource_emails.py <mapping.json>")
        sys.exit(1)
    mapping = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    db = SessionLocal()
    try:
        by_name = {r.name.strip(): r for r in db.query(Resource).all()}
        updated, missing = 0, []
        for name, email in mapping.items():
            r = by_name.get(name.strip())
            if r:
                r.email = email
                updated += 1
            else:
                missing.append(name)
        db.commit()
        print(f"updated emails: {updated}")
        if missing:
            print("NO MATCH (skipped):", ", ".join(missing))
    finally:
        db.close()


if __name__ == "__main__":
    main()
